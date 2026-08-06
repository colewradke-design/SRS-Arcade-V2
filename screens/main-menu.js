import { onAuthStateChangedListener, getCurrentUser } from '../core/auth.js';
import { navigate } from '../core/router.js';
import { getAllUnlockedWords } from '../db/word-store.js';
import { initializeFirstSession, getCurrentChapterProgress, getLiveChapterStrength } from '../engine/progression.js';
import { getTheme } from '../db/settings-store.js';
import { getDueCount } from '../engine/srs.js';
import { getState, setState } from '../core/state.js';
import { db } from '../db/db.js';

let isInitializing = false;

export async function init() {
  const app = document.getElementById('app');
  if (!app) {
    console.error('[main-menu] #app container not found in DOM');
    return;
  }

  let screen = document.getElementById('screen-main-menu');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'screen-main-menu';
    screen.className = 'screen main-menu';
    app.appendChild(screen);
  }

  screen.innerHTML = `
    <div id="screen-main-menu" class="screen main-menu">
      <div class="menu-header">
        <h1 class="app-title">VOCAB TRAINER</h1>
        <div class="loading-state">
          <p>Loading your progress...</p>
        </div>
      </div>
    </div>
  `;

  void app.offsetHeight;

  if (isInitializing) return;
  isInitializing = true;
  try {
    const hasOnboarded = await db.settings.get('hasCompletedOnboarding');
    if (!hasOnboarded || hasOnboarded.value !== true) {
      navigate('onboarding');
      return;
    }
  } catch (e) {
    // If settings read fails, fall through to normal flow
  }

  try {
    const unlockedWords = await getAllUnlockedWords();

    if (!unlockedWords || unlockedWords.length === 0) {
      console.log("🚀 First launch detected — initializing database...");
      await initializeFirstSession();
      console.log("✅ First session initialization complete.");
    }

    const currentTheme = (await getTheme()) || 'theme-arcade';
    document.documentElement.className = currentTheme;

    const currentChapterProgress = await getCurrentChapterProgress();
    const chapterNum = currentChapterProgress?.chapterId ?? null;
    const liveChapterStrength = await getLiveChapterStrength(
      currentChapterProgress?.unitId ?? null,
      chapterNum
    );
    const chapterStrengthPct = Math.round(liveChapterStrength * 100);

    // === NEW: Due words badge for Flashcards button ===
    const dueCount = getDueCount(unlockedWords || []);

    // === Spelling Mode: Check for saved unfinished puzzle ===
    let hasSavedPuzzle = false;
    try {
      const savedPuzzle = await db.settings.get('activeSpellingPuzzle');
      hasSavedPuzzle = !!(savedPuzzle && savedPuzzle.value && savedPuzzle.value.completed === false);
    } catch (e) {
      hasSavedPuzzle = false;
    }

    renderMainMenu(app, chapterStrengthPct, chapterNum, dueCount, hasSavedPuzzle || false);
    
    // === Check for pending Due Now toast AFTER rendering the menu ===
    const pendingToast = getState('pendingDueNowToast');
    if (pendingToast && pendingToast.nextDueText) {
      setTimeout(() => {
        showDueNowToast(pendingToast.nextDueText);
        setState('pendingDueNowToast', null);
      }, 400); // slightly longer delay to be safe
    }

  } catch (error) {
    console.error('[main-menu] Initialization failed:', error);
    renderErrorState(app);
  } finally {
    isInitializing = false;
  }
}

function renderMainMenu(app, chapterStrengthPct, chapterNum, dueCount = 0, hasSavedPuzzle = false) {
  const dueBadge = dueCount > 0 
    ? `<span class="btn-subtitle due-badge">${dueCount} WORDS DUE</span>` 
    : `<span class="btn-subtitle">REVIEW WORDS</span>`;

  app.innerHTML = `
    <div id="screen-main-menu" class="screen main-menu">
      <div class="menu-header">
        <h1 class="app-title">VOCAB TRAINER</h1>

        <div class="deck-strength">
          <div class="current-chapter-label">CURRENT CHAPTER ${chapterNum !== null ? chapterNum : '—'} STRENGTH</div>
          <div class="deck-strength-header">
            <span class="deck-strength-label">CHAPTER STRENGTH</span>
            <span class="deck-strength-value">${chapterStrengthPct}%</span>
          </div>
          <div class="deck-strength-bar" aria-hidden="true">
            <div class="deck-strength-fill" style="width: ${chapterStrengthPct}%"></div>
          </div>
          <div class="deck-strength-note">NEXT UNLOCK AT 70%</div>
        </div>
      </div>

      <div class="nav-menu" role="navigation" aria-label="Main navigation">
        <button class="btn menu-btn" id="auth-btn" data-screen="login">
          <span class="btn-icon">👤</span>
          <div class="btn-content">
            <span class="btn-title" id="auth-btn-title">LOGIN TO SYNC</span>
            <span class="btn-subtitle" id="auth-btn-subtitle">CROSS-DEVICE PROGRESS</span>
          </div>
        </button>
        
        <button class="btn menu-btn" data-screen="session-settings">
          <span class="btn-icon">▶</span>
          <div class="btn-content">
            <span class="btn-title">START SESSION</span>
            <span class="btn-subtitle">FALL MODE • 15–45 MIN</span>
          </div>
        </button>

        <button class="btn menu-btn" data-screen="flashcard-options">
          <span class="btn-icon">📇</span>
          <div class="btn-content">
            <span class="btn-title">FLASHCARDS</span>
            ${dueBadge}
          </div>
        </button>

        <!-- SPELLING MODE -->
        <button class="btn menu-btn" data-screen="spelling-options">
          <span class="btn-icon">✏</span>
          <div class="btn-content">
            <span class="btn-title">SPELLING</span>
            <span class="btn-subtitle">PRACTICE & WORD SEARCH</span>
          </div>
        </button>

        ${hasSavedPuzzle ? `
        <button class="btn menu-btn" data-screen="spelling-wordsearch" data-continue="true">
          <span class="btn-icon">⊞</span>
          <div class="btn-content">
            <span class="btn-title">CONTINUE PUZZLE</span>
            <span class="btn-subtitle">RESUME WORD SEARCH</span>
          </div>
        </button>
        ` : ''}

        <!-- SENTENCE MODE (requires network) -->
        <button class="btn menu-btn" id="sentence-mode-btn" data-screen="sentence-settings">
          <span class="btn-icon">💬</span>
          <div class="btn-content">
            <span class="btn-title">SENTENCE MODE</span>
            <span class="btn-subtitle" id="sentence-mode-subtitle">TRANSLATE FULL SENTENCES</span>
          </div>
        </button>
        
        <button class="btn menu-btn" data-screen="master-deck">
          <span class="btn-icon">📚</span>
          <div class="btn-content">
            <span class="btn-title">FULL DECK</span>
            <span class="btn-subtitle">ALL WORDS</span>
          </div>
        </button>

        <button class="btn menu-btn" data-screen="custom-word">
          <span class="btn-icon">＋</span>
          <div class="btn-content">
            <span class="btn-title">ADD CUSTOM WORD</span>
            <span class="btn-subtitle">ADD YOUR OWN VOCAB</span>
          </div>
        </button>

        <button class="btn menu-btn" data-screen="options">
          <span class="btn-icon">⚙</span>
          <div class="btn-content">
            <span class="btn-title">OPTIONS</span>
            <span class="btn-subtitle">THEMES & UPDATER</span>
          </div>
        </button>
      </div>
    </div>
  `;

  bindEvents();
  // === Auth-aware button ===
  const authBtn = document.getElementById('auth-btn');
  const authTitle = document.getElementById('auth-btn-title');
  const authSubtitle = document.getElementById('auth-btn-subtitle');

  if (authBtn && authTitle && authSubtitle) {
    onAuthStateChangedListener(user => {
      if (user && !user.isAnonymous) {
        // Signed in with email
        authTitle.textContent = 'ACCOUNT';
        authSubtitle.textContent = 'SYNC ACTIVE';
      } else {
        // Anonymous or not signed in
        authTitle.textContent = 'LOGIN TO SYNC';
        authSubtitle.textContent = 'CROSS-DEVICE PROGRESS';
      }
    });
  }
}

function renderErrorState(app) {
  app.innerHTML = `
    <div id="screen-main-menu" class="screen main-menu">
      <div class="menu-header">
        <h1 class="app-title">VOCAB TRAINER</h1>
        <p class="app-subtitle" style="color: var(--color-incorrect);">Something went wrong</p>
        <p style="margin-top: 20px; color: var(--color-text-muted);">
          Failed to load your progress.<br>Please refresh the page.
        </p>
      </div>
    </div>
  `;
}

function bindEvents() {
  const navButtons = document.querySelectorAll('.menu-btn');

  navButtons.forEach((btn) => {
    const targetScreen = btn.dataset.screen;

    // Remove any old listeners (prevents duplicate bindings)
    btn.onclick = null;

    btn.addEventListener('click', (e) => {
      // Offline guard for Sentence Mode
      if (btn.id === 'sentence-mode-btn' && btn.classList.contains('offline-disabled')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      console.log('[main-menu] Button clicked:', targetScreen);

      if (targetScreen) {
        const continueFlag = btn.dataset.continue === 'true';
        navigate(targetScreen, continueFlag ? { continue: true } : {});
      } else {
        console.warn('[main-menu] Button has no data-screen attribute');
      }
    });
  });

  // Live online/offline toggle for Sentence Mode tile
  setupSentenceModeOfflineState();

  // Keep the existing focus styling for the Start Session button
  const startBtn = document.querySelector('.menu-btn[data-screen="session-settings"]');
  if (startBtn) {
    startBtn.classList.add('menu-focus');
    startBtn.setAttribute('tabindex', '0');
  }
  // === DEV BUTTON ===
  const devBtn = document.getElementById('dev-make-due-btn');
  if (devBtn) {
    devBtn.addEventListener('click', markAllWordsDueNow);
  }
}

function showDueNowToast(nextDueText) {
  const app = document.getElementById('app');
  if (!app) return;

  const toast = document.createElement('div');
  toast.className = 'due-now-toast';
  toast.innerHTML = `
    <div class="toast-content">
      <div class="toast-title">All Due Words Reviewed</div>
      <div class="toast-subtitle">Good work. Come back ${nextDueText} for your next review.</div>
    </div>
  `;

  app.appendChild(toast);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    if (toast && toast.parentNode) {
      toast.style.transition = 'opacity 300ms ease';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }
  }, 5000);
}
// === DEV HELPER — Remove before release ===
async function markAllWordsDueNow() {
  try {
    const { getAllUnlockedWords } = await import('../db/word-store.js');
    const words = await getAllUnlockedWords();

    if (!words || words.length === 0) {
      console.warn('[DEV] No unlocked words found');
      return;
    }

    const wordIds = words.map(w => w.id);
    const { markWordsDueNow } = await import('../db/word-store.js');

    await markWordsDueNow(wordIds);
    console.log(`[DEV] Marked ${wordIds.length} words as due now`);

    alert(`Marked ${wordIds.length} words as due now. Go to Flashcards → Due Now to test.`);
  } catch (err) {
    console.error('[DEV] Failed to mark words due now:', err);
  }
}

/**
 * Toggle Sentence Mode tile based on navigator.onLine.
 * No network call is ever attempted from the disabled state.
 */
function setupSentenceModeOfflineState() {
  const btn = document.getElementById('sentence-mode-btn');
  const subtitle = document.getElementById('sentence-mode-subtitle');
  if (!btn || !subtitle) return;

  function applyState() {
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (online) {
      btn.classList.remove('offline-disabled');
      btn.removeAttribute('disabled');
      btn.style.opacity = '';
      subtitle.textContent = 'TRANSLATE FULL SENTENCES';
    } else {
      btn.classList.add('offline-disabled');
      btn.setAttribute('disabled', 'true');
      btn.style.opacity = '0.45';
      subtitle.textContent = "You're offline";
    }
  }

  applyState();
  window.addEventListener('online', applyState);
  window.addEventListener('offline', applyState);
}
