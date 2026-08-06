/**
 * screens/spelling-flashcard.js
 * Spelling Practice mode — English definition shown, user types native word from memory.
 * 3 attempts per card. Syllable-level feedback. Missed cards recirculate.
 * Every card now requires a manual CONTINUE tap (success or failure).
 */

import { navigate } from '../core/router.js';
import { getState } from '../core/state.js';
import * as wordStore from '../db/word-store.js';
import { shuffle } from '../core/utils.js';
import { getCurrentLanguage } from '../vocab/vocab.js';

let cardQueue = [];
let currentCard = null;
let attemptCount = 0;
let sessionComplete = false;
let isRevealState = false;

export async function init() {
  cardQueue = [];
  currentCard = null;
  attemptCount = 0;
  sessionComplete = false;
  isRevealState = false;

  const app = document.getElementById('app');
  if (!app) {
    console.error('[spelling-flashcard] #app not found');
    navigate('main-menu');
    return;
  }

  const config = getState('spellingConfig') || { deckType: 'master', selectedUnits: [] };

  try {
    const progressWords = await wordStore.getWordsForSession(config).catch(() => []);
    if (!progressWords || progressWords.length === 0) {
      showErrorState(app, 'No words available for Spelling Practice.');
      return;
    }

    const resolved = await Promise.all(
      progressWords.map(pw => wordStore.resolveWord(pw.id).catch(() => null))
    ).then(r => r.filter(Boolean));

    if (resolved.length === 0) {
      showErrorState(app, 'Could not load word data.');
      return;
    }

    cardQueue = shuffle(resolved);
    const screen = renderScreen(app);
    renderNextCard();
    bindEvents(screen);
  } catch (err) {
    console.error('[spelling-flashcard] init failed', err);
    showErrorState(app, 'Failed to start Spelling Practice.');
  }
}

function showErrorState(app, message) {
  let screen = document.getElementById('screen-spelling-flashcard');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'screen-spelling-flashcard';
    screen.className = 'screen spelling-flashcard-screen';
    app.appendChild(screen);
  }
  screen.innerHTML = `
    <div class="spelling-error">
      <h2 class="screen-title">SPELLING PRACTICE</h2>
      <p style="color:var(--color-incorrect); text-align:center; margin: var(--space-xl) 0;">${message}</p>
      <button class="btn btn-primary" onclick="window.location.reload()">RETURN TO MENU</button>
    </div>
  `;
}

function renderScreen(app) {
  let screen = document.getElementById('screen-spelling-flashcard');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'screen-spelling-flashcard';
    screen.className = 'screen spelling-flashcard-screen';
    app.appendChild(screen);
  }

  screen.innerHTML = `
    <div class="spelling-hud">
      <button id="back-btn" class="btn icon-btn">BACK</button>
      <div class="screen-title" style="flex:1; text-align:center;">SPELLING PRACTICE</div>
      <div id="cards-left" class="hud-counter">0 LEFT</div>
    </div>

    <div class="spelling-card-area">
      <div class="card-outer" id="spelling-card">
        <div class="card-inner">
          <div class="card-face" id="card-face">
            <!-- Content injected by JS -->
          </div>
        </div>
      </div>

      <!-- Attempt dots -->
      <div class="attempt-dots" id="attempt-dots">
        <div class="attempt-dot" data-attempt="0"></div>
        <div class="attempt-dot" data-attempt="1"></div>
        <div class="attempt-dot" data-attempt="2"></div>
      </div>

      <!-- Input -->
          <input id="native-input" type="text" class="spelling-input" 
                      placeholder="Type the word..." autocomplete="off" autocapitalize="off" />

      <!-- Feedback area moved above submit button -->
          <div id="feedback-area" class="syllable-feedback" style="display:none;"></div>

          <button id="submit-btn" class="btn btn-primary spelling-submit">SUBMIT</button>
      <!-- CONTINUE button (shown on success and on 3rd failure) -->
      <button id="continue-btn" class="btn btn-primary" 
              style="display:none; min-height:56px; margin-top:var(--space-md); width:100%; max-width:420px;">
        CONTINUE
      </button>

      <!-- Fallback hint -->
      <div id="continue-hint" class="tap-to-continue" style="display:none;">TAP ANYWHERE TO CONTINUE</div>
    </div>
  `;

  return screen;
}

function renderNextCard() {
  const screen = document.getElementById('screen-spelling-flashcard');
  if (!screen) return;

  if (cardQueue.length === 0) {
    renderSessionComplete(screen);
    return;
  }

  currentCard = cardQueue.shift();
  attemptCount = 0;
  isRevealState = false;

  const counter = screen.querySelector('#cards-left');
  if (counter) counter.textContent = `${cardQueue.length} LEFT`;

  const face = screen.querySelector('#card-face');
  if (face) {
    face.innerHTML = `<span style="font-family:var(--font-display); font-size:var(--font-size-xl);">${currentCard.english || '—'}</span>`;
    face.classList.remove('flash-correct', 'flash-incorrect');
  }

  const input = screen.querySelector('#native-input');
  if (input) {
    input.value = '';
    input.disabled = false;
    input.focus();
  }

  const submit = screen.querySelector('#submit-btn');
  if (submit) submit.disabled = false;

  const dots = screen.querySelectorAll('.attempt-dot');
  dots.forEach(d => d.classList.remove('used'));

  const feedback = screen.querySelector('#feedback-area');
  if (feedback) {
    feedback.innerHTML = '';
    feedback.style.display = 'none';
  }

  const hint = screen.querySelector('#continue-hint');
  if (hint) hint.style.display = 'none';

  const continueBtn = screen.querySelector('#continue-btn');
  if (continueBtn) continueBtn.style.display = 'none';
}

function bindEvents(screen) {
  const backBtn = screen.querySelector('#back-btn');
  if (backBtn) backBtn.addEventListener('click', () => navigate('main-menu'));

  const input = screen.querySelector('#native-input');
  const submit = screen.querySelector('#submit-btn');

  const handleSubmit = () => {
    if (!currentCard || !input || input.disabled) return;
    const raw = input.value || '';
    if (!raw.trim()) return;
    processSubmission(raw, screen);
  };

  if (submit) submit.addEventListener('click', handleSubmit);
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSubmit();
    });
  }

  // Tap anywhere fallback (works when isRevealState is true)
  const cardArea = screen.querySelector('.spelling-card-area');
  if (cardArea) {
    cardArea.addEventListener('click', () => {
      if (isRevealState) {
        renderNextCard();
      }
    });
  }
// Keyboard popup detection (visualViewport) — squish content under HUD
  // so definition + input + syllable feedback stay visible above keyboard.
  // Only affects mobile phones (≤768px). Desktop look is unchanged.
  if (window.visualViewport) {
    const handleViewportResize = () => {
      const keyboardHeight = window.innerHeight - window.visualViewport.height;
      const isKeyboardOpen = keyboardHeight > 120; // reliable threshold
      screen.classList.toggle('keyboard-open', isKeyboardOpen);
    };
    window.visualViewport.addEventListener('resize', handleViewportResize);
    // Initial check
    setTimeout(handleViewportResize, 60);
  }
}

function processSubmission(rawInput, screen) {
  if (!currentCard) return;

  const normalize = (str) => str.trim().normalize('NFC');
  const userInput = normalize(rawInput);
  const correctNative = currentCard.cleanNative || currentCard.native || '';
  const correct = normalize(correctNative);
  const comparison = compareCharacters(userInput, correct);
  const allCorrect = comparison.every(c => c.correct);

  attemptCount++;
  fillAttemptDot(screen, attemptCount - 1);

  const feedbackArea = screen.querySelector('#feedback-area');
  const input = screen.querySelector('#native-input');
  const submit = screen.querySelector('#submit-btn');
  const card = screen.querySelector('#spelling-card');

  if (allCorrect) {
    // === SUCCESS: Show feedback then require CONTINUE ===
    if (card) {
      card.classList.add('flash-correct');
      setTimeout(() => card.classList.remove('flash-correct'), 800);
    }
    showSyllableFeedback(feedbackArea, comparison, true);
    if (input) input.disabled = true;
    if (submit) submit.disabled = true;

    // Show correct answer in the card
    const face = screen.querySelector('#card-face');
    if (face) {
      const nativeFont = getCurrentLanguage() === 'ko' ? 'var(--font-korean)' : 'var(--font-display)';
      face.innerHTML = `
        <div style="text-align:center;">
          <div style="font-family:var(--font-display); font-size:var(--font-size-sm); color:var(--color-correct); margin-bottom:6px;">CORRECT!</div>
          <div style="font-family:${nativeFont}; font-size:42px; font-weight:900;">${currentCard.native || ''}</div>
        </div>
      `;
    }

    isRevealState = true;

    const hint = screen.querySelector('#continue-hint');
    if (hint) hint.style.display = 'block';

    const continueBtn = screen.querySelector('#continue-btn');
    if (continueBtn) {
      continueBtn.style.display = 'block';
      continueBtn.onclick = () => {
        continueBtn.style.display = 'none';
        if (hint) hint.style.display = 'none';
        renderNextCard();
      };
    }
  } else {
    // === INCORRECT ===
    if (card) {
      card.classList.add('flash-incorrect');
      setTimeout(() => card.classList.remove('flash-incorrect'), 600);
    }

    showSyllableFeedback(feedbackArea, comparison, false);

    if (attemptCount < 3) {
      // Allow another try
      if (input) {
        input.value = '';
        input.focus();
      }
    } else {
      // === 3rd failure: reveal + require CONTINUE ===
      cardQueue.push(currentCard);

      if (input) input.disabled = true;
      if (submit) submit.disabled = true;

      const face = screen.querySelector('#card-face');
      if (face) {
        const nativeFont = getCurrentLanguage() === 'ko' ? 'var(--font-korean)' : 'var(--font-display)';
        face.innerHTML = `
          <div style="text-align:center;">
            <div style="font-family:var(--font-display); font-size:var(--font-size-md); margin-bottom:8px;">${currentCard.english || ''}</div>
            <div style="font-family:${nativeFont}; font-size:42px; font-weight:900;">${currentCard.native || ''}</div>
          </div>
        `;
      }

      isRevealState = true;

      const hint = screen.querySelector('#continue-hint');
      if (hint) hint.style.display = 'block';

      const continueBtn = screen.querySelector('#continue-btn');
      if (continueBtn) {
        continueBtn.style.display = 'block';
        continueBtn.onclick = () => {
          continueBtn.style.display = 'none';
          if (hint) hint.style.display = 'none';
          renderNextCard();
        };
      }
    }
  }
}

function compareCharacters(input, correct) {
  const inputChars = Array.from(input);
  const correctChars = Array.from(correct);
  const maxLen = Math.max(inputChars.length, correctChars.length);
  const result = [];

  for (let i = 0; i < maxLen; i++) {
    result.push({
      char: correctChars[i] || '',
      inputChar: inputChars[i] || '',
      correct: inputChars[i] === correctChars[i]
    });
  }
  return result;
}

function showSyllableFeedback(container, comparison, isFullCorrect) {
  if (!container) return;
  container.innerHTML = '';
  container.style.display = 'flex';

  comparison.forEach(item => {
    const block = document.createElement('div');
    block.className = `syllable-block ${item.correct ? 'correct' : 'incorrect'}`;
    block.textContent = item.inputChar || ' ';
    container.appendChild(block);
  });
}

function fillAttemptDot(screen, index) {
  const dots = screen.querySelectorAll('.attempt-dot');
  if (dots[index]) dots[index].classList.add('used');
}

function renderSessionComplete(screen) {
  screen.innerHTML = `
    <div class="spelling-complete">
      <h1 class="screen-title">SESSION COMPLETE</h1>
      <div style="height:120px;"></div>
      <button id="back-to-menu-btn" class="btn btn-primary" style="min-width:220px;">BACK TO MAIN MENU</button>
    </div>
  `;

  const backBtn = screen.querySelector('#back-to-menu-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => navigate('main-menu'));
  }
}
