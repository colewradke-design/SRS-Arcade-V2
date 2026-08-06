/**
 * engine/srs.js
 * Full FSRS (Free Spaced Repetition Scheduler) Implementation
 *
 * This is a proper FSRS implementation using the standard algorithm.
 * Replaces the old SM-2 system.
 */

// ============================================
// FSRS PARAMETERS (Official defaults)
// ============================================
const FSRS_PARAMS = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  w: [
    0.4, 0.6, 2.4, 5.8,
    4.93, 0.94, 0.86, 0.01,
    1.49, 0.14, 0.94, 2.18,
    0.05, 0.34, 1.26, 0.29, 2.61
  ]
};

// ============================================
// INTERNAL FSRS HELPERS
// ============================================

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function powerForgettingCurve(elapsedDays, stability) {
  return Math.pow(1 + elapsedDays / (9 * stability), -1);
}

function nextInterval(stability, retention = FSRS_PARAMS.requestRetention) {
  const interval = (stability / retention - 1) * 9;
  return Math.max(1, Math.round(interval));
}

// ============================================
// FSRS CORE ALGORITHM
// ============================================

function initStability(rating) {
  const w = FSRS_PARAMS.w;
  if (rating === 4) return Math.max(w[0] + w[1], 0.1);           // Easy
  if (rating === 3) return Math.max(w[2], 0.1);                  // Good
  if (rating === 2) return Math.max(w[3], 0.1);                  // Hard
  return Math.max(w[1], 0.1);                                    // Again
}

function initDifficulty(rating) {
  const w = FSRS_PARAMS.w;
  return clamp(w[4] - (rating - 3) * w[5], 1, 10);
}

function nextDifficulty(difficulty, rating) {
  const w = FSRS_PARAMS.w;
  const delta = -w[6] * (rating - 3);
  return clamp(difficulty + delta, 1, 10);
}

function nextStability(stability, retrievability, rating, difficulty) {
  const w = FSRS_PARAMS.w;

  if (rating === 1) {
    // Again (Miss)
    return Math.max(
      w[7] * Math.pow(difficulty, -w[8]) * Math.pow(stability + 1, w[9]) * Math.exp(w[10] * (1 - retrievability)),
      0.1
    );
  }

  // Hard / Good / Easy
  let multiplier = 1;
  if (rating === 2) multiplier = w[11];
  if (rating === 3) multiplier = w[12];
  if (rating === 4) multiplier = w[13];

  return stability * (1 + Math.exp(w[14]) * multiplier - 1) * 
         Math.pow(difficulty, -w[15]) * 
         Math.pow(stability + 1, w[16]);
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Create initial FSRS state for a new card
 */
export function createNewCard(rating = 'moderate') {
  const now = Date.now();
  const r = { miss: 1, hard: 2, moderate: 3, easy: 4 }[rating] || 3;

  const stability = initStability(r);
  const difficulty = initDifficulty(r);
  const interval = nextInterval(stability);

  return {
    fsrsStability: parseFloat(stability.toFixed(2)),
    fsrsDifficulty: parseFloat(difficulty.toFixed(2)),
    fsrsLastReview: now,
    fsrsReviewCount: 1,
    fsrsNextReviewAt: now + (interval * 86400000),
  };
}

/**
 * Process a review and return updated FSRS state
 */
export function reviewCard(currentCard, rating, elapsedDays = null) {
  const now = Date.now();
  const lastReview = currentCard.fsrsLastReview || now;
  const daysSinceLast = elapsedDays ?? Math.max(0, (now - lastReview) / 86400000);

  let stability = currentCard.fsrsStability ?? 2.5;
  let difficulty = currentCard.fsrsDifficulty ?? 5.0;
  let reviewCount = (currentCard.fsrsReviewCount || 0) + 1;

  const retrievability = powerForgettingCurve(daysSinceLast, stability);
  const r = { miss: 1, hard: 2, moderate: 3, easy: 4 }[rating] || 3;

  // Update difficulty
  const newDifficulty = nextDifficulty(difficulty, r);

  // Update stability
  const newStability = nextStability(stability, retrievability, r, newDifficulty);

  // Calculate next interval
  let interval = nextInterval(newStability);
  interval = clamp(interval, 1, FSRS_PARAMS.maximumInterval);

  const nextReviewAt = now + (interval * 86400000);

  return {
    fsrsStability: parseFloat(newStability.toFixed(2)),
    fsrsDifficulty: parseFloat(newDifficulty.toFixed(2)),
    fsrsLastReview: now,
    fsrsReviewCount: reviewCount,
    fsrsNextReviewAt: nextReviewAt,
  };
}

/**
 * Derive Leitner Group from FSRS values (used by main game)
 */
export function getLeitnerGroup(stability = 1, difficulty = 5) {
  const strength = (stability / difficulty) * 12;

  if (strength < 2.2) return 1;
  if (strength < 5.0) return 2;
  if (strength < 9.0) return 3;
  if (strength < 14.0) return 4;
  return 5;
}

/**
 * Get all due cards
 */
export function getDueCards(cards, now = Date.now()) {
  if (!Array.isArray(cards)) return [];
  return cards
    .filter(c => c.fsrsNextReviewAt && c.fsrsNextReviewAt <= now)
    .sort((a, b) => a.fsrsNextReviewAt - b.fsrsNextReviewAt);
}

/**
 * Check if a card is due
 */
export function isCardDue(card, now = Date.now()) {
  return card && card.fsrsNextReviewAt && card.fsrsNextReviewAt <= now;
}
export function getDueCount(cards, now = Date.now()) {
  return getDueCards(cards, now).length;
}

