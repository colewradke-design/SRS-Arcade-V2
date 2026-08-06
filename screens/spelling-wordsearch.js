import { navigate } from '../core/router.js';
import { getState } from '../core/state.js';
import { db } from '../db/db.js';
import * as wordStore from '../db/word-store.js';
import { generatePuzzle } from '../engine/wordsearch-generator.js';
import { shuffle } from '../core/utils.js';

/**
 * Auto-detect grid dimensions
 */
function getGridDimensions() {
  const isMobile = window.innerWidth < 768;
  return isMobile 
    ? { width: 10, height: 15 }   // Mobile
    : { width: 15, height: 10 };  // Desktop
}

let puzzle = null;
let foundWords = new Set();
let selectedCells = [];
let isSelecting = false;
let config = null;
let currentDirection = null;

export async function init(params = {}) {
  puzzle = null;
  foundWords = new Set();
  selectedCells = [];
  isSelecting = false;
  currentDirection = null;

  const app = document.getElementById('app');
  if (!app) {
    navigate('main-menu');
    return;
  }

  config = getState('spellingConfig') || {
    deckType: 'master',
    selectedUnits: [],
    wordCount: 10,
    difficulty: 'guided',
    continuePuzzle: false
  };

  const shouldContinue = params.continue === true || config.continuePuzzle === true;

  if (shouldContinue) {
    await loadSavedPuzzle(app);
  } else {
    await generateNewPuzzle(app);
  }

  if (!puzzle) {
    showError(app, 'Failed to load or generate puzzle.');
    return;
  }

  renderScreen(app);
  bindEvents(app);
  updateWordList();
}

async function loadSavedPuzzle(app) {
  try {
    const saved = await db.settings.get('activeSpellingPuzzle');
    if (saved && saved.value && !saved.value.completed) {
      puzzle = saved.value.puzzle;
      foundWords = new Set(saved.value.foundWords || []);
      return;
    }
  } catch (e) {}
  await generateNewPuzzle(app);
}

async function generateNewPuzzle(app) {
  try {
    const progressWords = await wordStore.getWordsForSession(config).catch(() => []);
    if (!progressWords || progressWords.length < 5) {
      showError(app, 'Not enough words unlocked.');
      return;
    }

    const resolvedTargets = await Promise.all(
      progressWords.map(pw => wordStore.resolveWord(pw.id).catch(() => null))
    ).then(r => r.filter(w => w && w.native && w.english));

    if (resolvedTargets.length < 5) {
      showError(app, 'Not enough words with native data.');
      return;
    }

    const targetWords = shuffle(resolvedTargets).slice(0, config.wordCount || 10);

    const { masterDeck } = await import('../vocab/vocab.js');
    const fullVocabForFiller = (masterDeck || [])
      .filter(w => w && typeof w.native === 'string' && w.native.trim().length >= 2)
      .map(w => ({ native: w.native }));

    const dimensions = getGridDimensions();
    let result = generatePuzzle(targetWords, fullVocabForFiller, dimensions);

    // === Replacement phase: up to 2 extra attempts with new mix ===
    const desiredCount = config.wordCount || 10;
    let attempts = 0;
    const maxReplacementAttempts = 2;

    while (result.targetWords.length < desiredCount && attempts < maxReplacementAttempts) {
      attempts++;

      // Keep what we successfully placed
      const successfullyPlaced = result.targetWords;

      // Get remaining candidates (exclude already placed)
      const placedIds = new Set(successfullyPlaced.map(w => w.id));
      const remainingCandidates = resolvedTargets.filter(w => !placedIds.has(w.id));

      if (remainingCandidates.length === 0) break;

      // Fill the missing slots with new words
      const needed = desiredCount - successfullyPlaced.length;
      const replacements = shuffle(remainingCandidates).slice(0, needed);

      const newMix = [...successfullyPlaced, ...replacements];
      result = generatePuzzle(newMix, fullVocabForFiller, dimensions);
    }

    puzzle = result;
    foundWords = new Set();
    await savePuzzleState(false);
  } catch (err) {
    console.error('[spelling-wordsearch] generateNewPuzzle failed', err);
    showError(app, 'Could not generate puzzle.');
  }
}

function showError(app, msg) {
  let screen = document.getElementById('screen-spelling-wordsearch');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'screen-spelling-wordsearch';
    screen.className = 'screen spelling-wordsearch-screen';
    app.appendChild(screen);
  }
  screen.innerHTML = `
    <div style="padding:var(--space-xl); text-align:center;">
      <h2 class="screen-title">WORD SEARCH</h2>
      <p style="color:var(--color-incorrect); margin: var(--space-xl) 0;">${msg}</p>
      <button class="btn btn-primary" onclick="window.navigateToMenu()">BACK TO MENU</button>
    </div>
  `;
  window.navigateToMenu = () => navigate('main-menu');
}

function renderScreen(app) {
  let screen = document.getElementById('screen-spelling-wordsearch');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'screen-spelling-wordsearch';
    screen.className = 'screen spelling-wordsearch-screen';
    app.appendChild(screen);
  }

  screen.innerHTML = `
    <div class="wordsearch-header">
      <button id="pause-btn" class="btn icon-btn">BACK</button>
      <div class="screen-title" style="flex:1; text-align:center;">WORD SEARCH</div>
      <button id="wordlist-btn" class="btn">WORDS</button>
    </div>

    <div class="wordsearch-grid-container">
      <div class="wordsearch-grid" id="wordsearch-grid"></div>
    </div>

    <div class="drawer-overlay" id="drawer-overlay" style="display:none;"></div>
    <div class="word-list-drawer" id="word-list-drawer">
      <div class="drawer-header">
        <span>WORDS</span>
        <button id="close-drawer" class="btn icon-btn">✕</button>
      </div>
      <div class="drawer-body" id="drawer-body"></div>
    </div>
  `;

  renderGrid(screen);
  highlightAllFoundWords();
}

function renderGrid(screen) {
  const container = screen.querySelector('#wordsearch-grid');
  if (!container || !puzzle || !puzzle.grid) return;

  const gridHeight = puzzle.grid.length;
  const gridWidth = puzzle.grid[0]?.length || 10;

  container.innerHTML = '';
  container.style.gridTemplateColumns = `repeat(${gridWidth}, 1fr)`;

  for (let r = 0; r < gridHeight; r++) {
    for (let c = 0; c < gridWidth; c++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.textContent = puzzle.grid[r][c] || '';
      container.appendChild(cell);
    }
  }
}

/**
 * Re-applies the green "found" highlight to grid cells for all words
 * that were previously discovered (used when continuing a saved puzzle).
 */
function markWordAsFound(wordId) {
  const gridEl = document.getElementById('wordsearch-grid');
  if (!gridEl || !puzzle || !puzzle.grid) return;

  const word = puzzle.targetWords?.find(w => w.id === wordId);
  if (!word) return;

  // Prefer cleanNative because the grid was built with cleaned characters
  const target = (word.cleanNative || word.native || '').trim();
  if (typeof target !== 'string' || target.length < 2) return;

  const len = target.length;
  const H = puzzle.grid.length;
  const W = puzzle.grid[0]?.length || 10;

  const dirs = [
    [0, 1], [0, -1], [1, 0], [-1, 0],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      for (const [dr, dc] of dirs) {
        // forward
        let ok = true;
        for (let i = 0; i < len; i++) {
          const rr = r + dr * i;
          const cc = c + dc * i;
          if (rr < 0 || rr >= H || cc < 0 || cc >= W || puzzle.grid[rr][cc] !== target[i]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          for (let i = 0; i < len; i++) {
            const el = gridEl.querySelector(`[data-row="${r + dr * i}"][data-col="${c + dc * i}"]`);
            if (el) el.classList.add('found');
          }
          return;
        }

        // reverse
        const rev = target.split('').reverse().join('');
        ok = true;
        for (let i = 0; i < len; i++) {
          const rr = r + dr * i;
          const cc = c + dc * i;
          if (rr < 0 || rr >= H || cc < 0 || cc >= W || puzzle.grid[rr][cc] !== rev[i]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          for (let i = 0; i < len; i++) {
            const el = gridEl.querySelector(`[data-row="${r + dr * i}"][data-col="${c + dc * i}"]`);
            if (el) el.classList.add('found');
          }
          return;
        }
      }
    }
  }
}

function highlightAllFoundWords() {
  if (!foundWords || foundWords.size === 0) return;
  for (const id of foundWords) {
    markWordAsFound(id);
  }
}

function bindEvents(screen) {
  const pauseBtn = screen.querySelector('#pause-btn');
  if (pauseBtn) pauseBtn.addEventListener('click', () => {
    savePuzzleState(false).then(() => navigate('main-menu'));
  });

  const wordlistBtn = screen.querySelector('#wordlist-btn');
  if (wordlistBtn) wordlistBtn.addEventListener('click', toggleWordListDrawer);

  const closeDrawer = screen.querySelector('#close-drawer');
  if (closeDrawer) closeDrawer.addEventListener('click', closeWordListDrawer);

  const overlay = screen.querySelector('#drawer-overlay');
  if (overlay) overlay.addEventListener('click', closeWordListDrawer);

  const grid = screen.querySelector('#wordsearch-grid');
  if (grid) {
    grid.addEventListener('mousedown', startSelection);
    grid.addEventListener('mousemove', continueSelection);
    window.addEventListener('mouseup', endSelection);

    grid.addEventListener('touchstart', handleTouchStart, { passive: false });
    grid.addEventListener('touchmove', handleTouchMove, { passive: false });
    grid.addEventListener('touchend', endSelection);
  }
}

// ==================== SELECTION LOGIC ====================

function startSelection(e) {
  const cell = e.target.closest('.grid-cell');
  if (!cell || !puzzle) return;

  isSelecting = true;
  selectedCells = [{
    row: parseInt(cell.dataset.row, 10),
    col: parseInt(cell.dataset.col, 10)
  }];
  currentDirection = null;
  highlightSelection();
}

function getSnappedDirection(dr, dc) {
  if (dr === 0 && dc === 0) return null;

  const ndr = Math.sign(dr);
  const ndc = Math.sign(dc);

  const valid = [
    { dr: 0,  dc: 1  }, { dr: 0,  dc: -1 },
    { dr: 1,  dc: 0  }, { dr: -1, dc: 0  },
    { dr: 1,  dc: 1  }, { dr: 1,  dc: -1 },
    { dr: -1, dc: 1  }, { dr: -1, dc: -1 }
  ];

  let best = valid[0];
  let bestScore = -Infinity;

  for (const v of valid) {
    const score = (v.dr === ndr ? 2 : 0) + (v.dc === ndc ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

function continueSelection(e) {
  if (!isSelecting) return;
  const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.grid-cell');
  if (!cell) return;

  const newCell = {
    row: parseInt(cell.dataset.row, 10),
    col: parseInt(cell.dataset.col, 10)
  };

  if (selectedCells.length === 0) return;

  const first = selectedCells[0];
  const rawDr = newCell.row - first.row;
  const rawDc = newCell.col - first.col;

  const snapped = getSnappedDirection(rawDr, rawDc);
  if (!snapped) return;

  currentDirection = snapped;

  selectedCells = [];
  const steps = Math.max(Math.abs(rawDr), Math.abs(rawDc)) + 1;

  const maxRow = puzzle.grid.length;
  const maxCol = puzzle.grid[0]?.length || 10;

  for (let i = 0; i < steps; i++) {
    const r = first.row + currentDirection.dr * i;
    const c = first.col + currentDirection.dc * i;

    if (r < 0 || r >= maxRow || c < 0 || c >= maxCol) break;

    selectedCells.push({ row: r, col: c });
  }

  highlightSelection();
}

function endSelection() {
  if (!isSelecting || selectedCells.length < 2) {
    clearSelectionHighlight();
    isSelecting = false;
    selectedCells = [];
    currentDirection = null;
    return;
  }

  validateSelection();
  isSelecting = false;
  selectedCells = [];
  currentDirection = null;
}

function handleTouchStart(e) {
  e.preventDefault();
  const touch = e.touches[0];
  const cell = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.grid-cell');
  if (!cell) return;

  isSelecting = true;
  selectedCells = [{
    row: parseInt(cell.dataset.row, 10),
    col: parseInt(cell.dataset.col, 10)
  }];
  currentDirection = null;
  highlightSelection();
}

function handleTouchMove(e) {
  if (!isSelecting || !e.touches || e.touches.length === 0) return;
  e.preventDefault();

  const touch = e.touches[0];
  if (!touch) return;

  const cell = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.grid-cell');
  if (!cell) return;

  const newCell = {
    row: parseInt(cell.dataset.row, 10),
    col: parseInt(cell.dataset.col, 10)
  };

  if (selectedCells.length === 0) return;

  const first = selectedCells[0];
  const rawDr = newCell.row - first.row;
  const rawDc = newCell.col - first.col;

  const snapped = getSnappedDirection(rawDr, rawDc);
  if (!snapped) return;

  currentDirection = snapped;

  selectedCells = [];
  const steps = Math.max(Math.abs(rawDr), Math.abs(rawDc)) + 1;

  const maxRow = puzzle.grid.length;
  const maxCol = puzzle.grid[0]?.length || 10;

  for (let i = 0; i < steps; i++) {
    const r = first.row + currentDirection.dr * i;
    const c = first.col + currentDirection.dc * i;

    if (r < 0 || r >= maxRow || c < 0 || c >= maxCol) break;

    selectedCells.push({ row: r, col: c });
  }

  highlightSelection();
}

function highlightSelection() {
  clearSelectionHighlight();
  const gridEl = document.getElementById('wordsearch-grid');
  if (!gridEl) return;

  selectedCells.forEach(cell => {
    const el = gridEl.querySelector(`[data-row="${cell.row}"][data-col="${cell.col}"]`);
    if (el) el.classList.add('selected');
  });
}

function clearSelectionHighlight() {
  document.querySelectorAll('.grid-cell.selected').forEach(el => el.classList.remove('selected'));
}

async function validateSelection() {
  if (!puzzle || selectedCells.length < 2) {
    clearSelectionHighlight();
    return;
  }

  const gridEl = document.getElementById('wordsearch-grid');
  const str = selectedCells.map(c => puzzle.grid[c.row][c.col]).join('');
  const reverseStr = str.split('').reverse().join('');

  for (const word of puzzle.targetWords) {
    if (foundWords.has(word.id)) continue;

    if (str === word.native || reverseStr === word.native) {
      foundWords.add(word.id);

      selectedCells.forEach(cell => {
        const el = gridEl?.querySelector(`[data-row="${cell.row}"][data-col="${cell.col}"]`);
        if (el) {
          el.classList.remove('selected');
          el.classList.add('found');
        }
      });

      updateWordList();
      await savePuzzleState(false);

      if (foundWords.size === puzzle.targetWords.length) {
        await renderPuzzleComplete();
      }
      return;
    }
  }

  clearSelectionHighlight();
}

function updateWordList() {
  const drawerBody = document.getElementById('drawer-body');
  if (!drawerBody || !puzzle) return;

  drawerBody.innerHTML = '';

  puzzle.targetWords.forEach(word => {
    const isFound = foundWords.has(word.id);
    const text = config.difficulty === 'guided' 
      ? (word.native || '—')
      : (word.english || '—');

    const item = document.createElement('div');
    item.className = `drawer-word-item ${isFound ? 'found' : ''}`;
    item.textContent = text;
    drawerBody.appendChild(item);
  });
}

function toggleWordListDrawer() {
  const drawer = document.getElementById('word-list-drawer');
  const overlay = document.getElementById('drawer-overlay');
  if (!drawer || !overlay) return;

  const isOpen = drawer.classList.contains('open');
  if (isOpen) {
    drawer.classList.remove('open');
    overlay.style.display = 'none';
  } else {
    drawer.classList.add('open');
    overlay.style.display = 'block';
    updateWordList();
  }
}

function closeWordListDrawer() {
  const drawer = document.getElementById('word-list-drawer');
  const overlay = document.getElementById('drawer-overlay');
  if (drawer) drawer.classList.remove('open');
  if (overlay) overlay.style.display = 'none';
}

async function savePuzzleState(completed) {
  if (!puzzle) return;

  const stateToSave = {
    puzzle,
    foundWords: Array.from(foundWords),
    config,
    completed: !!completed,
    savedAt: Date.now()
  };

  try {
    await db.settings.put({ key: 'activeSpellingPuzzle', value: stateToSave });
  } catch (e) {
    console.warn('[spelling-wordsearch] Failed to save puzzle state', e);
  }
}

async function renderPuzzleComplete() {
  const screen = document.getElementById('screen-spelling-wordsearch');
  if (!screen) return;

  await savePuzzleState(true);

  screen.innerHTML = `
    <div class="wordsearch-complete">
      <h1 class="screen-title">PUZZLE COMPLETE</h1>
      <div style="height:80px;"></div>
      <button id="back-menu-btn" class="btn btn-primary" style="min-width:220px; margin-bottom:12px;">BACK TO MAIN MENU</button>
      <button id="new-puzzle-btn" class="btn" style="min-width:220px;">NEW PUZZLE</button>
    </div>
  `;

  screen.querySelector('#back-menu-btn')?.addEventListener('click', () => navigate('main-menu'));
  screen.querySelector('#new-puzzle-btn')?.addEventListener('click', () => {
    navigate('spelling-options');
  });
}
