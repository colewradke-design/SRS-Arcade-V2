/**
 * engine/wordsearch-generator.js
 * Language-aware word search puzzle generator for Spelling Mode.
 *
 * Supports rectangular grids (e.g. 10x15 mobile, 15x10 desktop).
 * Uses aggressive backtracking for maximum reliability.
 *
 * Language-specific filler + cleaning logic lives in engine/langHelpers/.
 * This file is language-neutral and only calls through getLangHelpers().
 */

import { shuffle } from '../core/utils.js';
import { getLangHelpers } from './langHelpers/index.js';

// Grid dimensions (set per generation call)
let GRID_WIDTH = 10;
let GRID_HEIGHT = 10;

// 8 valid straight-line directions
const DIRECTIONS = {
  right:     { dr: 0,  dc: 1  },
  left:      { dr: 0,  dc: -1 },
  down:      { dr: 1,  dc: 0  },
  up:        { dr: -1, dc: 0  },
  downRight: { dr: 1,  dc: 1  },
  downLeft:  { dr: 1,  dc: -1 },
  upRight:   { dr: -1, dc: 1  },
  upLeft:    { dr: -1, dc: -1 }
};

const DIRECTION_KEYS = Object.keys(DIRECTIONS);

function canPlaceWord(grid, startRow, startCol, dr, dc, length) {
  for (let i = 0; i < length; i++) {
    const r = startRow + dr * i;
    const c = startCol + dc * i;
    if (r < 0 || r >= GRID_HEIGHT || c < 0 || c >= GRID_WIDTH) return false;
    if (grid[r][c] !== '' && grid[r][c] !== null) {
      // conflict check happens in placeWordInGrid
    }
  }
  return true;
}

function placeWordInGrid(grid, word, startRow, startCol, dr, dc) {
  // word.native is expected to already be the cleaned string used for the grid
  const chars = Array.from((word.native || '').trim());
  for (let i = 0; i < chars.length; i++) {
    const r = startRow + dr * i;
    const c = startCol + dc * i;
    const existing = grid[r][c];
    if (existing !== '' && existing !== chars[i]) return false;
    grid[r][c] = chars[i];
  }
  return true;
}

function recordOccupiedCells(startRow, startCol, dr, dc, length) {
  const cells = [];
  for (let i = 0; i < length; i++) {
    cells.push({ row: startRow + dr * i, col: startCol + dc * i });
  }
  return cells;
}

/**
 * Recursive backtracking placement engine
 */
function placeWordListWithBacktracking(grid, wordsToPlace, placedWords, occupiedMap, maxAttemptsPerWord = 450) {
  if (wordsToPlace.length === 0) return true;

  const word = wordsToPlace[0];
  const remainingWords = wordsToPlace.slice(1);
  const chars = Array.from((word.native || '').trim());
  const L = chars.length;

  if (L === 0 || L > Math.max(GRID_WIDTH, GRID_HEIGHT)) {
    return placeWordListWithBacktracking(grid, remainingWords, placedWords, occupiedMap, maxAttemptsPerWord);
  }

  for (let attempt = 0; attempt < maxAttemptsPerWord; attempt++) {
    const dirKey = DIRECTION_KEYS[Math.floor(Math.random() * DIRECTION_KEYS.length)];
    const { dr, dc } = DIRECTIONS[dirKey];

    const possibleStarts = [];
    for (let r = 0; r < GRID_HEIGHT; r++) {
      for (let c = 0; c < GRID_WIDTH; c++) {
        if (canPlaceWord(grid, r, c, dr, dc, L)) {
          possibleStarts.push({ row: r, col: c });
        }
      }
    }

    if (possibleStarts.length === 0) continue;

    // Score positions by openness (more empty neighbors = better)
    const scoredStarts = possibleStarts.map(pos => {
      let score = 0;
      for (let dr2 = -1; dr2 <= 1; dr2++) {
        for (let dc2 = -1; dc2 <= 1; dc2++) {
          const nr = pos.row + dr2;
          const nc = pos.col + dc2;
          if (nr >= 0 && nr < GRID_HEIGHT && nc >= 0 && nc < GRID_WIDTH) {
            if (!grid[nr][nc]) score++;
          }
        }
      }
      return { pos, score };
    }).sort((a, b) => b.score - a.score);

    // Take top positions (more when crowded)
    const topCount = possibleStarts.length <= 40 ? scoredStarts.length : 25;
    const startsToTry = scoredStarts.slice(0, topCount).map(s => s.pos);

    for (const start of startsToTry) {
      if (placeWordInGrid(grid, word, start.row, start.col, dr, dc)) {
        const occupied = recordOccupiedCells(start.row, start.col, dr, dc, L);
        occupiedMap.set(word.id, occupied);
        word._placement = { startRow: start.row, startCol: start.col, direction: dirKey };
        placedWords.push(word);

        if (placeWordListWithBacktracking(grid, remainingWords, placedWords, occupiedMap, maxAttemptsPerWord)) {
          return true;
        }

        // === Deeper backtracking (up to 2 levels) ===
        if (placedWords.length >= 2 && Math.random() < 0.35) {
          // Undo current word
          placedWords.pop();
          occupiedMap.delete(word.id);
          for (let i = 0; i < L; i++) {
            const r = start.row + dr * i;
            const c = start.col + dc * i;
            grid[r][c] = '';
          }

          // Also undo the previous word
          const prevWord = placedWords.pop();
          const prevOcc = occupiedMap.get(prevWord.id);
          if (prevOcc) {
            for (const cell of prevOcc) {
              grid[cell.row][cell.col] = '';
            }
            occupiedMap.delete(prevWord.id);
          }

          // Continue outer loop to rearrange
          continue;
        }

        // Normal single-level backtrack
        placedWords.pop();
        occupiedMap.delete(word.id);
        for (let i = 0; i < L; i++) {
          const r = start.row + dr * i;
          const c = start.col + dc * i;
          grid[r][c] = '';
        }
      }
    }
  }

  return false;
}

/**
 * Strong repair pass
 */
function repairMissingWords(grid, missingWords, placedWords, occupiedMap, helpers) {
  if (missingWords.length === 0) return 0;

  let totalRepaired = 0;
  const maxRounds = 3;

  for (let round = 0; round < maxRounds; round++) {
    let repairedThisRound = 0;

    for (const word of [...missingWords]) {
      if (placedWords.some(p => p.id === word.id)) continue;

      const chars = Array.from((word.native || '').trim());
      const L = chars.length;
      if (L === 0) continue;

      let placed = false;

      for (let attempt = 0; attempt < 900 && !placed; attempt++) {
        const dirKey = DIRECTION_KEYS[Math.floor(Math.random() * DIRECTION_KEYS.length)];
        const { dr, dc } = DIRECTIONS[dirKey];

        const possibleStarts = [];
        for (let r = 0; r < GRID_HEIGHT; r++) {
          for (let c = 0; c < GRID_WIDTH; c++) {
            if (canPlaceWord(grid, r, c, dr, dc, L)) {
              possibleStarts.push({ row: r, col: c });
            }
          }
        }

        if (possibleStarts.length === 0) {
          // Remove up to 3 words to free space
          const toRemoveCount = Math.min(3, placedWords.length);
          for (let i = 0; i < toRemoveCount; i++) {
            if (placedWords.length === 0) break;
            const idx = Math.floor(Math.random() * placedWords.length);
            const w = placedWords[idx];
            const occ = occupiedMap.get(w.id);
            if (occ) {
              for (const cell of occ) grid[cell.row][cell.col] = '';
              occupiedMap.delete(w.id);
            }
            placedWords.splice(idx, 1);
          }
          continue;
        }

        // Prefer more "open" positions
        const scored = possibleStarts.map(pos => {
          let score = 0;
          for (let dr2 = -1; dr2 <= 1; dr2++) {
            for (let dc2 = -1; dc2 <= 1; dc2++) {
              const nr = pos.row + dr2;
              const nc = pos.col + dc2;
              if (nr >= 0 && nr < GRID_HEIGHT && nc >= 0 && nc < GRID_WIDTH) {
                if (!grid[nr][nc]) score++;
              }
            }
          }
          return { pos, score };
        }).sort((a, b) => b.score - a.score);

        const start = scored[0].pos;

        if (placeWordInGrid(grid, word, start.row, start.col, dr, dc)) {
          const occupied = recordOccupiedCells(start.row, start.col, dr, dc, L);
          occupiedMap.set(word.id, occupied);
          word._placement = { startRow: start.row, startCol: start.col, direction: dirKey };
          placedWords.push(word);

          const idx = missingWords.findIndex(w => w.id === word.id);
          if (idx !== -1) missingWords.splice(idx, 1);

          placed = true;
          repairedThisRound++;
          totalRepaired++;
        }
      }
    }

    if (repairedThisRound === 0) break;
  }

  return totalRepaired;
}

/**
 * Post-processing cleanup pass
 * - Breaks up long repetitive runs of the same character
 * - Final safety net for any empty cells
 */
function cleanupRepetitivePatterns(grid, pools, helpers) {
  let changesMade = 0;
  const generateFiller = (avoid) => helpers.generateFillerSyllable(pools, avoid);

  // Horizontal cleanup
  for (let r = 0; r < GRID_HEIGHT; r++) {
    for (let c = 0; c < GRID_WIDTH - 2; c++) {
      const a = grid[r][c];
      const b = grid[r][c + 1];
      const d = grid[r][c + 2];
      if (a && a === b && a === d) {
        grid[r][c + 1] = generateFiller(a);
        changesMade++;
      }
    }
  }

  // Vertical cleanup
  for (let c = 0; c < GRID_WIDTH; c++) {
    for (let r = 0; r < GRID_HEIGHT - 2; r++) {
      const a = grid[r][c];
      const b = grid[r + 1][c];
      const d = grid[r + 2][c];
      if (a && a === b && a === d) {
        grid[r + 1][c] = generateFiller(a);
        changesMade++;
      }
    }
  }

  // Final empty cell safety sweep
  for (let r = 0; r < GRID_HEIGHT; r++) {
    for (let c = 0; c < GRID_WIDTH; c++) {
      if (!grid[r][c] || grid[r][c].trim() === '') {
        grid[r][c] = generateFiller();
        changesMade++;
      }
    }
  }

  return changesMade;
}

export function generatePuzzle(targetWords = [], allWords = [], options = {}) {
  GRID_WIDTH = options.width || 10;
  GRID_HEIGHT = options.height || 10;

  const helpers = getLangHelpers();

  if (!Array.isArray(targetWords) || targetWords.length === 0) {
    console.warn('[wordsearch-generator] No target words provided');
    return { grid: Array.from({ length: GRID_HEIGHT }, () => Array(GRID_WIDTH).fill('')), targetWords: [] };
  }

  // Normalize: prefer cleanNative (already attached by word-store) or fall back to native.
  // The string we place on the grid is always the cleaned version stored under .native.
  const validTargets = targetWords
    .filter(w => w && (w.cleanNative || w.native))
    .map(w => {
      const cleaned = w.cleanNative || helpers.cleanText(w.native || '') || (w.native || '');
      return { ...w, native: cleaned };
    })
    .filter(w => (w.native || '').length >= 2);

  if (validTargets.length === 0) {
    return { grid: Array.from({ length: GRID_HEIGHT }, () => Array(GRID_WIDTH).fill('')), targetWords: [] };
  }

  const pools = helpers.buildObservedComponentPools(allWords);
  const sortedTargets = [...validTargets].sort((a, b) => (b.native || '').length - (a.native || '').length);

  const MAX_FULL_GENERATIONS = 15;
  let bestPlacedWords = [];
  let bestOccupiedMap = new Map();
  let bestGrid = null;

  for (let genAttempt = 0; genAttempt < MAX_FULL_GENERATIONS; genAttempt++) {
    const grid = Array.from({ length: GRID_HEIGHT }, () => Array(GRID_WIDTH).fill(''));
    const placedWords = [];
    const occupiedMap = new Map();

    const success = placeWordListWithBacktracking(grid, sortedTargets, placedWords, occupiedMap, 800);

    if (success && placedWords.length > bestPlacedWords.length) {
      bestPlacedWords = placedWords;
      bestOccupiedMap = occupiedMap;
      bestGrid = grid;
      if (bestPlacedWords.length === sortedTargets.length) break;
    }
  }

  const grid = bestGrid || Array.from({ length: GRID_HEIGHT }, () => Array(GRID_WIDTH).fill(''));
  let placedWords = bestPlacedWords.length > 0 ? bestPlacedWords : sortedTargets;

  // === REPAIR PASS for missing words ===
  const missingWords = sortedTargets.filter(w => !placedWords.some(p => p.id === w.id));
  if (missingWords.length > 0 && bestGrid) {
    const repairedCount = repairMissingWords(grid, missingWords, placedWords, bestOccupiedMap, helpers);
    if (repairedCount > 0) {
      console.log(`[wordsearch-generator] Repair pass placed ${repairedCount} additional word(s).`);
    }
  }

  if (placedWords.length < sortedTargets.length) {
    console.warn(`[wordsearch-generator] Only placed ${placedWords.length}/${sortedTargets.length} words after repair.`);
  }

  // Fill remaining cells
  for (let r = 0; r < GRID_HEIGHT; r++) {
    for (let c = 0; c < GRID_WIDTH; c++) {
      if (!grid[r][c]) grid[r][c] = helpers.generateFillerSyllable(pools);
    }
  }

  // === POST-PROCESSING CLEANUP ===
  const cleanupChanges = cleanupRepetitivePatterns(grid, pools, helpers);
  if (cleanupChanges > 0) {
    console.log(`[wordsearch-generator] Cleanup fixed ${cleanupChanges} repetitive/empty cells.`);
  }

  for (const w of placedWords) {
    if (w._placement) delete w._placement;
  }

  return {
    grid,
    targetWords: placedWords,
    occupiedCells: bestOccupiedMap
  };
}
