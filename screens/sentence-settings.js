/**
 * screens/sentence-settings.js
 * Pre-session settings for Sentence Mode.
 * Complexity picker only. Selection persists immediately via settings-store.
 */

import { navigate } from '../core/router.js';
import { getSetting, setSetting } from '../db/settings-store.js';

const COMPLEXITY_OPTIONS = [
  { value: 'single', label: 'ONE SENTENCE', desc: '1–2 target words · natural length' },
  { value: 'multi', label: 'MULTI-SENTENCE', desc: '2–4 target words · short scenario' },
  { value: 'paragraph', label: 'PARAGRAPH', desc: '4–6 target words · mini-narrative' }
];

let selectedComplexity = 'single';

async function loadPersisted() {
  const stored = await getSetting('sentenceComplexity');
  if (stored === 'single' || stored === 'multi' || stored === 'paragraph') {
    selectedComplexity = stored;
  } else {
    selectedComplexity = 'single';
  }
}

function renderScreen() {
  const app = document.getElementById('app');
  if (!app) return;

  const cardsHtml = COMPLEXITY_OPTIONS.map(opt => {
    const selected = opt.value === selectedComplexity ? ' selected' : '';
    return `
      <button type="button" class="complexity-card btn${selected}" data-complexity="${opt.value}">
        <div class="complexity-label">${opt.label}</div>
        <div class="complexity-desc">${opt.desc}</div>
      </button>
    `;
  }).join('');

  app.innerHTML = `
    <div id="screen-sentence-settings" class="screen sentence-settings-screen">
      <div class="config-header">
        <h1 class="screen-title">Sentence Mode</h1>
        <p class="screen-subtitle">Practice translating full sentences</p>
      </div>

      <div class="config-body">
        <div class="section-label">Complexity</div>
        <div class="complexity-grid" role="listbox" aria-label="Complexity">
          ${cardsHtml}
        </div>
      </div>

      <div class="config-actions">
        <button id="start-btn" class="btn btn-primary">Start Practice</button>
        <button id="back-btn" class="btn">Back to Menu</button>
      </div>
    </div>
  `;
}

function bindEvents() {
  const app = document.getElementById('app');
  if (!app) return;

  // Complexity cards — persist immediately
  app.querySelectorAll('.complexity-card').forEach(card => {
    card.addEventListener('click', async () => {
      const value = card.dataset.complexity;
      if (!value) return;

      selectedComplexity = value;
      await setSetting('sentenceComplexity', value);

      // Update visual selection
      app.querySelectorAll('.complexity-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.complexity === value);
      });
    });
  });

  const startBtn = app.querySelector('#start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      navigate('sentence-mode');
    });
  }

  const backBtn = app.querySelector('#back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      navigate('main-menu');
    });
  }
}

/**
 * Screen entry point called by router.
 */
export async function init() {
  await loadPersisted();
  renderScreen();
  bindEvents();
}
