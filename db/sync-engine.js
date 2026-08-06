/**
 * db/sync-engine.js
 * Sync layer between Dexie and Firestore.
 * Only used for users with real accounts (email/password).
 * Uses dbMod for last-write-wins conflict resolution.
 */

import { db } from './db.js';
import { getCurrentUid, onAuthStateChangedListener, app } from '../core/auth.js';

import { 
  getFirestore, 
  collection, 
  getDocs, 
  writeBatch, 
  doc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

let firestore = null;
let initialized = false;

// Collections to sync
const SYNC_COLLECTIONS = [
  { dexie: 'words',     firestore: 'words' },
  { dexie: 'progress',  firestore: 'progress' },
  { dexie: 'sessions',  firestore: 'sessions' },
  { dexie: 'settings',  firestore: 'settings' },
];

function ensureFirestore() {
  if (!firestore) {
    firestore = getFirestore(app);
  }
  return firestore;
}

export async function initSync(explicitUid) {
  if (initialized) return;
  initialized = true;
  console.log('[sync] Sync engine ready');

  const uid = explicitUid || getCurrentUid();
  // Do initial pull on startup
  await pullFromFirestore(uid);
}

const BATCH_LIMIT = 500;
const LAST_SYNC_KEY = 'kv_lastSyncedAt'; // localStorage only — never synced

function getLastSyncedAt() {
  const val = localStorage.getItem(LAST_SYNC_KEY);
  return val ? Number(val) : 0;
}

function setLastSyncedAt(timestamp) {
  localStorage.setItem(LAST_SYNC_KEY, String(timestamp));
}

async function commitInChunks(firestoreDb, writes) {
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const chunk = writes.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(firestoreDb);
    chunk.forEach(({ ref, data }) => batch.set(ref, data, { merge: true }));
    await batch.commit();
  }
}


export async function pullFromFirestore(uid) {
  const effectiveUid = uid || getCurrentUid();
  const firestoreDb = ensureFirestore();
  console.log('[sync] pullFromFirestore called. uid:', effectiveUid, 'firestore ready:', !!firestoreDb);
  if (!effectiveUid || !firestoreDb) {
    console.warn('[sync] Cannot pull — no uid or firestore instance');
    return;
  }
  
  try {
    // words (existing)
    const wordsSnap = await getDocs(collection(firestore, `users/${effectiveUid}/words`));
    for (const docSnap of wordsSnap.docs) {
      const remote = docSnap.data();
      const local = await db.words.get(docSnap.id);
      if (!local || (remote.dbMod && remote.dbMod > (local.dbMod || 0))) {
        await db.words.put(remote);
      }
    }

    // progress
    const progressSnap = await getDocs(collection(firestore, `users/${effectiveUid}/progress`));
    for (const docSnap of progressSnap.docs) {
      const remote = docSnap.data();
      const local = await db.progress.get([remote.unitId, remote.chapterId]);
      if (!local || (remote.dbMod && remote.dbMod > (local.dbMod || 0))) {
        await db.progress.put(remote);
      }
    }

    // sessions
    const sessionsSnap = await getDocs(collection(firestore, `users/${effectiveUid}/sessions`));
    for (const docSnap of sessionsSnap.docs) {
      const remote = docSnap.data();
      const local = await db.sessions.get(remote.id);
      if (!local || (remote.dbMod && remote.dbMod > (local.dbMod || 0))) {
        await db.sessions.put(remote);
      }
    }

    // settings
    const settingsSnap = await getDocs(collection(firestore, `users/${effectiveUid}/settings`));
    for (const docSnap of settingsSnap.docs) {
      const remote = docSnap.data();
      const local = await db.settings.get(remote.key);
      if (!local || (remote.dbMod && remote.dbMod > (local.dbMod || 0))) {
        await db.settings.put(remote);
      }
    }

    console.log('[sync] Pull complete.');
  } catch (error) {
    console.error('[sync] Pull from Firestore failed:', error);
  }
}

export async function pushToFirestore(explicitUid) {
  const uid = explicitUid || getCurrentUid();
  const firestoreDb = ensureFirestore();
  console.log('[sync] pushToFirestore called. uid:', uid, 'firestore ready:', !!firestoreDb);
  if (!uid || !firestoreDb) return;

  const syncStartedAt = Date.now();
  const lastSyncedAt = getLastSyncedAt();

  try {
    const writes = [];

    const words = await db.words.toArray();
    words
      .filter(w => (w.dbMod || 0) > lastSyncedAt)
      .forEach(word => {
        if (word.id) {
          writes.push({ ref: doc(firestore, `users/${uid}/words/${word.id}`), data: word });
        }
      });

    const progressRecords = await db.progress.toArray();
    progressRecords
      .filter(p => (p.dbMod || 0) > lastSyncedAt)
      .forEach(p => {
        const docId = `${p.unitId}:${p.chapterId}`;
        writes.push({ ref: doc(firestore, `users/${uid}/progress/${docId}`), data: p });
      });

    const sessions = await db.sessions.toArray();
    sessions
      .filter(s => (s.dbMod || 0) > lastSyncedAt)
      .forEach(s => {
        if (s.id) {
          writes.push({ ref: doc(firestore, `users/${uid}/sessions/${s.id}`), data: s });
        }
      });

    const settings = await db.settings.toArray();
    settings
      .filter(s => (s.dbMod || 0) > lastSyncedAt)
      .forEach(s => {
        if (s.key) {
          writes.push({ ref: doc(firestore, `users/${uid}/settings/${s.key}`), data: s });
        }
      });

    if (writes.length === 0) {
      console.log('[sync] Nothing to push — up to date.');
      setLastSyncedAt(syncStartedAt);
      return;
    }

    await commitInChunks(firestore, writes);
    setLastSyncedAt(syncStartedAt);
    console.log(`[sync] Push complete. ${writes.length} documents across ${Math.ceil(writes.length / BATCH_LIMIT)} batch(es).`);
  } catch (error) {
    console.error('[sync] Push to Firestore failed:', error);
    // Deliberately do NOT update lastSyncedAt on failure — next push will retry
    // everything since the last successful sync, not just the failed chunk.
  }
}

export async function fullSync(explicitUid) {
  const uid = explicitUid || getCurrentUid();
  if (!uid) return;

  console.log('[sync] Starting full sync...');
  await pullFromFirestore(uid);
  await pushToFirestore(uid);
  console.log('[sync] Full sync complete.');
}

export async function deleteWordsFromFirestore(wordIds) {
  const uid = getCurrentUid();
  const firestoreDb = ensureFirestore();

  if (!uid || !firestoreDb || !Array.isArray(wordIds) || wordIds.length === 0) {
    return;
  }

  try {
    for (const id of wordIds) {
      await deleteDoc(doc(firestore, `users/${uid}/words/${id}`));
    }
    console.log(`[sync] Deleted ${wordIds.length} word doc(s) from Firestore.`);
  } catch (error) {
    console.error('[sync] deleteWordsFromFirestore failed:', error);
  }
}

export { firestore };
