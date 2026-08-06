/**
 * core/utils.js
 * Core calculation engine utilities.
 * All functions are written defensively — invalid or edge-case inputs
 * return safe fallback values instead of throwing runtime exceptions.
 */

// ---------------------------------------------------------------------------
// formatTime(seconds)
// Converts an integer number of seconds to a "MM:SS" string.
// ---------------------------------------------------------------------------

/**
 * @param {number} seconds - Total seconds (integer). Negative values are
 *   clamped to 0. Non-finite or non-numeric inputs fall back to "00:00".
 * @returns {string} Zero-padded "MM:SS" string, e.g. 75 → "01:15".
 */
export function formatTime(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) {
    return "00:00";
  }

  const total = Math.max(0, Math.floor(Number(seconds)));
  const mm = Math.floor(total / 60);
  const ss = total % 60;

  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// shuffle(array)
// Returns a new array with elements in a random order (Fisher-Yates).
// The original array is never mutated.
// ---------------------------------------------------------------------------

/**
 * @param {Array} array - Source array. Non-arrays or empty arrays return [].
 * @returns {Array} A new shuffled array.
 */
export function shuffle(array) {
  if (!Array.isArray(array) || array.length === 0) {
    return [];
  }

  const copy = [...array];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

// ---------------------------------------------------------------------------
// clamp(value, min, max)
// Constrains a number to the closed interval [min, max].
// ---------------------------------------------------------------------------

/**
 * @param {number} value - The number to clamp.
 * @param {number} min   - Lower bound (inclusive).
 * @param {number} max   - Upper bound (inclusive).
 * @returns {number} The clamped value.
 *   - Non-numeric inputs return 0.
 *   - If min > max the arguments are silently swapped.
 */
export function clamp(value, min, max) {
  const v   = Number(value);
  let   lo  = Number(min);
  let   hi  = Number(max);

  if (!Number.isFinite(v))  return 0;
  if (!Number.isFinite(lo)) lo = -Infinity;
  if (!Number.isFinite(hi)) hi =  Infinity;

  // Swap silently so callers can't accidentally invert the range.
  if (lo > hi) [lo, hi] = [hi, lo];

  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// weightedRandom(items, weights)
// Picks one item from `items` according to relative weights.
// ---------------------------------------------------------------------------

/**
 * @param {Array}    items   - Pool of items to select from.
 * @param {number[]} weights - Parallel array of non-negative weights.
 *   Weights do not need to sum to 1; they are normalised internally.
 * @returns {*} A randomly selected item, or null if inputs are invalid /
 *   empty / all weights are zero.
 *
 * Defensive rules
 *   - Mismatched array lengths: use the shorter length.
 *   - Negative weights are treated as 0.
 *   - Non-numeric weights are treated as 0.
 *   - If the total weight is 0, falls back to a uniform random pick.
 */
export function weightedRandom(items, weights) {
  if (!Array.isArray(items)   || items.length   === 0) return null;
  if (!Array.isArray(weights) || weights.length === 0) {
    // No weights supplied — uniform fallback.
    return items[Math.floor(Math.random() * items.length)];
  }

  const len = Math.min(items.length, weights.length);

  // Sanitise: coerce to non-negative finite numbers.
  const safeWeights = Array.from({ length: len }, (_, i) => {
    const w = Number(weights[i]);
    return Number.isFinite(w) && w > 0 ? w : 0;
  });

  const total = safeWeights.reduce((sum, w) => sum + w, 0);

  if (total === 0) {
    // All weights are zero — fall back to uniform selection over len items.
    return items[Math.floor(Math.random() * len)];
  }

  let threshold = Math.random() * total;

  for (let i = 0; i < len; i++) {
    threshold -= safeWeights[i];
    if (threshold <= 0) return items[i];
  }

  // Floating-point edge case: return the last eligible item.
  return items[len - 1];
}

// ---------------------------------------------------------------------------
// calculateAccuracyPercent(correct, total)
// Converts a correct/total count pair into a whole-number percentage.
// ---------------------------------------------------------------------------

/**
 * @param {number} correct - Number of correct answers (≥ 0).
 * @param {number} total   - Total number of attempts (≥ 0).
 * @returns {number} Integer percentage in [0, 100].
 *   - Returns 0 when total is 0 (avoids division-by-zero).
 *   - Clamps the result to [0, 100] even if inputs are inconsistent.
 *   - Non-numeric inputs are coerced; non-finite inputs return 0.
 */
export function calculateAccuracyPercent(correct, total) {
  const c = Number(correct);
  const t = Number(total);

  if (!Number.isFinite(c) || !Number.isFinite(t) || t <= 0) return 0;

  const raw = (c / t) * 100;

  return clamp(Math.round(raw), 0, 100);
}
/**
 * Detects the primary script/language of a string.
 * Currently supports Korean (Hangul). Designed to be easily extended
 * for Japanese, Chinese, etc. in the future.
 *
 * @param {string} text
 * @returns {'ko' | 'en'} Language tag
 */
/**
 * Detects the primary script/language of a string.
 * Returns a BCP-47 style code we can use for styling.
 * Extend this list as we add languages.
 */
export function detectTextLanguage(text) {
  if (!text || typeof text !== 'string' || text.trim() === '') {
    return 'en';
  }

  const t = text.trim();

  // Korean Hangul
  if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(t)) {
    return 'ko';
  }

  // Arabic script (Arabic, Farsi, Urdu, etc.)
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(t)) {
    return 'ar'; // we can refine to 'fa' later if needed
  }

  // Cyrillic (Russian, etc.)
  if (/[\u0400-\u04FF\u0500-\u052F]/.test(t)) {
    return 'ru';
  }

  // Latin script (English, German, Spanish, etc.)
  if (/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(t)) {
    return 'en'; // treat German the same as English for sizing
  }

  return 'en';
}
// ---------------------------------------------------------------------------
// debounce(fn, delay)
// Returns a debounced wrapper that delays invoking `fn` until after `delay`
// milliseconds have elapsed since the last call.
// ---------------------------------------------------------------------------

/**
 * @param {Function} fn    - The function to debounce.
 * @param {number}   delay - Milliseconds to wait (default 0). Negative
 *   values and non-numeric inputs are normalised to 0.
 * @returns {Function} The debounced function.
 *   The returned function exposes a `.cancel()` method to clear any
 *   pending invocation.
 *
 * Defensive rules
 *   - If `fn` is not a function, returns a no-op with a `.cancel()` stub.
 *   - `delay` is clamped to [0, Infinity].
 */
export function debounce(fn, delay) {
  if (typeof fn !== "function") {
    const noop = () => {};
    noop.cancel = () => {};
    return noop;
  }

  const wait = Number.isFinite(Number(delay)) ? Math.max(0, Number(delay)) : 0;
  let timer = null;

  function debounced(...args) {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  }

  debounced.cancel = function () {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}
