/**
 * screens/custom-word.js
 * Add / Edit Custom Word screen — fully themed arcade CRT experience.
 * Supports both creating new custom words and editing existing ones.
 * Live preview updates in real time as user types.
 */

import { navigate, goBack } from '../core/router.js';
import * as wordStore from '../db/word-store.js';

let currentUnit = 1;
let currentChapter = 1;
let screenEl = null;
let editWordId = null;
let isEditMode = false;
let currentWord = null;

export async function init(params = {}) {
  const app = document.getElementById('app');
  if (!app) {
    console.error('[custom-word] #app container not found');
    return;
  }

  // Reset module state
  editWordId = params.editWordId || null;
  isEditMode = !!editWordId;
  currentWord = null;

  // Determine context unit/chapter (only used in Add mode)
  if (!isEditMode) {
    try {
      const unlocked = await wordStore.getAllUnlockedWords();
      if (unlocked && unlocked.length > 0) {
        const maxUnit = Math.max(...unlocked.map(w => w.unit || 1));
        const inMaxUnit = unlocked.filter(w => w.unit === maxUnit);
        currentChapter = Math.max(...inMaxUnit.map(w => w.chapter || 1));
        currentUnit = maxUnit;
      }
    } catch (err) {
      console.warn('[custom-word] Could not determine current unit/chapter', err);
    }
  }

  // Create or reuse screen container
  screenEl = document.getElementById('screen-custom-word');
  if (!screenEl) {
    screenEl = document.createElement('div');
    screenEl.id = 'screen-custom-word';
    screenEl.className = 'screen custom-word-screen';
    app.appendChild(screenEl);
  }

  // Load word data if editing
  if (isEditMode && editWordId) {
    currentWord = await wordStore.resolveWord(editWordId);
    if (!currentWord || !currentWord.id.startsWith('custom_')) {
      console.warn('[custom-word] Tried to edit non-custom word');
      navigate('main-menu');
      return;
    }
    currentUnit = currentWord.unit;
    currentChapter = currentWord.chapter;
  }

  renderScreen();
  bindEvents();
}

function renderScreen() {
  if (!screenEl) return;

  const title = isEditMode ? 'EDIT CUSTOM WORD' : 'ADD CUSTOM WORD';
  const buttonText = isEditMode ? 'SAVE CHANGES' : 'ADD TO DECK';
  const buttonId = isEditMode ? 'save-btn' : 'add-btn';

  screenEl.innerHTML = `
    <div class="custom-word-container">
      <!-- Header -->
      <div class="custom-word-header">
        <h1 class="screen-title">${title}</h1>
      </div>

      <!-- Context -->
      <div class="context-badge">
        UNIT ${String(currentUnit).padStart(2, '0')} • CHAPTER ${currentChapter}
      </div>

      <!-- Form -->
      <div class="form-section">
        <div class="input-group">
          <label class="section-label" for="native-input">NATIVE WORD</label>
          <input id="native-input" type="text" class="arcade-input"
                 placeholder="Type the word..." autocomplete="off" autocapitalize="off" />
        </div>

        <div class="input-group">
          <label class="section-label" for="english-input">ENGLISH</label>
          <input id="english-input" type="text" class="arcade-input"
                 placeholder="English meaning..." autocomplete="off" />
        </div>
      </div>
      <!-- Actions -->
      <div class="action-bar">
        <button id="${buttonId}" class="btn btn-primary btn-large" disabled>
          ${buttonText}
        </button>
        <button id="cancel-btn" class="btn">CANCEL</button>
        ${isEditMode ? `
          <button id="delete-btn" class="btn" style="border-color: var(--color-incorrect); color: var(--color-incorrect); margin-top: var(--space-md);">
            DELETE WORD
          </button>
        ` : ''}
      </div>
    </div>
  `;

  // Pre-fill inputs if editing
  if (isEditMode && currentWord) {
    const nativeInput = screenEl.querySelector('#native-input');
    const englishInput = screenEl.querySelector('#english-input');

    if (nativeInput) nativeInput.value = currentWord.native || '';
    if (englishInput) englishInput.value = currentWord.english || '';
  }
}

function bindEvents() {
  if (!screenEl) return;

  const nativeInput = screenEl.querySelector('#native-input');
  const englishInput = screenEl.querySelector('#english-input');
  const actionBtn = screenEl.querySelector('#save-btn') || screenEl.querySelector('#add-btn');
  const cancelBtn = screenEl.querySelector('#cancel-btn');
  cancelBtn.addEventListener('click', () => goBack());


  const updateOnInput = () => {
    updateActionButtonState();
  };

  nativeInput.addEventListener('input', updateOnInput);
  englishInput.addEventListener('input', updateOnInput);

  // Keyboard support
  englishInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && actionBtn && !actionBtn.disabled) {
      handleSave();
    }
  });

  // Main action button (Add or Save)
  if (actionBtn) {
    actionBtn.addEventListener('click', handleSave);
  }

// Delete button only in edit mode
  const deleteBtn = screenEl.querySelector('#delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', handleDelete);
  }
  
  updateActionButtonState();

  // Focus first input
  setTimeout(() => {
    if (nativeInput) nativeInput.focus();
  }, 80);
}


function updateActionButtonState() {
  if (!screenEl) return;

  const nativeInput = screenEl.querySelector('#native-input');
  const englishInput = screenEl.querySelector('#english-input');
  const actionBtn = screenEl.querySelector('#save-btn') || screenEl.querySelector('#add-btn');

  if (!actionBtn) return;

  const hasNative = nativeInput && nativeInput.value.trim().length > 0;
  const hasEnglish = englishInput && englishInput.value.trim().length > 0;

  actionBtn.disabled = !(hasNative && hasEnglish);
}

async function handleSave() {
  if (!screenEl) return;

  const nativeInput = screenEl.querySelector('#native-input');
  const englishInput = screenEl.querySelector('#english-input');
  const actionBtn = screenEl.querySelector('#save-btn') || screenEl.querySelector('#add-btn');

  const native = nativeInput.value.trim();
  const english = englishInput.value.trim();

  if (!native || !english || !actionBtn) return;

  actionBtn.disabled = true;
  const originalText = actionBtn.textContent;
  actionBtn.textContent = isEditMode ? 'SAVING...' : 'ADDING...';

  try {
    let result;

    if (isEditMode && editWordId) {
      result = await wordStore.updateCustomWord(editWordId, { native, english });
    } else {
      result = await wordStore.addCustomWord(native, english, currentUnit, currentChapter);
    }

    if (result && result.success) {
      const message = isEditMode 
        ? `UPDATED: ${native} → ${english}` 
        : `ADDED: ${native} → ${english}`;
      
      showSuccessToast(message);

      // Return to the calling screen (master-deck for edits, or wherever the form was opened).
      // Using goBack() + router replace logic keeps navigation history clean and prevents loops.
      setTimeout(() => {
        goBack();
      }, 800);
    } else {
      throw new Error(result?.error || 'Operation failed');
    }
  } catch (err) {
    console.error('[custom-word] Save failed:', err);
    actionBtn.textContent = 'TRY AGAIN';
    actionBtn.disabled = false;

    setTimeout(() => {
      if (actionBtn) actionBtn.textContent = originalText;
    }, 1200);
  }
}

async function handleDelete() {
  if (!editWordId || !isEditMode) return;

  const confirmed = window.confirm('DELETE THIS CUSTOM WORD?\n\nThis cannot be undone.');
  if (!confirmed) return;

  const deleteBtn = screenEl.querySelector('#delete-btn');
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'DELETING...';
  }

  try {
    const result = await wordStore.deleteCustomWord(editWordId);

    if (result && result.success) {
      showSuccessToast('CUSTOM WORD DELETED');
      setTimeout(() => {
        goBack(); // returns to Master Deck (refreshes list)
      }, 600);
    } else {
      throw new Error(result?.error || 'Delete failed');
    }
  } catch (err) {
    console.error('[custom-word] Delete failed:', err);
    if (deleteBtn) {
      deleteBtn.textContent = 'DELETE FAILED';
      deleteBtn.disabled = false;
    }
    setTimeout(() => {
      if (deleteBtn) deleteBtn.textContent = 'DELETE WORD';
    }, 1400);
  }
}
  
function showSuccessToast(message) {
  const existing = document.querySelector('.custom-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'custom-toast';
  toast.innerHTML = `<div class="toast-text">${message}</div>`;

  document.body.appendChild(toast);

  setTimeout(() => {
    if (toast && toast.parentNode) {
      toast.style.transition = 'opacity 200ms ease';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
    }
  }, 2200);
}
