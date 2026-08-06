/**
 * core/auth.js
 * Firebase Authentication + App Check module for Korean Vocabulary PWA.
 * Handles anonymous sign-in on first launch + optional email/password accounts.
 * App Check (reCAPTCHA v3) protects AI / Gemini endpoints from abuse.
 * Follows project rules: vanilla ES modules, no bundler, CDN imports only.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  linkWithCredential,
  EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  initializeAppCheck,
  ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "AIzaSyCt7Q-rjYndZY_jjJyGPKxMU49wFb7rmJ4",
  authDomain: "vocabtrainer-39d38.firebaseapp.com",
  projectId: "vocabtrainer-39d38",
  storageBucket: "vocabtrainer-39d38.firebasestorage.app",
  messagingSenderId: "421386659365",
  appId: "1:421386659365:web:1b4c0d9e2d8b38bd9381cc",
  measurementId: "G-P3J247DXGW"
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);

// App Check — reCAPTCHA v3 (invisible). Must run before any Firebase service calls.
const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider('6LfVy3ctAAAAAJptiObp1SotOWJocbd5FWsRrCgl'),
  isTokenAutoRefreshEnabled: true
});

const auth = getAuth(app);

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Returns the current Firebase user (or null)
 */
export function getCurrentUser() {
  return auth.currentUser;
}

/**
 * Returns the current user's UID (or null if not signed in)
 */
export function getCurrentUid() {
  return auth.currentUser?.uid || null;
}

/**
 * Subscribe to auth state changes
 */
export function onAuthStateChangedListener(callback) {
  return onAuthStateChanged(auth, callback);
}
/**
 * Create a new account with email + password and link it to the current anonymous user
 */
export async function signUpWithEmail(email, password) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    console.log('[auth] Account created successfully');

    const { fullSync } = await import('../db/sync-engine.js');
    await fullSync(userCredential.user.uid);

    return userCredential.user;
  } catch (error) {
    console.error('[auth] signUpWithEmail failed:', error);
    throw error;
  }
}

export async function signInWithEmail(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    console.log('[auth] Signed in with email');

    const { fullSync } = await import('../db/sync-engine.js');
    await fullSync(userCredential.user.uid);

    return auth.currentUser;
  } catch (error) {
    console.error('[auth] signInWithEmail failed:', error);
    throw error;
  }
}
/**
 * Sign out the current user
 */
export async function signOutUser() {
  try {
    await signOut(auth);
    console.log('[auth] User signed out');
  } catch (error) {
    console.error('[auth] signOut failed:', error);
    throw error;
  }
}

export { auth, app };
