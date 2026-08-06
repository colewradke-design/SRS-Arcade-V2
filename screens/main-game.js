import { navigate } from '../core/router.js';
import * as state from '../core/state.js';
import * as wordStore from '../db/word-store.js';
import * as sessionStore from '../db/session-store.js';
import { db } from '../db/db.js';
import * as spawner from '../engine/spawner.js';
import * as phaseManager from '../engine/phase-manager.js';
import * as speedController from '../engine/speed-controller.js';
import * as progression from '../engine/progression.js';
import { formatTime, calculateAccuracyPercent, detectTextLanguage } from '../core/utils.js';
import {
  playCorrect,
  playWrong,
  playSessionEnd,
  playUnlock
} from '../assets/sounds/sounds.js';

// ==================== MODULE STATE ====================
let sessionConfig = null;
let words = [];
let activeBlock = null;
let blockState = { y: 0 };
let animationFrameId = null;
let spawnTime = 0;
let lastFrameTime = 0;
let timerInterval = null;
let currentPhase = 'decoding';
let previousPhase = null;
let sessionEnding = false;
let isPaused = false;
let fieldHeight = 600;
let blockHeight = 90;
let activeBlockEl = null;
let laneEls = [];
let unlocksThisSession = 0;

let pauseOverlayEl = null;
let unlockBannerEl = null;

// ==================== RESET STATE ====================
function resetModuleState() {
  sessionConfig = null;
  words = [];
  activeBlock = null;
  blockState = { y: 0 };
  animationFrameId = null;
  spawnTime = 0;
  lastFrameTime = 0;
  timerInterval = null;
  currentPhase = 'decoding';
  previousPhase = null;
  sessionEnding = false;
  isPaused = false;
  fieldHeight = 600;
  blockHeight = 90;
  activeBlockEl = null;
  laneEls = [];
  unlocksThisSession = 0;
  pauseOverlayEl = null;
  unlockBannerEl = null;
}

// ==================== RENDER ====================
function renderScreen() {
  const app = document.getElementById('app');
  if (!app) throw new Error('Fatal: #app mount point not found in DOM');

  let screen = document.getElementById('screen-main-game');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'screen-main-game';
    screen.className = 'screen active';
    app.appendChild(screen);
  }

  // === FIX: Make sure this screen is visible and on top ===
  screen.removeAttribute('hidden');
  screen.style.display = '';
  screen.style.visibility = 'visible';

  screen.innerHTML = `
    <div id="game-hud">
      <div class="hud-left">
        <button id="pause-btn" class="btn icon-btn" aria-label="Pause">⏸</button>
        <!-- DEV BUTTON -->
        <button id="dev-next-phase-btn" class="btn icon-btn" 
          style="font-size:9px; padding:2px 8px; min-height:32px; min-width:32px; border-color:var(--color-text-muted); color:var(--color-text-muted);">
          +5m
        </button>
        <span class="hud-phase-badge" id="hud-phase">Decoding</span>
      </div>
      <div class="hud-center">
        <span class="hud-timer" id="hud-timer">15:00</span>
      </div>
      <div class="hud-right">
        <div class="hud-streak-group">
          <span class="hud-label">streak</span>
          <span class="hud-value" id="hud-streak">0</span>
        </div>
        <div class="hud-streak-group">
          <span class="hud-label">best</span>
          <span class="hud-value" id="hud-best">0</span>
        </div>
      </div>
    </div>
    <div id="game-field"></div>
  `;

  const gameField = document.getElementById('game-field');
  if (!gameField) throw new Error('Failed to create #game-field');

  gameField.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const lane = document.createElement('div');
    lane.className = `lane lane-${i}`;
    lane.dataset.index = String(i);
    gameField.appendChild(lane);
  }

  activeBlockEl = document.createElement('div');
  activeBlockEl.id = 'active-block';
  activeBlockEl.className = 'block';
  activeBlockEl.style.display = 'none';
  activeBlockEl.style.position = 'absolute';
  activeBlockEl.style.left = '0';
  activeBlockEl.style.width = '100%';
  activeBlockEl.style.top = '0';
  activeBlockEl.innerHTML = `
    <div class="block-target"></div>
    <div class="block-choices">
      <div class="block-choice" data-index="0"></div>
      <div class="block-choice" data-index="1"></div>
      <div class="block-choice" data-index="2"></div>
      <div class="block-choice" data-index="3"></div>
    </div>
  `;
  gameField.appendChild(activeBlockEl);

  laneEls = document.querySelectorAll('.lane');
  laneEls.forEach((lane, index) => {
    lane.addEventListener('click', () => handleLaneTap(index), { passive: true });
  });

  // === DEV: Next Phase Button ===
// === DEV: Advance time by 5 minutes ===
const devPhaseBtn = document.getElementById('dev-next-phase-btn');
if (devPhaseBtn) {
  devPhaseBtn.addEventListener('click', () => {
    const current = state.getState('activeSession') || {};
    const newTime = Math.max(0, (current.timeRemaining || 0) - (5 * 60));

    state.setState('activeSession', {
      ...current,
      timeRemaining: newTime
    });

    updateHUD();
    console.log(`[DEV] +5 minutes → ${newTime}s remaining`);
  });
}
  
  const pauseBtn = document.getElementById('pause-btn');
  if (pauseBtn) pauseBtn.addEventListener('click', togglePause);

  fieldHeight = gameField.clientHeight || Math.floor(window.innerHeight * 0.82);
  if (fieldHeight < 200) fieldHeight = 520;
  blockHeight = 90;
}

// ==================== CORE GAME FUNCTIONS ====================
function flashLane(laneEl, wasCorrect) {
  if (!laneEl) return;
  const cls = wasCorrect ? 'correct' : 'incorrect';
  laneEl.classList.add(cls);
  setTimeout(() => laneEl.classList.remove(cls), 320);
}

function showFeedback(wasCorrect) {
  wasCorrect ? playCorrect() : playWrong();
}
  
function updateHUD() {
  const active = state.getState('activeSession') || {};
  const timeRemaining = active.timeRemaining || 0;

  const phaseEl = document.getElementById('hud-phase');
  if (phaseEl) {
    phaseEl.textContent = phaseManager.getPhaseName(currentPhase);
    phaseEl.className = `hud-phase-badge phase-${currentPhase}`;
  }

  const timerEl = document.getElementById('hud-timer');
  if (timerEl) {
    timerEl.textContent = formatTime(timeRemaining);
    timerEl.classList.toggle('urgent', timeRemaining < 60);
  }

  const streakEl = document.getElementById('hud-streak');
  const bestEl = document.getElementById('hud-best');
  if (streakEl) streakEl.textContent = active.streak || 0;
  if (bestEl) bestEl.textContent = active.bestStreak || 0;
}

function animationLoop(timestamp) {
  if (!activeBlockEl || isPaused || sessionEnding || !activeBlock) return;

  const deltaTime = timestamp - lastFrameTime;
  lastFrameTime = timestamp;

  const speed = speedController.getCurrentSpeed(currentPhase);
  blockState.y += speed * deltaTime;
  activeBlockEl.style.transform = `translateY(${blockState.y}px)`;

  if (blockState.y >= fieldHeight) {
    handleTimeout();
    return;
  }

  animationFrameId = requestAnimationFrame(animationLoop);
}

async function processAnswer(wasCorrect, timeToAnswer = null) {
  if (!activeBlock) return;

  if (timeToAnswer !== null) {
    speedController.recordAnswer(wasCorrect, timeToAnswer);
  }

  await wordStore.updateWordAfterMainGame(activeBlock.wordId, wasCorrect, timeToAnswer);

  const currentActive = state.getState('activeSession') || {};
  const newStreak = wasCorrect ? (currentActive.streak || 0) + 1 : 0;
  const newBestStreak = Math.max(currentActive.bestStreak || 0, newStreak);

  let unique = currentActive.uniqueWordsEncountered || [];
  if (!unique.includes(activeBlock.wordId)) unique = [...unique, activeBlock.wordId];

  state.setState('activeSession', {
    ...currentActive,
    blocksAnswered: (currentActive.blocksAnswered || 0) + 1,
    correctAnswers: (currentActive.correctAnswers || 0) + (wasCorrect ? 1 : 0),
    streak: newStreak,
    bestStreak: newBestStreak,
    uniqueWordsEncountered: unique
  });

  // Persist only bestStreak for crash recovery (minimal scope)
  if (newBestStreak > (currentActive.bestStreak || 0)) {
    sessionStore.saveFallModeBestStreak(newBestStreak);
  }

  updateHUD();

  // Delegate unlock logic to progression.js
  await progression.checkAndHandleUnlock();

  showFeedback(wasCorrect);
  removeBlock();

  sessionEnding ? endSession() : spawnBlock();
}

function handleLaneTap(laneIndex) {
  if (!activeBlock || isPaused || sessionEnding) return;

  cancelAnimationFrame(animationFrameId);
  animationFrameId = null;

  const timeToAnswer = performance.now() - spawnTime;
  const selectedChoice = activeBlock.choices[laneIndex];
  const wasCorrect = selectedChoice === activeBlock.correctAnswer;

  flashLane(laneEls[laneIndex], wasCorrect);
  processAnswer(wasCorrect, timeToAnswer);
}

function handleTimeout() {
  if (!activeBlock || isPaused) return;
  cancelAnimationFrame(animationFrameId);
  animationFrameId = null;
  processAnswer(false, null);
}

function removeBlock() {
  if (activeBlockEl) {
    activeBlockEl.style.display = 'none';
    activeBlockEl.style.transform = '';
    activeBlockEl.innerHTML = `
      <div class="block-target"></div>
      <div class="block-choices">
        <div class="block-choice" data-index="0"></div>
        <div class="block-choice" data-index="1"></div>
        <div class="block-choice" data-index="2"></div>
        <div class="block-choice" data-index="3"></div>
      </div>
    `;
  }
  activeBlock = null;
}

async function spawnBlock() {
  if (sessionEnding || isPaused) return;

  const prevWordId = activeBlock ? activeBlock.wordId : null;
  const wordProgress = spawner.getNextWord(prevWordId);

  if (!wordProgress || !wordProgress.id) {
    console.warn('main-game: spawner returned no word — ending session');
    sessionEnding = true;
    endSession();
    return;
  }

  const result = spawner.getTargetAndChoices(wordProgress, currentPhase);
  const { target, choices, correctAnswer, wordId } = result || {};

  if (!choices || choices.length !== 4 || !target) {
    console.error('main-game: invalid choices from spawner');
    sessionEnding = true;
    endSession();
    return;
  }

  activeBlock = { wordId, target, choices, correctAnswer };
  blockState.y = -blockHeight;
  spawnTime = performance.now();

  if (activeBlockEl) {
  const textSpan = activeBlockEl.querySelector('.block-target') || activeBlockEl;
  textSpan.textContent = target;
  textSpan.dataset.lang = detectTextLanguage(target);
  activeBlockEl.style.display = 'flex';
  activeBlockEl.style.transform = `translateY(${blockState.y}px)`;
}
  activeBlockEl.querySelectorAll('.block-choice').forEach((el, i) => {
    const text = choices[i] ?? '';
    el.textContent = text;

    // Set data-lang attribute dynamically (ko / en)
    const lang = detectTextLanguage(text);
    el.dataset.lang = lang;
  });

  lastFrameTime = performance.now();
  animationFrameId = requestAnimationFrame(animationLoop);
}

// ==================== TIMER & PAUSE ====================
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    if (isPaused || sessionEnding) return;

    const current = state.getState('activeSession') || {};
    let timeRemaining = Math.max(0, (current.timeRemaining || 0) - 1);

    state.setState('activeSession', { ...current, timeRemaining });

    const totalDuration = (sessionConfig.sessionLength || 15) * 60;
    const newPhase = phaseManager.getPhaseForTime(totalDuration, timeRemaining);

    if (newPhase !== currentPhase) {
      previousPhase = currentPhase;
      currentPhase = newPhase;
      phaseManager.onPhaseTransition(newPhase);
    }

    updateHUD();

    if (timeRemaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      sessionEnding = true;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      endSession();
    }
  }, 1000);
}

function togglePause() {
  isPaused = !isPaused;
  const pauseBtn = document.getElementById('pause-btn');
  if (pauseBtn) pauseBtn.textContent = isPaused ? '▶' : '⏸';

  if (isPaused) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (timerInterval) clearInterval(timerInterval);
    showPauseOverlay();
  } else {
    if (pauseOverlayEl) pauseOverlayEl.style.display = 'none';
    lastFrameTime = performance.now();
    if (activeBlockEl && activeBlockEl.style.display !== 'none' && activeBlock) {
      animationFrameId = requestAnimationFrame(animationLoop);
    }
    startTimer();
  }
}

function showPauseOverlay() {
  const screen = document.getElementById('screen-main-game');
  if (!screen) return;

  if (!pauseOverlayEl) {
    pauseOverlayEl = document.createElement('div');
    pauseOverlayEl.id = 'pause-overlay';
    pauseOverlayEl.innerHTML = `
      <div class="pause-content">
        <div class="pause-title">PAUSED</div>
        <button id="resume-btn" class="btn btn-primary">RESUME GAME</button>
        <button id="quit-btn" class="btn">QUIT TO MENU</button>
      </div>
    `;
    screen.appendChild(pauseOverlayEl);

    pauseOverlayEl.querySelector('#resume-btn').addEventListener('click', togglePause);
    pauseOverlayEl.querySelector('#quit-btn').addEventListener('click', () => {
      if (timerInterval) clearInterval(timerInterval);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      navigate('main-menu');
    });
  }
  pauseOverlayEl.style.display = 'flex';
}

// ==================== END SESSION ====================
async function endSession() {
  if (timerInterval) clearInterval(timerInterval);
  if (animationFrameId) cancelAnimationFrame(animationFrameId);

  const currentActive = state.getState('activeSession') || {};
  const accuracy = calculateAccuracyPercent(currentActive.correctAnswers || 0, currentActive.blocksAnswered || 0);

  const summaryData = {
    totalBlocks: currentActive.blocksAnswered || 0,
    accuracyPercent: accuracy,
    uniqueWordsCount: (currentActive.uniqueWordsEncountered || []).length,
    worstPerformingWords: await wordStore.getWorstPerformingWords(10),
    wordsUnlocked: unlocksThisSession
  };

  try {
    await sessionStore.saveSession({
      date: Date.now(),
      totalBlocks: summaryData.totalBlocks,
      accuracy: summaryData.accuracyPercent,
      duration: (sessionConfig.sessionLength || 15) * 60,
      uniqueWordsCount: summaryData.uniqueWordsCount
    });
  } catch (e) {
    console.warn('Failed to save session record:', e);
  }
  
  import('../db/sync-engine.js').then(sync => sync.pushToFirestore());
  
  sessionStore.clearSessionState();
  sessionStore.clearFallModeBestStreak(); // clear minimal recovery data on clean exit
  playSessionEnd();
  navigate('session-summary', summaryData);
}

// ==================== INIT ====================
export async function init() {
  resetModuleState();

  // === FIX: Aggressively hide all other screens (especially Session Settings) ===
  document.querySelectorAll('.screen, [id^="screen-"]').forEach(el => {
    if (el.id !== 'screen-main-game') {
      el.setAttribute('hidden', '');
      el.style.display = 'none';
    }
  });

  sessionConfig = state.getState('sessionConfig') || {
    deckType: 'master',
    selectedUnit: null,
    selectedChapters: [],
    selectedUnits: [],          // legacy (flashcard path)
    sessionLength: 15
  };

  words = await wordStore.getWordsForSession(sessionConfig);

  if (!words || words.length === 0) {
    console.error('main-game: no words loaded, aborting to main-menu');
    navigate('main-menu');
    return;
  }

  renderScreen();

  if (document.querySelectorAll('.lane').length !== 4) {
    throw new Error('Critical Initialization Failure: Game Lanes not rendered in DOM.');
  }

  // Resolve current chapter once so the spawner can apply the 2× weight boost
  const currentProgress = await progression.getCurrentChapterProgress();
  const currentChapterInfo = currentProgress
    ? { unitId: currentProgress.unitId, chapterId: currentProgress.chapterId }
    : null;

  spawner.buildQueue(words, currentChapterInfo);
  speedController.resetSpeed();

  const initialTime = (sessionConfig.sessionLength || 15) * 60;
  state.setState('activeSession', {
    phase: 'decoding',
    timeRemaining: initialTime,
    streak: 0,
    bestStreak: 0,
    blocksAnswered: 0,
    correctAnswers: 0,
    uniqueWordsEncountered: []
  });

  currentPhase = 'decoding';
  updateHUD();
  startTimer();
  spawnBlock();
}

export function cleanup() {
  if (timerInterval) clearInterval(timerInterval);
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  isPaused = true;
  sessionEnding = true;
}
