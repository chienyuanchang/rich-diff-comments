/**
 * Markdown PR Comments for GitHub
 * 
 * Adds inline comment buttons to rendered markdown in GitHub PR rich diff view.
 * Maps rendered elements back to source line numbers and posts review comments
 * via the GitHub API.
 */

(function () {
  "use strict";

  // Pure helpers are defined in src/lib/*.js (loaded before this script via manifest.json).
  // They're shared with the Node test suite. See docs/APPROACH.md for the strategy.
  const {
    stripMarkdown,
    cleanRenderedText,
    buildSourceIndex,
    findLineAtOffset,
    findTextInSource: _findTextInSourceLib,
    findFrontmatterRange,
    looksLikePath,
    findBlobInJson,
    threadResponseToComments,
    parseMarkersMap,
    computeTableRowLine,
    renderMarkdownPreview,
    findFenceRangeAroundLine,
    sortThreadHeads,
    escapeHtml,
    formatTimeAgo,
    buildAnchorKey,
    parseLineFromAnchor,
    buildSnippet,
    clampDragPos,
    nextWrappingIndex,
    isMarkdownPath,
    slugifyHeading,
    buildOutlineTree,
    attributeThreadsToHeadings,
    collapseHeadingsAtLevel,
    findChangeBlocks,
    classifyChangeKind,
    buildChangeSnippet,
    nextChangeIndex,
    isDiagramBlock,
    isInDeletedBlock,
    mapBlocksToSourceLines,
    buttonAnchor,
  } = (typeof window !== 'undefined' && window.GRDC) || {};

  // Wrap findTextInSource so we can keep the per-file diagnostic counter behavior
  // that the rest of the file relies on (resetting it before each file's scan).
  function findTextInSource(index, text, lastOffset) {
    if (!findTextInSource._logCount) findTextInSource._logCount = 0;
    return _findTextInSourceLib(index, text, lastOffset, (label, info) => {
      if (findTextInSource._logCount >= 8) return;
      findTextInSource._logCount++;
      console.log(`[GRDC] ${label} needle(${info.needleLen}): "${info.needle}"`);
      console.log(`[GRDC]   source@${info.lastOffset}: "${index.concat.slice(info.lastOffset, info.lastOffset + 60)}"`);
    });
  }

  // ── State ──────────────────────────────────────────────────────────────────

  let prInfo = null; // { owner, repo, pullNumber, commitId }
  let fileLineMap = new Map(); // Map<element, { path, line }>

  // ── URL Parsing ────────────────────────────────────────────────────────────

  function parsePRUrl() {
    const match = window.location.pathname.match(
      /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(files|changes)/
    );
    if (!match) return null;
    return { owner: match[1], repo: match[2], pullNumber: parseInt(match[3]) };
  }

  // ── GitHub API ─────────────────────────────────────────────────────────────

  function getGitHubToken() {
    return localStorage.getItem("grdc_github_token");
  }

  function setGitHubToken(token) {
    localStorage.setItem("grdc_github_token", token);
  }

  // Try to discover the head/base commit SHAs from the page DOM.
  function discoverCommitOids() {
    const oids = { head: null, base: null };

    // Head SHA: from any /blob/<sha>/ link in a file container
    const blobLink = document.querySelector('a[href*="/blob/"]');
    if (blobLink) {
      const m = blobLink.getAttribute('href').match(/\/blob\/([0-9a-f]{40})\//);
      if (m) oids.head = m[1];
    }

    // Look for embedded JSON data with commit info
    const scripts = document.querySelectorAll('script[type="application/json"]');
    for (const s of scripts) {
      const text = s.textContent || '';
      const headMatch = text.match(/"head[_A-Za-z]*[Oo]id"\s*:\s*"([0-9a-f]{40})"/);
      const baseMatch = text.match(/"(?:base|merge_base|comparisonStart)[_A-Za-z]*[Oo]id"\s*:\s*"([0-9a-f]{40})"/);
      if (headMatch && !oids.head) oids.head = headMatch[1];
      if (baseMatch && !oids.base) oids.base = baseMatch[1];
      if (oids.head && oids.base) break;
    }

    return oids;
  }

  // Use GitHub's internal page-data endpoint (uses session cookies, no PAT needed)
  async function postReviewCommentInternal(path, line, body, opts) {
    if (!prInfo) return { ok: false, error: "No PR info" };
    opts = opts || {};
    let startLine = (opts.startLine != null && opts.startLine < line) ? opts.startLine : null;

    // Always try route data first — it has the canonical comparison range.
    const route = await fetchRouteData();

    const cmp = route?.comparison || route?.comparison?.fullDiff || {};
    const fd = route?.comparison?.fullDiff || {};
    prInfo.headOid = prInfo.headOid ||
      cmp.headOid || cmp.comparisonEndOid || fd.headOid || fd.comparisonEndOid;
    prInfo.baseOid = prInfo.baseOid ||
      cmp.baseOid || cmp.comparisonStartOid || cmp.mergeBaseOid ||
      fd.baseOid || fd.comparisonStartOid || fd.mergeBaseOid;

    if (!prInfo.headOid || !prInfo.baseOid) {
      const oids = discoverCommitOids();
      prInfo.headOid = prInfo.headOid || oids.head;
      prInfo.baseOid = prInfo.baseOid || oids.base;
    }

    // Diagnostic: log the OIDs we resolved + dump comparison keys if base still missing
    if (!postReviewCommentInternal._loggedOids) {
      postReviewCommentInternal._loggedOids = true;
      console.log('[GRDC] Resolved OIDs head=', prInfo.headOid, 'base=', prInfo.baseOid);
      if (route?.comparison) {
        console.log('[GRDC] route.comparison keys:', Object.keys(route.comparison));
        if (route.comparison.fullDiff) {
          console.log('[GRDC] route.comparison.fullDiff keys:', Object.keys(route.comparison.fullDiff));
        }
      }
    }

    if (!prInfo.headOid) {
      return { ok: false, error: "Could not discover head commit OID" };
    }
    if (!prInfo.baseOid) {
      return { ok: false, error: "Could not discover base commit OID — see console for route.comparison keys" };
    }
    const baseOid = prInfo.baseOid;

    const url = `https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.pullNumber}/page_data/create_review_comment`;

    // For multi-line ranges: subjectType and positioning.type must be the
    // lowercase token `"multiline"` (not `"multiLine"` camelCase). GitHub
    // accepts the camelCase form with 200 OK but silently stores the comment
    // as single-line. Captured from a native source-diff drag-comment.
    const isRange = startLine != null;

    // Payload shape mirrors what GitHub's own source-diff form sends.
    // For single-line: `subjectType: "line"`, `positioning.type: "line"`,
    // top-level `line`. For multi-line ranges: type = "multiline", and the
    // positioning object holds start/end pairs (line, side, path, commitOid).
    const payload = isRange ? {
      comparisonEndOid: prInfo.headOid,
      comparisonStartOid: baseOid,
      text: body,
      submitBatch: true,
      line,
      path,
      positioning: {
        baseCommitOid: baseOid,
        headCommitOid: prInfo.headOid,
        type: 'multiline',
        startPath: path,
        startLine,
        startCommitOid: prInfo.headOid,
        endPath: path,
        endLine: line,
        endCommitOid: prInfo.headOid,
      },
      side: 'right',
      startLine,
      startSide: 'right',
      subjectType: 'multiline',
    } : {
      comparisonEndOid: prInfo.headOid,
      comparisonStartOid: baseOid,
      line,
      path,
      positioning: {
        type: 'line',
        baseCommitOid: baseOid,
        commitOid: prInfo.headOid,
        headCommitOid: prInfo.headOid,
        line,
        path,
      },
      side: 'right',
      subjectType: 'line',
      submitBatch: true,
      text: body,
    };

    try {
      // GitHub's own UI sometimes 422s on first attempt then succeeds — retry once.
      let res;
      for (let attempt = 0; attempt < 2; attempt++) {
        res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "GitHub-Verified-Fetch": "true",
          },
          body: JSON.stringify(payload),
        });
        if (res.ok) break;
        if (res.status !== 422) break;
        // brief delay before retry
        await new Promise(r => setTimeout(r, 400));
      }

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        let bodyText = '';
        try {
          bodyText = await res.text();
          console.log(`[GRDC] Post failed (${res.status}). Response body:`, bodyText.slice(0, 1000));
          try {
            const err = JSON.parse(bodyText);
            errMsg = err.message || err.error || JSON.stringify(err).slice(0, 200);
          } catch {
            errMsg = bodyText.slice(0, 200) || errMsg;
          }
        } catch {}
        // Friendlier message for the common out-of-hunk case: GitHub only
        // accepts comments on lines that appear in a diff hunk. Our text-
        // matcher can resolve a rendered block to its true source line, but
        // if that line is in an unchanged region of a long file GitHub will
        // reject the post. The user can edit the line number in the comment
        // box to a known-good in-hunk line as a workaround.
        if (res.status === 422 && /line could not be resolved/i.test(errMsg)) {
          errMsg = `Line ${line} is outside any diff hunk — GitHub only allows comments on changed lines or their immediate context. Edit the line number above to a line inside the diff.`;
        }
        return { ok: false, error: errMsg };
      }
      // Parse response so callers can render the new thread inline.
      let data = null;
      try { data = await res.json(); } catch {}
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // PAT-based fallback (kept for compatibility / opt-in)
  async function postReviewCommentApi(path, line, body, opts) {
    const token = getGitHubToken();
    if (!token) {
      promptForToken();
      return { ok: false, error: "No token configured" };
    }
    opts = opts || {};
    const startLine = (opts.startLine != null && opts.startLine < line) ? opts.startLine : null;

    if (!prInfo.commitId) {
      const res0 = await fetch(
        `https://api.github.com/repos/${prInfo.owner}/${prInfo.repo}/pulls/${prInfo.pullNumber}`,
        { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" } }
      );
      if (res0.ok) prInfo.commitId = (await res0.json()).head.sha;
    }

    const res = await fetch(
      `https://api.github.com/repos/${prInfo.owner}/${prInfo.repo}/pulls/${prInfo.pullNumber}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body, commit_id: prInfo.commitId, path, line, side: "RIGHT",
          ...(startLine != null ? { start_line: startLine, start_side: "RIGHT" } : {}),
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json();
      return { ok: false, error: err.message || `HTTP ${res.status}` };
    }
    return { ok: true };
  }

  // Default: use internal endpoint (session cookies). Set localStorage 'grdc_use_pat' = '1' to use PAT.
  async function postReviewComment(path, line, body, opts) {
    if (localStorage.getItem("grdc_use_pat") === "1") {
      return postReviewCommentApi(path, line, body, opts);
    }
    return postReviewCommentInternal(path, line, body, opts);
  }

  // ── Internal page_data helpers (reply / resolve / review submit) ──────────
  //
  // These endpoints are undocumented and discovered empirically. We try
  // a small set of candidate URLs/payload shapes and return the first 2xx.
  // Each attempt logs status + response body snippet so failures are easy to
  // diagnose in DevTools.

  async function pageDataPost(candidates, label) {
    if (!prInfo) return { ok: false, error: 'No PR info' };
    const base = `https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.pullNumber}/page_data`;

    for (const c of candidates) {
      const url = `${base}/${c.path}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'GitHub-Verified-Fetch': 'true',
          },
          body: JSON.stringify(c.body),
        });
        const text = await res.text().catch(() => '');
        console.log(`[GRDC] ${label} → POST ${c.path} status=${res.status}${text ? ' body=' + text.slice(0, 240) : ''}`);
        if (res.ok) {
          let data = null;
          try { data = JSON.parse(text); } catch {}
          return { ok: true, raw: text, data };
        }
        // If 404/405 try next candidate; for 4xx other than 404 we still try fallbacks but record error
        if (res.status === 404 || res.status === 405) continue;
        // Save error but keep trying
        var lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      } catch (e) {
        console.log(`[GRDC] ${label} → ${c.path} threw:`, e.message);
        var lastError = e.message;
      }
    }
    return { ok: false, error: typeof lastError !== 'undefined' ? lastError : 'All endpoint candidates failed (404/405)' };
  }

  async function postReply(threadId, inReplyToDbId, body) {
    // Verified working: POST page_data/create_review_comment with inReplyTo + OIDs.
    // Returns { thread: { commentsData: { comments: [...] } } } on success.
    const baseOid = prInfo?.baseOid;
    const headOid = prInfo?.headOid;
    return pageDataPost([
      { path: 'create_review_comment', body: { inReplyTo: inReplyToDbId, text: body, submitBatch: true,
          comparisonStartOid: baseOid, comparisonEndOid: headOid } },
    ], `reply(thread=${threadId},inReplyTo=${inReplyToDbId})`);
  }

  async function setThreadResolved(threadId, resolved) {
    // Verified working: POST page_data/{resolve,unresolve}_thread with { threadId } (camelCase).
    // Note: `resolve_review_thread` returns 422 (HTML error page),
    //       `resolve_thread` with `thread_id` (snake_case) returns 404 {"error":"Not Found"}.
    const action = resolved ? 'resolve' : 'unresolve';
    return pageDataPost([
      { path: `${action}_thread`, body: { threadId } },
    ], `${action}(thread=${threadId})`);
  }

  // ── Edit / Delete own review comments ─────────────────────────────────────
  //
  // Verified endpoints (captured 2026-05):
  //
  // DELETE /pull/<n>/page_data/review_comments/<commentDbId>
  //   No body. Returns 204 No Content on success.
  //
  // PUT /pull/<n>/page_data/update_review_comment?body_version=<sha256-of-original-body>
  //   Body: {"text":"new body text"}
  //   `body_version` is a sha256 hex digest of the ORIGINAL body. GitHub uses
  //   it as a conflict check (rejects if the comment was edited elsewhere
  //   since this client last fetched it). Returns the updated comment JSON.

  // Read the currently signed-in viewer's login from the `dotcom_user` cookie.
  // It's set by GitHub on login (HttpOnly: false) and is the cheapest reliable
  // way to identify which comments belong to "me" so we can show the edit/
  // delete menu only on those. Falls back to meta tags as belt-and-braces.
  function getViewerLogin() {
    if (getViewerLogin._cached) return getViewerLogin._cached;
    const m = document.cookie.match(/(?:^|;\s*)dotcom_user=([^;]+)/);
    let login = m ? decodeURIComponent(m[1]) : '';
    if (!login) {
      login = document.querySelector('meta[name="user-login"]')?.getAttribute('content') || '';
    }
    getViewerLogin._cached = login || null;
    return getViewerLogin._cached;
  }

  // PR author login — needed to render the "Author" pill in comment headers
  // (GitHub's UI calls the PR opener "Author"). The login isn't on each
  // comment object, so we read it once from the page. Sources tried:
  //   1. A meta tag if GitHub happens to expose one.
  //   2. The `.gh-header-meta a.author` link in the PR header (present on
  //      every PR sub-page including /files).
  //   3. Embedded route-data JSON: `"pullRequest":{...,"author":{"login":"X"}`
  //      — scanned as a regex over <script> contents.
  // Cached for the page's lifetime.
  function getPRAuthorLogin() {
    if (getPRAuthorLogin._cached !== undefined) return getPRAuthorLogin._cached;
    let login = '';
    // 2. DOM link in the PR header.
    const authorLink = document.querySelector('.gh-header-meta a.author, .gh-header-meta .author');
    if (authorLink) login = (authorLink.textContent || '').trim();
    // 3. Embedded JSON fallback.
    if (!login) {
      for (const s of document.querySelectorAll('script')) {
        const txt = s.textContent || '';
        if (!txt.includes('"pullRequest"') || !txt.includes('"author"')) continue;
        const m = txt.match(/"pullRequest"\s*:\s*\{[^}]*"author"\s*:\s*\{[^}]*"login"\s*:\s*"([^"]+)"/);
        if (m) { login = m[1]; break; }
      }
    }
    getPRAuthorLogin._cached = login || null;
    return getPRAuthorLogin._cached;
  }

  // SHA-256 hex digest of a UTF-8 string using the WebCrypto API. Used to
  // compute `body_version` for update_review_comment.
  async function sha256Hex(input) {
    const enc = new TextEncoder().encode(input || '');
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function deleteReviewComment(commentDbId) {
    if (!prInfo) return { ok: false, error: 'No PR info' };
    const url = `https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.pullNumber}/page_data/review_comments/${commentDbId}`;
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'GitHub-Verified-Fetch': 'true',
        },
      });
      console.log(`[GRDC] delete(comment=${commentDbId}) → ${res.status}`);
      if (res.ok) return { ok: true };
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function updateReviewComment(commentDbId, originalBody, newBody, knownBodyVersion) {
    if (!prInfo) return { ok: false, error: 'No PR info' };
    // Prefer a `bodyVersion` value supplied by the caller (read off the
    // response when we fetched existing comments). Fall back to hashing
    // the original body locally — but note GitHub's exact hashing input is
    // not 100% nailed down, so this may 404 if the server-side body_version
    // doesn't match (which means the comment was edited elsewhere or our
    // hash normalization differs).
    const bodyVersion = knownBodyVersion || await sha256Hex(originalBody || '');
    const url = `https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.pullNumber}/page_data/update_review_comment?body_version=${bodyVersion}`;
    try {
      const res = await fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'GitHub-Verified-Fetch': 'true',
        },
        // Payload shape captured from GitHub's own UI:
        // {"body":"<new text>","commentId":"<dbId-as-string>"}.
        // (An earlier capture showed {"text":...} working too — GitHub may
        // accept either, but the current native UI sends {body, commentId}.)
        body: JSON.stringify({ body: newBody, commentId: String(commentDbId) }),
      });
      const text = await res.text().catch(() => '');
      console.log(`[GRDC] update(comment=${commentDbId}) → ${res.status}${text ? ' body=' + text.slice(0, 240) : ''}`);
      if (res.ok) {
        let data = null;
        try { data = JSON.parse(text); } catch {}
        return { ok: true, data };
      }
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Render markdown using GitHub's own renderer (cookie auth). This gives us
  // pixel-perfect parity for tables, task lists, mentions, emoji, etc. — the
  // same path GitHub's native comment box uses for its Preview tab.
  //
  // Verified endpoint: POST https://github.com/preview (form-urlencoded,
  // cookies + CSRF token). The repo-scoped variant `/<owner>/<repo>/preview`
  // returned 422; the global one works for any repo the session can see.
  // Falls back to the local inline renderer if the request fails.
  async function renderPreviewViaGitHub(markdown) {
    if (!markdown.trim()) return null;

    const csrfToken =
      document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
      document.querySelector('input[name="authenticity_token"]')?.value ||
      '';

    const form = new URLSearchParams();
    form.set('text', markdown);
    if (csrfToken) form.set('authenticity_token', csrfToken);
    if (prInfo) form.set('repository', `${prInfo.owner}/${prInfo.repo}`);

    try {
      const res = await fetch('https://github.com/preview', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Accept': 'text/html',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'GitHub-Verified-Fetch': 'true',
          'Scoped-CSRF-Token': csrfToken,
        },
        body: form,
      });
      if (!res.ok) {
        console.log(`[GRDC] preview → HTTP ${res.status}`);
        return null;
      }
      const text = await res.text();
      // Strip any wrapping <html>/<body> if GitHub returns a full document
      return text.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '') || text;
    } catch (e) {
      console.log('[GRDC] preview threw:', e.message);
      return null;
    }
  }

  // ── @mention suggestions ───────────────────────────────────────────────────
  //
  // Verified endpoint: GET https://github.com/suggestions/pull_request/<prInternalId>
  //   ?mention_suggester=1&user_avatar=1&repository_id=<repoId>
  // Returns a JSON array of mentionable users for this PR. Cookie auth, no PAT.
  // Cached per session — one request gives us the full collaborator list.

  let mentionSuggestionCache = null;
  let mentionIdsResolved = null;

  function discoverMentionIds() {
    if (mentionIdsResolved && mentionIdsResolved.pullRequestId) return mentionIdsResolved;
    const repoId =
      document.querySelector('meta[name="octolytics-dimension-repository_id"]')?.getAttribute('content') ||
      document.querySelector('meta[name="repository-id"]')?.getAttribute('content') ||
      null;

    // PR internal numeric ID is different from prInfo.pullNumber. Try several
    // sources, in order of cheapness:
    let pullRequestId = null;

    // 1. Embedded JSON: look for "pullRequestId": "..." or similar.
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      const txt = s.textContent;
      const m =
        txt.match(/"pullRequestId"\s*:\s*"?(\d{6,})"?/) ||
        txt.match(/"pull_request_id"\s*:\s*"?(\d{6,})"?/) ||
        txt.match(/"pullRequest"\s*:\s*\{\s*"id"\s*:\s*"?(\d{6,})"?/);
      if (m) { pullRequestId = m[1]; break; }
    }

    // 2. data-* attributes on any element on the page
    if (!pullRequestId) {
      const el = document.querySelector(
        '[data-marker-navigation-pull-request-id], [data-pull-request-id], [data-issue-and-pr-hovercards-enabled][data-id]'
      );
      if (el) {
        pullRequestId =
          el.getAttribute('data-pull-request-id') ||
          el.getAttribute('data-marker-navigation-pull-request-id') ||
          el.getAttribute('data-id');
      }
    }

    // 3. Scrape the rendered DOM for any /pull_request/<10+ digits>/ URL
    //    (e.g. on existing review-thread links or our own marker fetches).
    if (!pullRequestId) {
      const html = document.documentElement.innerHTML;
      const m = html.match(/\/pull_request\/(\d{8,})/);
      if (m) pullRequestId = m[1];
    }

    // 4. Walk route data — `routeData.markers.threads[*]` thread objects often
    //    carry a `pullRequestId` field on each thread.
    if (!pullRequestId && routeData?.markers?.threads) {
      for (const t of Object.values(routeData.markers.threads)) {
        const id = t?.pullRequestId || t?.pull_request_id;
        if (id && String(id).length >= 8) { pullRequestId = String(id); break; }
      }
    }

    mentionIdsResolved = { repoId, pullRequestId };
    // (DOM strategies are best-effort. If they miss, the caller falls back to
    // fetchPullRequestIdFromApi() which scrapes the PR HTML. We don't log a
    // warning here — the fallback works and the silent fast-path is free.)
    return mentionIdsResolved;
  }

  // Last-resort: ask GitHub for the internal PR id.
  //
  // We can't use api.github.com from a github.com content script with cookies —
  // it returns `Access-Control-Allow-Origin: *` which forbids credentialed
  // requests, and uncredentialed requests fail on private repos with 404.
  //
  // Instead we hit the same-origin pull-request page directly and scrape
  // `pull_request_id` from its HTML. This works for any repo the session can
  // see (public OR private). Costs one extra request (~50 KB), cached for the
  // session.
  async function fetchPullRequestIdFromApi() {
    if (!prInfo) return null;
    try {
      const res = await fetch(
        `https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.pullNumber}`,
        {
          credentials: 'include',
          headers: { 'Accept': 'text/html' },
        }
      );
      if (!res.ok) {
        console.log(`[GRDC] mentions: pull page fetch → HTTP ${res.status}`);
        return null;
      }
      const html = await res.text();
      // The PR HTML page references the internal id in many places — pick the
      // first stable one. `/pull_request/<id>/` shows up in suggestions URLs,
      // hovercards, and review-thread anchors.
      let m =
        html.match(/\/pull_request\/(\d{8,})/) ||
        html.match(/"pullRequestId"\s*:\s*"?(\d{8,})"?/) ||
        html.match(/data-pull-request-id="(\d{8,})"/);
      if (m) {
        console.log(`[GRDC] mentions: resolved pullRequestId from PR HTML: ${m[1]}`);
        return m[1];
      }
      console.log('[GRDC] mentions: PR HTML did not contain a pull_request id');
      return null;
    } catch (e) {
      console.log('[GRDC] mentions: pull page fetch threw:', e.message);
      return null;
    }
  }

  async function fetchMentionSuggestions() {
    // Only treat a non-empty cache as authoritative — empty means previous
    // attempt failed (likely ID discovery), so retry now that more of the
    // page may have loaded (e.g. embedded JSON, route data).
    if (mentionSuggestionCache && mentionSuggestionCache.length) return mentionSuggestionCache;
    let { repoId, pullRequestId } = discoverMentionIds();

    // REST API fallback if DOM scraping failed.
    if (!pullRequestId) {
      pullRequestId = await fetchPullRequestIdFromApi();
      if (pullRequestId && mentionIdsResolved) mentionIdsResolved.pullRequestId = pullRequestId;
    }

    if (!repoId || !pullRequestId) {
      console.log('[GRDC] mentions: cannot resolve IDs', { repoId, pullRequestId });
      mentionSuggestionCache = [];
      return mentionSuggestionCache;
    }
    const url = `https://github.com/suggestions/pull_request/${pullRequestId}?mention_suggester=1&user_avatar=1&repository_id=${repoId}`;
    try {
      const res = await fetch(url, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'GitHub-Verified-Fetch': 'true',
        },
      });
      if (!res.ok) {
        console.log(`[GRDC] mentions: HTTP ${res.status}`);
        mentionSuggestionCache = [];
        return mentionSuggestionCache;
      }
      const data = await res.json();
      // Normalize across possible response shapes (array or wrapped object,
      // GraphQL-style vs REST-style fields).
      const raw = Array.isArray(data) ? data : (data.suggestions || data.users || data.results || []);
      mentionSuggestionCache = raw.map((u) => {
        // Avatar URL may come as a raw URL or wrapped in an <img> tag string.
        let avatarUrl = u.avatar_url || u.avatarUrl || '';
        if (!avatarUrl && typeof u.avatar_tag === 'string') {
          const m = u.avatar_tag.match(/src="([^"]+)"/);
          if (m) avatarUrl = m[1];
        }
        return {
          login: u.login || u.value || u.username || u.name || '',
          name: u.name || u.fullname || '',
          avatarUrl,
        };
      }).filter((u) => u.login);
      console.log(`[GRDC] mentions: fetched ${mentionSuggestionCache.length} suggestions`);
      return mentionSuggestionCache;
    } catch (e) {
      console.log('[GRDC] mentions threw:', e.message);
      mentionSuggestionCache = [];
      return mentionSuggestionCache;
    }
  }

  // Attach @-mention autocomplete to a textarea. Anchors a dropdown to the
  // editor container (must be position: relative). Up/Down to navigate,
  // Tab/Enter to insert, Escape or whitespace to dismiss.
  function attachMentionsTo(textarea, container) {
    let dropdown = null;
    let triggerStart = -1;
    let matches = [];
    let activeIdx = 0;

    const close = () => {
      if (dropdown) {
        if (dropdown._cleanup) dropdown._cleanup();
        dropdown.remove();
        dropdown = null;
      }
      triggerStart = -1;
      matches = [];
      activeIdx = 0;
    };

    const ensureDropdown = () => {
      if (dropdown) return;
      dropdown = document.createElement('div');
      dropdown.className = 'grdc-mention-dropdown';
      // Attach to <body> so clipping ancestors (e.g. `.grdc-reply-box` has
      // `overflow: hidden` for its border-radius) don't cut off the list.
      // Position with `fixed` so we don't have to track scroll either.
      document.body.appendChild(dropdown);
      const place = () => {
        if (!dropdown) return;
        const r = textarea.getBoundingClientRect();
        dropdown.style.top = (r.bottom + 2) + 'px';
        dropdown.style.left = r.left + 'px';
        dropdown.style.width = r.width + 'px';
      };
      place();
      // Re-position on textarea resize / window scroll / window resize.
      const ro = new ResizeObserver(place);
      ro.observe(textarea);
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
      dropdown._cleanup = () => {
        ro.disconnect();
        window.removeEventListener('scroll', place, true);
        window.removeEventListener('resize', place);
      };
    };

    const render = () => {
      if (!dropdown) return;
      dropdown.innerHTML = matches.slice(0, 8).map((u, i) => `
        <div class="grdc-mention-item${i === activeIdx ? ' grdc-mention-active' : ''}" data-i="${i}">
          ${u.avatarUrl ? `<img class="grdc-mention-avatar" src="${u.avatarUrl}" alt="">` : '<span class="grdc-mention-avatar"></span>'}
          <strong>${escapeHtml(u.login)}</strong>
          ${u.name ? `<span class="grdc-mention-name">${escapeHtml(u.name)}</span>` : ''}
        </div>
      `).join('');
      dropdown.querySelectorAll('.grdc-mention-item').forEach((el) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault(); // keep focus in textarea
          select(parseInt(el.dataset.i, 10));
        });
      });
    };

    const select = (i) => {
      const m = matches[i];
      if (!m) return close();
      const value = textarea.value;
      const cursor = textarea.selectionStart;
      const before = value.slice(0, triggerStart);
      const after = value.slice(cursor);
      const insert = '@' + m.login + ' ';
      textarea.value = before + insert + after;
      const newCursor = before.length + insert.length;
      textarea.setSelectionRange(newCursor, newCursor);
      close();
      textarea.focus();
      // Re-fire input so auto-grow updates.
      textarea.dispatchEvent(new Event('input'));
    };

    textarea.addEventListener('keydown', (e) => {
      if (!dropdown || !matches.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % Math.min(matches.length, 8); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = (activeIdx - 1 + Math.min(matches.length, 8)) % Math.min(matches.length, 8); render(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); select(activeIdx); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });

    textarea.addEventListener('input', async () => {
      const value = textarea.value;
      const cursor = textarea.selectionStart;

      // Detect new @ trigger: just-typed '@' at start of word.
      if (triggerStart < 0 && cursor > 0 && value[cursor - 1] === '@') {
        const prev = cursor >= 2 ? value[cursor - 2] : '';
        if (!prev || /\s/.test(prev)) {
          triggerStart = cursor - 1;
        }
      }
      if (triggerStart < 0) return;

      // Cancel trigger if cursor moved before @ or query contains whitespace.
      if (cursor <= triggerStart) return close();
      const query = value.slice(triggerStart + 1, cursor);
      if (/[\s\n]/.test(query)) return close();

      const all = await fetchMentionSuggestions();
      if (!all.length) return close();

      const q = query.toLowerCase();
      matches = !q
        ? all.slice()
        : all.filter((u) => u.login.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q));
      // Prefer prefix matches first.
      matches.sort((a, b) => {
        const ap = a.login.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.login.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp;
      });

      if (!matches.length) return close();
      activeIdx = 0;
      ensureDropdown();
      render();
    });

    textarea.addEventListener('blur', () => {
      // Delay so a mousedown on the dropdown can still fire.
      setTimeout(() => close(), 150);
    });
  }

  // ── Token Prompt ───────────────────────────────────────────────────────────


  function promptForToken() {
    const existing = getGitHubToken();
    const token = prompt(
      "Markdown PR — Markdown PR Comments for GitHub needs a Personal Access Token (PAT) with 'repo' scope.\n\n" +
        "Create one at: https://github.com/settings/tokens\n\n" +
        "Enter your token:",
      existing || ""
    );
    if (token && token.trim()) {
      setGitHubToken(token.trim());
    }
  }

  // ── Line Number Mapping ────────────────────────────────────────────────────

  // Cached route data from /changes endpoint
  let routeData = null;
  // Map from pathDigest → file path (from diffSummaries)
  let pathDigestMap = new Map();
  // Map from path → GitHub's `changeType` ("ADDED" | "MODIFIED" |
  // "REMOVED" | "RENAMED" | …). Used by `buildChangesPane` to skip
  // ADDED / REMOVED files — those are already labeled in the diff list,
  // so flooding Changes with one entry per paragraph/heading inside them
  // adds no value (and several attempts to detect those patterns via DOM
  // alone caused worse regressions — see the 2026-06-17 conversation).
  let pathChangeTypeMap = new Map();

  // Invalidate the route-data cache so the next `fetchRouteData()` re-fetches.
  // Call this after any mutation that adds a comment / reply / resolution so
  // a subsequent re-init re-renders existing threads correctly.
  function invalidateRouteData() {
    routeData = null;
    markSourceDiffDirty();
  }

  // ── Source-diff sync (1.0.2) ───────────────────────────────────────────────
  //
  // After we post / reply / resolve / edit / delete from rich-diff, the comment
  // is persisted server-side and visible everywhere on next page load. But if
  // the user toggles back to source-diff on the SAME page (no reload), GitHub's
  // source-diff React store still has its stale thread list from initial load.
  // We can't reach into that store from a content script.
  //
  // MVP fix (Option A): when the user clicks any rich/source-diff toggle on
  // this page after a successful mutation, hard-reload the page. The user is
  // toggling away from rich-diff anyway, so a reload at that boundary is
  // acceptable. Users who stay in rich-diff are unaffected — our own re-render
  // path (invalidateRouteData → re-fetch /changes) already keeps rich-diff
  // accurate.
  let sourceDiffDirty = false;
  function markSourceDiffDirty() {
    if (!sourceDiffDirty) {
      console.log('[GRDC] sourceDiffDirty = true (a mutation will require source-diff reload on toggle)');
    }
    sourceDiffDirty = true;
  }

  // Click delegate — fires before GitHub's own handler. If the target looks
  // like a "show source diff" toggle and we're dirty, force a reload so the
  // user lands on a fresh source-diff state.
  //
  // Heuristics for detecting the toggle (defensive — GitHub's selectors shift):
  //  - Button (or ancestor button) whose `aria-label`, `title`, or text mentions
  //    "source diff", "source code", "rendered", "rich diff"
  //  - Or has `aria-labelledby` pointing at a hidden text node with the same
  //    keywords (GitHub's Primer SegmentedControl labels this way)
  //  - Or has Primer SegmentedControl class names (`prc-SegmentedControl-*`)
  //    which we then verify via the labelledby text
  //  - Or has data attributes commonly used by the diff-view toggle
  //    (`data-disable-with` with relevant text, `data-tab-item="source"`)
  // If we're already viewing source-diff or the toggle isn't ours, do nothing.
  function looksLikeDiffToggle(el) {
    if (!el || el.nodeType !== 1) return false;
    const btn = el.closest('button, a[role="button"], [data-tab-item]');
    if (!btn) return false;

    // Resolve `aria-labelledby` to the text content of the referenced element.
    let labelledByText = '';
    const lbId = btn.getAttribute('aria-labelledby');
    if (lbId) {
      // `aria-labelledby` can be multiple space-separated ids.
      labelledByText = lbId.split(/\s+/)
        .map(id => document.getElementById(id)?.textContent || '')
        .join(' ');
    }

    const haystack = (
      (btn.getAttribute('aria-label') || '') + ' ' +
      labelledByText + ' ' +
      (btn.getAttribute('title') || '') + ' ' +
      (btn.getAttribute('data-disable-with') || '') + ' ' +
      (btn.getAttribute('data-tab-item') || '') + ' ' +
      (btn.className || '') + ' ' +
      (btn.textContent || '')
    ).toLowerCase();
    if (!haystack) return false;
    // Common GitHub labels: "Display the source diff", "Display the rich diff",
    // "Source diff", "Rich diff", "Display source", "Display rendered",
    // "Source code" / "Rendered" (Primer SegmentedControl on /pull/*/files).
    const match = /source\s*diff|rich\s*diff|render(ed)?\s*diff|display\s+the\s+source|display\s+the\s+rich|\bsource\s+code\b|\brendered\b/.test(haystack);
    if (match) {
      console.log('[GRDC] Diff-toggle click detected on:', btn, 'haystack:', haystack.slice(0, 160));
    }
    return match;
  }

  // ── Per-file rich-diff toggling ─────────────────────────────────────
  // Find all PR file containers — same selector family used elsewhere
  // (`buildLineMap`, `attachCommentButtons`). Each container hosts the
  // file's source / rendered toggle inside its header.
  function findFileContainers() {
    return Array.from(document.querySelectorAll(
      'div[id^="diff-"], [data-tagsearch-path], .file[data-path]'
    ));
  }
  function getContainerPath(container) {
    // Use the full path-resolution strategy (data attr → clipboard-copy →
    // pathDigestMap lookup) shared with `buildLineMap`. On `/changes`
    // GitHub often omits `data-tagsearch-path` / `data-path` on the file
    // wrappers — the clipboard-copy fallback inside `getFilePath` is what
    // actually returns the path in that case.
    try { return getFilePath(container) || ''; } catch (_) { return ''; }
  }

  // Inside a file container, find the per-file toggle button that would
  // switch it to rich-diff. Returns null when the rich-diff segment is
  // already active or no toggle can be found. Reuses the same heuristics
  // as `looksLikeDiffToggle` and additionally excludes the "source"
  // segment of a SegmentedControl pair.
  // Resolve a button's full label text: own attributes + textContent +
  // `aria-labelledby` referenced element(s). GitHub's segmented-control
  // toggle buttons have no own label — the human text ("Display the rich
  // diff") lives in a sibling referenced via `aria-labelledby`. Without
  // this, our match logic sees an empty haystack and skips the button.
  function resolveButtonHaystack(btn) {
    let labelledByText = '';
    const lbId = btn.getAttribute('aria-labelledby');
    if (lbId) {
      labelledByText = lbId.split(/\s+/)
        .map(id => document.getElementById(id)?.textContent || '')
        .join(' ');
    }
    return (
      (btn.getAttribute('aria-label') || '') + ' ' +
      labelledByText + ' ' +
      (btn.getAttribute('title') || '') + ' ' +
      (btn.getAttribute('data-tab-item') || '') + ' ' +
      (btn.getAttribute('data-disable-with') || '') + ' ' +
      (btn.textContent || '')
    ).toLowerCase();
  }

  function findRichDiffToggleIn(container) {
    const buttons = container.querySelectorAll('button, a[role="button"], [data-tab-item]');
    for (const btn of buttons) {
      if (!looksLikeDiffToggle(btn)) continue;
      const haystack = resolveButtonHaystack(btn);
      // We want the button that switches TO rich-diff. Skip anything
      // that's clearly the source segment.
      const wantsRich = /rich|render/.test(haystack);
      const isSourceSegment = /\bsource\b/.test(haystack) && !wantsRich;
      if (!wantsRich || isSourceSegment) continue;
      // Skip if the rich-diff segment is already active.
      const pressed = btn.getAttribute('aria-pressed') === 'true' ||
                      btn.getAttribute('aria-current') === 'true' ||
                      btn.getAttribute('aria-current') === 'page' ||
                      btn.classList.contains('selected') ||
                      btn.classList.contains('SegmentedControl-item--selected');
      if (pressed) return null;
      return btn;
    }
    return null;
  }

  // Click every .md file's "render rich-diff" toggle that isn't already
  // active. Returns the count of files that were flipped. The existing
  // global click handler picks up each click and re-runs
  // `buildThreadsSidebar` so the sidebar populates as files render.
  // Single pass: scan every rich-diff toggle currently in the DOM, click
  // each one that belongs to an unseen .md file. Returns the number of
  // clicks performed in this pass; populates `seen` so future passes
  // skip files we already handled (including ones that were already
  // pressed). Used by `flipAllMdToRichDiff` across multiple scroll steps.
  function clickRichTogglesOnce(seen) {
    const buttons = document.querySelectorAll('button, a[role="button"], [data-tab-item]');
    let count = 0;
    for (const btn of buttons) {
      if (!looksLikeDiffToggle(btn)) continue;
      const haystack = resolveButtonHaystack(btn);
      const wantsRich = /rich|render/.test(haystack);
      const isSourceSegment = /\bsource\b/.test(haystack) && !wantsRich;
      if (!wantsRich || isSourceSegment) continue;
      const container = btn.closest('div[id^="diff-"], [data-tagsearch-path], .file[data-path]');
      const path = container ? getContainerPath(container) : '';
      if (!isMarkdownPath(path)) continue;
      if (seen.has(path)) continue;
      const pressed = btn.getAttribute('aria-pressed') === 'true' ||
                      btn.getAttribute('aria-current') === 'true' ||
                      btn.getAttribute('aria-current') === 'page' ||
                      btn.classList.contains('selected') ||
                      btn.classList.contains('SegmentedControl-item--selected');
      seen.add(path);
      if (pressed) continue;
      console.log(`[GRDC]   CLICK ${path}`);
      btn.click();
      count++;
    }
    return count;
  }

  // Click every per-file "render rich-diff" toggle on the page whose
  // owning file container belongs to a Markdown file. GitHub lazy-renders
  // file headers as the user scrolls, so a single top-of-page scan only
  // sees the first ~2 toggles. We scroll the page in steps, scanning
  // after each step so newly-rendered file headers are caught, then
  // restore the user's original scroll position when done.
  async function flipAllMdToRichDiff() {
    const seen = new Set();
    let clicked = 0;
    const origScroll = window.scrollY;
    const docHeight = () => Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    );

    // Diagnostic: how many .md files does the page CLAIM to have?
    const expectedMd = (routeData?.diffSummaries || [])
      .filter(s => isMarkdownPath(s.path)).length;
    console.log(`[GRDC] flipAllMdToRichDiff: expecting ${expectedMd || '?'} md file(s)`);

    const overlay = document.createElement('div');
    overlay.className = 'grdc-render-overlay';
    overlay.innerHTML = '<div class="grdc-render-overlay-card">Rendering Markdown files as rich-diff…</div>';
    document.body.appendChild(overlay);

    try {
      // Two-phase approach:
      //
      //   Phase 1 — MOUNT: scroll the page top→bottom WITHOUT clicking
      //   anything. This forces every lazy-mounted file header into the
      //   DOM. Because we don't click during this phase, the page
      //   height doesn't change underneath us, so later files don't
      //   get jumped over.
      //
      //   Phase 2 — CLICK: scroll top→bottom again, this time clicking
      //   the rich-diff toggle on every Markdown file we encounter.
      //   Headers are already in the DOM from phase 1, so this pass is
      //   stable and reliable.
      //
      // Earlier versions tried multi-pass click-while-scrolling, but
      // every click expanded the file inline, shifting later files
      // down past the scroll cursor before their headers mounted.
      // Separating the phases sidesteps that race entirely.
      const dwell = 100;
      const step = Math.max(500, window.innerHeight * 0.8);

      // Phase 1: mount-only sweep. No clicks. Just scroll through the
      // whole document so GitHub's intersection observers mount every
      // file header.
      {
        let y = 0;
        let guard = 0;
        while (y < docHeight() && guard < 80) {
          window.scrollTo({ top: y, behavior: 'instant' });
          await new Promise((r) => setTimeout(r, dwell));
          y += step;
          guard++;
        }
        // Final touch at the very bottom for the last header.
        window.scrollTo({ top: docHeight(), behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 200));
        console.log(`[GRDC] flipAllMdToRichDiff: phase 1 (mount sweep) done`);
      }

      // Phase 2: click sweep. All headers should now be in the DOM, so
      // a single top→bottom pass with clicks is enough.
      {
        let y = 0;
        let guard = 0;
        // First scan from current position (bottom of doc) before
        // scrolling back to top — catches any toggles still in view.
        clicked += clickRichTogglesOnce(seen);
        window.scrollTo({ top: 0, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, dwell));
        clicked += clickRichTogglesOnce(seen);
        while (y < docHeight() && guard < 80) {
          if (expectedMd && seen.size >= expectedMd) break;
          window.scrollTo({ top: y, behavior: 'instant' });
          await new Promise((r) => setTimeout(r, dwell));
          clicked += clickRichTogglesOnce(seen);
          y += step;
          guard++;
        }
        console.log(`[GRDC] flipAllMdToRichDiff: phase 2 (click sweep) done — ${seen.size}/${expectedMd || '?'}`);
      }
    } finally {
      window.scrollTo({ top: origScroll, behavior: 'instant' });
      overlay.remove();
    }
    console.log(`[GRDC] flipAllMdToRichDiff: scanned ${seen.size}/${expectedMd || '?'} md file(s); clicked ${clicked}`);
    setTimeout(() => { try { buildThreadsSidebar(); } catch (_) {} }, 400);
    return clicked;
  }

  document.addEventListener('click', (e) => {
    if (!looksLikeDiffToggle(e.target)) return;
    // Refresh the threads sidebar after the toggle completes — when the
    // user switches to source-diff our threads stay in the DOM (just
    // hidden), so `buildThreadsSidebar` itself decides whether to keep
    // showing the sidebar based on whether `.prose-diff` is visible.
    // Wrapped in a short delay so GitHub's toggle handler finishes first.
    setTimeout(() => { try { buildThreadsSidebar(); } catch (_) {} }, 100);
    if (!sourceDiffDirty) {
      console.log('[GRDC] Diff-toggle clicked but no pending mutation — letting GitHub handle it normally.');
      return;
    }
    // The toggle is for the source-diff (we want to reload). Let GitHub's own
    // handler proceed first so the URL / hash updates; then reload to pick up
    // fresh thread state.
    console.log('[GRDC] Source-diff is stale after a mutation — reloading to sync.');
    sourceDiffDirty = false;
    // Small delay so any in-flight GitHub navigation completes before reload.
    setTimeout(() => window.location.reload(), 50);
  }, true);

  async function fetchRouteData() {
    if (routeData) return routeData;
    if (!prInfo) return null;

    try {
      const res = await fetch(
        `https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.pullNumber}/changes`,
        {
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'GitHub-Verified-Fetch': 'true',
          },
        }
      );
      if (res.ok) {
        const data = await res.json();
        routeData = data?.payload?.pullRequestsChangesRoute || null;

        // Build pathDigest → path mapping and path → changeType mapping.
        // `changeType` is "ADDED" / "MODIFIED" / "REMOVED" / "RENAMED" —
        // we use it in `buildChangesPane` to skip whole-new and whole-
        // deleted files (they're already labeled in the diff list).
        if (routeData?.diffSummaries) {
          routeData.diffSummaries.forEach(s => {
            pathDigestMap.set(s.pathDigest, s.path);
            if (s.path && s.changeType) {
              pathChangeTypeMap.set(s.path, s.changeType);
            }
          });
          console.log(`[GRDC] Path digest map: ${pathDigestMap.size} entries; changeType map: ${pathChangeTypeMap.size} entries`);
        }
      }
    } catch (e) {
      console.log('[GRDC] Failed to fetch route data:', e.message);
    }
    return routeData;
  }

  // A real file path: no newlines, reasonable length, no leading whitespace.
  // (Implementation lives in src/lib/responses.js — `looksLikePath` is destructured at top of file.)

  function getFilePath(container) {
    // Strategy 0: match container ID to pathDigest from diffSummaries
    const containerId = container.id || '';
    if (containerId.startsWith('diff-')) {
      for (const [digest, path] of pathDigestMap) {
        if (containerId.includes(digest)) {
          return path;
        }
      }
    }

    // Strategy 1: legacy data attributes
    let path = container.getAttribute("data-tagsearch-path") ||
      container.getAttribute("data-path");
    if (looksLikePath(path)) return path;

    // Strategy 2: clipboard-copy element — but ONLY direct children of the
    // file header, not nested code blocks (which also use clipboard-copy).
    // Restrict to copy buttons whose value matches a known diff path.
    const copyEls = container.querySelectorAll('clipboard-copy[value]');
    for (const el of copyEls) {
      const v = el.getAttribute('value');
      if (!looksLikePath(v)) continue;
      // Must match a known PR file path
      for (const [, p] of pathDigestMap) {
        if (p === v || p.endsWith('/' + v) || v === p) return p;
      }
    }

    // Strategy 3: file title link
    const titleLink = container.querySelector('a[title$=".md"], a[title$=".txt"], a[title$=".js"], a[title$=".ts"], a[title$=".py"]');
    if (titleLink) {
      const title = titleLink.getAttribute('title');
      if (looksLikePath(title)) {
        for (const [, p] of pathDigestMap) {
          if (p.endsWith(title)) return p;
        }
      }
    }

    return null;
  }

  // Cache of raw file sources: path → string
  const rawSourceCache = new Map();

  // `findFenceRangeAroundLine` lives in src/lib/codeBlocks.js. It walks the
  // raw markdown source for ``` / ~~~ fence pairs and returns the content
  // range (content-start .. content-end, 1-indexed) of the fence closest to
  // a target line within ±5 lines. Returns null if no fence is close enough.

  // findBlobInJson lives in src/lib/responses.js.

  async function fetchRawSource(container, path) {
    if (rawSourceCache.has(path)) return rawSourceCache.get(path);

    // Discover head commit SHA from route data or blob links
    let headOid = routeData?.comparison?.fullDiff?.headOid;
    if (!headOid) {
      const blobLink = container.querySelector('a[href*="/blob/"]');
      if (blobLink) {
        const m = blobLink.getAttribute('href').match(/\/blob\/([0-9a-f]{40})\//);
        if (m) headOid = m[1];
      }
    }
    if (!headOid || !prInfo || !looksLikePath(path)) return null;

    try {
      const blobUrl = `https://github.com/${prInfo.owner}/${prInfo.repo}/blob/${headOid}/${encodeURI(path)}`;
      const res = await fetch(blobUrl, { credentials: 'include' });
      if (!res.ok) {
        console.log(`[GRDC] Blob page fetch failed for ${path}: HTTP ${res.status}`);
        return null;
      }
      const html = await res.text();

      // Strategy A: read-only textarea (older blob views)
      let m = html.match(/<textarea[^>]*id=["']read-only-cursor-text-area["'][^>]*>([\s\S]*?)<\/textarea>/);
      if (m) {
        const div = document.createElement('div');
        div.innerHTML = m[1];
        const text = div.textContent || '';
        if (text) {
          rawSourceCache.set(path, text);
          console.log(`[GRDC] Fetched raw source via textarea for ${path}: ${text.length} chars`);
          return text;
        }
      }

      // Strategy B: any application/json embeddedData script may contain payload.blob
      const scriptRe = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/g;
      let scriptMatch;
      while ((scriptMatch = scriptRe.exec(html)) !== null) {
        // Quick filter: skip scripts that don't look promising
        if (!scriptMatch[1].includes('rawLines') && !scriptMatch[1].includes('rawBlob')) continue;
        try {
          const div = document.createElement('div');
          div.innerHTML = scriptMatch[1];
          const json = JSON.parse(div.textContent);
          // Walk the JSON tree looking for { rawLines: [...] } or { rawBlob: "..." }
          const found = findBlobInJson(json);
          if (found) {
            rawSourceCache.set(path, found);
            console.log(`[GRDC] Fetched raw source via embeddedData scan for ${path}: ${found.length} chars`);
            return found;
          }
        } catch (e) {
          // try next
        }
      }

      console.log(`[GRDC] Blob HTML for ${path} contained no recognizable raw source (length=${html.length})`);
      // Dump a sample so we can see what shape it is now
      if (!fetchRawSource._dumped) {
        fetchRawSource._dumped = true;
        // Find any application/json scripts
        const scripts = [...html.matchAll(/<script[^>]*type=["']application\/json["'][^>]*>/g)];
        console.log(`[GRDC] Blob HTML contains ${scripts.length} application/json scripts. Tags:`,
          scripts.slice(0, 5).map(s => s[0]));
      }
    } catch (e) {
      console.log(`[GRDC] Blob HTML error for ${path}:`, e.message);
    }

    return null;
  }

  // stripMarkdown / cleanRenderedText / buildSourceIndex / findLineAtOffset /
  // findTextInSource all live in src/lib/textMatch.js and are destructured at
  // the top of this file. See docs/APPROACH.md for the matching strategy.

  async function buildLineMap() {
    fileLineMap.clear();

    // Find all file containers (GitHub uses div[id^="diff-"] for each file)
    const fileContainers = document.querySelectorAll(
      'div[id^="diff-"], [data-tagsearch-path], .file[data-path]'
    );

    console.log(`[GRDC] Found ${fileContainers.length} file containers`);

    // ── Phase 1: discover eligible containers & prefetch raw sources in
    // parallel ────────────────────────────────────────────────────────────
    //
    // Previously this loop awaited `fetchRawSource(container, path)` inline,
    // which serialized N network round-trips (one per markdown file in the
    // PR) — on a multi-file PR that was the dominant init latency. We now
    // resolve each container's path + rich-diff root synchronously, kick off
    // every `fetchRawSource` concurrently, and `Promise.all` them before the
    // synchronous matching pass. Chrome caps same-origin parallelism at ~6
    // so we still play nicely with GitHub.
    const eligible = []; // { container, path, richDiff }
    for (const container of fileContainers) {
      const path = getFilePath(container);
      console.log(`[GRDC] Container path: ${path}`);
      if (!path) continue;

      // Find the rendered markdown body — ONLY in rich diff (prose-diff), not source diff
      const richDiff = container.querySelector('.prose-diff .markdown-body') ||
        container.querySelector('.prose-diff') ||
        container.querySelector('.rich-diff-level-one .markdown-body');
      if (!richDiff) continue;

      // Skip if this is a source diff view (has line number gutters).
      // Most common reason a user sees "Mapped 0 elements" — log once per session.
      if (container.querySelector('[data-line-number], .blob-num')) {
        if (!buildLineMap._loggedSourceDiff) {
          buildLineMap._loggedSourceDiff = true;
          console.log(`[GRDC] Skipping ${path}: source-diff view (toggle to rich diff to enable +)`);
        }
        continue;
      }

      eligible.push({ container, path, richDiff });
    }

    const rawSources = await Promise.all(
      eligible.map(({ container, path }) => fetchRawSource(container, path))
    );

    // ── Phase 2: synchronous per-file matching pass ───────────────────────
    // Delegates to `mapBlocksToSourceLines` (src/lib/lineMap.js). That
    // function is pure-DOM (no fetches, no module globals) so it can be
    // unit-tested with jsdom fixtures. See tests/lineMap.test.js for
    // regression coverage of every bug we've shipped in this code path
    // (YAML frontmatter, mermaid diagrams, deleted blocks, table rows).
    const deps = {
      buildSourceIndex,
      findTextInSource,
      computeTableRowLine,
      findFrontmatterRange,
    };
    eligible.forEach(({ path, richDiff }, idx) => {
      findTextInSource._logCount = 0; // reset per-file diagnostic counter
      const rawSource = rawSources[idx];
      const sourceLines = rawSource ? rawSource.split('\n') : null;
      const perFileMap = mapBlocksToSourceLines(richDiff, sourceLines, path, deps, console.log.bind(console));
      perFileMap.forEach((info, el) => fileLineMap.set(el, info));
    });
  }

  // `estimateLines`, `isDiagramBlock`, `isInDeletedBlock`, and `buttonAnchor`
  // moved to src/lib/lineMap.js (alongside the per-file matching loop they
  // belong to). Destructured at the top of this file so they're still
  // available to the rest of content.js.

  // ── UI: Comment Buttons ────────────────────────────────────────────────────

  // Walk up from `node` and find the topmost ancestor that paints an
  // underline — in practice GitHub's prose-diff renders inserted blocks as
  // `<ins>` (sometimes `<u>`). CSS text-decoration set on an ancestor is
  // PAINTED across all inline descendants regardless of the descendant's
  // own `text-decoration` value — so when GitHub renders an inserted
  // paragraph as `<ins><p>...</p></ins>` and we insert our comment box after
  // the `<p>`, the box still lives inside the `<ins>` and every text run
  // inside it gets underlined. Returning the topmost underlined ancestor
  // lets the caller insert AFTER it instead, so our injected UI is fully
  // outside the underline-painting scope.
  //
  // The walk is bounded by `.markdown-body` / `.rich-diff-level-one` /
  // `<body>` so we never escape the diff container itself.
  //
  // Performance note: we deliberately use a cheap `tagName` check only, no
  // `getComputedStyle` — a prior version of this function called
  // `getComputedStyle` as a fallback on every ancestor, which triggered a
  // style/layout recalc per call. With ~50 threads on a page each calling
  // `siblingAnchor()` during render, the recalcs added up to a visible
  // pause. The tag check covers every case we've actually seen in
  // production. If a new GitHub markup uses `text-decoration: underline` on
  // some other tag (e.g. `<span class="diff-added">`) we can add it here
  // explicitly without paying the getComputedStyle cost.
  function topUnderlinedAncestor(node) {
    let top = null;
    let cur = node && node.parentElement;
    while (cur && cur !== document.body) {
      if (cur.classList && (cur.classList.contains('markdown-body') ||
                            cur.classList.contains('rich-diff-level-one'))) {
        break;
      }
      const tag = cur.tagName;
      // <ins>/<u>/.added paint underline; <del>/<s>/.removed paint line-through.
      // Both propagate to descendants via CSS text-decoration, so our injected
      // UI inherits the strike/underline if we insert .after() inside their
      // scope. Escaping to the topmost such ancestor lets the caller place
      // the box outside the painting scope entirely.
      if (tag === 'INS' || tag === 'U' || tag === 'DEL' || tag === 'S') {
        top = cur;
      } else if (cur.classList && (cur.classList.contains('removed') ||
                                   cur.classList.contains('added'))) {
        top = cur;
      }
      cur = cur.parentElement;
    }
    return top;
  }

  function siblingAnchor(element) {
    // For tables, hop out to the parent <table> (a <div> between rows is
    // illegal HTML and gets repaired/scrambled by the parser).
    if (element.tagName === 'TR') {
      const table = element.closest('table') || element;
      return topUnderlinedAncestor(table) || table;
    }
    // For <li> that contains a nested <ul>/<ol>, anchor right BEFORE the
    // nested list so threads / comment boxes appear directly under the
    // parent's own text, not after the entire nested subtree. We return a
    // proxy whose `.after()` inserts the new node as the previous sibling of
    // the nested list (i.e. inside the <li>, after the parent's direct text
    // and before any children).
    //
    // Note: we deliberately skip the underline-ancestor escape for this
    // case because the proxy's whole purpose is to keep the insertion
    // INSIDE the <li>. If the <li> itself sits inside an <ins>, the box
    // will still inherit the underline — but in practice GitHub's
    // prose-diff wraps each <li>'s text in an <ins> rather than the whole
    // list, so this is rare.
    if (element.tagName === 'LI') {
      const nested = element.querySelector(':scope > ul, :scope > ol');
      if (nested) {
        return {
          after(node) { nested.parentNode.insertBefore(node, nested); },
          // querySelectorAll on the document still finds inserted threads;
          // expose `nextElementSibling` so the order-preserving insert in
          // renderThreadOnElement can chain after prior peer threads.
          get nextElementSibling() { return nested.previousElementSibling; },
        };
      }
      // No nested list: anchor INSIDE the <li> at its end. We deliberately
      // skip the underline-ancestor escape here because escaping would jump
      // out past the parent <ul>/<ol> when GitHub wraps the whole list in
      // <ins> or `.added`/`.removed` — placing the thread after the entire
      // list instead of under this specific item. Keeping the insertion
      // inside the <li> preserves per-item anchoring; in practice GitHub
      // wraps each <li>'s text (not the whole list) in <ins>, so the
      // injected box doesn't visibly inherit the underline.
      return {
        after(node) { element.appendChild(node); },
        get nextElementSibling() { return element.lastElementChild; },
      };
    }
    // Default path: if `element` sits inside an `<ins>` / `<u>` / other
    // underlined ancestor (GitHub's prose-diff wraps inserted blocks this
    // way), escape to the topmost such ancestor so `.after()` lands the
    // injected node OUTSIDE the underline-painting scope.
    return topUnderlinedAncestor(element) || element;
  }

  // Tracks an in-progress range selection (mousedown on `+` → mouseup on
  // another `+`). Matches GitHub's source-diff gesture: drag the `+` icon
  // from the start line down to the end line.
  let dragAnchor = null; // { element, info } or null

  function attachCommentButtons() {
    // Remove existing buttons first
    document.querySelectorAll(".grdc-comment-btn").forEach((el) => el.remove());
    document.querySelectorAll(".grdc-hoverable").forEach((el) => {
      el.classList.remove("grdc-hoverable");
    });

    fileLineMap.forEach((info, element) => {
      const host = buttonAnchor(element);
      host.classList.add("grdc-hoverable");

      const btn = document.createElement("button");
      btn.className = "grdc-comment-btn";
      // Use an inline SVG `+` icon instead of the `+` text character: the
      // glyph's optical center sits above its typographic center in most
      // fonts, so even with flex-centering the text version looks high. An
      // SVG centered at viewBox (7,7) is dead-center inside its 14×14 box.
      btn.innerHTML = '<svg viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      btn.title = `Comment on ${info.path}:${info.line}\nDrag down to another + to comment on a range`;

      // Range gesture: mousedown records the anchor, mouseup on another `+`
      // opens a range box. Plain click (mousedown + mouseup on the same `+`)
      // falls through to a single-line box via the click handler below.
      btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // left button only
        dragAnchor = { element, info };
        // No tinting yet — set on the first mouseover of a different `+`.
      });

      btn.addEventListener('mouseup', (e) => {
        if (e.button !== 0) return;
        if (!dragAnchor) return;
        // mouseup on the same button = ordinary click; let the click handler take it.
        if (dragAnchor.element === element) return;
        // Different file? Bail — GitHub doesn't allow cross-file ranges.
        if (dragAnchor.info.path !== info.path) {
          clearDragHover();
          dragAnchor = null;
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        const startInfo = dragAnchor.info;
        const startEl = dragAnchor.element;
        const endInfo = info;
        const endEl = element;
        clearDragHover();
        dragAnchor = null;
        // Normalize so start <= end.
        const startLine = Math.min(startInfo.line, endInfo.line);
        const endLine = Math.max(startInfo.line, endInfo.line);
        const anchorEl = startInfo.line <= endInfo.line ? startEl : endEl;
        openCommentBox(anchorEl, {
          path: info.path,
          line: endLine,
          startLine: startLine,
        });
      });

      // Hover preview while dragging: highlight every mapped block between
      // the anchor line and the currently-hovered `+` line (inclusive). This
      // gives the same "yellow band" visualization GitHub's source-diff uses
      // when you drag down to extend a range.
      btn.addEventListener('mouseenter', () => {
        if (dragAnchor && dragAnchor.info.path === info.path) {
          paintRangeHover(dragAnchor.info.line, info.line, info.path);
        }
      });

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // If we just finished a drag (different start vs. end), mouseup already
        // handled it. Plain click only opens single-line.
        if (dragAnchor && dragAnchor.element !== element) {
          dragAnchor = null;
          return;
        }
        dragAnchor = null;
        // For <pre> code blocks, the button may have been slid vertically to
        // follow the cursor; the resolved line lives on the button's dataset.
        // Override info.line with that value so the comment box opens on the
        // user's actual click position, not the fence's start line. Keep the
        // block's original mapped start as `blockStartLine` so the hint can
        // always show the full code-block range regardless of the click row.
        //
        // If no dataset.grdcLine is present (e.g. user clicked the `+` without
        // moving the cursor inside the block first) but this is a `<pre>`
        // whose `info.line` points at the fence, fall back to the first
        // content line from the raw source.
        const overrideLine = btn.dataset.grdcLine ? parseInt(btn.dataset.grdcLine, 10) : null;
        let effectiveLine = overrideLine || info.line;
        if (element.tagName === 'PRE' && !overrideLine) {
          const raw = rawSourceCache.get(info.path);
          const fr = raw ? findFenceRangeAroundLine(raw, info.line) : null;
          if (fr && info.line < fr.start) effectiveLine = fr.start;
        }
        const effectiveInfo = effectiveLine !== info.line
          ? { ...info, line: effectiveLine, blockStartLine: info.line }
          : { ...info, blockStartLine: info.line };
        openCommentBox(element, effectiveInfo);
      });

      // Code-block per-line targeting: when the user hovers anywhere inside a
      // `<pre>`, slide the `+` button vertically to follow the cursor's row
      // (snapped to line height, centered on the row) and update the resolved
      // line on the button. Click then opens a comment box anchored to the
      // hovered line instead of always the fence's first line. We don't
      // inject per-line `+`s because that would break GitHub's syntax-
      // highlighting span structure.
      if (element.tagName === 'PRE') {
        // GitHub's highlighted `<code>` is `display: inline` and has no usable
        // box of its own (`getBoundingClientRect()` returns 0,0,0,0). So we
        // measure from <pre> directly and use `innerText` for the line count
        // (innerText reflects what's actually rendered; `textContent` includes
        // phantom newlines from highlight spans).
        const cs = getComputedStyle(element);
        const lh = parseFloat(cs.lineHeight);
        const lineHeight = Number.isFinite(lh) && lh > 0 ? lh : 18;
        const preTopPad = parseFloat(cs.paddingTop) || 0;
        const lines = (element.innerText || '').replace(/\n+$/, '').split('\n');
        const renderedLineCount = Math.max(1, lines.length);
        // Resolve the actual fence range from the raw source so click-Y →
        // line uses the first content line as row 0 (instead of the fence
        // line). Without this, clicking the first visible code line returns
        // `info.line + 0` = the fence line, which 422s or anchors wrong.
        const rawSourceForBlock = rawSourceCache.get(info.path);
        const fenceRange = rawSourceForBlock
          ? findFenceRangeAroundLine(rawSourceForBlock, info.blockStartLine != null ? info.blockStartLine : info.line)
          : null;
        const baseLine = fenceRange ? fenceRange.start : info.line;
        const lastLine = fenceRange ? fenceRange.end : (info.line + renderedLineCount - 1);

        const onMove = (e) => {
          const preRect = element.getBoundingClientRect();
          // Y inside <pre>'s padded content (account for scroll).
          const yInPre = e.clientY - preRect.top + element.scrollTop;
          const yInText = yInPre - preTopPad;
          let rowIdx = Math.floor(yInText / lineHeight);
          if (rowIdx < 0) rowIdx = 0;
          if (rowIdx >= renderedLineCount) rowIdx = renderedLineCount - 1;
          // Row center in <pre>'s coord space, minus scroll:
          const rowCenter =
            preTopPad + (rowIdx + 0.5) * lineHeight - element.scrollTop;
          btn.style.top = rowCenter + 'px';
          btn.style.transform = 'translateY(-50%)';
          // Resolved line: row 0 = baseLine (first content line, not fence).
          // Clamp to the fence's end so trailing rendered rows past the close
          // don't overshoot.
          let resolvedLine = baseLine + rowIdx;
          if (resolvedLine > lastLine) resolvedLine = lastLine;
          btn.dataset.grdcLine = String(resolvedLine);
          btn.title = `Comment on ${info.path}:${resolvedLine}\nMove cursor up/down to pick line; click to comment`;
        };
        element.addEventListener('mousemove', onMove);
        element.addEventListener('mouseleave', () => {
          delete btn.dataset.grdcLine;
        });
      }

      host.prepend(btn);
    });
  }

  function clearDragHover() {
    document.querySelectorAll('.grdc-range-hover').forEach((el) => el.classList.remove('grdc-range-hover'));
  }

  // Paint the highlight band across every mapped block in `path` whose line
  // is between `anchorLine` and `hoverLine` (inclusive, order-independent).
  function paintRangeHover(anchorLine, hoverLine, path) {
    const lo = Math.min(anchorLine, hoverLine);
    const hi = Math.max(anchorLine, hoverLine);
    clearDragHover();
    fileLineMap.forEach((info, el) => {
      if (info.path !== path) return;
      if (info.line < lo || info.line > hi) return;
      buttonAnchor(el).classList.add('grdc-range-hover');
    });
  }

  // Find the mapped block under `target` (or null). Walks up the DOM looking
  // for an element registered in fileLineMap. Used by drag-to-line so the
  // user can release the drag on the rendered prose, not just the `+` button.
  function findMappedBlockFromTarget(target) {
    if (!target || target.nodeType !== 1) return null;
    let el = target;
    while (el && el !== document.body) {
      if (fileLineMap.has(el)) return { element: el, info: fileLineMap.get(el) };
      // <tr> buttons live inside a <td> — climb to the row.
      if (el.tagName === 'TD' || el.tagName === 'TH') {
        const tr = el.closest('tr');
        if (tr && fileLineMap.has(tr)) return { element: tr, info: fileLineMap.get(tr) };
      }
      el = el.parentElement;
    }
    return null;
  }

  // Document-level mouseup: also fires when the user releases anywhere on a
  // rendered block (not just on a `+` button). Resolves the release target
  // to its mapped block and opens the range box. Falls through to cancel if
  // the release target isn't in any mapped block.
  document.addEventListener('mouseup', (e) => {
    if (!dragAnchor) return;
    // The `+` mouseup handler already handles `+` → `+`. Skip if release is
    // on a `+` (it stopped the event itself, but be defensive).
    if (e.target instanceof Element && e.target.closest('.grdc-comment-btn')) {
      return;
    }
    const hit = findMappedBlockFromTarget(e.target);
    if (hit && hit.info.path === dragAnchor.info.path && hit.element !== dragAnchor.element) {
      const startInfo = dragAnchor.info;
      const startEl = dragAnchor.element;
      clearDragHover();
      dragAnchor = null;
      const startLine = Math.min(startInfo.line, hit.info.line);
      const endLine = Math.max(startInfo.line, hit.info.line);
      const anchorEl = startInfo.line <= hit.info.line ? startEl : hit.element;
      openCommentBox(anchorEl, {
        path: hit.info.path,
        line: endLine,
        startLine: startLine,
      });
      return;
    }
    // Released outside any mapped block → cancel.
    setTimeout(() => {
      clearDragHover();
      dragAnchor = null;
    }, 0);
  });

  // Track range hover during the drag wherever the cursor is, not only on
  // `+` buttons. Updates the yellow highlight band live while the user drags
  // through prose.
  document.addEventListener('mousemove', (e) => {
    if (!dragAnchor) return;
    const hit = findMappedBlockFromTarget(e.target);
    if (!hit || hit.info.path !== dragAnchor.info.path) return;
    paintRangeHover(dragAnchor.info.line, hit.info.line, hit.info.path);
  });

  // ── UI: Section Collapse ──────────────────────────────────────────────────
  //
  // Click a heading (H1–H6) to hide every sibling element after it up to the
  // next heading of equal or higher level. Click again to expand. State is
  // per-heading, in-memory only (lost on page reload by design — the typical
  // session is short and persisting it would need IndexedDB).

  // Track which headings are collapsed by element so re-renders preserve state.
  const collapsedHeadings = new WeakSet();

  // Attach a collapse toggle (chevron button) to a single heading, idempotently.
  // Returns the toggle element (existing or newly-attached). Safe to call any
  // time — used both by the bulk `attachCollapseToggles` pass during init and
  // as a lazy fallback at click time from Outline-pane handlers, which can
  // run against headings whose `fileLineMap` entry has gone stale (GitHub
  // re-rendered the prose-diff DOM, MutationObserver missed it, etc.).
  // Without this fallback, those clicks silently no-op via `?.click()` on a
  // missing chevron — "Fold H1 / H2 / H3 do nothing until I refresh".
  function ensureCollapseToggle(element) {
    if (!element || !/^H[1-6]$/.test(element.tagName)) return null;
    const existing = element.querySelector(':scope > .grdc-collapse-toggle');
    if (existing) return existing;

    const toggle = document.createElement('button');
    toggle.className = 'grdc-collapse-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Collapse section');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.title = 'Collapse section (click to hide everything until the next heading of the same or higher level)';
    // Down chevron when expanded, right chevron when collapsed.
    toggle.textContent = '▾';
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSection(element, toggle);
    });

    element.classList.add('grdc-collapsible');
    // Prepend so it sits flush before the heading text.
    element.prepend(toggle);

    // Restore prior state on re-init (e.g. after SPA navigation).
    if (collapsedHeadings.has(element)) {
      applyCollapseVisuals(element, toggle, true);
    }
    return toggle;
  }

  function attachCollapseToggles() {
    document.querySelectorAll('.grdc-collapse-toggle').forEach((el) => el.remove());

    // Headings live inside the rich-diff prose containers. We only care about
    // headings that are mapped (i.e. in `fileLineMap`) so collapse buttons
    // don't appear on non-rich-diff views.
    fileLineMap.forEach((info, element) => {
      ensureCollapseToggle(element);
    });
  }

  // Headings of equal or higher level (smaller numeric level = higher) bound
  // a collapsed section. e.g. an H3 collapse hides everything up to the next
  // H1 / H2 / H3.
  function headingLevel(el) {
    const m = el.tagName.match(/^H([1-6])$/);
    return m ? parseInt(m[1], 10) : null;
  }

  // Return every following-sibling element under `heading`'s direct parent up
  // to (but not including) the next heading at level <= heading's level.
  // Should an element be skipped entirely by the collapse walk? Our own
  // injected thread badges, comment boxes, and reply boxes don't count as
  // "section content" — they live alongside it and should remain visible
  // when their parent section is collapsed (a collapsed section visually
  // dims its heading; the thread still anchors to the heading's position).
  function isOurInjectedNode(el) {
    if (!el || el.nodeType !== 1) return false;
    const cl = el.classList;
    if (!cl) return false;
    return cl.contains('grdc-existing-thread') ||
           cl.contains('grdc-comment-box') ||
           cl.contains('grdc-reply-box') ||
           cl.contains('grdc-comment-btn');
  }

  // GitHub's prose-diff sometimes wraps the heading and its body in the same
  // container; sometimes they live in adjacent containers. We try direct
  // siblings first; if none, walk through the parent's next-sibling chain too.
  // Walker logic lives in src/lib/sectionCollapse.js so it can be unit-tested
  // against a fake DOM without jsdom.
  function siblingsToHide(heading) {
    return window.GRDC.collectSiblingsToHide(heading, { isInjected: isOurInjectedNode });
  }

  function applyCollapseVisuals(heading, toggle, collapsed) {
    const siblings = siblingsToHide(heading);
    siblings.forEach((el) => {
      if (collapsed) el.classList.add('grdc-collapsed-hidden');
      else el.classList.remove('grdc-collapsed-hidden');
    });

    // Fold any of OUR injected chrome that lives within the section so it
    // doesn't dangle visibly: collapse thread bodies down to the badge, and
    // remove any open comment/reply box. (Thread badges themselves stay so
    // the user still sees "this section has comments".) On expand, restore
    // the thread bodies we folded.
    if (collapsed) foldInjectedInSection(heading);
    else restoreInjectedInSection(heading);

    heading.classList.toggle('grdc-section-collapsed', collapsed);
    toggle.textContent = collapsed ? '▸' : '▾';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expand section' : 'Collapse section');
  }

  // Collect every element that belongs to `heading`'s section, INCLUDING
  // our own injected nodes (which `siblingsToHide` filters out). Used by
  // fold/restore to find thread bodies and comment boxes inside the section.
  // Walker logic lives in src/lib/sectionCollapse.js — see siblingsToHide.
  function sectionRoots(heading) {
    return window.GRDC.collectSectionRoots(heading, { isInjected: isOurInjectedNode });
  }

  // Fold our injected chrome inside a collapsed section: thread bodies close
  // (and get tagged so we know to reopen them on expand), comment / reply
  // boxes are removed entirely (their transient state can't be restored).
  function foldInjectedInSection(heading) {
    sectionRoots(heading).forEach((root) => {
      // Thread bodies: close any that are currently open, tag them so restore
      // can reopen exactly those.
      const threads = root.classList?.contains('grdc-existing-thread')
        ? [root]
        : Array.from(root.querySelectorAll?.('.grdc-existing-thread') || []);
      threads.forEach((t) => {
        const body = t.querySelector('.grdc-thread-body');
        if (!body) return;
        const wasOpen = body.style.display !== 'none';
        if (wasOpen) t.dataset.grdcWasOpen = '1';
        body.style.display = 'none';
      });
      // Remove any open comment/reply boxes.
      const boxes = root.classList?.contains('grdc-comment-box') ||
                    root.classList?.contains('grdc-reply-box')
        ? [root]
        : Array.from(root.querySelectorAll?.('.grdc-comment-box, .grdc-reply-box') || []);
      boxes.forEach((b) => b.remove());
    });
  }

  // Re-open any thread bodies we previously folded when this section was
  // collapsed. Threads that were already closed when the user collapsed stay
  // closed.
  function restoreInjectedInSection(heading) {
    sectionRoots(heading).forEach((root) => {
      const threads = root.classList?.contains('grdc-existing-thread')
        ? [root]
        : Array.from(root.querySelectorAll?.('.grdc-existing-thread') || []);
      threads.forEach((t) => {
        if (t.dataset.grdcWasOpen === '1') {
          const body = t.querySelector('.grdc-thread-body');
          if (body) body.style.display = 'block';
          delete t.dataset.grdcWasOpen;
        }
      });
    });
  }

  function toggleSection(heading, toggle) {
    const willCollapse = !collapsedHeadings.has(heading);
    if (willCollapse) collapsedHeadings.add(heading);
    else collapsedHeadings.delete(heading);
    applyCollapseVisuals(heading, toggle, willCollapse);
    // Notify other UI (e.g. the threads sidebar's Outline pane) so it can
    // mirror the new state \u2014 hide children rows of a collapsed section,
    // refresh chevrons, update Fold/Unfold button labels.
    document.dispatchEvent(new CustomEvent('grdc-section-toggled', {
      detail: { heading, collapsed: willCollapse },
    }));
  }

  // ── UI: Comment Box ────────────────────────────────────────────────────────

  // `renderMarkdownPreview` lives in src/lib/markdownPreview.js (destructured at top).
  // It's an offline fallback only — the Preview tab calls GitHub's own
  // /preview endpoint first for full GFM (tables, task lists, emoji, mentions).

  // Build a textarea with GitHub-style toolbar, Write/Preview tabs, auto-grow,
  // and Cmd/Ctrl+Enter submit. Returns { root, textarea, focus }.
  //
  // Why we build our own instead of cloning GitHub's native form: GitHub's
  // comment box is rendered with Primer React (`prc-*` classes), and the
  // toolbar / mention / upload / preview behaviors all depend on React
  // contexts that don't survive a `cloneNode(true)`. See docs/FEATURES.md
  // → "Why we don't clone GitHub's native form".
  function buildEditor(opts) {
    opts = opts || {};
    const minRows = opts.minRows || 3;
    const onSubmit = opts.onSubmit || (() => {});
    const placeholder = opts.placeholder || 'Leave a comment...';

    const root = document.createElement('div');
    root.className = 'grdc-editor';
    root.innerHTML = `
      <div class="grdc-editor-tabs" role="tablist">
        <button type="button" class="grdc-tab grdc-tab-active" data-grdc-tab="write" role="tab" aria-selected="true">Write</button>
        <button type="button" class="grdc-tab" data-grdc-tab="preview" role="tab" aria-selected="false">Preview</button>
      </div>
      <div class="grdc-editor-toolbar" role="toolbar" aria-label="Markdown formatting">
        <button type="button" class="grdc-tb-btn" data-grdc-md="heading"     title="Heading">H</button>
        <button type="button" class="grdc-tb-btn" data-grdc-md="bold"        title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" class="grdc-tb-btn" data-grdc-md="italic"      title="Italic (Ctrl+I)"><i>I</i></button>
        <button type="button" class="grdc-tb-btn" data-grdc-md="code"        title="Inline code">&lt;&gt;</button>
        <span class="grdc-tb-sep"></span>
        <button type="button" class="grdc-tb-btn" data-grdc-md="link"        title="Link">🔗</button>
        <button type="button" class="grdc-tb-btn" data-grdc-md="quote"       title="Quote">❝</button>
        <span class="grdc-tb-sep"></span>
        <button type="button" class="grdc-tb-btn" data-grdc-md="ul"          title="Unordered list">• ☰</button>
        <button type="button" class="grdc-tb-btn" data-grdc-md="ol"          title="Numbered list">1. ☰</button>
        <button type="button" class="grdc-tb-btn" data-grdc-md="task"        title="Task list">☐ ☰</button>
      </div>
      <textarea class="grdc-editor-textarea" rows="${minRows}" placeholder="${placeholder.replace(/"/g, '&quot;')}"></textarea>
      <div class="grdc-editor-preview markdown-body" hidden></div>
    `;

    const textarea = root.querySelector('.grdc-editor-textarea');
    const preview = root.querySelector('.grdc-editor-preview');
    const toolbar = root.querySelector('.grdc-editor-toolbar');
    const tabs = root.querySelectorAll('.grdc-tab');

    // Auto-grow: re-fit on every input, capped so it can't push the page around.
    const MAX_PX = 400;
    const autoGrow = () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, MAX_PX) + 'px';
    };
    textarea.addEventListener('input', autoGrow);

    // Cmd+Enter (Mac) / Ctrl+Enter (Win/Linux) submits.
    textarea.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        onSubmit();
      }
    });

    // Write / Preview tab switching. The Preview tab tries GitHub's own
    // markdown renderer first (full GFM: tables, task lists, emoji, mentions),
    // falling back to our local inline renderer if it fails.
    async function switchTab(name) {
      const isPreview = name === 'preview';
      tabs.forEach((t) => {
        const active = t.dataset.grdcTab === name;
        t.classList.toggle('grdc-tab-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      toolbar.hidden = isPreview;
      textarea.hidden = isPreview;
      preview.hidden = !isPreview;
      if (!isPreview) return;

      const src = textarea.value;
      preview.innerHTML = '<p class="grdc-preview-empty">Loading preview…</p>';
      const html = await renderPreviewViaGitHub(src);
      // The user may have switched back to Write while we were waiting; only
      // paint if Preview is still active.
      if (preview.hidden) return;
      preview.innerHTML = html != null && html.trim()
        ? html
        : renderMarkdownPreview(src);
    }
    tabs.forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.grdcTab)));

    // Selection-wrap helper for toolbar buttons.
    function wrapSelection(before, after, opts) {
      opts = opts || {};
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      const selected = value.slice(start, end);

      let inserted;
      if (opts.linePrefix) {
        // Prepend `before` to each line of the selection (or the current line if empty).
        const target = selected || value.slice(value.lastIndexOf('\n', start - 1) + 1, end) || '';
        inserted = target.split('\n').map(l => before + l).join('\n');
        textarea.setRangeText(inserted, start, end, 'end');
      } else {
        inserted = before + (selected || (opts.placeholder || '')) + after;
        textarea.setRangeText(inserted, start, end, 'end');
        if (!selected && opts.placeholder) {
          // Position cursor over the placeholder so user can type to replace it.
          const cursorStart = start + before.length;
          textarea.setSelectionRange(cursorStart, cursorStart + opts.placeholder.length);
        }
      }
      textarea.focus();
      autoGrow();
    }

    root.querySelectorAll('.grdc-tb-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const kind = btn.dataset.grdcMd;
        switch (kind) {
          case 'heading': wrapSelection('### ', '', { linePrefix: true }); break;
          case 'bold':    wrapSelection('**', '**', { placeholder: 'bold text' }); break;
          case 'italic':  wrapSelection('_',  '_',  { placeholder: 'italic text' }); break;
          case 'code':    wrapSelection('`',  '`',  { placeholder: 'code' }); break;
          case 'link':    wrapSelection('[',  '](url)', { placeholder: 'link text' }); break;
          case 'quote':   wrapSelection('> ', '',  { linePrefix: true }); break;
          case 'ul':      wrapSelection('- ', '',  { linePrefix: true }); break;
          case 'ol':      wrapSelection('1. ', '', { linePrefix: true }); break;
          case 'task':    wrapSelection('- [ ] ', '', { linePrefix: true }); break;
        }
      });
    });

    // Hook @-mention autocomplete onto the textarea. Dropdown anchors to the
    // editor root, which is positioned relatively via CSS.
    attachMentionsTo(textarea, root);

    return {
      root,
      textarea,
      focus: () => { textarea.focus(); autoGrow(); },
    };
  }

  function openCommentBox(element, info) {
    // Close any existing comment boxes
    document.querySelectorAll(".grdc-comment-box").forEach((el) => el.remove());

    // For <pre> code blocks, give a hint about the line range so the user
    // can pick the exact line to anchor the comment on.
    let lineHint = '';
    let maxLine = info.line;
    if (element.tagName === 'PRE') {
      // Find the actual code-block fence range from the raw markdown source.
      // This is more reliable than counting rendered lines via innerText (long
      // fences may be in a scroll container that doesn't render all rows) and
      // also correctly handles the case where info.line points at the fence
      // line itself vs. the first content line.
      const rawSource = rawSourceCache.get(info.path);
      let blockStart = info.blockStartLine != null ? info.blockStartLine : info.line;
      let blockEnd = blockStart;
      if (rawSource) {
        const range = findFenceRangeAroundLine(rawSource, info.blockStartLine != null ? info.blockStartLine : info.line);
        if (range) {
          blockStart = range.start;
          blockEnd = range.end;
        }
      }
      if (blockEnd === blockStart) {
        // Fallback: count innerText lines (less reliable, but better than nothing).
        const lines = (element.innerText || '').replace(/\n+$/, '').split('\n');
        blockEnd = blockStart + Math.max(0, lines.length - 1);
      }
      maxLine = blockEnd;
      lineHint = ` <span class="grdc-line-hint">(code block, lines ${blockStart}–${blockEnd})</span>`;
    }

    const box = document.createElement("div");
    box.className = "grdc-comment-box";

    // Header (file · line input · optional code-block hint).
    // When info.startLine is set, we're posting on a multi-line range — show
    // both inputs (start / end) and pass them through on submit.
    const isRange = info.startLine != null && info.startLine !== info.line;
    const header = document.createElement('div');
    header.className = 'grdc-line-info';
    if (isRange) {
      header.innerHTML = `
        ${escapeHtml(info.path)} · lines
        <input type="number" class="grdc-line-start-input" min="1" value="${info.startLine}" />
        –
        <input type="number" class="grdc-line-input" min="1" value="${info.line}" />
      `;
    } else {
      header.innerHTML = `
        ${escapeHtml(info.path)} · line
        <input type="number" class="grdc-line-input" min="1" value="${info.line}" />
        ${lineHint}
      `;
    }
    box.appendChild(header);

    // Submit handler (used by both button click and Cmd+Enter)
    let submitBtn; // forward decl so onSubmit can disable it
    let editor;    // forward decl so onSubmit can read the textarea
    const submit = async () => {
      const body = editor.textarea.value.trim();
      if (!body) return;
      const lineToPost = parseInt(box.querySelector('.grdc-line-input').value, 10) || info.line;
      const startInput = box.querySelector('.grdc-line-start-input');
      let startLineToPost = startInput ? parseInt(startInput.value, 10) || null : null;
      // Normalize: start must be <= end and must differ from end (GitHub rejects
      // start_line === line as "must be less than line").
      if (startLineToPost != null && startLineToPost >= lineToPost) {
        startLineToPost = null;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Posting...';

      const result = await postReviewComment(info.path, lineToPost, body, { startLine: startLineToPost });

      if (result.ok) {
        // Invalidate cached route data so any re-init (e.g. fired by GitHub's
        // own optimistic render of the same comment) re-fetches fresh threads
        // and doesn't wipe out our just-rendered inline render.
        invalidateRouteData();
        const newComments = threadResponseToComments(result.data, info.path, lineToPost, startLineToPost);
        if (newComments.length) {
          // For multi-line ranges, also tint every block in the range so the
          // user gets the same visual treatment as existing range threads.
          paintThreadRange(info.path, startLineToPost, lineToPost);
          // Anchor the badge at the START of the range. GitHub's source-diff
          // anchors at the end line, but in rich-diff there are no visible
          // line numbers — the badge needs to *introduce* the highlighted
          // range so the eye lands on it first, not after scrolling past the
          // whole tint band. `element` is the block the user clicked `+` on,
          // which for a drag-selected range is already the start block.
          renderThreadOnElement(element, newComments);
          buildThreadsSidebar();
        }
        const success = document.createElement('div');
        success.className = 'grdc-success';
        success.textContent = '✓ Comment posted';
        box.querySelector('.grdc-comment-actions').after(success);
        setTimeout(() => box.remove(), 1200);
      } else {
        const error = document.createElement('div');
        error.className = 'grdc-error';
        error.textContent = `✗ ${result.error}`;
        box.querySelector('.grdc-comment-actions').after(error);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Comment';
      }
    };

    editor = buildEditor({ placeholder: 'Leave a comment...', onSubmit: submit });
    box.appendChild(editor.root);

    const actions = document.createElement('div');
    actions.className = 'grdc-comment-actions';
    actions.innerHTML = `
      <button class="grdc-btn grdc-btn-cancel">Cancel</button>
      <button class="grdc-btn grdc-btn-primary" title="Ctrl/⌘ + Enter">Comment</button>
    `;
    box.appendChild(actions);

    element.after(box);
    // Move into a safe sibling slot if needed (e.g. <tr> → after <table>)
    const safe = siblingAnchor(element);
    if (safe !== element) safe.after(box);

    const cancelBtn = actions.querySelector('.grdc-btn-cancel');
    submitBtn = actions.querySelector('.grdc-btn-primary');

    cancelBtn.addEventListener('click', () => box.remove());
    submitBtn.addEventListener('click', submit);

    editor.focus();
  }

  // ── Existing Comments ───────────────────────────────────────────────────────

  let existingComments = []; // Array of { path, line, body, user, createdAt, htmlUrl }

  // threadResponseToComments lives in src/lib/responses.js.

  async function fetchExistingComments() {
    if (!prInfo) return [];

    const route = await fetchRouteData();
    if (!route) return [];

    const threads = route?.markers?.threads || {};
    const threadList = Object.values(threads);
    if (threadList.length === 0) return [];

    // Build threadId → { path, line, startLine?, side } from markersMap.
    // Lives in src/lib/responses.js. See that function's docstring for the
    // markersMap shape and the meaning of the `start: "R57"` range field.
    const threadLocation = parseMarkersMap(route.diffSummaries);

    if (threadLocation.size === 0) {
      const firstWith = (route.diffSummaries || []).find(s => s.markersMap && Object.keys(s.markersMap).length);
      if (firstWith) {
        // Dump first markersMap entry as JSON so we see the actual value shape
        const firstKey = Object.keys(firstWith.markersMap)[0];
        console.log('[GRDC] markersMap first entry JSON:', JSON.stringify(firstWith.markersMap[firstKey], null, 2));
      } else {
        console.log('[GRDC] No markersMap on any diffSummary');
      }
    }

    const comments = [];

    threadList.forEach(thread => {
      // Allow both single-line and multi-line review threads through.
      // Subject types from the route-data response (uppercase): "LINE", "MULTI_LINE",
      // "FILE" (whole-file — skip). Other types we treat as line-based.
      if (thread.subjectType === 'FILE') return;

      const loc = threadLocation.get(String(thread.id)) || {};
      const path = loc.path || null;
      const line = loc.line ?? null;
      // Multi-line range bounds come from the markersMap entry (see
      // threadLocation build above), NOT from the thread object — the thread
      // object only has `id, subjectType, isResolved, ...` and no range fields.
      const startLine = loc.startLine ?? null;

      const threadComments = thread.commentsData?.comments || thread.comments || [];

      // databaseId of the first comment is used as `in_reply_to` for replies
      const headDbId = threadComments[0]?.databaseId
        || threadComments[0]?.database_id
        || threadComments[0]?.id
        || null;

      threadComments.forEach((c, idx) => {
        comments.push({
          path,
          line,
          startLine,
          body: c.body || c.bodyText || '',
          bodyHTML: c.bodyHTML || c.body_html || '', // GitHub-rendered HTML (preferred for display)
          // `bodyVersion` is GitHub's per-comment hash used as a conflict
          // token on the update endpoint (PUT update_review_comment?body_version=...).
          // If the initial fetch doesn't include it, our edit endpoint
          // helper falls back to sha256(body) which matches in practice.
          bodyVersion: c.bodyVersion || c.body_version || null,
          user: c.author?.login || c.user?.login || 'unknown',
          // Avatar + role (Owner/Member/Collaborator/Contributor) for the
          // header. Both come from the same route-data payload as the body.
          // GraphQL uses camelCase (`avatarUrl`, `authorAssociation`), REST
          // uses snake_case — check both. Role is rendered as a pill via
          // CSS only when it's a meaningful label (NONE is suppressed).
          avatarUrl: c.author?.avatarUrl || c.author?.avatar_url || c.user?.avatar_url || c.user?.avatarUrl || '',
          authorAssociation: c.authorAssociation || c.author_association || '',
          createdAt: c.createdAt || c.publishedAt || c.created_at || '',
          htmlUrl: c.url || c.htmlUrl || c.html_url || '',
          threadId: thread.id,
          isResolved: !!thread.isResolved,
          isOutdated: !!(thread.isOutdated || thread.outdated),
          viewerCanReply: thread.viewerCanReply !== false, // default true
          viewerCanResolve: thread.viewerCanResolve !== false,
          headDbId,
          dbId: c.databaseId ?? c.database_id ?? c.id ?? null,
          isHead: idx === 0,
        });
      });
    });

    console.log(`[GRDC] route-data: ${threadList.length} threads, ${comments.length} comments (path: ${comments.filter(c => c.path).length}, line: ${comments.filter(c => c.line).length})`);
    return comments;
  }

  function renderExistingComments() {
    // Remove previous renders
    document.querySelectorAll('.grdc-existing-thread').forEach(el => el.remove());
    // Clear any range tints from a previous render so they don't accumulate.
    document.querySelectorAll('.grdc-thread-range').forEach(el => el.classList.remove('grdc-thread-range'));

    if (existingComments.length === 0) return;

    // Group comments by thread (replies with their parent)
    const threads = new Map();
    existingComments.forEach(c => {
      const key = c.threadId;
      if (!threads.has(key)) threads.set(key, []);
      threads.get(key).push(c);
    });

    // Build per-path sorted index of mapped blocks: path → [{ line, element }]
    const blocksByPath = new Map();
    fileLineMap.forEach((info, element) => {
      if (!blocksByPath.has(info.path)) blocksByPath.set(info.path, []);
      blocksByPath.get(info.path).push({ line: info.line, element });
    });
    blocksByPath.forEach(arr => arr.sort((a, b) => a.line - b.line));

    // For each thread, find nearest mapped block ≤ anchor line. For multi-line
    // ranges, anchor at the **start** line so the badge sits at the top of
    // the highlighted range. GitHub's source-diff anchors at the end line,
    // but rich-diff has no visible line numbers — the badge needs to introduce
    // the highlighted range, not conclude it. The yellow tint across
    // [startLine, endLine] still shows the full extent of the range.
    //
    // Sort threads so that when multiple threads share an anchor element
    // (tables, code blocks — both render the thread *after* the whole
    // container), they stack in a sensible order:
    //   primary: by anchor source line ascending
    //   secondary: by head comment's createdAt ascending
    // Lives in src/lib/codeBlocks.js; see that module's `sortThreadHeads`.
    const heads = Array.from(threads.values()).map(arr => arr[0]);
    const sortedHeads = sortThreadHeads(heads);
    const headToThread = new Map(heads.map(h => [h, threads.get(h.threadId)]));
    const threadsList = sortedHeads.map(h => headToThread.get(h));
    threadsList.forEach(comments => {
      const head = comments[0];
      const blocks = blocksByPath.get(head.path);
      if (!blocks || blocks.length === 0) return;

      // Anchor at the START line for multi-line threads so the badge sits at
      // the top of the highlighted range (rich-diff has no line numbers — the
      // badge needs to be the entry point into the range, not the terminator).
      // For single-line threads `head.startLine` is null, so we fall back to
      // `head.line`. The full range is still tinted via `paintThreadRange`
      // below so the user can see the extent of what the comment refers to.
      const anchorLine = head.startLine != null ? head.startLine : head.line;

      let target = blocks[0].element;
      if (anchorLine != null) {
        let best = blocks[0];
        for (const b of blocks) {
          if (b.line <= anchorLine) best = b;
          else break;
        }
        target = best.element;
      }

      // For ranges, also tint every block within [startLine, endLine] so the
      // range is visually obvious.
      paintThreadRange(head.path, head.startLine, head.line);

      renderThreadOnElement(target, comments);
    });

    const totalRendered = document.querySelectorAll('.grdc-existing-thread').length;
    console.log(`[GRDC] Rendered ${totalRendered} comment threads`);
  }

  // Add the persistent yellow left-bar to every mapped block whose line falls
  // inside [startLine, endLine] for the given path. No-op for single-line
  // threads (startLine == null or startLine == endLine).
  function paintThreadRange(path, startLine, endLine) {
    if (startLine == null || endLine == null || startLine === endLine) return;
    const lo = Math.min(startLine, endLine);
    const hi = Math.max(startLine, endLine);
    fileLineMap.forEach((info, el) => {
      if (info.path !== path) return;
      if (info.line < lo || info.line > hi) return;
      buttonAnchor(el).classList.add('grdc-thread-range');
    });
  }

  function renderThreadOnElement(element, comments) {
    const head = comments[0];
    const isResolved = !!head.isResolved;
    const isOutdated = !!head.isOutdated;
    const canReply = head.viewerCanReply !== false;
    const canResolve = head.viewerCanResolve !== false;
    const threadId = head.threadId;
    const headDbId = head.headDbId;

    const thread = document.createElement('div');
    thread.className = 'grdc-existing-thread' +
      (isResolved ? ' grdc-thread-resolved' : '') +
      (isOutdated ? ' grdc-thread-outdated' : '');

    const badge = document.createElement('div');
    badge.className = 'grdc-thread-badge';
    const stateBits = [];
    if (isResolved) stateBits.push('✓ resolved');
    if (isOutdated) stateBits.push('outdated');
    const stateLabel = stateBits.length ? ` · ${stateBits.join(' · ')}` : '';
    // Show the source-line range so multi-line threads ("Comment on R3-R7" in
    // GitHub's source-diff) are visually distinguishable from single-line ones.
    const startLineForBadge = head.startLine;
    const endLineForBadge = head.line;
    const lineLabel = (startLineForBadge != null && startLineForBadge !== endLineForBadge)
      ? ` · lines ${startLineForBadge}–${endLineForBadge}`
      : (endLineForBadge != null ? ` · line ${endLineForBadge}` : '');
    // Chevron + label. Chevron rotates -90° when the thread is collapsed
    // (CSS-driven, see `.grdc-thread-collapsed .grdc-thread-chevron`) so
    // the badge reads as a GitHub-style disclosure: `v open` ↔ `> closed`.
    // SVG chevron-down (Octicon shape) — sharper than the unicode glyph
    // and crisp at any zoom.
    badge.innerHTML = `<span class="grdc-thread-chevron" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M12.78 5.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 6.28a.75.75 0 0 1 1.06-1.06L8 8.94l3.72-3.72a.75.75 0 0 1 1.06 0Z"/></svg></span><span class="grdc-thread-label">${comments.length} comment${comments.length > 1 ? 's' : ''}${escapeHtml(lineLabel)}${escapeHtml(stateLabel)}</span>`;
    badge.addEventListener('click', () => {
      const body = thread.querySelector('.grdc-thread-body');
      const nowCollapsed = body.style.display !== 'none';
      body.style.display = nowCollapsed ? 'none' : 'block';
      thread.classList.toggle('grdc-thread-collapsed', nowCollapsed);
    });
    thread.appendChild(badge);

    const body = document.createElement('div');
    body.className = 'grdc-thread-body';
    // Auto-expand unresolved threads, keep resolved ones collapsed by default
    body.style.display = isResolved ? 'none' : 'block';
    if (isResolved) thread.classList.add('grdc-thread-collapsed');

    const commentList = document.createElement('div');
    commentList.className = 'grdc-thread-comments';
    body.appendChild(commentList);

    const renderComment = (c) => {
      const comment = document.createElement('div');
      comment.className = 'grdc-thread-comment';
      if (c.dbId != null) comment.dataset.grdcCommentDbid = String(c.dbId);
      const timeAgo = c.createdAt ? formatTimeAgo(c.createdAt) : '';
      // Use GitHub-rendered HTML when available (full GFM, tables, emoji, etc.).
      // Source is authenticated GitHub session, so it's the same trust level as
      // any other DOM we read off the page. Fall back to escaped plain body.
      const bodyMarkup = c.bodyHTML
        ? `<div class="grdc-comment-body markdown-body">${c.bodyHTML}</div>`
        : `<div class="grdc-comment-body">${escapeHtml(c.body || '')}</div>`;
      const viewerLogin = getViewerLogin();
      const isOwn = !!(c.dbId != null && viewerLogin && c.user && c.user.toLowerCase() === viewerLogin.toLowerCase());
      const menuMarkup = isOwn
        ? `<button class="grdc-comment-menu" title="More actions" aria-haspopup="true">⋯</button>`
        : '';
      // Direct "Edit" affordance for own comments — sits in the header next to
      // "GitHub ↗" so editing is one click (no `⋯` menu detour). Delete stays
      // inside `⋯` because it's destructive. Rendered as a `<button>` (not `<a>`)
      // because it has no destination — it just opens the inline editor in place.
      const editLinkMarkup = isOwn
        ? `<button class="grdc-comment-edit-link" title="Edit this comment">Edit</button>`
        : '';
      // "View on GitHub" lives in the header (next to the time) so it doesn't
      // take a full row below the body. Rendered as a small muted link via
      // `.grdc-comment-link` styles. Title attribute exposes the full URL on
      // hover so users still see where they're going.
      const linkMarkup = c.htmlUrl
        ? `<a class="grdc-comment-link" href="${escapeHtml(c.htmlUrl)}" target="_blank" rel="noopener" title="Open this comment on GitHub">GitHub ↗</a>`
        : '';
      // Avatar — 20×20 circle next to the username. Falls back to a
      // GitHub-hosted avatar URL by login if no explicit URL was captured.
      // The login-based URL (`https://avatars.githubusercontent.com/<login>`)
      // works for any public GitHub user without requiring API auth.
      const avatarSrc = c.avatarUrl ||
        (c.user && c.user !== 'unknown' ? `https://avatars.githubusercontent.com/${encodeURIComponent(c.user)}?s=40` : '');
      const avatarMarkup = avatarSrc
        ? `<img class="grdc-comment-avatar" src="${escapeHtml(avatarSrc)}" alt="" width="20" height="20">`
        : '';
      // Role pill — Owner / Member / Collaborator / Contributor /
      // First-time contributor / First-timer. Maps GitHub's
      // `author_association` enum to the same labels GitHub's native
      // source-diff thread renders. MANNEQUIN (migrated-account
      // placeholder) and NONE (no relationship) are suppressed — GitHub
      // doesn't show a pill for those either. Logic lives in
      // src/lib/roles.js so it can be unit-tested.
      const roleLabel = window.GRDC.roleLabel(c.authorAssociation);
      const roleMarkup = roleLabel
        ? `<span class="grdc-comment-role grdc-comment-role-${c.authorAssociation.toLowerCase()}">${roleLabel}</span>`
        : '';
      // "Author" pill — render when the comment author is the PR opener.
      // Separate from the role pill so both can appear (GitHub native UI
      // shows `Owner` `Author` together when the repo owner opens their
      // own PR). Same neutral chip styling as the role pill.
      const prAuthorLogin = getPRAuthorLogin();
      const isPRAuthor = window.GRDC.isPRAuthor(c.user, prAuthorLogin);
      const authorMarkup = isPRAuthor
        ? `<span class="grdc-comment-role grdc-comment-role-author">Author</span>`
        : '';
      comment.innerHTML = `
        <div class="grdc-comment-header">
          ${avatarMarkup}
          <strong>${escapeHtml(c.user)}</strong>
          ${roleMarkup}
          ${authorMarkup}
          <span class="grdc-comment-time">${escapeHtml(timeAgo)}</span>
          ${editLinkMarkup}
          ${linkMarkup}
          ${menuMarkup}
        </div>
        ${bodyMarkup}
      `;
      // Wire up edit / delete affordances for the user's own comments. Edit
      // is a direct one-click link in the header (`.grdc-comment-edit-link`);
      // Delete stays behind the `⋯` menu because it's destructive.
      if (isOwn) {
        const menuBtn = comment.querySelector('.grdc-comment-menu');
        const editLinkBtn = comment.querySelector('.grdc-comment-edit-link');
        const bodyEl = comment.querySelector('.grdc-comment-body');
        // Stash the original body text so edits hash it for `body_version`
        // and so Cancel can restore the rendered markup.
        const originalBody = c.body || '';
        const originalBodyHTML = bodyEl.innerHTML;
        let originalBodyText = originalBody;

        // Open the inline editor in place of the rendered body. Idempotent:
        // if an editor is already open in this comment, just refocus it so
        // a stray second click on Edit doesn't stack two editors.
        const openEditor = () => {
          const existing = comment.querySelector('.grdc-comment-edit');
          if (existing) {
            existing.querySelector('.grdc-editor-textarea')?.focus();
            return;
          }
          // Replace the rendered body with an inline editor.
          const editorWrap = document.createElement('div');
          editorWrap.className = 'grdc-comment-edit';
          let editor, saveBtn;
          const save = async () => {
            const text = editor.textarea.value.trim();
            if (!text) return;
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
            const result = await updateReviewComment(c.dbId, originalBodyText, text, c.bodyVersion);
            if (result.ok) {
              invalidateRouteData();
              // Update local snapshot so a second edit uses fresh values:
              // the response includes a NEW `bodyVersion` for the updated
              // body, plus the new body itself.
              originalBodyText = text;
              if (result.data?.bodyVersion) {
                c.bodyVersion = result.data.bodyVersion;
              }
              // Server returns the rendered HTML; prefer that. Otherwise
              // escape the text and replace the body.
              const newHTML =
                result.data?.bodyHTML ||
                result.data?.body_html ||
                result.data?.body ||
                null;
              bodyEl.innerHTML = newHTML
                ? newHTML
                : escapeHtml(text);
              editorWrap.remove();
              bodyEl.style.display = '';
              // Refresh the sidebar so the card snippet stays in sync
              // with the edited body (only matters when the edited
              // comment is the thread head, but scheduleReinit is
              // debounced + cheap so we run it unconditionally).
              scheduleReinit();
            } else {
              const err = document.createElement('div');
              err.className = 'grdc-error';
              err.textContent = `✗ ${result.error}`;
              editorWrap.appendChild(err);
              saveBtn.disabled = false;
              saveBtn.textContent = 'Save';
            }
          };
          editor = buildEditor({ placeholder: 'Edit comment...', minRows: 3, onSubmit: save });
          editor.textarea.value = originalBodyText;
          editorWrap.appendChild(editor.root);
          const actions = document.createElement('div');
          actions.className = 'grdc-comment-actions';
          actions.innerHTML = `
            <button class="grdc-btn grdc-btn-cancel grdc-edit-cancel">Cancel</button>
            <button class="grdc-btn grdc-btn-primary grdc-edit-save" title="Ctrl/⌘ + Enter">Save</button>
          `;
          editorWrap.appendChild(actions);
          bodyEl.style.display = 'none';
          bodyEl.after(editorWrap);
          saveBtn = editorWrap.querySelector('.grdc-edit-save');
          editorWrap.querySelector('.grdc-edit-cancel').addEventListener('click', () => {
            editorWrap.remove();
            bodyEl.style.display = '';
          });
          saveBtn.addEventListener('click', save);
          editor.focus();
        };

        // Direct Edit link in the header — peer affordance to `GitHub ↗`.
        if (editLinkBtn) {
          editLinkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close the `⋯` popover if it happens to be open — Edit is a
            // peer action, not a popover item, but we don't want a stale
            // popover hanging around once the editor takes focus. The popover's
            // own outside-click listener would normally handle this, but we
            // `stopPropagation()` above so it never fires.
            comment.querySelector('.grdc-comment-menu-popover')?.remove();
            openEditor();
          });
        }

        // `⋯` menu → Delete (with confirm). Edit was promoted out of this
        // popover to its own header link; only the destructive action stays
        // behind the extra click.
        menuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          let popover = comment.querySelector('.grdc-comment-menu-popover');
          if (popover) { popover.remove(); return; }
          popover = document.createElement('div');
          popover.className = 'grdc-comment-menu-popover';
          popover.innerHTML = `
            <button class="grdc-menu-item grdc-menu-delete">Delete</button>
          `;
          comment.querySelector('.grdc-comment-header').appendChild(popover);
          const closeMenu = () => popover.remove();
          // Close on outside click.
          setTimeout(() => {
            document.addEventListener('click', function onDoc(ev) {
              if (!popover.contains(ev.target) && ev.target !== menuBtn) {
                closeMenu();
                document.removeEventListener('click', onDoc);
              }
            });
          }, 0);

          popover.querySelector('.grdc-menu-delete').addEventListener('click', async () => {
            closeMenu();
            if (!confirm('Delete this comment?')) return;
            menuBtn.disabled = true;
            const result = await deleteReviewComment(c.dbId);
            if (result.ok) {
              invalidateRouteData();
              comment.remove();
              // If this was the last comment in the thread, remove the whole thread.
              if (!commentList.children.length) {
                thread.remove();
              }
              // Refresh the sidebar so the deleted comment / thread
              // disappears from the cards list (and the head snippet
              // updates if the deleted comment was the head).
              scheduleReinit();
            } else {
              menuBtn.disabled = false;
              const err = document.createElement('div');
              err.className = 'grdc-error';
              err.textContent = `✗ ${result.error}`;
              comment.appendChild(err);
            }
          });
        });
      }
      commentList.appendChild(comment);
    };

    comments.forEach(renderComment);

    // Thread actions (reply + resolve toggle)
    const actions = document.createElement('div');
    actions.className = 'grdc-thread-actions';

    if (canReply && headDbId) {
      const replyBtn = document.createElement('button');
      replyBtn.className = 'grdc-btn grdc-btn-cancel';
      replyBtn.textContent = 'Reply';
      replyBtn.addEventListener('click', () => {
        if (actions.querySelector('.grdc-reply-box')) return;
        const box = document.createElement('div');
        box.className = 'grdc-reply-box';

        let submitBtn;       // forward decl for use in submit handler
        let editor;          // forward decl

        const submit = async () => {
          const text = editor.textarea.value.trim();
          if (!text) return;
          submitBtn.disabled = true;
          submitBtn.textContent = 'Posting...';
          const result = await postReply(threadId, headDbId, text);
          if (result.ok) {
            // Invalidate route-data cache: GitHub's own React UI optimistically
            // inserts a new `.markdown-body` node which trips our mutation
            // observer and re-inits. Without invalidation, re-init repaints
            // threads from stale cached data and wipes our inline reply.
            invalidateRouteData();
            // Extract the newly-posted comment from the response and render it inline.
            const newComments = result.data?.thread?.commentsData?.comments
              || result.data?.commentsData?.comments
              || [];
            const existingCount = commentList.children.length;
            const fresh = newComments.slice(existingCount);
            if (fresh.length) {
              fresh.forEach(c => renderComment({
                body: c.body || c.bodyText || '',
                bodyHTML: c.bodyHTML || c.body_html || '',
                user: c.author?.login || c.user?.login || 'you',
                createdAt: c.createdAt || c.publishedAt || new Date().toISOString(),
                htmlUrl: c.url || c.htmlUrl || '',
              }));
            } else {
              // Fallback: render an optimistic local comment (no bodyHTML available)
              renderComment({
                body: text,
                user: 'you',
                createdAt: new Date().toISOString(),
                htmlUrl: '',
              });
            }
            box.remove();
            buildThreadsSidebar();
          } else {
            const err = document.createElement('div');
            err.className = 'grdc-error';
            err.textContent = `✗ ${result.error}`;
            box.appendChild(err);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Reply';
          }
        };

        editor = buildEditor({ placeholder: 'Write a reply...', minRows: 2, onSubmit: submit });
        box.appendChild(editor.root);

        const replyActions = document.createElement('div');
        replyActions.className = 'grdc-comment-actions';
        replyActions.innerHTML = `
          <button class="grdc-btn grdc-btn-cancel grdc-reply-cancel">Cancel</button>
          <button class="grdc-btn grdc-btn-primary grdc-reply-submit" title="Ctrl/⌘ + Enter">Reply</button>
        `;
        box.appendChild(replyActions);

        actions.appendChild(box);

        submitBtn = box.querySelector('.grdc-reply-submit');
        box.querySelector('.grdc-reply-cancel').addEventListener('click', () => box.remove());
        submitBtn.addEventListener('click', submit);
        editor.focus();
      });
      actions.appendChild(replyBtn);
    }

    if (canResolve) {
      // Track current state in a mutable cell so clicking Resolve→Unresolve→Resolve
      // toggles the action correctly. (Capturing `isResolved` once leaks the stale
      // initial value into every subsequent click → 401 "already resolved".)
      let currentResolved = isResolved;
      const resolveBtn = document.createElement('button');
      resolveBtn.className = 'grdc-btn grdc-btn-cancel';
      resolveBtn.textContent = currentResolved ? 'Unresolve' : 'Resolve';
      resolveBtn.addEventListener('click', async () => {
        resolveBtn.disabled = true;
        const orig = resolveBtn.textContent;
        resolveBtn.textContent = '...';
        const result = await setThreadResolved(threadId, !currentResolved);
        if (result.ok) {
          // Drop cached route data so a re-init reflects the new resolved state.
          invalidateRouteData();
          currentResolved = !currentResolved;
          resolveBtn.textContent = '✓';
          // Update visual state immediately
          thread.classList.toggle('grdc-thread-resolved', currentResolved);
          // Refresh the badge label so the "✓ resolved" tag appears /
          // disappears in sync with the class toggle. Without this, the
          // text built at initial render stays stale across toggles.
          const labelEl = badge.querySelector('.grdc-thread-label');
          if (labelEl) {
            const bits = [];
            if (currentResolved) bits.push('✓ resolved');
            if (isOutdated) bits.push('outdated');
            const newStateLabel = bits.length ? ` · ${bits.join(' · ')}` : '';
            labelEl.textContent = `${comments.length} comment${comments.length > 1 ? 's' : ''}${lineLabel}${newStateLabel}`;
          }
          // Collapse the thread body when resolving (matches initial-render
          // behavior where resolved threads start collapsed), expand on
          // unresolve so the user can see what they're un-resolving.
          if (body) body.style.display = currentResolved ? 'none' : 'block';
          // Refresh the sidebar so the card's "resolved" tag + filter
          // visibility (Unresolved-only) react to the toggle.
          buildThreadsSidebar();
          setTimeout(() => {
            resolveBtn.textContent = currentResolved ? 'Unresolve' : 'Resolve';
            resolveBtn.disabled = false;
          }, 1200);
        } else {
          const err = document.createElement('div');
          err.className = 'grdc-error';
          err.textContent = `✗ ${result.error}`;
          actions.appendChild(err);
          resolveBtn.textContent = orig;
          resolveBtn.disabled = false;
        }
      });
      actions.appendChild(resolveBtn);
    }

    if (actions.children.length) body.appendChild(actions);

    thread.appendChild(body);

    // Stack threads on the same anchor element by line number ascending
    // (oldest-on-top within the same line, newest-on-bottom; lower lines
    // above higher lines). Each thread is tagged with
    // `data-grdc-anchor="<path>:<line>:<startLine>"` so a fresh insert can
    // locate its position by parsing the line out of neighbouring threads.
    //
    // Two cases:
    //
    //   1. Same anchor key already exists (true peers — same path + line +
    //      startLine). Insert AFTER the last peer to preserve chronological
    //      order within that line.
    //
    //   2. No matching anchor key. We're a new line on this anchor element.
    //      Walk forward past our own injected siblings (`grdc-existing-thread`,
    //      `grdc-comment-box`, `grdc-reply-box`) and stop at the first
    //      existing thread whose line is strictly greater than ours — insert
    //      BEFORE it. If no such thread exists, append at the end of the
    //      stack. This keeps line 91 between line 90 and line 94 instead of
    //      tacking it on at the bottom (the previous walker just appended).
    const anchorKey = buildAnchorKey({ path: head.path, line: head.line, startLine: head.startLine });
    thread.dataset.grdcAnchor = anchorKey;
    // Stash sidebar-relevant metadata on the element so the threads sidebar
    // can read it without re-deriving from `existingComments`. Keeps the
    // sidebar a pure DOM consumer of `.grdc-existing-thread` elements.
    thread.dataset.grdcThreadId = String(threadId);
    thread.dataset.grdcUser = head.user || '';
    const snippet = buildSnippet(head.body, 80);
    thread.dataset.grdcSnippet = snippet;
    thread.dataset.grdcPath = head.path || '';
    thread.dataset.grdcLine = String(head.line ?? '');
    const peers = document.querySelectorAll(`.grdc-existing-thread[data-grdc-anchor="${CSS.escape(anchorKey)}"]`);
    if (peers.length > 0) {
      peers[peers.length - 1].after(thread);
    } else {
      const ownLine = head.line;
      const anchor = siblingAnchor(element);
      let insertBefore = null;
      let insertAfter = anchor;
      let walker = anchor.nextElementSibling;
      while (walker && walker.classList && (
        walker.classList.contains('grdc-existing-thread') ||
        walker.classList.contains('grdc-comment-box') ||
        walker.classList.contains('grdc-reply-box')
      )) {
        if (walker.classList.contains('grdc-existing-thread')) {
          const peerLine = parseLineFromAnchor(walker.dataset?.grdcAnchor || '');
          if (ownLine != null && peerLine != null && peerLine > ownLine) {
            insertBefore = walker;
            break;
          }
        }
        insertAfter = walker;
        walker = walker.nextElementSibling;
      }
      if (insertBefore) insertBefore.before(thread);
      else insertAfter.after(thread);
    }
  }

  // `escapeHtml` and `formatTimeAgo` live in src/lib/responses.js (destructured at top).

  // ── Initialization ─────────────────────────────────────────────────────────

  // Remove every node / class we've injected onto the page. Run before
  // buildLineMap on re-init so the text-matcher sees a clean DOM (our `▾`
  // collapse toggles and `+` buttons would otherwise leak into block
  // `textContent` and break source-line matching — symptom: needles like
  // `"▾+overview"` show up in NO MATCH logs and threads on those blocks fail
  // to render after a re-init).
  function clearInjectedDom() {
    document.querySelectorAll(
      '.grdc-comment-btn, .grdc-collapse-toggle, .grdc-existing-thread, .grdc-comment-box, .grdc-reply-box'
    ).forEach((el) => el.remove());
    document.querySelectorAll(
      '.grdc-hoverable, .grdc-collapsible, .grdc-section-collapsed, .grdc-collapsed-hidden, .grdc-thread-range, .grdc-range-hover'
    ).forEach((el) => {
      el.classList.remove(
        'grdc-hoverable',
        'grdc-collapsible',
        'grdc-section-collapsed',
        'grdc-collapsed-hidden',
        'grdc-thread-range',
        'grdc-range-hover'
      );
    });
    // Note: `.grdc-sidebar` is NOT cleared here — `buildThreadsSidebar()`
    // re-uses the existing shell when present to preserve user-set state
    // (collapsed, unresolved-only filter) across re-inits. The sidebar's
    // own list is rebuilt inside `buildThreadsSidebar()`.
  }

  // ── UI: Threads sidebar ────────────────────────────────────────────────────
  //
  // A right-docked floating panel listing every existing thread in DOM order.
  // Each card scrolls to its thread on click. Header carries prev/next nav
  // (`↑` / `↓` plus an `n / total` count) and a chord-keyboard binding
  // (`g j` / `g k`). Includes an "Unresolved only" filter toggle. Hidden
  // entirely when there are 0 threads on the page. Collapsed state and the
  // filter state persist in `localStorage` (per origin, not per repo — a
  // user's preference travels across PRs).
  //
  // Source of truth: queries `.grdc-existing-thread` elements after
  // `renderExistingComments()` has populated them. Each carries a
  // `data-grdc-snippet` / `data-grdc-user` / `data-grdc-path` /
  // `data-grdc-line` / `data-grdc-thread-id` plus the `grdc-thread-resolved`
  // / `grdc-thread-outdated` classes. The sidebar is a pure consumer.

  const SIDEBAR_COLLAPSE_KEY = 'grdc_sidebar_collapsed';
  const SIDEBAR_FILTER_KEY = 'grdc_sidebar_unresolved_only';
  const SIDEBAR_POS_KEY = 'grdc_sidebar_pos';
  const SIDEBAR_SIZE_KEY = 'grdc_sidebar_size';
  // Floors must match the CSS `min-width` / `min-height` on `.grdc-sidebar`.
  // We clamp persisted sizes on both read and write so a transient narrow
  // render (e.g. during initial paint before content settles) can't poison
  // localStorage with a tiny size that the next page load would honor.
  const SIDEBAR_MIN_WIDTH = 480;
  const SIDEBAR_MIN_HEIGHT = 120;
  const SIDEBAR_TAB_KEY = 'grdc_sidebar_tab';
  let sidebarCurrentIdx = 0;
  // Per-block index for the "prev/next change" feature — separate from
  // `sidebarCurrentIdx` because change-nav (walks `.added`/`.removed`/`<ins>`
  // /`<del>` blocks) is a distinct navigation concept from thread-nav
  // (walks the 💬 badges). User-facing keys: `[` / `]`.
  let changesCurrentIdx = 0;
  let outlineActiveObserver = null; // IntersectionObserver for active-section highlight
  // Timestamp (ms) until which the Outline IntersectionObserver should NOT
  // call `jumpSidebarListsToFile` on file-boundary crossings. Bumped by any
  // explicit user click that scrolls the page (Changes cards, NEW FILE /
  // DELETED cards). Without this guard, the IO fires *during* the smooth-
  // scroll animation, sees the previous file's heading still topmost in
  // the viewport, and yanks the sidebar selection back to the previous
  // file — undoing the user's click. Especially bad for ADDED files that
  // have no headings of their own (e.g. a `.md` with only a code block),
  // because then no heading in the new file ever "wins" the topmost
  // contest. 1500ms covers the typical smooth-scroll duration on a long
  // page; after that, IO is back in charge.
  let scrollFollowSuppressedUntil = 0;

  // Same idea for the Outline pane's active-section highlight. After an
  // explicit user click on a file (in GitHub's file tree, our own file
  // labels, etc.) we manually pin the highlight to that file's first
  // heading — even if that heading is technically BELOW the sticky line
  // (which is common right after a smooth-scroll lands on a file: its
  // first heading is at ~y=200 or ~y=400, with the previous file's last
  // heading still above the sticky line at ~y=100). Without this pin the
  // scroll listener's "last heading whose top is above the sticky line"
  // rule would pick the previous file's heading and the user would see
  // a highlight from the wrong file after their click. The pin holds
  // for 1500ms — long enough for the smooth-scroll to complete and the
  // user's chosen file's heading to become the true topmost — then the
  // scroll listener takes over normally.
  let outlineHighlightPinUntil = 0;
  // Module-scope so `jumpSidebarListsToFile` can update it when it
  // pin-highlights a heading, and the Outline scroll listener sees the
  // updated value on the next tick — otherwise the scroll listener's
  // internal "skip if same as last" guard would ignore its own first
  // real update after the pin expires (because its cached
  // `lastActiveId` would still hold the previous file's id).
  let outlineLastActiveHeadingId = null;

  // Drag-to-move on the header. Position persists in `localStorage` as
  // `{left, top}` in viewport coordinates. We clamp to keep at least 80px
  // of the header on-screen so a window resize can't strand the sidebar.
  function attachSidebarDrag(sidebar, handle) {
    handle.addEventListener('mousedown', (e) => {
      // Ignore drags that start on a button (collapse / prev / next).
      if (e.target.closest('button')) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = sidebar.getBoundingClientRect();
      const startLeft = rect.left;
      const startTop = rect.top;
      sidebar.classList.add('grdc-sidebar-dragging');
      const onMove = (ev) => {
        const { left, top } = clampDragPos(
          { left: startLeft, top: startTop, width: rect.width },
          { dx: ev.clientX - startX, dy: ev.clientY - startY },
          { width: window.innerWidth, height: window.innerHeight },
          80
        );
        sidebar.style.left = `${left}px`;
        sidebar.style.top = `${top}px`;
        sidebar.style.right = 'auto';
        // Defeat the default `transform: translateX(-50%)` (which centers
        // the sidebar) so the explicit `left` from the drag wins.
        sidebar.style.transform = 'none';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        sidebar.classList.remove('grdc-sidebar-dragging');
        try {
          localStorage.setItem(SIDEBAR_POS_KEY, JSON.stringify({
            left: parseFloat(sidebar.style.left),
            top: parseFloat(sidebar.style.top),
          }));
        } catch (_) {}
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function applySidebarPersistedPos(sidebar) {
    try {
      const raw = localStorage.getItem(SIDEBAR_POS_KEY);
      if (raw) {
        const { left, top } = JSON.parse(raw);
        if (Number.isFinite(left) && Number.isFinite(top)) {
          // Clamp the stored position against the CURRENT viewport. If the
          // window shrank, the user changed monitors, or browser zoom
          // changed since the position was saved, the raw value can land
          // the sidebar entirely offscreen. Reusing `clampDragPos` with a
          // zero delta keeps at least 80px of the header visible.
          const width = parseFloat(sidebar.style.width) || sidebar.offsetWidth || SIDEBAR_MIN_WIDTH;
          const { left: cLeft, top: cTop } = clampDragPos(
            { left, top, width },
            { dx: 0, dy: 0 },
            { width: window.innerWidth, height: window.innerHeight },
            80
          );
          sidebar.style.left = `${cLeft}px`;
          sidebar.style.top = `${cTop}px`;
          sidebar.style.right = 'auto';
          // Defeat the default `transform: translateX(-50%)` so the
          // restored explicit `left` from a previous drag wins.
          sidebar.style.transform = 'none';
        }
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem(SIDEBAR_SIZE_KEY);
      if (raw) {
        const { width, height } = JSON.parse(raw);
        const clamped = window.GRDC.clampSize(width, height, SIDEBAR_MIN_WIDTH, SIDEBAR_MIN_HEIGHT);
        if (clamped.width != null) sidebar.style.width = `${clamped.width}px`;
        if (clamped.height != null) sidebar.style.height = `${clamped.height}px`;
      }
    } catch (_) {}
  }

  // Re-clamp the sidebar's position on window resize so a window shrink
  // (or monitor switch / zoom change) can't strand it offscreen. Bound
  // once globally; no-ops when the sidebar isn't on the page or hasn't
  // been moved away from its default right-dock.
  //
  // IMPORTANT: we never write the clamped value back to localStorage. The
  // stored position is the user's *intent* (where they dropped it on a
  // larger window); the displayed position is just `clamp(intent, current
  // viewport)`. Shrinking the window slides the sidebar inward to B; then
  // enlarging the window slides it back out toward the original A.
  // Persisting the clamp would lose the original intent on the first shrink.
  (function bindSidebarResizeClamp() {
    let t = null;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const sidebar = document.querySelector('.grdc-sidebar');
        if (!sidebar) return;
        let intentLeft, intentTop;
        try {
          const raw = localStorage.getItem(SIDEBAR_POS_KEY);
          if (raw) {
            const p = JSON.parse(raw);
            if (Number.isFinite(p.left) && Number.isFinite(p.top)) {
              intentLeft = p.left;
              intentTop = p.top;
            }
          }
        } catch (_) {}
        // No stored intent → sidebar is still at the CSS default right-dock;
        // it auto-adjusts with the viewport, nothing to do.
        if (intentLeft === undefined) return;
        const width = parseFloat(sidebar.style.width) || sidebar.offsetWidth || SIDEBAR_MIN_WIDTH;
        const { left, top } = clampDragPos(
          { left: intentLeft, top: intentTop, width },
          { dx: 0, dy: 0 },
          { width: window.innerWidth, height: window.innerHeight },
          80
        );
        sidebar.style.left = `${left}px`;
        sidebar.style.top = `${top}px`;
        sidebar.style.right = 'auto';
        // Defeat the default centering transform so the restored explicit
        // `left` from a previous drag wins.
        sidebar.style.transform = 'none';
      }, 200);
    });
  })();

  // Reset the sidebar to its default right-dock layout: clear persisted
  // position / size / collapsed state, drop inline styles, and rebuild so
  // the user can recover from an offscreen drag or unwanted collapse
  // without DevTools. Bound to `Shift+T`.
  function resetSidebarLayout() {
    try {
      localStorage.removeItem(SIDEBAR_POS_KEY);
      localStorage.removeItem(SIDEBAR_SIZE_KEY);
      localStorage.removeItem(SIDEBAR_COLLAPSE_KEY);
    } catch (_) {}
    const sidebar = document.querySelector('.grdc-sidebar');
    if (sidebar) {
      sidebar.style.left = '';
      sidebar.style.top = '';
      sidebar.style.right = '';
      sidebar.style.width = '';
      sidebar.style.height = '';
      // Clear inline transform so the CSS default (translateX(-50%) for
      // horizontal centering on the title row) takes over again.
      sidebar.style.transform = '';
      sidebar.classList.remove('grdc-sidebar-collapsed');
    }
    try { buildThreadsSidebar(); } catch (_) {}
  }

  // Toggle the sidebar's collapsed state. If the sidebar doesn't exist on
  // the page (no threads / no useful outline), this is a no-op. Bound to
  // the `t` shortcut so users can hide / reveal it without hunting for
  // the small collapse button.
  function toggleSidebarCollapsed() {
    const sidebar = document.querySelector('.grdc-sidebar');
    if (!sidebar) return;
    const isCollapsed = sidebar.classList.toggle('grdc-sidebar-collapsed');
    try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, isCollapsed ? '1' : '0'); } catch (_) {}
  }

  // Persist resize: watch for size changes via ResizeObserver and write to
  // localStorage on a debounce so we don't thrash storage during the drag.
  function observeSidebarResize(sidebar) {
    if (typeof ResizeObserver === 'undefined') return;
    let writeTimer = null;
    const ro = new ResizeObserver(() => {
      if (sidebar.classList.contains('grdc-sidebar-collapsed')) return;
      clearTimeout(writeTimer);
      writeTimer = setTimeout(() => {
        try {
          const w = sidebar.offsetWidth;
          const h = sidebar.offsetHeight;
          // Don't persist obviously-bogus sizes. Anything below the CSS
          // min-* is a transient render glitch, not a user resize.
          const clamped = window.GRDC.clampSize(w, h, SIDEBAR_MIN_WIDTH, SIDEBAR_MIN_HEIGHT);
          if (clamped.width == null || clamped.height == null) return;
          localStorage.setItem(SIDEBAR_SIZE_KEY, JSON.stringify({
            width: clamped.width,
            height: clamped.height,
          }));
        } catch (_) {}
      }, 250);
    });
    ro.observe(sidebar);
  }

  // Poll the DOM for headings (the signal that GitHub has finished
  // mounting the rich-diff prose after a toggle click). Resolves true as
  // soon as at least one heading is visible, OR false at the timeout.
  // Used by `expandAndRenderAllMd` to avoid the race where we rebuild
  // the sidebar before GitHub finishes async-rendering the prose — a
  // race that left users on the Threads tab after clicking the book
  // button instead of landing on Outline.
  async function waitForOutlineHeadings(maxMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      try {
        if (typeof collectHeadings === 'function' && collectHeadings().length >= 1) {
          return true;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 80));
    }
    return false;
  }

  // Expand the sidebar (if collapsed) and render every `.md` file as
  // rich-diff, with tooltip + disabled feedback on the book button while
  // the work runs. Used by THREE call-sites:
  //   1. The header book button's click handler (which then ALSO switches
  //      to the Outline tab — see the spec: book = "Toggle outline").
  //   2. The empty-state CTA in the Threads pane.
  //   3. The empty-state CTA in the Changes pane.
  // The CTAs intentionally skip the Outline tab-switch — they live inside
  // the Threads/Changes panes and the user clicked them expecting to see
  // those panes populate. Only an explicit click on the book button
  // signals "show me the outline".
  async function expandAndRenderAllMd(sidebar) {
    const btn = sidebar.querySelector('.grdc-sidebar-render-md');
    const orig = btn ? btn.getAttribute('title') : null;
    if (btn) {
      btn.setAttribute('title', 'Rendering Markdown files as rich-diff…');
      btn.setAttribute('disabled', 'true');
    }
    if (sidebar.classList.contains('grdc-sidebar-collapsed')) {
      sidebar.classList.remove('grdc-sidebar-collapsed');
      try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, '0'); } catch (_) {}
    }
    try {
      const n = await flipAllMdToRichDiff();
      // CRITICAL: wait for GitHub to actually mount the rich-diff prose
      // in the DOM. `flipAllMdToRichDiff`'s per-step dwell (~100–250 ms)
      // is often not enough on slow connections — the toggle click
      // returns immediately but GitHub renders the prose async. Without
      // this poll, the next sync `buildThreadsSidebar()` finds zero
      // headings, leaves the Outline tab hidden, and any caller's
      // `setSidebarTab(..., 'outline')` silently falls back to Threads.
      // We poll up to 3 s for the first heading to appear; if it never
      // does (PR has no headings, or no .md files), we proceed with the
      // rebuild anyway — the caller's tab switch will gracefully fall
      // back to Threads, which is the correct UX for an outline-less PR.
      await waitForOutlineHeadings(3000);
      // Now force a sidebar rebuild so the Outline tab unhides (if
      // headings appeared) and `buildOutlinePane` runs. `flipAll-
      // MdToRichDiff` already schedules a deferred rebuild for ~400 ms
      // later as a safety net for late-arriving headings; calling it
      // here is idempotent (rebuilds from live DOM each time).
      try { buildThreadsSidebar(); } catch (_) {}
      if (btn) {
        btn.setAttribute('title', n === 0
          ? 'All Markdown files are already in rich-diff'
          : `Rendered ${n} Markdown file${n === 1 ? '' : 's'} as rich-diff`);
      }
      return n;
    } finally {
      if (btn) {
        btn.removeAttribute('disabled');
        setTimeout(() => { if (orig) btn.setAttribute('title', orig); }, 2500);
      }
    }
  }

  function buildThreadsSidebar() {
    const threadEls = Array.from(document.querySelectorAll('.grdc-existing-thread'));
    let sidebar = document.querySelector('.grdc-sidebar');

    // Hide the sidebar when we're not on a PR files/changes page at all
    // (e.g. the user navigated back to /issues, /pull/<n> overview, etc.).
    // On a PR page we always render the sidebar shell — even when every
    // file is currently in source-diff view — so the user can find it,
    // toggle with `t`, and reach upcoming actions like "flip all .md
    // files to rich-diff". The threads / outline panes will be empty
    // until at least one file is in rich-diff, which is fine.
    //
    // (Previously we early-returned whenever no `.prose-diff` was
    // visible, which made the sidebar disappear on the `/changes` page
    // before any file was toggled — confusing for first-time users.)
    if (!prInfo) {
      sidebar?.remove();
      return;
    }

    // Decide whether to keep the sidebar at all. Previously we required
    // either ≥1 thread OR ≥3 headings to bother showing the chrome — but
    // that produced confusing "why isn't the sidebar here on this file?"
    // moments on small PRs / single-heading READMEs. Now that `t`
    // toggles and `Shift+T` resets the sidebar, the user has full control;
    // we always show it on rich-diff pages and let them hide it if it's
    // unwanted. The Outline tab's own emptiness handling still kicks in
    // when there are no headings at all.
    const headingCount = document.querySelectorAll(
      '.prose-diff .markdown-body h1, .prose-diff .markdown-body h2, .prose-diff .markdown-body h3, .prose-diff .markdown-body h4, .prose-diff .markdown-body h5, .prose-diff .markdown-body h6'
    ).length;
    const outlineUseful = headingCount >= 1;
    // Threads list is empty but Outline still has content (e.g. user
    // deleted all their comments on a long design doc) — keep the sidebar
    // and auto-switch to the Outline tab so the user immediately sees
    // why the sidebar is still there.
    const forceOutlineTab = threadEls.length === 0 && outlineUseful;

    const unresolvedOnly = localStorage.getItem(SIDEBAR_FILTER_KEY) === '1';
    const collapsed = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1';

    // Create shell on first build; reuse it on re-init so user state survives.
    if (!sidebar) {
      sidebar = document.createElement('div');
      sidebar.className = 'grdc-sidebar';
      sidebar.setAttribute('role', 'complementary');
      sidebar.setAttribute('aria-label', 'Review threads');
      sidebar.innerHTML = `
        <div class="grdc-sidebar-header">
          <button class="grdc-sidebar-collapse" title="Collapse / expand sidebar (t) — Shift+T to reset position" aria-label="Toggle sidebar">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M1 2.75A.75.75 0 0 1 1.75 2h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75Zm0 5A.75.75 0 0 1 1.75 7h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.75Zm0 5a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1-.75-.75Z"/></svg>
          </button>
          <span class="grdc-sidebar-separator" aria-hidden="true"></span>
          <button class="grdc-sidebar-render-md" title="Show Outline — also renders Markdown files (b)" aria-label="Show Outline">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.744 3.744 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z"/></svg>
          </button>
          <span class="grdc-sidebar-separator" aria-hidden="true"></span>
          <span class="grdc-sidebar-changes-nav">
            <button class="grdc-sidebar-diff-icon" title="First change in this file — or next change globally if the file has none" aria-label="First change in this file">
              <!-- Custom diff icon: document with green (added) + yellow (removed) stripe markers and dim grey text lines, matching the user-provided mockup. -->
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <!-- Document outline (white, inherits currentColor) with folded corner. NOTE: the path uses v-12.5 (not v-13) so the closing arc lands exactly at the start point (3, 1.5) — using v-13 leaves a stray 0.5 px vertical segment at x=3 that appears as extra pixels on the left side of the icon. -->
                <path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M3 1.5h7l3 3v10a.5.5 0 0 1-.5.5h-9.5a.5.5 0 0 1-.5-.5v-12.5a.5.5 0 0 1 .5-.5z"/>
                <path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M10 1.5v3h3"/>
                <!-- Green added stripe -->
                <rect x="4.5" y="6.5" width="1.4" height="2.6" rx="0.4" fill="#3fb950"/>
                <!-- Text lines next to green stripe (faint grey via 60% opacity on currentColor) -->
                <path stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-opacity="0.55" d="M6.6 7.3h4.5M6.6 8.5h3.4"/>
                <!-- Yellow removed stripe -->
                <rect x="4.5" y="10" width="1.4" height="2.6" rx="0.4" fill="#d29922"/>
                <!-- Text lines next to yellow stripe -->
                <path stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-opacity="0.55" d="M6.6 10.8h4.5M6.6 12h2.6"/>
              </svg>
            </button>
            <span class="grdc-sidebar-changes-count" aria-live="polite">0/0</span>
            <button class="grdc-sidebar-prev-change" title="Previous change ( [ ) — first change ( { )" aria-label="Previous change">
              <!-- chevron-left -->
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z"/></svg>
            </button>
            <button class="grdc-sidebar-next-change" title="Next change ( ] ) — last change ( } )" aria-label="Next change">
              <!-- chevron-right -->
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/></svg>
            </button>
          </span>
          <span class="grdc-sidebar-separator" aria-hidden="true"></span>
          <span class="grdc-sidebar-nav">
            <button class="grdc-sidebar-thread-icon" title="First thread in this file — or next thread globally if the file has none" aria-label="First thread in this file">
              <!-- Custom thread icon: two SOLID-FILLED overlapping speech bubbles. Each bubble is a rounded rectangle PLUS a sharp triangular tail spike at its bottom-outer corner (front: down-left, back: down-right). The back bubble (drawn first) uses an SVG mask that strokes the front bubble's outline in black, cutting a thin gap where the front overlaps so the two solid shapes read as separate. The viewBox is "1 1 14 14" (not 0 0 16 16) so the bubbles render ~14% larger inside the same 16×16 button — gives the icon better visual weight without changing the path coordinates. Both bubbles still fit fully inside the new tighter viewport. -->
              <svg viewBox="1 1 14 14" width="16" height="16" aria-hidden="true">
                <defs>
                  <mask id="grdc-thread-icon-mask">
                    <rect width="16" height="16" fill="white"/>
                    <path d="M3.1 2.5H9.4a.6.6 0 0 1 .6.6V7.4a.6.6 0 0 1-.6.6H5L2 10l1.5-2H2.5a.6.6 0 0 1-.6-.6V3.1a.6.6 0 0 1 .6-.6Z" fill="none" stroke="black" stroke-width="0.8"/>
                  </mask>
                </defs>
                <!-- Back bubble (bottom-right). v2 design — rounded rectangle body x 6-13.5, y 7-12, with sharp triangular tail from the right edge to (14, 14). All four corners ARE rounded (the body uses .6,.6 corner arcs at every corner; the tail is a small triangular cutout from the right edge that's separate from the body corners). Masked where the front bubble overlaps so a thin gap shows between the two solid shapes. -->
                <path fill="currentColor" mask="url(#grdc-thread-icon-mask)" d="M6.6 7H13a.6.6 0 0 1 .6.6V11.4a.6.6 0 0 1-.6.6L14 14 11.3 12H6.6a.6.6 0 0 1-.6-.6V7.6a.6.6 0 0 1 .6-.6Z"/>
                <!-- Front bubble (top-left, drawn last on top). Body x 2.5–10, y 2.5–8, with triangular tail spike to (2, 10). -->
                <path fill="currentColor" d="M3.1 2.5H9.4a.6.6 0 0 1 .6.6V7.4a.6.6 0 0 1-.6.6H5L2 10l1.5-2H2.5a.6.6 0 0 1-.6-.6V3.1a.6.6 0 0 1 .6-.6Z"/>
              </svg>
            </button>
            <span class="grdc-sidebar-count" aria-live="polite">0/0</span>
            <button class="grdc-sidebar-prev" title="Previous thread ( k ) — first thread ( h )" aria-label="Previous thread">
              <!-- chevron-left -->
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z"/></svg>
            </button>
            <button class="grdc-sidebar-next" title="Next thread ( j ) — last thread ( l )" aria-label="Next thread">
              <!-- chevron-right -->
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"/></svg>
            </button>
          </span>
          <span class="grdc-sidebar-separator" aria-hidden="true"></span>
          <button class="grdc-sidebar-header-filter" title="Unresolved only" aria-label="Toggle unresolved only" aria-pressed="false">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path class="grdc-icon-outline" fill="currentColor" fill-rule="evenodd" d="M.75 3A.75.75 0 0 1 1.5 2.25h13a.75.75 0 0 1 .6 1.2L10 10.25v3.25a.75.75 0 0 1-1.2.6l-2.5-1.88a.75.75 0 0 1-.3-.6V10.25L.9 3.45A.75.75 0 0 1 .75 3Zm2.25.75 4.6 6.13a.75.75 0 0 1 .15.45v1.69l1 .75v-2.44a.75.75 0 0 1 .15-.45L13.5 3.75h-10.5Z"/>
              <path class="grdc-icon-solid" fill="currentColor" d="M.75 3A.75.75 0 0 1 1.5 2.25h13a.75.75 0 0 1 .6 1.2L10 10.25v3.25a.75.75 0 0 1-1.2.6l-2.5-1.88a.75.75 0 0 1-.3-.6V10.25L.9 3.45A.75.75 0 0 1 .75 3Z"/>
            </svg>
          </button>
        </div>
        <div class="grdc-sidebar-tabs" role="tablist">
          <button class="grdc-sidebar-tab grdc-sidebar-tab-active" data-grdc-tab="changes" role="tab" aria-selected="true" title="Changes (1)">Changes</button>
          <button class="grdc-sidebar-tab" data-grdc-tab="threads" role="tab" aria-selected="false" title="Threads (2)">Threads</button>
          <button class="grdc-sidebar-tab" data-grdc-tab="outline" role="tab" aria-selected="false" title="Outline (3)">Outline</button>
        </div>
        <div class="grdc-sidebar-pane grdc-sidebar-pane-threads" data-grdc-pane="threads">
          <label class="grdc-sidebar-filter">
            <input type="checkbox" class="grdc-sidebar-filter-cb">
            Unresolved only
          </label>
          <div class="grdc-sidebar-list" role="list"></div>
        </div>
        <div class="grdc-sidebar-pane grdc-sidebar-pane-outline" data-grdc-pane="outline" hidden>
          <div class="grdc-sidebar-outline-toolbar">
            <button class="grdc-sidebar-fold-level" data-level="1" title="Fold all H1 sections (collapse each document to its title)">Fold H1</button>
            <button class="grdc-sidebar-fold-level" data-level="2" title="Fold all H2 sections">Fold H2</button>
            <button class="grdc-sidebar-fold-level" data-level="3" title="Fold all H3 sections">Fold H3</button>
            <button class="grdc-sidebar-expand-all" title="Expand every section">Expand all</button>
          </div>
          <div class="grdc-sidebar-outline-tree"></div>
        </div>
        <div class="grdc-sidebar-pane grdc-sidebar-pane-changes" data-grdc-pane="changes" hidden>
          <div class="grdc-sidebar-changes-list" role="list"></div>
        </div>
      `;
      document.body.appendChild(sidebar);

      const headerEl = sidebar.querySelector('.grdc-sidebar-header');
      attachSidebarDrag(sidebar, headerEl);
      applySidebarPersistedPos(sidebar);
      observeSidebarResize(sidebar);

      sidebar.querySelector('.grdc-sidebar-collapse').addEventListener('click', () => {
        const isCollapsed = sidebar.classList.toggle('grdc-sidebar-collapsed');
        try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, isCollapsed ? '1' : '0'); } catch (_) {}
      });
      sidebar.querySelector('.grdc-sidebar-prev').addEventListener('click', () => sidebarJump(-1));
      sidebar.querySelector('.grdc-sidebar-next').addEventListener('click', () => sidebarJump(+1));
      // Changes-nav (◀ / ▶) — mirrors thread-nav but walks the
      // `.added`/`.removed`/`<ins>`/`<del>` blocks. Different chevron shape
      // + tooltip + (when hovered) the `[` / `]` key hint make it visually
      // distinct from the thread prev/next chevrons next door.
      sidebar.querySelector('.grdc-sidebar-prev-change').addEventListener('click', () => changesJump(-1));
      sidebar.querySelector('.grdc-sidebar-next-change').addEventListener('click', () => changesJump(+1));
      // Diff/Thread icon shortcuts — clicking the file-diff icon or the
      // comment-discussion icon acts as "go to next" (same as the right
      // chevron). The mockup spec calls this out: "File diff and comment
      // icons are informational by default, but also act as shortcuts to
      // navigate to the next item (same as the right chevron)." Since
      // `changesJump`/`sidebarJump` already start at index 0 (and `nextChangeIndex`
      // wraps), the first click naturally lands on item 1 — the "first if
      // none in view" behaviour is implicit.
      //
      // 1.8.0: the header icons are now **file-scoped, not global**. The
      // reviewer's mental model on a multi-file PR is "I'm in file X,
      // take me to the first item in file X", not "advance the global
      // counter by one". `jumpToFirstInCurrentFile` finds the topmost
      // `.prose-diff` root in the viewport, resolves it to a path, and
      // jumps the counter to that file's first change / thread. If the
      // current file has zero items (e.g. a whole-file NEW FILE with no
      // per-block stops), we fall back to the old global-advance
      // behaviour so the icon is never a dead click. The `[` / `]` and
      // `j` / `k` shortcuts keep the global-walk semantics they always
      // had — nothing is lost; the header icon is repurposed for the
      // more common "get me into this file's list" affordance.
      const diffIconBtn = sidebar.querySelector('.grdc-sidebar-diff-icon');
      if (diffIconBtn) diffIconBtn.addEventListener('click', () => jumpToFirstInCurrentFile(sidebar, 'changes'));
      const threadIconBtn = sidebar.querySelector('.grdc-sidebar-thread-icon');
      if (threadIconBtn) threadIconBtn.addEventListener('click', () => jumpToFirstInCurrentFile(sidebar, 'threads'));
      sidebar.querySelector('.grdc-sidebar-filter-cb').addEventListener('change', (e) => {
        try { localStorage.setItem(SIDEBAR_FILTER_KEY, e.target.checked ? '1' : '0'); } catch (_) {}
        // Sync the header icon's pressed state.
        const hf = sidebar.querySelector('.grdc-sidebar-header-filter');
        if (hf) hf.setAttribute('aria-pressed', e.target.checked ? 'true' : 'false');
        buildThreadsSidebar();
      });
      // Header filter icon — duplicates the in-pane checkbox so it stays
      // reachable in collapsed mode. Toggling either updates the other.
      sidebar.querySelector('.grdc-sidebar-header-filter').addEventListener('click', () => {
        const cb = sidebar.querySelector('.grdc-sidebar-filter-cb');
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Book button = "Show Outline" per the v2 spec. Side effect: also
      // renders any not-yet-rendered .md files, since the Outline pane is
      // only meaningful once headings exist in the rendered DOM. The two
      // actions naturally pair with one user intent: "navigate this PR by
      // document structure". Implementation:
      //   1. Expand the panel (if collapsed) and render all .md files
      //      via `expandAndRenderAllMd` (shared with the empty-state CTAs).
      //   2. Switch to the Outline tab so the user lands on the result.
      // Clicking again while already on Outline is a no-op (idempotent).
      sidebar.querySelector('.grdc-sidebar-render-md').addEventListener('click', async (e) => {
        e.preventDefault();
        await expandAndRenderAllMd(sidebar);
        setSidebarTab(sidebar, 'outline');
      });

      // Tab switching. Active state persists in `localStorage` per origin.
      sidebar.querySelectorAll('.grdc-sidebar-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const target = tab.dataset.grdcTab;
          setSidebarTab(sidebar, target);
        });
      });

      // Outline toolbar: "Fold H<N>" folds every section at that exact
      // level (additive — doesn't touch other levels). "Expand all" clears
      // every collapsed section.
      sidebar.querySelectorAll('.grdc-sidebar-fold-level').forEach(btn => {
        btn.addEventListener('click', () => {
          const level = parseInt(btn.dataset.level, 10);
          foldOutlineAtLevel(level);
        });
      });
      sidebar.querySelector('.grdc-sidebar-expand-all').addEventListener('click', () => {
        expandAllOutlineSections();
      });
    }

    // Apply persisted state.
    sidebar.classList.toggle('grdc-sidebar-collapsed', collapsed);
    const filterCb = sidebar.querySelector('.grdc-sidebar-filter-cb');
    if (filterCb.checked !== unresolvedOnly) filterCb.checked = unresolvedOnly;
    const headerFilter = sidebar.querySelector('.grdc-sidebar-header-filter');
    if (headerFilter) headerFilter.setAttribute('aria-pressed', unresolvedOnly ? 'true' : 'false');

    // When Threads is empty but Outline still has content, force-switch
    // to the Outline tab. Also rebuild the outline pane since its content
    // (heading list) may have changed since the last render.
    if (forceOutlineTab) {
      buildOutlinePane(sidebar);
      setSidebarTab(sidebar, 'outline');
    }

    // Rebuild the list. Threads in DOM order already — they were inserted in
    // sorted (path, line) order by renderExistingComments.
    const list = sidebar.querySelector('.grdc-sidebar-list');
    list.innerHTML = '';
    const visible = threadEls.filter(t =>
      !unresolvedOnly || !t.classList.contains('grdc-thread-resolved'));

    // Empty-state CTA: when there are no threads to show, surface the
    // "Render all Markdown files as rich-diff" action prominently in the
    // pane itself. Without this, users landing on a `/changes` page (where
    // every file is in source-diff by default) see an empty sidebar with
    // no obvious next step — comments are only fetched / shown once at
    // least one file is in rich-diff. The header book icon is still
    // available, but in-pane is much more discoverable.
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'grdc-sidebar-empty';
      const msg = threadEls.length === 0
        ? (unresolvedOnly
            ? 'No threads on this page yet.'
            : 'No review threads visible yet. Render the Markdown files as rich-diff to load any comments on them.')
        : 'All threads on this page are resolved.';
      empty.innerHTML = `
        <p class="grdc-sidebar-empty-msg">${escapeHtml(msg)}</p>
        <button type="button" class="grdc-sidebar-empty-cta">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.744 3.744 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z"/></svg>
          <span>Render all Markdown files as rich-diff</span>
        </button>
      `;
      const cta = empty.querySelector('.grdc-sidebar-empty-cta');
      cta.addEventListener('click', () => {
        // Render-only — do NOT switch to the Outline tab. The user
        // clicked this CTA inside the Threads pane expecting threads to
        // appear after the render, not to be whisked away to Outline.
        // (The header book button is the explicit "show Outline" entry
        // point; this CTA is context-bound to the Threads pane.)
        expandAndRenderAllMd(sidebar);
      });
      list.appendChild(empty);
    }
    visible.forEach((threadEl, idx) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'grdc-sidebar-card' +
        (threadEl.classList.contains('grdc-thread-resolved') ? ' grdc-sidebar-card-resolved' : '') +
        (threadEl.classList.contains('grdc-thread-outdated') ? ' grdc-sidebar-card-outdated' : '');
      card.setAttribute('role', 'listitem');
      const user = threadEl.dataset.grdcUser || 'unknown';
      const snippet = threadEl.dataset.grdcSnippet || '(no body)';
      const path = threadEl.dataset.grdcPath || '';
      const line = threadEl.dataset.grdcLine || '';
      const file = path.split('/').pop() || path;
      // Stash the full path on the card so the Outline pane's file-label
      // click handler can find the first Threads card per file.
      if (path) card.dataset.grdcPath = path;
      const tags = [];
      if (threadEl.classList.contains('grdc-thread-resolved')) tags.push('✓ resolved');
      if (threadEl.classList.contains('grdc-thread-outdated')) tags.push('outdated');
      // Mark cards whose snippet was truncated by buildSnippet (ends with
      // a `…`). The CSS then paints an obvious "more" pill at the
      // bottom-right of the body so the truncation is unmissable, not
      // just a faint trailing dot. Visual clamp (CSS line-clamp) is
      // handled separately by the browser; this targets the *character*
      // truncation case where the raw body was longer than maxLen.
      const isTruncated = snippet.endsWith('\u2026');
      const bodyClass = 'grdc-sidebar-card-body' + (isTruncated ? ' grdc-sidebar-card-body-truncated' : '');
      // When the truncated pill is shown, strip the trailing `…` from the
      // text so we don't render two ellipses (one inline, one in the pill).
      const bodyText = isTruncated ? snippet.slice(0, -1).trimEnd() : snippet;
      card.innerHTML = `
        <div class="grdc-sidebar-card-head">
          <span class="grdc-sidebar-card-user">${escapeHtml(user)}</span>
          <span class="grdc-sidebar-card-loc">${escapeHtml(file)}:${escapeHtml(line)}</span>
        </div>
        <div class="${bodyClass}">${escapeHtml(bodyText)}</div>
        ${tags.length ? `<div class="grdc-sidebar-card-tags">${tags.map(t => escapeHtml(t)).join(' · ')}</div>` : ''}
      `;
      card.addEventListener('click', () => {
        sidebarCurrentIdx = idx;
        scrollToThread(threadEl);
        updateSidebarCount();
      });
      list.appendChild(card);
    });

    // Snap currentIdx to a valid range for the new list.
    if (sidebarCurrentIdx >= visible.length) sidebarCurrentIdx = visible.length - 1;
    if (sidebarCurrentIdx < 0) sidebarCurrentIdx = 0;
    updateSidebarCount();

    // Build / refresh the Outline pane in the same pass.
    buildOutlinePane(sidebar);

    // Build / refresh the Changes pane in the same pass. Also wires up
    // the header ◀ / ▶ counter — those buttons are present in the shell
    // but stay `hidden` until we have at least one change to navigate to.
    buildChangesPane(sidebar);

    // Pick the active tab. Normally we honor the user's last choice;
    // when threads is empty but Outline isn't, force-switch to Outline
    // so the empty Threads list doesn't look like "the sidebar is
    // broken". Doesn't persist — once threads are back, the user's
    // saved preference resumes.
    const savedTab = localStorage.getItem(SIDEBAR_TAB_KEY) || 'changes';
    setSidebarTab(sidebar, forceOutlineTab ? 'outline' : savedTab);
  }

  // Walk the rich-diff DOM and collect every heading (H1–H6) with metadata
  // the Outline pane needs. Each entry: `{el, id, level, text, slug, line,
  // file}`. `line` is read from our `fileLineMap` when available; falls back
  // to null so unmapped headings still show up but don't drive thread
  // attribution. `file` is the file path (from `fileLineMap`) when present,
  // null otherwise — used to scope thread attribution to the right file.
  function collectHeadings() {
    const out = [];
    // GitHub's PR rich-diff wraps changes in several overlapping containers
    // (`.prose-diff`, `.prose-diff .markdown-body`, `.rich-diff-level-one
    // .markdown-body`). Without care we'd walk the same heading twice via
    // different ancestor matches and the outline would duplicate every row.
    // Approach: collect all candidate roots, then dedupe at the HEADING
    // level via a `Set` keyed by element identity \u2014 each `<h1>`..`<h6>`
    // contributes one outline entry no matter how many root selectors
    // matched its ancestors.
    const roots = document.querySelectorAll('.prose-diff .markdown-body, .prose-diff, .rich-diff-level-one .markdown-body');
    const seen = new Set();
    let idCounter = 0;
    for (const root of roots) {
      const hs = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const h of hs) {
        if (seen.has(h)) continue;
        seen.add(h);
        // Skip headings inside a `.removed` block.
        if (isInDeletedBlock(h)) continue;
        const info = fileLineMap.get(h);
        // The doc's own collapse toggle (`<button class="grdc-collapse-toggle">\u25be</button>`)
        // is a child of the heading, so `h.textContent` would include its
        // `\u25be` / `\u25b8` glyph and we'd end up rendering two chevrons per row
        // in the outline. Build the text from non-toggle child nodes only.
        let text = '';
        for (const child of h.childNodes) {
          if (child.nodeType === Node.ELEMENT_NODE && child.classList?.contains('grdc-collapse-toggle')) continue;
          text += child.textContent || '';
        }
        text = text.trim();
        out.push({
          el: h,
          id: `grdc-outline-${idCounter++}`,
          level: parseInt(h.tagName.slice(1), 10),
          text,
          slug: slugifyHeading(text),
          line: info?.line ?? null,
          file: info?.path ?? null,
        });
      }
    }
    return out;
  }

  function buildOutlinePane(sidebar) {
    const headings = collectHeadings();
    const tab = sidebar.querySelector('.grdc-sidebar-tab[data-grdc-tab="outline"]');

    // Hide the Outline tab only when the page has zero headings. We used
    // to require ≥ 3 ("a 1-heading file would just duplicate the file
    // title") but that produced confusing "where's the outline?" moments
    // on small READMEs with a single H1 plus prose. With the sidebar now
    // always visible on rich-diff and `t` to toggle, listing every
    // heading is the less surprising default.
    if (headings.length < 1) {
      tab.hidden = true;
      // If outline was the active tab, fall back to threads.
      if (localStorage.getItem(SIDEBAR_TAB_KEY) === 'outline') {
        try { localStorage.setItem(SIDEBAR_TAB_KEY, 'threads'); } catch (_) {}
      }
      return;
    }
    tab.hidden = false;

    // Per-heading thread counts. `existingComments` is keyed by threadId; we
    // need a flat list `[{line, path}, ...]` of HEADs only (one per thread).
    const seenThreads = new Set();
    const threadHeads = [];
    for (const c of (existingComments || [])) {
      if (seenThreads.has(c.threadId)) continue;
      seenThreads.add(c.threadId);
      threadHeads.push({ line: c.line, path: c.path });
    }
    const counts = attributeThreadsToHeadings(headings, threadHeads);

    // Build the nested tree and render it as a flat indented list (simpler
    // than nested ULs — we own the visual indentation via padding).
    //
    // Multi-file scoping: `buildOutlineTree` groups by heading LEVEL only
    // — it doesn't know about file boundaries. So if file B opens with an
    // H3 and the previous heading in file A was an H2, file B's first
    // heading becomes a CHILD of file A's H2. That nested heading is then
    // rendered with `indent > 0`, which skips the per-file header emit
    // (the check below is `indent === 0`), so file B loses its file
    // label. Fix: group headings by file first and build one subtree per
    // file. Every file's first heading now sits at indent 0, so the file
    // header always emits. (Filenames stay in DOM order — the outer
    // `Array.from(new Set(...))` preserves first-seen order over the
    // already-DOM-order-sorted `headings`.)
    const fileGroups = new Map();
    for (const h of headings) {
      const key = h.file || '__nofile__';
      if (!fileGroups.has(key)) fileGroups.set(key, []);
      fileGroups.get(key).push(h);
    }
    const tree = [];
    for (const [, group] of fileGroups) {
      for (const top of buildOutlineTree(group)) tree.push(top);
    }
    const treeEl = sidebar.querySelector('.grdc-sidebar-outline-tree');
    treeEl.innerHTML = '';

    // Multi-file mode: group by file when more than one file contributes
    // headings. The file path is rendered as a clickable button — clicking
    // it moves the Changes and Threads counters to the first card
    // belonging to that file (without switching tabs).
    const fileSet = new Set(headings.map(h => h.file).filter(Boolean));
    const multiFile = fileSet.size > 1;
    let currentFile = null;

    function renderNode(node, indent) {
      // File group label (only emitted at depth 0 in multi-file mode when
      // the file changes). Clickable: jumps Changes and Threads to the
      // first card for this file.
      if (multiFile && indent === 0 && node.file && node.file !== currentFile) {
        currentFile = node.file;
        const label = document.createElement('button');
        label.type = 'button';
        label.className = 'grdc-sidebar-outline-file';
        // Show just the immediate parent folder + filename, with one
        // `../` per truncated ancestor so the depth of the file is still
        // visible at a glance (matches the `../../parent/file.md`
        // convention familiar from relative paths in many tools).
        // Full path is in the `title` for hover. Examples:
        //   a/b/c/d/foo/README.md → ../../../../foo/README.md
        //   docs/README.md        → docs/README.md
        //   README.md             → README.md
        const parts = node.file.split('/').filter(Boolean);
        let short;
        if (parts.length <= 2) {
          short = parts.join('/');
        } else {
          const dropped = parts.length - 2;
          short = `${'../'.repeat(dropped)}${parts.slice(-2).join('/')}`;
        }
        label.textContent = short;
        label.title = `${node.file} — click to jump Changes & Threads to first item in this file`;
        const filePath = node.file;
        label.addEventListener('click', (ev) => {
          console.log('[GRDC] Outline file-label clicked:', filePath);
          jumpSidebarListsToFile(sidebar, filePath);
          // Defensive: stop propagation so any ancestor scroll/click
          // handler can't swallow or override our jump.
          ev.stopPropagation();
        });
        treeEl.appendChild(label);
      }
      const row = document.createElement('div');
      row.className = `grdc-sidebar-outline-row grdc-sidebar-outline-level-${node.level}`;
      row.dataset.grdcHeadingId = node.id;
      row.style.paddingLeft = `${8 + indent * 12}px`;

      const isCollapsed = node.el.classList.contains('grdc-section-collapsed');

      // Per-row chevron — click to fold/unfold THIS section only.
      const chevron = document.createElement('span');
      chevron.className = 'grdc-sidebar-outline-chevron';
      chevron.textContent = isCollapsed ? '▸' : '▾';
      chevron.title = isCollapsed ? 'Expand section' : 'Collapse section';
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        // Lazily (re-)attach the in-heading chevron in case the prose-diff
        // DOM has been re-rendered since init and `fileLineMap` is stale —
        // a bare `?.click()` would silently no-op.
        ensureCollapseToggle(node.el)?.click();
        // The toggleSection handler dispatches `grdc-section-toggled` which
        // triggers a sidebar rebuild — no need to update DOM here.
      });
      row.appendChild(chevron);

      // Main clickable label — scrolls to the heading.
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'grdc-sidebar-outline-label';
      const n = counts.get(node) || 0;
      const countHtml = n > 0 ? ` <span class="grdc-sidebar-outline-count">${n} 💬</span>` : '';
      label.innerHTML = `<span class="grdc-sidebar-outline-text">${escapeHtml(node.text || '(untitled)')}</span>${countHtml}`;
      label.addEventListener('click', () => {
        sidebar.querySelectorAll('.grdc-sidebar-outline-row.grdc-sidebar-outline-active')
          .forEach(r => r.classList.remove('grdc-sidebar-outline-active'));
        row.classList.add('grdc-sidebar-outline-active');
        scrollToWithStickyOffset(node.el);
      });
      row.appendChild(label);

      treeEl.appendChild(row);

      // Only render children if THIS section is currently expanded. When
      // the section is collapsed (in the doc), the sidebar mirrors that by
      // hiding the descendant rows too. They reappear on expand.
      if (!isCollapsed) {
        for (const child of node.children) renderNode(child, indent + 1);
      }
    }
    for (const top of tree) renderNode(top, 0);

    // Sync the Fold/Unfold button labels to current state.
    updateFoldButtonLabels(sidebar, headings);

    // Active-section highlight: which heading is currently nearest the top
    // of the visible area (i.e. the section the user is reading).
    //
    // 1.8.0 rewrite from IntersectionObserver → scroll listener:
    // The IO approach only tracked headings currently INSIDE a narrow
    // observation zone (between the sticky-header line and 40% down
    // the viewport). When the user scrolled past a heading and the next
    // heading hadn't yet entered the zone, `visibleHeadings` was empty
    // → `topmost` was null → the highlight was REMOVED with nothing to
    // replace it. On documents with widely-spaced H2/H3 sections that
    // gap could span most of the viewport, making the follow-highlight
    // blink off and never return until the next heading crossed in.
    //
    // Scroll-based scan gives a continuous, always-correct answer:
    // among ALL headings, pick the last one whose top edge has scrolled
    // past the sticky-header line (i.e. the heading immediately above
    // where the user is reading). If no heading has crossed yet (user
    // is above the first heading), fall back to the first heading in
    // the document so something is always highlighted. Passive listener
    // + rAF throttle keeps it cheap even on scroll-heavy pages.
    if (outlineActiveObserver) {
      // Old IO-based observer teardown (kept for the disconnect symmetry
      // in case any other code path still references it). The variable
      // is now used to hold the scroll listener removal handle instead
      // of an IntersectionObserver instance.
      if (typeof outlineActiveObserver.disconnect === 'function') {
        outlineActiveObserver.disconnect();
      } else if (typeof outlineActiveObserver === 'function') {
        outlineActiveObserver(); // removal handle
      }
    }
    const STICKY_OFFSET_FOR_ACTIVE = 140; // slightly below the sticky bar so a heading "activates" as its top clears the bar
    let rafPending = false;
    let lastFollowedFile = null;
    function pickActiveHeading() {
      let best = null;
      let bestY = -Infinity;
      for (const h of headings) {
        const y = h.el.getBoundingClientRect().top;
        // We want the LAST heading whose top has passed the sticky line
        // (largest y that's still ≤ the sticky line). Among the many
        // headings that have scrolled off the top, the one closest to
        // the sticky line is the section the user is currently in.
        if (y <= STICKY_OFFSET_FOR_ACTIVE && y > bestY) {
          bestY = y;
          best = h;
        }
      }
      // Fallback: user is above the first heading — highlight the first
      // heading so something is always active. (Better than "nothing
      // highlighted at all" which is what the old IO version did during
      // the gap between the top of the page and the first heading.)
      if (!best && headings.length > 0) best = headings[0];
      return best;
    }
    function updateActive() {
      rafPending = false;
      // Respect the outline-highlight pin: after an explicit file-tree /
      // file-label click, `jumpSidebarListsToFile` sets a short pin so
      // the highlight stays on the clicked file's first heading even
      // while the smooth-scroll animation is still in progress and the
      // previous file's last heading is technically the topmost above
      // the sticky line. Without this the highlight would visibly snap
      // back to the previous file mid-animation.
      if (Date.now() < outlineHighlightPinUntil) return;
      const active = pickActiveHeading();
      if (!active) return;
      if (active.id === outlineLastActiveHeadingId) return; // no change; skip DOM churn
      outlineLastActiveHeadingId = active.id;
      sidebar.querySelectorAll('.grdc-sidebar-outline-row.grdc-sidebar-outline-active')
        .forEach(r => r.classList.remove('grdc-sidebar-outline-active'));
      const row = sidebar.querySelector(`.grdc-sidebar-outline-row[data-grdc-heading-id="${active.id}"]`);
      if (row) {
        row.classList.add('grdc-sidebar-outline-active');
        // Center the active row inside the Outline pane's own scroll
        // container so the user has plenty of context above AND below
        // the highlighted heading. Using `scrollIntoView({ block:
        // 'center' })` would also scroll the PAGE (the outermost
        // scrolling ancestor), yanking the reader out of the file
        // they're reading. Instead we compute the offset inside the
        // `.grdc-sidebar-outline-tree` container and set `scrollTop`
        // directly — same visual effect, but no page scroll.
        centerRowInOutlineTree(sidebar, row);
      }
      // Scroll-follow for Changes & Threads (unchanged from the IO era):
      // fire only on file-boundary crossings, respect the
      // `scrollFollowSuppressedUntil` guard so a just-clicked jump isn't
      // yanked back by the scroll animation.
      if (active.file && active.file !== lastFollowedFile) {
        lastFollowedFile = active.file;
        if (Date.now() >= scrollFollowSuppressedUntil) {
          jumpSidebarListsToFile(sidebar, active.file);
          // Even when `jumpSidebarListsToFile` is a no-op (file has 0
          // threads AND 0 changes), the counters still need to re-render
          // because the file-scoped display (1.8.0 Option 3a) shows N/M
          // relative to the CURRENTLY-VIEWED file — walking into a
          // card-less file must update the counters to `0/0 (T)` even
          // though `currentIdx` doesn't move. `jumpSidebarListsToFile`
          // only updates counters inside its `if (idx >= 0)` branches,
          // so we explicitly re-render here to catch the 0-card case.
          updateChangesCount(sidebar);
          updateSidebarCount();
        }
      }
    }
    function onScroll() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(updateActive);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    // Fire once now so the initial state is correct without waiting for
    // the first scroll event.
    updateActive();
    // Store the removal function so a re-init's teardown can undo the
    // listener. Reuses the `outlineActiveObserver` slot for symmetry
    // with the disconnect flow above.
    outlineActiveObserver = () => window.removeEventListener('scroll', onScroll);
  }

  function setSidebarTab(sidebar, target) {
    if (!sidebar) return;
    // If outline tab is hidden (page has <3 headings) and user tried to
    // switch to it, fall back to threads.
    const outlineTab = sidebar.querySelector('.grdc-sidebar-tab[data-grdc-tab="outline"]');
    if (target === 'outline' && outlineTab?.hidden) target = 'threads';
    // Same fallback for changes — the tab auto-hides when the page has
    // zero diff blocks (the rare "empty PR" case, or before init finishes).
    const changesTab = sidebar.querySelector('.grdc-sidebar-tab[data-grdc-tab="changes"]');
    if (target === 'changes' && changesTab?.hidden) target = 'threads';
    sidebar.querySelectorAll('.grdc-sidebar-tab').forEach(t => {
      const isActive = t.dataset.grdcTab === target;
      t.classList.toggle('grdc-sidebar-tab-active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    sidebar.querySelectorAll('.grdc-sidebar-pane').forEach(p => {
      p.hidden = p.dataset.grdcPane !== target;
    });
    try { localStorage.setItem(SIDEBAR_TAB_KEY, target); } catch (_) {}
  }

  function foldOutlineAtLevel(level) {
    // Smart toggle: if every heading at this level is currently expanded,
    // fold them all; otherwise unfold every one at this level. "Some
    // collapsed, some not" prefers fold-the-rest so a second click
    // unambiguously reverses the action.
    const headings = collectHeadings();
    const atLevel = headings.filter(h => h.level === level);
    if (atLevel.length === 0) return;
    const anyExpanded = atLevel.some(h => !h.el.classList.contains('grdc-section-collapsed'));
    for (const h of atLevel) {
      const isCollapsed = h.el.classList.contains('grdc-section-collapsed');
      // anyExpanded → fold all (collapse those that aren't already).
      // !anyExpanded (all already collapsed) → unfold them.
      const shouldClick = anyExpanded ? !isCollapsed : isCollapsed;
      // Lazily attach the toggle if missing — otherwise a stale fileLineMap
      // (after a GitHub re-render) would silently swallow this click.
      if (shouldClick) ensureCollapseToggle(h.el)?.click();
    }
    // The toggles dispatch `grdc-section-toggled` which triggers a sidebar
    // rebuild, so we don't need to call buildOutlinePane here.
  }

  function expandAllOutlineSections() {
    const headings = collectHeadings();
    for (const h of headings) {
      if (!h.el.classList.contains('grdc-section-collapsed')) continue;
      ensureCollapseToggle(h.el)?.click();
    }
  }

  // Update the Fold/Unfold button labels based on the current state of
  // sections at each level. Called after every outline rebuild.
  function updateFoldButtonLabels(sidebar, headings) {
    sidebar.querySelectorAll('.grdc-sidebar-fold-level').forEach(btn => {
      const level = parseInt(btn.dataset.level, 10);
      const atLevel = headings.filter(h => h.level === level);
      if (atLevel.length === 0) {
        btn.hidden = true;
        return;
      }
      btn.hidden = false;
      const anyExpanded = atLevel.some(h => !h.el.classList.contains('grdc-section-collapsed'));
      btn.textContent = anyExpanded ? `Fold H${level}` : `Unfold H${level}`;
      btn.title = anyExpanded
        ? `Fold all H${level} sections`
        : `Unfold all H${level} sections`;
    });
  }

  // Shared counter renderer for both Threads and Changes (1.8.0 Option 3a).
  //
  // Display format:
  //   `N/M (T)` — normal case, multi-file PR:
  //       N = position of `currentIdx` within the currently-viewed file
  //           (0 if `currentIdx`'s card isn't in the viewed file — e.g.
  //           user scrolled into a card-less file after their last click)
  //       M = card count in the currently-viewed file
  //       T = card count in the whole PR (dim, wrapped in a
  //           `.grdc-sidebar-count-total` span for styling)
  //   `N/M`     — same but when the PR is single-file (M == T), the
  //               parenthetical total is dropped as redundant.
  //   `0/0 (T)` — viewport file has 0 cards of this kind. Counter row
  //               greys out via the `.grdc-sidebar-count-empty` class so
  //               the user sees at a glance "this file has none of these".
  //   `0/0`     — PR itself has 0 cards of this kind (rare — normally the
  //               whole cluster is hidden in this case; keeping the
  //               fallback text so the counter renders sensibly if it
  //               ever slips through).
  //
  // Why file-scoped: users think in files ("done with THIS file?") more
  // than in PR totals. The `(T)` hint carries the "how heavy is this PR?"
  // signal so we don't lose it entirely. Behaviour of `[`/`]`/`j`/`k`
  // stays global-walk — the change here is display only, not navigation.
  //
  // Tooltip on the counter span carries the full sentence so users hovering
  // for clarification get an explicit reading of both numbers.
  function renderScopedCounter(countEl, cards, currentIdx, kindLabel, viewFileOverride) {
    if (!countEl) return;
    const globalTotal = cards.length;
    // Prefer the explicit override when a caller knows the target file
    // (e.g. `jumpSidebarListsToFile` is answering "I just clicked X" and
    // shouldn't be second-guessed by the viewport heuristic — GitHub's
    // smooth-scroll may not have moved the viewport yet, so
    // `getCurrentViewFilePath()` still returns the previous file for a
    // moment). Scroll-driven callers pass no override and get the
    // viewport-based answer.
    let viewFile = viewFileOverride;
    if (viewFile === undefined || viewFile === null) {
      viewFile = typeof getCurrentViewFilePath === 'function' ? getCurrentViewFilePath() : '';
    }
    // Fallback: if the viewport heuristic couldn't identify a file (user
    // scrolled between diff containers, or all containers were filtered
    // by the ancestor-hidden check), use the currently-selected card's
    // file so we don't collapse to the confusing `0/T` no-view-file
    // render. The selected card's file is the reviewer's most recent
    // "you are here" signal — better than nothing.
    if (!viewFile && currentIdx >= 0 && currentIdx < cards.length) {
      const currentCard = cards[currentIdx];
      if (currentCard && currentCard.dataset && currentCard.dataset.grdcPath) {
        viewFile = currentCard.dataset.grdcPath;
      }
    }
    // Cards in the currently-viewed file — the M we'll display.
    const inFileCards = viewFile
      ? cards.filter(c => c.dataset && c.dataset.grdcPath === viewFile)
      : [];
    const fileTotal = inFileCards.length;
    // Position of the current card within its file. If the current card
    // is in the viewed file, N is its 1-based index; otherwise N=0 (we
    // haven't landed on a card in this file yet).
    let n = 0;
    if (fileTotal > 0 && currentIdx >= 0 && currentIdx < cards.length) {
      const currentCard = cards[currentIdx];
      if (currentCard && currentCard.dataset && currentCard.dataset.grdcPath === viewFile) {
        n = inFileCards.indexOf(currentCard) + 1;
      }
    }
    // Single-file PR — drop the redundant `(T)` tail. Also fire when
    // viewFile is empty (no diff container visible AND no selected card
    // to fall back to) because then `M` wouldn't be meaningful and the
    // total is all we can honestly show.
    const isSingleFile = fileTotal === globalTotal;
    const noViewFile = !viewFile;
    countEl.classList.toggle('grdc-sidebar-count-empty', fileTotal === 0 && globalTotal > 0);
    if (noViewFile || globalTotal === 0) {
      // Absolute fallback — show the flat-array position so the counter
      // is still meaningful even when everything above failed. `N` here
      // is 1-based position of the currently-selected card in the whole
      // PR (matches the pre-1.8.0 global-counter behaviour). Never render
      // `0/T` unless nothing is truly selected.
      const flatN = (currentIdx >= 0 && currentIdx < globalTotal) ? currentIdx + 1 : 0;
      countEl.textContent = `${flatN}/${globalTotal}`;
      countEl.title = kindLabel === 'threads'
        ? `${flatN} of ${globalTotal} threads in this PR`
        : `${flatN} of ${globalTotal} changes in this PR`;
      return;
    }
    // Multi-file PR: `N/M` primary, ` (T)` dim total tail.
    // Use innerHTML so the `(T)` can be a styled span. Values are integers
    // — no injection surface — but escapeHtml is trivially safe if we
    // ever change that.
    if (isSingleFile) {
      countEl.textContent = `${n}/${fileTotal}`;
    } else {
      countEl.innerHTML = `${n}/${fileTotal} <span class="grdc-sidebar-count-total">(${globalTotal})</span>`;
    }
    countEl.title = kindLabel === 'threads'
      ? `${n} of ${fileTotal} threads in this file · ${globalTotal} threads in this PR`
      : `${n} of ${fileTotal} changes in this file · ${globalTotal} changes in this PR`;
  }

  function updateSidebarCount(viewFileOverride) {
    const sidebar = document.querySelector('.grdc-sidebar');
    if (!sidebar) return;
    // Scope to the threads list — `.grdc-sidebar-card` is also used by
    // the Changes pane (`.grdc-sidebar-card.grdc-sidebar-card-change`), and
    // without the `.grdc-sidebar-list` ancestor we'd count both lists in
    // the threads counter AND make the prev/next arrows walk change cards.
    // The bug only manifests visibly when the threads list is empty (or
    // small), because thread cards usually come first in DOM order and
    // hide the leak. With 1 thread + 4 changes, you'd see "1/5" and ↓ would
    // scroll to a change. See the 2026-06 fix in the changelog.
    const cards = sidebar.querySelectorAll('.grdc-sidebar-list .grdc-sidebar-card');
    const countEl = sidebar.querySelector('.grdc-sidebar-count');
    if (!countEl) return;
    renderScopedCounter(countEl, Array.from(cards), sidebarCurrentIdx, 'threads', viewFileOverride);
    cards.forEach((c, i) => c.classList.toggle('grdc-sidebar-card-active', i === sidebarCurrentIdx));
  }

  function sidebarJump(delta) {
    const sidebar = document.querySelector('.grdc-sidebar');
    if (!sidebar) return;
    // Scope to the threads list — see comment in updateSidebarCount.
    const cards = sidebar.querySelectorAll('.grdc-sidebar-list .grdc-sidebar-card');
    if (cards.length === 0) return;
    sidebarCurrentIdx = nextWrappingIndex(sidebarCurrentIdx, delta, cards.length);
    cards[sidebarCurrentIdx].click();
    // Keep the active card visible inside the sidebar list — the click
    // handler scrolls the document to the thread, but doesn't touch the
    // sidebar's own scroll. Without this, pressing j past the bottom of
    // the visible list leaves the new active card off-screen.
    cards[sidebarCurrentIdx].scrollIntoView({ block: 'nearest' });
  }

  function scrollToThread(threadEl) {
    threadEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Flash the badge so the user sees where they landed.
    const badge = threadEl.querySelector('.grdc-thread-badge') || threadEl;
    badge.classList.add('grdc-thread-flash');
    setTimeout(() => badge.classList.remove('grdc-thread-flash'), 1200);
  }

  // Move both the Threads and Changes counters/highlights to the first
  // card belonging to `filePath`. Called when the user clicks a file
  // label in the Outline pane. Does NOT switch tabs and does NOT scroll
  // the document — the user stays on whatever tab they were on; the
  // intent is "set me up to navigate within this file". After this,
  // `j` / `k` walk the file's threads and `[` / `]` walk its changes
  // because the counters now point at the right starting position.
  // Files with zero changes / zero threads are silent no-ops on the
  // missing side; if both lists are empty for the file, nothing happens.
  function jumpSidebarListsToFile(sidebar, filePath) {
    if (!sidebar || !filePath) return;

    // Threads list — find first card whose data-grdc-path === filePath.
    const threadCards = Array.from(sidebar.querySelectorAll('.grdc-sidebar-list .grdc-sidebar-card'));
    const threadIdx = threadCards.findIndex(c => c.dataset.grdcPath === filePath);
    if (threadIdx >= 0) {
      sidebarCurrentIdx = threadIdx;
      // Pass `filePath` as the view-file override — GitHub's smooth-
      // scroll hasn't moved the viewport yet, so `getCurrentViewFilePath()`
      // would still return the previous file and the counter would render
      // relative to that. The caller knows the intended file; use it.
      updateSidebarCount(filePath);
      threadCards[threadIdx].scrollIntoView({ block: 'nearest' });
    } else {
      // File has no threads, but the user's intent is still "I'm now on
      // this file" — re-render the counter as `0/0 (T)` (or greyed) so
      // it doesn't lie about being on the previous file.
      updateSidebarCount(filePath);
    }

    // Changes list — same shape.
    const changeCards = Array.from(sidebar.querySelectorAll('.grdc-sidebar-changes-list .grdc-sidebar-card'));
    const changeIdx = changeCards.findIndex(c => c.dataset.grdcPath === filePath);
    // Diagnostic: log how we matched. If the user reports "nothing
    // happens" on click, the log shows which paths we have vs. what
    // we were looking for — most likely a `data-grdc-path` mismatch.
    console.log('[GRDC] jumpSidebarListsToFile:', {
      filePath,
      threadCards: threadCards.length,
      threadPaths: threadCards.map(c => c.dataset.grdcPath || '(none)'),
      threadIdx,
      changeCards: changeCards.length,
      changePaths: changeCards.map(c => c.dataset.grdcPath || '(none)'),
      changeIdx,
    });
    if (changeIdx >= 0) {
      changesCurrentIdx = changeIdx;
      updateChangesCount(sidebar, filePath);
      changeCards[changeIdx].scrollIntoView({ block: 'nearest' });
    } else {
      updateChangesCount(sidebar, filePath);
    }

    // Outline pane — highlight this file's first heading, so the user's
    // click lands on a row belonging to THIS file even before the
    // smooth-scroll has finished positioning the file's own heading past
    // the sticky line. Without this override, the scroll listener would
    // keep the highlight on the previous file's last heading (which is
    // still the topmost above the sticky line during the animation) —
    // making the Outline pane appear to lag behind the click.
    //
    // We pin the highlight via `outlineHighlightPinUntil` so subsequent
    // scroll events don't override it for 1500ms; after that, the scroll
    // listener resumes normal "last heading above sticky line" tracking
    // once the smooth-scroll has settled and the file's own heading has
    // moved above the sticky line naturally.
    const outlineRows = Array.from(sidebar.querySelectorAll('.grdc-sidebar-outline-row'));
    if (outlineRows.length > 0) {
      // The Outline row carries no `data-grdc-path`; instead each row's
      // `data-grdc-heading-id` maps back to a heading collected via
      // `collectHeadings()`, which knows the file. Rebuild that map on
      // demand rather than cache it — cheap, and always in sync with
      // the current DOM.
      const headings = typeof collectHeadings === 'function' ? collectHeadings() : [];
      const firstInFile = headings.find(h => h.file === filePath);
      if (firstInFile) {
        outlineRows.forEach(r => r.classList.remove('grdc-sidebar-outline-active'));
        const row = sidebar.querySelector(`.grdc-sidebar-outline-row[data-grdc-heading-id="${firstInFile.id}"]`);
        if (row) {
          row.classList.add('grdc-sidebar-outline-active');
          centerRowInOutlineTree(sidebar, row);
          outlineHighlightPinUntil = Date.now() + 1500;
          outlineLastActiveHeadingId = firstInFile.id;
        }
      }
    }
  }

  // Return the file path of the `.prose-diff` root that's currently topmost
  // in the viewport (accounting for GitHub's sticky top header). Used by
  // the header change / thread icons in 1.8.0 to answer "which file is the
  // user reading right now?" — so the icon can jump to that file's first
  // item instead of blindly advancing the global counter. Returns '' when
  // no `.prose-diff` intersects the viewport (e.g. user is scrolled to a
  // section of the page with no rendered Markdown files) — callers fall
  // back to the global-advance behaviour in that case.
  //
  // "Topmost" here means: of every `.prose-diff` that intersects the
  // viewport, the one whose top edge is closest to the sticky-header line
  // (STICKY_OFFSET below the top of the viewport, matching where
  // `scrollToWithStickyOffset` lands scrolled elements). Cheap synchronous
  // walk — no MutationObserver / IntersectionObserver needed at call time.
  function getCurrentViewFilePath() {
    const STICKY_OFFSET = 120; // matches scrollToWithStickyOffset
    // Use file CONTAINERS instead of `.prose-diff` roots so this helper
    // works whether the file is currently in rich-diff or source-diff
    // mode. In source-diff mode `.prose-diff` is `display: none` and
    // would be filtered out here, causing us to fall back to some other
    // file's `.prose-diff` — most confusingly, the previously-viewed
    // file whose rendered content still lives elsewhere on the page.
    // Containers exist regardless of view mode and always carry the
    // path we need. Selector matches the same set used everywhere else
    // (`getFilePath`, `attachCommentButtons`, etc.).
    const containers = document.querySelectorAll(
      'div[id^="diff-"], [data-tagsearch-path], .file[data-path]'
    );
    if (containers.length === 0) return '';
    let bestContainer = null;
    let bestScore = Infinity;
    for (const container of containers) {
      // Skip containers not currently in the DOM flow (rare — user
      // probably filtered them out via GitHub's file filter).
      if (!container.offsetParent && container !== document.body) continue;
      const rect = container.getBoundingClientRect();
      // Only consider containers that (a) start above the bottom of the
      // viewport AND (b) end below the sticky-header line — otherwise
      // the user isn't "reading" them.
      if (rect.bottom < STICKY_OFFSET) continue;
      if (rect.top > window.innerHeight) continue;
      // Score = distance of the container's top from the sticky line.
      // Absolute value so a container just below the sticky (positive
      // small distance) ties with one just above (negative small
      // distance) — good enough tie-break for a "current file" hint.
      const score = Math.abs(rect.top - STICKY_OFFSET);
      if (score < bestScore) {
        bestScore = score;
        bestContainer = container;
      }
    }
    if (!bestContainer) return '';
    try { return getFilePath(bestContainer) || ''; } catch (_) { return ''; }
  }

  // Header change / thread icon click handler (1.8.0). Behaviour:
  //   1. Find the file the user is currently viewing via `getCurrentViewFilePath`.
  //   2. Look up that file's first card in the requested list (`changes` or
  //      `threads`). Set the counter to that index and simulate a click on
  //      the card (which scrolls + flashes).
  //   3. If the current file has no cards in that list — or no `.prose-diff`
  //      intersects the viewport at all — fall back to the global-advance
  //      behaviour (`changesJump(+1)` / `sidebarJump(+1)`) so the icon is
  //      never a dead click.
  //
  // This is the "file-scoped" repurpose of the header icons from 1.6.0's
  // global-next semantics. The `[` / `]` and `j` / `k` keyboard shortcuts
  // still walk globally — nothing was taken away; the icons just got a
  // more useful default action.
  function jumpToFirstInCurrentFile(sidebar, listKind) {
    if (!sidebar) return;
    const path = getCurrentViewFilePath();
    const listSelector = listKind === 'threads'
      ? '.grdc-sidebar-list .grdc-sidebar-card'
      : '.grdc-sidebar-changes-list .grdc-sidebar-card';
    if (path) {
      const cards = Array.from(sidebar.querySelectorAll(listSelector));
      const idx = cards.findIndex(c => c.dataset.grdcPath === path);
      if (idx >= 0) {
        console.log(`[GRDC] Header icon → first ${listKind} in ${path} (idx ${idx})`);
        if (listKind === 'threads') {
          sidebarCurrentIdx = idx;
        } else {
          changesCurrentIdx = idx;
        }
        cards[idx].click();
        cards[idx].scrollIntoView({ block: 'nearest' });
        return;
      }
      console.log(`[GRDC] Header icon → ${listKind}: current file ${path} has no items, falling back to global next`);
    } else {
      console.log(`[GRDC] Header icon → ${listKind}: no current file detected, falling back to global next`);
    }
    // Fallback: preserve the pre-1.8.0 behaviour so the icon isn't a dead click.
    if (listKind === 'threads') sidebarJump(+1); else changesJump(+1);
  }

  // ── Changes navigation ────────────────────────────────────────────────────
  //
  // Walk every `.prose-diff` container, ask `findChangeBlocks` for the
  // reading-unit blocks that contain `<ins>`/`<del>`/`.added`/`.removed`
  // markers, and surface them in (a) the header ◀ / ▶ counter and (b) the
  // dedicated "Changes" sidebar tab. Idempotent — safe to call after every
  // `buildThreadsSidebar` rebuild because we rebuild from the live DOM.
  //
  // Distinct from thread-nav (`j`/`k`): a brand-new PR with zero comments
  // still has changes to navigate — typically the first thing a reviewer
  // wants when opening a Markdown file for the first time.
  function buildChangesPane(sidebar) {
    if (!sidebar || typeof findChangeBlocks !== 'function') return;
    const tab = sidebar.querySelector('.grdc-sidebar-tab[data-grdc-tab="changes"]');
    const headerCluster = sidebar.querySelector('.grdc-sidebar-changes-nav');
    const list = sidebar.querySelector('.grdc-sidebar-changes-list');
    if (!tab || !list) return;

    // Collect every visible `.prose-diff` root and union their change blocks.
    //
    // Per-file rule based on `routeData.diffSummaries.changeType`:
    //   ADDED   → emit ONE "whole new file" summary card (don't flood
    //              the Changes pane with per-block stops). 1.7.0 change
    //              from "silently skip".
    //   REMOVED → emit ONE "deleted file" summary card. Same reasoning.
    //   MODIFIED → per-block stops as usual.
    //
    // Synthetic whole-file blocks are tagged via the `wholeFileBlocks`
    // WeakMap so the renderer can produce a different-shaped card for them.
    const wholeFileBlocks = new WeakMap();
    const roots = document.querySelectorAll('.prose-diff');
    const blocks = [];
    roots.forEach((root) => {
      // `offsetParent` is null when the element (or any ancestor) is
      // `display: none` — in our case that's typically the file's
      // source-diff still being shown. We skip invisible roots so the
      // counter never counts changes the user can't see.
      if (!root.offsetParent && root !== document.body) return;
      // Per-file handling for ADDED / REMOVED files.
      const fileContainer = root.closest && root.closest('div[id^="diff-"], [data-tagsearch-path], .file[data-path]');
      const path = fileContainer ? (function() { try { return getFilePath(fileContainer) || ''; } catch (_) { return ''; } })() : '';
      const changeType = path && pathChangeTypeMap.get(path);
      if (changeType === 'ADDED' || changeType === 'REMOVED') {
        // One synthetic block per whole-file change. The block IS the
        // file's `.prose-diff` root; the tag tells the renderer to use
        // the whole-file card style. We DON'T also collect per-block
        // stops for these files — the summary card is the whole story.
        wholeFileBlocks.set(root, { changeType, path });
        blocks.push(root);
        return;
      }
      const found = findChangeBlocks(root);
      for (const b of found) blocks.push(b);
    });

    // Tab visibility + empty state:
    //
    //   Case A — No `.prose-diff` rendered yet (user just landed on /changes
    //     or all files are still in source-diff). Show the tab and surface
    //     the same "Render all Markdown files as rich-diff" CTA as the
    //     Threads pane uses, so the user has an obvious one-click next step.
    //   Case B — `.prose-diff` IS visible but no changed blocks anywhere
    //     (rare — a PR with literally zero rendered-markdown edits, e.g.
    //     metadata-only). Hide the tab so we don't show a stale CTA on a
    //     PR that's already rendered. Mirrors the original behaviour.
    if (blocks.length === 0) {
      const visibleRootCount = Array.from(roots).filter(
        (r) => r.offsetParent || r === document.body
      ).length;

      if (visibleRootCount === 0) {
        // Case A: actionable empty state.
        tab.hidden = false;
        // Keep the header cluster visible at `0/0` so the two nav clusters
        // always render symmetrically. Hiding it when empty made the
        // header layout shift between "only Threads" and "both" states
        // — visual jitter that obscured the fact that Changes nav exists.
        if (headerCluster) headerCluster.hidden = false;
        sidebar._grdcChangeBlocks = [];
        list.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'grdc-sidebar-empty';
        empty.innerHTML = `
          <p class="grdc-sidebar-empty-msg">No changes visible yet. Render the Markdown files as rich-diff to see them.</p>
          <button type="button" class="grdc-sidebar-empty-cta">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.744 3.744 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z"/></svg>
            <span>Render all Markdown files as rich-diff</span>
          </button>
        `;
        const cta = empty.querySelector('.grdc-sidebar-empty-cta');
        cta.addEventListener('click', () => {
          // Render-only — do NOT switch to the Outline tab. The user
          // clicked this CTA inside the Changes pane expecting changes
          // to appear after the render. (The header book button is the
          // explicit "show Outline" entry point; this CTA is context-
          // bound to the Changes pane.)
          expandAndRenderAllMd(sidebar);
        });
        list.appendChild(empty);
        updateChangesCount(sidebar);
        return;
      }

      // Case B: hide the tab outright (truly no changes).
      tab.hidden = true;
      // Even with the tab hidden, keep the header cluster visible at `0/0`
      // so the two nav clusters always render symmetrically. Without this
      // the header layout would still shift between "only Threads" and
      // "both clusters" depending on the PR's contents.
      if (headerCluster) headerCluster.hidden = false;
      if (localStorage.getItem(SIDEBAR_TAB_KEY) === 'changes') {
        try { localStorage.setItem(SIDEBAR_TAB_KEY, 'threads'); } catch (_) {}
      }
      list.innerHTML = '';
      return;
    }
    tab.hidden = false;
    if (headerCluster) headerCluster.hidden = false;

    // Cache on the sidebar element so `changesJump` can find the blocks
    // without re-walking the DOM. Live DOM references — if a MutationObserver
    // rebuild swaps these nodes, the next `buildChangesPane` will refresh.
    sidebar._grdcChangeBlocks = blocks;
    // Snap the saved index inside the new range.
    if (changesCurrentIdx >= blocks.length) changesCurrentIdx = blocks.length - 1;
    if (changesCurrentIdx < 0) changesCurrentIdx = 0;

    // Re-render the list pane. Each card shows: kind indicator, file path
    // (if discoverable), line number (if our line map has it), snippet.
    list.innerHTML = '';
    blocks.forEach((block, idx) => {
      // Whole-file summary card (1.7.0): for ADDED / REMOVED files we
      // collected ONE synthetic block per file (the file's `.prose-diff`
      // root, tagged in `wholeFileBlocks`). Render a different card shape:
      // big kind glyph + "NEW FILE" / "DELETED" label + file path + first
      // heading as snippet. Click → scroll to top of the file.
      const wholeFile = wholeFileBlocks.get(block);
      if (wholeFile) {
        const kind = wholeFile.changeType === 'ADDED' ? 'added' : 'removed';
        const path = wholeFile.path || '';
        const file = path ? (path.split('/').pop() || path) : '(unnamed file)';
        const label = wholeFile.changeType === 'ADDED' ? 'NEW FILE' : 'DELETED';
        // First heading inside the file is the nicest one-line preview.
        // Fall back to the first paragraph, then to *any* text in the
        // file (code blocks, lists, tables, blockquotes — all common in
        // a brand-new Markdown file with no prose headings). Only if
        // there's truly no text do we show "(empty file)".
        const firstHeading = block.querySelector && block.querySelector('h1, h2, h3, h4, h5, h6');
        const firstPara = !firstHeading && block.querySelector && block.querySelector('p');
        const snippetSrc = firstHeading || firstPara;
        let rawSnippet = snippetSrc ? (snippetSrc.textContent || '') : '';
        if (!rawSnippet.trim() && block.textContent) {
          rawSnippet = block.textContent;
        }
        const snippet = rawSnippet.replace(/\s+/g, ' ').trim().slice(0, 80);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `grdc-sidebar-card grdc-sidebar-card-change grdc-sidebar-card-change-${kind} grdc-sidebar-card-wholefile`;
        card.setAttribute('role', 'listitem');
        if (path) card.dataset.grdcPath = path;
        const kindGlyph = kind === 'added' ? '+' : '\u2212';
        card.innerHTML = `
          <div class="grdc-sidebar-card-head">
            <span class="grdc-sidebar-card-change-kind" title="${escapeHtml(label)}">${escapeHtml(kindGlyph)}</span>
            <span class="grdc-sidebar-card-wholefile-label">${escapeHtml(label)}</span>
            <span class="grdc-sidebar-card-loc">${escapeHtml(file)}</span>
          </div>
          <div class="grdc-sidebar-card-body">${escapeHtml(snippet) || '<em>(empty file)</em>'}</div>
        `;
        card.addEventListener('click', () => {
          changesCurrentIdx = idx;
          // Tell the Outline IO to stand down while the smooth-scroll
          // animation runs — otherwise it'd race us and yank the
          // selection back to the previous file (especially bad here
          // because a brand-new file may have no headings at all and
          // the previous file's heading would "win" topmost forever).
          scrollFollowSuppressedUntil = Date.now() + 1500;
          // Scroll to the top of the file's prose-diff root.
          if (typeof scrollToWithStickyOffset === 'function') {
            scrollToWithStickyOffset(block);
          } else {
            block.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }
          updateChangesCount(sidebar);
        });
        list.appendChild(card);
        return;
      }

      const kind = classifyChangeKind(block) || 'mixed';
      const snippet = buildChangeSnippet(block, 90);

      // File path is discoverable from the nearest file-container ancestor
      // (`div[id^="diff-"]` / `[data-tagsearch-path]` / `.file[data-path]`)
      // — same selector we use elsewhere. Missing path is acceptable; the
      // card just won't show one.
      const fileContainer = block.closest && block.closest('div[id^="diff-"], [data-tagsearch-path], .file[data-path]');
      const path = fileContainer ? getFilePath(fileContainer) : '';
      const file = path ? (path.split('/').pop() || path) : '';

      // Line number is best-effort — `fileLineMap` only knows about blocks
      // we've registered for the `+` button. Deleted blocks (`<del>` /
      // `.removed`) aren't in the map because they don't exist in the
      // post-change source. For those we render "(removed)" instead.
      const mapEntry = fileLineMap.get && fileLineMap.get(block);
      const line = mapEntry && mapEntry.line ? String(mapEntry.line) : '';
      const loc = file && line ? `${file}:${line}`
        : file ? file
        : line ? `line ${line}`
        : '';

      const card = document.createElement('button');
      card.type = 'button';
      card.className = `grdc-sidebar-card grdc-sidebar-card-change grdc-sidebar-card-change-${kind}`;
      card.setAttribute('role', 'listitem');
      // Stash the full path on the card so the Outline pane's file-label
      // click handler can find the first Changes card per file.
      if (path) card.dataset.grdcPath = path;
      const isTruncated = snippet.endsWith('\u2026');
      const bodyClass = 'grdc-sidebar-card-body' + (isTruncated ? ' grdc-sidebar-card-body-truncated' : '');
      const bodyText = isTruncated ? snippet.slice(0, -1).trimEnd() : snippet;
      const kindGlyph = kind === 'added' ? '+'
        : kind === 'removed' ? '\u2212'
        : '\u00b1';
      const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1);
      card.innerHTML = `
        <div class="grdc-sidebar-card-head">
          <span class="grdc-sidebar-card-change-kind" title="${escapeHtml(kindLabel)}">${escapeHtml(kindGlyph)}</span>
          <span class="grdc-sidebar-card-loc">${escapeHtml(loc || '(no location)')}</span>
        </div>
        <div class="${bodyClass}">${escapeHtml(bodyText) || '<em>(no text)</em>'}</div>
      `;
      card.addEventListener('click', () => {
        changesCurrentIdx = idx;
        scrollToChange(block);
        updateChangesCount(sidebar);
      });
      list.appendChild(card);
    });

    updateChangesCount(sidebar);
  }

  function updateChangesCount(sidebar, viewFileOverride) {
    if (!sidebar) return;
    const countEl = sidebar.querySelector('.grdc-sidebar-changes-count');
    if (!countEl) return;
    const cards = Array.from(sidebar.querySelectorAll('.grdc-sidebar-changes-list .grdc-sidebar-card'));
    renderScopedCounter(countEl, cards, changesCurrentIdx, 'changes', viewFileOverride);
    cards.forEach((c, i) => c.classList.toggle('grdc-sidebar-card-active', i === changesCurrentIdx));
  }

  function changesJump(delta) {
    const sidebar = document.querySelector('.grdc-sidebar');
    if (!sidebar) return;
    const blocks = sidebar._grdcChangeBlocks || [];
    if (blocks.length === 0) return;
    changesCurrentIdx = nextChangeIndex(changesCurrentIdx, delta, blocks.length);
    scrollToChange(blocks[changesCurrentIdx]);
    updateChangesCount(sidebar);
    // Keep the active card visible in the Changes list (mirrors sidebarJump).
    const cards = sidebar.querySelectorAll('.grdc-sidebar-changes-list .grdc-sidebar-card');
    if (cards[changesCurrentIdx]) {
      cards[changesCurrentIdx].scrollIntoView({ block: 'nearest' });
    }
  }

  function scrollToChange(blockEl) {
    if (!blockEl) return;
    // Any explicit "jump to a change" — whether from a Changes-card click,
    // `[` / `]` keyboard nav, or jump-to-first/last — triggers a smooth
    // scroll. While that scroll animates, the Outline IntersectionObserver
    // would otherwise see the *previous* file's heading topmost and yank
    // the sidebar selection back. Suppress scroll-follow for the duration
    // of the animation. See the comment on `scrollFollowSuppressedUntil`.
    scrollFollowSuppressedUntil = Date.now() + 1500;
    // Use the same sticky-offset-aware scroll the Outline tab uses so the
    // change doesn't land under GitHub's sticky file header.
    if (typeof scrollToWithStickyOffset === 'function') {
      scrollToWithStickyOffset(blockEl);
    } else {
      blockEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    // Brief outline flash so the user sees where they landed — reuses the
    // same animation pattern as the thread flash but on the block itself.
    blockEl.classList.add('grdc-change-flash');
    setTimeout(() => blockEl.classList.remove('grdc-change-flash'), 1200);
  }

  // Keyboard navigation:
  //   `j` / `k` — next / previous thread (vim-style)
  //   `h` / `l` — first / last thread
  // GitHub's PR pages don't bind these single-key shortcuts on the
  // Files-changed tab (the page-level `g j` / `g k` chord is GitHub's
  // "go to bottom / top of page"; we deliberately don't shadow it).
  // Skipped when the user is typing into any input / textarea /
  // contenteditable. Bound once at script load so it survives re-inits.
  document.addEventListener('keydown', (e) => {
    // Ignore when typing into any input/textarea/contenteditable.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Sidebar visibility shortcuts run BEFORE the "sidebar must exist with
    // cards" check below so they still work when the sidebar is collapsed
    // or has no threads (Outline-only mode).
    //   t       → toggle collapsed / expanded
    //   Shift+T → reset position / size / collapsed (recover offscreen)
    if (e.key === 'T' && e.shiftKey) {
      e.preventDefault();
      resetSidebarLayout();
      return;
    }
    if (e.key === 't' && !e.shiftKey) {
      e.preventDefault();
      toggleSidebarCollapsed();
      return;
    }
    // `b` — "book" / show Outline. Mirrors clicking the header book
    // button: expand the panel (if collapsed), render all .md files,
    // then switch to the Outline tab. Idempotent: pressing `b` again
    // while already on Outline does the render-check and stays put.
    if (e.key === 'b' && !e.shiftKey) {
      const sidebar = document.querySelector('.grdc-sidebar');
      if (!sidebar) return;
      e.preventDefault();
      const btn = sidebar.querySelector('.grdc-sidebar-render-md');
      if (btn) btn.click();
      return;
    }
    // Tab-switch shortcuts — single digit 1/2/3 maps to Threads / Outline /
    // Changes respectively. Auto-expands the sidebar if collapsed (same
    // affordance the render-md button uses) so pressing `3` on a fresh
    // PR doesn't silently swap the hidden tab behind a slim bar.
    // `setSidebarTab` already gracefully falls back to threads if the
    // requested tab is hidden (e.g. Changes when no rich-diff is rendered).
    if (!e.shiftKey && (e.key === '1' || e.key === '2' || e.key === '3')) {
      const sidebar = document.querySelector('.grdc-sidebar');
      if (!sidebar) return;
      e.preventDefault();
      if (sidebar.classList.contains('grdc-sidebar-collapsed')) {
        sidebar.classList.remove('grdc-sidebar-collapsed');
        try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, '0'); } catch (_) {}
      }
      const target = e.key === '1' ? 'changes'
        : e.key === '2' ? 'threads'
        : 'outline';
      setSidebarTab(sidebar, target);
      return;
    }
    // Change-nav: vim's `[c` / `]c` convention. Single-key variants since
    // GitHub doesn't bind `[` / `]` on PR pages. Always-on (doesn't need
    // a focused sidebar) so the user can scan diffs without touching the
    // mouse — the most common "open MD PR for the first time" flow.
    if (e.key === ']' && !e.shiftKey) {
      const sidebar = document.querySelector('.grdc-sidebar');
      if (sidebar && (sidebar._grdcChangeBlocks || []).length > 0) {
        e.preventDefault();
        changesJump(+1);
        return;
      }
    }
    if (e.key === '[' && !e.shiftKey) {
      const sidebar = document.querySelector('.grdc-sidebar');
      if (sidebar && (sidebar._grdcChangeBlocks || []).length > 0) {
        e.preventDefault();
        changesJump(-1);
        return;
      }
    }
    // First / last change — Shift+[ / Shift+] (which produce `{` / `}` on
    // US QWERTY). Mirrors `h` / `l` for threads. Vim convention: `{` / `}`
    // are paragraph navigation in normal mode; here they're the bookends
    // for the same Changes pane that `[` / `]` step through.
    if (e.key === '{') {
      const sidebar = document.querySelector('.grdc-sidebar');
      const blocks = sidebar && (sidebar._grdcChangeBlocks || []);
      if (blocks && blocks.length > 0) {
        e.preventDefault();
        changesCurrentIdx = 0;
        scrollToChange(blocks[0]);
        updateChangesCount(sidebar);
        const cards = sidebar.querySelectorAll('.grdc-sidebar-changes-list .grdc-sidebar-card');
        if (cards[0]) cards[0].scrollIntoView({ block: 'nearest' });
        return;
      }
    }
    if (e.key === '}') {
      const sidebar = document.querySelector('.grdc-sidebar');
      const blocks = sidebar && (sidebar._grdcChangeBlocks || []);
      if (blocks && blocks.length > 0) {
        e.preventDefault();
        const last = blocks.length - 1;
        changesCurrentIdx = last;
        scrollToChange(blocks[last]);
        updateChangesCount(sidebar);
        const cards = sidebar.querySelectorAll('.grdc-sidebar-changes-list .grdc-sidebar-card');
        if (cards[last]) cards[last].scrollIntoView({ block: 'nearest' });
        return;
      }
    }
    // Only fire when the sidebar exists and has at least one thread —
    // otherwise we'd swallow plain `j`/`k` on pages where we have nothing
    // to navigate to. Scope to the threads list so the count doesn't
    // include change cards (which also carry `.grdc-sidebar-card`).
    const sidebar = document.querySelector('.grdc-sidebar');
    if (!sidebar) return;
    const cards = sidebar.querySelectorAll('.grdc-sidebar-list .grdc-sidebar-card');
    if (cards.length === 0) return;
    switch (e.key) {
      case 'j':
        e.preventDefault();
        sidebarJump(+1);
        return;
      case 'k':
        e.preventDefault();
        sidebarJump(-1);
        return;
      case 'h':
        // First thread.
        e.preventDefault();
        sidebarCurrentIdx = 0;
        cards[0].click();
        cards[0].scrollIntoView({ block: 'nearest' });
        return;
      case 'l':
        // Last thread.
        e.preventDefault();
        sidebarCurrentIdx = cards.length - 1;
        cards[cards.length - 1].click();
        cards[cards.length - 1].scrollIntoView({ block: 'nearest' });
        return;
    }
  }, true);

  // ── TOC anchor jumps in rich-diff ───────────────────────────────────────
  //
  // On a PR's rich-diff page (`/pull/<n>/changes`) GitHub strips heading
  // `id="user-content-<slug>"` attributes because the same PR can modify
  // multiple files with identically-named headings (duplicate ids would be
  // invalid HTML). The blob view doesn't have this problem because each file
  // has its own document. The consequence: clicking a heading link in a
  // rendered TOC (e.g. `[Change Log](#change-log)`) updates the URL hash
  // but the browser finds no matching target and doesn't scroll.
  //
  // Fix: when the hash changes (or is present on load) and the browser's
  // default scroll didn't land us at a matching element, walk every heading
  // in the rich-diff prose body, slugify its textContent, and scroll to the
  // first match. If `?file=<path>` is in the URL, restrict the walk to the
  // matching file container so headings in other files don't shadow it.
  //
  // The `slugifyHeading` helper lives in src/lib/anchors.js (pure, tested).
  // Scroll an element to just below GitHub's sticky header. The sticky bar
  // ("Files changed" / file-nav) covers the top ~80px of the viewport; a
  // plain `scrollIntoView({ block: 'start' })` aligns to viewport-top 0
  // which is hidden. Shared by the TOC-anchor jump and the Outline tab.
  function scrollToWithStickyOffset(el) {
    if (!el) return;
    const STICKY_OFFSET = 120;
    const top = window.scrollY + el.getBoundingClientRect().top - STICKY_OFFSET;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  // Center a row inside the Outline pane's own scroll container. Manual
  // math instead of `row.scrollIntoView({ block: 'center' })` because the
  // built-in also scrolls every scrolling ancestor — including the page
  // — which would yank the reader out of the file they're reading. We
  // only ever want the outline list to scroll, never the page.
  function centerRowInOutlineTree(sidebar, row) {
    if (!sidebar || !row) return;
    const tree = sidebar.querySelector('.grdc-sidebar-outline-tree');
    if (!tree) return;
    // `offsetTop` on the row is relative to its offsetParent chain. In
    // our outline layout the tree container is the row's scrolling
    // ancestor but not necessarily its offsetParent (rows sit inside a
    // per-file button block). Use `getBoundingClientRect` deltas instead
    // — always correct regardless of intermediate layout wrappers.
    const treeRect = tree.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    // Where the row sits inside the tree's scroll coord system.
    const rowTopInTree = rowRect.top - treeRect.top + tree.scrollTop;
    // Target scrollTop that puts the row's center at the tree's center.
    const target = rowTopInTree - (tree.clientHeight / 2) + (rowRect.height / 2);
    // Clamp so we don't try to scroll past the tree's bounds (would jerk
    // to 0 or max-scroll instead of leaving the row wherever it already
    // is, which for edge rows is more natural than centering).
    const maxScroll = tree.scrollHeight - tree.clientHeight;
    tree.scrollTop = Math.max(0, Math.min(target, maxScroll));
  }

  function tryScrollToHashAnchor() {
    const hash = (window.location.hash || '').replace(/^#/, '');
    if (!hash) return;
    // If the browser already found a target with this id/name, native
    // anchoring handles it — bail.
    if (document.getElementById(hash) || document.getElementsByName(hash).length) return;

    // Scope to the file matching `?file=<path>` when present; otherwise
    // search across all rich-diff prose bodies on the page.
    let scope;
    try {
      const fileParam = new URL(window.location.href).searchParams.get('file');
      if (fileParam) {
        const containers = document.querySelectorAll('div[id^="diff-"]');
        for (const c of containers) {
          if (getFilePath(c) === fileParam) { scope = c; break; }
        }
      }
    } catch (_) {}
    const roots = scope
      ? [scope.querySelector('.prose-diff .markdown-body, .prose-diff, .rich-diff-level-one .markdown-body')].filter(Boolean)
      : document.querySelectorAll('.prose-diff .markdown-body, .prose-diff, .rich-diff-level-one .markdown-body');

    for (const root of roots) {
      const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const h of headings) {
        if (slugifyHeading(h.textContent) === hash) {
          scrollToWithStickyOffset(h);
          return;
        }
      }
    }
  }

  window.addEventListener('hashchange', tryScrollToHashAnchor);

  // Whenever any section toggles (sidebar chevron, fold/unfold button, or
  // the heading's own collapse chevron in the doc), rebuild the outline
  // pane so its rows hide/show in sync with the doc and the Fold/Unfold
  // button labels stay accurate. Debounced so the smart-toggle / Expand
  // all paths — which click N collapse toggles in a row — trigger ONE
  // rebuild at the end rather than N rebuilds. Without this, expanding
  // 13 sections meant 13 full outline rebuilds + IntersectionObserver
  // reconnects, visibly stuttering on screen.
  let _outlineRebuildTimer = null;
  document.addEventListener('grdc-section-toggled', () => {
    if (_outlineRebuildTimer) return;
    _outlineRebuildTimer = setTimeout(() => {
      _outlineRebuildTimer = null;
      const sidebar = document.querySelector('.grdc-sidebar');
      if (sidebar) buildOutlinePane(sidebar);
    }, 50);
  });

  async function init() {
    prInfo = parsePRUrl();
    if (!prInfo) return;

    // Don't blow away an active inline editor (Edit-comment textarea). When
    // the user is mid-edit, a re-init from any source — GitHub's React
    // optimistic updates, our own URL poll, MutationObserver — would call
    // `clearInjectedDom()` and wipe the editor + everything they typed.
    // Defer until they save or cancel; the next user action (or the next
    // observer fire after the editor closes) will reinit.
    if (document.querySelector('.grdc-comment-edit')) {
      console.log('[GRDC] Skipping init: active edit in progress');
      return;
    }

    // Clean up prior renders BEFORE reading any block textContent. Without
    // this, re-init on a page where we've already injected `▾` toggles and
    // `+` buttons feeds polluted text into the matcher.
    clearInjectedDom();

    // Fetch route data first (builds pathDigest map + caches for comments)
    await fetchRouteData();

    // Kick off `fetchExistingComments()` in parallel with `buildLineMap()`.
    // Both only need `routeData` (already cached above): `fetchExistingComments`
    // walks `routeData.markers.threads` purely in-memory, while `buildLineMap`
    // fires off N blob-page fetches for source matching. Running them
    // concurrently overlaps the (mostly synchronous) comment shaping with
    // the network round-trips, shaving a noticeable chunk off cold init on
    // multi-file PRs.
    const commentsPromise = fetchExistingComments();

    await buildLineMap();
    attachCommentButtons();
    attachCollapseToggles();

    existingComments = await commentsPromise;
    console.log(`[GRDC] Fetched ${existingComments.length} existing comments`);
    renderExistingComments();
    buildThreadsSidebar();

    // If the page loaded with a heading hash (e.g. user clicked a TOC link
    // before our init finished), the browser's native scroll-to-anchor will
    // have already failed silently — GitHub strips heading ids in rich-diff.
    // Run the slug-matched fallback now that headings are in the DOM.
    tryScrollToHashAnchor();

    // Pre-warm @-mention suggestions in the background so the first `@` keystroke
    // doesn't trigger a 50KB PR HTML fetch + suggestions request synchronously.
    // Fire-and-forget; if it fails the typing path retries.
    fetchMentionSuggestions().catch(() => {});

    console.log(
      `[GRDC] Initialized: ${fileLineMap.size} commentable elements found`
    );
  }

  // ── Observe DOM Changes (GitHub uses SPA navigation) ───────────────────────

  let reinitTimer = null;
  function scheduleReinit() {
    if (reinitTimer) return;
    // Capture scroll position BEFORE the 500ms debounce window. GitHub's own
    // React optimistic updates (e.g. after we post a reply) trigger our
    // MutationObserver, which triggers this scheduler, which runs `init()` —
    // and `init()` calls `clearInjectedDom()` + full rebuild, which would
    // otherwise reset the page to scrollY=0 because every block we'd
    // previously sized with injected `+` buttons / threads is gone for a
    // frame. Restoring after `init()` finishes keeps the user where they
    // were (e.g. reading the thread they just replied to). URL-navigation
    // re-inits go through a different code path (`maybeInit` directly) and
    // intentionally land at top, so this restore only fires for
    // mutation-driven re-inits.
    const savedScrollY = window.scrollY;
    reinitTimer = setTimeout(async () => {
      reinitTimer = null;
      await init();
      // Restore after the next paint so layout has settled. Use both
      // `requestAnimationFrame` and a microtask fallback in case the page is
      // backgrounded (rAF doesn't fire for hidden tabs).
      const restore = () => window.scrollTo(0, savedScrollY);
      requestAnimationFrame(restore);
      Promise.resolve().then(restore);
    }, 500);
  }

  function observe() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          // Ignore our own renders to avoid feedback loop
          if (node.classList?.contains('grdc-existing-thread') ||
              node.classList?.contains('grdc-comment-box') ||
              node.classList?.contains('grdc-comment-btn') ||
              node.classList?.contains('grdc-collapse-toggle') ||
              node.classList?.contains('grdc-reply-box') ||
              node.classList?.contains('grdc-comment-edit') ||
              node.classList?.contains('grdc-comment-menu-popover') ||
              node.classList?.contains('grdc-sidebar')) continue;
          if (node.classList?.contains('markdown-body') ||
              node.classList?.contains('rich-diff-level-one') ||
              node.querySelector?.('.prose-diff .markdown-body')) {
            scheduleReinit();
            return;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // File-tree click sync (1.8.0). GitHub's Files-changed page has several
    // navigation surfaces that scroll to a specific file: the left-side
    // file tree panel, the "Jump to file" dropdown, the file-list overview,
    // and even in-page "N files changed" links. All of them ultimately
    // point at `#diff-<hash>` anchors — the hash matches a
    // `div[id="diff-<hash>"]` container that wraps each file.
    //
    // Rather than target one specific tree component (which GitHub redesigns
    // periodically), we listen for ANY click on such an anchor and use its
    // href to find the destination file's diff container. Then we call
    // `jumpSidebarListsToFile` so our sidebar's Changes / Threads counters
    // jump to that file's first item — leading the smooth-scroll rather
    // than trailing it via the IntersectionObserver.
    //
    // Uses the capture phase so we run before GitHub's own scroll handler
    // takes over. We DON'T prevent the default — GitHub still gets to do
    // its scroll animation; we just piggy-back on the click to align the
    // sidebar. Delegated on document so a single listener covers every
    // navigation surface, present and future.
    //
    // Anchor recognition: `a[href*="#diff-"]` covers the classic
    // file-list overview anchors. Newer GitHub file trees (e.g. the
    // "Groups by Copilot" panel) may render as `<a>` elements without a
    // `#diff-` href — instead using React-router pushState or click
    // handlers with no href at all. Fallback: any `<a>` with a `title`
    // attribute matching a known PR file path (looked up via
    // `pathChangeTypeMap`), since GitHub consistently uses `title` for
    // the file's full path on file-tree entries.
    document.addEventListener('click', (ev) => {
      // Ignore clicks inside our own sidebar — those have their own
      // handlers that already call `jumpSidebarListsToFile` correctly.
      const inSidebar = ev.target && ev.target.closest && ev.target.closest('.grdc-sidebar');
      if (inSidebar) return;
      const anchor = ev.target.closest && ev.target.closest('a, [role="treeitem"], [role="link"]');
      if (!anchor) return;
      const sidebar = document.querySelector('.grdc-sidebar');
      if (!sidebar) return;

      // Path resolution — try three strategies in order of specificity:
      //   1. `href` contains `#diff-<hash>` → find that container, read path
      //   2. `title` attribute matches a known PR file path
      //   3. `textContent` matches a known PR file path (last-resort — some
      //      tree items only carry the path as visible text)
      let path = '';
      const href = anchor.getAttribute && anchor.getAttribute('href');
      if (href) {
        const hashIdx = href.indexOf('#diff-');
        if (hashIdx >= 0) {
          const hash = href.slice(hashIdx + 1);
          const container = document.getElementById(hash);
          if (container) {
            try { path = getFilePath(container) || ''; } catch (_) { /* keep empty */ }
          }
        }
      }
      if (!path) {
        const title = anchor.getAttribute && anchor.getAttribute('title');
        if (title && pathChangeTypeMap.has(title)) path = title;
      }
      if (!path) {
        const text = (anchor.textContent || '').trim();
        if (text && pathChangeTypeMap.has(text)) path = text;
      }
      if (!path) return;

      console.log(`[GRDC] File-tree click → ${path}`);
      jumpSidebarListsToFile(sidebar, path);
    }, { capture: true });
  }

  // ── Entry Point ────────────────────────────────────────────────────────────

  // SPA navigation: GitHub uses history.pushState to switch between PR tabs
  // (Conversation / Commits / Files changed) without a full page load. Chrome
  // does NOT re-inject content scripts on pushState — so when the user lands
  // on /pull/<n> and later clicks Files changed, this script is still the one
  // that was injected on the initial load (now with permission to run on the
  // broader /pull/* match).
  //
  // We can't reliably hook into pushState: content scripts run in an isolated
  // world, while GitHub's React app calls history.pushState from the main
  // world. A monkey-patch on `history.pushState` in our world never sees the
  // main-world calls. (Bridging worlds requires either a script-tag injection
  // relay or chrome.scripting with `world: "MAIN"` from a service worker —
  // both significantly more complex than necessary.)
  //
  // Instead: poll `window.location.pathname` every 400ms. Reading the URL
  // works across worlds, the poll is cheap, and 400ms is well under perceptual
  // latency when clicking a tab. Also listen for `popstate` (fires across
  // worlds for back/forward navigation) so we react instantly to those.
  let lastInitPath = null;
  function maybeInit() {
    const path = window.location.pathname;
    if (path === lastInitPath) return;
    lastInitPath = path;
    // If the user navigated away from Files-changed (e.g. clicked
    // Conversation / Commits / Checks, or left the PR entirely), the
    // sidebar has nothing to do: existing threads are rendered inline
    // by GitHub's Conversation view, there is no rich-diff to walk,
    // and Outline has no `.prose-diff` content to outline. Remove it
    // so it doesn't sit on top of the destination page (the 1.7.0
    // top-centre default made this especially visible on Conversation,
    // where the sidebar would cover the PR title strip).
    //
    // We also drop any injected `+` buttons / thread badges via
    // `clearInjectedDom` for the same reason — they're anchored to
    // rich-diff blocks that no longer exist.
    if (!parsePRUrl()) {
      const stale = document.querySelector('.grdc-sidebar');
      if (stale) {
        console.log(`[GRDC] URL changed → ${path}, removing sidebar (not on Files-changed)`);
        stale.remove();
      }
      clearInjectedDom();
      return;
    }
    console.log(`[GRDC] URL changed → ${path}, running init()`);
    init();
  }
  window.addEventListener('popstate', maybeInit);
  setInterval(maybeInit, 400);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { maybeInit(); observe(); });
  } else {
    maybeInit();
    observe();
  }
})();
