/* global Diff */
(() => {
  'use strict';

  // ===== DOM Elements =====
  const leftInput = document.getElementById('leftInput');
  const rightInput = document.getElementById('rightInput');
  const leftCount = document.getElementById('leftCount');
  const rightCount = document.getElementById('rightCount');
  const compareBtn = document.getElementById('compareBtn');
  const swapBtn = document.getElementById('swapBtn');
  const clearBtn = document.getElementById('clearBtn');
  const backBtn = document.getElementById('backBtn');
  const granularitySelect = document.getElementById('granularity');
  const ignoreCaseEl = document.getElementById('ignoreCase');
  const ignoreWhitespaceEl = document.getElementById('ignoreWhitespace');
  const mainArea = document.getElementById('mainArea');
  const resultArea = document.getElementById('resultArea');
  const leftDiffEl = document.getElementById('leftDiff');
  const rightDiffEl = document.getElementById('rightDiff');
  const statsEl = document.getElementById('stats');

  const STORAGE_KEY = 'textDiff:v1';

  // ===== Utilities =====
  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function updateCount() {
    leftCount.textContent = `${leftInput.value.length} 字符`;
    rightCount.textContent = `${rightInput.value.length} 字符`;
  }

  // ===== Persistence =====
  function saveState() {
    const state = {
      left: leftInput.value,
      right: rightInput.value,
      granularity: granularitySelect.value,
      ignoreCase: ignoreCaseEl.checked,
      ignoreWhitespace: ignoreWhitespaceEl.checked,
    };
    try {
      chrome.storage?.local.set({ [STORAGE_KEY]: state });
    } catch (e) {
      // fallback to localStorage if chrome.storage unavailable
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }

  function loadState() {
    return new Promise((resolve) => {
      try {
        chrome.storage?.local.get([STORAGE_KEY], (res) => {
          resolve(res?.[STORAGE_KEY] || null);
        });
      } catch (e) {
        const raw = localStorage.getItem(STORAGE_KEY);
        resolve(raw ? JSON.parse(raw) : null);
      }
    });
  }

  // ===== Diff Core =====
  /**
   * Line-level diff with optional intra-line highlighting (words/chars).
   * Returns { leftHtml, rightHtml, stats }.
   */
  function buildDiff(leftText, rightText, options) {
    const { granularity, ignoreCase, ignoreWhitespace } = options;

    // 1) Always compute line-level diff first for alignment
    const lineOpts = { ignoreCase, ignoreWhitespace };
    const lineDiff = Diff.diffLines(leftText, rightText, lineOpts);

    const leftLines = [];
    const rightLines = [];
    let addedLines = 0;
    let removedLines = 0;

    for (let i = 0; i < lineDiff.length; i++) {
      const part = lineDiff[i];
      const next = lineDiff[i + 1];

      // Pair a removed block with the next added block -> render as modified pair
      if (part.removed && next && next.added) {
        const removedArr = splitLinesKeepStructure(part.value);
        const addedArr = splitLinesKeepStructure(next.value);
        const maxLen = Math.max(removedArr.length, addedArr.length);

        for (let j = 0; j < maxLen; j++) {
          const L = removedArr[j];
          const R = addedArr[j];

          if (L !== undefined && R !== undefined) {
            // Both sides exist — highlight intra-line changes
            const { lHtml, rHtml } = intraLineHighlight(L, R, granularity, {
              ignoreCase,
              ignoreWhitespace,
            });
            leftLines.push(`<span class="diff-line removed">${lHtml || '&nbsp;'}</span>`);
            rightLines.push(`<span class="diff-line added">${rHtml || '&nbsp;'}</span>`);
            removedLines++;
            addedLines++;
          } else if (L !== undefined) {
            leftLines.push(`<span class="diff-line removed">${escapeHtml(L) || '&nbsp;'}</span>`);
            rightLines.push(`<span class="diff-line empty">&nbsp;</span>`);
            removedLines++;
          } else {
            leftLines.push(`<span class="diff-line empty">&nbsp;</span>`);
            rightLines.push(`<span class="diff-line added">${escapeHtml(R) || '&nbsp;'}</span>`);
            addedLines++;
          }
        }
        i++; // skip consumed "added" block
        continue;
      }

      if (part.removed) {
        const arr = splitLinesKeepStructure(part.value);
        for (const line of arr) {
          leftLines.push(`<span class="diff-line removed">${escapeHtml(line) || '&nbsp;'}</span>`);
          rightLines.push(`<span class="diff-line empty">&nbsp;</span>`);
          removedLines++;
        }
      } else if (part.added) {
        const arr = splitLinesKeepStructure(part.value);
        for (const line of arr) {
          leftLines.push(`<span class="diff-line empty">&nbsp;</span>`);
          rightLines.push(`<span class="diff-line added">${escapeHtml(line) || '&nbsp;'}</span>`);
          addedLines++;
        }
      } else {
        // Unchanged
        const arr = splitLinesKeepStructure(part.value);
        for (const line of arr) {
          const safe = escapeHtml(line) || '&nbsp;';
          leftLines.push(`<span class="diff-line">${safe}</span>`);
          rightLines.push(`<span class="diff-line">${safe}</span>`);
        }
      }
    }

    return {
      leftHtml: leftLines.join(''),
      rightHtml: rightLines.join(''),
      stats: { addedLines, removedLines },
    };
  }

  /**
   * Split a chunk value into lines while dropping the trailing empty line
   * that results from a terminating '\n'. Keeps middle blank lines.
   */
  function splitLinesKeepStructure(value) {
    if (value === '') return [];
    const parts = value.split('\n');
    if (parts[parts.length - 1] === '') parts.pop();
    return parts;
  }

  /**
   * Compute intra-line highlighting between two single lines.
   */
  function intraLineHighlight(left, right, granularity, opts) {
    let parts;
    if (granularity === 'chars') {
      parts = Diff.diffChars(left, right, opts);
    } else if (granularity === 'lines') {
      // "lines" mode => no intra-line highlight, just plain
      return { lHtml: escapeHtml(left), rHtml: escapeHtml(right) };
    } else {
      parts = Diff.diffWordsWithSpace(left, right, opts);
    }

    let lHtml = '';
    let rHtml = '';
    for (const p of parts) {
      const safe = escapeHtml(p.value);
      if (p.added) {
        rHtml += `<span class="diff-highlight-added">${safe}</span>`;
      } else if (p.removed) {
        lHtml += `<span class="diff-highlight-removed">${safe}</span>`;
      } else {
        lHtml += safe;
        rHtml += safe;
      }
    }
    return { lHtml, rHtml };
  }

  // ===== Actions =====
  function doCompare() {
    const leftText = leftInput.value;
    const rightText = rightInput.value;

    if (!leftText && !rightText) {
      alert('请先在左右两侧输入需要对比的文本');
      return;
    }

    const options = {
      granularity: granularitySelect.value,
      ignoreCase: ignoreCaseEl.checked,
      ignoreWhitespace: ignoreWhitespaceEl.checked,
    };

    const { leftHtml, rightHtml, stats } = buildDiff(leftText, rightText, options);

    leftDiffEl.innerHTML = leftHtml || '<span class="diff-line empty">&nbsp;</span>';
    rightDiffEl.innerHTML = rightHtml || '<span class="diff-line empty">&nbsp;</span>';

    statsEl.innerHTML =
      `<span class="stat-removed">− 删除 ${stats.removedLines} 行</span>` +
      `<span class="stat-added">+ 新增 ${stats.addedLines} 行</span>` +
      (stats.addedLines === 0 && stats.removedLines === 0
        ? '<span>两段文本完全一致 ✓</span>'
        : '');

    mainArea.classList.add('hidden');
    resultArea.classList.remove('hidden');
    saveState();
  }

  function backToEdit() {
    resultArea.classList.add('hidden');
    mainArea.classList.remove('hidden');
  }

  function swap() {
    const tmp = leftInput.value;
    leftInput.value = rightInput.value;
    rightInput.value = tmp;
    updateCount();
    saveState();
  }

  function clearAll() {
    if (!leftInput.value && !rightInput.value) return;
    if (!confirm('确定要清空两侧的文本吗?')) return;
    leftInput.value = '';
    rightInput.value = '';
    updateCount();
    saveState();
  }

  // ===== Event Bindings =====
  const debouncedSave = debounce(saveState, 400);

  leftInput.addEventListener('input', () => {
    updateCount();
    debouncedSave();
  });
  rightInput.addEventListener('input', () => {
    updateCount();
    debouncedSave();
  });

  compareBtn.addEventListener('click', doCompare);
  backBtn.addEventListener('click', backToEdit);
  swapBtn.addEventListener('click', swap);
  clearBtn.addEventListener('click', clearAll);

  granularitySelect.addEventListener('change', saveState);
  ignoreCaseEl.addEventListener('change', saveState);
  ignoreWhitespaceEl.addEventListener('change', saveState);

  // Ctrl/Cmd + Enter to compare
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      doCompare();
    }
    if (e.key === 'Escape' && !resultArea.classList.contains('hidden')) {
      backToEdit();
    }
  });

  // ===== Init =====
  (async function init() {
    const saved = await loadState();
    if (saved) {
      leftInput.value = saved.left || '';
      rightInput.value = saved.right || '';
      if (saved.granularity) granularitySelect.value = saved.granularity;
      ignoreCaseEl.checked = !!saved.ignoreCase;
      ignoreWhitespaceEl.checked = !!saved.ignoreWhitespace;
    }
    updateCount();
  })();
})();
