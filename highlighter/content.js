(() => {
  if (window.__HL_EXT_LOADED__) return;
  window.__HL_EXT_LOADED__ = true;

  const CLASS = 'hl-ext-highlight';
  const HIGHLIGHT_ATTR = 'data-hl-id';
  const CONTEXT_LEN = 48;
  const DEFAULT_COLOR = '#fff176';

  const COLORS = [
    { name: 'Yellow', value: '#fff176' },
    { name: 'Green',  value: '#a5d6a7' },
    { name: 'Pink',   value: '#f8bbd0' },
    { name: 'Blue',   value: '#90caf9' },
    { name: 'Orange', value: '#ffcc80' }
  ];

  const applied = new Set();

  function pageKey() {
    try {
      const u = new URL(window.location.href);
      u.hash = '';
      [...u.searchParams.keys()].forEach((k) => {
        if (/^utm_/i.test(k) || k === 'fbclid' || k === 'gclid' || k === 'mc_cid' || k === 'mc_eid') {
          u.searchParams.delete(k);
        }
      });
      return u.toString();
    } catch {
      return window.location.href;
    }
  }

  function storageKey() {
    return 'highlighter:' + pageKey();
  }

  // Cache of where each page key currently lives ('sync' | 'local'). Used to
  // route reads/writes correctly after a quota fallback.
  const areaCache = new Map();

  function mergeById(a, b) {
    const map = new Map();
    for (const h of a || []) if (h && h.id) map.set(h.id, h);
    for (const h of b || []) if (h && h.id) map.set(h.id, h); // b wins on conflict
    return Array.from(map.values());
  }

  async function getFromArea(area, key) {
    try {
      const result = await chrome.storage[area].get(key);
      return result[key] || null;
    } catch {
      return null;
    }
  }

  async function loadHighlights() {
    const key = storageKey();
    const [fromSync, fromLocal] = await Promise.all([
      getFromArea('sync', key),
      getFromArea('local', key)
    ]);
    // Remember where data exists so removals hit the right area(s).
    if (fromSync && fromLocal) areaCache.set(key, 'both');
    else if (fromSync) areaCache.set(key, 'sync');
    else if (fromLocal) areaCache.set(key, 'local');
    else areaCache.delete(key);
    return mergeById(fromSync || [], fromLocal || []);
  }

  function isQuotaError(err) {
    const msg = String((err && err.message) || err || '').toLowerCase();
    return msg.includes('quota');
  }

  async function saveHighlights(list) {
    const key = storageKey();
    const payload = { [key]: list };
    // Prefer sync so highlights roam across signed-in browsers. If sync is
    // unavailable or the payload exceeds sync quotas, fall back to local.
    try {
      await chrome.storage.sync.set(payload);
      // If we had a local copy previously (e.g. after a prior fallback),
      // drop it so the sync copy is authoritative.
      if (areaCache.get(key) === 'both' || areaCache.get(key) === 'local') {
        try { await chrome.storage.local.remove(key); } catch {}
      }
      areaCache.set(key, 'sync');
      return;
    } catch (err) {
      if (!isQuotaError(err)) {
        console.warn('highlighter: sync save failed, falling back to local', err);
      } else {
        console.warn('highlighter: sync quota exceeded for this page, falling back to local');
      }
      try {
        await chrome.storage.local.set(payload);
        areaCache.set(key, 'local');
      } catch (err2) {
        console.warn('highlighter: local save also failed', err2);
        throw err2;
      }
    }
  }

  async function addHighlight(hl) {
    const list = await loadHighlights();
    list.push(hl);
    await saveHighlights(list);
  }

  async function removeHighlight(id) {
    const list = await loadHighlights();
    await saveHighlights(list.filter((h) => h.id !== id));
    document.querySelectorAll(`[${HIGHLIGHT_ATTR}="${CSS.escape(id)}"]`).forEach(unwrapSpan);
    applied.delete(id);
  }

  async function clearAll() {
    const key = storageKey();
    await Promise.allSettled([
      chrome.storage.sync.remove(key),
      chrome.storage.local.remove(key)
    ]);
    areaCache.delete(key);
    document.querySelectorAll('.' + CLASS).forEach(unwrapSpan);
    applied.clear();
  }

  function unwrapSpan(span) {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  }

  function getTextIndex(root) {
    root = root || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('.hl-ext-tooltip')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const segments = [];
    let total = '';
    let node;
    while ((node = walker.nextNode())) {
      segments.push({ node, start: total.length, end: total.length + node.nodeValue.length });
      total += node.nodeValue;
    }
    return { segments, total };
  }

  function findPositionAt(segments, idx) {
    for (const s of segments) {
      if (idx >= s.start && idx <= s.end) {
        return { node: s.node, offset: idx - s.start };
      }
    }
    return null;
  }

  function toLinearIndex(segments, container, offset) {
    if (container.nodeType === Node.TEXT_NODE) {
      for (const s of segments) {
        if (s.node === container) return s.start + Math.min(offset, s.node.nodeValue.length);
      }
      return -1;
    }
    let probe;
    try {
      probe = document.createRange();
      probe.setStart(container, offset);
      probe.collapse(true);
    } catch {
      return -1;
    }
    for (const s of segments) {
      const r = document.createRange();
      r.selectNodeContents(s.node);
      const cmpStart = probe.compareBoundaryPoints(Range.START_TO_START, r);
      const cmpEnd = probe.compareBoundaryPoints(Range.START_TO_END, r);
      if (cmpStart >= 0 && cmpEnd <= 0) {
        const textRange = document.createRange();
        textRange.setStart(s.node, 0);
        textRange.setEnd(s.node, s.node.nodeValue.length);
        try {
          const pre = document.createRange();
          pre.setStart(s.node, 0);
          pre.setEnd(container, offset);
          return s.start + pre.toString().length;
        } catch {
          return s.start;
        }
      }
      if (cmpStart < 0) {
        return s.start;
      }
    }
    return segments.length ? segments[segments.length - 1].end : 0;
  }

  function textNodesInRange(range) {
    if (range.collapsed) return [];
    if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
      return [{ node: range.startContainer, startOffset: range.startOffset, endOffset: range.endOffset }];
    }
    const rootNode =
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentNode
        : range.commonAncestorContainer;
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const result = [];
    let node;
    while ((node = walker.nextNode())) {
      if (!range.intersectsNode(node)) continue;
      const startOffset = node === range.startContainer ? range.startOffset : 0;
      const endOffset = node === range.endContainer ? range.endOffset : node.nodeValue.length;
      if (startOffset < endOffset) {
        result.push({ node, startOffset, endOffset });
      }
    }
    return result;
  }

  function wrapRange(range, id, color) {
    const segs = textNodesInRange(range);
    segs.forEach(({ node, startOffset, endOffset }) => {
      const parent = node.parentNode;
      if (!parent) return;
      const before = node.nodeValue.slice(0, startOffset);
      const mid = node.nodeValue.slice(startOffset, endOffset);
      const after = node.nodeValue.slice(endOffset);
      const span = document.createElement('span');
      span.className = CLASS;
      span.setAttribute(HIGHLIGHT_ATTR, id);
      span.style.setProperty('--hl-color', color);
      span.textContent = mid;
      const frag = document.createDocumentFragment();
      if (before) frag.appendChild(document.createTextNode(before));
      frag.appendChild(span);
      if (after) frag.appendChild(document.createTextNode(after));
      parent.replaceChild(frag, node);
    });
  }

  function createHighlightFromSelection(color) {
    color = color || DEFAULT_COLOR;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const text = sel.toString();
    if (!text.trim()) return null;

    const { segments, total } = getTextIndex();
    const startIdx = toLinearIndex(segments, range.startContainer, range.startOffset);
    const endIdx = toLinearIndex(segments, range.endContainer, range.endOffset);
    if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) return null;

    const prefix = total.slice(Math.max(0, startIdx - CONTEXT_LEN), startIdx);
    const suffix = total.slice(endIdx, Math.min(total.length, endIdx + CONTEXT_LEN));

    const id = 'h_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

    observerPaused = true;
    try {
      wrapRange(range, id, color);
    } finally {
      observerPaused = false;
    }
    sel.removeAllRanges();
    applied.add(id);

    const hl = { id, text, prefix, suffix, color, createdAt: Date.now() };
    addHighlight(hl).catch((e) => console.warn('highlighter: save failed', e));
    return hl;
  }

  function restoreHighlight(hl) {
    const { segments, total } = getTextIndex();
    if (!total) return false;
    const { text, prefix, suffix, id, color } = hl;
    if (!text) return false;

    let bestIdx = -1;
    let bestScore = -1;
    let searchIdx = 0;
    while (searchIdx <= total.length - text.length) {
      const idx = total.indexOf(text, searchIdx);
      if (idx < 0) break;
      const actualPrefix = total.slice(Math.max(0, idx - prefix.length), idx);
      const actualSuffix = total.slice(idx + text.length, idx + text.length + suffix.length);
      let score = 0;
      if (prefix && actualPrefix.endsWith(prefix)) score += 2;
      if (suffix && actualSuffix.startsWith(suffix)) score += 2;
      if (!prefix) score += 1;
      if (!suffix) score += 1;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
        if (score >= 4) break;
      }
      searchIdx = idx + 1;
    }
    if (bestIdx < 0) return false;

    const startPos = findPositionAt(segments, bestIdx);
    const endPos = findPositionAt(segments, bestIdx + text.length);
    if (!startPos || !endPos) return false;

    const range = document.createRange();
    try {
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);
    } catch {
      return false;
    }

    observerPaused = true;
    try {
      wrapRange(range, id, color);
    } finally {
      observerPaused = false;
    }
    return true;
  }

  async function restoreAll() {
    let highlights;
    try {
      highlights = await loadHighlights();
    } catch {
      return;
    }
    if (!highlights.length) return;
    for (const hl of highlights) {
      if (applied.has(hl.id)) continue;
      if (document.querySelector(`[${HIGHLIGHT_ATTR}="${CSS.escape(hl.id)}"]`)) {
        applied.add(hl.id);
        continue;
      }
      try {
        if (restoreHighlight(hl)) applied.add(hl.id);
      } catch (e) {
        console.warn('highlighter: restore failed', e);
      }
    }
  }

  let tooltip = null;
  function hideTooltip() {
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
  }

  function showRemoveTooltip(span) {
    hideTooltip();
    const rect = span.getBoundingClientRect();
    const id = span.getAttribute(HIGHLIGHT_ATTR);
    tooltip = document.createElement('div');
    tooltip.className = 'hl-ext-tooltip';
    tooltip.style.top = `${window.scrollY + rect.bottom + 6}px`;
    tooltip.style.left = `${window.scrollX + rect.left}px`;

    COLORS.forEach((c) => {
      const sw = document.createElement('div');
      sw.className = 'hl-ext-swatch';
      sw.style.background = c.value;
      sw.title = 'Change to ' + c.name;
      sw.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll(`[${HIGHLIGHT_ATTR}="${CSS.escape(id)}"]`).forEach((el) => {
          el.style.setProperty('--hl-color', c.value);
        });
        const list = await loadHighlights();
        const updated = list.map((h) => (h.id === id ? { ...h, color: c.value } : h));
        await saveHighlights(updated);
        hideTooltip();
      });
      tooltip.appendChild(sw);
    });

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await removeHighlight(id);
      hideTooltip();
    });
    tooltip.appendChild(removeBtn);

    document.body.appendChild(tooltip);
  }

  let selTooltip = null;
  function hideSelTooltip() {
    if (selTooltip) {
      selTooltip.remove();
      selTooltip = null;
    }
  }

  function showSelectionTooltip() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim() || sel.rangeCount === 0) {
      hideSelTooltip();
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hideSelTooltip();
      return;
    }
    hideSelTooltip();
    selTooltip = document.createElement('div');
    selTooltip.className = 'hl-ext-tooltip';
    const top = window.scrollY + rect.top - 36;
    selTooltip.style.top = `${Math.max(window.scrollY + 4, top)}px`;
    selTooltip.style.left = `${window.scrollX + rect.left}px`;

    COLORS.forEach((c) => {
      const sw = document.createElement('div');
      sw.className = 'hl-ext-swatch';
      sw.style.background = c.value;
      sw.title = c.name;
      sw.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        createHighlightFromSelection(c.value);
        hideSelTooltip();
      });
      selTooltip.appendChild(sw);
    });

    document.body.appendChild(selTooltip);
  }

  document.addEventListener('mouseup', (e) => {
    if (e.target && e.target.closest && e.target.closest('.hl-ext-tooltip')) return;
    setTimeout(showSelectionTooltip, 0);
  });

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) hideSelTooltip();
  });

  document.addEventListener('mousedown', (e) => {
    const target = e.target;
    if (selTooltip && target && !selTooltip.contains(target)) hideSelTooltip();
    if (tooltip && target && !tooltip.contains(target)) {
      const hl = target.closest && target.closest('.' + CLASS);
      if (!hl) hideTooltip();
    }
  }, true);

  document.addEventListener('click', (e) => {
    const hl = e.target.closest && e.target.closest('.' + CLASS);
    if (hl) {
      e.preventDefault();
      e.stopPropagation();
      showRemoveTooltip(hl);
    }
  }, true);

  window.addEventListener('scroll', () => {
    hideTooltip();
    hideSelTooltip();
  }, { passive: true });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        if (msg.type === 'HIGHLIGHT_SELECTION') {
          const hl = createHighlightFromSelection(msg.color || DEFAULT_COLOR);
          sendResponse({ ok: !!hl });
        } else if (msg.type === 'GET_HIGHLIGHTS') {
          const list = await loadHighlights();
          sendResponse({ list });
        } else if (msg.type === 'REMOVE_HIGHLIGHT') {
          await removeHighlight(msg.id);
          sendResponse({ ok: true });
        } else if (msg.type === 'CLEAR_ALL') {
          await clearAll();
          sendResponse({ ok: true });
        } else if (msg.type === 'SCROLL_TO') {
          const el = document.querySelector(`[${HIGHLIGHT_ATTR}="${CSS.escape(msg.id)}"]`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const prev = el.style.outline;
            el.style.outline = '2px solid rgba(0,0,0,0.35)';
            setTimeout(() => { el.style.outline = prev; }, 900);
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false });
          }
        } else {
          sendResponse({ ok: false, error: 'unknown message' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  });

  let observerPaused = false;
  let retryTimer = null;
  const observer = new MutationObserver(() => {
    if (observerPaused) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      restoreAll().catch(() => {});
    }, 400);
  });

  // React to storage changes coming from elsewhere (another device via sync,
  // another tab, or the popup). Apply adds/removes/recolors live.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' && areaName !== 'local') return;
    const key = storageKey();
    if (!(key in changes)) return;
    const change = changes[key];
    const newList = change.newValue || [];
    const oldList = change.oldValue || [];

    // Remove highlights that vanished from the stored list.
    const newIds = new Set(newList.map((h) => h.id));
    for (const prev of oldList) {
      if (!newIds.has(prev.id)) {
        document
          .querySelectorAll(`[${HIGHLIGHT_ATTR}="${CSS.escape(prev.id)}"]`)
          .forEach(unwrapSpan);
        applied.delete(prev.id);
      }
    }

    // Apply color updates in place.
    for (const hl of newList) {
      const nodes = document.querySelectorAll(
        `[${HIGHLIGHT_ATTR}="${CSS.escape(hl.id)}"]`
      );
      if (nodes.length) {
        nodes.forEach((el) => el.style.setProperty('--hl-color', hl.color));
      }
    }

    // Try to restore any newly-added highlights.
    restoreAll().catch(() => {});
  });

  function start() {
    restoreAll().catch(() => {});
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
