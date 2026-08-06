/**
 * engine/sentence-engine.js
 * Pure logic layer for Sentence Mode.
 * Builds word pools, biases selection, assembles AI requests, validates responses.
 * Contains zero Firebase / Dexie calls.
 */

import { getAllUnlockedWords } from '../db/word-store.js';
import { getCurrentChapterProgress } from './progression.js';
import { getRecentIncorrectAttempts, getRecentAttempts } from '../db/sentence-store.js';
import { getUserLanguage } from '../db/settings-store.js';
import { generateSentencePrompt, evaluateTranslation } from '../core/ai-client.js';

// ---------------------------------------------------------------------------
// Word pool helpers
// ---------------------------------------------------------------------------

/**
 * Full set of currently unlocked words (minimal fields only for the model).
 */
export async function buildWordPool() {
  const words = await getAllUnlockedWords();
  return words.map(w => ({
    id: w.id,
    english: w.english || w.en || '',
    native: w.native || w.ko || w.hangul || w.cleanNative || '',
    unit: w.unit,
    chapter: w.chapter
  })).filter(w => w.id && (w.english || w.native));
}

/**
 * Select N word ids weighted toward the current chapter.
 * N scales with complexity: single=1-2, multi=2-4, paragraph=4-6
 */
export function selectBiasedWordIds(wordPool, currentChapterId, complexity = 'single') {
  if (!Array.isArray(wordPool) || wordPool.length === 0) return [];

  const ranges = {
    single: [1, 2],
    multi: [2, 4],
    paragraph: [4, 6]
  };
  const [minN, maxN] = ranges[complexity] || ranges.single;
  const targetCount = Math.min(
    wordPool.length,
    minN + Math.floor(Math.random() * (maxN - minN + 1))
  );

  // Weight: current-chapter words get 3× weight
  const weighted = wordPool.map(w => {
    const isCurrent = Number(w.chapter) === Number(currentChapterId);
    return { id: w.id, weight: isCurrent ? 3 : 1 };
  });

  // Weighted random sample without replacement
  const selected = [];
  const pool = [...weighted];

  while (selected.length < targetCount && pool.length > 0) {
    const total = pool.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx].weight;
      if (r <= 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    selected.push(pool[idx].id);
    pool.splice(idx, 1);
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Accuracy helper (pure counting)
// ---------------------------------------------------------------------------

async function computeRecentAccuracy(limit = 20) {
  const recent = await getRecentAttempts(limit);
  if (recent.length === 0) return 0.5; // neutral default
  const correct = recent.filter(a => a.correct === true).length;
  return correct / recent.length;
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

/**
 * Generate a new prompt for the next round.
 * Returns { promptText, targetWordIds } or throws.
 */
export async function createPrompt(complexity = 'single') {
  const wordPool = await buildWordPool();
  if (wordPool.length === 0) {
    throw new Error('No unlocked words available for Sentence Mode');
  }

  // Current chapter (existing progression concept — do not invent)
  let currentChapterId = 1;
  try {
    const progress = await getCurrentChapterProgress();
    if (progress && progress.chapterId != null) {
      currentChapterId = Number(progress.chapterId);
    }
  } catch (e) {
    console.warn('[sentence-engine] could not read current chapter, defaulting to 1', e);
  }

  const biasedWordIds = selectBiasedWordIds(wordPool, currentChapterId, complexity);
  const recentMistakes = await getRecentIncorrectAttempts(8);
  const recentAccuracy = await computeRecentAccuracy(20);
  const targetLanguage = (await getUserLanguage()) || 'ko';

  const result = await generateSentencePrompt(
    wordPool,
    biasedWordIds,
    complexity,
    recentMistakes,
    recentAccuracy,
    targetLanguage
  );

  // Validate required keys
  if (!result || typeof result.prompt_text !== 'string' || !Array.isArray(result.target_word_ids)) {
    throw new Error('Invalid prompt response from model');
  }

  // Ensure no ids outside the unlocked pool
  const allowed = new Set(wordPool.map(w => w.id));
  const safeIds = result.target_word_ids.filter(id => allowed.has(id));

  return {
    promptText: result.prompt_text.trim(),
    targetWordIds: safeIds.length > 0 ? safeIds : biasedWordIds
  };
}

/**
 * Evaluate a user translation.
 * Returns normalized result or throws.
 */
export async function evaluateUserTranslation(originalPrompt, userAnswer, complexity) {
  const wordPool = await buildWordPool();
  const targetLanguage = (await getUserLanguage()) || 'ko';

  const result = await evaluateTranslation(
    originalPrompt,
    userAnswer,
    wordPool,
    targetLanguage
  );

  // Validate
  if (!result || typeof result.correct !== 'boolean') {
    throw new Error('Invalid evaluation response from model');
  }

  return {
    correct: Boolean(result.correct),
    feedback: result.feedback || '',
    correctedExamples: Array.isArray(result.corrected_examples) ? result.corrected_examples : [],
    wordsUsedCorrectly: Array.isArray(result.words_used_correctly) ? result.words_used_correctly : [],
    wordsMissed: Array.isArray(result.words_missed) ? result.words_missed : []
  };
}
