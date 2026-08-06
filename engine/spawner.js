// engine/spawner.js
// Weighted word spawner for main game with chapter/unit/global distractor fallback.
// MODERATE REWRITE per Master Handoff Document.
//
// All spawn weight calculation has been moved to spawn-rate.js.
// This file now delegates to getSpawnRate() for every word.

import { getSpawnRate } from './spawn-rate.js';
import { getChapterWords, getUnitWords, getWordById } from '../vocab/vocab.js';
import { shuffle } from '../core/utils.js';

let spawnQueue = [];
let _sessionWords = [];
/** Cached current chapter for 2× weight boost. Set on first buildQueue call. */
let _currentChapter = null; // { unitId, chapterId } | null

const REFILL_THRESHOLD = 5;

function resolveFullWord(id, pool) {
  const staticWord = getWordById(id);
  if (staticWord) return staticWord;

  const source = pool || _sessionWords || [];
  return source.find(w => w.id === id) || null;
}

/**
 * Build (or rebuild) the weighted spawn queue.
 * Now uses getSpawnRate() from spawn-rate.js for all weighting.
 *
 * Optional second argument `currentChapterInfo` = { unitId, chapterId }.
 * When provided (or previously cached), words belonging to that chapter
 * receive a 2× weight multiplier so they appear more frequently.
 */
export function buildQueue(unlockedWords, currentChapterInfo = null) {
  if (!unlockedWords || unlockedWords.length === 0) {
    spawnQueue = [];
    _sessionWords = [];
    return;
  }

  // Cache the current-chapter boost target for refill calls
  if (currentChapterInfo && currentChapterInfo.unitId != null && currentChapterInfo.chapterId != null) {
    _currentChapter = {
      unitId: currentChapterInfo.unitId,
      chapterId: currentChapterInfo.chapterId
    };
  }

  _sessionWords = unlockedWords; // CRITICAL CACHE — do not re-query

  const weightedPool = [];
  for (const word of unlockedWords) {
    // DELEGATED: All spawn rate logic now lives in spawn-rate.js
    let weight = getSpawnRate(word);
    weight = Math.max(0.1, Math.min(1.25, weight || 0.5));

    // ADDITIONAL STEP: 2× weight for words in the current chapter
    if (
      _currentChapter &&
      word.unit === _currentChapter.unitId &&
      word.chapter === _currentChapter.chapterId
    ) {
      weight *= 2;
    }

    // Weak words (high spawn rate) get more copies in the pool
    const repeats = Math.max(2, Math.floor(weight * 15));
    for (let i = 0; i < repeats; i++) {
      weightedPool.push(word);
    }
  }

  spawnQueue = shuffle(weightedPool);
}

/**
 * Pull next word from queue.
 * - Avoids immediate re-spawn of the word that just left the screen.
 * - Auto-refills from cached _sessionWords when queue drops below threshold.
 */
export function getNextWord(currentWord = null) {
  if (spawnQueue.length === 0 && _sessionWords.length > 0) {
    buildQueue(_sessionWords);
  }

  if (spawnQueue.length === 0) {
    console.error('[spawner] spawnQueue empty — cannot spawn block');
    return null;
  }

  let next = spawnQueue.shift();

  // Skip one repeat of the previous word if possible
  if (currentWord && next && next.id === currentWord.id && spawnQueue.length > 0) {
    next = spawnQueue.shift();
  }

  // Refill logic
  if (spawnQueue.length < REFILL_THRESHOLD && _sessionWords.length > 0) {
    const remaining = [...spawnQueue];
    buildQueue(_sessionWords);
    spawnQueue = remaining.concat(spawnQueue);
  }

  return next;
}

/**
 * Internal: produce 3 distractors + correct word as full vocab objects.
 * Distractor rules (strict order):
 *   1. Same chapter (only unlocked words)
 *   2. Same unit (only unlocked)
 *   3. Any unlocked word in the entire deck
 * Always excludes the correct word itself.
 */
export function generateChoices(correctWord, allUnlockedWords) {
  if (!correctWord || !correctWord.id) return [];

const fullCorrect = resolveFullWord(correctWord.id, allUnlockedWords);
  if (!fullCorrect) {
    console.error('[spawner] generateChoices: vocab entry missing for', correctWord.id);
    return [];
  }

  const unlockedSet = new Set(
    (allUnlockedWords || _sessionWords || []).map(w => w.id)
  );

  // --- Same chapter first ---
  let chapterWords = getChapterWords(fullCorrect.unit, fullCorrect.chapter) || [];
  chapterWords = chapterWords.filter(
    w => w.id !== fullCorrect.id && unlockedSet.has(w.id)
  );

  let distractors = [];
  if (chapterWords.length >= 3) {
    distractors = shuffle(chapterWords).slice(0, 3);
  } else {
    distractors = [...chapterWords];

    // --- Fill from same unit ---
    let unitWords = getUnitWords(fullCorrect.unit) || [];
    unitWords = unitWords.filter(w =>
      w.id !== fullCorrect.id &&
      !distractors.some(d => d.id === w.id) &&
      unlockedSet.has(w.id)
    );

    const neededFromUnit = 3 - distractors.length;
    if (neededFromUnit > 0) {
      distractors = distractors.concat(shuffle(unitWords).slice(0, neededFromUnit));
    }

    // --- Final fallback: global unlocked deck ---
    if (distractors.length < 3) {
      const neededMore = 3 - distractors.length;
      const otherProgress = (allUnlockedWords || _sessionWords || []).filter(w =>
        w.id !== fullCorrect.id &&
        !distractors.some(d => d.id === w.id)
      );
      const otherFull = otherProgress
        .map(w => getWordById(w.id))
        .filter(Boolean);
      distractors = distractors.concat(shuffle(otherFull).slice(0, neededMore));
    }
  }

  // Build final 4 (correct + distractors)
  let combined = [fullCorrect, ...distractors];
  while (combined.length < 4 && combined.length > 0) {
    combined.push(combined[Math.floor(Math.random() * combined.length)]);
  }

  return shuffle(combined);
}

/**
 * Public API used by main-game.js
 * Returns everything needed to render one falling block.
 */
export function getTargetAndChoices(word, phase) {
  if (!word || !word.id) {
    return { target: '', choices: [], correctAnswer: '', wordId: null };
  }

const fullWord = resolveFullWord(word.id, _sessionWords);
  if (!fullWord) {
    console.error('[spawner] getTargetAndChoices: vocab missing for id', word.id);
    return { target: '', choices: [], correctAnswer: '', wordId: word.id };
  }

  // Use cleanNative for gameplay display (falls back to raw if not present)
  const displayNative = fullWord.cleanNative || fullWord.native;

  const isDecoding = (phase === 'blitz')
    ? (Math.random() < 0.5)
    : (phase === 'decoding');

  const choiceObjects = generateChoices(word, _sessionWords);

  let target, correctAnswer, choices;
  if (isDecoding) {
    target = displayNative;
    correctAnswer = fullWord.english;
    choices = choiceObjects.map(w => w.english || '');
  } else {
    target = fullWord.english;
    correctAnswer = fullWord.native;
    choices = choiceObjects.map(w => w.cleanNative || w.native || '');
  }

  return { target, choices, correctAnswer, wordId: word.id };
}
