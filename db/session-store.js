// db/session-store.js
// Data mapping wrapper for session history and mid-session persistence.
// Uses Dexie (db.js) for IndexedDB access. Follows the contract in master context.

import { db } from './db.js';

/**
 * Persist a completed session record to the sessions table.
 * The caller (main-game.js endSession) provides summaryData shape.
 * We ensure a date timestamp exists.
 *
 * @param {Object} sessionData
 * @param {number} [sessionData.date] - timestamp (ms since epoch). Added if missing.
 * @param {number} sessionData.totalBlocks
 * @param {number} sessionData.accuracyPercent
 * @param {number} sessionData.uniqueWordsCount
 * @param {number} sessionData.duration - session length in minutes or seconds? (as provided by caller)
 */
export async function saveSession(sessionData) {
  if (!sessionData) {
    console.warn('[session-store] saveSession called with falsy data — skipping');
    return;
  }

  const accuracyValue = sessionData.accuracyPercent ?? sessionData.accuracy ?? 0;

  const record = {
    id: (crypto.randomUUID && crypto.randomUUID()) || 
      `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    date: sessionData.date || Date.now(),
    totalBlocks: sessionData.totalBlocks ?? 0,
    accuracy: accuracyValue,
    accuracyPercent: accuracyValue,
    uniqueWordsCount: sessionData.uniqueWordsCount ?? 0,
    duration: sessionData.duration ?? 0,
    dbMod: Date.now()
  };

  try {
    await db.sessions.put(record); // .put, not .add — id is now explicit, not autoincrement
  } catch (err) {
    console.error('[session-store] Failed to save completed session:', err);
  }
}

/**
 * Fetch most recent completed sessions, sorted by date descending (newest first).
 *
 * @param {number} [limit] - optional max records to return. If omitted or invalid, returns all.
 * @returns {Promise<Array<Object>>} array of session records (may include extra fields stored by Dexie)
 */
export async function getRecentSessions(limit) {
  try {
    let query = db.sessions.orderBy('date').reverse();

    if (Number.isInteger(limit) && limit > 0) {
      query = query.limit(limit);
    }

    return await query.toArray();
  } catch (err) {
    console.error('[session-store] Failed to load recent sessions:', err);
    return [];
  }
}

/**
 * Persist the live activeSession object (from core/state.js) into the settings
 * table under the fixed key 'activeSession'. This survives app backgrounding,
 * tab close, or iOS/Android lifecycle events so the user can resume a session.
 *
 * Called periodically from main-game (e.g. after every answer or on pause).
 *
 * @param {Object|null|undefined} activeSessionData - the full activeSession shape, or null to clear
 */
export async function saveSessionState(activeSessionData) {
  if (activeSessionData == null) {
    return clearSessionState();
  }

  try {
    await db.settings.put({
      key: 'activeSession',
      value: activeSessionData
    });
  } catch (err) {
    console.error('[session-store] Failed to persist mid-session state:', err);
    // Non-fatal — next load will just start fresh
  }
}

/**
 * Restore a previously saved mid-session state (if any).
 * Returns null when no state exists or on any error.
 *
 * @returns {Promise<Object|null>}
 */
export async function loadSessionState() {
  try {
    const record = await db.settings.get('activeSession');
    return record && record.value ? record.value : null;
  } catch (err) {
    console.error('[session-store] Failed to load mid-session state:', err);
    return null;
  }
}

/**
 * Remove any persisted mid-session state.
 * Called from endSession() after a clean finish, or when user explicitly abandons.
 */
export async function clearSessionState() {
  try {
    await db.settings.delete('activeSession');
  } catch (err) {
    console.error('[session-store] Failed to clear mid-session state:', err);
  }
}

// =====================================================
// MINIMAL FALL MODE RECOVERY (Best Streak only)
// =====================================================

/**
 * Saves only the bestStreak from Fall Mode.
 * This is the only piece of active session state we want to recover
 * after an unexpected close.
 */
export async function saveFallModeBestStreak(bestStreak) {
  if (typeof bestStreak !== 'number' || bestStreak < 0) return;

  try {
    await db.settings.put({
      key: 'fallModeBestStreak',
      value: { bestStreak, savedAt: Date.now() }
    });
  } catch (err) {
    console.error('[session-store] Failed to save fallModeBestStreak:', err);
  }
}

/**
 * Loads the previously saved bestStreak (if any).
 * Returns null if nothing is saved or on error.
 */
export async function loadFallModeBestStreak() {
  try {
    const record = await db.settings.get('fallModeBestStreak');
    if (record && record.value && typeof record.value.bestStreak === 'number') {
      return record.value.bestStreak;
    }
    return null;
  } catch (err) {
    console.error('[session-store] Failed to load fallModeBestStreak:', err);
    return null;
  }
}

/**
 * Clears the fall mode bestStreak recovery data.
 * Should be called on clean session end.
 */
export async function clearFallModeBestStreak() {
  try {
    await db.settings.delete('fallModeBestStreak');
  } catch (err) {
    console.error('[session-store] Failed to clear fallModeBestStreak:', err);
  }
}
