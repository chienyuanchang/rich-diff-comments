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
   */
  async function buildFileLineMap(container, filePath) {
    await adapter.resolveIds(ctx);
    const branch = await getSourceBranch();
    const source = await adapter.getFileSource(ctx, filePath, { version: branch, versionType: 'branch' });
    const sourceLines = source.split('\n');

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

  function attachCommentButton(block, info) {
    if (block.dataset.adrcHasButton) return;
    block.dataset.adrcHasButton = '1';
    block.classList.add('adrc-hoverable');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'adrc-comment-btn';
    btn.title = `Comment on ${info.path}:${info.line}`;
    btn.setAttribute('aria-label', btn.title);
    btn.innerHTML = PLUS_SVG;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCommentBox(block, info);
    });

    // <tr> can't host a button directly (invalid HTML); anchor to its
    // first cell instead. Everything else hosts naturally.
    const GRDC = window.GRDC || {};
    const host = (typeof GRDC.buttonAnchor === 'function' ? GRDC.buttonAnchor(block) : block) || block;
    host.appendChild(btn);
  }

  // ── Comment box ──────────────────────────────────────────────────────

  function openCommentBox(block, info) {
    // Only one box open at a time.
    document.querySelectorAll('.adrc-comment-box').forEach(el => el.remove());

    const box = document.createElement('div');
    box.className = 'adrc-comment-box';
    box.innerHTML = [
      '<div class="adrc-comment-box-header">',
      '  Comment on <strong></strong>',
      '</div>',
      '<textarea class="adrc-comment-input" rows="3" placeholder="Write your comment (Markdown supported). Ctrl+Enter to submit."></textarea>',
      '<div class="adrc-comment-box-actions">',
      '  <button type="button" class="adrc-comment-cancel">Cancel</button>',
      '  <button type="button" class="adrc-comment-submit">Comment</button>',
      '</div>'
    ].join('\n');
    box.querySelector('strong').textContent = `${info.path}:${info.line}`;

    // Insert after the block so the box appears directly below the
    // context it's commenting on. For <tr> blocks, insert after the
    // parent <table> instead so the box doesn't break table layout.
    const parent = block.tagName === 'TR' ? (block.closest('table') || block) : block;
    parent.parentNode.insertBefore(box, parent.nextSibling);

    const textarea = box.querySelector('.adrc-comment-input');
    const submitBtn = box.querySelector('.adrc-comment-submit');
    const cancelBtn = box.querySelector('.adrc-comment-cancel');

    textarea.focus();

    cancelBtn.addEventListener('click', () => box.remove());

    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submitBtn.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        box.remove();
      }
    });

    submitBtn.addEventListener('click', async () => {
      const content = textarea.value.trim();
      if (!content) {
        textarea.focus();
        return;
      }
      const oldError = box.querySelector('.adrc-comment-error');
      if (oldError) oldError.remove();

      submitBtn.disabled = true;
      submitBtn.textContent = 'Posting…';

      try {
        await adapter.resolveIds(ctx);
        const thread = await adapter.createThread(ctx, {
          content,
          line: info.line,
          filePath: info.path
        });
        console.log(`${LOG} thread posted: id=${thread.id} on ${info.path}:${info.line}`);
        box.remove();
        // Refresh badges so the new thread appears inline right away.
        await refreshThreadBadges();
      } catch (err) {
        console.error(`${LOG} createThread failed:`, err);
        const actions = box.querySelector('.adrc-comment-box-actions');
        const errNode = document.createElement('span');
        errNode.className = 'adrc-comment-error';
        errNode.textContent = String(err.message || err).slice(0, 200);
        actions.insertBefore(errNode, actions.firstChild);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Comment';
      }
    });
  }

  // ── Existing-thread rendering (💬 badge + expandable panel) ──────────

  // Cached per-file so we can rebuild badges without re-running lineMap.
  let currentLineToBlock = new Map();
  let currentFilePathCached = null;

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function formatTime(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(); } catch (_) { return iso; }
  }

  function renderCommentHtml(c) {
    const author = escapeHtml((c.author && c.author.displayName) || 'Unknown');
    const time = escapeHtml(formatTime(c.publishedDate));
    const edited = c.lastContentUpdatedDate && c.lastContentUpdatedDate !== c.publishedDate ? ' (edited)' : '';
    const meta = `<div class="adrc-thread-comment-meta"><span class="adrc-thread-comment-author">${author}</span> · ${time}${edited}</div>`;
    if (c.isDeleted) {
      return `<div class="adrc-thread-comment">${meta}<div class="adrc-thread-comment-body adrc-thread-comment-deleted">(This comment was deleted.)</div></div>`;
    }
    return `<div class="adrc-thread-comment">${meta}<div class="adrc-thread-comment-body">${escapeHtml(c.content || '')}</div></div>`;
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
    panel.innerHTML = header + comments;
    return panel;
  }

  function renderThreadBadge(block, thread) {
    const parent = block.tagName === 'TR' ? (block.closest('table') || block) : block;
    if (!parent || !parent.parentNode) return;

    // Prevent duplicates on re-render — remove any prior badge for this thread.
    const existing = document.querySelector(`.adrc-thread-badge[data-thread-id="${thread.id}"]`);
    if (existing) existing.remove();
    const existingPanel = document.querySelector(`.adrc-thread-panel[data-thread-id="${thread.id}"]`);
    if (existingPanel) existingPanel.remove();

    const visibleCount = (thread.comments || []).filter(c => !c.isDeleted).length;
    const statusSuffix = thread.status === 'fixed'
      ? ' <span class="adrc-thread-status">· ✓ resolved</span>'
      : '';

    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'adrc-thread-badge';
    badge.dataset.threadId = thread.id;
    badge.dataset.status = thread.status;
    badge.innerHTML = `💬 ${visibleCount} comment${visibleCount !== 1 ? 's' : ''}${statusSuffix}`;

    let panel = null;
    badge.addEventListener('click', () => {
      if (panel && panel.parentNode) {
        panel.remove();
        panel = null;
        return;
      }
      panel = buildThreadPanel(thread);
      badge.parentNode.insertBefore(panel, badge.nextSibling);
    });

    parent.parentNode.insertBefore(badge, parent.nextSibling);
  }

  /**
   * Fetch threads for the current PR + file and render inline badges.
   * Called during init and after posting a new comment.
   */
  async function refreshThreadBadges() {
    if (!currentFilePathCached) return;

    // Clear any prior badges/panels — safe to re-render from scratch.
    document.querySelectorAll('.adrc-thread-badge, .adrc-thread-panel').forEach(el => el.remove());

    let data;
    try {
      data = await adapter.listThreads(ctx);
    } catch (err) {
      console.error(`${LOG} refreshThreadBadges: listThreads failed:`, err);
      return;
    }

    const threads = (data && data.value) || [];
    let rendered = 0;
    threads.forEach(thread => {
      if (adapter.isSystemThread(thread)) return;
      const tc = thread.threadContext;
      if (!tc || tc.filePath !== currentFilePathCached) return;
      if (!tc.rightFileStart || typeof tc.rightFileStart.line !== 'number') return;

      const block = currentLineToBlock.get(tc.rightFileStart.line);
      if (!block) return;

      renderThreadBadge(block, thread);
      rendered++;
    });
    console.log(`${LOG} rendered ${rendered} thread badge${rendered !== 1 ? 's' : ''} for ${currentFilePathCached}`);
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

    /**
     * Re-run the button-attachment + thread-badge pass. Handy while
     * iterating without having to reload the page. Clears the
     * initialization guard and all injected elements first.
     */
    async reinit() {
      const container = document.querySelector('.markdown-preview-container');
      if (container) delete container.dataset.adrcInitialized;
      document.querySelectorAll('.adrc-comment-btn, .adrc-comment-box, .adrc-thread-badge, .adrc-thread-panel').forEach(el => el.remove());
      document.querySelectorAll('[data-adrc-has-button]').forEach(el => {
        delete el.dataset.adrcHasButton;
        el.classList.remove('adrc-hoverable');
      });
      await initButtonsForCurrentPreview();
    }
  };

  console.log(`${LOG} DevTools probe available: ADORC_probe (try 'await ADORC_probe.list()' or 'await ADORC_probe.reinit()')`);
})();
