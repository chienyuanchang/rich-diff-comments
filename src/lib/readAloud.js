/**
 * Pure helpers for listening to a PR's Markdown changes (read aloud).
 *
 * Turns a Changes-pane block into the sentences to speak. Speech itself
 * (speechSynthesis) lives in content.js; this file only decides *what* to say.
 *
 * Loaded in two contexts:
 *   • Extension content script  → exports attached to `window.GRDC.*`
 *   • Node test runner          → exports via `module.exports`
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.GRDC = root.GRDC || {};
    Object.assign(root.GRDC, api);
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const REMOVED_SELECTOR = 'del, s, .removed';
  // Our own UI inside rendered Markdown (comment buttons, threads, markers).
  const INJECTED_UI_SELECTOR =
    '.grdc-comment-box, .grdc-thread, .grdc-sidebar, .grdc-comment-edit, .grdc-reply-box, ' +
    '.grdc-existing-thread, .grdc-comment-btn, .grdc-collapse-toggle, ' +
    '.grdc-table-thread-marker, .grdc-code-line-thread-marker';
  const READING_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, tr, pre, blockquote';
  const FILE_BOUNDARY_SELECTOR = '.markdown-body, .prose-diff';

  const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  // One sentence per chunk; long sentences split near 200 characters, because
  // Chrome cuts off long utterances. Ported from claude-read-along.
  function splitSentences(text) {
    if (!text) return [];
    const parts = String(text).match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g) || [String(text)];
    const out = [];
    for (let p of parts) {
      p = p.trim();
      if (!p) continue;
      while (p.length > 220) {
        let cut = p.lastIndexOf(', ', 200);
        if (cut < 80) cut = p.lastIndexOf(' ', 200);
        if (cut < 40) cut = 200;
        out.push(p.slice(0, cut + 1).trim());
        p = p.slice(cut + 1).trim();
      }
      if (p) out.push(p);
    }
    return out;
  }

  // A block sits wholly inside deleted content: `<del><p>…</p></del>` or `<tr class="removed">`.
  function isWhollyRemoved(blockEl) {
    for (let el = blockEl; el; el = el.parentElement) {
      if (el.matches && el.matches(REMOVED_SELECTOR)) return true;
      if (el.matches && el.matches(FILE_BOUNDARY_SELECTOR)) return false;
    }
    return false;
  }

  // Text of one reading block: the new text, and the deleted words on their own.
  function blockTexts(blockEl) {
    const clone = blockEl.cloneNode(true);
    clone.querySelectorAll(INJECTED_UI_SELECTOR).forEach((n) => n.remove());
    // Table cells and list children would otherwise run together without a space.
    clone.querySelectorAll('td, th, li').forEach((n) => n.append(' '));
    const removed = Array.from(clone.querySelectorAll(REMOVED_SELECTOR))
      .filter((n) => !(n.parentElement && n.parentElement.closest(REMOVED_SELECTOR)))
      .map((n) => collapse(n.textContent))
      .filter(Boolean);
    clone.querySelectorAll(REMOVED_SELECTOR).forEach((n) => n.remove());
    return { text: collapse(clone.textContent), removed };
  }

  // "Removed block starting with" + at most two words of the deleted text.
  function removedBlockSentence(text) {
    const words = collapse(text).split(' ').filter(Boolean).slice(0, 2).join(' ').replace(/[.,;:!?]+$/, '');
    return words ? `Removed block starting with ${words}.` : 'Removed block.';
  }

  // Sentences for one Changes-pane stop.
  //   includeRemoved — the View options "Show removed content" state: when on,
  //   an edited block's new text is followed by "Removed: …" with the deleted words.
  function changeSpeech(blockEl, options) {
    if (!blockEl || typeof blockEl.cloneNode !== 'function') return [];
    const includeRemoved = !!(options && options.includeRemoved);
    if (blockEl.tagName === 'PRE') {
      const lines = String(blockEl.textContent || '').split('\n').filter((l) => l.trim()).length;
      return [`Code block, ${lines} line${lines === 1 ? '' : 's'}.`];
    }
    const { text, removed } = blockTexts(blockEl);
    if (isWhollyRemoved(blockEl) || !text) {
      return [removedBlockSentence(text || removed.join(' '))];
    }
    const out = splitSentences(text);
    if (includeRemoved && removed.length) out.push(...splitSentences(`Removed: ${removed.join(', ')}.`));
    return out;
  }

  // Sentences for a whole added or deleted file (one Changes stop for the file).
  function fileSpeech(rootEl, changeType, fileName) {
    const name = fileName ? ` ${fileName}` : '';
    if (changeType === 'REMOVED') return [`Deleted file${name}.`];
    const out = [`New file${name}.`];
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return out;
    // Outermost reading blocks only, so a paragraph inside a list item is read once.
    const blocks = Array.from(rootEl.querySelectorAll(READING_SELECTOR))
      .filter((b) => !(b.closest && b.closest(INJECTED_UI_SELECTOR)))
      .filter((b) => !(b.parentElement && b.parentElement.closest(READING_SELECTOR) &&
        rootEl.contains(b.parentElement.closest(READING_SELECTOR))));
    blocks.forEach((b) => out.push(...changeSpeech(b, { includeRemoved: false })));
    return out;
  }

  // DOM Range of `sentence` inside the block's visible (non-deleted) text, searching
  // from character `from` of the whitespace-collapsed text. Returns { range, end } or null.
  // shortcut: text split across table cells or list children has no space between
  // nodes, so such sentences may not be found (no highlight); fine for prose.
  function sentenceRange(blockEl, sentence, from) {
    if (!blockEl || !blockEl.ownerDocument) return null;
    const doc = blockEl.ownerDocument;
    const walker = doc.createTreeWalker(blockEl, 4 /* NodeFilter.SHOW_TEXT */);
    const map = [];
    let str = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (parent && (parent.closest(INJECTED_UI_SELECTOR) ||
        (parent.closest(REMOVED_SELECTOR) && blockEl.contains(parent.closest(REMOVED_SELECTOR))))) continue;
      for (let i = 0; i < n.data.length; i++) {
        if (/\s/.test(n.data[i])) {
          if (str && !str.endsWith(' ')) { str += ' '; map.push([n, i]); }
        } else { str += n.data[i]; map.push([n, i]); }
      }
    }
    const needle = collapse(sentence);
    const at = needle ? str.indexOf(needle, from || 0) : -1;
    if (at < 0) return null;
    const [startNode, startOffset] = map[at];
    const [endNode, endOffset] = map[at + needle.length - 1];
    const range = doc.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset + 1);
    return { range, end: at + needle.length };
  }

  return { splitSentences, changeSpeech, fileSpeech, sentenceRange };
});
