import { db } from './db.js';

/**
 * Simple key-value store backed by the Dexie `settings` table.
 * All functions are async because IndexedDB operations are asynchronous.
 */

export async function getSetting(key) {
  const record = await db.settings.get(key);
  return record ? record.value : undefined;
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value, dbMod: Date.now() });
}

/**
 * Theme-specific convenience wrapper.
 * Falls back cleanly to the default arcade theme if no theme has been persisted yet.
 */
export async function getTheme() {
  const theme = await getSetting('theme');
  return theme || 'theme-arcade';
}

export async function setTheme(themeId) {
  await setSetting('theme', themeId);
}
export async function hasCompletedOnboarding() {
  const val = await getSetting('hasCompletedOnboarding');
  return val === true;
}

export async function setOnboardingComplete() {
  await setSetting('hasCompletedOnboarding', true);
}

export async function getUserLanguage() {
  const lang = await getSetting('userLanguage');
  return lang || null; // null = not yet chosen
}

export async function setUserLanguage(lang) {
  await setSetting('userLanguage', lang);
}
