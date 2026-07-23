/**
 * Markdown PR Comments for Azure DevOps
 *
 * v0.0.1 — skeleton. No UI yet; just parses the PR context, resolves
 * the repo GUID, and exposes the adapter on `window.ADORC_probe` so
 * you can exercise the API from DevTools before we wire up buttons.
 *
 * The pure adapter code lives in `src/adapters/ado.js` (source of
 * truth at repo root, mirrored into this folder by `scripts/dev-sync.ps1`).
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

  // ── Route detection ────────────────────────────────────────────────────
  //
  // ADO's PR page is an SPA. The URL matches the manifest pattern so the
  // content script runs on load, but subsequent nav (Overview <-> Files,
  // switching PRs) happens in-page. For v0.0.1 we only handle initial
  // load — SPA nav will be a follow-up (§11.D in the plan).

  const ctx = adapter.parsePRUrl(window.location.pathname);
  if (!ctx) {
    console.log(`${LOG} not a PR page (path=${window.location.pathname}), skipping init`);
    return;
  }
  console.log(`${LOG} parsed PR context:`, ctx);

  // ── DevTools probe API ─────────────────────────────────────────────────
  //
  // While the skeleton has no UI, we expose the adapter on window so it's
  // easy to exercise from the console:
  //
  //   await ADORC_probe.ready()   // resolves the repo GUID
  //   await ADORC_probe.list()    // lists all threads on this PR
  //   await ADORC_probe.create('Hello from probe', 1, '/README.md')
  //   await ADORC_probe.reply(4, 'Hi there')
  //   await ADORC_probe.resolve(4)

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
    }
  };

  console.log(`${LOG} DevTools probe available: ADORC_probe (try 'await ADORC_probe.list()')`);

  // ── DOM smoke test ─────────────────────────────────────────────────────
  //
  // Log whether we can see the Preview container (per plan §11.A, this is
  // the `.markdown-preview-container` element that wraps each rendered
  // file). Just a sanity check for v0.0.1 — the real logic comes when we
  // wire the + button. Retry a few times because the SPA fills content
  // asynchronously.

  let previewChecksLeft = 10;
  function detectPreviewOnce() {
    const nodes = document.querySelectorAll('.markdown-preview-container');
    if (nodes.length > 0) {
      console.log(`${LOG} found ${nodes.length} .markdown-preview-container element(s) on the page`);
      return true;
    }
    if (--previewChecksLeft > 0) {
      setTimeout(detectPreviewOnce, 500);
    } else {
      console.log(`${LOG} no .markdown-preview-container found after 5s — switch the file to "Preview" mode`);
    }
    return false;
  }
  setTimeout(detectPreviewOnce, 500);
})();
