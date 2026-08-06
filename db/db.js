/**
 * db/db.js
 */

// Dexie is loaded via CDN script tag in index.html and exposed as window.Dexie
let Dexie;
if (typeof window !== 'undefined' && window.Dexie) {
  Dexie = window.Dexie;
} else {
  // Fallback for local testing / node (never used in production PWA)
  const dexieModule = await import('https://cdn.jsdelivr.net/npm/dexie@3/dist/dexie.min.js');
  Dexie = dexieModule.default || dexieModule;
}

const db = new Dexie('KoreanVocabDB');

// ---------------------------------------------------------------------------
// SCHEMA — VERSION 3 (existing)
// ---------------------------------------------------------------------------

db.version(3).stores({
  words: 'id, unit, chapter, [unit+chapter], leitnerGroup, srsNextReviewAt, strength',
  progress: '[unitId+chapterId], unitId, chapterId',
  sessions: 'id, date, accuracy, duration', // was '++id, ...'
  settings: 'key'
}).upgrade(async (tx) => {
  // Convert existing numeric ids to UUID strings so old local history survives.
  const oldSessions = await tx.table('sessions').toArray();
  for (const session of oldSessions) {
    const newId = (crypto.randomUUID && crypto.randomUUID()) || 
      `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await tx.table('sessions').delete(session.id);
    await tx.table('sessions').put({ ...session, id: newId });
  }
});

// ---------------------------------------------------------------------------
// SCHEMA — VERSION 4 (Sentence Mode practice log)
// ---------------------------------------------------------------------------

db.version(4).stores({
  words: 'id, unit, chapter, [unit+chapter], leitnerGroup, srsNextReviewAt, strength',
  progress: '[unitId+chapterId], unitId, chapterId',
  sessions: 'id, date, accuracy, duration',
  settings: 'key',
  sentenceAttempts: 'id, timestamp, complexity, correct, [complexity+correct]'
});

export { db };
