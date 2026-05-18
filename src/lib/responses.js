/**
 * Pure helpers for parsing GitHub API responses and path validation.
 * No DOM, no fetch — safe to unit-test in Node.
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

  // A real file path: no newlines, reasonable length, no leading whitespace.
  function looksLikePath(s) {
    if (!s || typeof s !== 'string') return false;
    if (s.length > 512) return false;
    if (/[\n\r]/.test(s)) return false;
    if (/^\s/.test(s)) return false;
    return true;
  }

  // Recursively search a JSON object for { rawLines: [...] } or { rawBlob: "..." }.
  // Used to extract raw markdown text from GitHub's embeddedData script tags.
  function findBlobInJson(node, depth) {
    depth = depth || 0;
    if (!node || typeof node !== 'object' || depth > 8) return null;
    if (Array.isArray(node.rawLines)) return node.rawLines.join('\n');
    if (typeof node.rawBlob === 'string' && node.rawBlob.length) return node.rawBlob;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === 'object') {
        const found = findBlobInJson(v, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  // Convert a `create_review_comment` response shape:
  //   { thread: { commentsData: { comments: [...] } } }
  // into our internal comment[] shape used by renderThreadOnElement.
  //
  // `startLine` is OPTIONAL and passed in by the caller — the response's
  // thread object doesn't carry the range start (GitHub stores it on
  // `markersMap.<endKey>.threads[].start`, which we don't get back in the
  // POST response). The caller already knows the start line because the user
  // typed it into the comment box.
  function threadResponseToComments(data, path, line, startLine) {
    const thread = (data && (data.thread || data)) || null;
    if (!thread) return [];
    const commentsData = thread.commentsData || {};
    const rawComments = commentsData.comments || thread.comments || [];
    if (!rawComments.length) return [];

    const first = rawComments[0];
    const headDbId =
      first.databaseId != null ? first.databaseId :
      first.database_id != null ? first.database_id :
      first.id != null ? first.id :
      null;

    // Prefer caller-provided startLine; fall back to thread fields in case
    // GitHub starts returning them in the future.
    const resolvedStartLine = (startLine != null && startLine !== line)
      ? startLine
      : (thread.startLine ?? thread.originalStartLine ?? thread.start_line ?? null);

    return rawComments.map((c, idx) => ({
      path,
      line,
      startLine: resolvedStartLine,
      body: c.body || c.bodyText || '',
      bodyHTML: c.bodyHTML || c.body_html || '',
      user: (c.author && c.author.login) || (c.user && c.user.login) || 'you',
      createdAt:
        c.createdAt || c.publishedAt || c.created_at || new Date().toISOString(),
      htmlUrl: c.url || c.htmlUrl || c.html_url || '',
      threadId: thread.id,
      isResolved: !!thread.isResolved,
      isOutdated: !!(thread.isOutdated || thread.outdated),
      viewerCanReply: thread.viewerCanReply !== false,
      viewerCanResolve: thread.viewerCanResolve !== false,
      headDbId,
      dbId: (c.databaseId != null ? c.databaseId : (c.database_id != null ? c.database_id : (c.id != null ? c.id : null))),
      isHead: idx === 0,
    }));
  }

  // ── Small formatting / safety helpers ────────────────────────────────────

  // Pure HTML escape — no DOM dependency.
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Human-friendly "time ago" rendering. Accepts an ISO string, Date, or epoch.
  // Optional `now` is for deterministic tests.
  function formatTimeAgo(dateStr, now) {
    if (dateStr == null || dateStr === '') return '';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return '';
      const ref = now != null ? new Date(now) : new Date();
      const diffMs = ref - date;
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffH = Math.floor(diffMin / 60);
      if (diffH < 24) return `${diffH}h ago`;
      const diffD = Math.floor(diffH / 24);
      if (diffD < 30) return `${diffD}d ago`;
      return date.toLocaleDateString();
    } catch {
      return '';
    }
  }

  // Parse `markersMap` entries (from /pull/:n/changes route data) into a flat
  // [{ threadId, path, line, startLine, side }] list. Handles:
  //   - keys "R12" / "L34" → side + end line
  //   - `value.threads[].start: "R57"` → range start line (multi-line comments)
  //   - fallback: walks for any id/threadId in unexpected shapes
  // Returns a Map<threadId, { path, line, startLine, side }>.
  function parseMarkersMap(diffSummaries) {
    const out = new Map();
    if (!Array.isArray(diffSummaries)) return out;

    diffSummaries.forEach((summary) => {
      const mm = summary && summary.markersMap;
      if (!mm) return;
      const path = summary.path;

      Object.entries(mm).forEach(([key, val]) => {
        if (!val) return;
        const km = key.match(/^([RL])(\d+)$/);
        if (!km) return;
        const side = km[1];
        const line = parseInt(km[2], 10);

        const entries = []; // { id, startLine? }

        // Preferred shape: { threads: [{ id, start?: "R57" }], ... }
        if (Array.isArray(val.threads)) {
          val.threads.forEach((t) => {
            if (!t || t.id == null) return;
            let startLine = null;
            if (typeof t.start === 'string') {
              const sm = t.start.match(/^[RL](\d+)$/);
              if (sm) startLine = parseInt(sm[1], 10);
            }
            entries.push({ id: String(t.id), startLine });
          });
        }

        // Fallback for unexpected shapes: any id-shaped value.
        if (entries.length === 0) {
          const ids = [];
          const collect = (x) => {
            if (!x) return;
            if (typeof x === 'string' || typeof x === 'number') {
              ids.push(String(x));
            } else if (Array.isArray(x)) {
              x.forEach(collect);
            } else if (typeof x === 'object') {
              if (x.id !== undefined) ids.push(String(x.id));
              if (x.threadId !== undefined) ids.push(String(x.threadId));
              ['threadIds', 'reviewThreads', 'children', 'items', 'data'].forEach((p) => {
                if (x[p]) collect(x[p]);
              });
            }
          };
          collect(val);
          ids.forEach((id) => entries.push({ id, startLine: null }));
        }

        entries.forEach(({ id, startLine }) => {
          // First-write wins — a thread might appear in multiple markers
          // (rare, but defensive).
          if (!out.has(id)) {
            out.set(id, { path, line, startLine, side });
          }
        });
      });
    });

    return out;
  }

  // ── Thread anchor-key encoding ──────────────────────────────────────────
  //
  // Each rendered `.grdc-existing-thread` is tagged with a
  // `data-grdc-anchor` attribute encoding its position so we can locate
  // peers, decide insertion order, etc. without re-walking the comments
  // store. The format is `<path>:<line>:<startLine>` — three colon-separated
  // segments. `startLine` is empty for single-line threads. `path` may
  // contain its own colons (Windows-style or with branch separators), so
  // when parsing we split from the right and treat the LAST two segments
  // as `line` / `startLine`.

  function buildAnchorKey({ path, line, startLine }) {
    return `${path || ''}:${line || ''}:${startLine ?? ''}`;
  }

  // Returns the anchor's `line` as a number, or `null` if the key is
  // malformed / has no parseable line. Used by the insertion-order walker
  // in `renderThreadOnElement` to slot a new thread between existing peers
  // by line number.
  function parseLineFromAnchor(anchorKey) {
    if (typeof anchorKey !== 'string' || !anchorKey) return null;
    const parts = anchorKey.split(':');
    if (parts.length < 2) return null;
    // [..., line, startLine] — line is second-to-last.
    const n = parseInt(parts[parts.length - 2], 10);
    return Number.isFinite(n) ? n : null;
  }

  return {
    looksLikePath,
    findBlobInJson,
    threadResponseToComments,
    escapeHtml,
    formatTimeAgo,
    parseMarkersMap,
    buildAnchorKey,
    parseLineFromAnchor,
  };
});
