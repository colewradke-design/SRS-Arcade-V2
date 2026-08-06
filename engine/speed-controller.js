import { getState } from '../core/state.js';
/**
 * engine/speed-controller.js
 * Reactive speed math module for main game block fall animation.
 * Dynamically adjusts fall speed based on recent player performance (accuracy + response time).
 * Part of the late 80s/early 90s arcade PWA core game loop.
 */

const BASE_SPEEDS = {
  decoding: 0.15,    // px/ms — target is Korean, choices English
  recognition: 0.18, // px/ms — target is English, choices Korean
  blitz: 0.22        // px/ms — random per block
};

const SPEED_MIN = 0.08;
const SPEED_MAX = 0.55;
const SAMPLE_WINDOW = 10;

// Neutral target answer time (ms). Roughly "half the available fall time"
// at base speeds for a typical mobile game field (~600-700px playable height).
// Used as the 1.0x pivot point for the time-based modifier curve.
const TARGET_ANSWER_TIME = 2500;
// === Reading Speed Presets ===
const READING_SPEED_PRESETS = {
  slow: {
    multiplier: 0.65,
    min: 0.055,
    max: 0.40
  },
  normal: {
    multiplier: 0.80,
    min: 0.070,
    max: 0.48
  },
  fast: {
    multiplier: 1.00,
    min: 0.095,
    max: 0.58
  }
};

let recentAnswers = []; // rolling window: { wasCorrect: boolean, timeToAnswer: number (ms) }
let currentPhase = 'decoding';

/**
 * Internal clamp helper (duplicated from core/utils.js for module independence during early build).
 * TODO: replace with `import { clamp } from '../core/utils.js';` once utils.js is implemented.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * recordAnswer
 * Called after every player interaction (lane tap or timeout) in main-game.js.
 * Maintains a rolling history of the last SAMPLE_WINDOW answers for reactive curve calculation.
 */
export function recordAnswer(wasCorrect, timeToAnswer) {
  recentAnswers.push({
    wasCorrect: Boolean(wasCorrect),
    timeToAnswer: Number(timeToAnswer) || 0
  });

  if (recentAnswers.length > SAMPLE_WINDOW) {
    recentAnswers.shift();
  }
}

/**
 * getAccuracyModifier
 * Maps rolling accuracy (0.0–1.0) to a speed multiplier using the spec-defined curve:
 *   0% accuracy → 0.6x (significant slowdown)
 *   50% accuracy → 1.0x (baseline)
 *   100% accuracy → 1.4x (acceleration)
 * Piecewise linear for predictable arcade feel.
 */
function getAccuracyModifier(accuracy) {
  accuracy = clamp(accuracy, 0, 1);
  if (accuracy <= 0.5) {
    return 0.6 + (accuracy / 0.5) * 0.4; // 0.6 → 1.0
  } else {
    return 1.0 + ((accuracy - 0.5) / 0.5) * 0.4; // 1.0 → 1.4
  }
}

/**
 * getTimeModifier
 * Maps average response time to a speed multiplier.
 * Faster answers (below TARGET_ANSWER_TIME) increase speed (reward skill).
 * Slower answers decrease speed (give player more time).
 * Symmetric ±0.4 range around 1.0x, clamped to [0.6, 1.4].
 * Baseline (1.0x) occurs exactly at TARGET_ANSWER_TIME.
 */
function getTimeModifier(avgTime) {
  avgTime = Math.max(0, avgTime);
  const ideal = TARGET_ANSWER_TIME;

  let modifier;
  if (avgTime <= ideal) {
    // Rapid / good reaction → expand velocity
    const factor = (ideal - avgTime) / ideal;
    modifier = 1.0 + Math.min(factor, 1) * 0.4;
  } else {
    // Slow / struggling → compress velocity
    const factor = (avgTime - ideal) / ideal;
    modifier = 1.0 - Math.min(factor, 1) * 0.4;
  }

  return clamp(modifier, 0.6, 1.4);
}

/**
 * getCurrentSpeed
 * Core reactive function called every animation frame from main-game.js animationLoop.
 * Returns the current px/ms speed for the active phase, adjusted by recent performance.
 * If no history yet (start of phase/session), returns the pure BASE_SPEED for that phase.
 */
export function getCurrentSpeed(phase) {
  const config = getState('sessionConfig') || {};
  const preset = READING_SPEED_PRESETS[config.readingSpeed] || READING_SPEED_PRESETS.normal;

  const baseSpeed = BASE_SPEEDS[phase] || BASE_SPEEDS.decoding;
  const scaledBase = baseSpeed * preset.multiplier;

  if (recentAnswers.length === 0) {
    return clamp(scaledBase, preset.min, preset.max);
  }

  // Rolling accuracy over the window
  const correctCount = recentAnswers.reduce(
    (count, ans) => count + (ans.wasCorrect ? 1 : 0),
    0
  );
  const recentAccuracy = correctCount / recentAnswers.length;

  // Average time to answer (ms)
  const totalTime = recentAnswers.reduce(
    (sum, ans) => sum + ans.timeToAnswer,
    0
  );
  const avgTimeToAnswer = totalTime / recentAnswers.length;

  const accuracyModifier = getAccuracyModifier(recentAccuracy);
  const timeModifier = getTimeModifier(avgTimeToAnswer);

  const combinedModifier = (accuracyModifier + timeModifier) / 2;

  const adjustedSpeed = scaledBase * combinedModifier;

  return clamp(adjustedSpeed, preset.min, preset.max);
}
/**
 * resetSpeed
 * Clears the recent performance history.
 * Called on phase transitions and explicit resets so each phase starts with clean baseline speed.
 */
export function resetSpeed() {
  recentAnswers = [];
}

/**
 * setPhase
 * Updates internal phase tracking and resets speed history.
 * Called by phase-manager.js on every phase transition (Decoding → Recognition → Blitz).
 * Ensures speed curve restarts cleanly for the new phase's base speed.
 */
export function setPhase(phase) {
  if (BASE_SPEEDS[phase]) {
    currentPhase = phase;
  }
  resetSpeed();
}
