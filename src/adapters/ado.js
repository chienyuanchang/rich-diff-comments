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

  function pullRequestUrl(ctx) {
    return `/${ctx.org}/_apis/git/repositories/${ctx.repoId}/pullRequests/${ctx.prId}?api-version=${API_VERSION}`;
  }

  /**
   * Org-scoped connection-data endpoint. Returns `{ authenticatedUser: {...}, ... }`
   * with the current user's identity — used to figure out which comments
   * "belong to me" for edit / delete affordances.
   */
  function connectionDataUrl(ctx) {
    return `/${ctx.org}/_apis/connectionData?connectOptions=IncludeServices&api-version=${API_VERSION}`;
  }

  /**
   * Build a URL to fetch the contents of a file at a specific version.
   * Uses the project-scoped items endpoint because that's the shape ADO's
   * own web UI issues (as observed in the sandbox network log).
   *
   * @param {object} ctx    Must include org, projectId, repoId.
   * @param {string} path   File path (with or without leading /).
   * @param {object} opts   { version, versionType } — versionType is
   *                        'branch' | 'commit' | 'tag'. If omitted, ADO
   *                        returns the default branch's content.
   */
  function itemUrl(ctx, path, opts) {
    const params = new URLSearchParams();
    params.set('path', normalizeFilePath(path));
    params.set('includeContent', 'true');
    params.set('api-version', API_VERSION);
    if (opts && opts.version) {
      params.set('versionDescriptor.version', opts.version);
      params.set('versionDescriptor.versionType', opts.versionType || 'branch');
    }
    const project = ctx.projectId || ctx.projectName || '';
    const projectSegment = project ? `/${project}` : '';
    return `/${ctx.org}${projectSegment}/_apis/git/repositories/${ctx.repoId}/items?${params.toString()}`;
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
   * Fetch the PR's metadata — sourceRefName, targetRefName, iteration
   * count, lastMergeSourceCommit, etc. Used to figure out which commit /
   * branch to fetch file source from.
   */
  async function getPullRequest(ctx, fetchImpl) {
    fetchImpl = fetchImpl || fetch;
    const resp = await fetchImpl(pullRequestUrl(ctx), { credentials: 'same-origin' });
    return _json(resp);
  }

  /**
   * Fetch the current authenticated user's identity (id, displayName,
   * uniqueName, descriptor). Cookie-authenticated like everything else.
   * The interesting field is `.authenticatedUser.id` — matches the
   * `comment.author.id` on threads posted by the current user.
   */
  async function getConnectionData(ctx, fetchImpl) {
    fetchImpl = fetchImpl || fetch;
    const resp = await fetchImpl(connectionDataUrl(ctx), { credentials: 'same-origin' });
    return _json(resp);
  }

  /**
   * Fetch a file's raw source text at a given branch/commit. ADO's items
   * endpoint returns JSON with a `content` field (when `includeContent=true`).
   * `opts` mirrors itemUrl: { version, versionType }.
   */
  async function getFileSource(ctx, path, opts, fetchImpl) {
    fetchImpl = fetchImpl || fetch;
    const url = itemUrl(ctx, path, opts);
    const resp = await fetchImpl(url, { credentials: 'same-origin' });
    if (!resp.ok) {
      const body = await resp.text();
      const err = new Error(`getFileSource ${resp.status}: ${body.slice(0, 300)}`);
      err.status = resp.status;
      throw err;
    }
    // Response may be JSON (with includeContent=true) or raw text. Try
    // JSON first; on parse failure, treat as raw.
    const text = await resp.text();
    try {
      const data = JSON.parse(text);
      // The JSON path: item metadata with a `content` string.
      if (data && typeof data.content === 'string') return data.content;
      // Otherwise, the parsed JSON isn't a single-item response — return
      // the raw text so the caller can inspect.
      return text;
    } catch {
      return text;
    }
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
    pullRequestUrl,
    connectionDataUrl,
    itemUrl,

    // Predicates / normalizers
    isSystemThread,

    // Endpoint wrappers (all cookie-authenticated)
    listThreads,
    getPullRequest,
    getConnectionData,
    getFileSource,
    createThread,
    reply,
    setThreadStatus,
    resolveThread,
    unresolveThread,
    editComment,
    deleteComment
  };
});
