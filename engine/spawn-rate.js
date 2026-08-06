/**
 * engine/spawn-rate.js
 * 
 * Calculates spawn rate for the main game.
 * Now uses FSRS-derived Leitner groups instead of stored leitnerGroup.
 */

import { getLeitnerGroup } from './srs.js';
import { getDecayedModifier } from './word-streak.js';

// Base spawn rates keyed by Leitner group (weaker groups = higher chance)
export const BASE_RATES = {
  1: 1.00,   // weakest — most frequent
  2: 0.75,
  3: 0.50,
  4: 0.30,
  5: 0.15    // strongest — least frequent
};

const FLOOR = 0.10;
const CEILING = 1.25;

/**
 * Calculates the final spawn rate for a word in the main game.
 * Uses FSRS values to derive the Leitner group.
 */
export function getSpawnRate(word) {
  if (!word || typeof word !== 'object') {
    console.warn('[spawn-rate] getSpawnRate called with invalid word');
    return FLOOR;
  }

  // Derive Leitner group from FSRS values instead of stored field
  const leitnerGroup = getLeitnerGroup(word.fsrsStability, word.fsrsDifficulty);
  const baseRate = BASE_RATES[leitnerGroup] ?? BASE_RATES[1];

  // Get the current effective streak modifier (from main game)
  const decayedStreakModifier = getDecayedModifier(word);

  // Due-now boost from flashcard system
  const isDueNow = word.fsrsNextReviewAt && word.fsrsNextReviewAt <= Date.now();
  const dueNowBoost = isDueNow ? 0.25 : 0;

  // Combine everything
  let finalRate = (baseRate * decayedStreakModifier) + dueNowBoost;

  // Hard clamp
  if (finalRate < FLOOR) finalRate = FLOOR;
  if (finalRate > CEILING) finalRate = CEILING;

  return finalRate;
}
