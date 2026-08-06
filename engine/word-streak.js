/**
 * engine/word-streak.js
 *
 * Per-word persistent streak system with SRS-interval-tied decay.
 * NEW FILE per Master Handoff Document.
 *
 * This module is owned by the Main Game system.
 * It writes ONLY: wordStreak, wordStreakModifier, wordStreakLastUpdated
 *
 * The Flashcard SRS system never touches these fields.
 *
 * Streak modifier table (applied only when streak >= 3):
 *   0-2   → 1.00   (threshold not reached)
 *   3-4   → 0.75
 *   5-6   → 0.55
 *   7-9   → 0.35
 *  10+    → 0.20
 */

// Milliseconds in one day
const MS_PER_DAY = 86400000;

/**
 * Internal helper: returns the spawn rate modifier for a given streak length.
 * Only streaks of 3+ have an effect.
 */
function getModifierForStreak(streak) {
  const s = Math.max(0, Math.floor(Number(streak) || 0));

  if (s < 3)  return 1.00;
  if (s <= 4) return 0.75;
  if (s <= 6) return 0.55;
  if (s <= 9) return 0.35;
  return 0.20;
}

/**
 * Called after a correct answer in the main game.
 * Increments the streak and recalculates the modifier if threshold is crossed.
 *
 * @param {Object} word - Full word record (must contain wordStreak, wordStreakModifier, etc.)
 * @returns {Object} Updated fields to be written by word-store.js:
 *   { wordStreak, wordStreakModifier, wordStreakLastUpdated }
 */
export function recordWordCorrect(word) {
  if (!word || typeof word !== 'object') {
    console.warn('[word-streak] recordWordCorrect called with invalid word');
    return { wordStreak: 0, wordStreakModifier: 1.0, wordStreakLastUpdated: Date.now() };
  }

  let currentStreak = Number(word.wordStreak) || 0;
  const newStreak = currentStreak + 1;

  let newModifier = getModifierForStreak(newStreak);

  // If we just crossed the threshold (from <3 to >=3), or already above it, update modifier
  if (newStreak >= 3) {
    newModifier = getModifierForStreak(newStreak);
  } else {
    newModifier = 1.0;
  }

  return {
    wordStreak: newStreak,
    wordStreakModifier: newModifier,
    wordStreakLastUpdated: Date.now()
  };
}

/**
 * Called after an incorrect answer in the main game.
 * Only resets if the streak was already at or above the meaningful threshold (3+).
 *
 * @param {Object} word
 * @returns {Object} Updated fields:
 *   { wordStreak, wordStreakModifier, wordStreakLastUpdated }
 */
export function recordWordWrong(word) {
  if (!word || typeof word !== 'object') {
    console.warn('[word-streak] recordWordWrong called with invalid word');
    return { wordStreak: 0, wordStreakModifier: 1.0, wordStreakLastUpdated: Date.now() };
  }

  const currentStreak = Number(word.wordStreak) || 0;

  if (currentStreak >= 3) {
    // Meaningful streak broken → reset to 1 (so next correct starts building again)
    return {
      wordStreak: 1,
      wordStreakModifier: 1.0,
      wordStreakLastUpdated: Date.now()
    };
  }

  // Streak was already below threshold — no change needed
  return {
    wordStreak: currentStreak,
    wordStreakModifier: Number(word.wordStreakModifier) || 1.0,
    wordStreakLastUpdated: word.wordStreakLastUpdated || Date.now()
  };
}

/**
 * Calculates the current effective spawn rate modifier after time-based decay.
 *
 * Decay window = the word's current srsInterval (in days).
 * The longer the SRS interval, the slower the streak bonus decays.
 *
 * If the live session streak ever surpasses the decayed stored value,
 * the stored streak is considered "reset" to the higher value (handled by caller logic
 * when combining with recordWordCorrect).
 *
 * @param {Object} word - Must contain: wordStreak, wordStreakModifier, wordStreakLastUpdated, srsInterval
 * @returns {number} Effective modifier in [0.20, 1.0]
 */
export function getDecayedModifier(word) {
  if (!word || typeof word !== 'object') {
    return 1.0;
  }

  const lastUpdated = Number(word.wordStreakLastUpdated);
  if (!lastUpdated) {
    return 1.0; // Never had a meaningful streak
  }

  const currentStreak = Number(word.wordStreak) || 0;
  if (currentStreak < 3) {
    return 1.0;
  }

  const storedModifier = Number(word.wordStreakModifier) || 1.0;
  if (storedModifier >= 1.0) {
    return 1.0;
  }

  const srsIntervalDays = Math.max(1, Number(word.srsInterval) || 1);
  const daysSinceUpdate = (Date.now() - lastUpdated) / MS_PER_DAY;

  // How far through the decay window we are (0 = fresh, 1 = fully decayed)
  const decayProgress = Math.min(Math.max(daysSinceUpdate / srsIntervalDays, 0), 1);

  // Linear interpolation between the stored modifier and 1.0
  const effectiveModifier = 1.0 + (storedModifier - 1.0) * (1 - decayProgress);

  return Math.max(0.20, Math.min(1.0, effectiveModifier));
}
