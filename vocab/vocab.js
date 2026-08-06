// vocab/vocab.js
// Language-aware vocabulary loader. masterDeck is mutated in place (never reassigned).

const CHAPTER_LOADERS = {
  ko: Array.from({ length: 56 }, (_, i) => () => import(`./ko/chapter${i + 1}.js`)),
  de: Array.from({ length: 24 }, (_, i) => () => import(`./de/chapter${i + 1}.js`)),
  // Future: ru: [ () => import('./ru/chapter1.js'), ... ]
};

/** @type {Array} live-bound — mutate in place, never reassign */
export let masterDeck = [];

let currentLanguage = null;
let initPromise = null;

/**
 * Initialize (or switch) the vocabulary for the given language.
 * Defaults to Korean for legacy users / unknown codes.
 * Safe to call multiple times for the same language (returns same promise).
 */
export async function initVocab(lang) {
  const resolvedLang = CHAPTER_LOADERS[lang] ? lang : 'ko';
  if (initPromise && currentLanguage === resolvedLang) return initPromise;

  currentLanguage = resolvedLang;
  initPromise = (async () => {
    const loaders = CHAPTER_LOADERS[resolvedLang];
    const modules = await Promise.all(loaders.map(fn => fn()));
    // Each module exports `chapterN`
    const combined = modules.flatMap((mod, idx) => {
      const key = `chapter${idx + 1}`;
      return mod[key] || [];
    });
    masterDeck.length = 0;
    masterDeck.push(...combined);
  })();

  return initPromise;
}

export function getCurrentLanguage() {
  return currentLanguage;
}

// ====================== HELPER FUNCTIONS (unchanged contract) ======================

/**
 * Get a word by its unique ID.
 * Returns null + logs a warning if not found.
 */
export function getWordById(id) {
  if (!id) {
    console.warn('[vocab] getWordById called with falsy id');
    return null;
  }
  const word = masterDeck.find(w => w.id === id);
  if (!word) {
    console.warn(`[vocab] Word not found for id: ${id}`);
  }
  return word || null;
}

/**
 * Get all words belonging to a specific unit.
 */
export function getUnitWords(unitNumber) {
  const unit = Number(unitNumber);
  if (!Number.isInteger(unit) || unit < 1) {
    console.warn(`[vocab] Invalid unit number: ${unitNumber}`);
    return [];
  }
  return masterDeck.filter(w => w.unit === unit);
}

/**
 * Get all words from a specific chapter within a unit.
 */
export function getChapterWords(unitNumber, chapterNumber) {
  const unit = Number(unitNumber);
  const chapter = Number(chapterNumber);

  if (!Number.isInteger(unit) || unit < 1) {
    console.warn(`[vocab] Invalid unit number: ${unitNumber}`);
    return [];
  }
  if (!Number.isInteger(chapter) || chapter < 1) {
    console.warn(`[vocab] Invalid chapter number: ${chapterNumber}`);
    return [];
  }

  return masterDeck.filter(w => w.unit === unit && w.chapter === chapter);
}

/**
 * Returns the total number of words in the master deck.
 */
export function getTotalWordCount() {
  return masterDeck.length;
}

/**
 * Check if a word ID exists in the deck.
 */
export function wordExists(id) {
  return masterDeck.some(w => w.id === id);
}

/**
 * Get all unique units that have words.
 */
export function getAvailableUnits() {
  const units = new Set(masterDeck.map(w => w.unit));
  return Array.from(units).sort((a, b) => a - b);
}
