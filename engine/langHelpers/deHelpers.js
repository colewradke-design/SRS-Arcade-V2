/**
 * engine/langHelpers/deHelpers.js
 * German (Latin + umlaut) specific helpers for word search filler generation
 * and native text cleaning.
 *
 * All language-specific logic for DE lives here.
 * Consumers must go through engine/langHelpers/index.js only.
 */

const FALLBACK_LETTERS = 'abcdefghijklmnopqrstuvwxyzäöüßABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ';

/**
 * Build observed letter pool from a list of words.
 * Expects word.native (or falls back to basic German alphabet).
 */
export function buildObservedComponentPools(allWords) {
  const observed = new Set();

  if (!Array.isArray(allWords) || allWords.length === 0) {
    for (const ch of FALLBACK_LETTERS) observed.add(ch);
    return { letters: Array.from(observed) };
  }

  for (const word of allWords) {
    const text = (word && (word.native || word.cleanNative)) || '';
    if (typeof text !== 'string') continue;
    for (const ch of Array.from(text.trim())) {
      // Keep letters (including German umlauts and ß)
      if (/\p{L}/u.test(ch)) {
        observed.add(ch);
      }
    }
  }

  if (observed.size === 0) {
    for (const ch of FALLBACK_LETTERS) observed.add(ch);
  }

  return { letters: Array.from(observed) };
}

/**
 * Generate a single filler character from observed letters.
 * (Named generateFillerSyllable for API parity with koHelpers.)
 */
export function generateFillerSyllable(pools, avoidChar = null) {
  const letters = (pools && pools.letters) || [];
  if (letters.length === 0) return 'a';

  let attempts = 0;
  let ch;
  do {
    ch = letters[Math.floor(Math.random() * letters.length)];
    attempts++;
  } while (ch === avoidChar && attempts < 8);

  return ch;
}

/**
 * German cleaning: light trim + remove parenthetical notes + collapse spaces.
 * German vocab does not use the Korean-style / alternates or tone markers.
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

  // Remove parenthetical notes if present
  h = h.replace(/\s*\([^)]*\)\s*/g, '').trim();

  // Collapse multiple spaces
  h = h.replace(/\s+/g, ' ').trim();

  return h;
}
