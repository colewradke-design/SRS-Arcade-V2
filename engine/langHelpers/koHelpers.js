/**
 * engine/langHelpers/koHelpers.js
 * Korean (Hangul) specific helpers for word search filler generation
 * and native text cleaning.
 *
 * All language-specific logic for KO lives here.
 * Consumers must go through engine/langHelpers/index.js only.
 */

const SYLLABLE_BASE = 0xAC00;
const INITIAL_COUNT = 19;
const MEDIAL_COUNT = 21;
const FINAL_COUNT = 27;

const CLUSTER_FINAL_INDICES = new Set([2, 4, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20]);

function composeSyllable(initialIndex, medialIndex, finalIndex) {
  const codePoint = SYLLABLE_BASE
    + (initialIndex * MEDIAL_COUNT * FINAL_COUNT)
    + (medialIndex * FINAL_COUNT)
    + finalIndex;
  return String.fromCodePoint(codePoint);
}

function decomposeSyllable(char) {
  if (!char) return null;
  const codePoint = char.codePointAt(0);
  if (codePoint < 0xAC00 || codePoint > 0xD7A3) return null;

  const offset = codePoint - SYLLABLE_BASE;
  const finalIndex = offset % FINAL_COUNT;
  const medialIndex = Math.floor(offset / FINAL_COUNT) % MEDIAL_COUNT;
  const initialIndex = Math.floor(offset / (FINAL_COUNT * MEDIAL_COUNT));
  return { initialIndex, medialIndex, finalIndex };
}

/**
 * Build observed jamo component pools from a list of words.
 * Expects word.native (or falls back to empty).
 */
export function buildObservedComponentPools(allWords) {
  const observedInitials = new Set();
  const observedMedials = new Set();
  const observedCommonFinals = new Set();
  const observedClusterFinals = new Set();

  if (!Array.isArray(allWords) || allWords.length === 0) {
    for (let i = 0; i < INITIAL_COUNT; i++) observedInitials.add(i);
    for (let i = 0; i < MEDIAL_COUNT; i++) observedMedials.add(i);
    for (let i = 0; i < FINAL_COUNT; i++) {
      if (CLUSTER_FINAL_INDICES.has(i)) observedClusterFinals.add(i);
      else observedCommonFinals.add(i);
    }
    return {
      observedInitials: Array.from(observedInitials),
      observedMedials: Array.from(observedMedials),
      observedCommonFinals: Array.from(observedCommonFinals),
      observedClusterFinals: Array.from(observedClusterFinals)
    };
  }

  for (const word of allWords) {
    const text = (word && (word.native || word.cleanNative)) || '';
    if (typeof text !== 'string') continue;
    const chars = Array.from(text.trim());
    for (const char of chars) {
      const parts = decomposeSyllable(char);
      if (!parts) continue;
      observedInitials.add(parts.initialIndex);
      observedMedials.add(parts.medialIndex);
      if (parts.finalIndex === 0) observedCommonFinals.add(0);
      else if (CLUSTER_FINAL_INDICES.has(parts.finalIndex)) observedClusterFinals.add(parts.finalIndex);
      else observedCommonFinals.add(parts.finalIndex);
    }
  }

  return {
    observedInitials: Array.from(observedInitials),
    observedMedials: Array.from(observedMedials),
    observedCommonFinals: Array.from(observedCommonFinals),
    observedClusterFinals: Array.from(observedClusterFinals)
  };
}

/**
 * Generate a single filler Hangul syllable from observed pools.
 */
export function generateFillerSyllable(pools, avoidChar = null) {
  const { observedInitials, observedMedials, observedCommonFinals, observedClusterFinals } = pools;
  if (!observedInitials || observedInitials.length === 0 || !observedMedials || observedMedials.length === 0) {
    return '가';
  }

  let attempts = 0;
  let syllable;
  do {
    let initialIndex = observedInitials[Math.floor(Math.random() * observedInitials.length)];
    let medialIndex = observedMedials[Math.floor(Math.random() * observedMedials.length)];
    let finalIndex;

    initialIndex = Math.max(0, Math.min(initialIndex, INITIAL_COUNT - 1));
    medialIndex = Math.max(0, Math.min(medialIndex, MEDIAL_COUNT - 1));

    const useCluster = observedClusterFinals && observedClusterFinals.length > 0 && Math.random() < 0.12;
    if (useCluster && observedClusterFinals.length > 0) {
      finalIndex = observedClusterFinals[Math.floor(Math.random() * observedClusterFinals.length)];
    } else if (observedCommonFinals && observedCommonFinals.length > 0) {
      finalIndex = observedCommonFinals[Math.floor(Math.random() * observedCommonFinals.length)];
    } else {
      finalIndex = 0;
    }
    finalIndex = Math.max(0, Math.min(finalIndex, FINAL_COUNT - 1));

    syllable = composeSyllable(initialIndex, medialIndex, finalIndex);
    attempts++;
  } while (syllable === avoidChar && attempts < 8);

  return syllable;
}

/**
 * Korean-specific cleaning rules (alternates, tone markers, grammar notes).
 * Moved from the previous getCleanNative implementation.
 */
export function cleanText(input) {
  let h = '';
  if (typeof input === 'string') {
    h = input;
  } else if (input && typeof input.native === 'string') {
    h = input.native;
  }

  if (!h) return '';

  h = h.trim();

  // Take only the part before the first '/'
  if (h.includes('/')) {
    h = h.split('/')[0].trim();
  }

  // Shorten long alternative labels
  h = h.replace(/\s*\((alternative|alt form|alternative form|alt)\)\s*/gi, ' (Alt)');

  // Remove any other parenthetical notes (↑), (↓), grammar notes, etc.
  h = h.replace(/\s*\([^)]*\)\s*/g, '').trim();

  // Remove leading grammar markers (~ or –)
  h = h.replace(/^[~–]\s*/, '').trim();

  // Collapse multiple spaces
  h = h.replace(/\s+/g, ' ').trim();

  return h;
}
