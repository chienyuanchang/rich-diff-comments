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

  // ── Comment box (compose new thread) ─────────────────────────────────

  function openCommentBox(block, info) {
    // Only one compose editor open at a time.
    document.querySelectorAll('.adrc-editor.adrc-compose-editor').forEach(el => el.remove());

    const { editor, textarea } = createEditor({
      submitLabel: 'Comment',
      placeholder: 'Write your comment (Markdown supported). Ctrl+Enter to submit.',
      minRows: 3,
      onSubmit: async (content) => {
        await adapter.resolveIds(ctx);
        const thread = await adapter.createThread(ctx, {
          content,
          line: info.line,
          filePath: info.path
        });
        console.log(`${LOG} thread posted: id=${thread.id} on ${info.path}:${info.line}`);
        editor.remove();
        await refreshThreadBadges();
      }
    });
    editor.classList.add('adrc-compose-editor');

    const header = document.createElement('div');
    header.className = 'adrc-editor-header';
    header.innerHTML = `Comment on <strong>${escapeHtml(info.path + ':' + info.line)}</strong>`;
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
    const meta = `<div class="adrc-thread-comment-meta"><span class="adrc-thread-comment-author">${author}</span> · ${time}${edited}</div>`;

    if (c.isDeleted) {
      return `<div class="adrc-thread-comment" data-comment-id="${c.id}">${meta}<div class="adrc-thread-comment-body adrc-thread-comment-deleted">(This comment was deleted.)</div></div>`;
    }

    // Render comment content as markdown so **bold**, code, lists, links
    // render like they do in the actual review.
    const bodyHtml = renderMarkdown(c.content || '');

    // Edit / Delete affordances appear only on the current user's own
    // undeleted comments.
    const ownActions = isOwnComment(c)
      ? `<div class="adrc-comment-inline-actions">
           <button type="button" class="adrc-comment-inline-btn adrc-edit-comment" data-comment-id="${c.id}">Edit</button>
           <button type="button" class="adrc-comment-inline-btn adrc-delete-comment" data-comment-id="${c.id}">Delete</button>
         </div>`
      : '';

    return `<div class="adrc-thread-comment" data-comment-id="${c.id}">${meta}<div class="adrc-thread-comment-body">${bodyHtml}</div>${ownActions}</div>`;
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
   * Delete the given comment after a confirm() prompt. On success,
   * refreshes badges so the soft-deleted comment renders as such.
   */
  async function deleteCommentAction(thread, comment, btn) {
    if (!confirm('Delete this comment? (The comment will be marked as deleted; the thread stays.)')) return;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    try {
      await adapter.resolveIds(ctx);
      await adapter.deleteComment(ctx, thread.id, comment.id);
      console.log(`${LOG} deleted comment ${thread.id}/${comment.id}`);
      await refreshThreadBadges();
    } catch (err) {
      console.error(`${LOG} deleteComment failed:`, err);
      btn.disabled = false;
      btn.textContent = originalText;
      alert('Delete failed: ' + String(err.message || err).slice(0, 200));
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

    parent.parentNode.insertBefore(badge, parent.nextSibling);

    // Unresolved threads auto-expand so reviewers immediately see what
    // needs attention. Resolved threads stay collapsed as a compact
    // badge; clicking expands them on demand.
    let panel = null;
    if (thread.status !== 'fixed') {
      panel = buildThreadPanel(thread);
      badge.parentNode.insertBefore(panel, badge.nextSibling);
    }

    badge.addEventListener('click', () => {
      if (panel && panel.parentNode) {
        panel.remove();
        panel = null;
        return;
      }
      panel = buildThreadPanel(thread);
      badge.parentNode.insertBefore(panel, badge.nextSibling);
    });
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
