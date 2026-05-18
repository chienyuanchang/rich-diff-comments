/**
 * Minimal markdown → HTML for the Preview tab.
 *
 * Handles: headings, bold/italic/strike, inline code, fenced code, links,
 * autolinks (<http://...>), images, blockquotes, bullet & numbered lists,
 * paragraphs.
 *
 * Does NOT handle: tables, task lists, footnotes, mermaid, emoji shortcodes,
 * @mention auto-linking. The Preview tab calls GitHub's own `/preview`
 * endpoint first — this renderer is the offline fallback (and a typing aid
 * before the network round-trip completes).
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

  function escapeHtmlText(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderMarkdownPreview(src) {
    if (!src || !src.trim()) {
      return '<p class="grdc-preview-empty">Nothing to preview</p>';
    }

    // 1. Mask fenced code blocks so their content isn't transformed.
    const codeBlocks = [];
    let s = src.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
      const i = codeBlocks.push({ lang, code }) - 1;
      return `\u0000CODEBLOCK${i}\u0000`;
    });

    // 2. Mask inline code so other rules don't touch it.
    const inlineCodes = [];
    s = s.replace(/`([^`\n]+)`/g, (_m, code) => {
      const i = inlineCodes.push(code) - 1;
      return `\u0000INLINECODE${i}\u0000`;
    });

    // 3. Escape remaining HTML.
    s = escapeHtmlText(s);

    // 4. Block-level: headings, blockquote, lists.
    s = s.replace(/^(#{1,6})\s+(.+)$/gm,
      (_m, hashes, txt) => `<h${hashes.length}>${txt}</h${hashes.length}>`);

    s = s.replace(/^(?:&gt;\s?.*(?:\n|$))+/gm, (block) => {
      const inner = block.replace(/^&gt;\s?/gm, '').trim();
      return `<blockquote>${inner.replace(/\n/g, '<br>')}</blockquote>\n`;
    });

    s = s.replace(/(?:^[-*+]\s+.+(?:\n|$))+/gm, (block) => {
      const items = block.trim().split('\n').map((l) => l.replace(/^[-*+]\s+/, ''));
      return '<ul>' + items.map((i) => `<li>${i}</li>`).join('') + '</ul>\n';
    });

    s = s.replace(/(?:^\d+\.\s+.+(?:\n|$))+/gm, (block) => {
      const items = block.trim().split('\n').map((l) => l.replace(/^\d+\.\s+/, ''));
      return '<ol>' + items.map((i) => `<li>${i}</li>`).join('') + '</ol>\n';
    });

    // 5. Inline: images BEFORE links (so `![alt](src)` doesn't get eaten by
    //    the link regex), then bold / italic / strike / autolinks.
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    s = s.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

    // 6. Wrap remaining paragraphs.
    s = s.split(/\n{2,}/).map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (/^<(h\d|ul|ol|blockquote|pre|p|img|div)/.test(trimmed)) return trimmed;
      if (/^\u0000CODEBLOCK\d+\u0000$/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    }).join('\n');

    // 7. Restore code (escaping their contents).
    s = s.replace(/\u0000INLINECODE(\d+)\u0000/g,
      (_m, i) => `<code>${escapeHtmlText(inlineCodes[+i])}</code>`);
    s = s.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_m, i) => {
      const { lang, code } = codeBlocks[+i];
      // Trim the trailing newline left by the source ``` so we don't render
      // an extra blank line before </code>.
      const trimmed = code.replace(/\n+$/, '');
      const langAttr = lang ? ` class="language-${escapeHtmlText(lang)}"` : '';
      return `<pre><code${langAttr}>${escapeHtmlText(trimmed)}</code></pre>`;
    });

    return s;
  }

  return { renderMarkdownPreview };
});
