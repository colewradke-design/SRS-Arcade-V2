import { navigate } from '../core/router.js';
import { getState, setState } from '../core/state.js';
import * as wordStore from '../db/word-store.js';
import { getDueCount } from '../engine/srs.js';
import { masterDeck, getUnitWords } from '../vocab/vocab.js';

let selectedDeck = 'master';
let selectedUnits = [];
let selectedDirection = 'native-to-english';  // NEW: flashcard direction
let dueWordCount = 0;
let unlockedUnitNumbers = new Set();
let allUnlockedWords = [];

function renderScreen() {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <div class="screen flashcard-options-screen">
      <div class="config-header">
        <h1 class="screen-title">Flashcard Mode</h1>
        <p class="screen-subtitle">Choose your review</p>
      </div>

      <div class="config-body">
        <div class="unit-study-section">
          <div class="section-label">Deck Type</div>
          <div class="segmented-control" role="tablist">
            <button type="button" class="segment-btn" data-deck="master">All Words</button>
            <button type="button" class="segment-btn" data-deck="unit">Unit Study</button>
            <button type="button" class="segment-btn" data-deck="dueNow" id="due-now-btn">Due Now</button>
          </div>
        </div>

        <!-- NEW: Direction selector -->
        <div class="unit-study-section">
          <div class="section-label">Flashcard Direction</div>
          <div class="segmented-control" role="tablist" id="direction-control">
            <button type="button" class="segment-btn" data-direction="native-to-english">NATIVE → ENGLISH</button>
            <button type="button" class="segment-btn" data-direction="english-to-native">ENGLISH → NATIVE</button>
          </div>
        </div>

        <div id="unit-grid-container" class="unit-study-section hidden">
          <div class="section-label">Unlocked Units</div>
          <div class="unit-grid"></div>
        </div>

        <div id="error-msg" class="inline-error hidden"></div>
      </div>

      <div class="config-actions">
        <button id="start-btn" class="btn btn-primary" disabled>Start Flashcards</button>
        <button id="back-btn" class="btn">Back to Menu</button>
      </div>
    </div>
  `;
}

function populateUnitGrid() {
  const container = document.getElementById('unit-grid-container');
  if (!container) return;

  let grid = container.querySelector('.unit-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.className = 'unit-grid';
    container.appendChild(grid);
  }

  grid.innerHTML = '';

  if (unlockedUnitNumbers.size === 0) {
    grid.innerHTML = '<p style="padding:12px; color:var(--color-text-muted);">No unlocked units available.</p>';
    return;
  }

  const sortedUnits = Array.from(unlockedUnitNumbers).sort((a, b) => a - b);

  sortedUnits.forEach(unitNum => {
    const wordCount = allUnlockedWords.filter(w => w.unit === unitNum).length;
    const isSelected = selectedUnits.includes(unitNum);

    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `unit-tile btn ${isSelected ? 'selected' : ''}`;
    tile.dataset.unit = String(unitNum);

    tile.innerHTML = `
        <div class="unit-index">UNIT ${unitNum}</div>
        <div class="unit-count">${wordCount} words</div>
    `;

    grid.appendChild(tile);
  });
}

async function setupInitialUI() {
  try {
    const allWords = await wordStore.getAllUnlockedWords().catch(() => []);
    allUnlockedWords = allWords;
    dueWordCount = getDueCount(allWords || []);

    // Only include units that have at least one unlocked word
    unlockedUnitNumbers = new Set(allWords.map(w => w.unit));

    document.querySelectorAll('.segment-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.deck === selectedDeck);
    });

    // NEW: Direction control setup
    const dirBtns = document.querySelectorAll('#direction-control .segment-btn');
    dirBtns.forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.direction === selectedDirection);
    });

    const dueBtn = document.getElementById('due-now-btn');
    if (dueBtn) {
      dueBtn.textContent = dueWordCount > 0 ? `Due Now (${dueWordCount})` : 'Due Now (0)';
      dueBtn.disabled = dueWordCount === 0;
    }

    const unitContainer = document.getElementById('unit-grid-container');
    if (unitContainer) {
      if (selectedDeck === 'unit') {
        unitContainer.classList.remove('hidden');
        populateUnitGrid();
      } else {
        unitContainer.classList.add('hidden');
      }
    }

    if (dueWordCount > 0 && selectedDeck === 'master') {
      selectedDeck = 'dueNow';
      document.querySelectorAll('.segment-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.deck === 'dueNow');
      });
      if (unitContainer) unitContainer.classList.add('hidden');
    }

    updateStartButtonState();
  } catch (err) {
    console.error('[flashcard-options] setupInitialUI error:', err);
  }
}

function bindEvents() {
  // Deck buttons
  document.querySelectorAll('.segment-btn[data-deck]').forEach(btn => {
    btn.onclick = () => {
      const deck = btn.dataset.deck;
      if (deck && deck !== selectedDeck) selectDeck(deck);
    };
  });

  // NEW: Direction buttons
  document.querySelectorAll('#direction-control .segment-btn').forEach(btn => {
    btn.onclick = () => {
      const dir = btn.dataset.direction;
      if (dir && dir !== selectedDirection) selectDirection(dir);
    };
  });

  const unitContainer = document.getElementById('unit-grid-container');
  if (unitContainer) {
    unitContainer.onclick = (e) => {
      const tile = e.target.closest('.unit-tile');
      if (tile) toggleUnitSelection(parseInt(tile.dataset.unit), tile);
    };
  }

  const startBtn = document.getElementById('start-btn');
  if (startBtn) startBtn.onclick = validateAndStart;

  const backBtn = document.getElementById('back-btn');
  if (backBtn) backBtn.onclick = () => navigate('main-menu');
}

function selectDeck(deck) {
  selectedDeck = deck;

  document.querySelectorAll('.segment-btn[data-deck]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.deck === deck);
  });

  const unitContainer = document.getElementById('unit-grid-container');
  if (unitContainer) {
    if (deck === 'unit') {
      unitContainer.classList.remove('hidden');
      populateUnitGrid();
    } else {
      unitContainer.classList.add('hidden');
    }
  }

  updateStartButtonState();
}

// NEW: Direction selector handler
function selectDirection(dir) {
  selectedDirection = dir;

  document.querySelectorAll('#direction-control .segment-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.direction === dir);
  });

  updateStartButtonState();
}

function toggleUnitSelection(unitNum, tile) {
  const idx = selectedUnits.indexOf(unitNum);
  if (idx > -1) {
    selectedUnits.splice(idx, 1);
    tile.classList.remove('selected');
  } else {
    selectedUnits.push(unitNum);
    tile.classList.add('selected');
  }
  updateStartButtonState();
}

function updateStartButtonState() {
  const btn = document.getElementById('start-btn');
  if (!btn) return;

  let canStart = selectedDeck === 'master' ||
                 (selectedDeck === 'unit' && selectedUnits.length > 0) ||
                 (selectedDeck === 'dueNow' && dueWordCount > 0);

  btn.disabled = !canStart;
  btn.textContent = selectedDeck === 'dueNow' ? 'REVIEW DUE WORDS' : 'Start Flashcards';
}

function validateAndStart() {
  if (selectedDeck === 'unit' && selectedUnits.length === 0) return;
  if (selectedDeck === 'dueNow' && dueWordCount === 0) return;

  setState('sessionConfig', {
    deckType: selectedDeck,
    selectedUnits: [...selectedUnits],
    flashcardDirection: selectedDirection  // NEW
  });

  navigate('flashcard-mode');
}

export async function init() {
  const saved = getState('sessionConfig');
  if (saved?.deckType) selectedDeck = saved.deckType;
  if (Array.isArray(saved?.selectedUnits)) selectedUnits = [...saved.selectedUnits];
  if (saved?.flashcardDirection) selectedDirection = saved.flashcardDirection;  // NEW

  renderScreen();
  await setupInitialUI();
  bindEvents();
}
