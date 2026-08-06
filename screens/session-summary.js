import { navigate, goBack } from '../core/router.js';
import { setState } from '../core/state.js';
import { playUnlock } from '../assets/sounds/sounds.js';
import { resolveWord, getWorstPerformingWords, markWordsDueNow, getDerivedLeitnerGroup } from '../db/word-store.js';

/**
 * Session Summary Screen
 * Post-game debrief following the late 80s/early 90s arcade visual contract.
 */

let screenEl = null;
const SCREEN_ID = 'session-summary-screen';

function getScreenElement() {
  if (!screenEl || !document.getElementById(SCREEN_ID)) {
    screenEl = document.createElement('div');
    screenEl.id = SCREEN_ID;
    screenEl.className = 'screen session-summary-screen';
    const app = document.getElementById('app');
    if (app) {
      app.appendChild(screenEl);
    }
  }
  return screenEl;
}

function renderWorstWordsList(worstWords) {
  if (!worstWords || worstWords.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-icon">★</div>
        <div class="empty-text">NO WEAK WORDS DETECTED</div>
        <div class="empty-sub">PERFECT SESSION — KEEP IT UP</div>
      </div>
    `;
  }

  return worstWords.map((word) => {
    const group = getDerivedLeitnerGroup(word) || 1;
    const groupClass = `leitner-${group}`;
    const strengthPct = Math.round((word.strength || 0) * 100);
    const hangul = word.hangul || '???';
    const english = word.english || 'Unknown word';

    return `
      <div class="word-item ${groupClass}">
        <div class="word-main">
          <span class="word-hangul">${hangul}</span>
          <span class="word-english">${english}</span>
        </div>
        <div class="word-stats">
          <span class="leitner-badge ${groupClass}">GROUP ${group}</span>
          <span class="stat">STR ${strengthPct}%</span>
          <span class="stat">SEEN ${word.gameTimeSeen || 0}</span>
        </div>
      </div>
    `;
  }).join('');
}

export async function init(summaryData = {}) {
  const app = document.getElementById('app');
  if (!app) {
    console.error('[session-summary] #app container not found');
    return;
  }

  let screen = document.getElementById('screen-session-summary');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'screen-session-summary';
    screen.className = 'screen session-summary-screen';
    app.appendChild(screen);
  }

  let worstWords = [];
  if (summaryData.worstPerformingWords && Array.isArray(summaryData.worstPerformingWords)) {
    try {
      worstWords = await Promise.all(
        summaryData.worstPerformingWords.map(async (progressWord) => {
          if (!progressWord || !progressWord.id) return progressWord;
          try {
            const fullWord = await resolveWord(progressWord.id);
            return { ...progressWord, ...fullWord, leitnerGroup: progressWord.leitnerGroup || fullWord.leitnerGroup || 1 };
          } catch (resolveErr) {
            console.warn('[session-summary] resolveWord failed for', progressWord.id, resolveErr);
            return { ...progressWord, hangul: progressWord.hangul || '???', english: progressWord.english || 'Unknown', leitnerGroup: progressWord.leitnerGroup || 1 };
          }
        })
      );
    } catch (e) {
      console.error('[session-summary] Failed to resolve worst performing words:', e);
      worstWords = summaryData.worstPerformingWords || [];
    }
  }

  screen.innerHTML = `
    <div class="summary-wrapper">
      <!-- Arcade header -->
      <div class="summary-header">
        <h1 class="arcade-title">MISSION<br>COMPLETE</h1>
        <div class="subtitle">SESSION DEBRIEF</div>
      </div>

      <!-- Key metrics in clean arcade readout style -->
      <div class="metrics-panel">
        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-value">${summaryData.totalBlocks || 0}</div>
            <div class="metric-label">BLOCKS</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${summaryData.accuracyPercent || 0}<span class="pct">%</span></div>
            <div class="metric-label">ACCURACY</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${summaryData.uniqueWordsCount || 0}</div>
            <div class="metric-label">WORDS MET</div>
          </div>
        </div>
      </div>

      <!-- Worst Performing Words — scrollable list with dynamic Leitner coloring -->
      <div class="worst-section">
        <div class="section-header">
          <span class="section-title">WORST PERFORMING</span>
          <span class="section-subtitle">PRIORITY REVIEW TARGETS</span>
        </div>
        <div class="word-list" id="worst-list">
          ${renderWorstWordsList(worstWords)}
        </div>
      </div>

      <!-- Bottom action bar -->
      <div class="action-bar">
        <button id="btn-flashcards" class="btn btn-primary btn-large">
          REVIEW WEAK WORDS
        </button>
        <button id="btn-menu" class="btn btn-secondary btn-large">
          MAIN MENU
        </button>
      </div>
    </div>
  `;

  bindEvents(screen, summaryData, worstWords);
  checkAndRenderUnlockBanner(summaryData, screen);
}

function bindEvents(screen, summaryData, worstWords) {
  const btnFlashcards = screen.querySelector('#btn-flashcards');
  const btnMenu = screen.querySelector('#btn-menu');

  // Flashcard Mode — mark worst performers as due now, then navigate
  if (btnFlashcards) {
    btnFlashcards.addEventListener('click', async () => {
      const targetWords = (worstWords && worstWords.length > 0)
        ? worstWords
        : (summaryData.worstPerformingWords || []);

      if (targetWords.length > 0) {
        const worstIds = targetWords
          .map(w => (typeof w === 'string' ? w : w.id))
          .filter(Boolean);

        // NEW: Mark these words as due immediately (Due Now mode will surface them)
        await markWordsDueNow(worstIds);
      }

      // Navigate to flashcard-mode — Due Now will automatically pick them up
      navigate('flashcard-mode');
    });
  }

  // Back to main menu
  if (btnMenu) {
    btnMenu.addEventListener('click', () => {
      navigate('main-menu');
    });
  }

  // Extra mobile touch feedback
  const allBtns = [btnFlashcards, btnMenu].filter(Boolean);
  allBtns.forEach((btn) => {
    btn.addEventListener('touchstart', () => btn.classList.add('active'), { passive: true });
    btn.addEventListener('touchend', () => btn.classList.remove('active'), { passive: true });
    btn.addEventListener('touchcancel', () => btn.classList.remove('active'), { passive: true });
    btn.addEventListener('mousedown', () => btn.classList.add('active'));
    btn.addEventListener('mouseup', () => btn.classList.remove('active'));
    btn.addEventListener('mouseleave', () => btn.classList.remove('active'));
  });
}

function checkAndRenderUnlockBanner(summaryData, screen) {
  if (!summaryData || typeof summaryData.wordsUnlocked !== 'number' || summaryData.wordsUnlocked <= 0) {
    return;
  }

  const banner = document.createElement('div');
  banner.className = 'unlock-banner';
  banner.innerHTML = `
    <div class="banner-glow"></div>
    <div class="banner-content">
      <div class="banner-icon">◆</div>
      <div class="banner-text">
        <div class="banner-title">NEW VOCABULARY TIER UNLOCKED</div>
        <div class="banner-count">+${summaryData.wordsUnlocked} WORDS ADDED TO DECK</div>
      </div>
    </div>
  `;

  const wrapper = screen.querySelector('.summary-wrapper');
  if (wrapper) {
    const header = wrapper.querySelector('.summary-header');
    if (header && header.nextSibling) {
      wrapper.insertBefore(banner, header.nextSibling);
    } else {
      wrapper.prepend(banner);
    }
  } else {
    screen.prepend(banner);
  }

  requestAnimationFrame(() => {
    banner.classList.add('visible');
  });

  try {
    playUnlock();
  } catch (e) {}
}
