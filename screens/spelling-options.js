/**
 * screens/spelling-options.js
 * Entry point for Spelling Mode.
 * Allows choice between Spelling Practice and Hangul Search with appropriate settings.
 *
 * Defensive coding: null guards on every DOM query, graceful degradation if state/DB missing,
 * strict adherence to no new DB schema, only writes to settings via existing db.
 */

import { navigate } from '../core/router.js';
import { getState, setState } from '../core/state.js';
import { db } from '../db/db.js';
import * as wordStore from '../db/word-store.js';

let currentMode = 'practice'; // 'practice' | 'wordsearch'
let selectedDeck = 'master';
let selectedUnits = [];
let wordCount = 10;
let difficulty = 'guided';
let continuePuzzle = false;

let hasSavedPuzzle = false;
let unitWordCounts = {};

export async function init() {
  // Reset local state on every visit
  currentMode = 'practice';
  selectedDeck = 'master';
  selectedUnits = [];
  wordCount = 10;
  difficulty = 'guided';
  continuePuzzle = false;
  hasSavedPuzzle = false;

  const app = document.getElementById('app');
  if (!app) {
    console.error('[spelling-options] #app not found');
    return;
  }

  // Check for existing unfinished puzzle (for CONTINUE button state)
  try {
    const saved = await db.settings.get('activeSpellingPuzzle');
    hasSavedPuzzle = !!(saved && saved.value && saved.value.completed === false);
  } catch (e) {
    hasSavedPuzzle = false;
    console.warn('[spelling-options] Could not read activeSpellingPuzzle', e);
  }

  // Load unit word counts (used for unit grid)
  if (Object.keys(unitWordCounts).length === 0) {
    try {
      const all = await wordStore.getAllUnlockedWords().catch(() => []);
      for (let u = 1; u <= 14; u++) {
        unitWordCounts[u] = all.filter(w => w.unit === u).length;
      }
    } catch (e) {
      console.warn('[spelling-options] Failed to load unit counts', e);
    }
  }

  renderScreen(app);
  bindEvents(app);
  updateUIState(app);
}

function renderScreen(app) {
  let screen = document.getElementById('screen-spelling-options');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'screen-spelling-options';
    screen.className = 'screen spelling-options-screen';
    app.appendChild(screen);
  }

  screen.innerHTML = `
    <div class="spelling-options-content">
      <!-- Header -->
      <div class="screen-header">
        <h1 class="screen-title">SPELLING</h1>
      </div>

      <!-- Mode Selector -->
      <div class="mode-selector">
        <div class="settings-group">
          <div class="section-label">MODE SELECT</div>
          <div class="segmented-control">
            <button class="segment-btn selected" data-mode="practice">SPELLING PRACTICE</button>
            <button class="segment-btn" data-mode="wordsearch">WORD SEARCH</button>
          </div>
        </div>
      </div>

      <!-- Dynamic Settings Panel -->
      <div id="settings-panel" class="spelling-settings-panel"></div>

      <!-- Start Button -->
      <div class="start-button-container">
        <button id="start-btn" class="btn btn-primary start-btn">START</button>
        <button id="back-btn" class="btn" style="width:100%; max-width:420px; margin-top: var(--space-md);">MAIN MENU</button>
        <div id="validation-error" class="validation-error"></div>
      </div>
    </div>
  `;

  renderSettingsPanel(screen);
}

function renderSettingsPanel(screen) {
  const panel = screen.querySelector('#settings-panel');
  if (!panel) return;

  if (currentMode === 'practice') {
    panel.innerHTML = `
      <div class="settings-group">
        <div class="section-label">DECK MODE</div>
        <div class="segmented-control">
          <button class="segment-btn ${selectedDeck === 'master' ? 'selected' : ''}" data-deck="master">ALL WORDS</button>
          <button class="segment-btn ${selectedDeck === 'unit' ? 'selected' : ''}" data-deck="unit">UNIT STUDY</button>
        </div>
      </div>

      <div id="unit-grid-container" class="unit-grid-container ${selectedDeck === 'unit' ? '' : 'hidden'}">
        <div class="unit-grid" id="unit-grid"></div>
        <div id="unit-error" class="validation-error"></div>
      </div>
    `;
    renderUnitGrid(panel);
  } else {
    // Hangul Search settings
    panel.innerHTML = `
      <div class="settings-group">
        <div class="section-label">DECK MODE</div>
        <div class="segmented-control">
          <button class="segment-btn ${selectedDeck === 'master' ? 'selected' : ''}" data-deck="master">ALL WORDS</button>
          <button class="segment-btn ${selectedDeck === 'unit' ? 'selected' : ''}" data-deck="unit">UNIT STUDY</button>
        </div>
      </div>

      <div id="unit-grid-container" class="unit-grid-container ${selectedDeck === 'unit' ? '' : 'hidden'}">
        <div class="unit-grid" id="unit-grid"></div>
      </div>

      <div class="settings-group">
        <div class="section-label">WORD COUNT</div>
        <div class="segmented-control">
          <button class="segment-btn ${wordCount === 10 ? 'selected' : ''}" data-count="10">10 WORDS</button>
          <button class="segment-btn ${wordCount === 15 ? 'selected' : ''}" data-count="15">15 WORDS</button>
          <button class="segment-btn ${wordCount === 20 ? 'selected' : ''}" data-count="20">20 WORDS</button>
        </div>
      </div>

      <div class="settings-group">
        <div class="section-label">DIFFICULTY</div>
        <div class="segmented-control">
          <button class="segment-btn ${difficulty === 'guided' ? 'selected' : ''}" data-difficulty="guided">GUIDED</button>
          <button class="segment-btn ${difficulty === 'advanced' ? 'selected' : ''}" data-difficulty="advanced">ADVANCED</button>
        </div>
        <div class="section-hint">Guided shows the Hangul. Advanced shows only the English definition.</div>
      </div>

      <div class="settings-group">
        <div class="section-label">PUZZLE</div>
        <div class="segmented-control">
          <button id="continue-btn" class="segment-btn ${continuePuzzle ? 'selected' : ''}" data-puzzle="continue" ${hasSavedPuzzle ? '' : 'disabled style="opacity:0.35; pointer-events:none;"'}>CONTINUE</button>
          <button class="segment-btn ${!continuePuzzle ? 'selected' : ''}" data-puzzle="new">NEW</button>
        </div>
      </div>
    `;
    renderUnitGrid(panel);
  }
}

function renderUnitGrid(container) {
  const grid = container.querySelector('#unit-grid');
  if (!grid) return;

  const unlockedUnits = Object.keys(unitWordCounts)
    .map(Number)
    .filter(u => unitWordCounts[u] > 0)
    .sort((a, b) => a - b);

  if (unlockedUnits.length === 0) {
    grid.innerHTML = '<p style="color:var(--color-text-muted); padding:8px;">No unlocked units yet.</p>';
    return;
  }

  grid.innerHTML = unlockedUnits.map(unit => {
    const count = unitWordCounts[unit] || 0;
    const isSelected = selectedUnits.includes(unit);
    return `
      <div class="unit-tile ${isSelected ? 'selected' : ''}" data-unit="${unit}">
        <div class="unit-index">UNIT ${unit}</div>
        <div class="unit-count">${count} words</div>
      </div>
    `;
  }).join('');
}

function bindEvents(screen) {
  // Back button
  const backBtn = screen.querySelector('#back-btn');
  if (backBtn) backBtn.addEventListener('click', () => navigate('main-menu'));

  // Mode segmented control
  screen.addEventListener('click', (e) => {
    const modeBtn = e.target.closest('.segment-btn[data-mode]');
    if (modeBtn) {
      const newMode = modeBtn.dataset.mode;
      if (newMode !== currentMode) {
        currentMode = newMode;
        screen.querySelectorAll('.segment-btn[data-mode]').forEach(b => {
          b.classList.toggle('selected', b.dataset.mode === newMode);
        });
        // Reset some settings when switching modes
        if (currentMode === 'practice') {
          wordCount = 10;
          difficulty = 'guided';
          continuePuzzle = false;
        }
        renderSettingsPanel(screen);
        bindSettingsEvents(screen);
        updateUIState(screen);
      }
      return;
    }

    // Deck mode buttons
    const deckBtn = e.target.closest('.segment-btn[data-deck]');
    if (deckBtn) {
      selectedDeck = deckBtn.dataset.deck;
      if (selectedDeck === 'master') selectedUnits = [];
      renderSettingsPanel(screen);
      bindSettingsEvents(screen);
      updateUIState(screen);
      return;
    }

    // Word count buttons (wordsearch only)
    const countBtn = e.target.closest('.segment-btn[data-count]');
    if (countBtn) {
      wordCount = parseInt(countBtn.dataset.count, 10);
      renderSettingsPanel(screen);
      bindSettingsEvents(screen);
      return;
    }

    // Difficulty buttons
    const diffBtn = e.target.closest('.segment-btn[data-difficulty]');
    if (diffBtn) {
      difficulty = diffBtn.dataset.difficulty;
      renderSettingsPanel(screen);
      bindSettingsEvents(screen);
      return;
    }

    // Puzzle continue/new
    const puzzleBtn = e.target.closest('.segment-btn[data-puzzle]');
    if (puzzleBtn && !puzzleBtn.disabled) {
      continuePuzzle = puzzleBtn.dataset.puzzle === 'continue';
      renderSettingsPanel(screen);
      bindSettingsEvents(screen);
      return;
    }

    // Unit tile selection
    const unitTile = e.target.closest('.unit-tile[data-unit]');
    if (unitTile && selectedDeck === 'unit') {
      const unitNum = parseInt(unitTile.dataset.unit, 10);
      const idx = selectedUnits.indexOf(unitNum);
      if (idx > -1) {
        selectedUnits.splice(idx, 1);
        unitTile.classList.remove('selected');
      } else {
        selectedUnits.push(unitNum);
        unitTile.classList.add('selected');
      }
      updateUIState(screen);
    }
  });

  // Start button
  const startBtn = screen.querySelector('#start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (validateAndStart(screen)) {
        const config = {
          mode: currentMode,
          deckType: selectedDeck,
          selectedUnits: [...selectedUnits],
          wordCount,
          difficulty,
          continuePuzzle
        };
        setState('spellingConfig', config);
        const targetScreen = currentMode === 'practice' ? 'spelling-flashcard' : 'spelling-wordsearch';
        navigate(targetScreen);
      }
    });
  }

  bindSettingsEvents(screen);
}

function bindSettingsEvents(screen) {
  // Re-bind any dynamic elements if needed (segmented controls already handled by delegation above)
}

function updateUIState(screen) {
  if (!screen) return;

  const startBtn = screen.querySelector('#start-btn');
  const errorEl = screen.querySelector('#validation-error');
  const unitContainer = screen.querySelector('#unit-grid-container');

  if (!startBtn) return;

  let isValid = true;
  let errorMsg = '';

  if (selectedDeck === 'unit' && selectedUnits.length === 0) {
    isValid = false;
    errorMsg = 'Select at least one unit';
    if (unitContainer) unitContainer.classList.add('invalid');
  } else {
    if (unitContainer) unitContainer.classList.remove('invalid');
  }

  startBtn.disabled = !isValid;

  if (errorEl) {
    errorEl.textContent = errorMsg;
    errorEl.classList.toggle('error', !!errorMsg);
  }
}

function validateAndStart(screen) {
  updateUIState(screen);
  const startBtn = screen.querySelector('#start-btn');
  return startBtn && !startBtn.disabled;
}

function updateValidationState(container) {
  // Kept for compatibility with patterns in other settings screens
  updateUIState(container.closest('.screen') || document);
}
