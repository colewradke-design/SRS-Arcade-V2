/**
 * db/sentence-store.js
 * Dexie access layer for the sentenceAttempts table only.
 * Sentence Mode is practice-only: never touches db.words, fsrs*, leitnerGroup, or game* fields.
 */

import { db } from './db.js';

/**
 * Generate an id matching the sessions table pattern.
 */
function generateId() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    `sent_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Persist a completed Sentence Mode attempt.
 * @param {Object} attempt
 * @param {string} attempt.complexity - 'single' | 'multi' | 'paragraph'
 * @param {string} attempt.promptText
 * @param {string[]} attempt.targetWordIds
 * @param {string} attempt.userTranslation
 * @param {boolean} attempt.correct
 * @param {string} [attempt.feedback]
 * @param {string[]} [attempt.correctedExamples]
 * @param {string[]} [attempt.wordsUsedCorrectly]
 * @param {string[]} [attempt.wordsMissed]
 */
export async function logAttempt(attempt) {
  if (!attempt) {
    console.warn('[sentence-store] logAttempt called with falsy data — skipping');
    return;
  }

  const record = {
    id: generateId(),
    timestamp: Date.now(),
    complexity: attempt.complexity || 'single',
    promptText: attempt.promptText || '',
    targetWordIds: Array.isArray(attempt.targetWordIds) ? attempt.targetWordIds : [],
    userTranslation: attempt.userTranslation || '',
    correct: Boolean(attempt.correct),
    feedback: attempt.feedback || '',
    correctedExamples: Array.isArray(attempt.correctedExamples) ? attempt.correctedExamples : [],
    wordsUsedCorrectly: Array.isArray(attempt.wordsUsedCorrectly) ? attempt.wordsUsedCorrectly : [],
    wordsMissed: Array.isArray(attempt.wordsMissed) ? attempt.wordsMissed : []
  };

  try {
    await db.sentenceAttempts.put(record);
  } catch (err) {
    console.error('[sentence-store] Failed to log attempt:', err);
  }
}

/**
 * Fetch most recent attempts, newest first.
 * @param {number} [limit=20]
 * @returns {Promise<Array>}
 */
export async function getRecentAttempts(limit = 20) {
  try {
    let query = db.sentenceAttempts.orderBy('timestamp').reverse();
    if (Number.isInteger(limit) && limit > 0) {
      query = query.limit(limit);
    }
    return await query.toArray();
  } catch (err) {
    console.error('[sentence-store] getRecentAttempts failed:', err);
    return [];
  }
}

/**
 * Pure retrieval of recent incorrect attempts. Zero analysis.
 * Returns raw feedback + wordsMissed only (plus other fields as stored).
 * @param {number} [n=10]
 * @returns {Promise<Array>}
 */
export async function getRecentIncorrectAttempts(n = 10) {
  try {
    // Query where correct === false, ordered by timestamp desc
    const allIncorrect = await db.sentenceAttempts
      .where('correct')
      .equals(0) // Dexie stores boolean as 0/1 for indexed fields in some cases; also try false
      .or('correct')
      .equals(false)
      .reverse()
      .sortBy('timestamp');

    // Fallback if compound index path fails: filter in memory from recent
    let results = allIncorrect;
    if (!results || results.length === 0) {
      const recent = await getRecentAttempts(50);
      results = recent.filter(r => r.correct === false);
    }

    // Ensure newest first and limit
    results = results
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, Math.max(0, n));

    // Return raw records (caller only needs feedback + wordsMissed, but full is fine)
    return results;
  } catch (err) {
    console.error('[sentence-store] getRecentIncorrectAttempts failed:', err);
    // Safe fallback
    try {
      const recent = await getRecentAttempts(50);
      return recent
        .filter(r => r.correct === false)
        .slice(0, Math.max(0, n));
    } catch {
      return [];
    }
  }
}

/**
 * Simple stats for UI / accuracy calculation.
 * @returns {Promise<{total: number, correct: number, accuracy: number}>}
 */
export async function getAttemptStats() {
  try {
    const all = await db.sentenceAttempts.toArray();
    const total = all.length;
    const correctCount = all.filter(a => a.correct === true).length;
    return {
      total,
      correct: correctCount,
      accuracy: total > 0 ? correctCount / total : 0
    };
  } catch (err) {
    console.error('[sentence-store] getAttemptStats failed:', err);
    return { total: 0, correct: 0, accuracy: 0 };
  }
}
