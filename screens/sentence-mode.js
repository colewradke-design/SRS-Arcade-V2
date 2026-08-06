/**
 * screens/sentence-mode.js
 * Main gameplay screen for Sentence Mode (practice only).
 * Never writes fsrs*, leitnerGroup, or game* fields.
 */

import { navigate } from '../core/router.js';
import { getSetting } from '../db/settings-store.js';
import { logAttempt } from '../db/sentence-store.js';
import { createPrompt, evaluateUserTranslation } from '../engine/sentence-engine.js';

let currentPrompt = null;   // { promptText, targetWordIds }
let complexity = 'single';
let isEvaluating = false;
let lastResult = null;      // evaluation result for the current round

function renderLoading(message = 'Generating sentence…') {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <div id="screen-sentence-mode" class="screen sentence-mode-screen">
      <div class="sentence-loading">
        <div class="loading-text">${message}</div>
      </div>
    </div>
  `;
}

function renderPrompt() {
  const app = document.getElementById('app');
  if (!app || !currentPrompt) return;

  app.innerHTML = `
    <div id="screen-sentence-mode" class="screen sentence-mode-screen">
      <div class="sentence-header">
        <div class="sentence-mode-label">SENTENCE MODE</div>
        <button type="button" id="exit-btn" class="btn btn-exit">EXIT</button>
      </div>

      <div class="sentence-prompt-panel">
        <div class="prompt-label">Translate into your language</div>
        <div class="prompt-text" id="prompt-text">${escapeHtml(currentPrompt.promptText)}</div>
      </div>

      <div class="sentence-input-panel">
        <textarea
          id="translation-input"
          class="translation-input"
          placeholder="Type your translation here…"
          rows="4"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
        ></textarea>
      </div>

      <div class="sentence-actions">
        <button type="button" id="submit-btn" class="btn btn-primary">Check Translation</button>
        <button type="button" id="skip-btn" class="btn">Skip</button>
      </div>
    </div>
  `;

  bindPromptEvents();
  const input = document.getElementById('translation-input');
  if (input) {
    input.focus();
  }
}

function renderResult() {
  const app = document.getElementById('app');
  if (!app || !lastResult || !currentPrompt) return;

  const isCorrect = lastResult.correct;
  const statusClass = isCorrect ? 'result-correct' : 'result-incorrect';
  const statusLabel = isCorrect ? 'CORRECT' : 'INCORRECT';

  const feedbackHtml = lastResult.feedback
    ? `<div class="result-feedback">${escapeHtml(lastResult.feedback)}</div>`
    : '';

  const examples = (lastResult.correctedExamples || []).slice(0, 3);
  const examplesHtml = examples.length
    ? `<div class="result-examples">
         <div class="examples-label">${isCorrect ? 'Alternatives' : 'Corrected examples'}</div>
         <ul class="examples-list">
           ${examples.map(ex => `<li>${escapeHtml(ex)}</li>`).join('')}
         </ul>
       </div>`
    : '';

  app.innerHTML = `
    <div id="screen-sentence-mode" class="screen sentence-mode-screen">
      <div class="sentence-header">
        <div class="sentence-mode-label">SENTENCE MODE</div>
        <button type="button" id="exit-btn" class="btn btn-exit">EXIT</button>
      </div>

      <div class="result-panel ${statusClass}">
        <div class="result-status">${statusLabel}</div>
        ${feedbackHtml}
        ${examplesHtml}
      </div>

      <div class="sentence-prompt-panel result-original">
        <div class="prompt-label">Original</div>
        <div class="prompt-text">${escapeHtml(currentPrompt.promptText)}</div>
      </div>

      <div class="sentence-actions">
        <button type="button" id="next-btn" class="btn btn-primary">Next Sentence</button>
        <button type="button" id="exit-btn-2" class="btn">Back to Menu</button>
      </div>
    </div>
  `;

  bindResultEvents();
}

function bindPromptEvents() {
  const submitBtn = document.getElementById('submit-btn');
  const skipBtn = document.getElementById('skip-btn');
  const exitBtn = document.getElementById('exit-btn');
  const input = document.getElementById('translation-input');

  if (submitBtn) {
    submitBtn.addEventListener('click', onSubmit);
  }
  if (skipBtn) {
    skipBtn.addEventListener('click', () => startRound());
  }
  if (exitBtn) {
    exitBtn.addEventListener('click', () => navigate('main-menu'));
  }
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSubmit();
      }
    });
  }
}

function bindResultEvents() {
  const nextBtn = document.getElementById('next-btn');
  const exitBtn = document.getElementById('exit-btn');
  const exitBtn2 = document.getElementById('exit-btn-2');

  if (nextBtn) nextBtn.addEventListener('click', () => startRound());
  if (exitBtn) exitBtn.addEventListener('click', () => navigate('main-menu'));
  if (exitBtn2) exitBtn2.addEventListener('click', () => navigate('main-menu'));
}

async function onSubmit() {
  if (isEvaluating || !currentPrompt) return;

  const input = document.getElementById('translation-input');
  const userAnswer = (input?.value || '').trim();
  if (!userAnswer) return;

  isEvaluating = true;
  renderLoading('Evaluating…');

  try {
    lastResult = await evaluateUserTranslation(
      currentPrompt.promptText,
      userAnswer,
      complexity
    );

    // Log the attempt (practice only)
    await logAttempt({
      complexity,
      promptText: currentPrompt.promptText,
      targetWordIds: currentPrompt.targetWordIds || [],
      userTranslation: userAnswer,
      correct: lastResult.correct,
      feedback: lastResult.feedback,
      correctedExamples: lastResult.correctedExamples,
      wordsUsedCorrectly: lastResult.wordsUsedCorrectly,
      wordsMissed: lastResult.wordsMissed
    });

    renderResult();
  } catch (err) {
    console.error('[sentence-mode] evaluation failed:', err);
    // Surface a retry path
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = `
        <div id="screen-sentence-mode" class="screen sentence-mode-screen">
          <div class="sentence-error">
            <div class="error-title">Evaluation failed</div>
            <div class="error-msg">Could not reach the model. Try again.</div>
            <button type="button" id="retry-btn" class="btn btn-primary">Retry</button>
            <button type="button" id="exit-btn" class="btn">Back to Menu</button>
          </div>
        </div>
      `;
      document.getElementById('retry-btn')?.addEventListener('click', onSubmit);
      document.getElementById('exit-btn')?.addEventListener('click', () => navigate('main-menu'));
    }
  } finally {
    isEvaluating = false;
  }
}

async function startRound() {
  isEvaluating = false;
  lastResult = null;
  currentPrompt = null;
  renderLoading('Generating sentence…');

  try {
    currentPrompt = await createPrompt(complexity);
    renderPrompt();
  } catch (err) {
    console.error('[sentence-mode] prompt generation failed:', err);
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = `
        <div id="screen-sentence-mode" class="screen sentence-mode-screen">
          <div class="sentence-error">
            <div class="error-title">Could not generate sentence</div>
            <div class="error-msg">${escapeHtml(err.message || 'Unknown error')}</div>
            <button type="button" id="retry-btn" class="btn btn-primary">Try Again</button>
            <button type="button" id="exit-btn" class="btn">Back to Menu</button>
          </div>
        </div>
      `;
      document.getElementById('retry-btn')?.addEventListener('click', startRound);
      document.getElementById('exit-btn')?.addEventListener('click', () => navigate('main-menu'));
    }
  }
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Screen entry point.
 */
export async function init() {
  const stored = await getSetting('sentenceComplexity');
  complexity = (stored === 'single' || stored === 'multi' || stored === 'paragraph')
    ? stored
    : 'single';

  await startRound();
}
