/**
 * Markdown PR Comments for Azure DevOps
 *
 * v0.1.0 — first UI iteration.
 *
 *   • Detects the rendered-markdown Preview container on ADO PR pages.
 *   • Fetches the file's raw source at the PR's source branch.
 *   • Runs the shared `mapBlocksToSourceLines` (see src/lib/lineMap.js)
 *     to figure out which DOM block belongs to which source line.
 *   • Adds a `+` button that hovers into every commentable block.
 *   • Click → opens an inline comment box → submit → creates a real PR
 *     review thread via ADORC.createThread.
 *
 * NOT YET DONE (P1 / next iteration):
 *   • Rendering existing threads as 💬 badges.
 *   • Reply / resolve / edit / delete from the UI.
 *   • Threads sidebar / Outline / Changes tabs.
 *   • SPA route detection is intentionally minimal — a MutationObserver
 *     watches for the preview container appearing so switching files
 *     re-initializes. Full route hooks land when we start juggling
 *     multiple files at once.
 *
 * The `window.ADORC_probe` DevTools helper from v0.0.x is still exposed
 * so you can exercise the adapter directly from the console.
 */

(function () {
  'use strict';

  const LOG = '[ADRC]';
  const adapter = (typeof window !== 'undefined' && window.ADORC) || null;

  if (!adapter) {
    console.error(`${LOG} adapter (window.ADORC) not loaded. Check that src/adapters/ado.js is listed BEFORE content.js in manifest.json content_scripts.js.`);
    return;
  }

  console.log(`${LOG} content.js loaded on ${window.location.pathname}`);

  const ctx = adapter.parsePRUrl(window.location.pathname);
  if (!ctx) {
    console.log(`${LOG} not a PR page (path=${window.location.pathname}), skipping init`);
    return;
  }
  console.log(`${LOG} parsed PR context:`, ctx);

  // Fire-and-forget: fetch the current user's identity so Edit / Delete
  // affordances can be shown only on their own comments. If this fails
  // (offline, auth cookie missing), we just skip the buttons — the rest
  // of the UI still works.
  //
  // ADO returns identity as an IdentityRef with three usable fields —
  // `id` (legacy TFS GUID), `descriptor` (subject descriptor), and
  // `uniqueName` (email). The GUIDs on `connectionData.authenticatedUser`
  // don't always equal the GUIDs on `comment.author` (different identity
  // systems overlap here), so we cache all three and match on ANY.
  (async () => {
    try {
      const data = await adapter.getConnectionData(ctx);
      const u = data && data.authenticatedUser;
      if (u && (u.id || u.descriptor || u.uniqueName)) {
        currentUserIdentity = {
          id: u.id || null,
          descriptor: u.descriptor || null,
          uniqueName: u.uniqueName || null,
          displayName: u.displayName || u.providerDisplayName || null
        };
        console.log(`${LOG} authenticated as`, currentUserIdentity);
        // Re-render any badges that were built before we knew the user id
        // so Edit / Delete affordances appear on their own comments.
        if (currentFilePathCached) refreshThreadBadges();
      } else {
        console.warn(`${LOG} connectionData returned no authenticatedUser — edit/delete affordances hidden`);
      }
    } catch (err) {
      console.warn(`${LOG} getConnectionData failed (edit/delete will be hidden):`, err);
    }
  })();

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Return the file path being viewed in the current PR, or null if none.
   * ADO's Files tab uses `?path=/README.md` in the query string.
   */
  function currentFilePath() {
    return new URLSearchParams(window.location.search).get('path') || null;
  }

  /**
   * The PR source branch (stripped of the refs/heads/ prefix). Cached on
   * the ctx object because it's stable across file switches.
   */
  let _sourceBranchPromise = null;
  function getSourceBranch() {
    if (!_sourceBranchPromise) {
      _sourceBranchPromise = adapter.getPullRequest(ctx).then(pr => {
        const branch = (pr.sourceRefName || '').replace(/^refs\/heads\//, '');
        if (!branch) throw new Error('Could not derive source branch from PR');
        return branch;
      });
    }
    return _sourceBranchPromise;
  }

  /**
   * Fetch + line-map the current file. Returns Map<Element, {path, line}>.
   * Also caches the raw source string so downstream helpers
   * (`wireCodeBlockLineTracking`, `refreshThreadBadges`) can look up
   * fence ranges via `GRDC.findFenceRangeAroundLine`.
   */
  async function buildFileLineMap(container, filePath) {
    await adapter.resolveIds(ctx);
    const branch = await getSourceBranch();
    const source = await adapter.getFileSource(ctx, filePath, { version: branch, versionType: 'branch' });
    const sourceLines = source.split('\n');
    currentSource = source;

    const GRDC = window.GRDC || {};
    const { mapBlocksToSourceLines, buildSourceIndex, findTextInSource, findFrontmatterRange, computeTableRowLine } = GRDC;
    if (typeof mapBlocksToSourceLines !== 'function') {
      throw new Error('window.GRDC.mapBlocksToSourceLines missing — check manifest content_scripts.js order');
    }

    return mapBlocksToSourceLines(
      container,
      sourceLines,
      filePath,
      { buildSourceIndex, findTextInSource, findFrontmatterRange, computeTableRowLine },
      console.log.bind(console)
    );
  }

  // ── + button attachment ──────────────────────────────────────────────

  // A minimal SVG `+` glyph — sits pixel-perfect at the button's optical
  // center regardless of the host page's font metrics.
  const PLUS_SVG = '<svg viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // ── Multi-line range drag state (module-scoped) ───────────────────────
  //
  // Users drag the `+` button of one block down to the `+` button of
  // another block to comment on a range. State lives here so a single
  // pointer gesture is shared across every attached button.
  let dragState = null;
  // Set true briefly after a drag-drop so the button's `click` handler
  // (which fires after mouseup) can distinguish "was drag, not click"
  // and skip opening the single-line editor.
  let dragJustCompleted = false;
  const DRAG_THRESHOLD_PX = 4;

  function attachCommentButton(block, info) {
    // `buttonAnchor` returns the block itself for normal elements
    // (paragraphs, headings, lists, code blocks) and the first cell for
    // `<tr>` (rows can't host children directly). Both the dedupe marker
    // AND the `.adrc-hoverable` class need to live on the HOST — CSS
    // needs the class on the same element that owns the button so
    // `.adrc-hoverable:hover > .adrc-comment-btn` matches on hover.
    // Without this, `+` was invisible over table rows.
    const GRDC = window.GRDC || {};
    const host = (typeof GRDC.buttonAnchor === 'function' ? GRDC.buttonAnchor(block) : block) || block;

    if (host.dataset.adrcHasButton) return;
    host.dataset.adrcHasButton = '1';
    host.classList.add('adrc-hoverable');
    // Stash the mapper-assigned line + path on the host so multi-line
    // drag can look up the end block's line without walking the map.
    host.dataset.adrcLine = String(info.line);
    host.dataset.adrcPath = info.path;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'adrc-comment-btn';
    btn.title = `Comment on ${info.path}:${info.line}\nDrag down to another + to comment on a range`;
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = PLUS_SVG;
    // Track which line the button currently represents. For non-code
    // blocks this stays === info.line. For <pre>, mousemove keeps it in
    // sync with the row under the cursor.
    btn.dataset.adrcLine = String(info.line);

    // Multi-line drag: mousedown records the anchor, mousemove escalates
    // to a drag once past DRAG_THRESHOLD_PX, mouseup on another `+`
    // opens the range compose. A plain click (no movement past threshold)
    // still opens the single-line compose via the click handler below.
    btn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // left button only
      e.preventDefault(); // no text-selection during drag
      // For code blocks, `btn.dataset.adrcLine` is kept in sync with the
      // hovered row by the sliding-button mousemove; using it here means
      // the drag anchor is the line the cursor was actually on, not the
      // fence's first content line.
      const anchorLine = parseInt(btn.dataset.adrcLine, 10) || info.line;
      dragState = {
        anchorBlock: block,
        anchorHost: host,
        anchorInfo: info,
        anchorLine,
        anchorButton: btn,
        startX: e.clientX,
        startY: e.clientY,
        isDragging: false,
        lastHighlighted: []
      };
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // If the mouseup just fired a drag-completion, skip the click so
      // we don't double-open (once for range, once for single-line).
      if (dragJustCompleted) {
        dragJustCompleted = false;
        return;
      }
      const trackedLine = parseInt(btn.dataset.adrcLine, 10) || info.line;
      openCommentBox(block, info, trackedLine);
    });

    host.appendChild(btn);

    // Code blocks get per-line targeting via a sliding button. The `<pre>`
    // isn't wrapped in per-line `<div>`s (ADO's highlighter uses spans),
    // so we compute the row under the cursor from Y offset + line height.
    if (block.tagName === 'PRE') {
      wireCodeBlockLineTracking(block, btn, info);
    }
  }

  // ── Drag handlers (multi-line range comments) ────────────────────────

  function onDragMove(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.isDragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragState.isDragging = true;
      document.body.classList.add('adrc-dragging');
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const overHost = el && el.closest('.adrc-hoverable');
    if (!overHost) return;
    // Only highlight blocks in the same file (same path stashed on host).
    if (overHost.dataset.adrcPath !== dragState.anchorInfo.path) return;
    paintRangeHover(dragState.anchorHost, overHost);
  }

  function paintRangeHover(startHost, endHost) {
    if (!dragState) return;
    // Clear whatever was highlighted last frame.
    dragState.lastHighlighted.forEach(b => b.classList.remove('adrc-range-hover'));
    // Walk the current preview's hoverable blocks and mark the inclusive
    // range between anchor and drop target (in DOM order).
    const all = Array.from(document.querySelectorAll('.markdown-preview-container .adrc-hoverable'));
    const si = all.indexOf(startHost);
    const ei = all.indexOf(endHost);
    if (si < 0 || ei < 0) return;
    const [lo, hi] = si < ei ? [si, ei] : [ei, si];
    const highlighted = all.slice(lo, hi + 1);
    highlighted.forEach(b => b.classList.add('adrc-range-hover'));
    dragState.lastHighlighted = highlighted;
  }

  function onDragEnd(e) {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.body.classList.remove('adrc-dragging');

    const state = dragState;
    dragState = null;
    if (!state) return;

    // Always clear the highlight even if the drag was cancelled.
    state.lastHighlighted.forEach(b => b.classList.remove('adrc-range-hover'));

    if (!state.isDragging) return; // plain click — let click handler take over

    // Drop target: a `.adrc-hoverable` block's host. Same-host is normally
    // rejected (not a real drag) EXCEPT on code blocks, where the whole
    // fence is one host and the tracked line differs between start and
    // end — that's how intra-fence range selection works.
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const endHost = el && el.closest('.adrc-hoverable');
    if (!endHost) return;
    if (endHost.dataset.adrcPath !== state.anchorInfo.path) return;

    // For code blocks, the button inside the host has its own tracked
    // line (updated by the sliding-button mousemove). Prefer that over
    // the host's `data-adrc-line` (which is the fence's first content
    // line). For non-code blocks, both values are equal.
    const endBtn = endHost.querySelector('.adrc-comment-btn');
    const endBtnLine = endBtn ? parseInt(endBtn.dataset.adrcLine, 10) : NaN;
    const endHostLine = parseInt(endHost.dataset.adrcLine, 10);
    const endLine = Number.isFinite(endBtnLine) ? endBtnLine : endHostLine;
    if (!Number.isFinite(endLine)) return;

    // Same-host drop: only meaningful on code blocks with a different
    // tracked line (dragging across lines inside one fenced block).
    if (endHost === state.anchorHost) {
      const isCodeBlock = endHost.tagName === 'PRE';
      if (!isCodeBlock) return;
      if (endLine === state.anchorLine) return;
    }

    // Prevent the subsequent click on the anchor button from opening a
    // second (single-line) editor.
    dragJustCompleted = true;
    setTimeout(() => { dragJustCompleted = false; }, 300);

    openCommentBox(
      state.anchorBlock,
      state.anchorInfo,
      state.anchorLine,
      endLine
    );
  }

  /**
   * On mousemove over a code block, slide the `+` button vertically to
   * track the source line the cursor is over. Same technique the GitHub
   * extension uses — see extensions/github/content.js.
   *
   * Row 0 corresponds to the first content line of the fence. We prefer
   * the authoritative range from `GRDC.findFenceRangeAroundLine(source)`
   * because DOM `innerText.split('\n')` over-counts when the highlighter
   * wraps single source lines across multiple visual rows.
   *
   * DOM row count and source range don't always match 1:1 — long lines
   * can wrap (more DOM rows than source lines), or some source lines may
   * not render as separate rows (fewer DOM rows than source). We measure
   * the pre's actual height, then linearly interpolate rowIdx to source
   * line so the slider covers the full source range no matter how the
   * highlighter chose to lay things out.
   */
  function wireCodeBlockLineTracking(pre, btn, info) {
    const GRDC = window.GRDC || {};
    let sourceStart = info.line;
    let sourceEnd = info.line;

    // Prefer source-based range (authoritative).
    if (typeof GRDC.findFenceRangeAroundLine === 'function' && currentSource) {
      const range = GRDC.findFenceRangeAroundLine(currentSource, info.line);
      if (range) {
        sourceStart = range.start;
        sourceEnd = range.end;
      }
    } else {
      // Fallback: count rendered lines (may over-count with wrapping).
      const text = (pre.innerText || '').replace(/\n+$/, '');
      const renderedLineCount = Math.max(1, text.split('\n').length);
      sourceEnd = sourceStart + renderedLineCount - 1;
    }

    const cs = getComputedStyle(pre);
    const cssLineHeight = parseFloat(cs.lineHeight);
    // If `line-height: normal`, parseFloat returns NaN. Fall back to
    // font-size * 1.5 (a reasonable typographic default), then 18px.
    const fontSizeGuess = parseFloat(cs.fontSize) || 14;
    let lineHeight = Number.isFinite(cssLineHeight) && cssLineHeight > 0
      ? cssLineHeight
      : fontSizeGuess * 1.5;

    // Try to measure a real rendered line if the highlighter wraps each
    // source line in an element (span/div). More accurate than trusting
    // the computed line-height, which can lie when the block is dense.
    const firstChildLine = pre.querySelector('span, div, code > *');
    if (firstChildLine) {
      const rectH = firstChildLine.getBoundingClientRect().height;
      if (rectH > 0 && rectH < 60) {
        lineHeight = rectH;
      }
    }
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) lineHeight = 18;

    const preTopPad = parseFloat(cs.paddingTop) || 0;
    const preBotPad = parseFloat(cs.paddingBottom) || 0;

    // Size the `+` so it fits within a single rendered line (no visual
    // overlap onto adjacent rows). Clamp so it stays clickable on huge
    // font-size code blocks and legible on tiny ones.
    const btnSize = Math.max(14, Math.min(22, Math.round(lineHeight - 2)));
    btn.style.width = btnSize + 'px';
    btn.style.height = btnSize + 'px';
    const svg = btn.querySelector('svg');
    if (svg) {
      const glyphSize = Math.max(10, btnSize - 8);
      svg.style.width = glyphSize + 'px';
      svg.style.height = glyphSize + 'px';
    }

    // Stash on the block so openCommentBox + interior-line lookup can
    // read the range without re-measuring.
    pre.dataset.adrcRangeStart = String(sourceStart);
    pre.dataset.adrcRangeEnd = String(sourceEnd);
    pre.dataset.adrcLineHeight = String(lineHeight);

    pre.addEventListener('mousemove', (e) => {
      // Re-measure on each move — the DOM may reflow after images load,
      // the user resizes the window, etc.
      const rect = pre.getBoundingClientRect();
      const contentHeight = Math.max(1, rect.height - preTopPad - preBotPad);
      const domRowCount = Math.max(1, Math.round(contentHeight / lineHeight));
      const sourceRowCount = Math.max(1, sourceEnd - sourceStart + 1);
      // Scale factor maps DOM row → source line proportionally so the
      // slider reaches sourceEnd at the block's visual bottom regardless
      // of whether the highlighter wrapped or collapsed rows.
      const scale = sourceRowCount / domRowCount;

      const yInPre = e.clientY - rect.top + pre.scrollTop;
      const yInText = yInPre - preTopPad;
      // Sub-row precision: use the *fractional* row position for line
      // resolution so users can access every source line even when
      // `scale > 1` (source has more lines than DOM rows). Without this,
      // adjacent source lines that share a DOM row would be unreachable —
      // moving one row down would jump 2+ source lines and skip one.
      const fractionalRow = yInText / lineHeight;
      const clampedFraction = Math.max(0, Math.min(domRowCount, fractionalRow));
      // Button snaps to whole DOM rows so it looks anchored to a line.
      let rowIdx = Math.floor(clampedFraction);
      if (rowIdx >= domRowCount) rowIdx = domRowCount - 1;
      const rowCenter = preTopPad + (rowIdx + 0.5) * lineHeight - pre.scrollTop;
      btn.style.top = rowCenter + 'px';
      btn.style.transform = 'translateY(-50%)';

      const resolvedLine = Math.min(
        sourceEnd,
        sourceStart + Math.round(clampedFraction * scale)
      );
      btn.dataset.adrcLine = String(resolvedLine);
      btn.title = `Comment on ${info.path}:${resolvedLine}`;
    });
  }

  // ── Comment box (compose new thread) ─────────────────────────────────

  function openCommentBox(block, info, trackedLine, endLineParam) {
    // Only one compose editor open at a time.
    document.querySelectorAll('.adrc-editor.adrc-compose-editor').forEach(el => el.remove());

    const prefillLine = trackedLine || info.line;
    // Range mode: drag from one `+` to another. `endLineParam` is the
    // other block's line (either > or < prefillLine). Normalize so start
    // is always the smaller line.
    const isRange = Number.isFinite(endLineParam) && endLineParam !== prefillLine;
    const rangeStartLine = isRange ? Math.min(prefillLine, endLineParam) : prefillLine;
    const rangeEndLine   = isRange ? Math.max(prefillLine, endLineParam) : prefillLine;

    // Code-block mode: single line inside a fence. Only applies when
    // not already in range mode.
    const isCodeBlock = !isRange && block.tagName === 'PRE';
    let codeRangeStart = info.line;
    let codeRangeEnd = info.line;
    if (isCodeBlock) {
      codeRangeStart = parseInt(block.dataset.adrcRangeStart, 10) || info.line;
      codeRangeEnd = parseInt(block.dataset.adrcRangeEnd, 10) || info.line;
    }

    const { editor, textarea } = createEditor({
      submitLabel: 'Comment',
      placeholder: 'Write your comment (Markdown supported). Ctrl+Enter to submit.',
      minRows: 3,
      onSubmit: async (content) => {
        await adapter.resolveIds(ctx);

        let finalLine = prefillLine;
        let finalEndLine;
        if (isRange) {
          const startInput = editor.querySelector('.adrc-line-input-start');
          const endInput = editor.querySelector('.adrc-line-input-end');
          const s = parseInt(startInput && startInput.value, 10);
          const e = parseInt(endInput && endInput.value, 10);
          finalLine = Number.isFinite(s) ? s : rangeStartLine;
          finalEndLine = Number.isFinite(e) ? e : rangeEndLine;
          if (finalLine > finalEndLine) {
            const swap = finalLine; finalLine = finalEndLine; finalEndLine = swap;
          }
        } else if (isCodeBlock) {
          const lineInput = editor.querySelector('.adrc-line-input');
          const v = parseInt(lineInput && lineInput.value, 10);
          if (Number.isFinite(v) && v >= codeRangeStart && v <= codeRangeEnd) {
            finalLine = v;
          }
        }

        const opts = { content, line: finalLine, filePath: info.path };
        if (finalEndLine && finalEndLine !== finalLine) opts.endLine = finalEndLine;

        const thread = await adapter.createThread(ctx, opts);
        const summary = finalEndLine && finalEndLine !== finalLine
          ? `${finalLine}\u2013${finalEndLine}`
          : String(finalLine);
        console.log(`${LOG} thread posted: id=${thread.id} on ${info.path}:${summary}`);
        editor.remove();
        await refreshThreadBadges();
      }
    });
    editor.classList.add('adrc-compose-editor');

    const header = document.createElement('div');
    header.className = 'adrc-editor-header';
    if (isRange) {
      header.innerHTML =
        `Comment on <strong>${escapeHtml(info.path)}</strong> \u00b7 lines ` +
        `<input type="number" class="adrc-line-input adrc-line-input-start" min="1" value="${rangeStartLine}" /> \u2013 ` +
        `<input type="number" class="adrc-line-input adrc-line-input-end" min="1" value="${rangeEndLine}" />`;
    } else if (isCodeBlock && codeRangeEnd > codeRangeStart) {
      header.innerHTML =
        `Comment on <strong>${escapeHtml(info.path)}</strong> \u00b7 line ` +
        `<input type="number" class="adrc-line-input" min="${codeRangeStart}" max="${codeRangeEnd}" value="${prefillLine}" /> ` +
        `<span class="adrc-line-hint">(code block, lines ${codeRangeStart}\u2013${codeRangeEnd})</span>`;
    } else {
      header.innerHTML = `Comment on <strong>${escapeHtml(info.path + ':' + prefillLine)}</strong>`;
    }
    editor.insertBefore(header, editor.firstChild);

    // Insert after the block so the box appears directly below the
    // context. For <tr> blocks, insert after the parent <table> instead.
    const parent = block.tagName === 'TR' ? (block.closest('table') || block) : block;
    parent.parentNode.insertBefore(editor, parent.nextSibling);

    textarea.focus();
  }

  // ── Existing-thread rendering (💬 badge + expandable panel) ──────────

  // Cached per-file so we can rebuild badges without re-running lineMap.
  let currentLineToBlock = new Map();
  let currentFilePathCached = null;
  // Raw source string for the current file. Cached by buildFileLineMap
  // so `wireCodeBlockLineTracking` can look up fence ranges via
  // `GRDC.findFenceRangeAroundLine` instead of DOM-counting (which
  // over-counts on wrapped or multi-line-per-row highlighter output).
  let currentSource = null;

  // Populated on init from GET /_apis/connectionData so we know which
  // comments are the current user's own — used to show Edit / Delete
  // affordances only on their own posts. Object with { id, descriptor,
  // uniqueName, displayName } — see isOwnComment() for why we keep three
  // matchable fields.
  let currentUserIdentity = null;

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function formatTime(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(); } catch (_) { return iso; }
  }

  function isOwnComment(c) {
    if (!currentUserIdentity || !c || !c.author) return false;
    const a = c.author;
    const me = currentUserIdentity;
    // Match on any identity field — ADO sometimes returns different GUIDs
    // for the same user across different endpoints, but at least one of
    // (id, descriptor, uniqueName) is stable.
    if (me.id && a.id && me.id === a.id) return true;
    if (me.descriptor && a.descriptor && me.descriptor === a.descriptor) return true;
    if (me.uniqueName && a.uniqueName && me.uniqueName === a.uniqueName) return true;
    return false;
  }

  function renderMarkdown(src) {
    const GRDC = window.GRDC || {};
    if (typeof GRDC.renderMarkdownPreview === 'function') {
      return GRDC.renderMarkdownPreview(src || '');
    }
    // Fallback if markdownPreview.js didn't load: at least don't inject
    // raw HTML — escape and preserve line breaks.
    return escapeHtml(src || '').replace(/\n/g, '<br>');
  }

  function renderCommentHtml(c) {
    const author = escapeHtml((c.author && c.author.displayName) || 'Unknown');
    const time = escapeHtml(formatTime(c.publishedDate));
    const edited = c.lastContentUpdatedDate && c.lastContentUpdatedDate !== c.publishedDate
      ? ' <span class="adrc-thread-comment-edited">(edited)</span>'
      : '';

    // Avatar rendered only when the author has an imageUrl — present on
    // most ADO responses via IdentityRef._links.avatar.href / imageUrl.
    const imageUrl = c.author && c.author.imageUrl;
    const avatarHtml = imageUrl
      ? `<img class="adrc-thread-comment-avatar" src="${escapeAttr(imageUrl)}" alt="" />`
      : '';

    // Edit / Delete affordances live in the meta row's right side (like
    // GitHub's comment header) so they're near the author identity and
    // don't push the body around. Only shown on the current user's own
    // undeleted comments.
    const ownActions = isOwnComment(c) && !c.isDeleted
      ? `<span class="adrc-comment-inline-actions">` +
          `<button type="button" class="adrc-comment-inline-btn adrc-edit-comment" data-comment-id="${c.id}">Edit</button>` +
          `<button type="button" class="adrc-comment-inline-btn adrc-delete-comment" data-comment-id="${c.id}">Delete</button>` +
        `</span>`
      : '';

    const meta =
      `<div class="adrc-thread-comment-meta">` +
        `<span class="adrc-thread-comment-meta-left">` +
          avatarHtml +
          `<span class="adrc-thread-comment-author">${author}</span>` +
          ` · ${time}${edited}` +
        `</span>` +
        ownActions +
      `</div>`;

    if (c.isDeleted) {
      return `<div class="adrc-thread-comment" data-comment-id="${c.id}">${meta}<div class="adrc-thread-comment-body adrc-thread-comment-deleted">(This comment was deleted.)</div></div>`;
    }

    // Render comment content as markdown so **bold**, code, lists, links
    // render like they do in the actual review.
    const bodyHtml = renderMarkdown(c.content || '');

    return `<div class="adrc-thread-comment" data-comment-id="${c.id}">${meta}<div class="adrc-thread-comment-body">${bodyHtml}</div></div>`;
  }

  // ── Shared editor (Write / Preview tabs, toolbar, auto-grow) ─────────
  //
  // Same UX pattern as the GitHub extension's comment editor. Used by
  // three callsites: compose (new thread), reply (in an expanded panel),
  // and edit (inline replacement of a comment body).

  function autoGrow(textarea, cap) {
    cap = cap || 400;
    const grow = () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, cap) + 'px';
    };
    textarea.addEventListener('input', grow);
    // Also grow on next frame after value is set programmatically.
    requestAnimationFrame(grow);
  }

  const TOOLBAR_BUTTONS = [
    { md: 'heading', title: 'Heading', label: 'H' },
    { md: 'bold',    title: 'Bold (Ctrl+B)',   label: '<b>B</b>' },
    { md: 'italic',  title: 'Italic (Ctrl+I)', label: '<i>I</i>' },
    { md: 'code',    title: 'Inline code',     label: '&lt;&gt;' },
    { md: 'link',    title: 'Link',            label: '🔗' },
    { md: 'quote',   title: 'Blockquote',      label: '❝' },
    { md: 'ul',      title: 'Unordered list',  label: '•' },
    { md: 'ol',      title: 'Ordered list',    label: '1.' },
    { md: 'task',    title: 'Task list',       label: '☑' }
  ];

  function buildToolbarHtml() {
    return '<div class="adrc-editor-toolbar">' +
      TOOLBAR_BUTTONS.map(b =>
        `<button type="button" class="adrc-editor-toolbar-btn" data-md="${b.md}" title="${escapeAttr(b.title)}">${b.label}</button>`
      ).join('') +
      '</div>';
  }

  function applyMarkdownAction(textarea, action) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const selected = value.slice(start, end);

    // Inline wraps around the selection.
    const wraps = {
      bold:   ['**', '**', 'text'],
      italic: ['*',  '*',  'text'],
      code:   ['`',  '`',  'code'],
      link:   ['[',  '](url)', 'text']
    };
    // Line-prefix operations apply to every line in the (possibly empty)
    // selection, expanding the selection to full lines first.
    const linePrefix = {
      heading: '## ',
      quote:   '> ',
      ul:      '- ',
      ol:      '1. ',
      task:    '- [ ] '
    };

    if (wraps[action]) {
      const [before, after, placeholder] = wraps[action];
      const filler = selected || placeholder;
      const insert = before + filler + after;
      textarea.value = value.slice(0, start) + insert + value.slice(end);
      const newStart = start + before.length;
      textarea.setSelectionRange(newStart, newStart + filler.length);
    } else if (linePrefix[action]) {
      const beforeSel = value.slice(0, start);
      const lineStart = beforeSel.lastIndexOf('\n') + 1;
      const afterSel = value.slice(end);
      const nextNewline = afterSel.indexOf('\n');
      const lineEnd = nextNewline < 0 ? value.length : end + nextNewline;

      const lines = value.slice(lineStart, lineEnd).split('\n');
      const prefixed = lines.map(l => linePrefix[action] + l).join('\n');
      textarea.value = value.slice(0, lineStart) + prefixed + value.slice(lineEnd);
      textarea.setSelectionRange(lineStart, lineStart + prefixed.length);
    }
    textarea.dispatchEvent(new Event('input')); // trigger auto-grow
  }

  function wireEditor(editor) {
    const textarea = editor.querySelector('.adrc-editor-textarea');
    const previewPane = editor.querySelector('.adrc-editor-preview');
    const toolbar = editor.querySelector('.adrc-editor-toolbar');
    const tabs = editor.querySelectorAll('.adrc-editor-tab');

    // Toolbar buttons wrap the selection with markdown syntax.
    editor.querySelectorAll('.adrc-editor-toolbar-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        applyMarkdownAction(textarea, btn.dataset.md);
        textarea.focus();
      });
    });

    // Write ↔ Preview toggle.
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.tab;
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        if (mode === 'write') {
          textarea.style.display = '';
          toolbar.style.display = '';
          previewPane.style.display = 'none';
          textarea.focus();
        } else {
          previewPane.innerHTML = renderMarkdown(textarea.value);
          textarea.style.display = 'none';
          toolbar.style.display = 'none';
          previewPane.style.display = '';
        }
      });
    });

    autoGrow(textarea);
  }

  /**
   * Build a fully-wired editor element. Returned object exposes the
   * editor root plus the textarea and buttons so callers can programmatically
   * set values, focus, or reset state on error.
   *
   * @param {object} opts
   * @param {string} opts.submitLabel  Text shown on the submit button.
   * @param {string} [opts.initialValue]  Pre-fill for the textarea.
   * @param {string} [opts.placeholder]
   * @param {number} [opts.minRows=3]
   * @param {(content: string) => Promise<void>} opts.onSubmit
   *     Called with the trimmed textarea content when submit is clicked.
   *     Throw to surface an error next to the actions row.
   * @param {(editor: HTMLElement) => void} [opts.onCancel]
   *     Defaults to `editor.remove()`.
   */
  function createEditor(opts) {
    const editor = document.createElement('div');
    editor.className = 'adrc-editor';
    editor.innerHTML = [
      '<div class="adrc-editor-tabs">',
      '  <button type="button" class="adrc-editor-tab active" data-tab="write">Write</button>',
      '  <button type="button" class="adrc-editor-tab" data-tab="preview">Preview</button>',
      '</div>',
      buildToolbarHtml(),
      `<textarea class="adrc-editor-textarea" rows="${opts.minRows || 3}" placeholder="${escapeAttr(opts.placeholder || '')}"></textarea>`,
      '<div class="adrc-editor-preview" style="display:none"></div>',
      '<div class="adrc-editor-actions">',
      '  <button type="button" class="adrc-editor-cancel">Cancel</button>',
      `  <button type="button" class="adrc-editor-submit">${escapeHtml(opts.submitLabel)}</button>`,
      '</div>'
    ].join('\n');

    const textarea = editor.querySelector('.adrc-editor-textarea');
    if (opts.initialValue) textarea.value = opts.initialValue;

    wireEditor(editor);

    const submitBtn = editor.querySelector('.adrc-editor-submit');
    const cancelBtn = editor.querySelector('.adrc-editor-cancel');

    cancelBtn.addEventListener('click', () => {
      if (opts.onCancel) opts.onCancel(editor);
      else editor.remove();
    });

    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submitBtn.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelBtn.click();
      }
    });

    submitBtn.addEventListener('click', async () => {
      const content = textarea.value.trim();
      if (!content) { textarea.focus(); return; }
      const oldError = editor.querySelector('.adrc-editor-error');
      if (oldError) oldError.remove();
      const originalLabel = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Posting…';
      try {
        await opts.onSubmit(content, editor);
      } catch (err) {
        console.error(`${LOG} editor submit failed:`, err);
        const actions = editor.querySelector('.adrc-editor-actions');
        const errNode = document.createElement('span');
        errNode.className = 'adrc-editor-error';
        errNode.textContent = String(err.message || err).slice(0, 200);
        actions.insertBefore(errNode, actions.firstChild);
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    });

    return { editor, textarea, submitBtn, cancelBtn };
  }

  function buildThreadPanel(thread) {
    const panel = document.createElement('div');
    panel.className = 'adrc-thread-panel';
    panel.dataset.threadId = thread.id;
    panel.dataset.status = thread.status;
    const statusSuffix = thread.status === 'fixed'
      ? ' <span class="adrc-thread-status">· ✓ resolved</span>'
      : '';
    const header = `<div class="adrc-thread-panel-header">Thread ${thread.id}${statusSuffix}</div>`;
    const comments = (thread.comments || []).map(renderCommentHtml).join('');
    const resolveLabel = thread.status === 'fixed' ? 'Unresolve' : 'Resolve';
    const actions = [
      '<div class="adrc-thread-actions">',
      '  <button type="button" class="adrc-thread-action-btn adrc-thread-reply">Reply</button>',
      `  <button type="button" class="adrc-thread-action-btn adrc-thread-toggle-status">${resolveLabel}</button>`,
      '</div>'
    ].join('\n');

    panel.innerHTML = header + comments + actions;

    // Wire the action buttons.
    const replyBtn = panel.querySelector('.adrc-thread-reply');
    const statusBtn = panel.querySelector('.adrc-thread-toggle-status');

    replyBtn.addEventListener('click', () => openReplyBox(panel, thread));
    statusBtn.addEventListener('click', () => toggleThreadStatus(thread, statusBtn));

    // Wire per-comment Edit / Delete affordances on any of the current
    // user's own comments.
    panel.querySelectorAll('.adrc-edit-comment').forEach(btn => {
      btn.addEventListener('click', () => {
        const cid = parseInt(btn.dataset.commentId, 10);
        const comment = (thread.comments || []).find(c => c.id === cid);
        if (comment) startEditComment(panel, thread, comment);
      });
    });
    panel.querySelectorAll('.adrc-delete-comment').forEach(btn => {
      btn.addEventListener('click', () => {
        const cid = parseInt(btn.dataset.commentId, 10);
        const comment = (thread.comments || []).find(c => c.id === cid);
        if (comment) deleteCommentAction(thread, comment, btn);
      });
    });

    return panel;
  }

  /**
   * Replace a rendered comment body with an inline editor. On save,
   * calls adapter.editComment() and refreshes badges.
   */
  function startEditComment(panel, thread, comment) {
    const commentEl = panel.querySelector(`.adrc-thread-comment[data-comment-id="${comment.id}"]`);
    if (!commentEl) return;
    const bodyEl = commentEl.querySelector('.adrc-thread-comment-body');
    const inlineActions = commentEl.querySelector('.adrc-comment-inline-actions');
    if (!bodyEl) return;

    // Hide the existing body + inline actions while editing.
    bodyEl.style.display = 'none';
    if (inlineActions) inlineActions.style.display = 'none';

    const { editor, textarea } = createEditor({
      submitLabel: 'Save changes',
      initialValue: comment.content || '',
      placeholder: 'Edit your comment (Markdown supported). Ctrl+Enter to save.',
      minRows: 2,
      onSubmit: async (content) => {
        await adapter.resolveIds(ctx);
        await adapter.editComment(ctx, thread.id, comment.id, content);
        console.log(`${LOG} edited comment ${thread.id}/${comment.id}`);
        await refreshThreadBadges();
      },
      onCancel: (ed) => {
        ed.remove();
        bodyEl.style.display = '';
        if (inlineActions) inlineActions.style.display = '';
      }
    });
    editor.classList.add('adrc-inline-edit-editor');
    commentEl.appendChild(editor);
    textarea.focus();
  }

  /**
   * Delete the given comment. First click on the Delete button flips it
   * into a red "Confirm delete" state for 3 seconds; a second click
   * within that window actually deletes. Replaces the previous browser
   * `confirm()` dialog with an inline two-step affordance so the
   * mutation happens without a modal interruption.
   */
  async function deleteCommentAction(thread, comment, btn) {
    // Two-step confirm: first click primes the button, second click
    // (within the timer window) commits.
    if (btn.dataset.adrcConfirming !== '1') {
      const originalText = btn.textContent;
      btn.dataset.adrcConfirming = '1';
      btn.dataset.adrcOriginalText = originalText;
      btn.textContent = 'Confirm delete';
      btn.classList.add('adrc-comment-inline-btn-danger');
      const timer = setTimeout(() => {
        if (btn.dataset.adrcConfirming === '1') {
          btn.dataset.adrcConfirming = '';
          btn.textContent = originalText;
          btn.classList.remove('adrc-comment-inline-btn-danger');
        }
      }, 3000);
      btn.dataset.adrcConfirmTimer = String(timer);
      return;
    }

    // Second click — actually delete.
    const timer = parseInt(btn.dataset.adrcConfirmTimer, 10);
    if (Number.isFinite(timer)) clearTimeout(timer);
    btn.dataset.adrcConfirming = '';
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    btn.classList.remove('adrc-comment-inline-btn-danger');
    try {
      await adapter.resolveIds(ctx);
      await adapter.deleteComment(ctx, thread.id, comment.id);
      console.log(`${LOG} deleted comment ${thread.id}/${comment.id}`);
      await refreshThreadBadges();
    } catch (err) {
      console.error(`${LOG} deleteComment failed:`, err);
      btn.disabled = false;
      btn.textContent = btn.dataset.adrcOriginalText || 'Delete';
      showErrorToast('Delete failed: ' + String(err.message || err).slice(0, 160));
    }
  }

  /**
   * Open a reply textarea inside the given expanded thread panel.
   * Submits via `adapter.reply()` and refreshes badges on success so
   * the new reply shows up immediately.
   */
  function openReplyBox(panel, thread) {
    const existing = panel.querySelector('.adrc-reply-editor');
    if (existing) {
      existing.querySelector('.adrc-editor-textarea').focus();
      return;
    }

    const { editor, textarea } = createEditor({
      submitLabel: 'Reply',
      placeholder: 'Reply (Markdown supported). Ctrl+Enter to submit.',
      minRows: 2,
      onSubmit: async (content) => {
        await adapter.resolveIds(ctx);
        await adapter.reply(ctx, thread.id, content);
        console.log(`${LOG} reply posted on thread ${thread.id}`);
        await refreshThreadBadges();
      }
    });
    editor.classList.add('adrc-reply-editor');

    // Insert above the action bar so the reply stays grouped with the thread.
    const actions = panel.querySelector('.adrc-thread-actions');
    panel.insertBefore(editor, actions);
    textarea.focus();
  }

  /**
   * Flip a thread between active (1) and fixed (2). Re-renders badges
   * on success so the collapsed/expanded state and status text update.
   */
  async function toggleThreadStatus(thread, btn) {
    const wasFixed = thread.status === 'fixed';
    const newStatus = wasFixed ? 1 : 2;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = wasFixed ? 'Unresolving…' : 'Resolving…';
    try {
      await adapter.resolveIds(ctx);
      await adapter.setThreadStatus(ctx, thread.id, newStatus);
      console.log(`${LOG} thread ${thread.id} -> ${wasFixed ? 'active' : 'fixed'}`);
      await refreshThreadBadges();
    } catch (err) {
      console.error(`${LOG} setThreadStatus failed:`, err);
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  /**
   * Render one thread as an inline badge (plus auto-expanded panel for
   * unresolved). Callers can pass `insertAfter` to control DOM order
   * when stacking multiple badges under the same anchor block — without
   * it, every new badge lands at `parent.nextSibling` and pushes prior
   * badges down, giving reverse-of-arrival order.
   *
   * Returns the last DOM element it inserted (panel if unresolved,
   * badge otherwise) so the caller can chain the next insertion after it.
   */
  function renderThreadBadge(block, thread, insertAfter) {
    const parent = block.tagName === 'TR' ? (block.closest('table') || block) : block;
    if (!parent || !parent.parentNode) return null;
    const anchor = insertAfter || parent;

    // Prevent duplicates on re-render — remove any prior badge for this thread.
    const existing = document.querySelector(`.adrc-thread-badge[data-thread-id="${thread.id}"]`);
    if (existing) existing.remove();
    const existingPanel = document.querySelector(`.adrc-thread-panel[data-thread-id="${thread.id}"]`);
    if (existingPanel) existingPanel.remove();

    const visibleCount = (thread.comments || []).filter(c => !c.isDeleted).length;
    const tc = thread.threadContext || {};
    const startLine = tc.rightFileStart && typeof tc.rightFileStart.line === 'number'
      ? tc.rightFileStart.line
      : null;
    const endLine = tc.rightFileEnd && typeof tc.rightFileEnd.line === 'number'
      ? tc.rightFileEnd.line
      : startLine;
    let lineSuffix = '';
    if (typeof startLine === 'number') {
      lineSuffix = (endLine != null && endLine > startLine)
        ? ` · lines ${startLine}–${endLine}`
        : ` · line ${startLine}`;
    }
    const statusSuffix = thread.status === 'fixed'
      ? ' <span class="adrc-thread-status">· ✓ resolved</span>'
      : '';
    const willAutoExpand = thread.status !== 'fixed';
    const chevron = willAutoExpand ? '▼' : '▶';

    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'adrc-thread-badge';
    badge.dataset.threadId = thread.id;
    badge.dataset.status = thread.status;
    badge.innerHTML =
      `<span class="adrc-thread-badge-chevron">${chevron}</span>` +
      `${visibleCount} comment${visibleCount !== 1 ? 's' : ''}${lineSuffix}${statusSuffix}`;

    parent.parentNode.insertBefore(badge, anchor.nextSibling);

    // Unresolved threads auto-expand so reviewers immediately see what
    // needs attention. Resolved threads stay collapsed as a compact
    // badge; clicking expands them on demand.
    let panel = null;
    if (willAutoExpand) {
      panel = buildThreadPanel(thread);
      badge.parentNode.insertBefore(panel, badge.nextSibling);
    }

    badge.addEventListener('click', () => {
      const chevronEl = badge.querySelector('.adrc-thread-badge-chevron');
      if (panel && panel.parentNode) {
        panel.remove();
        panel = null;
        if (chevronEl) chevronEl.textContent = '▶';
        return;
      }
      panel = buildThreadPanel(thread);
      badge.parentNode.insertBefore(panel, badge.nextSibling);
      if (chevronEl) chevronEl.textContent = '▼';
    });

    return panel || badge;
  }

  /**
   * Mark every commentable block whose source line falls inside a
   * multi-line thread's range with `.adrc-range-permanent` so reviewers
   * can see the extent of the thread at a glance. Uses `currentLineToBlock`
   * (which already covers interior code-block lines) to find blocks,
   * then routes the class to the visible `.adrc-hoverable` host (first
   * cell for `<tr>`) via `GRDC.buttonAnchor`.
   */
  function paintPermanentRange(startLine, endLine) {
    const GRDC = window.GRDC || {};
    const targets = new Set();
    for (let ln = startLine; ln <= endLine; ln++) {
      const b = currentLineToBlock.get(ln);
      if (!b) continue;
      const host = (typeof GRDC.buttonAnchor === 'function' ? GRDC.buttonAnchor(b) : b) || b;
      targets.add(host);
    }
    targets.forEach(h => h.classList.add('adrc-range-permanent'));
  }

  /**
   * Fetch threads for the current PR + file and render inline badges.
   * Called during init and after posting a new comment.
   *
   * Preserves scroll position so mutating a thread (reply, resolve, edit,
   * delete) doesn't jump the page. Sorts threads by rightFileStart.line
   * so multiple badges under the same block land in source order rather
   * than the reverse-of-API-return order that plain insertBefore gives.
   */
  async function refreshThreadBadges() {
    if (!currentFilePathCached) return;

    // Capture scroll before we mutate the DOM so we can put the reader
    // back where they were reading after re-render.
    const savedScrollY = window.scrollY;

    // Clear any prior badges/panels — safe to re-render from scratch.
    document.querySelectorAll('.adrc-thread-badge, .adrc-thread-panel').forEach(el => el.remove());
    // Also clear any persistent multi-line range markers so we can
    // repaint them from the fresh thread list.
    document.querySelectorAll('.adrc-range-permanent').forEach(el => el.classList.remove('adrc-range-permanent'));

    let data;
    try {
      data = await adapter.listThreads(ctx);
    } catch (err) {
      console.error(`${LOG} refreshThreadBadges: listThreads failed:`, err);
      showErrorToast('Could not load threads: ' + String(err.message || err).slice(0, 160));
      return;
    }

    const threads = (data && data.value) || [];

    // Filter to threads that (a) aren't system-generated, (b) target the
    // current file, and (c) have a mapped anchor block. Then sort by
    // source line ascending (createdAt tiebreaker) via the shared
    // GRDC.sortThreadHeads so same-block stacks render top-to-bottom.
    const GRDC = window.GRDC || {};
    const anchored = [];
    threads.forEach(thread => {
      if (adapter.isSystemThread(thread)) return;
      const tc = thread.threadContext;
      if (!tc || tc.filePath !== currentFilePathCached) return;
      if (!tc.rightFileStart || typeof tc.rightFileStart.line !== 'number') return;
      const block = currentLineToBlock.get(tc.rightFileStart.line);
      if (!block) return;
      anchored.push({
        thread,
        block,
        line: tc.rightFileStart.line,
        createdAt: (thread.comments && thread.comments[0] && thread.comments[0].publishedDate) || null
      });
    });

    const sorted = typeof GRDC.sortThreadHeads === 'function'
      ? GRDC.sortThreadHeads(anchored)
      : anchored.slice().sort((a, b) => a.line - b.line);

    // Track last-inserted DOM node per anchor so multiple badges under
    // the same block chain in source-line order.
    const lastInsertedPerParent = new Map();
    let rendered = 0;
    sorted.forEach(({ thread, block }) => {
      const parent = block.tagName === 'TR' ? (block.closest('table') || block) : block;
      const anchor = lastInsertedPerParent.get(parent) || parent;
      const lastNode = renderThreadBadge(block, thread, anchor);
      if (lastNode) {
        lastInsertedPerParent.set(parent, lastNode);
        rendered++;
      }

      // Persistent range marker: for multi-line threads, tint every
      // block in the range so reviewers see the extent at a glance.
      const tc = thread.threadContext || {};
      const s = tc.rightFileStart && tc.rightFileStart.line;
      const e = tc.rightFileEnd && tc.rightFileEnd.line;
      if (typeof s === 'number' && typeof e === 'number' && e > s) {
        paintPermanentRange(s, e);
      }
    });
    console.log(`${LOG} rendered ${rendered} thread badge${rendered !== 1 ? 's' : ''} for ${currentFilePathCached}`);

    // Restore scroll on the next frame so any layout-affecting reflow
    // (image loads, etc.) has settled first.
    requestAnimationFrame(() => {
      if (Math.abs(window.scrollY - savedScrollY) > 1) {
        window.scrollTo({ top: savedScrollY, behavior: 'instant' });
      }
    });
  }

  // ── Section collapse (fold headings and their sections) ──────────────
  //
  // Every mapped heading (H1–H6) grows a small chevron toggle in the left
  // gutter that folds every block down to the next heading of equal or
  // shallower level. Uses the shared `GRDC.collectSiblingsToHide` /
  // `GRDC.collectSectionRoots` walker (see src/lib/sectionCollapse.js).

  // In-memory only — collapsed state is lost on page reload. A typical
  // review session is short and persisting to storage would be over-kill.
  const collapsedHeadings = new WeakSet();

  function isOurInjectedNode(el) {
    if (!el || el.nodeType !== 1) return false;
    const cl = el.classList;
    if (!cl) return false;
    return cl.contains('adrc-thread-badge') ||
           cl.contains('adrc-thread-panel') ||
           cl.contains('adrc-editor') ||
           cl.contains('adrc-comment-btn') ||
           cl.contains('adrc-collapse-toggle');
  }

  function siblingsToHide(heading) {
    const GRDC = window.GRDC || {};
    if (typeof GRDC.collectSiblingsToHide !== 'function') return [];
    return GRDC.collectSiblingsToHide(heading, {
      isInjected: isOurInjectedNode,
      richDiffSelector: '.markdown-preview-container'
    });
  }

  function sectionRoots(heading) {
    const GRDC = window.GRDC || {};
    if (typeof GRDC.collectSectionRoots !== 'function') return [];
    return GRDC.collectSectionRoots(heading, {
      isInjected: isOurInjectedNode,
      richDiffSelector: '.markdown-preview-container'
    });
  }

  function ensureCollapseToggle(element) {
    if (!element || !/^H[1-6]$/.test(element.tagName)) return null;
    const existing = element.querySelector(':scope > .adrc-collapse-toggle');
    if (existing) return existing;

    const toggle = document.createElement('button');
    toggle.className = 'adrc-collapse-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Collapse section');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.title = 'Collapse section (click to hide everything until the next heading of the same or higher level)';
    toggle.textContent = '\u25be'; // down chevron when expanded
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSection(element, toggle);
    });

    element.classList.add('adrc-collapsible');
    element.prepend(toggle);

    // Restore collapsed state on re-init.
    if (collapsedHeadings.has(element)) {
      applyCollapseVisuals(element, toggle, true);
    }
    return toggle;
  }

  function applyCollapseVisuals(heading, toggle, collapsed) {
    const siblings = siblingsToHide(heading);
    siblings.forEach((el) => {
      if (collapsed) el.classList.add('adrc-collapsed-hidden');
      else el.classList.remove('adrc-collapsed-hidden');
    });

    if (collapsed) foldInjectedInSection(heading);
    else restoreInjectedInSection(heading);

    heading.classList.toggle('adrc-section-collapsed', collapsed);
    toggle.textContent = collapsed ? '\u25b8' : '\u25be';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expand section' : 'Collapse section');
  }

  /**
   * When a section collapses, hide any auto-expanded thread panels
   * inside it (badges remain visible so users know comments exist) and
   * remove any open compose / reply / edit editors (their transient
   * textarea contents can't reliably be preserved).
   */
  function foldInjectedInSection(heading) {
    sectionRoots(heading).forEach((root) => {
      const panels = root.classList && root.classList.contains('adrc-thread-panel')
        ? [root]
        : Array.from((root.querySelectorAll && root.querySelectorAll('.adrc-thread-panel')) || []);
      panels.forEach((p) => {
        if (p.style.display !== 'none') {
          p.dataset.adrcWasVisible = '1';
          p.style.display = 'none';
        }
      });
      const editors = root.classList && root.classList.contains('adrc-editor')
        ? [root]
        : Array.from((root.querySelectorAll && root.querySelectorAll('.adrc-editor')) || []);
      editors.forEach((edEl) => edEl.remove());
    });
  }

  /**
   * Un-hide any thread panels this section had hidden when it collapsed.
   * Panels that were already collapsed at collapse-time stay collapsed.
   */
  function restoreInjectedInSection(heading) {
    sectionRoots(heading).forEach((root) => {
      const panels = root.classList && root.classList.contains('adrc-thread-panel')
        ? [root]
        : Array.from((root.querySelectorAll && root.querySelectorAll('.adrc-thread-panel')) || []);
      panels.forEach((p) => {
        if (p.dataset.adrcWasVisible === '1') {
          p.style.display = '';
          delete p.dataset.adrcWasVisible;
        }
      });
    });
  }

  function toggleSection(heading, toggle) {
    const willCollapse = !collapsedHeadings.has(heading);
    if (willCollapse) collapsedHeadings.add(heading);
    else collapsedHeadings.delete(heading);
    applyCollapseVisuals(heading, toggle, willCollapse);
  }

  // ── Error toast ──────────────────────────────────────────────────────
  //
  // Small bottom-right slide-in banner for asynchronous errors (network
  // failures, API errors) that would otherwise only reach the console.

  function showErrorToast(message) {
    const toast = document.createElement('div');
    toast.className = 'adrc-toast adrc-toast-error';
    toast.textContent = String(message || 'Something went wrong.').slice(0, 240);
    document.body.appendChild(toast);
    // Auto-dismiss with a short fade out.
    setTimeout(() => {
      toast.classList.add('adrc-toast-out');
      setTimeout(() => toast.remove(), 250);
    }, 5000);
  }

  // ── Init flow ────────────────────────────────────────────────────────

  async function initButtonsForCurrentPreview() {
    const container = document.querySelector('.markdown-preview-container');
    if (!container) return;
    if (container.dataset.adrcInitialized) return;
    // Wait until ADO has actually filled the container. On a fresh load
    // the div appears empty before the markdown renders.
    if ((container.textContent || '').trim().length === 0) return;

    const filePath = currentFilePath();
    if (!filePath) {
      console.log(`${LOG} preview visible but no ?path= in URL — skipping button attachment`);
      return;
    }

    container.dataset.adrcInitialized = '1';
    try {
      const map = await buildFileLineMap(container, filePath);
      let attached = 0;
      currentLineToBlock = new Map();
      currentFilePathCached = filePath;
      map.forEach((info, block) => {
        attachCommentButton(block, info);
        attached++;
        // Reverse lookup: line → first block for that line. Thread anchoring
        // uses this to find the block a thread should badge onto.
        if (!currentLineToBlock.has(info.line)) {
          currentLineToBlock.set(info.line, block);
        }
        // For code blocks, also map every interior line inside the fence
        // to the same <pre>. Without this, threads anchored to a line in
        // the middle of a code block (via the sliding + button) won't
        // find their block and no badge renders.
        if (block.tagName === 'PRE') {
          const rs = parseInt(block.dataset.adrcRangeStart, 10);
          const re = parseInt(block.dataset.adrcRangeEnd, 10);
          if (Number.isFinite(rs) && Number.isFinite(re)) {
            for (let ln = rs; ln <= re; ln++) {
              if (!currentLineToBlock.has(ln)) currentLineToBlock.set(ln, block);
            }
          }
        }
        // Headings (H1–H6) also get a section-collapse chevron in the
        // gutter so reviewers can fold long sections while reading.
        if (/^H[1-6]$/.test(block.tagName)) {
          ensureCollapseToggle(block);
        }
      });
      console.log(`${LOG} Initialized: ${attached} commentable blocks in ${filePath}`);
      // Fire-and-forget — thread badge rendering shouldn't block the +
      // buttons showing up, and any error is already logged.
      refreshThreadBadges();
    } catch (err) {
      console.error(`${LOG} init failed for ${filePath}:`, err);
      // Clear the guard so a subsequent mutation retries.
      delete container.dataset.adrcInitialized;
    }
  }

  // Simple SPA-nav handling: watch for the preview container appearing
  // (or being replaced when the user switches files). The idempotency
  // guard on `container.dataset.adrcInitialized` keeps this cheap even
  // though the observer fires often.
  let debounceTimer = null;
  const mo = new MutationObserver(() => {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      initButtonsForCurrentPreview();
    }, 250);
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Also try once shortly after load in case the preview is already there.
  setTimeout(initButtonsForCurrentPreview, 500);

  // ── DevTools probe (unchanged from v0.0.x) ───────────────────────────

  window.ADORC_probe = {
    ctx,
    adapter,

    async ready() {
      await adapter.resolveIds(ctx);
      console.log(`${LOG} resolved:`, { org: ctx.org, projectId: ctx.projectId, repoId: ctx.repoId, prId: ctx.prId });
      return ctx;
    },

    async list() {
      await adapter.resolveIds(ctx);
      const data = await adapter.listThreads(ctx);
      const user = (data.value || []).filter(t => !adapter.isSystemThread(t));
      console.log(`${LOG} threads: ${data.count} total, ${user.length} user (${data.count - user.length} system filtered)`);
      return { all: data, user };
    },

    async create(content, line, filePath) {
      await adapter.resolveIds(ctx);
      return adapter.createThread(ctx, { content, line, filePath });
    },

    async reply(threadId, content) {
      await adapter.resolveIds(ctx);
      return adapter.reply(ctx, threadId, content);
    },

    async resolve(threadId) {
      await adapter.resolveIds(ctx);
      return adapter.resolveThread(ctx, threadId);
    },

    async unresolve(threadId) {
      await adapter.resolveIds(ctx);
      return adapter.unresolveThread(ctx, threadId);
    },

    async edit(threadId, commentId, content) {
      await adapter.resolveIds(ctx);
      return adapter.editComment(ctx, threadId, commentId, content);
    },

    async delete(threadId, commentId) {
      await adapter.resolveIds(ctx);
      return adapter.deleteComment(ctx, threadId, commentId);
    },

    async pr() {
      await adapter.resolveIds(ctx);
      const pr = await adapter.getPullRequest(ctx);
      console.log(`${LOG} PR sourceRefName=${pr.sourceRefName} targetRefName=${pr.targetRefName} lastMergeSourceCommit=${pr.lastMergeSourceCommit && pr.lastMergeSourceCommit.commitId}`);
      return pr;
    },

    async me() {
      const data = await adapter.getConnectionData(ctx);
      const u = data.authenticatedUser || {};
      console.log(`${LOG} authenticated user: id=${u.id} descriptor=${u.descriptor} uniqueName=${u.uniqueName} displayName=${u.displayName}`);
      console.log(`${LOG} cached identity (used for own-comment matching):`, currentUserIdentity);
      return data;
    },

    // Compare the cached identity against the first comment on each
    // thread — useful for debugging when Edit / Delete don't appear.
    async matchTest() {
      await adapter.resolveIds(ctx);
      const data = await adapter.listThreads(ctx);
      const user = (data.value || []).filter(t => !adapter.isSystemThread(t));
      const rows = user.map(t => {
        const c = (t.comments || [])[0];
        if (!c || !c.author) return { threadId: t.id, comment: 'no first comment' };
        return {
          threadId: t.id,
          commentId: c.id,
          author_id: c.author.id,
          author_descriptor: c.author.descriptor,
          author_uniqueName: c.author.uniqueName,
          isOwn: isOwnComment(c)
        };
      });
      console.table(rows);
      console.log(`${LOG} currentUserIdentity =`, currentUserIdentity);
      return { currentUserIdentity, rows };
    },

    async source(filePath) {
      await adapter.resolveIds(ctx);
      const branch = await getSourceBranch();
      const text = await adapter.getFileSource(ctx, filePath, { version: branch, versionType: 'branch' });
      console.log(`${LOG} source(${filePath}) at branch=${branch}: ${text.length} chars, ${text.split('\n').length} lines`);
      return text;
    },

    async detectLines(filePath) {
      const container = document.querySelector('.markdown-preview-container');
      if (!container) {
        throw new Error('probe.detectLines: no .markdown-preview-container in the DOM — switch the file to "Preview" mode');
      }
      const map = await buildFileLineMap(container, filePath);
      const summary = [];
      map.forEach((info, el) => {
        summary.push({ tag: el.tagName, line: info.line, snippet: (el.textContent || '').trim().slice(0, 60) });
      });
      console.log(`${LOG} detectLines(${filePath}): ${summary.length} blocks mapped`);
      console.table(summary);
      return summary;
    },

    // Diagnose a code block: source-range vs DOM-row geometry.
    // Call `ADORC_probe.codeBlock(N)` where N is a 0-based index of the
    // <pre> in the current preview (or omit to use the first).
    codeBlock(index) {
      const idx = typeof index === 'number' ? index : 0;
      const pres = Array.from(document.querySelectorAll('.markdown-preview-container pre'));
      const pre = pres[idx];
      if (!pre) {
        console.warn(`${LOG} codeBlock probe: no <pre> at index ${idx} (found ${pres.length})`);
        return null;
      }
      const cs = getComputedStyle(pre);
      const cssLH = parseFloat(cs.lineHeight);
      const fontSize = parseFloat(cs.fontSize) || 14;
      const preTopPad = parseFloat(cs.paddingTop) || 0;
      const preBotPad = parseFloat(cs.paddingBottom) || 0;
      const rect = pre.getBoundingClientRect();
      const contentHeight = rect.height - preTopPad - preBotPad;
      // What did wireCodeBlockLineTracking actually use?
      const cachedLH = parseFloat(pre.dataset.adrcLineHeight);
      const firstChildLine = pre.querySelector('span, div, code > *');
      const firstChildRectH = firstChildLine ? firstChildLine.getBoundingClientRect().height : null;
      const lh = Number.isFinite(cachedLH) && cachedLH > 0
        ? cachedLH
        : (Number.isFinite(cssLH) && cssLH > 0 ? cssLH : fontSize * 1.5);
      const domRowCount = Math.max(1, Math.round(contentHeight / lh));
      const rangeStart = parseInt(pre.dataset.adrcRangeStart, 10);
      const rangeEnd = parseInt(pre.dataset.adrcRangeEnd, 10);
      const sourceRowCount = rangeEnd - rangeStart + 1;
      const scale = sourceRowCount / domRowCount;
      const innerTextLines = (pre.innerText || '').replace(/\n+$/, '').split('\n').length;
      const info = {
        index: idx,
        sourceRange: `${rangeStart}-${rangeEnd} (${sourceRowCount} lines)`,
        cachedLineHeight: cachedLH,
        cssLineHeight: cssLH,
        fontSize,
        firstChildTag: firstChildLine ? firstChildLine.tagName : null,
        firstChildRectHeight: firstChildRectH,
        preHeightPx: rect.height.toFixed(1),
        contentHeightPx: contentHeight.toFixed(1),
        domRows: domRowCount,
        innerTextLines,
        scale: scale.toFixed(3),
        firstLineSnippet: (pre.textContent || '').trim().slice(0, 80),
      };
      console.table(info);
      return info;
    },

    /**
     * Re-run the button-attachment + thread-badge pass. Handy while
     * iterating without having to reload the page. Clears the
     * initialization guard and all injected elements first.
     */
    async reinit() {
      const container = document.querySelector('.markdown-preview-container');
      if (container) delete container.dataset.adrcInitialized;
      document.querySelectorAll('.adrc-comment-btn, .adrc-editor, .adrc-thread-badge, .adrc-thread-panel').forEach(el => el.remove());
      document.querySelectorAll('[data-adrc-has-button]').forEach(el => {
        delete el.dataset.adrcHasButton;
        el.classList.remove('adrc-hoverable');
      });
      await initButtonsForCurrentPreview();
    }
  };

  console.log(`${LOG} DevTools probe available: ADORC_probe (try 'await ADORC_probe.list()' or 'await ADORC_probe.reinit()')`);
})();
