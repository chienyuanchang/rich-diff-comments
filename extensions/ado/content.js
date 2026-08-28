/**
 * Markdown PR Comments for Azure DevOps
 *
 * Maps rendered Preview blocks back to Markdown source lines, adds inline
 * comment / thread UI, supports range comments and section folding, and
 * renders a persistent Changes + Threads + Outline sidebar. ADO's PR file viewer is an SPA that
 * may reuse the same Preview element across file changes, so initialization
 * is keyed by both the route and active Preview DOM.
 *
 * `window.ADORC_probe` exposes diagnostics from the DevTools console.
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

  // Resolve namespaced CSS theme aliases at the same inherited scope where
  // ADO exposes its live semantic tokens. Attribute observation is disabled,
  // so this class does not trigger Preview reinitialization.
  document.body.classList.add('adrc-theme-host');

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
   * Route identity for the currently selected PR file. ADO uses SPA
   * navigation and can reuse the same `.markdown-preview-container` while
   * changing only `location.search`, so DOM identity alone is insufficient.
   */
  function currentPreviewRouteKey() {
    const params = new URLSearchParams(window.location.search);
    return `${window.location.pathname}|${params.get('path') || ''}|${params.get('_a') || ''}`;
  }

  function isVisiblePreviewContainer(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * ADO may retain an old preview in the DOM while displaying a newer one.
   * Prefer the last visible, non-empty candidate; fall back to the last
   * non-empty candidate while a route transition is still laying out.
   */
  function getCurrentPreviewContainer() {
    const candidates = Array.from(document.querySelectorAll('.markdown-preview-container'));
    const nonEmpty = candidates.filter((el) => (el.textContent || '').trim().length > 0);
    const visible = nonEmpty.filter(isVisiblePreviewContainer);
    return visible[visible.length - 1] || nonEmpty[nonEmpty.length - 1] || null;
  }

  let currentPreviewContainerCached = null;
  let currentPreviewRouteKeyCached = '';
  let initGeneration = 0;
  let initInFlight = null; // { container, routeKey }

  /**
   * The PR source branch (stripped of the refs/heads/ prefix). Cached on
   * the ctx object because it's stable across file switches.
   */
  let _pullRequestPromise = null;
  let _sourceBranchPromise = null;
  const changeHeadSourcePromises = new Map();
  const changeBaseSourcePromises = new Map();
  let prChangesHeadVersion = null;
  let prChangesBaseVersion = null;
  function getPullRequestMetadata() {
    if (!_pullRequestPromise) {
      _pullRequestPromise = adapter.resolveIds(ctx).then(() => adapter.getPullRequest(ctx));
    }
    return _pullRequestPromise;
  }

  function getSourceBranch() {
    if (!_sourceBranchPromise) {
      _sourceBranchPromise = getPullRequestMetadata().then(pr => {
        const branch = (pr.sourceRefName || '').replace(/^refs\/heads\//, '');
        if (!branch) throw new Error('Could not derive source branch from PR');
        return branch;
      });
    }
    return _sourceBranchPromise;
  }

  let _targetVersionPromise = null;
  function getTargetVersion() {
    if (!_targetVersionPromise) {
      _targetVersionPromise = getPullRequestMetadata().then((pr) => {
        const commit = pr.lastMergeTargetCommit && pr.lastMergeTargetCommit.commitId;
        if (commit) return { version: commit, versionType: 'commit' };
        const branch = (pr.targetRefName || '').replace(/^refs\/heads\//, '');
        if (!branch) throw new Error('Could not derive target version from PR');
        return { version: branch, versionType: 'branch' };
      });
    }
    return _targetVersionPromise;
  }

  function versionedSource(cache, filePath, versionPromise) {
    const normalizedPath = adapter.normalizeFilePath(filePath);
    return Promise.resolve(versionPromise).then(async (version) => {
      const descriptor = version || {};
      const key = `${descriptor.versionType || 'default'}:${descriptor.version || ''}:${normalizedPath}`;
      if (!cache.has(key)) {
        await adapter.resolveIds(ctx);
        const request = adapter.getFileSource(ctx, normalizedPath, descriptor);
        cache.set(key, request);
        request.catch(() => {
          if (cache.get(key) === request) cache.delete(key);
        });
      }
      return cache.get(key);
    });
  }

  function getBaseFileSource(filePath) {
    const version = prChangesBaseVersion || getTargetVersion();
    return versionedSource(changeBaseSourcePromises, filePath, version);
  }

  function getHeadFileSource(filePath) {
    const version = prChangesHeadVersion || getSourceBranch().then((branch) => ({
      version: branch,
      versionType: 'branch'
    }));
    return versionedSource(changeHeadSourcePromises, filePath, version);
  }

  // Rejected fetches are not cached forever. A transient ADO request failure
  // can therefore recover on the next explicit catalog refresh/page reload.
  function retryableHeadFileSource(filePath) {
    return getHeadFileSource(filePath);
  }

  function retryableBaseFileSource(filePath) {
    return getBaseFileSource(filePath);
  }

  /**
  * Fetch + line-map the current file. Returns
  * `{map: Map<Element, {path, line}>, source}`. The caller publishes the
  * source only after confirming this async result still belongs to the active
  * SPA route, preventing a slow prior-file fetch from overwriting state.
   */
  async function buildFileLineMap(container, filePath) {
    const source = await retryableHeadFileSource(filePath);
    const sourceLines = source.split('\n');

    const GRDC = window.GRDC || {};
    const { mapBlocksToSourceLines, buildSourceIndex, findTextInSource, findFrontmatterRange, computeTableRowLine } = GRDC;
    if (typeof mapBlocksToSourceLines !== 'function') {
      throw new Error('window.GRDC.mapBlocksToSourceLines missing — check manifest content_scripts.js order');
    }

    const map = mapBlocksToSourceLines(
      container,
      sourceLines,
      filePath,
      { buildSourceIndex, findTextInSource, findFrontmatterRange, computeTableRowLine },
      console.log.bind(console)
    );
    return { map, source };
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
    const preview = getCurrentPreviewContainer();
    const all = preview ? Array.from(preview.querySelectorAll('.adrc-hoverable')) : [];
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
  let currentBlockInfo = new Map();
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
    const scrollContainer = getOutlineScrollContainer();
    const savedScrollY = scrollContainer === window ? window.scrollY : scrollContainer.scrollTop;

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
    const userThreads = threads.filter((thread) => !adapter.isSystemThread(thread));
    setSidebarThreads(userThreads);

    // Filter to threads that (a) aren't system-generated, (b) target the
    // current file, and (c) have a mapped anchor block. Then sort by
    // source line ascending (createdAt tiebreaker) via the shared
    // GRDC.sortThreadHeads so same-block stacks render top-to-bottom.
    const GRDC = window.GRDC || {};
    const anchored = [];
    userThreads.forEach(thread => {
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
    updateActiveSidebarThread();

    // Restore scroll on the next frame so any layout-affecting reflow
    // (image loads, etc.) has settled first.
    requestAnimationFrame(() => {
      if (scrollContainer === window && Math.abs(window.scrollY - savedScrollY) > 1) {
        window.scrollTo({ top: savedScrollY, behavior: 'instant' });
      } else if (scrollContainer !== window && Math.abs(scrollContainer.scrollTop - savedScrollY) > 1) {
        scrollContainer.scrollTo({ top: savedScrollY, behavior: 'instant' });
      }
      // Run after scroll restoration so a cross-file card jump wins over
      // the refresh's "stay where the reader was" behavior.
      resumePendingThreadJump(0);
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
  let collapsedHeadings = new WeakSet();

  function isOurInjectedNode(el) {
    if (!el || el.nodeType !== 1) return false;
    const cl = el.classList;
    if (!cl) return false;
    return cl.contains('adrc-thread-badge') ||
           cl.contains('adrc-thread-panel') ||
           cl.contains('adrc-editor') ||
           cl.contains('adrc-comment-btn') ||
          cl.contains('adrc-collapse-toggle') ||
          cl.contains('adrc-sidebar') ||
          cl.contains('adrc-sidebar-launcher') ||
          cl.contains('adrc-toast');
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

    // Restore collapsed state on re-init from the stable source heading key.
    const outlineKey = element.dataset.adrcOutlineKey;
    if (collapsedHeadings.has(element) || (outlineKey && outlineCollapsedKeys.has(outlineKey))) {
      collapsedHeadings.add(element);
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
    const willCollapse = !heading.classList.contains('adrc-section-collapsed');
    const outlineKey = heading.dataset.adrcOutlineKey;
    if (willCollapse) {
      collapsedHeadings.add(heading);
      if (outlineKey) outlineCollapsedKeys.add(outlineKey);
    } else {
      collapsedHeadings.delete(heading);
      if (outlineKey) outlineCollapsedKeys.delete(outlineKey);
    }
    applyCollapseVisuals(heading, toggle, willCollapse);
    renderOutlineRows();
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

  // ── Changes + Threads + Outline sidebar ─────────────────────────────
  //
  // Persistent floating navigation shell. Changes and Threads are PR-wide;
  // Outline is scoped to the active file until Iteration N. All state is
  // local-only and namespaced for the ADO target.

  const SIDEBAR_STORAGE_KEY = 'adrc-sidebar-state-v1';
  const LEGACY_OUTLINE_STORAGE_KEY = 'adrc-outline-state-v1';
  const SIDEBAR_PENDING_THREAD_KEY = 'adrc-pending-thread-jump-v1';
  const SIDEBAR_PENDING_CHANGE_KEY = 'adrc-pending-change-jump-v1';
  const SIDEBAR_PENDING_OUTLINE_KEY = 'adrc-pending-outline-jump-v1';
  const SIDEBAR_MIN_WIDTH = 480;
  const SIDEBAR_MIN_HEIGHT = 180;
  const SIDEBAR_DEFAULT_WIDTH = 480;
  const SIDEBAR_DEFAULT_HEIGHT = 480;
  const OUTLINE_STICKY_OFFSET = 100;         // px above heading during scroll-to
  const OUTLINE_ACTIVE_OFFSET = 140;         // px below viewport top where the "reading line" sits

  let sidebarPanel = null;
  let sidebarLauncher = null;
  let sidebarState = null;
  let sidebarThreadItems = [];
  let sidebarActiveThreadId = null;
  // Stable, DOM-free PR-wide cards. Live target elements are resolved from
  // `currentLineToBlock` only when a card belongs to the active Preview.
  let sidebarChangeStops = [];
  let sidebarActiveChangeIndex = -1;
  let sidebarFollowSuppressedUntil = 0;
  let sidebarChangesStatus = 'idle'; // idle | loading | ready | error
  let sidebarChangesError = '';
  let changesGeneration = 0;
  let prChangesPromise = null;
  let prChangesIterationId = null;
  let prMarkdownChanges = [];
  let prMarkdownFileOrder = [];
  let sidebarResizeObserver = null;
  let sidebarResizeTimer = null;
  // Alias retained for the established Outline row renderer. It points to
  // the sidebar shell, whose Outline pane owns `.adrc-outline-body`.
  let outlinePanel = null;
  // `outlineHeadings` is active-file-only and may hold live DOM references.
  // `prOutlineCatalog` is PR-wide and strictly DOM-free.
  let outlineHeadings = [];
  let outlineActiveId = null;
  let prOutlineCatalog = new Map();
  let prOutlinePromise = null;
  let prOutlineStatus = 'idle'; // idle | loading | ready | error
  let prOutlineError = '';
  const outlineCollapsedKeys = new Set();
  let outlineScrollRaf = null;
  let outlineScrollListenerTarget = null;
  // The element that actually scrolls the file content. ADO's PR page
  // usually scrolls an inner container instead of the document/window, so
  // window.scrollTo and window.addEventListener('scroll') don't work on
  // its own. We cache the detected container so click-to-scroll and
  // scroll-tracking both target the right thing.
  let outlineScrollContainer = null;

  /**
   * Walk from a starting element up through its ancestors and return the
   * nearest scrollable one (or `window` if none of the ancestors scroll).
   * "Scrollable" = computed overflow-y is auto/scroll/overlay AND the
   * element actually has vertical overflow (scrollHeight > clientHeight).
   */
  function findScrollContainer(startEl) {
    let node = startEl && startEl.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      const oy = cs.overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
          node.scrollHeight > node.clientHeight + 1) {
        return node;
      }
      node = node.parentElement;
    }
    // Fall back to whichever of document.documentElement / body is
    // actually scrolling, else window.
    const de = document.documentElement;
    if (de && de.scrollHeight > de.clientHeight + 1) return de;
    if (document.body && document.body.scrollHeight > document.body.clientHeight + 1) return document.body;
    return window;
  }

  function getOutlineScrollContainer() {
    // Re-detect if we don't have one yet, if the cached one is gone from
    // the DOM (SPA nav replaced it), or if it stopped being scrollable.
    if (outlineScrollContainer &&
        outlineScrollContainer !== window &&
        !document.contains(outlineScrollContainer)) {
      outlineScrollContainer = null;
    }
    if (!outlineScrollContainer) {
      const container = getCurrentPreviewContainer();
      if (container) outlineScrollContainer = findScrollContainer(container);
    }
    return outlineScrollContainer || window;
  }

  function outlineIsVisible() {
    return !!sidebarPanel &&
      !!sidebarPanel.querySelector('.adrc-outline-body') &&
      !sidebarPanel.classList.contains('adrc-sidebar-hidden') &&
      !sidebarPanel.classList.contains('adrc-sidebar-collapsed') &&
      sidebarState && sidebarState.tab === 'outline';
  }

  function defaultSidebarState() {
    return {
      visible: true,
      collapsed: false,
      tab: 'changes',
      unresolvedOnly: false,
      left: null,
      top: 80,
      width: SIDEBAR_DEFAULT_WIDTH,
      height: SIDEBAR_DEFAULT_HEIGHT
    };
  }

  function readSidebarState() {
    const defaults = defaultSidebarState();
    try {
      const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const next = Object.assign(defaults, parsed || {});
      if (next.tab !== 'changes' && next.tab !== 'threads' && next.tab !== 'outline') {
        next.tab = 'changes';
      }
      const GRDC = window.GRDC || {};
      if (typeof GRDC.clampSize === 'function') {
        const size = GRDC.clampSize(
          Number(next.width), Number(next.height), SIDEBAR_MIN_WIDTH, SIDEBAR_MIN_HEIGHT
        );
        next.width = size.width || SIDEBAR_DEFAULT_WIDTH;
        next.height = size.height || SIDEBAR_DEFAULT_HEIGHT;
      }
      if (!raw) {
        // Preserve the user's standalone Outline preference during the
        // one-time migration to the combined sidebar.
        const legacy = JSON.parse(localStorage.getItem(LEGACY_OUTLINE_STORAGE_KEY) || '{}');
        if (legacy.visible === true) next.tab = 'outline';
      }
      return next;
    } catch (_) {
      return defaults;
    }
  }

  function saveSidebarState(patch) {
    sidebarState = Object.assign(sidebarState || readSidebarState(), patch || {});
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(sidebarState));
    } catch (_) { /* localStorage may be blocked in some contexts */ }
  }

  function collectHeadingsForOutline() {
    const container = getCurrentPreviewContainer();
    if (!container) return [];
    const file = currentFilePathCached || currentFilePath() || '';
    const GRDC = window.GRDC || {};
    const sourceHeadings = typeof GRDC.extractMarkdownHeadings === 'function'
      ? GRDC.extractMarkdownHeadings(currentSource || '', file)
      : [];
    let sourceCursor = 0;
    return Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((el, i) => {
      // Strip any injected chevron text from the section-collapse toggle
      // so the outline label reads cleanly.
      let text = '';
      el.childNodes.forEach((child) => {
        if (child.nodeType === 1 && child.classList && child.classList.contains('adrc-collapse-toggle')) return;
        text += child.textContent || '';
      });
      text = text.trim() || '(untitled)';
      const level = parseInt(el.tagName.slice(1), 10);
      const info = currentBlockInfo.get(el);
      const normalizedText = text.replace(/\s+/g, ' ').trim().toLowerCase();
      let sourceHeading = null;
      for (let index = sourceCursor; index < sourceHeadings.length; index++) {
        const candidate = sourceHeadings[index];
        if (candidate.level !== level) continue;
        if (String(candidate.text || '').replace(/\s+/g, ' ').trim().toLowerCase() !== normalizedText) continue;
        sourceHeading = candidate;
        sourceCursor = index + 1;
        break;
      }
      if (!sourceHeading && sourceHeadings[i] && sourceHeadings[i].level === level) {
        sourceHeading = sourceHeadings[i];
        sourceCursor = Math.max(sourceCursor, i + 1);
      }
      const line = sourceHeading?.line || (info && Number.isFinite(info.line) ? info.line : i + 1);
      const key = typeof GRDC.outlineHeadingKey === 'function'
        ? GRDC.outlineHeadingKey(file, line, level)
        : `${file}::${line}::${level}`;
      el.dataset.adrcOutlineKey = key;
      return {
        el,
        id: key,
        key,
        level,
        text,
        line,
        file
      };
    });
  }

  let lastScrollNavigation = null;

  function describeElement(el) {
    if (!el) return null;
    if (el === window) return 'window';
    const tag = (el.tagName || '').toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const classes = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().replace(/\s+/g, '.')
      : '';
    return `${tag}${id}${classes}`;
  }

  function readScrollerTop(scroller) {
    return scroller === window ? window.scrollY : scroller.scrollTop;
  }

  /**
   * Scroll a target into view across ADO's nested scroll containers.
   *
   * ADO can place Preview under more than one overflow ancestor. Computing a
   * `scrollTop` for only the nearest inferred container works in some files
   * but does nothing in others. Native `scrollIntoView` walks every required
   * ancestor. A temporary `scroll-margin-top` preserves the sticky-header
   * offset. If smooth scrolling has not moved either the target or inferred
   * scroller after two animation frames, retry immediately with `auto`.
   */
  function scrollToWithStickyOffset(el) {
    if (!el || !el.isConnected) return false;
    const scroller = getOutlineScrollContainer();
    const beforeRect = el.getBoundingClientRect();
    const beforeScrollTop = readScrollerTop(scroller);
    const priorMargin = el.style.scrollMarginTop;
    el.style.scrollMarginTop = OUTLINE_STICKY_OFFSET + 'px';

    lastScrollNavigation = {
      target: describeElement(el),
      scroller: describeElement(scroller),
      before: { top: beforeRect.top, width: beforeRect.width, height: beforeRect.height, scrollTop: beforeScrollTop },
      fallbackUsed: false,
      after: null
    };

    const invoke = (behavior) => {
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior, block: 'start', inline: 'nearest' });
      } else if (scroller === window) {
        window.scrollTo({
          top: Math.max(0, window.scrollY + el.getBoundingClientRect().top - OUTLINE_STICKY_OFFSET),
          behavior
        });
      } else {
        const cRect = scroller.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        scroller.scrollTo({
          top: Math.max(0, scroller.scrollTop + eRect.top - cRect.top - OUTLINE_STICKY_OFFSET),
          behavior
        });
      }
    };

    invoke('smooth');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!el.isConnected) return;
      const interimRect = el.getBoundingClientRect();
      const interimScrollTop = readScrollerTop(scroller);
      const moved =
        Math.abs(interimRect.top - beforeRect.top) > 1 ||
        Math.abs(interimScrollTop - beforeScrollTop) > 1;
      if (!moved && Math.abs(interimRect.top - OUTLINE_STICKY_OFFSET) > 8) {
        lastScrollNavigation.fallbackUsed = true;
        invoke('auto');
      }
    }));

    setTimeout(() => {
      if (el.isConnected && lastScrollNavigation) {
        const rect = el.getBoundingClientRect();
        lastScrollNavigation.after = {
          top: rect.top,
          width: rect.width,
          height: rect.height,
          scrollTop: readScrollerTop(scroller)
        };
      }
      if (el.style.scrollMarginTop === OUTLINE_STICKY_OFFSET + 'px') {
        el.style.scrollMarginTop = priorMargin;
      }
    }, 1000);
    return true;
  }

  function clampSidebarPosition(left, top, width) {
    const GRDC = window.GRDC || {};
    const rect = { left, top, width: width || SIDEBAR_DEFAULT_WIDTH };
    if (typeof GRDC.clampDragPos === 'function') {
      return GRDC.clampDragPos(
        rect,
        { dx: 0, dy: 0 },
        { width: window.innerWidth, height: window.innerHeight },
        80
      );
    }
    return {
      left: Math.max(16, Math.min(left, window.innerWidth - 80)),
      top: Math.max(0, Math.min(top, window.innerHeight - 40))
    };
  }

  function applySidebarGeometry() {
    if (!sidebarPanel || !sidebarState) return;
    const width = Number(sidebarState.width) || SIDEBAR_DEFAULT_WIDTH;
    const height = Number(sidebarState.height) || SIDEBAR_DEFAULT_HEIGHT;
    const desiredLeft = sidebarState.left != null && Number.isFinite(Number(sidebarState.left))
      ? Number(sidebarState.left)
      : window.innerWidth - width - 16;
    const desiredTop = sidebarState.top != null && Number.isFinite(Number(sidebarState.top))
      ? Number(sidebarState.top)
      : 80;
    const pos = clampSidebarPosition(desiredLeft, desiredTop, width);
    sidebarPanel.style.right = 'auto';
    sidebarPanel.style.left = pos.left + 'px';
    sidebarPanel.style.top = pos.top + 'px';
    sidebarPanel.style.width = width + 'px';
    sidebarPanel.style.height = height + 'px';
  }

  function applySidebarState() {
    if (!sidebarPanel || !sidebarState) return;
    sidebarPanel.classList.toggle('adrc-sidebar-hidden', sidebarState.visible === false);
    sidebarPanel.classList.toggle('adrc-sidebar-collapsed', sidebarState.collapsed === true);
    if (sidebarLauncher) sidebarLauncher.hidden = sidebarState.visible !== false;
    applySidebarGeometry();

    const collapse = sidebarPanel.querySelector('.adrc-sidebar-collapse');
    if (collapse) {
      collapse.textContent = sidebarState.collapsed ? '\u25b6' : '\u25bc';
      collapse.title = sidebarState.collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      collapse.setAttribute('aria-label', sidebarState.collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      collapse.setAttribute('aria-expanded', String(!sidebarState.collapsed));
    }
    setSidebarTab(sidebarState.tab, false);
    updateSidebarFilterUI();

    if (sidebarState.visible !== false) attachOutlineScrollListener();
    else detachOutlineScrollListener();
  }

  const SIDEBAR_DIFF_NAV_SVG = [
    '<svg viewBox="0 0 16 16" aria-hidden="true">',
    '  <path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M3 1.5h7l3 3v10a.5.5 0 0 1-.5.5h-9.5a.5.5 0 0 1-.5-.5v-12.5a.5.5 0 0 1 .5-.5z"/>',
    '  <path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M10 1.5v3h3"/>',
    '  <rect class="adrc-sidebar-diff-added" x="4.5" y="6.5" width="1.4" height="2.6" rx="0.4"/>',
    '  <path stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-opacity="0.55" d="M6.6 7.3h4.5M6.6 8.5h3.4"/>',
    '  <rect class="adrc-sidebar-diff-removed" x="4.5" y="10" width="1.4" height="2.6" rx="0.4"/>',
    '  <path stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-opacity="0.55" d="M6.6 10.8h4.5M6.6 12h2.6"/>',
    '</svg>'
  ].join('');

  const SIDEBAR_THREAD_NAV_SVG = [
    '<svg viewBox="1 1 14 14" aria-hidden="true">',
    '  <defs><mask id="adrc-thread-nav-mask"><rect width="16" height="16" fill="white"/><path d="M3.1 2.5H9.4a.6.6 0 0 1 .6.6V7.4a.6.6 0 0 1-.6.6H5L2 10l1.5-2H2.5a.6.6 0 0 1-.6-.6V3.1a.6.6 0 0 1 .6-.6Z" fill="none" stroke="black" stroke-width="0.8"/></mask></defs>',
    '  <path fill="currentColor" mask="url(#adrc-thread-nav-mask)" d="M6.6 7H13a.6.6 0 0 1 .6.6V11.4a.6.6 0 0 1-.6.6L14 14 11.3 12H6.6a.6.6 0 0 1-.6-.6V7.6a.6.6 0 0 1 .6-.6Z"/>',
    '  <path fill="currentColor" d="M3.1 2.5H9.4a.6.6 0 0 1 .6.6V7.4a.6.6 0 0 1-.6.6H5L2 10l1.5-2H2.5a.6.6 0 0 1-.6-.6V3.1a.6.6 0 0 1 .6-.6Z"/>',
    '</svg>'
  ].join('');

  function buildSidebarPanel() {
    if (sidebarPanel && sidebarPanel.isConnected) {
      applySidebarState();
      return sidebarPanel;
    }

    // Remove a stale standalone panel from an older dev-loaded build.
    document.querySelectorAll('.adrc-outline-panel').forEach((el) => el.remove());
    sidebarState = readSidebarState();

    const panel = document.createElement('aside');
    panel.className = 'adrc-sidebar';
    panel.setAttribute('aria-label', 'Markdown review navigation');
    panel.innerHTML = [
      '<div class="adrc-sidebar-header">',
      '  <button type="button" class="adrc-sidebar-icon adrc-sidebar-collapse" aria-label="Toggle sidebar" title="Collapse / expand sidebar (t) \u2014 Shift+T to reset"></button>',
      '  <span class="adrc-sidebar-nav-cluster adrc-sidebar-changes-nav" aria-label="Change navigation">',
      `    <button type="button" class="adrc-sidebar-nav-icon adrc-sidebar-diff-icon" aria-label="First change in this file" title="First change in this file \u2014 or next change globally if the file has none">${SIDEBAR_DIFF_NAV_SVG}</button>`,
      '    <button type="button" class="adrc-sidebar-nav-count adrc-sidebar-changes-count" aria-label="Show Changes" title="Show Changes (1)"><span aria-live="polite">0/0</span></button>',
      '    <button type="button" class="adrc-sidebar-nav-button adrc-sidebar-prev-change" aria-label="Previous change" title="Previous change ([) \u2014 first change ({)">\u2039</button>',
      '    <button type="button" class="adrc-sidebar-nav-button adrc-sidebar-next-change" aria-label="Next change" title="Next change (]) \u2014 last change (})">\u203a</button>',
      '  </span>',
      '  <span class="adrc-sidebar-separator" aria-hidden="true"></span>',
      '  <span class="adrc-sidebar-nav-cluster adrc-sidebar-thread-nav" aria-label="Thread navigation">',
      `    <button type="button" class="adrc-sidebar-nav-icon adrc-sidebar-thread-icon" aria-label="First thread in this file" title="First thread in this file \u2014 or next thread globally if the file has none">${SIDEBAR_THREAD_NAV_SVG}</button>`,
      '    <button type="button" class="adrc-sidebar-nav-count adrc-sidebar-thread-count" aria-label="Show Threads" title="Show Threads (2)"><span aria-live="polite">0/0</span></button>',
      '    <button type="button" class="adrc-sidebar-nav-button adrc-sidebar-prev-thread" aria-label="Previous thread" title="Previous thread (k) \u2014 first thread (h)">\u2039</button>',
      '    <button type="button" class="adrc-sidebar-nav-button adrc-sidebar-next-thread" aria-label="Next thread" title="Next thread (j) \u2014 last thread (l)">\u203a</button>',
      '  </span>',
      '  <span class="adrc-sidebar-header-spacer"></span>',
      '  <button type="button" class="adrc-sidebar-icon adrc-sidebar-filter" aria-pressed="false" title="Show unresolved threads only">',
      '    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.5 5v4l-3 1V8L2 3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
      '  </button>',
      '  <button type="button" class="adrc-sidebar-icon adrc-sidebar-hide" aria-label="Hide sidebar" title="Hide sidebar">\u00d7</button>',
      '</div>',
      '<div class="adrc-sidebar-tabs" role="tablist">',
      '    <button type="button" class="adrc-sidebar-tab" data-tab="changes" role="tab">Changes <span class="adrc-sidebar-tab-count" data-count="changes">0</span></button>',
      '    <button type="button" class="adrc-sidebar-tab" data-tab="threads" role="tab">Threads <span class="adrc-sidebar-tab-count" data-count="threads">0</span></button>',
      '    <button type="button" class="adrc-sidebar-tab" data-tab="outline" role="tab">Outline <span class="adrc-sidebar-tab-count" data-count="outline">0</span></button>',
      '</div>',
      '<div class="adrc-sidebar-body">',
      '  <section class="adrc-sidebar-pane adrc-sidebar-pane-changes" data-pane="changes" role="tabpanel">',
      '    <div class="adrc-sidebar-pane-header"><span class="adrc-sidebar-pane-title">Pull request changes</span><span class="adrc-sidebar-changes-summary"></span></div>',
      '    <div class="adrc-sidebar-change-list"></div>',
      '  </section>',
      '  <section class="adrc-sidebar-pane adrc-sidebar-pane-threads" data-pane="threads" role="tabpanel">',
      '    <div class="adrc-sidebar-pane-header"><span class="adrc-sidebar-pane-title">Pull request threads</span><span class="adrc-sidebar-pane-summary"></span></div>',
      '    <div class="adrc-sidebar-thread-list"></div>',
      '  </section>',
      '  <section class="adrc-sidebar-pane adrc-sidebar-pane-outline" data-pane="outline" role="tabpanel">',
      '    <div class="adrc-outline-toolbar" aria-label="Outline fold controls">',
      '      <button type="button" class="adrc-outline-fold-level" data-level="1" title="Fold H1 sections in the active file">Fold H1</button>',
      '      <button type="button" class="adrc-outline-fold-level" data-level="2" title="Fold H2 sections in the active file">Fold H2</button>',
      '      <button type="button" class="adrc-outline-fold-level" data-level="3" title="Fold H3 sections in the active file">Fold H3</button>',
      '      <button type="button" class="adrc-outline-expand-all" title="Expand every section in the active file">Expand all</button>',
      '    </div>',
      '    <div class="adrc-outline-body"></div>',
      '  </section>',
      '</div>'
    ].join('\n');
    document.body.appendChild(panel);

    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'adrc-sidebar-launcher';
    launcher.title = 'Show review sidebar';
    launcher.setAttribute('aria-label', 'Show review sidebar');
    launcher.textContent = '\u2630';
    document.body.appendChild(launcher);

    sidebarPanel = panel;
    sidebarLauncher = launcher;
    outlinePanel = panel;

    panel.querySelector('.adrc-sidebar-collapse').addEventListener('click', () => {
      saveSidebarState({ collapsed: !sidebarState.collapsed });
      applySidebarState();
    });
    panel.querySelector('.adrc-sidebar-hide').addEventListener('click', hideSidebar);
    panel.querySelector('.adrc-sidebar-filter').addEventListener('click', () => {
      saveSidebarState({ unresolvedOnly: !sidebarState.unresolvedOnly, tab: 'threads' });
      updateSidebarFilterUI();
      setSidebarTab('threads', false);
    });
    panel.querySelector('.adrc-sidebar-diff-icon').addEventListener('click', jumpToFirstChangeInCurrentFile);
    panel.querySelector('.adrc-sidebar-prev-change').addEventListener('click', () => jumpSidebarChange(-1));
    panel.querySelector('.adrc-sidebar-next-change').addEventListener('click', () => jumpSidebarChange(1));
    panel.querySelector('.adrc-sidebar-changes-count').addEventListener('click', () => showSidebar('changes'));
    panel.querySelector('.adrc-sidebar-thread-icon').addEventListener('click', jumpToFirstThreadInCurrentFile);
    panel.querySelector('.adrc-sidebar-prev-thread').addEventListener('click', () => jumpSidebarThread(-1));
    panel.querySelector('.adrc-sidebar-next-thread').addEventListener('click', () => jumpSidebarThread(1));
    panel.querySelector('.adrc-sidebar-thread-count').addEventListener('click', () => showSidebar('threads'));
    panel.querySelectorAll('.adrc-sidebar-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        showSidebar(tab.dataset.tab);
      });
    });
    panel.querySelectorAll('.adrc-outline-fold-level').forEach((button) => {
      button.addEventListener('click', () => foldOutlineAtLevel(parseInt(button.dataset.level, 10)));
    });
    panel.querySelector('.adrc-outline-expand-all').addEventListener('click', expandAllOutlineSections);
    launcher.addEventListener('click', () => showSidebar('threads'));

    wireSidebarDrag(panel);
    wireSidebarResize(panel);
    window.addEventListener('resize', applySidebarGeometry, { passive: true });
    applySidebarState();
    renderThreadsSidebar();
    renderOutlineRows();
    return panel;
  }

  function buildOutlinePanel() {
    return buildSidebarPanel();
  }

  function wireSidebarDrag(panel) {
    const header = panel.querySelector('.adrc-sidebar-header');
    if (!header) return;
    header.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      panel.classList.add('adrc-sidebar-dragging');

      const onMove = (moveEvent) => {
        const GRDC = window.GRDC || {};
        const delta = { dx: moveEvent.clientX - startX, dy: moveEvent.clientY - startY };
        const pos = typeof GRDC.clampDragPos === 'function'
          ? GRDC.clampDragPos(rect, delta, { width: window.innerWidth, height: window.innerHeight }, 80)
          : clampSidebarPosition(rect.left + delta.dx, rect.top + delta.dy, rect.width);
        panel.style.left = pos.left + 'px';
        panel.style.top = pos.top + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        panel.classList.remove('adrc-sidebar-dragging');
        const finalRect = panel.getBoundingClientRect();
        saveSidebarState({ left: finalRect.left, top: finalRect.top });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function wireSidebarResize(panel) {
    if (typeof ResizeObserver === 'undefined') return;
    try {
      sidebarResizeObserver = new ResizeObserver(() => {
        if (!sidebarState || sidebarState.collapsed || sidebarState.visible === false) return;
        clearTimeout(sidebarResizeTimer);
        sidebarResizeTimer = setTimeout(() => {
          const rect = panel.getBoundingClientRect();
          const GRDC = window.GRDC || {};
          const size = typeof GRDC.clampSize === 'function'
            ? GRDC.clampSize(rect.width, rect.height, SIDEBAR_MIN_WIDTH, SIDEBAR_MIN_HEIGHT)
            : { width: rect.width, height: rect.height };
          if (size.width && size.height) {
            saveSidebarState({ width: size.width, height: size.height });
          }
          updateActiveOutline();
          updateActiveSidebarChange();
        }, 150);
      });
      sidebarResizeObserver.observe(panel);
    } catch (err) {
      console.warn(`${LOG} ResizeObserver unavailable; sidebar resize persistence disabled:`, err);
    }
  }

  function setSidebarTab(tab, persist) {
    if (!sidebarPanel) return;
    const target = tab === 'outline' ? 'outline' : tab === 'threads' ? 'threads' : 'changes';
    sidebarState.tab = target;
    if (persist !== false) saveSidebarState({ tab: target });
    sidebarPanel.querySelectorAll('.adrc-sidebar-tab').forEach((button) => {
      const active = button.dataset.tab === target;
      button.classList.toggle('adrc-sidebar-tab-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    sidebarPanel.querySelectorAll('.adrc-sidebar-pane').forEach((pane) => {
      pane.hidden = pane.dataset.pane !== target;
    });
    const filter = sidebarPanel.querySelector('.adrc-sidebar-filter');
    if (filter) filter.hidden = target !== 'threads';
    if (target === 'outline') {
      refreshOutline();
      updateActiveOutline();
    } else if (target === 'threads') {
      renderThreadsSidebar();
      updateActiveSidebarThread();
    } else {
      renderChangesSidebar();
      updateActiveSidebarChange();
    }
    updateSidebarNavigation();
  }

  function showSidebar(tab) {
    buildSidebarPanel();
    saveSidebarState({
      visible: true,
      collapsed: false,
      tab: tab === 'outline' || tab === 'threads' || tab === 'changes'
        ? tab
        : sidebarState.tab
    });
    applySidebarState();
  }

  function hideSidebar() {
    if (!sidebarPanel) return;
    saveSidebarState({ visible: false });
    applySidebarState();
  }

  function updateSidebarFilterUI() {
    if (!sidebarPanel || !sidebarState) return;
    const filter = sidebarPanel.querySelector('.adrc-sidebar-filter');
    if (!filter) return;
    const active = sidebarState.unresolvedOnly === true;
    filter.classList.toggle('adrc-sidebar-filter-active', active);
    filter.setAttribute('aria-pressed', String(active));
    filter.title = active ? 'Showing unresolved threads only' : 'Show unresolved threads only';
    updateSidebarNavigation();
  }

  function updateSidebarNavigation() {
    if (!sidebarPanel) return;

    const activePath = currentFilePath() || currentFilePathCached;
    const GRDC = window.GRDC || {};
    const buildCounter = typeof GRDC.buildScopedCounterState === 'function'
      ? GRDC.buildScopedCounterState
      : (items, index, path) => ({
          text: `${index >= 0 ? index + 1 : 0}/${items.length}`,
          title: `${items.length} items in this pull request`,
          empty: !!path && items.every((item) => item.path !== path),
          total: items.length
        });

    function applyCounter(buttonSelector, items, activeIndex, kind) {
      const button = sidebarPanel.querySelector(buttonSelector);
      const value = button && button.querySelector('span');
      if (!button || !value) return;
      const state = buildCounter(items, activeIndex, activePath, kind);
      value.textContent = state.text;
      button.title = `${kind === 'threads' ? 'Show Threads (2)' : 'Show Changes (1)'} · ${state.title}`;
      button.setAttribute('aria-label', state.title);
      button.classList.toggle('adrc-sidebar-count-empty', state.empty);
    }

    applyCounter(
      '.adrc-sidebar-changes-count',
      sidebarChangeStops,
      sidebarActiveChangeIndex,
      'changes'
    );
    const changesTotal = sidebarChangeStops.length;
    sidebarPanel.querySelectorAll(
      '.adrc-sidebar-diff-icon, .adrc-sidebar-prev-change, .adrc-sidebar-next-change'
    ).forEach((button) => { button.disabled = changesTotal === 0; });

    const threads = getVisibleSidebarThreads();
    const threadIndex = threads.findIndex((item) => String(item.id) === String(sidebarActiveThreadId));
    applyCounter('.adrc-sidebar-thread-count', threads, threadIndex, 'threads');
    sidebarPanel.querySelectorAll(
      '.adrc-sidebar-thread-icon, .adrc-sidebar-prev-thread, .adrc-sidebar-next-thread'
    ).forEach((button) => { button.disabled = threads.length === 0; });
  }

  function jumpToFirstThreadInCurrentFile() {
    const items = getVisibleSidebarThreads();
    if (items.length === 0) return false;
    const path = currentFilePath() || currentFilePathCached;
    const index = path ? items.findIndex((item) => item.path === path) : -1;
    if (index < 0) return jumpSidebarThread(1);
    setActiveSidebarThread(items[index].id);
    navigateToSidebarThread(items[index], { preserveSidebar: true });
    return true;
  }

  function jumpToFirstChangeInCurrentFile() {
    if (sidebarChangeStops.length === 0) return false;
    const path = currentFilePath() || currentFilePathCached;
    const index = path ? sidebarChangeStops.findIndex((stop) => stop.path === path) : -1;
    if (index < 0) return jumpSidebarChange(1);
    navigateToSidebarChange(index);
    return true;
  }

  function jumpSidebarThread(delta) {
    const items = getVisibleSidebarThreads();
    if (items.length === 0) return false;
    const current = items.findIndex((item) => String(item.id) === String(sidebarActiveThreadId));
    let next;
    if (current < 0) {
      next = delta < 0 ? items.length - 1 : 0;
    } else {
      const GRDC = window.GRDC || {};
      next = typeof GRDC.nextWrappingIndex === 'function'
        ? GRDC.nextWrappingIndex(current, delta, items.length)
        : ((current + delta) % items.length + items.length) % items.length;
    }
    setActiveSidebarThread(items[next].id);
    navigateToSidebarThread(items[next], { preserveSidebar: true });
    return true;
  }

  function jumpSidebarThreadBoundary(last) {
    const items = getVisibleSidebarThreads();
    if (items.length === 0) return false;
    const index = last ? items.length - 1 : 0;
    setActiveSidebarThread(items[index].id);
    navigateToSidebarThread(items[index], { preserveSidebar: true });
    return true;
  }

  function jumpSidebarChange(delta) {
    const total = sidebarChangeStops.length;
    if (total === 0) return false;
    let next;
    if (sidebarActiveChangeIndex < 0 || sidebarActiveChangeIndex >= total) {
      next = delta < 0 ? total - 1 : 0;
    } else {
      const GRDC = window.GRDC || {};
      next = typeof GRDC.nextChangeIndex === 'function'
        ? GRDC.nextChangeIndex(sidebarActiveChangeIndex, delta, total)
        : ((sidebarActiveChangeIndex + delta) % total + total) % total;
    }
    navigateToSidebarChange(next);
    return true;
  }

  function jumpSidebarChangeBoundary(last) {
    if (sidebarChangeStops.length === 0) return false;
    navigateToSidebarChange(last ? sidebarChangeStops.length - 1 : 0);
    return true;
  }

  function toggleSidebarCollapsed() {
    buildSidebarPanel();
    if (sidebarState.visible === false) {
      saveSidebarState({ visible: true, collapsed: false });
    } else {
      saveSidebarState({ collapsed: !sidebarState.collapsed });
    }
    applySidebarState();
  }

  function resetSidebarLayout() {
    buildSidebarPanel();
    const tab = sidebarState.tab;
    const unresolvedOnly = sidebarState.unresolvedOnly;
    sidebarState = Object.assign(defaultSidebarState(), {
      tab,
      unresolvedOnly,
      visible: true,
      collapsed: false
    });
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(sidebarState)); } catch (_) {}
    sidebarPanel.style.left = '';
    sidebarPanel.style.top = '';
    sidebarPanel.style.right = '';
    sidebarPanel.style.width = '';
    sidebarPanel.style.height = '';
    applySidebarState();
  }

  function normalizeSidebarThread(thread) {
    if (!thread || adapter.isSystemThread(thread)) return null;
    const tc = thread.threadContext || {};
    const path = tc.filePath;
    const line = tc.rightFileStart && tc.rightFileStart.line;
    if (typeof path !== 'string' || !Number.isFinite(line)) return null;
    const endLine = tc.rightFileEnd && Number.isFinite(tc.rightFileEnd.line)
      ? tc.rightFileEnd.line
      : line;
    const comments = Array.isArray(thread.comments) ? thread.comments : [];
    const visibleComments = comments.filter((comment) => !comment.isDeleted);
    const head = visibleComments[0] || comments[0] || {};
    const author = head.author || {};
    const GRDC = window.GRDC || {};
    const snippetSource = head.isDeleted ? '(This comment was deleted.)' : (head.content || '');
    return {
      id: thread.id,
      thread,
      path,
      line,
      endLine,
      resolved: thread.status === 'fixed',
      status: thread.status || 'active',
      author: author.displayName || 'Unknown',
      avatarUrl: author.imageUrl || null,
      createdAt: head.publishedDate || thread.publishedDate || null,
      commentCount: visibleComments.length,
      snippet: typeof GRDC.buildSnippet === 'function'
        ? GRDC.buildSnippet(snippetSource, 80)
        : String(snippetSource).replace(/\s+/g, ' ').trim().slice(0, 80)
    };
  }

  function setSidebarThreads(threads) {
    sidebarThreadItems = (Array.isArray(threads) ? threads : [])
      .map(normalizeSidebarThread)
      .filter(Boolean);
    renderThreadsSidebar();
    renderOutlineRows();
  }

  function getVisibleSidebarThreads() {
    const GRDC = window.GRDC || {};
    const filtered = typeof GRDC.filterSidebarThreadItems === 'function'
      ? GRDC.filterSidebarThreadItems(sidebarThreadItems, sidebarState && sidebarState.unresolvedOnly)
      : sidebarThreadItems.filter((item) => !sidebarState?.unresolvedOnly || !item.resolved);
    const fileOrder = getStableAdoFileOrder([
      ...prMarkdownFileOrder,
      ...filtered.map((item) => item && item.path)
    ]);
    return typeof GRDC.sortSidebarThreadItems === 'function'
      ? GRDC.sortSidebarThreadItems(filtered, null, fileOrder)
      : filtered.slice().sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  }

  function renderThreadsSidebar() {
    if (!sidebarPanel) return;
    const list = sidebarPanel.querySelector('.adrc-sidebar-thread-list');
    if (!list) return;
    list.innerHTML = '';
    const visible = getVisibleSidebarThreads();
    const total = sidebarThreadItems.length;
    const unresolved = sidebarThreadItems.filter((item) => !item.resolved).length;
    const summary = sidebarPanel.querySelector('.adrc-sidebar-pane-summary');
    if (summary) {
      summary.textContent = sidebarState?.unresolvedOnly
        ? `${visible.length} unresolved`
        : `${total} total \u00b7 ${unresolved} unresolved`;
    }
    const count = sidebarPanel.querySelector('[data-count="threads"]');
    if (count) count.textContent = String(total);
    updateSidebarNavigation();

    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'adrc-sidebar-empty';
      empty.textContent = sidebarState?.unresolvedOnly
        ? 'No unresolved threads.'
        : 'No review threads yet.';
      list.appendChild(empty);
      return;
    }

    let lastPath = null;
    const activePath = currentFilePath() || currentFilePathCached;
    visible.forEach((item) => {
      if (item.path !== lastPath) {
        const group = document.createElement('div');
        group.className = 'adrc-sidebar-file-group';
        if (item.path === activePath) group.classList.add('adrc-sidebar-file-current');
        group.textContent = item.path.replace(/^\//, '') || item.path;
        group.title = item.path;
        list.appendChild(group);
        lastPath = item.path;
      }

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'adrc-sidebar-thread-card';
      card.dataset.threadId = String(item.id);
      card.dataset.path = item.path;
      if (item.resolved) card.classList.add('adrc-sidebar-thread-resolved');
      if (item.path === activePath) card.classList.add('adrc-sidebar-thread-current-file');

      const top = document.createElement('span');
      top.className = 'adrc-sidebar-thread-top';
      if (item.avatarUrl) {
        const avatar = document.createElement('img');
        avatar.className = 'adrc-sidebar-thread-avatar';
        avatar.src = item.avatarUrl;
        avatar.alt = '';
        top.appendChild(avatar);
      }
      const author = document.createElement('span');
      author.className = 'adrc-sidebar-thread-author';
      author.textContent = item.author;
      top.appendChild(author);
      const location = document.createElement('span');
      location.className = 'adrc-sidebar-thread-location';
      const GRDC = window.GRDC || {};
      location.textContent = typeof GRDC.formatLineRange === 'function'
        ? GRDC.formatLineRange(item.line, item.endLine)
        : `line ${item.line}`;
      top.appendChild(location);

      const snippet = document.createElement('span');
      snippet.className = 'adrc-sidebar-thread-snippet';
      snippet.textContent = item.snippet || '(No comment text)';

      const bottom = document.createElement('span');
      bottom.className = 'adrc-sidebar-thread-bottom';
      bottom.textContent = `${item.commentCount} comment${item.commentCount === 1 ? '' : 's'}`;
      if (item.resolved) {
        const status = document.createElement('span');
        status.className = 'adrc-sidebar-thread-status';
        status.textContent = '\u2713 resolved';
        bottom.appendChild(status);
      }

      card.append(top, snippet, bottom);
      card.addEventListener('click', () => navigateToSidebarThread(item));
      list.appendChild(card);
    });
    setActiveSidebarThread(sidebarActiveThreadId);
  }

  function setActiveSidebarThread(threadId) {
    sidebarActiveThreadId = threadId == null ? null : String(threadId);
    updateSidebarNavigation();
    if (!sidebarPanel) return;
    sidebarPanel.querySelectorAll('.adrc-sidebar-thread-card.adrc-sidebar-thread-active')
      .forEach((card) => card.classList.remove('adrc-sidebar-thread-active'));
    if (!sidebarActiveThreadId) return;
    const card = sidebarPanel.querySelector(
      `.adrc-sidebar-thread-card[data-thread-id="${escapeCssValue(sidebarActiveThreadId)}"]`
    );
    if (!card) return;
    card.classList.add('adrc-sidebar-thread-active');
    const list = sidebarPanel.querySelector('.adrc-sidebar-thread-list');
    if (list && sidebarState?.tab === 'threads') {
      const cardRect = card.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      if (cardRect.top < listRect.top) list.scrollTop -= listRect.top - cardRect.top;
      else if (cardRect.bottom > listRect.bottom) list.scrollTop += cardRect.bottom - listRect.bottom;
    }
  }

  function updateActiveSidebarThread() {
    if (!sidebarPanel || sidebarState?.visible === false) return;
    if (Date.now() < sidebarFollowSuppressedUntil) return;
    const preview = getCurrentPreviewContainer();
    if (!preview) return;
    const visibleIds = new Set(getVisibleSidebarThreads().map((item) => String(item.id)));
    const badges = Array.from(preview.querySelectorAll('.adrc-thread-badge[data-thread-id]'))
      .filter((badge) => visibleIds.has(String(badge.dataset.threadId)));
    if (badges.length === 0) {
      setActiveSidebarThread(null);
      return;
    }
    const scroller = getOutlineScrollContainer();
    const activeLine = (scroller === window ? 0 : scroller.getBoundingClientRect().top) + OUTLINE_ACTIVE_OFFSET;
    let best = null;
    let bestY = -Infinity;
    badges.forEach((badge) => {
      const y = badge.getBoundingClientRect().top;
      if (y <= activeLine && y > bestY) {
        best = badge;
        bestY = y;
      }
    });
    if (!best) best = badges[0];
    setActiveSidebarThread(best.dataset.threadId);
  }

  function findInlineThreadBadge(threadId) {
    const preview = getCurrentPreviewContainer();
    if (!preview) return null;
    return preview.querySelector(`.adrc-thread-badge[data-thread-id="${escapeCssValue(threadId)}"]`);
  }

  function escapeCssValue(value) {
    const text = String(value);
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(text);
    }
    return text.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  }

  function scrollToInlineThread(threadId) {
    const badge = findInlineThreadBadge(threadId);
    if (!badge) return false;
    const preview = getCurrentPreviewContainer();
    if (!preview) return false;
    const panel = preview.querySelector(
      `.adrc-thread-panel[data-thread-id="${escapeCssValue(threadId)}"]`
    );
    if (!panel) badge.click();
    setActiveSidebarThread(threadId);
    sidebarFollowSuppressedUntil = Date.now() + 1500;
    scrollToWithStickyOffset(badge);
    badge.classList.add('adrc-sidebar-target-pulse');
    setTimeout(() => badge.classList.remove('adrc-sidebar-target-pulse'), 1400);
    return true;
  }

  function savePendingThreadJump(item) {
    clearPendingChangeJump();
    clearPendingOutlineJump();
    resetPreviewRestoreState();
    try {
      sessionStorage.setItem(SIDEBAR_PENDING_THREAD_KEY, JSON.stringify({
        id: item.id,
        path: item.path,
        requirePreview: true,
        expiresAt: Date.now() + 30000
      }));
    } catch (_) { /* sessionStorage may be blocked */ }
  }

  function readPendingThreadJump() {
    try {
      const pending = JSON.parse(sessionStorage.getItem(SIDEBAR_PENDING_THREAD_KEY) || 'null');
      if (!pending || pending.expiresAt < Date.now()) {
        sessionStorage.removeItem(SIDEBAR_PENDING_THREAD_KEY);
        return null;
      }
      return pending;
    } catch (_) {
      return null;
    }
  }

  function clearPendingThreadJump() {
    try { sessionStorage.removeItem(SIDEBAR_PENDING_THREAD_KEY); } catch (_) {}
    resetPreviewRestoreState();
  }

  function savePendingChangeJump(stop) {
    clearPendingThreadJump();
    clearPendingOutlineJump();
    resetPreviewRestoreState();
    try {
      sessionStorage.setItem(SIDEBAR_PENDING_CHANGE_KEY, JSON.stringify({
        key: stop.key,
        path: stop.path,
        requirePreview: true,
        expiresAt: Date.now() + 30000
      }));
    } catch (_) { /* sessionStorage may be blocked */ }
  }

  function readPendingChangeJump() {
    try {
      const pending = JSON.parse(sessionStorage.getItem(SIDEBAR_PENDING_CHANGE_KEY) || 'null');
      if (!pending || pending.expiresAt < Date.now()) {
        sessionStorage.removeItem(SIDEBAR_PENDING_CHANGE_KEY);
        return null;
      }
      return pending;
    } catch (_) {
      return null;
    }
  }

  function clearPendingChangeJump() {
    try { sessionStorage.removeItem(SIDEBAR_PENDING_CHANGE_KEY); } catch (_) {}
    resetPreviewRestoreState();
  }

  function savePendingOutlineJump(target) {
    clearPendingThreadJump();
    clearPendingChangeJump();
    resetPreviewRestoreState();
    try {
      sessionStorage.setItem(SIDEBAR_PENDING_OUTLINE_KEY, JSON.stringify({
        key: target.key || null,
        path: target.path,
        requirePreview: true,
        expiresAt: Date.now() + 30000
      }));
    } catch (_) { /* sessionStorage may be blocked */ }
  }

  function readPendingOutlineJump() {
    try {
      const pending = JSON.parse(sessionStorage.getItem(SIDEBAR_PENDING_OUTLINE_KEY) || 'null');
      if (!pending || pending.expiresAt < Date.now()) {
        sessionStorage.removeItem(SIDEBAR_PENDING_OUTLINE_KEY);
        return null;
      }
      return pending;
    } catch (_) {
      return null;
    }
  }

  function clearPendingOutlineJump() {
    try { sessionStorage.removeItem(SIDEBAR_PENDING_OUTLINE_KEY); } catch (_) {}
    resetPreviewRestoreState();
  }

  function hasVisibleMarkdownPreview() {
    return Array.from(document.querySelectorAll('.markdown-preview-container'))
      .some(isVisiblePreviewContainer);
  }

  function normalizedControlText(el) {
    if (!el) return '';
    return String(el.getAttribute?.('aria-label') || el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isVisibleControl(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const ADO_VIEW_MODE_LABELS = ['side-by-side', 'inline', 'raw content', 'preview'];

  function normalizedText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function getAdoControlLabels(el) {
    if (!el) return [];
    const visibleCell = el.querySelector?.('.bolt-menuitem-cell-text');
    return [
      visibleCell && visibleCell.textContent,
      el.textContent,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title')
    ].map(normalizedText).filter(Boolean);
  }

  function labelContainsAdoMode(label, mode) {
    if (!label) return false;
    if (label === mode || label.startsWith(mode + ' ') || label.endsWith(' ' + mode)) return true;
    const escaped = mode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(label);
  }

  function getAdoViewModeLabel(el) {
    const labels = getAdoControlLabels(el);
    for (const label of labels) {
      const mode = ADO_VIEW_MODE_LABELS.find((candidate) => labelContainsAdoMode(label, candidate));
      if (mode) return mode;
    }
    return '';
  }

  function getVisibleAdoModeMenuOptions() {
    // Menu options are safe to click only when they have a menu/option role,
    // are Bolt list rows, or live inside a visible popup/callout. We do NOT
    // include arbitrary page buttons — doing so caused Side-by-side/Inline
    // oscillation when an open menu option was mistaken for the split button.
    const candidates = document.querySelectorAll([
      '[role="menuitem"]',
      '[role="menuitemradio"]',
      '[role="option"]',
      '.bolt-list-row',
      '[role="menu"] button',
      '.bolt-callout button',
      '.ms-Callout button'
    ].join(', '));
    return Array.from(candidates).filter((el) => {
      if (!isVisibleControl(el) || el.closest('.adrc-sidebar, .adrc-editor')) return false;
      return !!getAdoViewModeLabel(el);
    });
  }

  function findVisiblePreviewMenuOption() {
    return getVisibleAdoModeMenuOptions()
      .find((option) => getAdoViewModeLabel(option) === 'preview') || null;
  }

  function findAdoViewModeControls() {
    const popupSelector = '[role="menu"], .bolt-callout, .ms-Callout, [role="listbox"]';
    const groups = Array.from(document.querySelectorAll(
      '.bolt-split-button, [class*="split-button"], [role="group"]'
    ));

    for (const group of groups) {
      if (!isVisibleControl(group) || group.closest(popupSelector)) continue;
      const buttons = Array.from(group.querySelectorAll('button')).filter(isVisibleControl);
      const modeButton = buttons.find((button) => {
        if (button.matches('.bolt-split-button-option') || button.closest(popupSelector)) return false;
        return !!getAdoViewModeLabel(button);
      });
      if (!modeButton) continue;

      // Only a documented split/dropdown affordance may open the menu.
      // Never fall back to "some other button" or the mode button itself.
      const optionNode = group.querySelector('.bolt-split-button-option');
      const classTrigger = optionNode && (
        optionNode.matches('button') ? optionNode : optionNode.querySelector('button')
      );
      const ariaTrigger = buttons.find((button) => {
        if (button === modeButton) return false;
        const hint = `${button.getAttribute('aria-label') || ''} ${button.title || ''}`.toLowerCase();
        return button.getAttribute('aria-haspopup') === 'true' || /menu|options?|view|dropdown/.test(hint);
      });
      const trigger = classTrigger || ariaTrigger || null;
      if (trigger && trigger !== modeButton && isVisibleControl(trigger)) {
        return { group, modeButton, trigger };
      }
    }
    return null;
  }

  const previewRestoreState = {
    phase: 'idle',       // idle | opening | selecting | awaiting-preview
    openedAt: 0,
    selectedAt: 0,
    lastControlLabel: '',
    lastError: ''
  };

  function resetPreviewRestoreState() {
    previewRestoreState.phase = 'idle';
    previewRestoreState.openedAt = 0;
    previewRestoreState.selectedAt = 0;
    previewRestoreState.lastControlLabel = '';
    previewRestoreState.lastError = '';
  }

  /**
   * Ask ADO's four-option view-mode split button to switch the active file
   * back to Preview. Returns true once a visible Preview exists; false while
   * the control/menu is still settling. Safe to call repeatedly.
   */
  function ensureAdoPreviewMode() {
    if (hasVisibleMarkdownPreview()) {
      resetPreviewRestoreState();
      return true;
    }

    const visibleOption = findVisiblePreviewMenuOption();
    if (visibleOption) {
      // Click Preview once, then wait for the rendered container. Repeated
      // clicks during React re-render can select another option underneath.
      if (previewRestoreState.phase !== 'selecting') {
        previewRestoreState.phase = 'selecting';
        previewRestoreState.selectedAt = Date.now();
        visibleOption.click();
      }
      return false;
    }

    const now = Date.now();
    // If any mode menu is open but Preview wasn't identified, do not click
    // another control and risk choosing a neighboring option. Wait and expose
    // the menu labels through ADORC_probe.viewMode() for diagnosis.
    if (getVisibleAdoModeMenuOptions().length > 0) {
      previewRestoreState.phase = 'opening';
      return false;
    }

    if (previewRestoreState.phase === 'selecting') {
      return false;
    }

    const controls = findAdoViewModeControls();
    if (!controls) {
      previewRestoreState.lastError = 'No safe ADO view-mode split-button found';
      return false;
    }
    const modeLabel = getAdoViewModeLabel(controls.modeButton);
    previewRestoreState.lastControlLabel = modeLabel;

    // If ADO already labels the current mode Preview, its rendered content
    // is probably still mounting; wait rather than reopening the menu.
    if (modeLabel.startsWith('preview')) {
      previewRestoreState.phase = 'awaiting-preview';
      return false;
    }

    // Never toggle the trigger a second time for this pending jump. If the
    // menu DOM is unfamiliar, fail safely rather than oscillating modes.
    if (previewRestoreState.phase === 'opening') {
      return false;
    }

    previewRestoreState.phase = 'opening';
    previewRestoreState.openedAt = now;
    previewRestoreState.lastError = '';
    controls.trigger.click();
    return false;
  }

  function continuePendingThreadNavigation() {
    const pending = readPendingThreadJump();
    if (!pending || pending.path !== currentFilePath()) return;
    if (pending.requirePreview && !ensureAdoPreviewMode()) return;
    schedulePreviewInit(50);
    if (currentFilePathCached === pending.path) resumePendingThreadJump(0);
  }

  function continuePendingChangeNavigation() {
    const pending = readPendingChangeJump();
    if (!pending || pending.path !== currentFilePath()) return;
    if (pending.requirePreview && !ensureAdoPreviewMode()) return;
    schedulePreviewInit(50);
    if (currentFilePathCached === pending.path) resumePendingChangeJump(0);
  }

  function continuePendingOutlineNavigation() {
    const pending = readPendingOutlineJump();
    if (!pending || pending.path !== currentFilePath()) return;
    if (pending.requirePreview && !ensureAdoPreviewMode()) return;
    schedulePreviewInit(50);
    if (currentFilePathCached === pending.path) resumePendingOutlineJump(0);
  }

  function resumePendingThreadJump(attempt) {
    const pending = readPendingThreadJump();
    if (!pending || pending.path !== currentFilePathCached) return;
    if (pending.requirePreview && !hasVisibleMarkdownPreview()) {
      ensureAdoPreviewMode();
      return;
    }
    if (scrollToInlineThread(pending.id)) {
      clearPendingThreadJump();
      return;
    }
    const n = Number.isFinite(attempt) ? attempt : 0;
    if (n < 20) {
      setTimeout(() => resumePendingThreadJump(n + 1), 250);
    } else {
      clearPendingThreadJump();
      showErrorToast(`Could not locate thread ${pending.id} in ${pending.path}.`);
    }
  }

  function resumePendingChangeJump(attempt) {
    const pending = readPendingChangeJump();
    if (!pending || pending.path !== currentFilePathCached) return;
    if (pending.requirePreview && !hasVisibleMarkdownPreview()) {
      ensureAdoPreviewMode();
      return;
    }
    const index = sidebarChangeStops.findIndex((stop) => stop.key === pending.key);
    if (index >= 0 && scrollToCurrentChange(index)) {
      clearPendingChangeJump();
      return;
    }
    const n = Number.isFinite(attempt) ? attempt : 0;
    if (n < 20) {
      setTimeout(() => resumePendingChangeJump(n + 1), 250);
    } else {
      clearPendingChangeJump();
      showErrorToast(`Could not locate the selected change in ${pending.path}.`);
    }
  }

  function resumePendingOutlineJump(attempt) {
    const pending = readPendingOutlineJump();
    if (!pending || pending.path !== currentFilePathCached) return;
    if (pending.requirePreview && !hasVisibleMarkdownPreview()) {
      ensureAdoPreviewMode();
      return;
    }
    const descriptor = pending.key
      ? outlineHeadings.find((heading) => heading.key === pending.key)
      : outlineHeadings[0];
    if (descriptor && scrollToLiveOutlineHeading(descriptor)) {
      clearPendingOutlineJump();
      return;
    }
    if (!pending.key) {
      const preview = getCurrentPreviewContainer();
      if (preview && scrollToWithStickyOffset(preview)) {
        clearPendingOutlineJump();
        return;
      }
    }
    const n = Number.isFinite(attempt) ? attempt : 0;
    if (n < 20) {
      setTimeout(() => resumePendingOutlineJump(n + 1), 250);
    } else {
      clearPendingOutlineJump();
      showErrorToast(`Could not locate the selected heading in ${pending.path}.`);
    }
  }

  function navigateToSidebarThread(item, options) {
    if (!options || options.preserveSidebar !== true) showSidebar('threads');
    if (item.path === (currentFilePath() || currentFilePathCached)) {
      clearPendingThreadJump();
      if (!scrollToInlineThread(item.id)) {
        showErrorToast(`Could not locate thread ${item.id} in the rendered file.`);
      }
      return;
    }

    const fileTarget = findBestAdoFileTreeTarget(item.path);
    if (!fileTarget) {
      clearPendingThreadJump();
      console.warn(`${LOG} no native ADO file-tree row found for ${item.path}`);
      showErrorToast(`Could not find ${item.path} in the visible ADO file tree.`);
      return;
    }

    savePendingThreadJump(item);
    console.log(`${LOG} navigating to ${item.path} through native ADO tree row`, {
      rowId: fileTarget.row.id,
      labels: fileTarget.labels,
      score: fileTarget.score
    });
    fileTarget.target.click();
    setTimeout(continuePendingThreadNavigation, 100);
    // If native activation did not change the route, fail safely. Never
    // fall back to a URL/anchor navigation — that remounts Inline mode.
    setTimeout(() => {
      const pending = readPendingThreadJump();
      if (pending && pending.path === item.path && currentFilePath() !== item.path) {
        clearPendingThreadJump();
        console.warn(`${LOG} ADO tree row did not activate ${item.path}`, fileTarget);
        showErrorToast(`ADO did not open ${item.path}; expand its folder in the file tree and retry.`);
      }
    }, 2000);
  }

  function getAdoFileTreeCandidates(path) {
    const normalizedPath = normalizedText(String(path || '').replace(/^\//, ''));
    const basename = normalizedPath.split('/').filter(Boolean).pop() || '';
    const rows = Array.from(document.querySelectorAll('[role="treeitem"], .bolt-tree-row'));
    const candidates = [];

    rows.forEach((row, index) => {
      if (!isVisibleControl(row) || row.closest('.adrc-sidebar')) return;
      if (row.closest('.repos-changes-viewer, .bolt-card')) return;

      const hrefPath = Array.from(row.querySelectorAll('a[href]')).map((link) => {
        try { return new URL(link.href, window.location.href).searchParams.get('path'); }
        catch (_) { return null; }
      }).find(Boolean);
      const labels = [
        row.getAttribute('aria-label'),
        row.getAttribute('title'),
        row.querySelector('.bolt-tree-cell')?.textContent,
        row.textContent,
        hrefPath
      ].map(normalizedText).filter(Boolean);

      let score = 0;
      if (hrefPath === path) score += 200;
      if (labels.some((label) => label === normalizedPath || label.endsWith('/' + normalizedPath))) score += 140;
      if (labels.some((label) => label === basename)) score += 100;
      if (basename && labels.some((label) => label.endsWith('/' + basename) || label.includes(basename))) score += 50;
      if (row.getAttribute('role') === 'treeitem') score += 20;
      if (row.classList.contains('bolt-tree-row')) score += 20;
      // Folder rows expose aria-expanded; prefer leaf rows for files.
      if (row.getAttribute('aria-expanded') == null) score += 10;
      if (score <= 0) return;

      // Trigger from the cell content so Azure DevOps UI's delegated table
      // activation sees a normal leaf-row click. Avoid the nested href.
      const target = row.querySelector(
        '.bolt-tree-cell .bolt-table-cell-content, .bolt-tree-cell, .bolt-table-cell-content'
      ) || row;
      candidates.push({ row, target, labels, score, index });
    });

    candidates.sort((a, b) => b.score - a.score || a.index - b.index);
    return candidates;
  }

  function findBestAdoFileTreeTarget(path) {
    return getAdoFileTreeCandidates(path)[0] || null;
  }

  /**
   * Resolve the reviewer's visible ADO file order. The iteration changes API
   * has been observed returning the reverse of the native tree, so API order is
   * not a UI contract. When every relevant row is materialized, use its DOM
   * position. Collapsed/virtualized trees fall back to deterministic path order
   * rather than partially mixing two orderings.
   */
  function getStableAdoFileOrder(paths) {
    const unique = [];
    const seen = new Set();
    (Array.isArray(paths) ? paths : []).forEach((value) => {
      const path = adapter.normalizeFilePath(value);
      if (!path || seen.has(path)) return;
      seen.add(path);
      unique.push(path);
    });
    const ranked = unique.map((path) => ({ path, target: findBestAdoFileTreeTarget(path) }));
    if (ranked.length > 0 && ranked.every((entry) => entry.target)) {
      return ranked
        .sort((a, b) => a.target.index - b.target.index)
        .map((entry) => entry.path);
    }
    return unique.slice().sort((a, b) => a.localeCompare(b, undefined, {
      sensitivity: 'base',
      numeric: true
    }));
  }

  function snapshotOutlineHeading(heading) {
    return {
      id: heading.id,
      key: heading.key || heading.id,
      level: heading.level,
      text: heading.text,
      line: heading.line,
      file: heading.file
    };
  }

  function syncCurrentFileOutlineSnapshot() {
    const path = currentFilePathCached;
    if (!path) return;
    const change = prMarkdownChanges.find((item) => item.path === path);
    const prior = prOutlineCatalog.get(path);
    prOutlineCatalog.set(path, {
      path,
      lifecycle: change?.type || prior?.lifecycle || 'edit',
      status: outlineHeadings.length > 0 ? 'ready' : 'empty',
      error: '',
      headings: outlineHeadings.map(snapshotOutlineHeading)
    });
  }

  function getPrOutlineFileOrder() {
    return getStableAdoFileOrder([
      ...prMarkdownFileOrder,
      ...Array.from(prOutlineCatalog.keys()),
      currentFilePathCached
    ]);
  }

  async function buildPrOutlineEntry(change) {
    const path = change.path;
    if (change.type === 'delete') {
      return { path, lifecycle: 'delete', status: 'deleted', error: '', headings: [] };
    }
    try {
      const source = await retryableHeadFileSource(path);
      const GRDC = window.GRDC || {};
      if (typeof GRDC.extractMarkdownHeadings !== 'function') {
        throw new Error('Outline source helpers are unavailable — check ADO manifest script order');
      }
      const headings = GRDC.extractMarkdownHeadings(source, path);
      return {
        path,
        lifecycle: change.type,
        status: headings.length > 0 ? 'ready' : 'empty',
        error: '',
        headings
      };
    } catch (err) {
      return {
        path,
        lifecycle: change.type,
        status: 'error',
        error: String(err && (err.message || err)).slice(0, 160),
        headings: []
      };
    }
  }

  function ensurePrOutlineCatalog() {
    if (prOutlinePromise) return prOutlinePromise;
    prOutlineStatus = 'loading';
    prOutlineError = '';
    renderOutlineRows();
    prOutlinePromise = ensurePrChangesCatalog()
      .then(async () => {
        const entries = await mapWithConcurrency(prMarkdownChanges, 4, buildPrOutlineEntry);
        const next = new Map(entries.map((entry) => [entry.path, entry]));
        // Preserve a current Markdown file that is not in the cumulative
        // inventory (defensive for unusual ADO context-only file routes).
        prOutlineCatalog.forEach((entry, path) => {
          if (!next.has(path)) next.set(path, entry);
        });
        prOutlineCatalog = next;
        prOutlineStatus = 'ready';
        syncCurrentFileOutlineSnapshot();
        renderOutlineRows();
        updateActiveOutline();
        resumePendingOutlineJump(0);
        return prOutlineCatalog;
      })
      .catch((err) => {
        prOutlineStatus = 'error';
        prOutlineError = String(err && (err.message || err)).slice(0, 160);
        prOutlinePromise = null;
        renderOutlineRows();
        return prOutlineCatalog;
      });
    return prOutlinePromise;
  }

  function getMappedBlocksForChanges() {
    const out = [];
    currentBlockInfo.forEach((info, block) => {
      if (!block || !info || !Number.isFinite(info.line)) return;
      const entry = { block, line: info.line };
      if (block.tagName === 'PRE') {
        const rangeEnd = parseInt(block.dataset.adrcRangeEnd, 10);
        if (Number.isFinite(rangeEnd) && rangeEnd >= info.line) entry.endLine = rangeEnd;
      }
      out.push(entry);
    });
    return out;
  }

  function isMarkdownChange(change) {
    const GRDC = window.GRDC || {};
    const isMarkdown = typeof GRDC.isMarkdownPath === 'function'
      ? GRDC.isMarkdownPath
      : (path) => /\.(md|markdown)$/i.test(String(path || '').split(/[?#]/)[0]);
    return !!change && isMarkdown(change.path);
  }

  async function mapWithConcurrency(items, limit, worker) {
    const values = Array.isArray(items) ? items : [];
    if (values.length === 0) return [];
    const results = new Array(values.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(Number(limit) || 1, values.length));
    const runners = Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await worker(values[index], index);
      }
    });
    await Promise.all(runners);
    return results;
  }

  async function buildPrChangeStopsForEntry(change) {
    const GRDC = window.GRDC || {};
    if (typeof GRDC.buildPrChangeStops !== 'function') {
      throw new Error('PR-wide Changes helpers are unavailable — check ADO manifest script order');
    }

    let headSource = '';
    let baseSource = '';
    try {
      if (change.type !== 'delete') {
        headSource = await retryableHeadFileSource(change.path);
      }
      if (change.type !== 'add') {
        baseSource = await retryableBaseFileSource(change.oldPath || change.path);
      }
      return GRDC.buildPrChangeStops(change, baseSource, headSource);
    } catch (err) {
      console.warn(`${LOG} Changes source unavailable for ${change.path}:`, err);
      return GRDC.buildPrChangeStops(change, baseSource, headSource, { error: err });
    }
  }

  /**
   * Fetch and build the stable PR-wide Markdown change catalog once per page
   * session. Source work is capped at four files concurrently; each worker
   * fetches head/base sequentially so large PRs cannot burst dozens of ADO
   * item requests at once.
   */
  function ensurePrChangesCatalog() {
    if (prChangesPromise) return prChangesPromise;
    const requestVersion = ++changesGeneration;
    const priorKey = sidebarChangeStops[sidebarActiveChangeIndex]?.key || null;
    sidebarChangesStatus = 'loading';
    sidebarChangesError = '';
    renderChangesSidebar();

    prChangesPromise = (async () => {
      await adapter.resolveIds(ctx);
      const inventory = await adapter.listPullRequestChanges(ctx);
      if (requestVersion !== changesGeneration) return sidebarChangeStops;

      prChangesIterationId = inventory.iteration && inventory.iteration.id != null
        ? Number(inventory.iteration.id)
        : null;
      const sourceCommit = inventory.iteration?.sourceRefCommit?.commitId;
      const commonCommit = inventory.iteration?.commonRefCommit?.commitId;
      prChangesHeadVersion = sourceCommit
        ? { version: sourceCommit, versionType: 'commit' }
        : null;
      prChangesBaseVersion = commonCommit
        ? { version: commonCommit, versionType: 'commit' }
        : null;
      prMarkdownChanges = (inventory.changeEntries || [])
        .map((entry) => adapter.normalizePullRequestChange(entry))
        .filter((change) => change && isMarkdownChange(change));
      prMarkdownFileOrder = getStableAdoFileOrder(
        prMarkdownChanges.map((change) => change.path)
      );
      const fileRank = new Map(prMarkdownFileOrder.map((path, index) => [path, index]));
      prMarkdownChanges.sort((a, b) =>
        (fileRank.get(a.path) ?? Number.MAX_SAFE_INTEGER) -
        (fileRank.get(b.path) ?? Number.MAX_SAFE_INTEGER)
      );

      const groups = await mapWithConcurrency(
        prMarkdownChanges,
        4,
        (change) => buildPrChangeStopsForEntry(change)
      );
      if (requestVersion !== changesGeneration) return sidebarChangeStops;

      sidebarChangeStops = groups.flat();
      sidebarChangesStatus = 'ready';
      sidebarChangesError = '';
      const restored = priorKey
        ? sidebarChangeStops.findIndex((stop) => stop.key === priorKey)
        : -1;
      if (restored >= 0) {
        sidebarActiveChangeIndex = restored;
      } else {
        const activePath = currentFilePath() || currentFilePathCached;
        const currentFileIndex = sidebarChangeStops.findIndex((stop) => stop.path === activePath);
        sidebarActiveChangeIndex = currentFileIndex >= 0
          ? currentFileIndex
          : (sidebarChangeStops.length > 0 ? 0 : -1);
      }
      renderChangesSidebar();
      updateActiveSidebarChange();
      resumePendingChangeJump(0);
      console.log(
        `${LOG} Changes: ${sidebarChangeStops.length} PR-wide stop${sidebarChangeStops.length === 1 ? '' : 's'} ` +
        `across ${prMarkdownChanges.length} Markdown file${prMarkdownChanges.length === 1 ? '' : 's'} ` +
        `(iteration ${prChangesIterationId == null ? 'unknown' : prChangesIterationId})`
      );
      return sidebarChangeStops;
    })().catch((err) => {
      if (requestVersion === changesGeneration) {
        sidebarChangesStatus = 'error';
        sidebarChangesError = String(err && (err.message || err)).slice(0, 200);
        sidebarChangeStops = [];
        sidebarActiveChangeIndex = -1;
        renderChangesSidebar();
        console.warn(`${LOG} PR-wide Changes unavailable:`, err);
      }
      prChangesPromise = null;
      return sidebarChangeStops;
    });
    return prChangesPromise;
  }

  function refreshChangesSidebar() {
    renderChangesSidebar();
    ensurePrChangesCatalog().then(() => {
      updateActiveSidebarChange();
      resumePendingChangeJump(0);
    });
  }

  function changeKindGlyph(kind) {
    if (kind === 'added') return '+';
    if (kind === 'removed') return '\u2212';
    if (kind === 'renamed') return '\u2192';
    if (kind === 'unavailable') return '!';
    return '\u00b1';
  }

  function buildSidebarChangeSnippet(stop) {
    return stop && stop.snippet ? stop.snippet : '(No visible text)';
  }

  function renderChangesSidebar() {
    if (!sidebarPanel) return;
    const list = sidebarPanel.querySelector('.adrc-sidebar-change-list');
    if (!list) return;
    list.innerHTML = '';
    const count = sidebarPanel.querySelector('[data-count="changes"]');
    if (count) count.textContent = String(sidebarChangeStops.length);
    updateSidebarNavigation();
    const summary = sidebarPanel.querySelector('.adrc-sidebar-changes-summary');
    if (summary) {
      if (sidebarChangesStatus === 'loading') summary.textContent = 'Loading PR\u2026';
      else if (sidebarChangesStatus === 'error') summary.textContent = 'Unavailable';
      else summary.textContent = `${prMarkdownChanges.length} Markdown file${prMarkdownChanges.length === 1 ? '' : 's'} \u00b7 ${sidebarChangeStops.length} stop${sidebarChangeStops.length === 1 ? '' : 's'}`;
    }

    if (sidebarChangesStatus === 'loading') {
      const loading = document.createElement('div');
      loading.className = 'adrc-sidebar-empty';
      loading.textContent = 'Loading pull request changes\u2026';
      list.appendChild(loading);
      return;
    }
    if (sidebarChangesStatus === 'error') {
      const error = document.createElement('div');
      error.className = 'adrc-sidebar-empty adrc-sidebar-changes-error';
      error.textContent = `Changes unavailable: ${sidebarChangesError}`;
      list.appendChild(error);
      return;
    }
    if (sidebarChangeStops.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'adrc-sidebar-empty';
      empty.textContent = sidebarChangesStatus === 'idle'
        ? 'Open a Markdown file in Preview to load changes.'
        : 'No Markdown source changes in this pull request.';
      list.appendChild(empty);
      return;
    }

    const GRDC = window.GRDC || {};
    let lastPath = null;
    const activePath = currentFilePath() || currentFilePathCached;
    sidebarChangeStops.forEach((stop, index) => {
      if (stop.path !== lastPath) {
        const group = document.createElement('div');
        group.className = 'adrc-sidebar-file-group';
        if (stop.path === activePath) group.classList.add('adrc-sidebar-file-current');
        group.textContent = String(stop.path || '').replace(/^\//, '') || '(unknown file)';
        group.title = stop.path || '';
        list.appendChild(group);
        lastPath = stop.path;
      }

      const card = document.createElement('button');
      card.type = 'button';
      card.className = `adrc-sidebar-change-card adrc-sidebar-change-${stop.kind}`;
      card.dataset.changeIndex = String(index);
      card.dataset.changeKey = stop.key;
      card.dataset.path = stop.path;
      card.dataset.stopType = stop.stopType;
      card.dataset.lifecycle = stop.lifecycle;
      if (stop.stopType === 'summary') card.classList.add('adrc-sidebar-change-summary-card');

      const top = document.createElement('span');
      top.className = 'adrc-sidebar-change-top';
      const glyph = document.createElement('span');
      glyph.className = 'adrc-sidebar-change-kind';
      glyph.textContent = changeKindGlyph(stop.kind);
      glyph.title = stop.label || (stop.kind === 'mixed' ? 'Modified' : stop.kind[0].toUpperCase() + stop.kind.slice(1));
      const location = document.createElement('span');
      location.className = 'adrc-sidebar-change-location';
      const range = Number.isFinite(stop.line) && typeof GRDC.formatLineRange === 'function'
        ? GRDC.formatLineRange(stop.line, stop.endLine)
        : Number.isFinite(stop.line) ? `line ${stop.line}` : '';
      location.textContent = stop.label || range || 'File change';
      top.append(glyph, location);

      const snippet = document.createElement('span');
      snippet.className = 'adrc-sidebar-change-snippet';
      snippet.textContent = buildSidebarChangeSnippet(stop);
      card.append(top, snippet);
      card.addEventListener('click', () => navigateToSidebarChange(index));
      list.appendChild(card);
    });
    setActiveSidebarChange(sidebarActiveChangeIndex, false);
  }

  function setActiveSidebarChange(index, ensureVisible) {
    if (!Number.isFinite(index) || index < 0 || index >= sidebarChangeStops.length) {
      sidebarActiveChangeIndex = -1;
    } else {
      sidebarActiveChangeIndex = index;
    }
    updateSidebarNavigation();
    if (!sidebarPanel) return;
    sidebarPanel.querySelectorAll('.adrc-sidebar-change-card.adrc-sidebar-change-active')
      .forEach((card) => card.classList.remove('adrc-sidebar-change-active'));
    if (sidebarActiveChangeIndex < 0) return;
    const card = sidebarPanel.querySelector(
      `.adrc-sidebar-change-card[data-change-index="${sidebarActiveChangeIndex}"]`
    );
    if (!card) return;
    card.classList.add('adrc-sidebar-change-active');
    if (ensureVisible && sidebarState?.tab === 'changes') {
      const list = sidebarPanel.querySelector('.adrc-sidebar-change-list');
      const cardRect = card.getBoundingClientRect();
      const listRect = list && list.getBoundingClientRect();
      if (list && listRect) {
        if (cardRect.top < listRect.top) list.scrollTop -= listRect.top - cardRect.top;
        else if (cardRect.bottom > listRect.bottom) list.scrollTop += cardRect.bottom - listRect.bottom;
      }
    }
  }

  function sectionContainsBlock(heading, block) {
    return sectionRoots(heading).some((root) =>
      root === block || (root.contains && root.contains(block))
    );
  }

  /**
   * A mapped changed block can still be invisible because one or more
   * heading sections are folded. Expand every containing fold from outer to
   * inner before measuring geometry; otherwise getBoundingClientRect() is
   * zero and the scroll appears to do nothing.
   */
  function revealChangedBlock(block) {
    if (!block || !block.isConnected) return false;
    const preview = getCurrentPreviewContainer();
    if (!preview) return false;
    const collapsed = Array.from(
      preview.querySelectorAll('h1.adrc-section-collapsed, h2.adrc-section-collapsed, h3.adrc-section-collapsed, h4.adrc-section-collapsed, h5.adrc-section-collapsed, h6.adrc-section-collapsed')
    );
    collapsed.forEach((heading) => {
      if (!sectionContainsBlock(heading, block)) return;
      collapsedHeadings.delete(heading);
      const outlineKey = heading.dataset.adrcOutlineKey;
      if (outlineKey) outlineCollapsedKeys.delete(outlineKey);
      const toggle = ensureCollapseToggle(heading);
      if (toggle) applyCollapseVisuals(heading, toggle, false);
    });
    const style = getComputedStyle(block);
    const rect = block.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function resolveCurrentChangeBlock(stop) {
    if (!stop || stop.path !== currentFilePathCached || stop.lifecycle === 'delete') return null;
    const preview = getCurrentPreviewContainer();
    if (!preview) return null;
    if (stop.stopType === 'summary' || stop.stopType === 'unavailable') {
      for (const block of currentBlockInfo.keys()) {
        if (block && block.isConnected && preview.contains(block)) return block;
      }
      return null;
    }
    // Exact source-line lookup is the strongest signal and is refreshed on
    // every route-aware Preview init. It also resolves interior code lines to
    // their shared <pre> host.
    const exact = currentLineToBlock.get(stop.line);
    if (exact && exact.isConnected && preview.contains(exact)) return exact;
    const GRDC = window.GRDC || {};
    if (stop.hunk && typeof GRDC.mapDiffHunksToBlocks === 'function') {
      const headLineCount = typeof GRDC.splitSourceLines === 'function'
        ? GRDC.splitSourceLines(currentSource).length
        : String(currentSource || '').split(/\r?\n/).length;
      const mapped = GRDC.mapDiffHunksToBlocks(
        [stop.hunk],
        getMappedBlocksForChanges(),
        headLineCount
      );
      const block = mapped[0] && mapped[0].block;
      if (block && block.isConnected && preview.contains(block)) return block;
    }
    return null;
  }

  function scrollToCurrentChange(index) {
    const stop = sidebarChangeStops[index];
    const block = resolveCurrentChangeBlock(stop);
    if (!block) return false;
    if (!revealChangedBlock(block)) {
      showErrorToast('This changed block is currently hidden in the rendered Preview.');
      return false;
    }
    setActiveSidebarChange(index, true);
    sidebarFollowSuppressedUntil = Date.now() + 1500;
    scrollToWithStickyOffset(block);
    const GRDC = window.GRDC || {};
    const host = (typeof GRDC.buttonAnchor === 'function' ? GRDC.buttonAnchor(block) : block) || block;
    host.classList.remove('adrc-change-target-pulse');
    // Restart animation even when the same card is clicked repeatedly.
    void host.offsetWidth;
    host.classList.add('adrc-change-target-pulse');
    setTimeout(() => host.classList.remove('adrc-change-target-pulse'), 1400);
    return true;
  }

  function navigateToSidebarChange(index) {
    const stop = sidebarChangeStops[index];
    if (!stop) return false;
    setActiveSidebarChange(index, true);

    if (stop.path === currentFilePath() &&
      stop.path === currentFilePathCached &&
      stop.lifecycle !== 'delete') {
      clearPendingChangeJump();
      if (scrollToCurrentChange(index)) return true;
      schedulePreviewInit(50);
      showErrorToast('This changed block is no longer in the active Preview.');
      return false;
    }

    const fileTarget = findBestAdoFileTreeTarget(stop.path);
    if (!fileTarget) {
      clearPendingChangeJump();
      console.warn(`${LOG} no native ADO file-tree row found for changed file ${stop.path}`);
      showErrorToast(`Could not find ${stop.path} in the visible ADO file tree.`);
      return false;
    }

    // Deleted files have no renderable head Markdown. Native ADO navigation
    // is still useful, but requiring Preview would create an impossible retry.
    if (stop.lifecycle === 'delete') {
      clearPendingChangeJump();
      fileTarget.target.click();
      return true;
    }

    savePendingChangeJump(stop);
    console.log(`${LOG} navigating to changed file ${stop.path} through native ADO tree row`, {
      changeKey: stop.key,
      rowId: fileTarget.row.id,
      labels: fileTarget.labels,
      score: fileTarget.score
    });
    fileTarget.target.click();
    setTimeout(continuePendingChangeNavigation, 100);
    setTimeout(() => {
      const pending = readPendingChangeJump();
      if (pending && pending.path === stop.path && currentFilePath() !== stop.path) {
        clearPendingChangeJump();
        console.warn(`${LOG} ADO tree row did not activate changed file ${stop.path}`, fileTarget);
        showErrorToast(`ADO did not open ${stop.path}; expand its folder in the file tree and retry.`);
      }
    }, 2000);
    return true;
  }

  function updateActiveSidebarChange() {
    if (!sidebarPanel || sidebarState?.visible === false || sidebarChangeStops.length === 0) return;
    if (Date.now() < sidebarFollowSuppressedUntil) return;
    const activePath = currentFilePathCached;
    if (!activePath) return;
    const scroller = getOutlineScrollContainer();
    const activeLine = (scroller === window ? 0 : scroller.getBoundingClientRect().top) + OUTLINE_ACTIVE_OFFSET;
    let bestIndex = -1;
    let bestY = -Infinity;
    sidebarChangeStops.forEach((stop, index) => {
      if (!stop || stop.path !== activePath || stop.lifecycle === 'delete') return;
      const block = resolveCurrentChangeBlock(stop);
      if (!block) return;
      const y = block.getBoundingClientRect().top;
      if (y <= activeLine && y > bestY) {
        bestIndex = index;
        bestY = y;
      }
    });
    if (bestIndex < 0) {
      bestIndex = sidebarChangeStops.findIndex((stop) =>
        stop && stop.path === activePath && stop.lifecycle !== 'delete'
      );
    }
    if (bestIndex >= 0) setActiveSidebarChange(bestIndex, true);
  }

  function renderOutlineRows() {
    if (!outlinePanel) return;
    const body = outlinePanel.querySelector('.adrc-outline-body');
    if (!body) return;
    body.innerHTML = '';
    const fileOrder = getPrOutlineFileOrder();
    const entries = fileOrder.map((path) => prOutlineCatalog.get(path)).filter(Boolean);
    const allHeadings = entries.flatMap((entry) => entry.headings || []);
    const count = outlinePanel.querySelector('[data-count="outline"]');
    if (count) count.textContent = String(allHeadings.length);

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'adrc-outline-empty';
      if (prOutlineStatus === 'loading') empty.textContent = 'Loading pull request outline\u2026';
      else if (prOutlineStatus === 'error') empty.textContent = `Outline unavailable: ${prOutlineError}`;
      else empty.textContent = 'No Markdown headings in this pull request.';
      body.appendChild(empty);
      return;
    }

    const GRDC = window.GRDC || {};
    const rawCounts = typeof GRDC.attributeThreadsToHeadings === 'function'
      ? GRDC.attributeThreadsToHeadings(allHeadings, sidebarThreadItems)
      : new Map();
    const countsByKey = new Map();
    rawCounts.forEach((value, heading) => countsByKey.set(heading.key || heading.id, value));
    const activePath = currentFilePath() || currentFilePathCached;

    entries.forEach((entry) => {
      const fileButton = document.createElement('button');
      fileButton.type = 'button';
      fileButton.className = 'adrc-outline-file';
      fileButton.dataset.path = entry.path;
      if (entry.path === activePath) fileButton.classList.add('adrc-outline-file-current');
      const fileText = document.createElement('span');
      fileText.className = 'adrc-outline-file-text';
      fileText.textContent = entry.path.replace(/^\//, '') || entry.path;
      fileButton.appendChild(fileText);
      if (entry.status === 'deleted' || entry.status === 'error' || entry.status === 'empty') {
        const badge = document.createElement('span');
        badge.className = `adrc-outline-file-badge adrc-outline-file-badge-${entry.status}`;
        badge.textContent = entry.status === 'deleted'
          ? 'DELETED'
          : entry.status === 'error' ? 'UNAVAILABLE' : 'NO HEADINGS';
        fileButton.appendChild(badge);
      }
      fileButton.title = entry.path;
      fileButton.addEventListener('click', () => navigateToOutlineTarget({
        path: entry.path,
        key: entry.headings?.[0]?.key || null,
        lifecycle: entry.lifecycle,
        status: entry.status
      }));
      body.appendChild(fileButton);

      if (entry.status !== 'ready' || !entry.headings?.length) {
        const state = document.createElement('div');
        state.className = 'adrc-outline-file-state';
        if (entry.status === 'deleted') state.textContent = 'Deleted file — no Preview outline.';
        else if (entry.status === 'error') state.textContent = entry.error || 'Could not load headings.';
        else state.textContent = 'No headings in this file.';
        body.appendChild(state);
        return;
      }

      const tree = typeof GRDC.buildOutlineTree === 'function'
        ? GRDC.buildOutlineTree(entry.headings)
        : entry.headings.map((heading) => ({ ...heading, children: [] }));

      function renderNode(node, indent) {
        const key = node.key || node.id;
        const collapsed = outlineCollapsedKeys.has(key);
        const row = document.createElement('div');
        row.className = `adrc-outline-row adrc-outline-level-${node.level}`;
        if (key === outlineActiveId) row.classList.add('adrc-outline-active');
        row.style.paddingLeft = `${8 + indent * 14}px`;
        row.dataset.headingId = key;
        row.dataset.path = entry.path;

        const chevron = document.createElement('button');
        chevron.type = 'button';
        chevron.className = 'adrc-outline-chevron';
        chevron.textContent = collapsed ? '\u25b8' : '\u25be';
        chevron.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} section ${node.text}`);
        chevron.setAttribute('aria-expanded', String(!collapsed));
        chevron.addEventListener('click', (event) => {
          event.stopPropagation();
          setOutlineHeadingCollapsed(node, !outlineCollapsedKeys.has(key));
        });

        const label = document.createElement('button');
        label.type = 'button';
        label.className = 'adrc-outline-label';
        label.title = `${entry.path}:${node.line} — ${node.text}`;
        const text = document.createElement('span');
        text.className = 'adrc-outline-text';
        text.textContent = node.text;
        label.appendChild(text);
        const threadCount = countsByKey.get(key) || 0;
        if (threadCount > 0) {
          const pill = document.createElement('span');
          pill.className = 'adrc-outline-thread-count';
          pill.textContent = `${threadCount} \ud83d\udcac`;
          label.appendChild(pill);
        }
        label.addEventListener('click', () => navigateToOutlineTarget({
          path: entry.path,
          key,
          lifecycle: entry.lifecycle,
          status: entry.status
        }));

        row.append(chevron, label);
        body.appendChild(row);
        if (!collapsed) {
          (node.children || []).forEach((child) => renderNode(child, indent + 1));
        }
      }

      tree.forEach((node) => renderNode(node, 0));
    });
    updateActiveOutline();
  }

  function resolveLiveOutlineHeading(key) {
    if (!key) return null;
    return outlineHeadings.find((heading) => heading.key === key && heading.el?.isConnected) || null;
  }

  function setOutlineHeadingCollapsed(heading, collapsed) {
    const key = heading && (heading.key || heading.id);
    if (!key) return;
    if (collapsed) outlineCollapsedKeys.add(key);
    else outlineCollapsedKeys.delete(key);

    const live = resolveLiveOutlineHeading(key);
    if (live) {
      const toggle = ensureCollapseToggle(live.el);
      if (collapsed) collapsedHeadings.add(live.el);
      else collapsedHeadings.delete(live.el);
      if (toggle) applyCollapseVisuals(live.el, toggle, collapsed);
    }
    renderOutlineRows();
  }

  function foldOutlineAtLevel(level) {
    if (!Number.isFinite(level)) return;
    const path = currentFilePathCached;
    const entry = path && prOutlineCatalog.get(path);
    if (!entry) return;
    (entry.headings || []).forEach((heading) => {
      if (heading.level !== level) return;
      outlineCollapsedKeys.add(heading.key || heading.id);
      const live = resolveLiveOutlineHeading(heading.key || heading.id);
      if (!live) return;
      collapsedHeadings.add(live.el);
      const toggle = ensureCollapseToggle(live.el);
      if (toggle) applyCollapseVisuals(live.el, toggle, true);
    });
    renderOutlineRows();
  }

  function expandAllOutlineSections() {
    const path = currentFilePathCached;
    const entry = path && prOutlineCatalog.get(path);
    if (!entry) return;
    (entry.headings || []).forEach((heading) => {
      outlineCollapsedKeys.delete(heading.key || heading.id);
      const live = resolveLiveOutlineHeading(heading.key || heading.id);
      if (!live) return;
      collapsedHeadings.delete(live.el);
      const toggle = ensureCollapseToggle(live.el);
      if (toggle) applyCollapseVisuals(live.el, toggle, false);
    });
    renderOutlineRows();
  }

  function scrollToLiveOutlineHeading(heading) {
    if (!heading || !heading.el?.isConnected) return false;
    revealChangedBlock(heading.el);
    outlineActiveId = heading.key || heading.id;
    setActiveOutlineRow(outlineActiveId);
    sidebarFollowSuppressedUntil = Date.now() + 1500;
    return scrollToWithStickyOffset(heading.el);
  }

  function navigateToOutlineTarget(target) {
    if (!target || !target.path) return false;
    if (target.path === currentFilePath() && target.path === currentFilePathCached) {
      clearPendingOutlineJump();
      const live = target.key ? resolveLiveOutlineHeading(target.key) : outlineHeadings[0];
      if (live) return scrollToLiveOutlineHeading(live);
      const preview = getCurrentPreviewContainer();
      return !!(preview && scrollToWithStickyOffset(preview));
    }

    const fileTarget = findBestAdoFileTreeTarget(target.path);
    if (!fileTarget) {
      clearPendingOutlineJump();
      showErrorToast(`Could not find ${target.path} in the visible ADO file tree.`);
      return false;
    }
    if (target.lifecycle === 'delete' || target.status === 'deleted') {
      clearPendingOutlineJump();
      fileTarget.target.click();
      return true;
    }

    savePendingOutlineJump(target);
    fileTarget.target.click();
    setTimeout(continuePendingOutlineNavigation, 100);
    setTimeout(() => {
      const pending = readPendingOutlineJump();
      if (pending && pending.path === target.path && currentFilePath() !== target.path) {
        clearPendingOutlineJump();
        showErrorToast(`ADO did not open ${target.path}; expand its folder in the file tree and retry.`);
      }
    }, 2000);
    return true;
  }

  function setActiveOutlineRow(id) {
    outlineActiveId = id;
    if (!outlinePanel) return;
    outlinePanel.querySelectorAll('.adrc-outline-row.adrc-outline-active')
      .forEach((r) => r.classList.remove('adrc-outline-active'));
    if (!id) return;
    const row = outlinePanel.querySelector(
      `.adrc-outline-row[data-heading-id="${escapeCssValue(id)}"]`
    );
    if (row) {
      row.classList.add('adrc-outline-active');
      // Keep the active row visible in the panel's own scroll container.
      const body = outlinePanel.querySelector('.adrc-outline-body');
      if (body) {
        const rowRect = row.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        if (rowRect.top < bodyRect.top || rowRect.bottom > bodyRect.bottom) {
          row.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
      }
    }
  }

  function pickActiveHeading() {
    // The active reading line sits below the container top. Choose the
    // heading whose top is closest to (but not below) that line. Uses
    // viewport-relative coordinates because getBoundingClientRect() is
    // viewport-relative regardless of what element is scrolling.
    const container = getOutlineScrollContainer();
    const topOfScrollArea = container === window
      ? 0
      : container.getBoundingClientRect().top;
    const activeLine = topOfScrollArea + OUTLINE_ACTIVE_OFFSET;
    let best = null;
    let bestY = -Infinity;
    for (const h of outlineHeadings) {
      const y = h.el.getBoundingClientRect().top;
      if (y <= activeLine && y > bestY) {
        bestY = y;
        best = h;
      }
    }
    if (!best && outlineHeadings.length > 0) best = outlineHeadings[0];
    return best;
  }

  function updateActiveOutline() {
    outlineScrollRaf = null;
    if (!outlineIsVisible()) return;
    if (Date.now() < sidebarFollowSuppressedUntil) return;
    const active = pickActiveHeading();
    setActiveOutlineRow(active ? active.id : null);
  }

  function onOutlineScroll() {
    if (outlineScrollRaf) return;
    outlineScrollRaf = requestAnimationFrame(() => {
      updateActiveOutline();
      updateActiveSidebarThread();
      updateActiveSidebarChange();
    });
  }

  function attachOutlineScrollListener() {
    const container = getOutlineScrollContainer();
    if (outlineScrollListenerTarget === container) return;
    detachOutlineScrollListener();
    // Listen on BOTH the detected container AND window — harmless
    // duplication when they're the same target, and defensive if ADO's
    // layout ever changes so that scroll events bubble to window instead.
    container.addEventListener('scroll', onOutlineScroll, { passive: true });
    if (container !== window) {
      window.addEventListener('scroll', onOutlineScroll, { passive: true });
    }
    outlineScrollListenerTarget = container;
  }

  function detachOutlineScrollListener() {
    const container = outlineScrollListenerTarget;
    if (container) {
      container.removeEventListener('scroll', onOutlineScroll);
      if (container !== window) {
        window.removeEventListener('scroll', onOutlineScroll);
      }
    }
    outlineScrollListenerTarget = null;
    if (outlineScrollRaf) {
      cancelAnimationFrame(outlineScrollRaf);
      outlineScrollRaf = null;
    }
  }

  /**
   * Rebuild the outline from the current preview's headings. Called after
   * init (button attachment finished) and whenever the file changes.
   * Idempotent when the panel is hidden — it just refreshes the internal
   * heading list so a subsequent show is instant.
   */
  function refreshOutline() {
    outlineHeadings = collectHeadingsForOutline();
    outlineHeadings.forEach((heading) => {
      const collapsed = outlineCollapsedKeys.has(heading.key);
      if (collapsed) collapsedHeadings.add(heading.el);
      else collapsedHeadings.delete(heading.el);
      const toggle = ensureCollapseToggle(heading.el);
      if (toggle) applyCollapseVisuals(heading.el, toggle, collapsed);
    });
    syncCurrentFileOutlineSnapshot();
    renderOutlineRows();
    updateActiveOutline();
    ensurePrOutlineCatalog().then(() => {
      syncCurrentFileOutlineSnapshot();
      renderOutlineRows();
      resumePendingOutlineJump(0);
    });
  }

  function showOutlinePanel() {
    showSidebar('outline');
  }

  function hideOutlinePanel() {
    hideSidebar();
  }

  function toggleOutlinePanel() {
    if (outlineIsVisible()) hideOutlinePanel();
    else showOutlinePanel();
  }

  function isShortcutTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  // Global navigation shortcuts. Capture phase matches the GitHub target and
  // runs before ADO page handlers; modifiers and typing targets always pass
  // through. Empty thread/change lists also pass through without swallowing
  // the key.
  document.addEventListener('keydown', (e) => {
    if (isShortcutTypingTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key.toLowerCase() === 't' && e.shiftKey) {
      e.preventDefault();
      resetSidebarLayout();
      return;
    }
    if (e.key === 't' && !e.shiftKey) {
      e.preventDefault();
      toggleSidebarCollapsed();
      return;
    }
    if (e.key === 'b' && !e.shiftKey) {
      e.preventDefault();
      showOutlinePanel();
      return;
    }
    if (!e.shiftKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
      e.preventDefault();
      const tab = e.key === '1' ? 'changes' : e.key === '2' ? 'threads' : 'outline';
      showSidebar(tab);
      return;
    }

    let handled = false;
    if (e.key === 'j' && !e.shiftKey) handled = jumpSidebarThread(1);
    else if (e.key === 'k' && !e.shiftKey) handled = jumpSidebarThread(-1);
    else if (e.key === 'h' && !e.shiftKey) handled = jumpSidebarThreadBoundary(false);
    else if (e.key === 'l' && !e.shiftKey) handled = jumpSidebarThreadBoundary(true);
    else if (e.key === ']' && !e.shiftKey) handled = jumpSidebarChange(1);
    else if (e.key === '[' && !e.shiftKey) handled = jumpSidebarChange(-1);
    else if (e.key === '}' || (e.code === 'BracketRight' && e.shiftKey)) {
      handled = jumpSidebarChangeBoundary(true);
    } else if (e.key === '{' || (e.code === 'BracketLeft' && e.shiftKey)) {
      handled = jumpSidebarChangeBoundary(false);
    }
    if (handled) e.preventDefault();
  }, true);

  /**
   * Remove injected UI and stale per-file state before initializing a new
   * SPA file/view. ADO commonly keeps the preview element itself while
   * replacing its children, so this cleanup must not rely on node removal.
  * The floating Changes + Threads + Outline sidebar is intentionally preserved.
   */
  function resetPreviewContext(container, routeKey) {
    initGeneration++;
    initInFlight = null;
    detachOutlineScrollListener();
    outlineScrollContainer = null;

    document.querySelectorAll(
      '.adrc-comment-btn, .adrc-editor, .adrc-thread-badge, .adrc-thread-panel, .adrc-collapse-toggle'
    ).forEach((el) => el.remove());

    document.querySelectorAll('[data-adrc-has-button]').forEach((el) => {
      delete el.dataset.adrcHasButton;
      delete el.dataset.adrcLine;
      delete el.dataset.adrcPath;
      delete el.dataset.adrcOutlineKey;
    });
    document.querySelectorAll(
      '.adrc-hoverable, .adrc-collapsible, .adrc-section-collapsed, .adrc-collapsed-hidden, .adrc-range-permanent, .adrc-range-hover'
    ).forEach((el) => {
      el.classList.remove(
        'adrc-hoverable',
        'adrc-collapsible',
        'adrc-section-collapsed',
        'adrc-collapsed-hidden',
        'adrc-range-permanent',
        'adrc-range-hover'
      );
    });

    currentPreviewContainerCached = container;
    currentPreviewRouteKeyCached = routeKey;
    currentFilePathCached = null;
    currentLineToBlock = new Map();
    currentBlockInfo = new Map();
    currentSource = null;
    collapsedHeadings = new WeakSet();
    outlineHeadings = [];
    outlineActiveId = null;
    sidebarActiveThreadId = null;
    renderOutlineRows();
    renderThreadsSidebar();
    renderChangesSidebar();

    if (container) {
      delete container.dataset.adrcInitialized;
      delete container.dataset.adrcInitializing;
    }
  }

  // ── Init flow ────────────────────────────────────────────────────────

  async function initButtonsForCurrentPreview() {
    const container = getCurrentPreviewContainer();
    if (!container) return;
    // Wait until ADO has actually filled the container. On a fresh load
    // the div appears empty before the markdown renders.
    if ((container.textContent || '').trim().length === 0) return;

    const filePath = currentFilePath();
    if (!filePath) {
      console.log(`${LOG} preview visible but no ?path= in URL — skipping button attachment`);
      return;
    }

    const routeKey = currentPreviewRouteKey();
    const contextChanged =
      container !== currentPreviewContainerCached ||
      routeKey !== currentPreviewRouteKeyCached;

    if (contextChanged) {
      resetPreviewContext(container, routeKey);
    }

    // ADO sometimes replaces only the preview's children while preserving
    // both route and container. Our injected button marker disappears in
    // that case, which is the signal to rebuild against the new children.
    const hasCommentableContent = !!container.querySelector('p, h1, h2, h3, h4, h5, h6, li, tr, pre');
    const hasInjectedButton = !!container.querySelector('[data-adrc-has-button]');
    if (container.dataset.adrcInitialized === routeKey && hasCommentableContent && !hasInjectedButton) {
      resetPreviewContext(container, routeKey);
    }

    if (container.dataset.adrcInitialized === routeKey && currentFilePathCached === filePath) {
      // The outline rows can be rebuilt independently if another ADO
      // component replaced heading nodes without replacing the preview.
      const outlineIsStale = outlineHeadings.some((h) => !h.el.isConnected || !container.contains(h.el));
      if (outlineIsStale) refreshOutline();
      if (outlineIsVisible()) attachOutlineScrollListener();
      if (sidebarChangesStatus === 'idle' || sidebarChangesStatus === 'error') refreshChangesSidebar();
      else updateActiveSidebarChange();
      resumePendingChangeJump(0);
      return;
    }

    if (initInFlight && initInFlight.container === container && initInFlight.routeKey === routeKey) {
      return;
    }

    const generation = ++initGeneration;
    initInFlight = { container, routeKey, generation };
    container.dataset.adrcInitializing = routeKey;
    try {
      const { map, source } = await buildFileLineMap(container, filePath);

      // Ignore stale async work if the user switched files while source or
      // PR metadata was being fetched. Also reject maps whose DOM elements
      // were replaced during the fetch; schedule a clean retry instead.
      const mappedBlocks = Array.from(map.keys());
      const stillCurrent =
        generation === initGeneration &&
        routeKey === currentPreviewRouteKey() &&
        container === getCurrentPreviewContainer();
      const mapStillConnected = mappedBlocks.every((block) => block.isConnected && container.contains(block));
      if (!stillCurrent || !mapStillConnected) {
        schedulePreviewInit(100);
        return;
      }

      let attached = 0;
      currentSource = source;
      currentBlockInfo = new Map(map);
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
      container.dataset.adrcInitialized = routeKey;
      console.log(`${LOG} Initialized: ${attached} commentable blocks in ${filePath}`);
      // The sidebar survives route changes; only its per-file Outline and
      // current-file ordering are rebuilt here.
      buildSidebarPanel();
      refreshOutline();
      renderThreadsSidebar();
      refreshChangesSidebar();
      // Fire-and-forget — thread badge rendering shouldn't block the +
      // buttons showing up, and any error is already logged.
      refreshThreadBadges();
    } catch (err) {
      if (generation === initGeneration) {
        console.error(`${LOG} init failed for ${filePath}:`, err);
        delete container.dataset.adrcInitialized;
      }
    } finally {
      if (initInFlight && initInFlight.generation === generation) {
        initInFlight = null;
      }
      if (container.dataset.adrcInitializing === routeKey) {
        delete container.dataset.adrcInitializing;
      }
    }
  }

  // SPA navigation handling: watch both DOM mutations and the route key.
  // ADO sometimes changes `?path=` with history.replaceState before any
  // preview DOM mutation, and sometimes reuses the same preview element.
  let debounceTimer = null;
  function schedulePreviewInit(delay) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      initButtonsForCurrentPreview();
    }, typeof delay === 'number' ? delay : 250);
  }

  const mo = new MutationObserver((records) => {
    const relevant = records.some((record) => {
      const target = record.target && record.target.nodeType === 1 ? record.target : null;
      if (target && target.closest('.adrc-sidebar, .adrc-sidebar-launcher')) return false;
      const changed = [...record.addedNodes, ...record.removedNodes];
      if (changed.length === 0) return false;
      return changed.some((node) => {
        if (node.nodeType !== 1) return true;
        return !isOurInjectedNode(node);
      });
    });
    if (relevant) schedulePreviewInit(250);
  });
  mo.observe(document.body, { childList: true, subtree: true });

  let observedRouteKey = currentPreviewRouteKey();
  setInterval(() => {
    continuePendingThreadNavigation();
    continuePendingChangeNavigation();
    continuePendingOutlineNavigation();
    const nextRouteKey = currentPreviewRouteKey();
    if (nextRouteKey === observedRouteKey) return;
    observedRouteKey = nextRouteKey;
    renderChangesSidebar();
    renderOutlineRows();
    updateSidebarNavigation();
    schedulePreviewInit(100);
  }, 250);

  // Also try once shortly after load in case the preview is already there.
  schedulePreviewInit(500);

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
      const container = getCurrentPreviewContainer();
      if (!container) {
        throw new Error('probe.detectLines: no .markdown-preview-container in the DOM — switch the file to "Preview" mode');
      }
      const { map } = await buildFileLineMap(container, filePath);
      const summary = [];
      map.forEach((info, el) => {
        summary.push({ tag: el.tagName, line: info.line, snippet: (el.textContent || '').trim().slice(0, 60) });
      });
      console.log(`${LOG} detectLines(${filePath}): ${summary.length} blocks mapped`);
      console.table(summary);
      return summary;
    },

    // Inspect / toggle the Outline tab inside the combined sidebar.
    outline(action) {
      if (action === 'toggle') { toggleOutlinePanel(); return outlineIsVisible(); }
      if (action === 'show')   { showOutlinePanel();   return outlineIsVisible(); }
      if (action === 'hide')   { hideOutlinePanel();   return outlineIsVisible(); }
      if (action === 'refresh') { refreshOutline(); }
      const container = getOutlineScrollContainer();
      const preview = getCurrentPreviewContainer();
      return {
        visible: outlineIsVisible(),
        filePath: currentFilePath(),
        cachedFilePath: currentFilePathCached,
        routeKey: currentPreviewRouteKey(),
        cachedRouteKey: currentPreviewRouteKeyCached,
        previewInitializedFor: preview ? preview.dataset.adrcInitialized || null : null,
        staleHeadingCount: outlineHeadings.filter((h) => !h.el.isConnected || !preview || !preview.contains(h.el)).length,
        headings: outlineHeadings.map((h) => ({ level: h.level, text: h.text })),
        status: prOutlineStatus,
        error: prOutlineError || null,
        fileOrder: getPrOutlineFileOrder(),
        totalHeadingCount: Array.from(prOutlineCatalog.values())
          .reduce((total, entry) => total + (entry.headings || []).length, 0),
        files: getPrOutlineFileOrder().map((path) => {
          const entry = prOutlineCatalog.get(path);
          return entry ? {
            path,
            lifecycle: entry.lifecycle,
            status: entry.status,
            headingCount: (entry.headings || []).length,
            headings: (entry.headings || []).map((heading) => ({
              key: heading.key,
              level: heading.level,
              text: heading.text,
              line: heading.line,
              collapsed: outlineCollapsedKeys.has(heading.key)
            }))
          } : null;
        }).filter(Boolean),
        activeId: outlineActiveId,
        scrollContainer: container === window
          ? 'window'
          : `${container.tagName.toLowerCase()}${container.id ? '#' + container.id : ''}${container.className ? '.' + String(container.className).trim().replace(/\s+/g, '.') : ''}`,
        scrollTop: container === window ? window.scrollY : container.scrollTop,
        scrollHeight: container === window ? document.documentElement.scrollHeight : container.scrollHeight,
        clientHeight: container === window ? window.innerHeight : container.clientHeight
      };
    },

    sidebar(action) {
      buildSidebarPanel();
      if (action === 'show') showSidebar();
      else if (action === 'hide') hideSidebar();
      else if (action === 'threads') showSidebar('threads');
      else if (action === 'outline') showSidebar('outline');
      else if (action === 'collapse') {
        saveSidebarState({ visible: true, collapsed: true });
        applySidebarState();
      } else if (action === 'expand') {
        saveSidebarState({ visible: true, collapsed: false });
        applySidebarState();
      } else if (action === 'filter') {
        saveSidebarState({ unresolvedOnly: !sidebarState.unresolvedOnly });
        updateSidebarFilterUI();
        renderThreadsSidebar();
      }
      return {
        state: Object.assign({}, sidebarState),
        threadCount: sidebarThreadItems.length,
        visibleThreadCount: getVisibleSidebarThreads().length,
        activeThreadId: sidebarActiveThreadId,
        changesStatus: sidebarChangesStatus,
        changeCount: sidebarChangeStops.length,
        changedMarkdownFileCount: prMarkdownChanges.length,
        changesIterationId: prChangesIterationId,
        activeChangeIndex: sidebarActiveChangeIndex,
        outlineStatus: prOutlineStatus,
        outlineFileCount: prOutlineCatalog.size,
        outlineCount: Array.from(prOutlineCatalog.values())
          .reduce((total, entry) => total + (entry.headings || []).length, 0),
        currentFile: currentFilePathCached
      };
    },

    changes(index) {
      if (Number.isFinite(index)) navigateToSidebarChange(index);
      return {
        filePath: currentFilePathCached,
        iterationId: prChangesIterationId,
        changedMarkdownFiles: prMarkdownChanges.map((change) => ({
          type: change.type,
          path: change.path,
          oldPath: change.oldPath
        })),
        status: sidebarChangesStatus,
        error: sidebarChangesError || null,
        activeIndex: sidebarActiveChangeIndex,
        lastScroll: lastScrollNavigation ? Object.assign({}, lastScrollNavigation) : null,
        stops: sidebarChangeStops.map((stop, stopIndex) => {
          const block = resolveCurrentChangeBlock(stop);
          const rect = block ? block.getBoundingClientRect() : null;
          return {
            index: stopIndex,
            key: stop.key,
            path: stop.path,
            oldPath: stop.oldPath,
            stopType: stop.stopType,
            lifecycle: stop.lifecycle,
            label: stop.label,
            kind: stop.kind,
            line: stop.line,
            endLine: stop.endLine,
            snippet: buildSidebarChangeSnippet(stop),
            tag: block ? block.tagName : null,
            display: block ? getComputedStyle(block).display : null,
            rect: rect ? { top: rect.top, width: rect.width, height: rect.height } : null,
            collapsed: !!(block && (
              block.classList.contains('adrc-collapsed-hidden') ||
              block.closest('.adrc-collapsed-hidden')
            )),
            connected: !!(block && block.isConnected)
          };
        })
      };
    },

    viewMode() {
      const controls = findAdoViewModeControls();
      const options = getVisibleAdoModeMenuOptions();
      return {
        previewVisible: hasVisibleMarkdownPreview(),
        currentMode: controls ? getAdoViewModeLabel(controls.modeButton) : null,
        currentModeLabels: controls ? getAdoControlLabels(controls.modeButton) : [],
        modeButtonClass: controls ? controls.modeButton.className : null,
        triggerLabel: controls ? normalizedControlText(controls.trigger) : null,
        triggerClass: controls ? controls.trigger.className : null,
        visibleMenuOptions: options.map((option) => ({
          mode: getAdoViewModeLabel(option),
          labels: getAdoControlLabels(option),
          role: option.getAttribute('role'),
          className: option.className
        })),
        restore: Object.assign({}, previewRestoreState),
        pendingThreadJump: readPendingThreadJump(),
        pendingChangeJump: readPendingChangeJump(),
        pendingOutlineJump: readPendingOutlineJump()
      };
    },

    theme() {
      const root = getComputedStyle(document.documentElement);
      const host = getComputedStyle(document.body);
      const sidebar = document.querySelector('.adrc-sidebar');
      const panel = document.querySelector('.adrc-thread-panel');
      const editor = document.querySelector('.adrc-editor');
      const read = (style, name) => style ? style.getPropertyValue(name).trim() : '';
      const hostTokens = [
        '--background-color',
        '--text-primary-color',
        '--text-secondary-color',
        '--border-subtle-color',
        '--communication-background',
        '--status-error-text',
        '--status-success-text',
        '--status-warning-text',
        '--focus-border-color'
      ].reduce((out, name) => {
        out[name] = read(host, name) || read(root, name) || null;
        return out;
      }, {});
      const inspect = (element) => {
        if (!element) return null;
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          color: style.color,
          border: style.borderColor,
          outline: style.outlineColor,
          forcedColorAdjust: style.forcedColorAdjust
        };
      };
      const snapshot = {
        darkPreference: matchMedia('(prefers-color-scheme: dark)').matches,
        forcedColors: matchMedia('(forced-colors: active)').matches,
        hostTokens,
        sidebar: inspect(sidebar),
        threadPanel: inspect(panel),
        editor: inspect(editor)
      };
      console.table(hostTokens);
      console.log(`${LOG} theme snapshot:`, snapshot);
      return snapshot;
    },

    fileTargets(path) {
      const targetPath = path || currentFilePath();
      return getAdoFileTreeCandidates(targetPath).map((candidate) => ({
        path: targetPath,
        score: candidate.score,
        rowTag: candidate.row.tagName,
        rowRole: candidate.row.getAttribute('role'),
        rowId: candidate.row.id,
        rowClass: candidate.row.className,
        targetTag: candidate.target.tagName,
        targetClass: candidate.target.className,
        labels: candidate.labels
      }));
    },

    // Diagnose a code block: source-range vs DOM-row geometry.
    // Call `ADORC_probe.codeBlock(N)` where N is a 0-based index of the
    // <pre> in the current preview (or omit to use the first).
    codeBlock(index) {
      const idx = typeof index === 'number' ? index : 0;
      const preview = getCurrentPreviewContainer();
      const pres = preview ? Array.from(preview.querySelectorAll('pre')) : [];
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
      const container = getCurrentPreviewContainer();
      resetPreviewContext(container, currentPreviewRouteKey());
      await initButtonsForCurrentPreview();
    }
  };

  console.log(`${LOG} DevTools probe available: ADORC_probe (try 'await ADORC_probe.list()' or 'await ADORC_probe.reinit()')`);
})();
