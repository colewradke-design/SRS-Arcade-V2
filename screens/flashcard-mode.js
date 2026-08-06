// screens/flashcard-mode.js
// Flashcard review interface manager
// MODERATE REWRITE per Master Handoff Document.
//
// Queue building now supports three modes: master, unit, dueNow
// All SRS updates go through word-store.updateWordAfterFlashcard()
// No connection to progression.js

import { navigate, goBack } from '../core/router.js';
import { getState, setState } from '../core/state.js';
import * as wordStore from '../db/word-store.js';
import * as utils from '../core/utils.js';
import { getDueCards as getDueWords } from '../engine/srs.js';

let cardQueue = [];
let currentCard = null;
let isFlipped = false;
let stats = { seen: 0, correct: 0 };
let sessionWords = [];
let isDueNowMode = false;

function pushProgressToCloud() {
  import('../db/sync-engine.js').then(sync => sync.pushToFirestore());
}

export async function init(params = {}) {
  // Reset all module-level state on every navigation
  cardQueue = [];
  currentCard = null;
  isFlipped = false;
  stats = { seen: 0, correct: 0 };
  sessionWords = [];

  const sessionConfig = getState('sessionConfig') || {
    deckType: 'master',
    selectedUnits: [],
    flashcardDirection: 'native-to-english'  // NEW
  };

  // Support pending words from session-summary (worst performers)
  let worstPerforming = params.worstPerformingWords || [];
  const pending = getState('pendingFlashcardWords');
  if (pending && pending.length > 0 && worstPerforming.length === 0) {
    worstPerforming = pending;
    setState('pendingFlashcardWords', []);
  }

  try {
    if (worstPerforming.length > 0) {
      // Prepend worst-performing words
      const worstIds = worstPerforming
        .map(w => (typeof w === 'string' ? w : w.id))
        .filter(Boolean);

      const resolvedWorst = await Promise.all(
        worstIds.map(id => wordStore.resolveWord(id).catch(() => null))
      ).then(r => r.filter(Boolean));

      const allProgress = await wordStore.getWordsForSession(sessionConfig);
      const remainingProgress = allProgress.filter(pw => !worstIds.includes(pw.id));

      const resolvedRemaining = await Promise.all(
        remainingProgress.map(pw => wordStore.resolveWord(pw.id).catch(() => null))
      ).then(r => r.filter(Boolean));

      cardQueue = [...resolvedWorst, ...resolvedRemaining];
      sessionWords = [...resolvedWorst, ...resolvedRemaining];
    } else {
      // Standard path — build queue according to deckType
      const progressWords = await wordStore.getWordsForSession(sessionConfig);

      if (!progressWords || progressWords.length === 0) {
        console.error('flashcard-mode: getWordsForSession returned empty array');
        navigate('main-menu');
        return;
      }

      const resolvedWords = await Promise.all(
        progressWords.map(pw => wordStore.resolveWord(pw.id).catch(() => null))
      ).then(r => r.filter(Boolean));

      if (resolvedWords.length === 0) {
        console.error('flashcard-mode: unable to resolve any word records');
        navigate('main-menu');
        return;
      }

      sessionWords = resolvedWords;
      buildCardQueue(sessionWords, sessionConfig);
    }

    if (cardQueue.length === 0 && sessionWords.length === 0) {
      navigate('main-menu');
      return;
    }

    renderScreen();
    renderNextCard();
    updateHUD();
    bindEvents();

  } catch (err) {
    console.error('flashcard-mode init crashed:', err);
    navigate('main-menu');
  }
}

/**
 * Builds the review queue according to the selected deck type.
 * - master: all unlocked words, sorted by leitnerGroup ascending
 * - unit: filtered by selected units, sorted by leitnerGroup ascending
 * - dueNow: only due words (srsNextReviewAt <= now), sorted most overdue first
 */
function buildCardQueue(words, sessionConfig) {
  cardQueue = [];
  if (!words || words.length === 0) return;

  const deckType = sessionConfig?.deckType || 'master';
  const selectedUnits = new Set(sessionConfig?.selectedUnits || []);
  let filteredWords = words;

  if (deckType === 'unit' && selectedUnits.size > 0) {
    filteredWords = words.filter(w => selectedUnits.has(w.unit));
  } else if (deckType === 'dueNow') {
    isDueNowMode = true;
    filteredWords = getDueWords(words);
    cardQueue = filteredWords;
    return;
  }

  // master or unit → group by derived Leitner group (1 = weakest first) + shuffle inside groups
  const groups = {};
  filteredWords.forEach(word => {
    const g = wordStore.getDerivedLeitnerGroup(word) || 1;
    if (!groups[g]) groups[g] = [];
    groups[g].push(word);
  });

  for (let g = 1; g <= 5; g++) {
    if (groups[g] && groups[g].length > 0) {
      const shuffled = utils.shuffle([...groups[g]]);
      cardQueue.push(...shuffled);
    }
  }
}

/**
 * NEW: Helpers for bidirectional flashcards
 */
function getFrontText(card, direction) {
  if (!card) return '—';
  return direction === 'native-to-english' ? (card.native || '—') : (card.english || '—');
}

function getBackText(card, direction) {
  if (!card) return '—';
  return direction === 'native-to-english' ? (card.english || '—') : (card.native || '—');
}

// (Helper cleaned; styling handled inline)

function renderScreen() {
  const app = document.getElementById('app');
  if (!app) {
    console.error('#app not found — cannot render flashcard screen');
    return;
  }

  let screen = document.getElementById('flashcard-mode');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'flashcard-mode';
    screen.className = 'screen flashcard-screen';
    app.appendChild(screen);
  }

  screen.innerHTML = `
    <div id="flashcard-hud">
      <div class="hud-left">
        <span class="hud-phase-badge">Review</span>
      </div>
      <div class="hud-center">
        <div class="hud-stat">
          <span class="hud-label">accuracy</span>
          <span class="hud-value hud-timer" id="hud-accuracy">0%</span>
        </div>
      </div>
      <div class="hud-right">
        <div class="hud-streak-group">
          <span class="hud-label">seen</span>
          <span class="hud-value" id="hud-seen">0</span>
        </div>
        <div class="hud-streak-group">
          <span class="hud-label">left</span>
          <span class="hud-value" id="hud-queue">0</span>
        </div>
      </div>
    </div>

    <div class="flashcard-container">
      <div class="card-outer">
        <div class="card-inner" id="card-inner">
          <div class="card-face">
            <span id="card-word"></span>
          </div>
        </div>
      </div>

      <div id="rating-container" class="rating-container" style="display: none;">
        <div class="rating-instruction">How well did you recall this word?</div>
        <div class="rating-buttons">
          <button id="btn-miss" class="btn rating-btn btn-miss">Miss</button>
          <button id="btn-hard" class="btn rating-btn btn-hard">Hard</button>
          <button id="btn-moderate" class="btn rating-btn btn-moderate">Moderate</button>
          <button id="btn-easy" class="btn rating-btn btn-easy">Easy</button>
        </div>
      </div>
    </div>

    <div class="flashcard-footer">
      <button id="end-review-btn" class="btn">End Review</button>
    </div>
  `;
}

function renderNextCard() {
  if (cardQueue.length === 0) {
  if (isDueNowMode) {
    endDueNowSession();
    return;
  }

  if (!sessionWords || sessionWords.length === 0) {
    console.error('flashcard-mode: renderNextCard called with zero words available');
    navigate('main-menu');
    return;
  }

  // Rebuild queue if it ran out (master / unit mode only)
  const sessionConfig = getState('sessionConfig') || {};
  buildCardQueue(sessionWords, sessionConfig);
  if (cardQueue.length === 0) {
    navigate('main-menu');
    return;
  }
}

  currentCard = cardQueue.shift();

  const sessionConfig = getState('sessionConfig') || {};
  const direction = sessionConfig.flashcardDirection || 'native-to-english';

  const wordEl = document.getElementById('card-word');
  const cardInner = document.getElementById('card-inner');
  const ratingContainer = document.getElementById('rating-container');

  if (wordEl) {
    const frontText = getFrontText(currentCard, direction);
    wordEl.textContent = frontText;
    wordEl.dataset.lang = utils.detectTextLanguage(frontText);
    // Apply English styling only if front is English (reverse mode)
    if (direction === 'english-to-native') {
      wordEl.classList.add('card-word--english');
    } else {
      wordEl.classList.remove('card-word--english');
    }
  }
  if (cardInner) cardInner.classList.remove('flip-out', 'flip-in');
  if (ratingContainer) ratingContainer.style.display = 'none';

  isFlipped = false;
  updateHUD();
}

function handleCardTap() {
  if (!currentCard || isFlipped) return;
  isFlipped = true;

  const cardInner = document.getElementById('card-inner');
  const wordEl = document.getElementById('card-word');
  const ratingContainer = document.getElementById('rating-container');

  cardInner.classList.add('flip-out');
  void cardInner.offsetWidth;

  setTimeout(() => {
    if (wordEl) {
      const sessionConfig = getState('sessionConfig') || {};
      const direction = sessionConfig.flashcardDirection || 'native-to-english';
      const backText = getBackText(currentCard, direction);
      wordEl.textContent = backText;
      wordEl.dataset.lang = utils.detectTextLanguage(backText);
      // Always apply English class when back is the English side
      const isEnglishSide = direction === 'native-to-english';
      if (isEnglishSide) {
        wordEl.classList.add('card-word--english');
      } else {
        wordEl.classList.remove('card-word--english');
      }
    }

    cardInner.classList.remove('flip-out');
    cardInner.classList.add('flip-in');
    if (ratingContainer) ratingContainer.style.display = 'flex';

    cardInner.addEventListener('transitionend', () => {
      cardInner.classList.remove('flip-in');
    }, { once: true });
  }, 200);
}

async function handleRating(rating) {
  if (!currentCard) return;

  stats.seen++;
  if (rating === 'moderate' || rating === 'easy') stats.correct++;

  // Only update FSRS if we're in Due Now mode
  const sessionConfig = getState('sessionConfig') || {};
  if (sessionConfig.deckType === 'dueNow') {
    await wordStore.updateWordAfterFlashcard(currentCard.id, rating)
      .catch(err => console.error('[flashcard-mode] updateWordAfterFlashcard failed:', err));
  }

  // Miss and Hard cards still recirculate in all modes (for practice)
  if (rating === 'miss' || rating === 'hard') {
    cardQueue.push({ ...currentCard });
  }

  renderNextCard();
}

function updateHUD() {
  const accuracyEl = document.getElementById('hud-accuracy');
  const seenEl = document.getElementById('hud-seen');
  const queueEl = document.getElementById('hud-queue');

  if (!accuracyEl || !seenEl || !queueEl) return;

  const accuracy = stats.seen > 0
    ? utils.calculateAccuracyPercent(stats.correct, stats.seen)
    : 0;

  accuracyEl.textContent = `${accuracy}%`;
  seenEl.textContent = stats.seen;
  queueEl.textContent = cardQueue.length;
}

function bindEvents() {
  const endBtn = document.getElementById('end-review-btn');
  if (endBtn) endBtn.onclick = () => navigate('main-menu');

  const cardOuter = document.querySelector('#flashcard-mode .card-outer');
  if (cardOuter) {
    cardOuter.onclick = handleCardTap;
    cardOuter.style.userSelect = 'none';
    cardOuter.style.webkitTapHighlightColor = 'transparent';
  }

  const missBtn = document.getElementById('btn-miss');
  if (missBtn) missBtn.onclick = () => handleRating('miss');

  const hardBtn = document.getElementById('btn-hard');
  if (hardBtn) hardBtn.onclick = () => handleRating('hard');

  const moderateBtn = document.getElementById('btn-moderate');
  if (moderateBtn) moderateBtn.onclick = () => handleRating('moderate');

  const easyBtn = document.getElementById('btn-easy');
  if (easyBtn) easyBtn.onclick = () => handleRating('easy');
}
async function endDueNowSession() {
  // Calculate when the next due words will appear
  const allWords = await wordStore.getAllUnlockedWords().catch(() => []);
  const now = Date.now();
  const futureDueTimes = allWords
    .map(w => w.srsNextReviewAt)
    .filter(t => typeof t === 'number' && t > now);

  pushProgressToCloud()

  let nextDueText = 'later';
  if (futureDueTimes.length > 0) {
    const earliest = Math.min(...futureDueTimes);
    const hours = Math.ceil((earliest - now) / (1000 * 60 * 60));

    if (hours < 24) {
      nextDueText = `in ${hours} hour${hours === 1 ? '' : 's'}`;
    } else {
      const days = Math.ceil(hours / 24);
      nextDueText = days === 1 ? 'tomorrow' : `in ${days} days`;
    }
  }

  // Store toast data in state so main-menu can show it reliably
  setState('pendingDueNowToast', { nextDueText });

  navigate('main-menu');
}
