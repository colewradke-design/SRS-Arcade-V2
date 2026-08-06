/**
 * core/state.js
 * Master state management module for the Korean Vocabulary PWA.
 *
 * Design contracts:
 *  - appState is never directly exported. All reads/writes go through the
 *    public API so callers cannot hold a mutable reference to the root object.
 *  - setState supports both top-level keys and dot-notation deep keys.
 *    Writing a sub-key (e.g. 'sessionConfig.deckType') performs a shallow merge
 *    on the parent object, so sibling sub-keys are never wiped.
 *  - resetSessionState() resets ONLY activeSession back to initial defaults,
 *    leaving theme, sessionConfig, and pendingFlashcardWords untouched.
 *  - All exported hook objects are frozen so callers cannot mutate them.
 */
 
// ---------------------------------------------------------------------------
// 1. Shape constants — single source of truth for initial values
// ---------------------------------------------------------------------------
 
/** @returns {object} A fresh sessionConfig default */
const makeDefaultSessionConfig = () => ({
  deckType: 'master',
  selectedUnits: [],
  sessionLength: 30,
  readingSpeed: 'normal',   // 'slow' | 'normal' | 'fast'
});
 
/** @returns {object} A fresh activeSession default */
const makeDefaultActiveSession = () => ({
  phase: 'decoding',            // 'decoding' | 'recognition' | 'blitz'
  timeRemaining: 0,             // seconds remaining in current session
  streak: 0,                    // consecutive correct answers this session
  bestStreak: 0,                // highest streak reached this session
  blocksAnswered: 0,            // total blocks answered (correct + incorrect)
  correctAnswers: 0,            // total correct answers this session
  uniqueWordsEncountered: [],   // array of word ids seen at least once
});
 
// ---------------------------------------------------------------------------
// 2. Master appState object — private, never exported directly
// ---------------------------------------------------------------------------
 
const appState = {
  theme: 'theme-arcade',
  sessionConfig: makeDefaultSessionConfig(),
  activeSession: makeDefaultActiveSession(),
  pendingFlashcardWords: [],
  pendingDueNowToast: null,
  spellingConfig: {
    mode: 'practice',
    deckType: 'master',
    selectedUnits: [],
    wordCount: 10,
    difficulty: 'guided',
    continuePuzzle: false
  },
};
 
// ---------------------------------------------------------------------------
// 3. Internal helpers
// ---------------------------------------------------------------------------
 
/**
 * Resolve a dot-notation key path into { parent, leafKey }.
 * Supports exactly one level of nesting (e.g. 'sessionConfig.deckType').
 * Top-level keys (no dot) return { parent: appState, leafKey: key }.
 *
 * Throws a TypeError for unknown keys to catch typos at call sites.
 *
 * @param {string} key
 * @returns {{ parent: object, leafKey: string }}
 */
function resolvePath(key) {
  const TOP_LEVEL_KEYS = Object.keys(appState);
 
  if (!key.includes('.')) {
    if (!TOP_LEVEL_KEYS.includes(key)) {
      throw new TypeError(`state: unknown top-level key "${key}"`);
    }
    return { parent: appState, leafKey: key };
  }
 
  const [parentKey, leafKey] = key.split('.');
 
  if (!TOP_LEVEL_KEYS.includes(parentKey)) {
    throw new TypeError(`state: unknown parent key "${parentKey}" in path "${key}"`);
  }
 
  const parentValue = appState[parentKey];
 
  if (typeof parentValue !== 'object' || parentValue === null) {
    throw new TypeError(
      `state: parent key "${parentKey}" does not hold an object — cannot set sub-key "${leafKey}"`
    );
  }
 
  return { parent: parentValue, leafKey };
}
 
/**
 * Deep-clone a value so callers cannot mutate internal state through
 * a reference returned by getState().
 *
 * Uses structured clone where available, falls back to JSON round-trip.
 * Primitive values are returned as-is.
 *
 * @param {*} value
 * @returns {*}
 */
function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
 
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
 
  // JSON round-trip fallback (safe for the data shapes used here)
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    // Last resort: return a shallow copy
    return Array.isArray(value) ? [...value] : { ...value };
  }
}
 
// ---------------------------------------------------------------------------
// 4. Core API
// ---------------------------------------------------------------------------
 
/**
 * Read a value from appState.
 *
 * Supports both top-level keys ('theme', 'sessionConfig') and dot-notation
 * sub-keys ('sessionConfig.deckType', 'activeSession.streak').
 *
 * Always returns a deep clone so callers cannot accidentally mutate state.
 *
 * @param {string} key
 * @returns {*}
 */
function getState(key) {
  const { parent, leafKey } = resolvePath(key);
  return deepClone(parent[leafKey]);
}
 
/**
 * Write a value to appState.
 *
 * Top-level object keys (sessionConfig, activeSession) are shallow-merged
 * when the incoming value is a plain object, preserving sibling sub-keys:
 *
 *   setState('sessionConfig', { deckType: 'unit' })
 *   // → only deckType changes; selectedUnits and sessionLength are untouched
 *
 * Dot-notation sub-key writes set exactly one leaf:
 *
 *   setState('sessionConfig.deckType', 'unit')
 *   // → identical result as above, just more explicit
 *
 * Primitive top-level values (theme, pendingFlashcardWords as a full array
 * replacement) are overwritten entirely.
 *
 * @param {string} key    - Top-level or dot-notation path
 * @param {*}      value  - New value (object for merge, primitive for overwrite)
 */
function setState(key, value) {
  const { parent, leafKey } = resolvePath(key);
  const current = parent[leafKey];
 
  const isPlainObject = (v) =>
    v !== null && typeof v === 'object' && !Array.isArray(v);
 
  if (isPlainObject(current) && isPlainObject(value)) {
    // Shallow merge — preserves sibling sub-keys inside the parent object
    parent[leafKey] = { ...current, ...value };
  } else {
    // Primitive, array, or full replacement
    parent[leafKey] = deepClone(value);
  }
}
 
/**
 * Reset activeSession back to its initial defaults without touching any
 * other part of appState (theme, sessionConfig, pendingFlashcardWords).
 *
 * Call this at the start of each new game session or when navigating back
 * to the main menu after a completed session.
 */
function resetSessionState() {
  appState.activeSession = makeDefaultActiveSession();
}
 
// ---------------------------------------------------------------------------
// 5. Scoped, immutable hook objects
//    Consumers import only the hooks they need; none can reach the raw
//    appState object through these references.
// ---------------------------------------------------------------------------
 
/** Read/write hooks scoped to theme */
export const themeState = Object.freeze({
  get: ()          => getState('theme'),
  set: (value)     => setState('theme', value),
});
 
/** Read/write hooks scoped to sessionConfig */
export const sessionConfigState = Object.freeze({
  get:         ()      => getState('sessionConfig'),
  getDeckType: ()      => getState('sessionConfig.deckType'),
  getUnits:    ()      => getState('sessionConfig.selectedUnits'),
  getLength:   ()      => getState('sessionConfig.sessionLength'),
  set:         (patch) => setState('sessionConfig', patch),
  setDeckType: (v)     => setState('sessionConfig.deckType', v),
  setUnits:    (v)     => setState('sessionConfig.selectedUnits', v),
  setLength:   (v)     => setState('sessionConfig.sessionLength', v),
});
 
/** Read/write hooks scoped to activeSession */
export const activeSessionState = Object.freeze({
  get:                     ()  => getState('activeSession'),
  getPhase:                ()  => getState('activeSession.phase'),
  getTimeRemaining:        ()  => getState('activeSession.timeRemaining'),
  getStreak:               ()  => getState('activeSession.streak'),
  getBestStreak:           ()  => getState('activeSession.bestStreak'),
  getBlocksAnswered:       ()  => getState('activeSession.blocksAnswered'),
  getCorrectAnswers:       ()  => getState('activeSession.correctAnswers'),
  getUniqueWordsEncountered: () => getState('activeSession.uniqueWordsEncountered'),
  set:                     (patch) => setState('activeSession', patch),
  setPhase:                (v) => setState('activeSession.phase', v),
  setTimeRemaining:        (v) => setState('activeSession.timeRemaining', v),
  setStreak:               (v) => setState('activeSession.streak', v),
  setBestStreak:           (v) => setState('activeSession.bestStreak', v),
  setBlocksAnswered:       (v) => setState('activeSession.blocksAnswered', v),
  setCorrectAnswers:       (v) => setState('activeSession.correctAnswers', v),
  setUniqueWordsEncountered: (v) => setState('activeSession.uniqueWordsEncountered', v),
  reset:                   ()  => resetSessionState(),
});
 
/** Read/write hooks scoped to pendingFlashcardWords */
export const flashcardCacheState = Object.freeze({
  get:   ()      => getState('pendingFlashcardWords'),
  set:   (words) => setState('pendingFlashcardWords', words),
  clear: ()      => setState('pendingFlashcardWords', []),
});
 
// ---------------------------------------------------------------------------
// 6. General-purpose exports
//    Use these when you need cross-cutting access without importing a scoped
//    hook (e.g. in engine files that read multiple top-level keys).
// ---------------------------------------------------------------------------
 
export { getState, setState, resetSessionState };
 
