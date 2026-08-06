// screens/options.js
// System Settings Panel — Theme / Unlock Batch / Unlock Chapters / App Update (all accordions)
// Follows all critical theme mutation rules, UI contracts, and failure point mitigations.
// Back button placed at bottom to match session-settings / flashcard-options pattern.

import * as router from '../core/router.js';
import { getTheme, setTheme, getSetting, setSetting } from '../db/settings-store.js';
import { unlockChaptersUpTo } from '../engine/progression.js';
import { getAvailableUnits, getChapterWords } from '../vocab/vocab.js';

const THEME_OPTIONS = [
  { id: 'theme-arcade',     label: 'ARCADE'},
  { id: 'theme-neo-geo',    label: 'NEO-GEO'},
  { id: 'theme-vectrex',    label: 'VECTREX'},
  { id: 'theme-famicom',    label: 'FAMICOM'},
  { id: 'theme-gameboy',    label: 'PIPBOY'},
  { id: 'theme-genesis',    label: 'GENESIS'},
  { id: 'theme-snes',       label: 'SUPER NES'},
  { id: 'theme-commodore',  label: 'COMMODORE'},
];

// =============================================================================
// THEME ENGINE
// =============================================================================

function applyThemeClass(themeId) {
  const root = document.documentElement;
  [...root.classList].forEach((cls) => {
    if (cls.startsWith('theme-')) root.classList.remove(cls);
  });
  root.classList.add(themeId);
}

function getThemeLabel(themeId) {
  const found = THEME_OPTIONS.find((t) => t.id === themeId);
  return found ? found.label : 'ARCADE';
}

function updateSelectedThemeButtons(screenEl, activeThemeId) {
  screenEl.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.themeId === activeThemeId);
  });
}

function updateThemeCurrentLabel(screenEl, themeId) {
  const labelEl = screenEl.querySelector('#theme-current-label');
  if (labelEl) {
    labelEl.textContent = getThemeLabel(themeId);
  }
}

async function handleThemeSelect(themeId, screenEl) {
  await setTheme(themeId);
  applyThemeClass(themeId);
  updateSelectedThemeButtons(screenEl, themeId);
  updateThemeCurrentLabel(screenEl, themeId);
}

function renderThemeGrid(screenEl, activeThemeId) {
  const grid = screenEl.querySelector('#theme-grid');
  if (!grid) return;

  grid.innerHTML = '';

  THEME_OPTIONS.forEach((theme) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `theme-btn btn ${theme.id === activeThemeId ? 'selected' : ''}`;
    btn.dataset.themeId = theme.id;
    btn.setAttribute('aria-label', `Select ${theme.label} theme`);

    btn.innerHTML = `
      <div class="theme-meta">
        <span class="theme-name">${theme.label}</span>
      </div>
    `;

    grid.appendChild(btn);
  });
}

// =============================================================================
// UPDATE ENGINE
// Preserves all IndexedDB word progress — only Cache Storage is cleared.
// =============================================================================

// State for the update UI — kept module-level so helpers can read/write it
// without passing screenEl through every call.
let _screenEl = null;

function setUpdateUI(state, message) {
  if (!_screenEl) return;
  const btn    = _screenEl.querySelector('#update-btn');
  const status = _screenEl.querySelector('#update-status');
  if (!btn || !status) return;

  // Reset classes
  status.className = 'update-status';

  switch (state) {
    case 'idle':
      btn.disabled        = false;
      btn.textContent     = 'CHECK FOR UPDATES';
      status.textContent  = message || '';
      break;

    case 'checking':
      btn.disabled        = true;
      btn.textContent     = 'CHECKING...';
      status.textContent  = 'Contacting server...';
      status.classList.add('update-status--checking');
      break;

    case 'downloading':
      btn.disabled        = true;
      btn.textContent     = 'DOWNLOADING...';
      status.textContent  = 'New version found fetching update...';
      status.classList.add('update-status--checking');
      break;

    case 'applying':
      btn.disabled        = true;
      btn.textContent     = 'APPLYING...';
      status.textContent  = 'Clearing old cache your progress is safe...';
      status.classList.add('update-status--checking');
      break;

    case 'up-to-date':
      btn.disabled        = false;
      btn.textContent     = 'CHECK FOR UPDATES';
      status.textContent  = '✓ Already up to date';
      status.classList.add('update-status--ok');
      // Auto-clear after 4 s
      setTimeout(() => setUpdateUI('idle', ''), 4000);
      break;

    case 'updated':
      btn.disabled        = true;
      btn.textContent     = 'RELOADING...';
      status.textContent  = 'Update applied reloading now...';
      status.classList.add('update-status--ok');
      break;

    case 'error':
      btn.disabled        = false;
      btn.textContent     = 'CHECK FOR UPDATES';
      status.textContent  = message || 'Update check failed. Are you online?';
      status.classList.add('update-status--error');
      setTimeout(() => setUpdateUI('idle', ''), 5000);
      break;

    case 'no-sw':
      btn.disabled        = true;
      btn.textContent     = 'UNAVAILABLE';
      status.textContent  = 'Service worker not supported in this browser.';
      status.classList.add('update-status--error');
      break;
  }
}

// Called once a waiting (or freshly installed) SW is ready to activate.
// Uses statechange listener on the waiting SW for better mobile PWA reliability.
function activateAndReload(waitingSW) {
  setUpdateUI('applying');

  // Tell the waiting SW to skip the waiting phase
  waitingSW.postMessage('SKIP_WAITING');

  // More reliable way: listen for when this page gets controlled by the new SW
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    setUpdateUI('updated');

    // Force a hard reload with cache busting
    setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('updated', Date.now());
      window.location.replace(url.toString()); // use replace() instead of href
    }, 150);
  }, { once: true });
}

async function checkForUpdates() {
  if (!('serviceWorker' in navigator)) {
    setUpdateUI('no-sw');
    return;
  }

  setUpdateUI('checking');

  let reg;
  try {
    reg = await navigator.serviceWorker.getRegistration();
  } catch (err) {
    console.error('[options] SW getRegistration failed:', err);
    setUpdateUI('error', '✗ Could not reach service worker.');
    return;
  }

  if (!reg) {
    setUpdateUI('error', '✗ No service worker registered yet.');
    return;
  }

  // If there's already a SW waiting (installed but not yet active), use it.
  if (reg.waiting) {
    activateAndReload(reg.waiting);
    return;
  }

  // Ask the browser to fetch the SW file and compare it to the installed copy.
  // If the file has changed (even one byte), the browser installs the new SW.
  setUpdateUI('downloading');
  try {
    await reg.update();
  } catch (err) {
    console.error('[options] reg.update() failed:', err);
    setUpdateUI('error', '✗ Network error during update check.');
    return;
  }

  if (reg.waiting) {
    // New SW finished installing while we waited
    activateAndReload(reg.waiting);
    return;
  }

  if (reg.installing) {
    // New SW is still downloading — wait for it to reach 'installed'
    setUpdateUI('downloading');
    reg.installing.addEventListener('statechange', function onStateChange(e) {
      if (e.target.state === 'installed') {
        e.target.removeEventListener('statechange', onStateChange);
        activateAndReload(e.target);
      } else if (e.target.state === 'redundant') {
        e.target.removeEventListener('statechange', onStateChange);
        setUpdateUI('error', '✗ Update failed during install.');
      }
    });
    return;
  }

  // reg.update() found no change — already on the latest version
  setUpdateUI('up-to-date');
}

// Reads the running cache version from the SW and displays it
async function displayCurrentVersion(screenEl) {
  const versionEl = screenEl.querySelector('#sw-version');
  if (!versionEl) return;

  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    versionEl.textContent = '';
    return;
  }

  // One-shot message listener for the VERSION reply
  const versionPromise = new Promise((resolve) => {
    const handler = (event) => {
      if (event.data && event.data.type === 'VERSION') {
        navigator.serviceWorker.removeEventListener('message', handler);
        resolve(event.data.version);
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    // Timeout fallback if SW never replies
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', handler);
      resolve(null);
    }, 2000);
  });

  navigator.serviceWorker.controller.postMessage('GET_VERSION');
  const version = await versionPromise;
  versionEl.textContent = version ? `CACHE: ${version}` : '';
}

// =============================================================================
// EVENT BINDING
// =============================================================================

// =============================================================================
// ACCORDION HELPER (shared by all panels)
// =============================================================================

function bindAccordionToggle(screenEl, toggleId, bodyId) {
  const toggle = screenEl.querySelector(`#${toggleId}`);
  const body = screenEl.querySelector(`#${bodyId}`);
  if (!toggle || !body) return;

  toggle.addEventListener('click', () => {
    const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!isExpanded));
    body.hidden = isExpanded;
    toggle.classList.toggle('open', !isExpanded);
  });
}

// =============================================================================
// CHAPTER UNLOCK PANEL
// Chapters are GLOBAL sequential. Unit N owns global chapters (N-1)*4+1 … N*4.
// Selecting Unit 2 surfaces chapters 5-8; unlock still seeds 1..target across units.
// =============================================================================

/** Global chapter range that belongs to a unit (validated against vocab). */
function getChapterRangeForUnit(unitId) {
  const start = (Number(unitId) - 1) * 4 + 1;
  const end = Number(unitId) * 4;
  const chapters = [];
  for (let ch = start; ch <= end; ch++) {
    if ((getChapterWords(unitId, ch) || []).length > 0) {
      chapters.push(ch);
    }
  }
  // Fallback so the slider never has min > max
  if (chapters.length === 0) {
    chapters.push(start);
  }
  return chapters;
}

function populateChapterUnitSelect(screenEl, selectedUnit) {
  const select = screenEl.querySelector('#chapter-unit-select');
  if (!select) return;

  select.innerHTML = '';
  const units = getAvailableUnits();
  if (!units.length) {
    const opt = document.createElement('option');
    opt.value = '1';
    opt.textContent = 'UNIT 1';
    select.appendChild(opt);
    return;
  }

  units.forEach((unitNum) => {
    const opt = document.createElement('option');
    opt.value = String(unitNum);
    opt.textContent = `UNIT ${unitNum}`;
    if (unitNum === selectedUnit) opt.selected = true;
    select.appendChild(opt);
  });
}

/**
 * @param {number} unitId
 * @param {number} [preferredChapter]  Global chapter to try to select (clamped to unit range)
 */
function updateChapterSlider(screenEl, unitId, preferredChapter) {
  const slider = screenEl.querySelector('#chapter-slider');
  const valueEl = screenEl.querySelector('#chapter-value');
  const unlockBtn = screenEl.querySelector('#chapter-unlock-btn');
  const minLabel = screenEl.querySelector('#chapter-min-label');
  const maxLabel = screenEl.querySelector('#chapter-max-label');
  if (!slider || !valueEl) return;

  const range = getChapterRangeForUnit(unitId);
  const minCh = range[0];
  const maxCh = range[range.length - 1];

  slider.min = String(minCh);
  slider.max = String(maxCh);
  slider.step = '1';

  let selected = Number(preferredChapter);
  if (!Number.isInteger(selected) || selected < minCh || selected > maxCh) {
    selected = minCh;
  }
  slider.value = String(selected);
  valueEl.textContent = String(selected);

  if (minLabel) minLabel.textContent = String(minCh);
  if (maxLabel) maxLabel.textContent = String(maxCh);

  if (unlockBtn) {
    unlockBtn.textContent = `UNLOCK UP TO CHAPTER ${selected}`;
    unlockBtn.dataset.confirm = '0';
  }
}

function setChapterUnlockStatus(screenEl, message, isError = false) {
  const status = screenEl.querySelector('#chapter-unlock-status');
  if (!status) return;
  status.textContent = message || '';
  status.className = 'update-status' + (isError ? ' update-status--error' : message ? ' update-status--ok' : '');
  if (message) {
    setTimeout(() => {
      if (status.textContent === message) {
        status.textContent = '';
        status.className = 'update-status';
      }
    }, 4000);
  }
}

function bindChapterUnlockEvents(screenEl) {
  // Unit dropdown → refresh chapter range for that unit
  const unitSelect = screenEl.querySelector('#chapter-unit-select');
  if (unitSelect) {
    unitSelect.addEventListener('change', () => {
      const unit = Number(unitSelect.value) || 1;
      updateChapterSlider(screenEl, unit);
    });
  }

  // Chapter slider (values are already global chapter numbers)
  const slider = screenEl.querySelector('#chapter-slider');
  if (slider) {
    slider.addEventListener('input', () => {
      const ch = Number(slider.value);
      const valueEl = screenEl.querySelector('#chapter-value');
      if (valueEl) valueEl.textContent = String(ch);
      const btn = screenEl.querySelector('#chapter-unlock-btn');
      if (btn) {
        btn.dataset.confirm = '0';
        btn.textContent = `UNLOCK UP TO CHAPTER ${ch}`;
      }
    });
  }

  // Unlock button — two-tap confirm. Value is a global chapter id.
  const unlockBtn = screenEl.querySelector('#chapter-unlock-btn');
  if (unlockBtn) {
    unlockBtn.addEventListener('click', async () => {
      const ch = Number(screenEl.querySelector('#chapter-slider')?.value || 1);

      if (unlockBtn.dataset.confirm !== '1') {
        unlockBtn.dataset.confirm = '1';
        unlockBtn.textContent = 'TAP AGAIN TO CONFIRM';
        setTimeout(() => {
          if (unlockBtn.dataset.confirm === '1') {
            unlockBtn.dataset.confirm = '0';
            unlockBtn.textContent = `UNLOCK UP TO CHAPTER ${ch}`;
          }
        }, 3000);
        return;
      }

      unlockBtn.dataset.confirm = '0';
      unlockBtn.disabled = true;
      unlockBtn.textContent = 'UNLOCKING...';

      // Single global-chapter argument — seeds 1..ch across all units
      const result = await unlockChaptersUpTo(ch);

      unlockBtn.disabled = false;
      if (result.success) {
        const range = result.unlocked.length === 1
          ? `Chapter ${result.unlocked[0]}`
          : `Chapters ${result.unlocked[0]}–${result.unlocked[result.unlocked.length - 1]}`;
        setChapterUnlockStatus(
          screenEl,
          `Unlocked ${range} (now on Unit ${result.unitId}, Chapter ${result.targetChapterId}).`
        );
        unlockBtn.textContent = `UNLOCK UP TO CHAPTER ${ch}`;
      } else {
        setChapterUnlockStatus(screenEl, result.error || 'Unlock failed.', true);
        unlockBtn.textContent = `UNLOCK UP TO CHAPTER ${ch}`;
      }
    });
  }
}

function bindEvents(screenEl) {
  const backBtn = screenEl.querySelector('#back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => router.navigate('main-menu'));
  }

  // Accordion toggles (Theme / Batch / Chapters — Update stays flat)
  bindAccordionToggle(screenEl, 'theme-accordion-toggle', 'theme-accordion-body');
  bindAccordionToggle(screenEl, 'batch-accordion-toggle', 'batch-accordion-body');
  bindAccordionToggle(screenEl, 'chapter-unlock-accordion-toggle', 'chapter-unlock-accordion-body');

  // Theme grid — event delegation
  const grid = screenEl.querySelector('#theme-grid');
  if (grid) {
    grid.addEventListener('click', (event) => {
      const btn = event.target.closest('.theme-btn');
      if (btn && btn.dataset.themeId) {
        handleThemeSelect(btn.dataset.themeId, screenEl);
      }
    });
  }

  // Update button
  const updateBtn = screenEl.querySelector('#update-btn');
  if (updateBtn) {
    updateBtn.addEventListener('click', checkForUpdates);
  }

  // Unlock batch size slider
  const batchSlider = screenEl.querySelector('#batch-slider');
  const batchValue = screenEl.querySelector('#batch-value');
  if (batchSlider && batchValue) {
    batchSlider.addEventListener('input', async () => {
      const val = Number(batchSlider.value);
      batchValue.textContent = String(val);
      // Keep the accordion current label in sync
      const batchCurrent = screenEl.querySelector('#batch-current-label');
      if (batchCurrent) batchCurrent.textContent = String(val);
      await setSetting('unlockBatchSize', val);
    });
  }

  // Chapter unlock panel events
  bindChapterUnlockEvents(screenEl);
}

// =============================================================================
// SCREEN RENDER
// =============================================================================

export async function init() {
  const app = document.getElementById('app');
  if (!app) {
    console.error('[options] #app container not found');
    return;
  }

  let currentTheme = await getTheme();
  if (!currentTheme || !THEME_OPTIONS.some((t) => t.id === currentTheme)) {
    currentTheme = 'theme-arcade';
  }

  let screen = document.getElementById('screen-options');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'screen-options';
    screen.className = 'screen options';
    app.appendChild(screen);
  }

  const currentLabel = getThemeLabel(currentTheme);

  // Default unit/chapter for unlock panel (first available unit → its global chapter range)
  const availableUnits = getAvailableUnits();
  const defaultUnit = availableUnits.length ? availableUnits[0] : 1;
  const defaultRange = getChapterRangeForUnit(defaultUnit);
  const defaultMinCh = defaultRange[0];
  const defaultMaxCh = defaultRange[defaultRange.length - 1];

  screen.innerHTML = `
    <div class="options-container">

      <div class="screen-header">
        <div class="header-center">
          <h1 class="screen-title">OPTIONS</h1>
        </div>
      </div>

      <div class="options-content">

        <!-- ── THEME ACCORDION ───────────────────────────────────────────── -->
        <div class="theme-panel accordion-panel">
          <button type="button" class="accordion-header" id="theme-accordion-toggle" aria-expanded="false" aria-controls="theme-accordion-body">
            <span class="accordion-title">VISUAL THEME</span>
            <span class="accordion-current" id="theme-current-label">${currentLabel}</span>
            <span class="accordion-chevron" aria-hidden="true">▼</span>
          </button>
          <div class="accordion-body" id="theme-accordion-body" hidden>
            <div class="theme-grid" id="theme-grid">
              <!-- 8 theme button controls populated dynamically -->
            </div>
          </div>
        </div>

        <!-- ── UNLOCK BATCH SIZE ACCORDION ───────────────────────────────── -->
        <div class="batch-panel accordion-panel">
          <button type="button" class="accordion-header" id="batch-accordion-toggle" aria-expanded="false" aria-controls="batch-accordion-body">
            <span class="accordion-title">UNLOCK BATCH SIZE</span>
            <span class="accordion-current" id="batch-current-label">25</span>
            <span class="accordion-chevron" aria-hidden="true">▼</span>
          </button>
          <div class="accordion-body" id="batch-accordion-body" hidden>
            <div class="time-slider-container">
              <div class="time-slider-value" id="batch-value">25</div>
              <input
                type="range"
                id="batch-slider"
                class="arcade-slider"
                min="10"
                max="50"
                step="1"
                value="25"
                aria-label="Unlock batch size"
              />
              <div class="slider-range-labels">
                <span>10</span>
                <span>50</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── UNLOCK CHAPTERS ACCORDION ─────────────────────────────────── -->
        <div class="chapter-unlock-panel accordion-panel">
          <button type="button" class="accordion-header" id="chapter-unlock-accordion-toggle" aria-expanded="false" aria-controls="chapter-unlock-accordion-body">
            <span class="accordion-title">UNLOCK CHAPTERS</span>
            <span class="accordion-current" id="chapter-unlock-current-label"></span>
            <span class="accordion-chevron" aria-hidden="true">▼</span>
          </button>
          <div class="accordion-body" id="chapter-unlock-accordion-body" hidden>
            <p class="panel-desc">Skipped the placement assessment? Jump straight to where your class is.</p>

            <div class="chapter-unit-row">
              <label class="section-label" for="chapter-unit-select">UNIT</label>
              <select id="chapter-unit-select" class="arcade-select" aria-label="Select unit">
                <!-- populated dynamically -->
              </select>
            </div>

            <div class="time-slider-container">
              <div class="time-slider-value" id="chapter-value">${defaultMinCh}</div>
              <input
                type="range"
                id="chapter-slider"
                class="arcade-slider"
                min="${defaultMinCh}"
                max="${defaultMaxCh}"
                step="1"
                value="${defaultMinCh}"
                aria-label="Target chapter"
              />
              <div class="slider-range-labels">
                <span id="chapter-min-label">${defaultMinCh}</span>
                <span id="chapter-max-label">${defaultMaxCh}</span>
              </div>
            </div>

            <div class="update-controls">
              <button id="chapter-unlock-btn" class="btn btn-primary" type="button" data-confirm="0">
                UNLOCK UP TO CHAPTER ${defaultMinCh}
              </button>
              <p id="chapter-unlock-status" class="update-status"></p>
            </div>
          </div>
        </div>

        <!-- ── APP UPDATE (flat — always expanded) ───────────────────────── -->
        <div class="update-panel">
          <div class="panel-header">
            <h2 class="panel-title">APP UPDATE</h2>
            <p class="panel-desc">
              Check for a new version of the app.<br>
            </p>
          </div>

          <div class="update-controls">
            <button id="update-btn" class="btn btn-update" type="button">
              CHECK FOR UPDATES
            </button>
            <p id="update-status" class="update-status"></p>
            <p id="sw-version" class="sw-version"></p>
          </div>
        </div>

        <!-- ── FOOTER + BACK (bottom, matches other settings screens) ──── -->
        <div class="options-footer">
          <p class="footer-note">All progress is saved automatically.</p>
          <button id="back-btn" class="btn btn-back">BACK TO MAIN MENU</button>
        </div>

      </div>
    </div>
  `;

  applyThemeClass(currentTheme);

  // Store reference so setUpdateUI() can reach DOM without extra args
  _screenEl = screen;

  // Load persisted unlock batch size (min 10 / max 50 / default 25)
  const rawBatch = await getSetting('unlockBatchSize');
  let batchSize = 25;
  if (typeof rawBatch === 'number' && rawBatch >= 10 && rawBatch <= 50) {
    batchSize = Math.round(rawBatch);
  } else {
    // Seed the default so future unlocks use the persisted value
    await setSetting('unlockBatchSize', 25);
  }
  const batchSlider = screen.querySelector('#batch-slider');
  const batchValueEl = screen.querySelector('#batch-value');
  const batchCurrentLabel = screen.querySelector('#batch-current-label');
  if (batchSlider) {
    batchSlider.value = String(batchSize);
  }
  if (batchValueEl) {
    batchValueEl.textContent = String(batchSize);
  }
  if (batchCurrentLabel) {
    batchCurrentLabel.textContent = String(batchSize);
  }

  // Chapter unlock panel: populate unit dropdown + slider for default unit's global range
  populateChapterUnitSelect(screen, defaultUnit);
  updateChapterSlider(screen, defaultUnit, defaultMinCh);

  renderThemeGrid(screen, currentTheme);
  bindEvents(screen);

  // Show running SW version (fires async, non-blocking)
  displayCurrentVersion(screen);

  // If there's already a waiting SW when the screen opens, surface it
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
    if (reg && reg.waiting) {
      setUpdateUI('idle', '▲ Update already downloaded — tap to apply');
    }
  }
}
