/**
 * db/word-store.js
 *
 * Data access layer for word progress.
 * SIGNIFICANT REWRITE per Master Handoff Document.
 *
 * CRITICAL SEPARATION RULE (never violated):
 *   - updateWordAfterMainGame()  → ONLY writes game*, strength, and wordStreak fields
 *   - updateWordAfterFlashcard() → ONLY writes srs*, leitnerGroup
 *   - The two systems never cross this boundary.
 */

import { db } from './db.js';
import { getWordById } from '../vocab/vocab.js';
import { reviewCard, createNewCard, getDueCards, getLeitnerGroup } from '../engine/srs.js';
import { recordWordCorrect, recordWordWrong } from '../engine/word-streak.js';
import { calculateWordStrength } from '../engine/progression.js';
import { createBaseCustomData } from '../vocab/custom-vocab.js';
import { getLangHelpers } from '../engine/langHelpers/index.js';

// ============================================
// RESOLVE / READ HELPERS (largely unchanged behavior)
// ============================================

export async function resolveWord(wordId) {
  if (!wordId) return null;

  try {
    const progress = await db.words.get(wordId);
    if (!progress) {
      console.warn(`[word-store] resolveWord failed for id: ${wordId}`);
      return null;
    }

    const vocab = getWordById(wordId);

    // Custom words store native/english directly in the DB record
    if (!vocab) {
      if (progress.native && progress.english) {
        const resolvedCustom = { ...progress };
        resolvedCustom.cleanNative = getCleanNative(resolvedCustom);
        return resolvedCustom;      }
      console.warn(`[word-store] resolveWord: no vocab entry for ${wordId}`);
      return null;
    }

    const resolved = { ...vocab, ...progress };
    resolved.cleanNative = getCleanNative(resolved);
    return resolved;
  } catch (err) {
    console.error(`[word-store] resolveWord error for ${wordId}:`, err);
    return null;
  }
}

export async function getWord(wordId) {
  return db.words.get(wordId);
}

export async function getAllUnlockedWords() {
  try {
    const records = await db.words.toArray();
    const resolved = await Promise.all(
      records.map(r => resolveWord(r.id))
    );
    return resolved.filter(Boolean);
  } catch (err) {
    console.error('[word-store] getAllUnlockedWords failed:', err);
    return [];
  }
}

export async function getWordsForSession(sessionConfig) {
  try {
    let words = await getAllUnlockedWords();

    if (!sessionConfig) {
      return words;
    }

    // Unit + chapter filter (Session Settings)
    if (sessionConfig.deckType === 'unit' && sessionConfig.selectedUnit != null) {
      const unit = Number(sessionConfig.selectedUnit);
      const chapters = Array.isArray(sessionConfig.selectedChapters)
        ? new Set(sessionConfig.selectedChapters.map(Number))
        : null;

      words = words.filter(w => {
        if (w.unit !== unit) return false;
        if (!chapters || chapters.size === 0) return true;
        return chapters.has(w.chapter);
      });
    }
    // Legacy multi-unit support (Flashcard Options still uses this)
    else if (Array.isArray(sessionConfig.selectedUnits) && sessionConfig.selectedUnits.length > 0) {
      const selected = new Set(sessionConfig.selectedUnits);
      words = words.filter(w => selected.has(w.unit));
    }

    // Word-type filter (Session Settings)
    // selectedTypes is an array of allowed type strings. If present and not empty,
    // keep only words whose type is in the set. Words missing a type field are kept
    // (backward-compatible until full tagging is complete).
    if (Array.isArray(sessionConfig.selectedTypes) && sessionConfig.selectedTypes.length > 0) {
      const allowed = new Set(sessionConfig.selectedTypes);
      words = words.filter(w => !w.type || allowed.has(w.type));
    }

    return words;
  } catch (err) {
    console.error('[word-store] getWordsForSession failed:', err);
    return [];
  }
}

// ============================================
// CLEAN NATIVE HELPER (for gameplay targets)
// ============================================

/**
 * Returns a clean, playable native-language string suitable for
 * Main Game blocks, Spelling input, and Word Search.
 *
 * Language-specific rules live in engine/langHelpers/*.
 * This function only dispatches.
 *
 * Accepts either a raw string or a full word object.
 */
export function getCleanNative(input) {
  // Language-aware cleaning via dispatcher (koHelpers / deHelpers)
  return getLangHelpers().cleanText(input);
}

// ============================================
// MAIN GAME UPDATE (only game* + strength + streak fields)
// ============================================

export async function updateWordAfterMainGame(wordId, wasCorrect, responseTime = null) {
  const word = await db.words.get(wordId);
  if (!word) {
    console.error(`[word-store] updateWordAfterMainGame: word not found ${wordId}`);
    return;
  }

  // === GAME FIELDS ONLY ===
  word.gameTimeSeen = (word.gameTimeSeen || 0) + 1;
  if (wasCorrect) {
    word.gameTimesCorrect = (word.gameTimesCorrect || 0) + 1;
  }
  word.gameLastSeen = Date.now();

  if (responseTime !== null && typeof responseTime === 'number') {
    const prevAvg = word.gameAvgResponseTime || responseTime;
    const count = word.gameTimeSeen; // already incremented
    word.gameAvgResponseTime = Math.round((prevAvg * (count - 1) + responseTime) / count);
  }

  // === WORD STREAK (main game only) ===
  const streakUpdate = wasCorrect
    ? recordWordCorrect(word)
    : recordWordWrong(word);

  word.wordStreak = streakUpdate.wordStreak;
  word.wordStreakModifier = streakUpdate.wordStreakModifier;
  word.wordStreakLastUpdated = streakUpdate.wordStreakLastUpdated;

  // === STRENGTH (recalculated after game answer) ===
  word.strength = calculateWordStrength(word);

  word.dbMod = Date.now();
  await db.words.put(word);
}

// ============================================
// FLASHCARD UPDATE (only srs* + leitnerGroup)
// ============================================

export async function updateWordAfterFlashcard(wordId, rating) {
  const word = await db.words.get(wordId);
  if (!word) {
    console.error(`[word-store] updateWordAfterFlashcard: word not found ${wordId}`);
    return;
  }

  const isFirstReview = !word.fsrsStability;

  let updatedFields;

  if (isFirstReview) {
    // First time this word is reviewed in flashcard mode
    updatedFields = createNewCard(rating);
  } else {
    // Calculate how many days since last review
    const lastReview = word.fsrsLastReview || Date.now();
    const elapsedDays = Math.max(0, (Date.now() - lastReview) / (1000 * 60 * 60 * 24));

    updatedFields = reviewCard(word, rating, elapsedDays);
  }

  await db.words.put({
    ...word,
    ...updatedFields,
    dbMod: Date.now()
  });
}

// ============================================
// SESSION SUMMARY HELPER
// ============================================

export async function markWordsDueNow(wordIds) {
  if (!Array.isArray(wordIds) || wordIds.length === 0) return;

  const now = Date.now();

  for (const id of wordIds) {
    try {
      const word = await db.words.get(id);
      if (word) {
        word.fsrsNextReviewAt = now;
        // IMPORTANT: Do NOT change leitnerGroup or any other field
        await db.words.put(word);
      }
    } catch (err) {
      console.warn(`[word-store] markWordsDueNow failed for ${id}:`, err);
    }
  }
}

// ============================================
// WORST PERFORMING (now uses game accuracy ratio)
// ============================================

export async function getWorstPerformingWords(limit = 10) {
  try {
    const all = await db.words.toArray();

    const withRatio = all
      .filter(w => (w.gameTimeSeen || 0) > 0)
      .map(w => ({
        ...w,
        accuracyRatio: (w.gameTimesCorrect || 0) / (w.gameTimeSeen || 1)
      }))
      .sort((a, b) => a.accuracyRatio - b.accuracyRatio) // worst first
      .slice(0, limit);

    const resolved = await Promise.all(
      withRatio.map(w => resolveWord(w.id))
    );

    return resolved.filter(Boolean);
  } catch (err) {
    console.error('[word-store] getWorstPerformingWords failed:', err);
    return [];
  }
}

// ============================================
// DUE WORDS FOR FLASHCARD MODE
// ============================================

export async function getDueWordsForFlashcard() {
  try {
    const allWords = await getAllUnlockedWords();
    return getDueCards(allWords);
  } catch (err) {
    console.error('[word-store] getDueWordsForFlashcard failed:', err);
    return [];
  }
}
// ============================================
// OVERALL DECK STRENGTH (now uses calculateWordStrength)
// ============================================

export async function getOverallDeckStrength() {
  try {
    const words = await db.words.toArray();
    if (!words.length) return 0;

    let total = 0;
    let count = 0;

    for (const w of words) {
      total += calculateWordStrength(w);
      count++;
    }

    return count > 0 ? total / count : 0;
  } catch (err) {
    console.error('[word-store] getOverallDeckStrength failed:', err);
    return 0;
  }
}
/**
 * Returns the derived Leitner group for a word using FSRS values.
 * Use this instead of word.leitnerGroup going forward.
 */
export function getDerivedLeitnerGroup(word) {
  if (!word) return 1;
  return getLeitnerGroup(word.fsrsStability, word.fsrsDifficulty);
}

// ============================================
// CUSTOM VOCABULARY SUPPORT (additive only — appended per handoff)
// ============================================

/**
 * Internal helper — seeds every custom word using the exact same
 * createNewCard('miss') path that batch-unlocked words use.
 * Guarantees new custom words start at G1 with correct initial FSRS state.
 */
function _createNewCustomCard(baseData) {
  // baseData = { id, unit, chapter, native, english }
  const initialFsrs = createNewCard('miss');

  return {
    ...baseData,
    ...initialFsrs,
    unlockedAt: Date.now(),
    dbMod: Date.now()
  };
}

/**
 * Public API to add a brand new custom word.
 * Called only from the Custom Word screen.
 */
export async function addCustomWord(native, english, unit, chapter) {
  try {
    const base = createBaseCustomData(native, english, unit, chapter);
    const fullRecord = _createNewCustomCard(base);

    await db.words.put(fullRecord);

    return { success: true, id: fullRecord.id };
  } catch (err) {
    console.error('[word-store] addCustomWord failed:', err);
    return { success: false, error: err.message };
  }
}
export async function updateCustomWord(wordId, { native, english }) {
  if (!wordId || !wordId.startsWith('custom_')) {
    return { success: false, error: 'Not a custom word' };
  }

  try {
    const existing = await db.words.get(wordId);
    if (!existing) {
      return { success: false, error: 'Word not found in DB' };
    }

    await db.words.put({
      ...existing,
      native: String(native).trim(),
      english: String(english).trim(),
      dbMod: Date.now()
    });

    return { success: true, id: wordId };
  } catch (err) {
    console.error('[word-store] updateCustomWord failed:', err);
    return { success: false, error: err.message };
  }
}
/**
 * Public API to permanently delete a custom word.
 * Only custom words (id starts with 'custom_') can be deleted.
 * Called from the Custom Word edit screen.
 */
export async function deleteCustomWord(wordId) {
  if (!wordId || typeof wordId !== 'string' || !wordId.startsWith('custom_')) {
    return { success: false, error: 'Only custom words can be deleted' };
  }

  try {
    await db.words.delete(wordId);
    return { success: true };
  } catch (err) {
    console.error('[word-store] deleteCustomWord failed:', err);
    return { success: false, error: err.message };
  }
}


export async function cleanupOrphanedWords() {
  try {
    const allRecords = await db.words.toArray();

    const orphaned = allRecords.filter(record => {
      const id = record.id;
      if (!id || id.startsWith('custom_')) return false; // never touch custom words
      if (getWordById(id)) return false;                 // valid static vocab word
      if (record.native && record.english) return false;  // has its own embedded data
      return true; // no vocab entry, no embedded data — orphaned
    });

    if (orphaned.length === 0) {
      console.log('[word-store] cleanupOrphanedWords: no orphaned records found');
      return { removed: 0, ids: [] };
    }

    const orphanedIds = orphaned.map(w => w.id);

    // Remove locally
    await db.words.bulkDelete(orphanedIds);

    // Remove from Firestore too, if sync is active for this account.
    // Dynamic import avoids pulling in Firebase for anonymous/local-only users.
    try {
      const sync = await import('./sync-engine.js');
      if (typeof sync.deleteWordsFromFirestore === 'function') {
        await sync.deleteWordsFromFirestore(orphanedIds);
      }
    } catch (syncErr) {
      console.warn('[word-store] cleanupOrphanedWords: Firestore cleanup skipped/failed', syncErr);
    }

    console.log(`[word-store] cleanupOrphanedWords: removed ${orphanedIds.length} orphaned record(s):`, orphanedIds);
    return { removed: orphanedIds.length, ids: orphanedIds };
  } catch (err) {
    console.error('[word-store] cleanupOrphanedWords failed:', err);
    return { removed: 0, ids: [], error: err.message };
  }
}
