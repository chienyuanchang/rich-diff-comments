/**
 * Azure DevOps adapter for the Markdown PR Comments extension.
 *
 * This file is the SOURCE OF TRUTH. It's mirrored into
 * `extensions/ado/src/adapters/ado.js` by `scripts/dev-sync.ps1` at
 * build / dev-load time.
 *
 * Wraps the ADO REST API surface for PR review comments. All endpoints
 * verified against a live sandbox on 2026-07-22 — see
 * `docs/ADO_ADAPTER_PLAN.md` §15/§16 for shape references and
 * `local-only/ado-samples/all-probes.json` for the raw fixtures.
 *
 * Auth model: cookie-based. All fetches use `credentials: 'same-origin'`;
 * ADO's session cookies authenticate the request. No PAT, no bearer, no
 * CSRF header required (verified — see plan §14 decision log).
 *
 * Attaches everything to `window.ADORC` (Azure DevOps Rich Comments).
 * Dual-context export so the same file works in the browser content
 * script AND Node tests (`require('../src/adapters/ado.js')`).
 */

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.ADORC = root.ADORC || {};
    Object.assign(root.ADORC, api);
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const API_VERSION = '7.1';

  // ── URL parsing ────────────────────────────────────────────────────────

  /**
   * Parse a PR page URL into its structural pieces.
   * Handles both `dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}`
   * (the current canonical URL) and legacy `{org}.visualstudio.com/...` PRs
   * via the caller passing the right hostname.
   *
   * @param {string} pathname  window.location.pathname
   * @returns {{org, projectName, repoName, prId} | null}
   */
  function parsePRUrl(pathname) {
    const m = /^\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/.exec(pathname || '');
    if (!m) return null;
    return {
      org: m[1],
      projectName: m[2],
      repoName: m[3],
      prId: parseInt(m[4], 10)
    };
  }

  // ── Context resolution ─────────────────────────────────────────────────

  /**
   * Resolve the repository GUID (needed by the thread API) from the
   * repo name in the URL. Populates `ctx.repoId` and `ctx.projectId`
   * on the same object (mutates and returns for convenience).
   *
   * Depends on `listRepos()`, which returns all repos in the org and is
   * a cookie-authenticated endpoint like the rest.
   */
  async function resolveIds(ctx, fetchImpl) {
    fetchImpl = fetchImpl || fetch;
    if (!ctx || !ctx.org || !ctx.repoName) return ctx;
    if (ctx.repoId) return ctx; // already resolved

    const url = `/${ctx.org}/_apis/git/repositories?api-version=${API_VERSION}`;
    const resp = await fetchImpl(url, { credentials: 'same-origin' });
    if (!resp.ok) {
      throw new Error(`resolveIds: repos list returned ${resp.status}`);
    }
    const data = await resp.json();
    const repo = (data.value || []).find(r => r.name === ctx.repoName);
    if (!repo) {
      throw new Error(`resolveIds: no repo named "${ctx.repoName}" in org "${ctx.org}"`);
    }
    ctx.repoId = repo.id;
    ctx.projectId = repo.project && repo.project.id;
    ctx.projectName = ctx.projectName || (repo.project && repo.project.name);
    return ctx;
  }

  // ── URL builders (kept as pure helpers for testability) ────────────────

  function threadsUrl(ctx) {
    return `/${ctx.org}/_apis/git/repositories/${ctx.repoId}/pullRequests/${ctx.prId}/threads?api-version=${API_VERSION}`;
  }

  function threadUrl(ctx, threadId) {
    return `/${ctx.org}/_apis/git/repositories/${ctx.repoId}/pullRequests/${ctx.prId}/threads/${threadId}?api-version=${API_VERSION}`;
  }

  function commentsUrl(ctx, threadId) {
    return `/${ctx.org}/_apis/git/repositories/${ctx.repoId}/pullRequests/${ctx.prId}/threads/${threadId}/comments?api-version=${API_VERSION}`;
  }

  function commentUrl(ctx, threadId, commentId) {
    return `/${ctx.org}/_apis/git/repositories/${ctx.repoId}/pullRequests/${ctx.prId}/threads/${threadId}/comments/${commentId}?api-version=${API_VERSION}`;
  }

  // ── Path normalization ─────────────────────────────────────────────────

  /**
   * ADO requires threadContext.filePath to start with `/`. Callers
   * typically have paths without the leading slash (from DOM or user
   * input). Normalize once here so downstream code doesn't have to.
   */
  function normalizeFilePath(path) {
    if (!path) return '';
    return path.startsWith('/') ? path : '/' + path;
  }

  // ── System-thread filter ───────────────────────────────────────────────

  /**
   * ADO auto-generates threads for lifecycle events (branch pushes,
   * status changes, policy evaluations). They have no `threadContext`
   * (not anchored to a file) and their first comment is `commentType: "system"`.
   *
   * Adapter callers should filter these out of the user-visible thread list.
   */
  function isSystemThread(thread) {
    if (!thread) return false;
    if (thread.threadContext == null) return true;
    const first = thread.comments && thread.comments[0];
    if (first && first.commentType === 'system') return true;
    return false;
  }

  // ── HTTP wrappers ──────────────────────────────────────────────────────

  const JSON_HEADERS = { 'Content-Type': 'application/json' };

  async function _json(resp) {
    if (resp.status === 200 || resp.status === 201) {
      // Some endpoints (DELETE) return 200 with an empty body.
      const text = await resp.text();
      return text ? JSON.parse(text) : null;
    }
    // Bubble up an error with the response body so callers can diagnose.
    const body = await resp.text();
    const err = new Error(`ADO API ${resp.status}: ${body.slice(0, 300)}`);
    err.status = resp.status;
    err.body = body;
    throw err;
  }

  async function listThreads(ctx, fetchImpl) {
    fetchImpl = fetchImpl || fetch;
    const resp = await fetchImpl(threadsUrl(ctx), { credentials: 'same-origin' });
    return _json(resp);
  }

  /**
   * Create a new review thread anchored to a file line.
   * @param {object} ctx  { org, repoId, prId }
   * @param {object} opts { filePath, line, offset?, endLine?, endOffset?, content, commentType?, status? }
   */
  async function createThread(ctx, opts, fetchImpl) {
    fetchImpl = fetchImpl || fetch;
    const {
      filePath,
      line,
      offset = 1,
      endLine = line,
      endOffset = offset,
      content,
      commentType = 1,   // 1 = text
      status = 1         // 1 = active
    } = opts || {};

    const body = JSON.stringify({
      comments: [{ parentCommentId: 0, content, commentType }],
      status,
      threadContext: {
        filePath: normalizeFilePath(filePath),
        rightFileStart: { line, offset },
        rightFileEnd:   { line: endLine, offset: endOffset }
      }
    });

    const resp = await fetchImpl(threadsUrl(ctx), {
      method: 'POST',
      credentials: 'same-origin',
      headers: JSON_HEADERS,
      body
    });
    return _json(resp);
  }

  /**
   * Post a reply to an existing thread. `parentCommentId` defaults to 1
   * (the thread's root comment). Response is just the created comment,
   * not the parent thread — callers may want to re-fetch or splice.
   */
  async function reply(ctx, threadId, content, opts, fetchImpl) {
    fetchImpl = fetchImpl || fetch;
    const parentCommentId = (opts && opts.parentCommentId) || 1;
    const commentType = (opts && opts.commentType) || 1;

    const resp = await fetchImpl(commentsUrl(ctx, threadId), {
      method: 'POST',
      credentials: 'same-origin',
      headers: JSON_HEADERS,
      body: JSON.stringify({ parentCommentId, content, commentType })
    });
    return _json(resp);
  }

  /**
   * PATCH a thread's status.
   * status: 1 active, 2 fixed, 3 wontFix, 4 closed, 5 byDesign, 6 pending.
   * Returns the full updated thread.
   */
  async function setThreadStatus(ctx, threadId, status, fetchImpl) {
    fetchImpl = fetchImpl || fetch;
    const resp = await fetchImpl(threadUrl(ctx, threadId), {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: JSON_HEADERS,
      body: JSON.stringify({ status })
    });
    return _json(resp);
  }

  const resolveThread = (ctx, threadId, fetchImpl) => setThreadStatus(ctx, threadId, 2, fetchImpl);
  const unresolveThread = (ctx, threadId, fetchImpl) => setThreadStatus(ctx, threadId, 1, fetchImpl);

  /**
   * Edit a comment's content. Response is just the updated comment.
   * `lastContentUpdatedDate` gets bumped; use it to derive an "(edited)" tag.
   */
  async function editComment(ctx, threadId, commentId, content, fetchImpl) {
    fetchImpl = fetchImpl || fetch;
    const resp = await fetchImpl(commentUrl(ctx, threadId, commentId), {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: JSON_HEADERS,
      body: JSON.stringify({ content })
    });
    return _json(resp);
  }

  /**
   * Soft-delete a comment. Server returns 200 with empty body.
   * The comment stays in the thread's `comments[]` with `isDeleted: true`
   * and no `content` field.
   */
  async function deleteComment(ctx, threadId, commentId, fetchImpl) {
    fetchImpl = fetchImpl || fetch;
    const resp = await fetchImpl(commentUrl(ctx, threadId, commentId), {
      method: 'DELETE',
      credentials: 'same-origin'
    });
    if (!(resp.status === 200 || resp.status === 204)) {
      const body = await resp.text();
      const err = new Error(`deleteComment ${resp.status}: ${body.slice(0, 300)}`);
      err.status = resp.status;
      throw err;
    }
    return { deleted: true };
  }

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    // Constants
    API_VERSION,

    // URL / context helpers
    parsePRUrl,
    resolveIds,
    normalizeFilePath,
    threadsUrl,
    threadUrl,
    commentsUrl,
    commentUrl,

    // Predicates / normalizers
    isSystemThread,

    // Endpoint wrappers (all cookie-authenticated)
    listThreads,
    createThread,
    reply,
    setThreadStatus,
    resolveThread,
    unresolveThread,
    editComment,
    deleteComment
  };
});
