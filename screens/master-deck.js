/**
 * screens/master-deck.js
 * Master Deck browser — accordion view of all units → chapters → vocabulary
 * MINOR CHANGES per Master Handoff Document (display updates only).
 */

import { navigate, goBack } from '../core/router.js';
import * as wordStore from '../db/word-store.js';
import { masterDeck, getChapterWords } from '../vocab/vocab.js';
import { db } from '../db/db.js';
import { getLiveChapterStrength, getLiveUnitStrength } from '../engine/progression.js';

// Module-level caches
let _unlockedMap = null;
let _unlockedWordIds = null;
let currentFilter = 'all'; // 'all' | 'unlocked' | 'locked' | 'custom'

export async function init() {
  const unlockedProgress = await wordStore.getAllUnlockedWords();
  _unlockedMap = new Map(unlockedProgress.map(w => [w.id, w]));
  _unlockedWordIds = new Set(unlockedProgress.map(w => w.id));

  // =====================================================
  // ROBUST DATA BUILDING (defensive number handling)
  // =====================================================
  const unitChapters = new Map();

  // 1. Static masterDeck
  for (const word of masterDeck || []) {
    const unit = Number(word.unit);
    const chapter = Number(word.chapter);

    if (!unitChapters.has(unit)) unitChapters.set(unit, new Map());
    const chMap = unitChapters.get(unit);

    if (!chMap.has(chapter)) {
      chMap.set(chapter, { total: 0, unlocked: 0, chapterId: `${unit}:${chapter}` });
    }
    const data = chMap.get(chapter);
    data.total += 1;
    if (_unlockedWordIds.has(word.id)) data.unlocked += 1;
  }

  // 2. Custom words (with explicit Number conversion)
  const customWords = unlockedProgress.filter(w => w.id && w.id.startsWith('custom_'));
  for (const word of customWords) {
    const unit = Number(word.unit);
    const chapter = Number(word.chapter);

    if (!unitChapters.has(unit)) unitChapters.set(unit, new Map());
    const chMap = unitChapters.get(unit);

    if (!chMap.has(chapter)) {
      chMap.set(chapter, { total: 0, unlocked: 0, chapterId: `${unit}:${chapter}` });
    }
    const data = chMap.get(chapter);
    data.total += 1;
    data.unlocked += 1;
  }

  const units = Array.from(unitChapters.keys()).sort((a, b) => a - b);

    // === LIVE STRENGTH — computed directly from db.words, no cached fields ===
  const liveUnitStrengths = new Map();
  const liveChapterStrengths = new Map();

  for (const unit of units) {
    liveUnitStrengths.set(unit, await getLiveUnitStrength(unit));

    const chMap = unitChapters.get(unit);
    for (const chapter of chMap.keys()) {
      const chapterId = chMap.get(chapter).chapterId;
      liveChapterStrengths.set(chapterId, await getLiveChapterStrength(unit, chapter));
    }
  }

  const app = document.getElementById('app');
  if (!app) {
    console.error('[master-deck] #app container not found');
    return;
  }

  // Remove any orphaned inner #master-deck-screen div from old code
  // that had class="screen" and would paint over other screens
  const orphan = document.getElementById('master-deck-screen');
  if (orphan) orphan.remove();

  let screen = document.getElementById('screen-master-deck');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'screen-master-deck';
    screen.className = 'screen';
    app.appendChild(screen);
  }

  // Always wipe before re-render so no stale inner DOM persists between navigations
  screen.innerHTML = '';
  screen.innerHTML = createScreenHTML(units, unitChapters, liveUnitStrengths, liveChapterStrengths);
  bindEvents();
}

function createScreenHTML(units, unitChapters, liveUnitStrengths, liveChapterStrengths) {
  let html = `
    <div class="deck-header">
        <button id="back-btn" class="btn icon-btn" aria-label="Back to main menu">BACK</button>
       
        <div class="title-block">
          <h1 class="screen-title">FULL DECK</h1>
          <p class="subtitle">ALL UNITS • CHAPTERS • VOCABULARY</p>
        </div>
        <div class="header-stats">
          <div class="stat-pill">
            <span class="stat-value">${_unlockedMap.size}</span>
            <span class="stat-label">UNLOCKED</span>
          </div>
        </div>
      </div>
      <!-- Filter bar -->
      <div class="deck-filters">
        <div class="segmented-control filter-control" id="deck-filter">
          <button type="button" class="seg-option selected" data-filter="all">ALL</button>
          <button type="button" class="seg-option" data-filter="unlocked">UNLOCKED</button>
          <button type="button" class="seg-option" data-filter="locked">LOCKED</button>
          <button type="button" class="seg-option" data-filter="custom">CUSTOM</button>
        </div>
      </div>
      <div class="units-list" role="list">
  `;

  for (const unit of units) {
    const chMap = unitChapters.get(unit);
    const chapters = Array.from(chMap.keys()).sort((a, b) => a - b);

    // === ROBUST COUNTING FROM _unlockedMap ===
    let unitTotal = 0;
    let unitUnlocked = 0;

    for (const chapter of chapters) {
      const data = chMap.get(chapter);
      unitTotal += data.total;

      // Count actual unlocked words for this unit + chapter from the map
      const unlockedInChapter = Array.from(_unlockedMap.values()).filter(w =>
        w.unit === unit && w.chapter === chapter
      ).length;

      unitUnlocked += unlockedInChapter;

      // Update the data object so chapter headers are also correct
      data.unlocked = unlockedInChapter;
    }

    const unitStrengthPct = Math.round((liveUnitStrengths.get(unit) || 0) * 100);
    
    html += `
      <div class="unit-accordion" data-unit-id="${unit}" data-unlocked-count="${unitUnlocked}" role="listitem">
        <button class="unit-header btn" data-unit-id="${unit}" aria-expanded="false">
          <div class="unit-info">
            <span class="unit-label">UNIT ${String(unit).padStart(2, '0')}</span>
            <span class="unit-progress">${unitUnlocked} / ${unitTotal} • ${unitStrengthPct}%</span>
            <span class="chevron" aria-hidden="true">▼</span>
          </div>
        </button>
        <div class="chapters-list" style="display: none;" role="list">
    `;

    for (const chapter of chapters) {
      const data = chMap.get(chapter);
      const chapterId = data.chapterId;
      const chapterStrengthPct = Math.round((liveChapterStrengths.get(chapterId) || 0) * 100);

      html += `
          <div class="chapter-accordion" data-chapter-id="${chapterId}" role="listitem">
            <button class="chapter-header btn" data-chapter-id="${chapterId}" aria-expanded="false">
              <div class="chapter-info">
                <span class="chapter-label">CHAPTER ${chapter}</span>
                <span class="chapter-progress">${data.unlocked} / ${data.total} • ${chapterStrengthPct}%</span>
                <span class="chevron" aria-hidden="true">▼</span>
              </div>
            </button>
            <div class="words-list" style="display: none;" data-chapter-id="${chapterId}">
              <!-- Populated lazily by renderChapterWords() on first expand -->
            </div>
          </div>
      `;
    }

    html += `
        </div>
      </div>
    `;
  }

  html += `
      </div>
      <div class="deck-footer">
        <p class="hint">Tap UNIT / CHAPTER to expand • Tap any WORD to view detailed stats</p>
      </div>
  `;

  return html;
}
function handleUnitTap(unitId) {
  const accordion = document.querySelector(`.unit-accordion[data-unit-id="${unitId}"]`);
  if (!accordion) return;

  const list = accordion.querySelector('.chapters-list');
  const header = accordion.querySelector('.unit-header');
  const isExpanded = accordion.classList.contains('expanded');

  if (isExpanded) {
    accordion.classList.remove('expanded');
    list.style.display = 'none';
    header.setAttribute('aria-expanded', 'false');
  } else {
    accordion.classList.add('expanded');
    list.style.display = 'block';
    header.setAttribute('aria-expanded', 'true');
  }
}

function handleChapterTap(chapterId) {
  const accordion = document.querySelector(`.chapter-accordion[data-chapter-id="${chapterId}"]`);
  if (!accordion) return;

  const list = accordion.querySelector('.words-list');
  const header = accordion.querySelector('.chapter-header');
  const isExpanded = accordion.classList.contains('expanded');

  if (isExpanded) {
    accordion.classList.remove('expanded');
    list.style.display = 'none';
    header.setAttribute('aria-expanded', 'false');
  } else {
    accordion.classList.add('expanded');
    list.style.display = 'block';
    header.setAttribute('aria-expanded', 'true');

    if (list.children.length === 0) {
      renderChapterWords(chapterId);
    }
  }
}
function bindEvents() {
  const backBtn = document.getElementById('back-btn');
  if (backBtn) backBtn.onclick = () => goBack();

  document.querySelectorAll('.unit-header').forEach(header => {
    header.onclick = (e) => {
      e.preventDefault();
      handleUnitTap(parseInt(header.dataset.unitId, 10));
    };
  });

  document.querySelectorAll('.chapter-header').forEach(header => {
    header.onclick = (e) => {
      e.preventDefault();
      handleChapterTap(header.dataset.chapterId);
    };
  });

  // Filter bar
  const filterBar = document.getElementById('deck-filter');
  if (filterBar) {
    filterBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-option');
      if (!btn || !btn.dataset.filter) return;
      if (btn.dataset.filter === currentFilter) return;

      currentFilter = btn.dataset.filter;
      filterBar.querySelectorAll('.seg-option').forEach(b => 
        b.classList.toggle('selected', b.dataset.filter === currentFilter)
      );
      handleFilterChange();
    });
  }

  // Delegated word tap handler
  const unitsList = document.querySelector('.units-list');
  if (unitsList) {
    unitsList.addEventListener('click', (e) => {
      const wordItem = e.target.closest('.word-item');
      if (wordItem) {
        e.stopPropagation();
        handleWordTap(wordItem);
      }
    });
  }
}

function handleFilterChange() {
  // Re-render any currently open chapters
  document.querySelectorAll('.words-list').forEach(list => {
    if (list.style.display === 'block' || list.style.display === '') {
      const chapterId = list.dataset.chapterId;
      if (chapterId) {
        list.innerHTML = '';
        renderChapterWords(chapterId);
      }
    }
  });

  // Hide units with zero unlocked words only when filter = 'unlocked'
  document.querySelectorAll('.unit-accordion').forEach(unitEl => {
    const unlockedCount = parseInt(unitEl.dataset.unlockedCount || '0', 10);
    unitEl.style.display = (currentFilter === 'unlocked' && unlockedCount === 0) ? 'none' : '';
  });
}

function handleWordTap(wordItem) {
  if (!wordItem || wordItem.classList.contains('locked')) return;

  const wordId = wordItem.dataset.wordId;
  const isExpanded = wordItem.classList.contains('expanded');

  if (isExpanded) {
    wordItem.classList.remove('expanded');
    const stats = wordItem.querySelector('.word-stats');
    if (stats) stats.style.display = 'none';
    return;
  }

  wordItem.classList.add('expanded');

  let statsEl = wordItem.querySelector('.word-stats');
  if (!statsEl) {
    statsEl = document.createElement('div');
    statsEl.className = 'word-stats';

    const progress = _unlockedMap?.get(wordId);
    if (!progress) {
      statsEl.innerHTML = `<div class="locked-stats">Unable to load stats.</div>`;
    } else {
      const strengthPct = Math.round((progress.strength || 0) * 100);
      const streak = progress.wordStreak || 0;
      const seen = progress.gameTimeSeen || 0;
      const correct = progress.gameTimesCorrect || 0;
      const acc = seen > 0 ? Math.round((correct / seen) * 100) : 0;

      let dueText = '—';
      if (progress.fsrsNextReviewAt) {
        const diffDays = Math.ceil((new Date(progress.fsrsNextReviewAt) - new Date()) / (1000 * 60 * 60 * 24));
        dueText = diffDays <= 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : `In ${diffDays} days`;
      }

      statsEl.innerHTML = `
        <div class="stat"><div class="stat-label">STRENGTH</div><div class="stat-value">${strengthPct}%</div></div>
        <div class="stat"><div class="stat-label">STREAK</div><div class="stat-value">${streak}</div></div>
        <div class="stat"><div class="stat-label">SEEN</div><div class="stat-value">${seen}</div></div>
        <div class="stat"><div class="stat-label">CORRECT</div><div class="stat-value">${correct}</div></div>
        <div class="stat"><div class="stat-label">ACCURACY</div><div class="stat-value">${acc}%</div></div>
        <div class="stat"><div class="stat-label">DUE</div><div class="stat-value">${dueText}</div></div>
      `;
    }
    wordItem.appendChild(statsEl);
  } else {
    statsEl.style.display = 'grid';
  }

  // === EDIT BUTTON — Only for custom words ===
  if (wordId.startsWith('custom_')) {
    let editBtn = wordItem.querySelector('.edit-custom-btn');

    if (!editBtn) {
      editBtn = document.createElement('button');
      editBtn.className = 'btn btn-secondary edit-custom-btn';
      editBtn.style.marginTop = '8px';
      editBtn.style.width = '100%';
      editBtn.textContent = 'EDIT WORD';

      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigate('custom-word', { editWordId: wordId });
      });

      if (statsEl) {
        statsEl.appendChild(editBtn);
      } else {
        wordItem.appendChild(editBtn);
      }
    }
  }
}

function renderChapterWords(chapterId) {
  const container = document.querySelector(`.words-list[data-chapter-id="${chapterId}"]`);
  if (!container || !_unlockedMap) return;

  const [unitStr, chapterStr] = chapterId.split(':');
  const unitNumber = parseInt(unitStr, 10);
  const chapterNumber = parseInt(chapterStr, 10);

  // Get static words
  let staticWords = getChapterWords(unitNumber, chapterNumber) || [];

  // Get custom words for this specific unit + chapter from the unlocked map
  const customWords = Array.from(_unlockedMap.values()).filter(w => {
    return w.id &&
           w.id.startsWith('custom_') &&
           Number(w.unit) === unitNumber &&
           Number(w.chapter) === chapterNumber;
  });

  // Merge and deduplicate
  const allWords = [...staticWords, ...customWords];
  const uniqueWords = allWords.filter((w, index, self) =>
    index === self.findIndex((t) => t.id === w.id)
  );

  let words = uniqueWords.sort((a, b) => a.id.localeCompare(b.id));

  let html = '';

  for (const word of words) {
    const progress = _unlockedMap.get(word.id);
    const isUnlocked = !!progress;
    const isCustom = word.id && word.id.startsWith('custom_');

    // Apply current filter
    if (currentFilter === 'custom' && !isCustom) continue;
    if (currentFilter === 'unlocked' && !isUnlocked) continue;
    if (currentFilter === 'locked' && isUnlocked) continue;

    if (isUnlocked) {
      const leitnerGroupNum = wordStore.getDerivedLeitnerGroup(progress);
      const groupClass = `leitner-${leitnerGroupNum}`;
      const strengthPct = Math.round((progress.strength || 0) * 100);

      html += `
        <div class="word-item ${groupClass}" data-word-id="${word.id}">
          <div class="word-content">
            <div class="word-main">
              <span class="native">${word.native}</span>
              <span class="english">${word.english}</span>
            </div>
            <div class="word-meta">
              <span class="leitner-badge">G${leitnerGroupNum}</span>
              ${isCustom 
                ? `<span class="custom-badge" style="font-size:9px; padding:1px 6px; border:1px solid var(--color-accent); color:var(--color-accent); margin-left:4px;">CUSTOM</span>` 
                : ''}
              <span class="accuracy strength">${strengthPct}%</span>
            </div>
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="word-item locked" data-word-id="${word.id}">
          <div class="word-content">
            <div class="word-main">
              <span class="native">${word.native}</span>
            </div>
            <div class="word-meta">
              <span class="locked-badge">LOCKED</span>
            </div>
          </div>
        </div>
      `;
    }
  }

  container.innerHTML = html || '<div class="empty-state">No vocabulary in this chapter yet.</div>';
}
