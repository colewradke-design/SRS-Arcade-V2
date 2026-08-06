/**
 * vocab/custom-vocab.js
 * Pure helper module for custom vocabulary.
 * Zero side effects. Zero DB access. Zero imports from other modules.
 * Provides stable ID generation and base data shape only.
 */

export function generateCustomId(unit, chapter) {
  // Stable semantic ID for custom words (timestamp ensures uniqueness even within same unit/chapter)
  return `custom_u${Number(unit)}_c${Number(chapter)}_${Date.now()}`;
}

export function createBaseCustomData(native, english, unit, chapter) {
  if (!native || typeof native !== 'string' || native.trim() === '') {
    throw new Error('Native word is required');
  }
  if (!english || typeof english !== 'string' || english.trim() === '') {
    throw new Error('English is required');
  }

  return {
    id: generateCustomId(unit, chapter),
    unit: Number(unit),
    chapter: Number(chapter),
    native: String(native).trim(),
    english: String(english).trim()
  };
}
