/**
 * engine/langHelpers/index.js
 * Single dispatcher for language-specific helpers.
 *
 * The rest of the app must NEVER import koHelpers.js or deHelpers.js directly.
 * Always go through getLangHelpers().
 *
 * Adding a new language later = one new *Helpers.js + one line in LANG_HELPERS.
 */

import { getCurrentLanguage } from '../../vocab/vocab.js';
import * as koHelpers from './koHelpers.js';
import * as deHelpers from './deHelpers.js';

const LANG_HELPERS = {
  ko: koHelpers,
  de: deHelpers
};

/**
 * Returns the helper module for the current account language.
 * Safe fallback to Korean helpers.
 */
export function getLangHelpers() {
  const lang = getCurrentLanguage();
  return LANG_HELPERS[lang] || koHelpers;
}
