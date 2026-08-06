/**
 * engine/progression.js
 * Core progression, unlock, and word strength logic.
 * Updated with robust chapter advancement + defensive coding.
 */

import { db } from '../db/db.js';
import { getChapterWords } from '../vocab/vocab.js';
import { createNewCard } from './srs.js';
import { getSetting } from '../db/settings-store.js';

export const UNLOCK_THRESHOLD = 0.70;
export const UNIT_COMPLETE_THRESHOLD = 0.80;
export const STARTING_WORD_COUNT = 25;
export const BATCH_SIZE = 25;

/**
 * Internal helper: finds the "current" chapter progress record.
 * Always ensures exactly one record has isCurrentUnit=true.
 *
 * Priority:
 * 1. Furthest chapter that actually has unlocked words in db.words
 *    (this catches cases where words exist but the progress row was never
 *     created or was lost in a sync).
 * 2. Among progress rows, the furthest advanced (highest unitId then chapterId).
 *
 * Creates a missing progress row when words exist for a higher chapter.
 * Self-heals multi-flag / missing-flag situations from multi-device usage.
 */
async function getCurrentProgress() {
  const now = Date.now();

  // --- 1. Discover the furthest chapter that has any unlocked words ---
  // Note: Full Deck strength is calculated purely from words, so a 59% on
  // chapter 3 does NOT guarantee a progress row exists. We must look at words.
  let maxWordUnit = 0;
  let maxWordChapter = 0;
  try {
    const allWords = await db.words.toArray();
    for (const w of allWords) {
      const u = Number(w.unit) || 0;
      const c = Number(w.chapter) || 0;
      if (u > maxWordUnit || (u === maxWordUnit && c > maxWordChapter)) {
        maxWordUnit = u;
        maxWordChapter = c;
      }
    }
    console.log(`[progression] furthest unlocked words → Unit ${maxWordUnit} Ch ${maxWordChapter}`);
  } catch (e) {
    console.warn('[progression] getCurrentProgress: words scan failed', e);
  }

  // --- 2. Load / ensure progress rows ---
  let progressRecords = await db.progress.toArray();

  // If words exist for a chapter that has no progress row, create one
  if (maxWordUnit > 0 && maxWordChapter > 0) {
    const exists = progressRecords.some(
      p => Number(p.unitId) === maxWordUnit && Number(p.chapterId) === maxWordChapter
    );
    if (!exists) {
      const chapterVocab = getChapterWords(maxWordUnit, maxWordChapter) || [];
      const unlockedInChapter = await db.words
        .where({ unit: maxWordUnit, chapter: maxWordChapter })
        .count();
      const newRow = {
        unitId: maxWordUnit,
        chapterId: maxWordChapter,
        unlockIndex: unlockedInChapter,
        unitStrength: 0,
        chapterStrength: 0,
        isCurrentUnit: false, // will be set below
        fullyUnlocked: chapterVocab.length > 0 && unlockedInChapter >= chapterVocab.length,
        unlockedAt: now,
        dbMod: now
      };
      await db.progress.put(newRow);
      progressRecords = await db.progress.toArray(); // refresh
      console.log(`[progression] Self-healed missing progress row for Unit ${maxWordUnit} Ch ${maxWordChapter}`);
    }
  }

  if (!progressRecords || progressRecords.length === 0) return null;

  // --- 3. Score every progress row ---
  const scored = progressRecords.map(p => ({
    p,
    score: (Number(p.unitId) || 0) * 100 + (Number(p.chapterId) || 0)
  }));

  // Prefer the progress that matches the furthest unlocked words
  let chosen = null;
  if (maxWordUnit > 0) {
    const wordMatch = scored.find(
      s => Number(s.p.unitId) === maxWordUnit && Number(s.p.chapterId) === maxWordChapter
    );
    if (wordMatch) chosen = wordMatch.p;
  }

  // Fallback: furthest progress row overall
  if (!chosen) {
    scored.sort((a, b) => b.score - a.score);
    chosen = scored[0].p;
  }

  console.log(`[progression] chosen current → Unit ${chosen?.unitId} Ch ${chosen?.chapterId} (isCurrentUnit will be forced true)`);

  // --- 4. Self-heal: ensure ONLY the chosen record is flagged current ---
  // Use Number() on both sides so string/number mismatches from Firestore don't break the match.
  for (const s of scored) {
    const shouldBeCurrent =
      Number(s.p.unitId) === Number(chosen.unitId) &&
      Number(s.p.chapterId) === Number(chosen.chapterId);
    if (s.p.isCurrentUnit !== shouldBeCurrent) {
      s.p.isCurrentUnit = shouldBeCurrent;
      s.p.dbMod = now;
      await db.progress.put(s.p);
    }
  }

  return chosen;
}

export async function getCurrentChapterProgress() {
  return getCurrentProgress();
}

export function calculateWordStrength(word) {
  if (!word) return 0;
  const timeSeen = Number(word.gameTimeSeen) || 0;
  if (timeSeen === 0) return 0;
  const timesCorrect = Number(word.gameTimesCorrect) || 0;
  const accuracy = timesCorrect / timeSeen;
  const confidence = Math.min(timeSeen / 20, 1.0);
  return accuracy * confidence;
}

export async function initializeFirstSession() {
  const alreadyOnboarded = await getSetting('hasCompletedOnboarding');
  if (alreadyOnboarded === true) return;

  const existing = await db.words.count();
  if (existing > 0) return;

  console.log('[progression] First launch — seeding initial 25 words from Unit 1 Chapter 1');

  const firstChapterWords = getChapterWords(1, 1) || [];
  const seedWords = firstChapterWords.slice(0, STARTING_WORD_COUNT);

  if (seedWords.length === 0) {
    console.error('[progression] FATAL: getChapterWords(1,1) returned empty');
    return;
  }

  await db.progress.put({
    unitId: 1,
    chapterId: 1,
    unlockIndex: 0,
    unitStrength: 0,
    chapterStrength: 0,
    isCurrentUnit: true,
    fullyUnlocked: false,
    unlockedAt: Date.now()
  });

  const now = Date.now();
  for (const vocabWord of seedWords) {
    await db.words.put({
      id: vocabWord.id,
      unit: vocabWord.unit,
      chapter: vocabWord.chapter,
      strength: 0,
      unlockedAt: now,
      ...createNewCard('miss'),
      gameTimeSeen: 0,
      gameTimesCorrect: 0,
      gameLastSeen: null,
      gameAvgResponseTime: null,
      wordStreak: 0,
      wordStreakModifier: 1.0,
      wordStreakLastUpdated: null,
      dbMod: now
    });
  }
}

/**
 * Robust version of hasLockedWordsInUnit.
 * Dynamically discovers chapters for the unit instead of hardcoding 1-4.
 */
async function hasLockedWordsInUnit(unitId) {
  try {
    // Discover which chapters actually have vocab for this unit
    const chaptersInUnit = new Set();
    // Safe scan range (covers up to ~14 units × 4 chapters)
    for (let ch = 1; ch <= 60; ch++) {
      const words = getChapterWords(unitId, ch) || [];
      if (words.length > 0) {
        chaptersInUnit.add(ch);
      } else if (ch > 15 && chaptersInUnit.size > 0) {
        // Stop scanning once we've passed this unit's chapters
        break;
      }
    }

    if (chaptersInUnit.size === 0) return false;

    let totalPossible = 0;
    let unlockedCount = 0;

    for (const ch of chaptersInUnit) {
      const chapterWords = getChapterWords(unitId, ch) || [];
      totalPossible += chapterWords.length;
      const unlockedInChapter = await db.words.where({ unit: unitId, chapter: ch }).count();
      unlockedCount += unlockedInChapter;
    }

    return unlockedCount < totalPossible;
  } catch (e) {
    console.warn('[progression] hasLockedWordsInUnit dynamic scan failed, using fallback', e);
    // Fallback to original 1-4 logic
    let totalPossible = 0;
    let unlockedCount = 0;
    for (let ch = 1; ch <= 4; ch++) {
      const chapterWords = getChapterWords(unitId, ch) || [];
      totalPossible += chapterWords.length;
      const unlockedInChapter = await db.words.where({ unit: unitId, chapter: ch }).count();
      unlockedCount += unlockedInChapter;
    }
    return unlockedCount < totalPossible;
  }
}

export async function checkAndHandleUnlock() {
  const currentProgress = await getCurrentProgress();
  if (!currentProgress) return;

  const currentUnit = currentProgress.unitId;
  const currentChapter = currentProgress.chapterId;

  const unitWords = await db.words.where('unit').equals(currentUnit).toArray();
  if (unitWords.length === 0) return;

  const chapterStrength = await getLiveChapterStrength(currentUnit, currentChapter);
  const unitStrength = await getUnitGatingStrength(currentUnit);
  const hasLocked = await hasLockedWordsInUnit(currentUnit);

  // === CHAPTER-LEVEL GATE ===
  // Unlock the next batch (remaining words in this chapter, or the next
  // chapter) once THIS chapter's own strength crosses the threshold.
  if (chapterStrength >= UNLOCK_THRESHOLD && hasLocked) {
    await unlockNextBatch();
    return;
  }

  // === UNIT-LEVEL GATE ===
  // Advance to the next unit only once every chapter in this unit is fully
  // unlocked AND the unit-wide average strength crosses the higher threshold.
  const allUnlocked = !hasLocked;
  if (allUnlocked && unitStrength >= UNIT_COMPLETE_THRESHOLD) {
    await unlockNextUnit();
  }
}

/**
 * Chapter-weighted unit strength used ONLY for the unit-completion gate.
 * Applies assessmentFloor as a hard floor per chapter so bootstrapped
 * chapters do not drag the unit average to zero.
 * Display functions (getLiveUnitStrength / getLiveChapterStrength) stay pure.
 */
export async function getUnitGatingStrength(unitId) {
  if (unitId == null) return 0;

  const rows = await db.progress.where('unitId').equals(unitId).toArray();
  if (rows.length === 0) return 0;

  let sum = 0;
  for (const row of rows) {
    const real = await getLiveChapterStrength(row.unitId, row.chapterId);
    const floor = (typeof row.assessmentFloor === 'number') ? row.assessmentFloor : 0;
    sum += Math.max(real, floor);
  }
  return sum / rows.length;
}

/**
 * Main batch unlock + automatic chapter advancement.
 * When current chapter is exhausted, automatically advances to next chapter
 * (same unit or next unit) and seeds its first batch.
 */
export async function unlockNextBatch() {
  try {
    const current = await getCurrentProgress();
    if (!current) {
      console.warn('[progression] unlockNextBatch: no active progress record found');
      return;
    }

    const { unitId, chapterId } = current;
    const chapterVocab = getChapterWords(unitId, chapterId) || [];
    if (chapterVocab.length === 0) {
      console.warn(`[progression] unlockNextBatch: no vocab defined for Unit ${unitId} Ch ${chapterId}`);
      return;
    }

    const rawBatch = await getSetting('unlockBatchSize');
    const batchSize = (typeof rawBatch === 'number' && rawBatch > 0) ? rawBatch : BATCH_SIZE;

    const unlockedRecords = await db.words.where({ unit: unitId, chapter: chapterId }).toArray();
    const unlockedIds = new Set(unlockedRecords.map(w => w.id));

    const remaining = chapterVocab.filter(vw => !unlockedIds.has(vw.id));

    if (remaining.length === 0) {
      // === CHAPTER FULLY UNLOCKED — ADVANCE TO NEXT CHAPTER ===
      current.fullyUnlocked = true;
      current.dbMod = Date.now();
      await db.progress.put(current);

      // Next chapter is always chapterId+1 in the same unit, falling back to
      // chapter 1 of the next unit when the current unit has no more chapters.
      // Chapters are numbered 1..N per unit (not globally sequential).
      let nextUnitId = unitId;
      let targetChapterId = chapterId + 1;
      let nextChapterVocab = getChapterWords(nextUnitId, targetChapterId) || [];

      if (nextChapterVocab.length === 0) {
        nextUnitId = unitId + 1;
        targetChapterId = 1;
        nextChapterVocab = getChapterWords(nextUnitId, targetChapterId) || [];
      }

      if (nextChapterVocab.length === 0) {
        console.log(`[progression] No more chapters after Unit ${unitId} Ch ${chapterId}. Progression complete.`);
        return;
      }

      const now = Date.now();

      // Seed first batch of the new chapter
      const toSeed = nextChapterVocab.slice(0, batchSize);
      for (const vocabWord of toSeed) {
        const exists = await db.words.get(vocabWord.id);
        if (exists) continue;

        await db.words.put({
          id: vocabWord.id,
          unit: vocabWord.unit,
          chapter: vocabWord.chapter,
          strength: 0,
          unlockedAt: now,
          ...createNewCard('miss'),
          gameTimeSeen: 0,
          gameTimesCorrect: 0,
          gameLastSeen: null,
          gameAvgResponseTime: null,
          wordStreak: 0,
          wordStreakModifier: 1.0,
          wordStreakLastUpdated: null,
          dbMod: now
        });
      }

      // Create or update progress record for the new chapter
      let newProgress = await db.progress.get([nextUnitId, targetChapterId]);
      if (!newProgress) {
        newProgress = {
          unitId: nextUnitId,
          chapterId: targetChapterId,
          unlockIndex: toSeed.length,
          unitStrength: 0,
          chapterStrength: 0,
          isCurrentUnit: true,
          fullyUnlocked: toSeed.length >= nextChapterVocab.length,
          unlockedAt: now
        };
      } else {
        newProgress.unlockIndex = Math.max(newProgress.unlockIndex || 0, toSeed.length);
        newProgress.isCurrentUnit = true;
        newProgress.fullyUnlocked = toSeed.length >= nextChapterVocab.length;
        newProgress.dbMod = now;
      }
      await db.progress.put(newProgress);

      // Demote any other "current" flags (defensive)
      const allProgress = await db.progress.toArray();
      for (const p of allProgress) {
        if (p.unitId !== nextUnitId || p.chapterId !== targetChapterId) {
          if (p.isCurrentUnit === true) {
            p.isCurrentUnit = false;
            p.dbMod = now;
            await db.progress.put(p);
          }
        }
      }

      console.log(`[progression] Chapter ${chapterId} complete. Advanced to Unit ${nextUnitId} Chapter ${targetChapterId} and seeded first batch of ${toSeed.length} words.`);
      return;
    }

    // Normal batch unlock within current chapter
    const toUnlock = remaining.slice(0, batchSize);
    const now = Date.now();

    for (const vocabWord of toUnlock) {
      const exists = await db.words.get(vocabWord.id);
      if (exists) continue;

      await db.words.put({
        id: vocabWord.id,
        unit: vocabWord.unit,
        chapter: vocabWord.chapter,
        strength: 0,
        unlockedAt: now,
        ...createNewCard('miss'),
        gameTimeSeen: 0,
        gameTimesCorrect: 0,
        gameLastSeen: null,
        gameAvgResponseTime: null,
        wordStreak: 0,
        wordStreakModifier: 1.0,
        wordStreakLastUpdated: null,
        dbMod: now
      });
    }

    const newUnlockedCount = unlockedIds.size + toUnlock.length;
    current.unlockIndex = newUnlockedCount;
    if (newUnlockedCount >= chapterVocab.length) {
      current.fullyUnlocked = true;
    }
    current.dbMod = now;
    await db.progress.put(current);

    console.log(`[progression] Unlocked batch of ${toUnlock.length} words (Unit ${unitId} Ch ${chapterId}). Total in chapter: ${newUnlockedCount}/${chapterVocab.length}`);
  } catch (err) {
    console.error('[progression] unlockNextBatch failed defensively:', err);
  }
}

export async function unlockNextUnit() {
  // Existing robust implementation kept (only called when entire unit is complete)
  try {
    const current = await getCurrentProgress();
    if (!current) {
      console.warn('[progression] unlockNextUnit: no current progress');
      return;
    }

    const currentUnitId = current.unitId;

    const allUnitWords = await db.words.where('unit').equals(currentUnitId).toArray();
    let unitTotal = 0;
    let unitCount = 0;
    for (const w of allUnitWords) {
      unitTotal += calculateWordStrength(w);
      unitCount++;
    }
    const currentUnitStrength = await getUnitGatingStrength(currentUnitId);

    if (currentUnitStrength < UNIT_COMPLETE_THRESHOLD) {
      console.log(`[progression] unlockNextUnit: Unit ${currentUnitId} at ${(currentUnitStrength * 100).toFixed(1)}% — threshold not met yet.`);
    return;
    }

    const nextUnitId = currentUnitId + 1;
    const firstChapterVocab = getChapterWords(nextUnitId, 1) || [];
    if (firstChapterVocab.length === 0) {
      console.log(`[progression] unlockNextUnit: No more units after Unit ${currentUnitId}`);
      const unitProgresses = await db.progress.where('unitId').equals(currentUnitId).toArray();
      for (const p of unitProgresses) {
        p.fullyUnlocked = true;
        await db.progress.put(p);
      }
      return;
    }

    const rawBatch = await getSetting('unlockBatchSize');
    const batchSize = (typeof rawBatch === 'number' && rawBatch > 0) ? rawBatch : BATCH_SIZE;

    const now = Date.now();
    const toSeed = firstChapterVocab.slice(0, batchSize);

    for (const vocabWord of toSeed) {
      const exists = await db.words.get(vocabWord.id);
      if (exists) continue;

      await db.words.put({
        id: vocabWord.id,
        unit: vocabWord.unit,
        chapter: vocabWord.chapter,
        strength: 0,
        unlockedAt: now,
        ...createNewCard('miss'),
        gameTimeSeen: 0,
        gameTimesCorrect: 0,
        gameLastSeen: null,
        gameAvgResponseTime: null,
        wordStreak: 0,
        wordStreakModifier: 1.0,
        wordStreakLastUpdated: null,
        dbMod: now
      });
    }

    let newProgress = await db.progress.get([nextUnitId, 1]);
    if (!newProgress) {
      newProgress = {
        unitId: nextUnitId,
        chapterId: 1,
        unlockIndex: toSeed.length,
        unitStrength: 0,
        chapterStrength: 0,
        isCurrentUnit: true,
        fullyUnlocked: toSeed.length >= firstChapterVocab.length,
        unlockedAt: now
      };
    } else {
      newProgress.unlockIndex = Math.max(newProgress.unlockIndex || 0, toSeed.length);
      newProgress.isCurrentUnit = true;
      newProgress.fullyUnlocked = toSeed.length >= firstChapterVocab.length;
    }
    await db.progress.put(newProgress);

    // Demote every other current flag (must match both unit + chapter)
    const allProgress = await db.progress.toArray();
    for (const p of allProgress) {
      if ((p.unitId !== nextUnitId || p.chapterId !== 1) && p.isCurrentUnit === true) {
        p.isCurrentUnit = false;
        p.dbMod = now;
        await db.progress.put(p);
      }
    }

    console.log(`[progression] Unit ${currentUnitId} complete. Unlocked first batch of Unit ${nextUnitId} Chapter 1.`);
  } catch (err) {
    console.error('[progression] unlockNextUnit failed defensively:', err);
  }
}

export async function getLiveChapterStrength(unitId, chapterId) {
  if (unitId == null || chapterId == null) return 0;

  const chapterWords = await db.words.where({ unit: unitId, chapter: chapterId }).toArray();
  if (chapterWords.length === 0) return 0;

  let total = 0;
  for (const w of chapterWords) {
    total += calculateWordStrength(w);
  }
  return total / chapterWords.length;
}

export async function getLiveUnitStrength(unitId) {
  if (unitId == null) return 0;

  const unitWords = await db.words.where('unit').equals(unitId).toArray();
  if (unitWords.length === 0) return 0;

  let total = 0;
  for (const w of unitWords) {
    total += calculateWordStrength(w);
  }
  return total / unitWords.length;
}

export async function seedChapterWords(unitId, chapterId, assessmentFloor = null) {
  const chapterWords = getChapterWords(unitId, chapterId) || [];
  if (chapterWords.length === 0) return;

  const now = Date.now();

  for (const vocabWord of chapterWords) {
    const exists = await db.words.get(vocabWord.id);
    if (exists) continue;

    await db.words.put({
      id: vocabWord.id,
      unit: vocabWord.unit,
      chapter: vocabWord.chapter,
      strength: 0,
      unlockedAt: now,
      ...createNewCard('miss'),
      gameTimeSeen: 0,
      gameTimesCorrect: 0,
      gameLastSeen: null,
      gameAvgResponseTime: null,
      wordStreak: 0,
      wordStreakModifier: 1.0,
      wordStreakLastUpdated: null,
      dbMod: now
    });
  }

  let progress = await db.progress.get([unitId, chapterId]);
  const fullCount = chapterWords.length;

  if (!progress) {
    progress = {
      unitId,
      chapterId,
      unlockIndex: fullCount,          // onboarding seeds the entire chapter
      unitStrength: 0,
      chapterStrength: 0,
      isCurrentUnit: true,
      fullyUnlocked: true,             // all words are present
      unlockedAt: now
    };
  } else {
    progress.unlockIndex = Math.max(progress.unlockIndex || 0, fullCount);
    progress.fullyUnlocked = true;
    progress.isCurrentUnit = true;
    progress.dbMod = now;
  }

  // Only set the floor when explicitly passed (passed assessment chapters)
  if (typeof assessmentFloor === 'number') {
    progress.assessmentFloor = assessmentFloor;
  }

  await db.progress.put(progress);

  // ALWAYS demote every other row (fixes the residual multi-flag bug)
  const allProgress = await db.progress.toArray();
  for (const p of allProgress) {
    if (p.unitId !== unitId || p.chapterId !== chapterId) {
      if (p.isCurrentUnit === true) {
        p.isCurrentUnit = false;
        p.dbMod = now;
        await db.progress.put(p);
      }
    }
  }
}

/**
 * Map a global chapter number → unit.
 * Matches onboarding / vocab data: Unit N owns global chapters (N-1)*4+1 … N*4.
 */
function unitForGlobalChapter(globalChapter) {
  return Math.floor((Number(globalChapter) - 1) / 4) + 1;
}

/**
 * Manually unlocks every global chapter from 1 through targetChapterId (inclusive).
 * Intended for the Settings "Unlock Chapters" override when a student skipped
 * onboarding and is stuck behind where their class actually is.
 *
 * Chapter IDs are GLOBAL sequential (1, 2, 3…). Unit is derived:
 *   unit = floor((chapter - 1) / 4) + 1
 * so Unit 1 = ch 1-4, Unit 2 = ch 5-8, Unit 3 = ch 9-12, etc.
 *
 * Mirrors the onboarding assessment convention:
 *  - Chapters 1..(target - 1) get UNIT_COMPLETE_THRESHOLD floor.
 *  - The target chapter itself gets NO floor — strength must be earned.
 *
 * Safe / idempotent — seedChapterWords skips existing words.
 *
 * @param {number} targetChapterId  Global chapter number (1-based)
 * @returns {Promise<{ success: true, unlocked: number[], unitId: number, targetChapterId: number } | { success: false, error: string }>}
 */
export async function unlockChaptersUpTo(targetChapterId) {
  try {
    const target = Number(targetChapterId);

    if (!Number.isInteger(target) || target < 1) {
      return { success: false, error: `Invalid targetChapterId: ${targetChapterId}` };
    }

    // Pre-validate every global chapter in range has vocab
    const unlocked = [];
    for (let ch = 1; ch <= target; ch++) {
      const unit = unitForGlobalChapter(ch);
      const words = getChapterWords(unit, ch) || [];
      if (words.length === 0) {
        return {
          success: false,
          error: `Chapter ${ch} (Unit ${unit}) has no vocab`
        };
      }
      unlocked.push(ch);
    }

    // Seed sequentially so the final call owns isCurrentUnit
    for (let ch = 1; ch < target; ch++) {
      const unit = unitForGlobalChapter(ch);
      await seedChapterWords(unit, ch, UNIT_COMPLETE_THRESHOLD);
    }
    // Target: no floor
    const targetUnit = unitForGlobalChapter(target);
    await seedChapterWords(targetUnit, target);

    return {
      success: true,
      unlocked,
      unitId: targetUnit,
      targetChapterId: target
    };
  } catch (err) {
    console.error('[progression] unlockChaptersUpTo failed:', err);
    return {
      success: false,
      error: err?.message || String(err)
    };
  }
}
