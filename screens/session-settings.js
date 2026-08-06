import { navigate } from '../core/router.js';
import { setState, getState } from '../core/state.js';
import * as wordStore from '../db/word-store.js';
import { getCurrentLanguage } from '../vocab/vocab.js';

// Internal tracking state (reset on every init for fresh configuration)
let selectedDeck = 'master';          // 'master' | 'unit'
let selectedUnit = null;              // number | null
let selectedChapters = [];            // number[] — only meaningful when selectedDeck === 'unit'
let selectedLength = 15;
let selectedReadingSpeed = 'normal';  // 'slow' | 'normal' | 'fast'
let selectedTypes = [];               // string[] of allowed word types (default = all)

// Cached from unlocked words
let allUnlockedWords = [];
let unlockedUnits = [];               // sorted unit numbers that have ≥1 unlocked word
let chaptersByUnit = {};              // unitNum → sorted array of chapter numbers with unlocked words
let chapterWordCounts = {};           // `${unit}-${chapter}` → count

const LENGTH_MIN = 3;
const LENGTH_MAX = 45;
const LENGTH_STEP = 3;

// Language-specific parts of speech (derived from actual vocab data)
const WORD_TYPES_KO = [
  'noun', 'pronoun', 'numeral',
  'verb', 'adjective', 'determiner',
  'adverb', 'particle', 'interjection'
];

const WORD_TYPES_DE = [
  'noun', 'pronoun', 'numeral',
  'verb', 'adjective', 'adverb',
  'preposition', 'conjunction', 'interjection'
];

const WORD_TYPE_LABELS = {
  noun: 'NOUN',
  pronoun: 'PRONOUN',
  numeral: 'NUMERAL',
  verb: 'VERB',
  adjective: 'ADJECTIVE',
  determiner: 'DETERMINER',
  adverb: 'ADVERB',
  particle: 'PARTICLE',
  interjection: 'INTERJECTION',
  preposition: 'PREPOSITION',
  conjunction: 'CONJUNCTION'
};

/** Returns the part-of-speech list for the currently active language. */
function getWordTypes() {
  const lang = getCurrentLanguage() || 'ko';
  return lang === 'de' ? WORD_TYPES_DE : WORD_TYPES_KO;
}

const MIN_POOL_SIZE = 5;

/**
 * Snap slider value to nearest valid 3-minute step.
 */
function snapLength(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 15;
  const snapped = Math.round(n / LENGTH_STEP) * LENGTH_STEP;
  return Math.min(LENGTH_MAX, Math.max(LENGTH_MIN, snapped));
}

function updateLengthLabel(container, minutes) {
  const label = container.querySelector('#length-value');
  if (label) label.textContent = `${minutes} MIN`;
}

/**
 * Build unlocked-unit / chapter maps from the current word pool.
 */
function rebuildMaps(words) {
  allUnlockedWords = words || [];
  const unitSet = new Set();
  const chMap = {};
  const counts = {};

  for (const w of allUnlockedWords) {
    if (w.unit == null) continue;
    unitSet.add(w.unit);
    if (w.chapter == null) continue;

    if (!chMap[w.unit]) chMap[w.unit] = new Set();
    chMap[w.unit].add(w.chapter);

    const key = `${w.unit}-${w.chapter}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  unlockedUnits = Array.from(unitSet).sort((a, b) => a - b);
  chaptersByUnit = {};
  for (const u of unlockedUnits) {
    chaptersByUnit[u] = Array.from(chMap[u] || []).sort((a, b) => a - b);
  }
  chapterWordCounts = counts;
}

/**
 * Projected word count after current unit/chapter + type filters.
 */
function getProjectedPoolSize() {
  let pool = allUnlockedWords;

  if (selectedDeck === 'unit' && selectedUnit != null) {
    const chapters = new Set(selectedChapters);
    pool = pool.filter(w => {
      if (w.unit !== selectedUnit) return false;
      if (chapters.size === 0) return true;
      return chapters.has(w.chapter);
    });
  }

  if (selectedTypes.length > 0 && selectedTypes.length < getWordTypes().length) {
    const allowed = new Set(selectedTypes);
    pool = pool.filter(w => !w.type || allowed.has(w.type));
  }

  return pool.length;
}

/**
 * Live validation — chapter selection + type filter pool size.
 */
function updateValidationState(container) {
  const chapterErrorEl = container.querySelector('#chapter-error');
  const typeErrorEl = container.querySelector('#type-error');
  const startBtn = container.querySelector('#start-btn');
  const chapterContainer = container.querySelector('#chapter-config');

  let isValid = true;
  let chapterMsg = '';
  let typeMsg = '';

  if (selectedDeck === 'unit') {
    if (selectedUnit == null || selectedChapters.length === 0) {
      isValid = false;
      chapterMsg = 'Select at least one chapter';
      if (chapterContainer) chapterContainer.classList.add('invalid');
    } else {
      if (chapterContainer) chapterContainer.classList.remove('invalid');
    }
  } else {
    if (chapterContainer) chapterContainer.classList.remove('invalid');
  }

  if (selectedTypes.length === 0) {
    isValid = false;
    typeMsg = 'Select at least one word type';
  } else {
    const poolSize = getProjectedPoolSize();
    if (poolSize < MIN_POOL_SIZE) {
      isValid = false;
      typeMsg = `Only ${poolSize} word${poolSize === 1 ? '' : 's'} match — need at least ${MIN_POOL_SIZE}`;
    }
  }

  if (chapterErrorEl) {
    chapterErrorEl.textContent = chapterMsg;
    chapterErrorEl.classList.toggle('error', !!chapterMsg);
  }
  if (typeErrorEl) {
    typeErrorEl.textContent = typeMsg;
    typeErrorEl.classList.toggle('error', !!typeMsg);
  }

  if (startBtn) {
    startBtn.disabled = !isValid;
  }
}

/**
 * Update the accordion header label to reflect current selection.
 */
function updateAccordionHeader(container) {
  const labelEl = container.querySelector('#deck-current-label');
  if (!labelEl) return;

  if (selectedDeck === 'master' || selectedUnit == null) {
    labelEl.textContent = 'ALL VOCAB';
  } else {
    labelEl.textContent = `UNIT ${selectedUnit}`;
  }
}

/**
 * Close the accordion.
 */
function closeAccordion(container) {
  const toggle = container.querySelector('#deck-accordion-toggle');
  const body = container.querySelector('#deck-accordion-body');
  if (toggle && body) {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.classList.remove('open');
    body.hidden = true;
  }
}

/**
 * Update the Word Types summary text.
 */
function updateTypeSummary(container) {
  const summaryEl = container.querySelector('#type-summary');
  if (!summaryEl) return;

  if (selectedTypes.length === 0) {
    summaryEl.textContent = 'NONE';
  } else if (selectedTypes.length === getWordTypes().length) {
    summaryEl.textContent = 'ALL';
  } else if (selectedTypes.length <= 3) {
    summaryEl.textContent = selectedTypes
      .map(t => WORD_TYPE_LABELS[t] || t.toUpperCase())
      .join(' + ');
  } else {
    summaryEl.textContent = `${selectedTypes.length} TYPES`;
  }
}

/**
 * Populate the accordion body list (ALL VOCAB + unlocked units).
 */
function populateDeckList(container) {
  const list = container.querySelector('#deck-option-list');
  if (!list) return;

  let html = `
    <button type="button" class="deck-option ${selectedDeck === 'master' ? 'selected' : ''}" data-deck="master">
      <span class="deck-option-label">ALL VOCAB (MASTER DECK)</span>
    </button>
  `;

  for (const unitNum of unlockedUnits) {
    const isSelected = selectedDeck === 'unit' && selectedUnit === unitNum;
    const wordCount = allUnlockedWords.filter(w => w.unit === unitNum).length;
    html += `
      <button type="button" class="deck-option ${isSelected ? 'selected' : ''}" data-deck="unit" data-unit="${unitNum}">
        <span class="deck-option-label">UNIT ${unitNum}</span>
        <span class="deck-option-count">${wordCount} words</span>
      </button>
    `;
  }

  list.innerHTML = html;
}

/**
 * Populate the chapter grid for the currently selected unit.
 * All chapters start selected.
 */
function populateChapterGrid(container) {
  const grid = container.querySelector('#chapter-grid');
  const config = container.querySelector('#chapter-config');
  if (!grid || !config) return;

  if (selectedDeck !== 'unit' || selectedUnit == null) {
    config.classList.add('hidden');
    grid.innerHTML = '';
    return;
  }

  const chapters = chaptersByUnit[selectedUnit] || [];
  if (chapters.length === 0) {
    grid.innerHTML = '<p class="empty-chapters">No unlocked chapters in this unit.</p>';
    config.classList.remove('hidden');
    selectedChapters = [];
    updateValidationState(container);
    return;
  }

  // Default: all chapters selected
  selectedChapters = [...chapters];

  grid.innerHTML = chapters.map(ch => {
    const count = chapterWordCounts[`${selectedUnit}-${ch}`] || 0;
    return `
      <button type="button" class="unit-tile selected" data-chapter="${ch}">
        <div class="unit-index">CH ${ch}</div>
        <div class="unit-count">${count} words</div>
      </button>
    `;
  }).join('');

  config.classList.remove('hidden');
  updateValidationState(container);
}

/**
 * Handle selection of a deck option (master or a specific unit).
 */
function selectDeckOption(container, deck, unitNum = null) {
  selectedDeck = deck;
  selectedUnit = deck === 'unit' ? unitNum : null;
  selectedChapters = [];

  // Update visual selected state in the list
  container.querySelectorAll('.deck-option').forEach(btn => {
    const isMatch =
      (deck === 'master' && btn.dataset.deck === 'master') ||
      (deck === 'unit' && btn.dataset.deck === 'unit' && Number(btn.dataset.unit) === unitNum);
    btn.classList.toggle('selected', isMatch);
  });

  updateAccordionHeader(container);
  closeAccordion(container);
  populateChapterGrid(container);
  updateValidationState(container);
}

/**
 * Toggle a single chapter tile.
 */
function toggleChapter(container, chapterNum, tileEl) {
  const idx = selectedChapters.indexOf(chapterNum);
  if (idx > -1) {
    selectedChapters.splice(idx, 1);
    tileEl.classList.remove('selected');
  } else {
    selectedChapters.push(chapterNum);
    tileEl.classList.add('selected');
  }
  updateValidationState(container);
}

/**
 * Toggle a single word-type chip.
 */
function toggleType(container, type, chipEl) {
  const idx = selectedTypes.indexOf(type);
  if (idx > -1) {
    selectedTypes.splice(idx, 1);
    chipEl.classList.remove('selected');
  } else {
    selectedTypes.push(type);
    chipEl.classList.add('selected');
  }
  updateTypeSummary(container);
  updateValidationState(container);
}

/**
 * Select all types / clear all types.
 */
function setAllTypes(container, selectAll) {
  if (selectAll) {
    selectedTypes = [...getWordTypes()];
  } else {
    selectedTypes = [];
  }
  container.querySelectorAll('.type-chip').forEach(chip => {
    chip.classList.toggle('selected', selectAll);
  });
  updateTypeSummary(container);
  updateValidationState(container);
}

/**
 * Wire all interactive elements.
 */
function bindEvents(container) {
  // Accordion toggle (deck)
  const toggle = container.querySelector('#deck-accordion-toggle');
  const body = container.querySelector('#deck-accordion-body');
  if (toggle && body) {
    toggle.addEventListener('click', () => {
      const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!isExpanded));
      body.hidden = isExpanded;
      toggle.classList.toggle('open', !isExpanded);
    });
  }

  // Word Types accordion toggle
  const typeToggle = container.querySelector('#type-accordion-toggle');
  const typeBody = container.querySelector('#type-accordion-body');
  if (typeToggle && typeBody) {
    typeToggle.addEventListener('click', () => {
      const isExpanded = typeToggle.getAttribute('aria-expanded') === 'true';
      typeToggle.setAttribute('aria-expanded', String(!isExpanded));
      typeBody.hidden = isExpanded;
      typeToggle.classList.toggle('open', !isExpanded);
    });
  }

  // Deck option selection (event delegation)
  const list = container.querySelector('#deck-option-list');
  if (list) {
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.deck-option');
      if (!btn) return;
      const deck = btn.dataset.deck;
      if (deck === 'master') {
        selectDeckOption(container, 'master');
      } else if (deck === 'unit') {
        const unitNum = parseInt(btn.dataset.unit, 10);
        if (Number.isFinite(unitNum)) {
          selectDeckOption(container, 'unit', unitNum);
        }
      }
    });
  }

  // Chapter tiles (event delegation)
  const chapterGrid = container.querySelector('#chapter-grid');
  if (chapterGrid) {
    chapterGrid.addEventListener('click', (e) => {
      const tile = e.target.closest('.unit-tile');
      if (!tile || selectedDeck !== 'unit') return;
      const ch = parseInt(tile.dataset.chapter, 10);
      if (Number.isFinite(ch)) {
        toggleChapter(container, ch, tile);
      }
    });
  }

  // Type chips (event delegation)
  const typeGrid = container.querySelector('#type-grid');
  if (typeGrid) {
    typeGrid.addEventListener('click', (e) => {
      const chip = e.target.closest('.type-chip');
      if (!chip) return;
      const type = chip.dataset.type;
      if (type) {
        toggleType(container, type, chip);
      }
    });
  }

  // Select All / Clear types
  const selectAllBtn = container.querySelector('#type-select-all');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => setAllTypes(container, true));
  }
  const clearBtn = container.querySelector('#type-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => setAllTypes(container, false));
  }

  // Reading speed
  const readingControl = container.querySelector('#reading-speed-control');
  if (readingControl) {
    readingControl.querySelectorAll('.seg-option').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedReadingSpeed = btn.dataset.speed;
        readingControl.querySelectorAll('.seg-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
  }

  // Session length slider
  const lengthSlider = container.querySelector('#length-slider');
  if (lengthSlider) {
    lengthSlider.addEventListener('input', () => {
      selectedLength = snapLength(lengthSlider.value);
      updateLengthLabel(container, selectedLength);
    });
  }

  // Start
  const startBtn = container.querySelector('#start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      updateValidationState(container);
      if (startBtn.disabled) return;

      setState('sessionConfig', {
        deckType: selectedDeck,
        selectedUnit: selectedDeck === 'unit' ? selectedUnit : null,
        selectedChapters: selectedDeck === 'unit' ? [...selectedChapters] : [],
        selectedTypes: [...selectedTypes],
        readingSpeed: selectedReadingSpeed,
        sessionLength: selectedLength
      });
      navigate('main-game');
    });
  }

  // Back
  const backBtn = container.querySelector('#back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      navigate('main-menu');
    });
  }
}

/**
 * Build datalist ticks for the length slider.
 */
function buildLengthTicksHTML() {
  let opts = '';
  for (let m = LENGTH_MIN; m <= LENGTH_MAX; m += LENGTH_STEP) {
    opts += `<option value="${m}"></option>`;
  }
  return opts;
}

/**
 * Build the 3×3 type chip grid HTML.
 */
function buildTypeGridHTML() {
  return getWordTypes().map(t => {
    const isSelected = selectedTypes.includes(t);
    return `
      <button type="button" class="type-chip ${isSelected ? 'selected' : ''}" data-type="${t}">
        ${WORD_TYPE_LABELS[t] || t.toUpperCase()}
      </button>
    `;
  }).join('');
}

/**
 * Main entry point called by router.
 */
export async function init() {
  // Reset
  selectedDeck = 'master';
  selectedUnit = null;
  selectedChapters = [];
  selectedLength = 15;
  selectedReadingSpeed = 'normal';
  selectedTypes = [...getWordTypes()];   // always start with all types (no persistence)

  // Restore previous session settings if present (types intentionally not restored)
  const saved = getState('sessionConfig');
  if (saved) {
    if (saved.readingSpeed) selectedReadingSpeed = saved.readingSpeed;
    if (saved.sessionLength) selectedLength = snapLength(saved.sessionLength);

    // Prefer new shape
    if (saved.deckType === 'unit' && saved.selectedUnit != null) {
      selectedDeck = 'unit';
      selectedUnit = Number(saved.selectedUnit);
      if (Array.isArray(saved.selectedChapters)) {
        selectedChapters = [...saved.selectedChapters];
      }
    } else if (saved.deckType === 'unit' && Array.isArray(saved.selectedUnits) && saved.selectedUnits.length > 0) {
      // Legacy fallback — take first unit
      selectedDeck = 'unit';
      selectedUnit = Number(saved.selectedUnits[0]);
    } else {
      selectedDeck = 'master';
      selectedUnit = null;
    }
  }

  // Load unlocked words and build maps
  try {
    const words = await wordStore.getAllUnlockedWords().catch(() => []);
    rebuildMaps(words);
  } catch (err) {
    console.error('[session-settings] Failed to load unlocked words:', err);
    rebuildMaps([]);
  }

  // If restored unit is no longer unlocked, fall back to master
  if (selectedDeck === 'unit' && (selectedUnit == null || !unlockedUnits.includes(selectedUnit))) {
    selectedDeck = 'master';
    selectedUnit = null;
    selectedChapters = [];
  }

  const app = document.getElementById('app');
  if (!app) {
    console.error('[session-settings] #app container not found');
    return;
  }

  let container = document.getElementById('screen-session-settings');
  if (!container) {
    container = document.createElement('div');
    container.id = 'screen-session-settings';
    container.className = 'screen session-settings-screen';
    app.appendChild(container);
  }

  const currentLabel = (selectedDeck === 'unit' && selectedUnit != null)
    ? `UNIT ${selectedUnit}`
    : 'ALL VOCAB';

  container.innerHTML = `
    <div class="session-settings-content">
      <!-- Top navigation -->
      <div class="screen-header">
        <h1 class="screen-title">SESSION SETTINGS</h1>
      </div>

      <!-- Deck Selection Accordion -->
      <div class="deck-panel accordion-panel">
        <div class="section-label">DECK SELECTION</div>
        <button type="button" class="accordion-header" id="deck-accordion-toggle"
                aria-expanded="false" aria-controls="deck-accordion-body">
          <span class="accordion-title">DECK</span>
          <span class="accordion-current" id="deck-current-label">${currentLabel}</span>
          <span class="accordion-chevron" aria-hidden="true">▼</span>
        </button>
        <div class="accordion-body" id="deck-accordion-body" hidden>
          <div class="deck-option-list" id="deck-option-list">
            <!-- populated by populateDeckList -->
          </div>
        </div>
      </div>

      <!-- Chapter Selection Grid (shown only when a unit is chosen) -->
      <div id="chapter-config" class="unit-study-section hidden">
        <div class="section-label">SELECT CHAPTERS</div>
        <div class="unit-grid" id="chapter-grid">
          <!-- populated by populateChapterGrid -->
        </div>
        <div id="chapter-error" class="validation-error"></div>
      </div>

      <!-- Word Types Accordion (3×3 chip grid) -->
      <div class="type-panel accordion-panel">
        <div class="section-label">WORD TYPES</div>
        <button type="button" class="accordion-header" id="type-accordion-toggle"
                aria-expanded="false" aria-controls="type-accordion-body">
          <span class="accordion-title">TYPES</span>
          <span class="accordion-current" id="type-summary">ALL</span>
          <span class="accordion-chevron" aria-hidden="true">▼</span>
        </button>
        <div class="accordion-body" id="type-accordion-body" hidden>
          <div class="type-grid" id="type-grid">
            ${buildTypeGridHTML()}
          </div>
          <div class="type-actions">
            <button type="button" class="type-action-btn" id="type-select-all">SELECT ALL</button>
            <button type="button" class="type-action-btn" id="type-clear">CLEAR</button>
          </div>
          <div id="type-error" class="validation-error"></div>
        </div>
      </div>

      <!-- Reading Speed -->
      <div class="reading-speed-section">
        <div class="section-label">READING SPEED</div>
        <div class="segmented-control" id="reading-speed-control">
          <button class="seg-option" data-speed="slow">SLOW</button>
          <button class="seg-option selected" data-speed="normal">NORMAL</button>
          <button class="seg-option" data-speed="fast">FAST</button>
        </div>
        <div class="section-hint">How fast the blocks fall. Normal is recommended.</div>
      </div>

      <!-- Session Length Slider -->
      <div class="time-selector-section">
        <div class="section-label">SESSION LENGTH</div>
        <div class="time-slider-container">
          <div class="time-slider-value" id="length-value">${selectedLength} MIN</div>
          <input
            type="range"
            id="length-slider"
            class="arcade-slider"
            min="${LENGTH_MIN}"
            max="${LENGTH_MAX}"
            step="${LENGTH_STEP}"
            value="${selectedLength}"
            list="length-ticks"
            aria-label="Session length in minutes"
          />
          <datalist id="length-ticks">
            ${buildLengthTicksHTML()}
          </datalist>
          <div class="slider-range-labels">
            <span>${LENGTH_MIN} MIN</span>
            <span>${LENGTH_MAX} MIN</span>
          </div>
        </div>
      </div>

      <!-- Primary Action -->
      <div class="action-bar">
        <button id="start-btn" class="btn btn-primary btn-large">
          START SESSION
        </button>
        <button id="back-btn" class="btn">BACK TO MAIN MENU</button>
      </div>
    </div>
  `;

  // Populate dynamic lists
  populateDeckList(container);

  // If we restored a unit, show its chapters (and respect any previously saved selectedChapters)
  if (selectedDeck === 'unit' && selectedUnit != null) {
    const available = chaptersByUnit[selectedUnit] || [];
    // Keep only chapters that still exist; if none of the saved ones remain, select all
    if (selectedChapters.length > 0) {
      selectedChapters = selectedChapters.filter(ch => available.includes(ch));
    }
    if (selectedChapters.length === 0) {
      selectedChapters = [...available];
    }

    // Manually build the grid with the restored selection state
    const grid = container.querySelector('#chapter-grid');
    const config = container.querySelector('#chapter-config');
    if (grid && config && available.length > 0) {
      grid.innerHTML = available.map(ch => {
        const count = chapterWordCounts[`${selectedUnit}-${ch}`] || 0;
        const isSelected = selectedChapters.includes(ch);
        return `
          <button type="button" class="unit-tile ${isSelected ? 'selected' : ''}" data-chapter="${ch}">
            <div class="unit-index">CH ${ch}</div>
            <div class="unit-count">${count} words</div>
          </button>
        `;
      }).join('');
      config.classList.remove('hidden');
    }
  }

  // Wire interactions
  bindEvents(container);
  updateTypeSummary(container);
  updateValidationState(container);

  // Restore reading-speed visual state
  const readingControl = container.querySelector('#reading-speed-control');
  if (readingControl) {
    readingControl.querySelectorAll('.seg-option').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.speed === selectedReadingSpeed);
    });
  }
}
