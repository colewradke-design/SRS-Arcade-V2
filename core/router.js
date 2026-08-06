/**
 * core/router.js
 */

import './auth.js';
import { initVocab } from '../vocab/vocab.js';
import { getUserLanguage } from '../db/settings-store.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_SCREENS = new Set([
  'main-menu',
  'login',
  'session-settings',
  'flashcard-options',
  'main-game',
  'flashcard-mode',
  'master-deck',
  'session-summary',
  'options',
  'custom-word',
  'spelling-options',
  'spelling-flashcard',
  'spelling-wordsearch',
  'onboarding',
  'sentence-settings',
  'sentence-mode',
]);

const FLASH_DURATION_MS = 80;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let screenHistory = [];
let currentScreenName = null;
const moduleCache = new Map();

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function assertValidScreen(screenName) {
  if (!VALID_SCREENS.has(screenName)) {
    throw new Error(
      `[router] Unknown screen: "${screenName}". ` +
      `Valid screens are: ${[...VALID_SCREENS].join(', ')}.`
    );
  }
}

function showScreen(screenName) {
  const app = getAppRoot();
  const div = app.querySelector(`#screen-${screenName}`);
  if (!div) throw new Error(`[router] No screen div found for "${screenName}".`);
  div.removeAttribute('hidden');
  div.classList.remove('hidden');
  div.style.display = ''; // clear any inline override left by onboarding.js
}

function getAppRoot() {
  const app = document.getElementById('app');
  if (!app) throw new Error('[router] #app element not found in DOM.');
  return app;
}

function triggerCRTFlicker() {
  const app = getAppRoot();
  app.classList.add('screen-flash');
  setTimeout(() => {
    app.classList.remove('screen-flash');
  }, FLASH_DURATION_MS);
}

function hideAllScreens() {
  const app = getAppRoot();
  const screenDivs = app.querySelectorAll(':scope > div[id^="screen-"]');
  screenDivs.forEach((div) => {
    div.setAttribute('hidden', '');
    div.classList.add('hidden');
  });
}


async function loadScreenModule(screenName) {
  if (moduleCache.has(screenName)) {
    return moduleCache.get(screenName);
  }

  const module = await import(`../screens/${screenName}.js`);

  if (typeof module.init !== 'function') {
    throw new Error(
      `[router] Screen module "/screens/${screenName}.js" must export an init() function.`
    );
  }

  moduleCache.set(screenName, module);
  return module;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------


async function navigate(screenName, params = {}, options = {}) {  
  assertValidScreen(screenName);
  if (currentScreenName !== null && options.replace !== true) {
    screenHistory.push({ screenName: currentScreenName, params: {} });
  }

  triggerCRTFlicker();
  hideAllScreens();
  const module = await loadScreenModule(screenName);
  
  try {
    await module.init(params);
  } catch (err) {
    console.error(`[router] init() failed for screen "${screenName}":`, err);
    throw err;
  }

  showScreen(screenName);
  currentScreenName = screenName;
}

async function goBack() {
  if (screenHistory.length === 0) {
    console.warn('[router] goBack() called with empty history. Falling back to main-menu.');
    await navigate('main-menu');
    return;
  }

  const previous = screenHistory.pop();
  await navigate(previous.screenName, previous.params, { replace: true });
 }

function getCurrentScreen() {
  return currentScreenName;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { navigate, goBack, getCurrentScreen };
export default { navigate, goBack, getCurrentScreen };
// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function bootstrap() {
  // === Vocab must be initialized before any screen navigation ===
  const storedLang = await getUserLanguage();
  await initVocab(storedLang || 'ko'); // legacy users default to Korean

  // === Firebase Auth + Sync (only for real accounts) ===
  try {
    const authModule = await import('./auth.js');
    
    // Wait for auth state to settle
    await new Promise(resolve => {
      const unsubscribe = authModule.onAuthStateChangedListener(user => {
        unsubscribe(); // run once
        resolve(user);
      });
    });

    const currentUser = authModule.getCurrentUser();

    if (currentUser) {
      // Only initialize sync for real accounts
      const sync = await import('../db/sync-engine.js');
      await sync.initSync(currentUser.uid);
      console.log('%c[router] Sync engine initialized (real account)', 'color: #00ff9d');
    } else {
      console.log('%c[router] No account found — running in local-only mode', 'color: #ffaa00');
    }

  } catch (err) {
    console.error('[router] Failed to load auth or sync module', err);
  }

  // === Push on app close / tab switch ===
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      import('../db/sync-engine.js').then(sync => sync.pushToFirestore());
    }
  });

  window.addEventListener('pagehide', () => {
    import('../db/sync-engine.js').then(sync => sync.pushToFirestore());
  });
  
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
    } catch (err) {
      console.warn('[router] Service worker registration failed:', err);
    }
  }

  await navigate('main-menu');
}

bootstrap();
