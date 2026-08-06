/**
 * screens/onboarding.js
 * First-launch onboarding flow for Vocab Trainer PWA.
 * Contains: Intro → Language selection → Optional assessment → Placement result.
 * All assessment seeding goes through progression.seedChapterWords().
 */
import { navigate } from '../core/router.js';
import { db } from '../db/db.js';
import { getSetting, setSetting, setUserLanguage } from '../db/settings-store.js';
import * as wordStore from '../db/word-store.js';
import { getChapterWords, initVocab } from '../vocab/vocab.js';
import { seedChapterWords, UNIT_COMPLETE_THRESHOLD } from '../engine/progression.js';
import { shuffle } from '../core/utils.js';

const AVAILABLE_LANGUAGES = [
  { code: 'ko', label: '한국어 (KOREAN)' },
  { code: 'de', label: 'DEUTSCH (GERMAN)' },
  // Future languages added here only
];

let currentStep = 'intro';
let selectedLanguageCode = 'ko'; // default first paint; require explicit tap before continuing
let assessmentState = {
  currentUnit: 1,
  currentChapter: 1,
  answeredInChapter: 0,
  correctInChapter: 0,
  totalInChapter: 0,
  targetCorrect: 0,
  isComplete: false,
  finalPlacement: null,
  isTransitioning: false
};

export async function init() {
  const app = document.getElementById('app');
  if (!app) return;
  document.documentElement.classList.add('theme-arcade');
  const mainMenu = document.getElementById('screen-main-menu');
  if (mainMenu) {
    mainMenu.setAttribute('hidden', '');
    mainMenu.style.display = 'none';
  }
  // Check if already completed (safety)
  const done = await getSetting('hasCompletedOnboarding');
  if (done === true) {
    navigate('main-menu');
    return;
  }

  renderScreen(app);
  bindEvents(app);
  showStep('intro');
}

function renderScreen(app) {
  let screen = document.getElementById('screen-onboarding');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'screen-onboarding';
    screen.className = 'screen onboarding-screen';
    app.appendChild(screen);
  }

  screen.removeAttribute('hidden');
  screen.style.display = 'block';
  screen.style.visibility = 'visible';
  screen.style.zIndex = '200';

  screen.innerHTML = `
    <div class="onboarding-container">

      <!-- INTRO STEP -->
      <div id="step-intro" class="onboarding-step" style="display:none;">
        <div class="onboarding-header">
          <h1 class="screen-title">WELCOME TO YOUR<br>VOCAB TRAINER</h1>
          <p class="subtitle">ARCADE-STYLE VOCAB MASTERY</p>
        </div>

        <div class="intro-content">
          <p>This app helps you master vocabulary through three core loops:</p>
         
          <div class="feature-list">
            <div class="feature-item">
              <span class="icon">▶</span>
              <span><strong>FALL MODE</strong> — Fast-paced practice that helps you remember words in 3 phases; DECODING (Native→English), RECOGNITION (English→Native), and BLITZ (Random X→X)</span>
            </div>
            <div class="feature-item">
              <span class="icon">📇</span>
              <span><strong>FLASHCARDS</strong> — Spaced repetition. The app tracks when you need to revisit words through a true FSRS algorithm to help lock words into long term memory.</span>
            </div>
            <div class="feature-item">
              <span class="icon">✏</span>
              <span><strong>SPELLING</strong> — Practice your spelling. You are given an English definition and you type the native word. Instant feedback on spelling errors.</span>
            </div>
          </div>

          <p>Words unlock automatically by growing the strength of your chapters and units in Fall Mode. Flashcards do not build strength. Your progress is saved locally and with an account also saved remotely.</p>
        </div>

        <div class="onboarding-actions">
          <button id="btn-continue-intro" class="btn btn-primary">CONTINUE</button>
          <button id="btn-have-account" class="btn" style="margin-top:var(--space-sm);">ALREADY HAVE AN ACCOUNT?</button>
        </div>
      </div>

      <!-- LANGUAGE STEP -->
      <div id="step-language" class="onboarding-step" style="display:none;">
        <div class="onboarding-header">
          <h1 class="screen-title">LANGUAGE</h1>
        </div>

        <div id="language-options" class="language-options">
          ${AVAILABLE_LANGUAGES.map(l => `
            <button class="language-option${l.code === selectedLanguageCode ? ' selected' : ''}" data-lang="${l.code}">
              ${l.label}
            </button>
          `).join('')}
        </div>

        <div class="onboarding-actions">
          <button id="btn-start-assessment" class="btn btn-primary">START QUICK ASSESSMENT</button>
          <button id="btn-skip-assessment" class="btn">SKIP — START WITH BASICS</button>
          <button id="btn-back-language" class="btn" style="margin-top:var(--space-sm);">RETURN</button>
        </div>
      </div>

      <!-- ASSESSMENT STEP -->
      <div id="step-assessment" class="onboarding-step" style="display:none;">
        <div class="onboarding-header">
          <h1 class="screen-title">SELF ASSESSMENT</h1>
          <p class="subtitle">RATE HOW WELL YOU KNOW EACH WORD</p>
        </div>

        <div class="assessment-card-area">
          <div class="assessment-progress" id="assessment-progress">UNIT 01 • CHAPTER 01 — 0 / 0</div>

          <div class="card-outer" id="assessment-card">
            <div class="card-inner" style="min-height:220px; display:flex; align-items:center; justify-content:center; border:3px solid var(--color-secondary); background:var(--color-surface); border-radius:var(--border-radius-sm);">
              <span id="assessment-word" style="font-family:var(--font-korean); font-size:42px; font-weight:900;"></span>
            </div>
          </div>

          <div class="rating-buttons" style="display:flex; gap:var(--space-sm); width:100%; max-width:420px; flex-wrap:wrap;">
            <button class="btn rating-btn btn-miss" data-rating="miss" style="flex:1; min-height:52px;">MISS</button>
            <button class="btn rating-btn btn-hard" data-rating="hard" style="flex:1; min-height:52px;">HARD</button>
            <button class="btn rating-btn btn-moderate" data-rating="moderate" style="flex:1; min-height:52px;">MODERATE</button>
            <button class="btn rating-btn btn-easy" data-rating="easy" style="flex:1; min-height:52px;">EASY</button>
          </div>

          <div id="assessment-feedback" class="assessment-feedback" style="display:none;"></div>
        </div>
      </div>

      <!-- RESULT STEP -->
      <div id="step-result" class="onboarding-step" style="display:none;">
        <div class="placement-result">
          <div class="big-number" id="result-chapter"></div>
          <div class="unit-label" id="result-unit"></div>
          <p style="margin-top:var(--space-lg); color:var(--color-text-muted);">
            Your starting point has been set.<br>
            All words up to this point are now unlocked.
          </p>
        </div>

        <div class="onboarding-actions">
          <button id="btn-finish-onboarding" class="btn btn-primary">CONTINUE TO MAIN MENU</button>
        </div>
      </div>

    </div>
  `;
}

function bindEvents(app) {
  // Intro
  app.querySelector('#btn-continue-intro')?.addEventListener('click', () => showStep('language'));
  app.querySelector('#btn-have-account')?.addEventListener('click', () => {
    navigate('login', { fromOnboarding: true });
  });

  // Language selection
  app.querySelectorAll('.language-option').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedLanguageCode = btn.dataset.lang;
      app.querySelectorAll('.language-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
  app.querySelector('#btn-start-assessment')?.addEventListener('click', startAssessment);
  app.querySelector('#btn-skip-assessment')?.addEventListener('click', skipAssessment);
  app.querySelector('#btn-back-language')?.addEventListener('click', () => showStep('intro'));

  // Assessment rating buttons (delegated)
  const ratingContainer = app.querySelector('.rating-buttons');
  if (ratingContainer) {
    ratingContainer.addEventListener('click', handleAssessmentRating);
  }

  // Finish
  app.querySelector('#btn-finish-onboarding')?.addEventListener('click', finishOnboarding);
}

function showStep(step) {
  document.querySelectorAll('.onboarding-step').forEach(el => el.style.display = 'none');
  const target = document.getElementById(`step-${step}`);
  if (target) target.style.display = 'block';
  currentStep = step;
}

/* ==================== ASSESSMENT LOGIC ==================== */

async function startAssessment() {
  // Persist language choice and load the corresponding vocabulary before assessment reads data
  await setUserLanguage(selectedLanguageCode);
  await initVocab(selectedLanguageCode);

  assessmentState = {
    currentUnit: 1,
    currentChapter: 1,
    answeredInChapter: 0,
    correctInChapter: 0,
    totalInChapter: 0,
    targetCorrect: 0,
    isComplete: false,
    finalPlacement: null,
    isTransitioning: false
  };

  showStep('assessment');
  await loadNextChapter();
}

async function loadNextChapter() {
  const { currentUnit, currentChapter } = assessmentState;

  // Stop if we've gone past the end of the content
  if (currentUnit > 14) {
    await showResultScreen();
    return;
  }

  const words = getChapterWords(currentUnit, currentChapter) || [];

  if (words.length === 0) {
    // Shouldn't happen based on your data, but safety net
    await showResultScreen();
    return;
  }

  assessmentState.totalInChapter = words.length;
  assessmentState.targetCorrect = Math.ceil(words.length * 0.8);
  assessmentState.answeredInChapter = 0;
  assessmentState.correctInChapter = 0;
  assessmentState.chapterWords = shuffle([...words]);
  assessmentState.currentWordIndex = 0;
  assessmentState.isTransitioning = false; // re-enable ratings for new chapter

  updateAssessmentProgress();
  showNextWordInAssessment();
}

function updateAssessmentProgress() {
  const el = document.getElementById('assessment-progress');
  if (!el) return;

  const { currentUnit, currentChapter, answeredInChapter, totalInChapter } = assessmentState;
  el.textContent = `UNIT ${String(currentUnit).padStart(2, '0')} • CHAPTER ${currentChapter} — ${answeredInChapter} / ${totalInChapter}`;
}

function showNextWordInAssessment() {
  const wordEl = document.getElementById('assessment-word');
  const feedback = document.getElementById('assessment-feedback');
  if (!wordEl || !feedback) return;

  feedback.style.display = 'none';

  const { chapterWords, currentWordIndex } = assessmentState;

  if (currentWordIndex >= chapterWords.length) {
    // Finished all words in chapter — evaluate
    assessmentState.isTransitioning = true;
    evaluateCurrentChapter();
    return;
  }

  const word = chapterWords[currentWordIndex];
  wordEl.textContent = word.native || '—';
  wordEl.dataset.wordId = word.id;
}

async function handleAssessmentRating(e) {
  const btn = e.target.closest('.rating-btn');
  if (!btn || !btn.dataset.rating) return;

  // Hard stop - prevent spamming ratings while transitioning between chapters
  if (assessmentState.isTransitioning) return;

  const rating = btn.dataset.rating;
  const isSuccess = rating === 'moderate' || rating === 'easy';

  assessmentState.answeredInChapter++;
  if (isSuccess) assessmentState.correctInChapter++;

  updateAssessmentProgress();

  const { answeredInChapter, totalInChapter, correctInChapter, targetCorrect } = assessmentState;

  const remaining = totalInChapter - answeredInChapter;
  const maxPossibleCorrect = correctInChapter + remaining;

  // "Good" point of no return — correct answers already banked guarantee ≥80% no matter what follows
  const alreadySecuredPass = correctInChapter >= targetCorrect;

  // "Bad" point of no return — even a perfect run on all remaining words can't reach 80%
  const cannotReach80 = maxPossibleCorrect < targetCorrect;

  // Fallback — every word in the chapter has been answered
  const chapterFullyAnswered = answeredInChapter >= totalInChapter;

  if (alreadySecuredPass || cannotReach80 || chapterFullyAnswered) {
    assessmentState.isTransitioning = true;
    await evaluateCurrentChapter();
  } else {
    // Continue to next word
    assessmentState.currentWordIndex++;
    showNextWordInAssessment();
  }
}

async function evaluateCurrentChapter() {
  const { currentUnit, currentChapter, correctInChapter, totalInChapter, targetCorrect } = assessmentState;

  const passed = correctInChapter >= targetCorrect;
  const displayRate = totalInChapter > 0 ? correctInChapter / totalInChapter : 0;

  // Show feedback to user
  const feedback = document.getElementById('assessment-feedback');
  if (feedback) {
    feedback.style.display = 'block';
    feedback.textContent = passed
      ? `CHAPTER PASSED — ${Math.round(displayRate * 100)}%`
      : `CHAPTER NOT PASSED — ${Math.round(displayRate * 100)}%`;
    feedback.className = `assessment-feedback ${passed ? '' : 'fail'}`;
  }

  if (passed) {
    // Seed the chapter the user just passed and record it as last-known-good
    try {
      await seedChapterWords(currentUnit, currentChapter, UNIT_COMPLETE_THRESHOLD);
      assessmentState.finalPlacement = { unit: currentUnit, chapter: currentChapter };
    } catch (err) {
      console.error('[onboarding] seedChapterWords failed', err);
    }

    // Advance to next chapter (global sequential chapter IDs: 1-4 = U1, 5-8 = U2, ...)
    assessmentState.currentChapter++;
    assessmentState.currentUnit = Math.floor((assessmentState.currentChapter - 1) / 4) + 1;

    // Load the next chapter (this will now correctly go into Unit 2+)
    setTimeout(async () => {
      await loadNextChapter();
    }, 900);
  } else {
    // Failed this chapter → placement becomes the failed chapter
    // (user has demonstrated competence up through the previous one and needs to learn this one)
    assessmentState.finalPlacement = { unit: currentUnit, chapter: currentChapter };
    assessmentState.isComplete = true;
    setTimeout(async () => {
      await showResultScreen();
    }, 1200);
  }
}

async function finishAssessmentSuccessfully() {
  // Fallback: use whatever placement was last recorded (failed chapter, or last passed if they cleared everything)
  const placement = assessmentState.finalPlacement || { unit: 1, chapter: 1 };

  assessmentState.finalPlacement = placement;
  assessmentState.isComplete = true;

  await showResultScreen();
}

async function showResultScreen() {
  const resultStep = document.getElementById('step-result');
  if (!resultStep) {
    console.error('[onboarding] #step-result not found in DOM');
    navigate('main-menu');
    return;
  }

  // Hide all other steps
  document.querySelectorAll('.onboarding-step').forEach(el => {
    el.style.display = 'none';
  });

  resultStep.style.display = 'block';

  const placement = assessmentState.finalPlacement || { unit: 1, chapter: 1 };

  // Ensure the placement chapter is seeded.
  // This covers the fail-on-first-chapter path where no seedChapterWords() call ever ran.
  try {
    await seedChapterWords(placement.unit, placement.chapter);
  } catch (err) {
    console.error('[onboarding] seed on result failed', err);
  }

  const chapterEl = document.getElementById('result-chapter');
  const unitEl = document.getElementById('result-unit');

  if (chapterEl) chapterEl.textContent = `CHAPTER ${placement.chapter}`;
  if (unitEl) unitEl.textContent = `UNIT ${String(placement.unit).padStart(2, '0')}`;
}

async function skipAssessment() {
  try {
    // Persist language choice and load the corresponding vocabulary before seeding
    await setUserLanguage(selectedLanguageCode);
    await initVocab(selectedLanguageCode);

    assessmentState.finalPlacement = { unit: 1, chapter: 1 };
    await seedChapterWords(1, 1);
    await setSetting('hasCompletedOnboarding', true);

    setTimeout(() => {
      window.location.reload();
    }, 400);
  } catch (err) {
    console.error('[onboarding] skipAssessment failed:', err);
    window.location.reload();
  }
}

async function finishOnboarding() {
  try {
    await setSetting('hasCompletedOnboarding', true);

    // Small delay so user sees the result screen
    setTimeout(() => {
      window.location.reload();
    }, 600);
  } catch (err) {
    console.error('[onboarding] finishOnboarding failed:', err);
    window.location.reload();
  }
}
