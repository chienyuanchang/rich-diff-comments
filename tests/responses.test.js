const test = require('node:test');
const assert = require('node:assert/strict');

const {
  looksLikePath,
  findBlobInJson,
  threadResponseToComments,
  escapeHtml,
  formatTimeAgo,
  parseMarkersMap,
  buildAnchorKey,
  parseLineFromAnchor,
} = require('../src/lib/responses.js');

test('looksLikePath accepts normal paths', () => {
  assert.equal(looksLikePath('src/foo.js'), true);
  assert.equal(looksLikePath('a/b/c/d.md'), true);
  assert.equal(looksLikePath('README.md'), true);
});

test('looksLikePath rejects falsy / non-strings', () => {
  assert.equal(looksLikePath(null), false);
  assert.equal(looksLikePath(undefined), false);
  assert.equal(looksLikePath(''), false);
  assert.equal(looksLikePath(42), false);
  assert.equal(looksLikePath({}), false);
});

test('looksLikePath rejects multi-line / leading-whitespace / oversize (bug fix)', () => {
  // Bug history: mermaid <pre> clipboard-copy values like "graph TD\n  A --> B"
  // used to be mistakenly treated as file paths.
  assert.equal(looksLikePath('graph TD\n  A --> B'), false);
  assert.equal(looksLikePath('  leading-ws.js'), false);
  assert.equal(looksLikePath('x'.repeat(600)), false);
});

test('looksLikePath accepts forward-slash paths (Windows paths use backslashes, GitHub never does)', () => {
  // Note: GitHub always uses `/` in repo paths. We don't reject Windows-style
  // paths because we don't know enough to (a user repo could in theory contain
  // a `\` in a filename, weird though that is). But verify the common pattern.
  assert.equal(looksLikePath('src/foo.js'), true);
  // Backslashes are accepted (they're valid in a string), but won't match any
  // real GitHub path in `pathDigestMap` — so they're harmless if they slip through.
  assert.equal(looksLikePath('C:\\\\foo\\\\bar'), true);
});

test('findBlobInJson extracts rawLines from nested object', () => {
  const json = { a: { b: { payload: { blob: { rawLines: ['line1', 'line2'] } } } } };
  assert.equal(findBlobInJson(json), 'line1\nline2');
});

test('findBlobInJson extracts rawBlob fallback', () => {
  const json = { payload: { blob: { rawBlob: 'full file text' } } };
  assert.equal(findBlobInJson(json), 'full file text');
});

test('findBlobInJson returns null when neither key present', () => {
  assert.equal(findBlobInJson({ unrelated: { stuff: 'here' } }), null);
});

test('findBlobInJson respects depth limit (no infinite recursion)', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(findBlobInJson(cyclic), null);
});

test('threadResponseToComments — minimal happy path', () => {
  const data = {
    thread: {
      id: 't1',
      commentsData: {
        comments: [
          { databaseId: 100, body: 'first', author: { login: 'alice' }, createdAt: '2026-05-01T00:00:00Z' },
        ],
      },
    },
  };
  const out = threadResponseToComments(data, 'docs/a.md', 42);
  assert.equal(out.length, 1);
  assert.equal(out[0].path, 'docs/a.md');
  assert.equal(out[0].line, 42);
  assert.equal(out[0].body, 'first');
  assert.equal(out[0].user, 'alice');
  assert.equal(out[0].threadId, 't1');
  assert.equal(out[0].headDbId, 100);
  assert.equal(out[0].isHead, true);
});

test('threadResponseToComments — captures resolved / outdated / viewer flags', () => {
  const data = {
    thread: {
      id: 't2',
      isResolved: true,
      isOutdated: true,
      viewerCanReply: false,
      viewerCanResolve: false,
      commentsData: { comments: [{ databaseId: 1, body: 'x' }] },
    },
  };
  const [c] = threadResponseToComments(data, 'p.md', 1);
  assert.equal(c.isResolved, true);
  assert.equal(c.isOutdated, true);
  assert.equal(c.viewerCanReply, false);
  assert.equal(c.viewerCanResolve, false);
});

test('threadResponseToComments — defaults: viewerCanReply true when omitted', () => {
  const data = { thread: { id: 't3', commentsData: { comments: [{ databaseId: 1, body: 'x' }] } } };
  const [c] = threadResponseToComments(data, 'p.md', 1);
  assert.equal(c.viewerCanReply, true);
  assert.equal(c.viewerCanResolve, true);
  assert.equal(c.isResolved, false);
  assert.equal(c.isOutdated, false);
});

test('threadResponseToComments — multi-comment thread: headDbId from FIRST, isHead flag set on index 0 only', () => {
  const data = {
    thread: {
      id: 't4',
      commentsData: {
        comments: [
          { databaseId: 10, body: 'parent' },
          { databaseId: 11, body: 'reply 1' },
          { databaseId: 12, body: 'reply 2' },
        ],
      },
    },
  };
  const out = threadResponseToComments(data, 'p.md', 1);
  assert.equal(out.length, 3);
  assert.equal(out[0].isHead, true);
  assert.equal(out[1].isHead, false);
  assert.equal(out[2].isHead, false);
  // Every reply tracks the SAME headDbId — needed for reply API as inReplyTo
  assert.equal(out[0].headDbId, 10);
  assert.equal(out[1].headDbId, 10);
  assert.equal(out[2].headDbId, 10);
});

test('threadResponseToComments — falls back to snake_case fields (GraphQL vs REST shape)', () => {
  const data = {
    thread: {
      id: 't5',
      commentsData: {
        comments: [{
          database_id: 99,
          bodyText: 'body via bodyText',
          user: { login: 'bob' },
          created_at: '2026-01-01',
          html_url: 'http://x',
        }],
      },
    },
  };
  const [c] = threadResponseToComments(data, 'p.md', 1);
  assert.equal(c.headDbId, 99);
  assert.equal(c.body, 'body via bodyText');
  assert.equal(c.user, 'bob');
  assert.equal(c.createdAt, '2026-01-01');
  assert.equal(c.htmlUrl, 'http://x');
});

test('threadResponseToComments — empty / missing input returns []', () => {
  assert.deepEqual(threadResponseToComments(null, 'p.md', 1), []);
  assert.deepEqual(threadResponseToComments({}, 'p.md', 1), []);
  assert.deepEqual(threadResponseToComments({ thread: {} }, 'p.md', 1), []);
  assert.deepEqual(threadResponseToComments({ thread: { commentsData: { comments: [] } } }, 'p.md', 1), []);
});

test('threadResponseToComments — accepts both `data.thread` and bare-thread shapes', () => {
  const wrapped = { thread: { id: 't6', commentsData: { comments: [{ databaseId: 1, body: 'a' }] } } };
  const bare = { id: 't6', commentsData: { comments: [{ databaseId: 1, body: 'a' }] } };
  const a = threadResponseToComments(wrapped, 'p.md', 1);
  const b = threadResponseToComments(bare, 'p.md', 1);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0].threadId, b[0].threadId);
});

test('threadResponseToComments — bodyHTML round-trips when GitHub sends it (preferred for display)', () => {
  const data = {
    thread: {
      id: 't7',
      commentsData: {
        comments: [{
          databaseId: 1,
          body: '**bold**',
          bodyHTML: '<p><strong>bold</strong></p>',
        }],
      },
    },
  };
  const [c] = threadResponseToComments(data, 'p.md', 1);
  assert.equal(c.body, '**bold**');
  assert.equal(c.bodyHTML, '<p><strong>bold</strong></p>');
});

test('threadResponseToComments — bodyHTML falls back to snake_case body_html', () => {
  const data = {
    thread: {
      id: 't8',
      commentsData: { comments: [{ databaseId: 1, body: 'x', body_html: '<p>x</p>' }] },
    },
  };
  const [c] = threadResponseToComments(data, 'p.md', 1);
  assert.equal(c.bodyHTML, '<p>x</p>');
});

test('threadResponseToComments — caller-supplied startLine propagates to comments (range posts)', () => {
  // GitHub's `create_review_comment` response doesn't include the range
  // start, so callers pass it through after submitting a multi-line comment.
  const data = {
    thread: { id: 't9', commentsData: { comments: [{ databaseId: 1, body: 'range' }] } },
  };
  const [c] = threadResponseToComments(data, 'p.md', 19, 9);
  assert.equal(c.line, 19);
  assert.equal(c.startLine, 9);
});

test('threadResponseToComments — startLine ignored when equal to line (single-line)', () => {
  const data = {
    thread: { id: 't10', commentsData: { comments: [{ databaseId: 1, body: 'x' }] } },
  };
  const [c] = threadResponseToComments(data, 'p.md', 5, 5);
  assert.equal(c.startLine, null);
});

test('threadResponseToComments — exposes per-comment dbId (used by edit/delete)', () => {
  const data = {
    thread: {
      id: 't11',
      commentsData: {
        comments: [
          { databaseId: 100, body: 'head' },
          { databaseId: 101, body: 'reply' },
        ],
      },
    },
  };
  const out = threadResponseToComments(data, 'p.md', 1);
  assert.equal(out[0].dbId, 100);
  assert.equal(out[1].dbId, 101);
});

test('threadResponseToComments — dbId falls back to snake_case database_id then id', () => {
  const data = {
    thread: {
      id: 't12',
      commentsData: {
        comments: [
          { database_id: 200, body: 'a' },
          { id: 201, body: 'b' },
          { body: 'no-id' },
        ],
      },
    },
  };
  const out = threadResponseToComments(data, 'p.md', 1);
  assert.equal(out[0].dbId, 200);
  assert.equal(out[1].dbId, 201);
  assert.equal(out[2].dbId, null);
});

// ── escapeHtml ────────────────────────────────────────────────────────────

test('escapeHtml — basic special chars', () => {
  assert.equal(escapeHtml('<div class="x">a & b</div>'),
    '&lt;div class=&quot;x&quot;&gt;a &amp; b&lt;/div&gt;');
});

test("escapeHtml — single quote escaped too", () => {
  assert.equal(escapeHtml("it's"), 'it&#39;s');
});

test('escapeHtml — null / undefined / non-strings are stringified safely', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

// ── formatTimeAgo ────────────────────────────────────────────────────────

test('formatTimeAgo — sub-minute returns "just now"', () => {
  const now = new Date('2026-05-01T12:00:30Z');
  assert.equal(formatTimeAgo('2026-05-01T12:00:00Z', now), 'just now');
});

test('formatTimeAgo — minutes', () => {
  const now = new Date('2026-05-01T12:30:00Z');
  assert.equal(formatTimeAgo('2026-05-01T12:00:00Z', now), '30m ago');
});

test('formatTimeAgo — hours', () => {
  const now = new Date('2026-05-01T17:00:00Z');
  assert.equal(formatTimeAgo('2026-05-01T12:00:00Z', now), '5h ago');
});

test('formatTimeAgo — days (< 30)', () => {
  const now = new Date('2026-05-06T12:00:00Z');
  assert.equal(formatTimeAgo('2026-05-01T12:00:00Z', now), '5d ago');
});

test('formatTimeAgo — invalid date returns empty string', () => {
  assert.equal(formatTimeAgo('not a date'), '');
  assert.equal(formatTimeAgo(null), '');
});

test('formatTimeAgo — future dates (clock skew) safely return "just now"', () => {
  // diffMs < 0 → diffMin < 0 → first branch (<1) catches it.
  const now = new Date('2026-05-01T12:00:00Z');
  assert.equal(formatTimeAgo('2026-05-01T13:00:00Z', now), 'just now');
});

// ── parseMarkersMap ──────────────────────────────────────────────────────

test('parseMarkersMap — single-line right-side entry', () => {
  const diffSummaries = [{
    path: 'a.md',
    markersMap: {
      'R92': { threads: [{ id: 2155368377 }], annotations: [], ctx: [89, 95] },
    },
  }];
  const map = parseMarkersMap(diffSummaries);
  assert.deepEqual(map.get('2155368377'), {
    path: 'a.md', line: 92, startLine: null, side: 'R',
  });
});

test('parseMarkersMap — left-side (deletion) entry', () => {
  const diffSummaries = [{
    path: 'a.md',
    markersMap: { 'L7': { threads: [{ id: 'tL7' }] } },
  }];
  const map = parseMarkersMap(diffSummaries);
  assert.deepEqual(map.get('tL7'), { path: 'a.md', line: 7, startLine: null, side: 'L' });
});

test('parseMarkersMap — multi-line range via threads[].start (bug fix)', () => {
  // Bug history: route-data thread objects don't carry range info; the start
  // line lives only on `markersMap.<endKey>.threads[].start` as a string like
  // "R57". Without parsing it we displayed range comments as single-line.
  const diffSummaries = [{
    path: 'docs/x.md',
    markersMap: {
      'R68': { threads: [{ id: 2168514608, start: 'R57' }], annotations: [], ctx: [54, 71] },
    },
  }];
  const map = parseMarkersMap(diffSummaries);
  assert.deepEqual(map.get('2168514608'), {
    path: 'docs/x.md', line: 68, startLine: 57, side: 'R',
  });
});

test('parseMarkersMap — ignores invalid `start` strings', () => {
  // Malformed `start` (not matching /^[RL]\d+$/) → startLine stays null.
  const diffSummaries = [{
    path: 'a.md',
    markersMap: { 'R10': { threads: [{ id: 't', start: 'whatever' }] } },
  }];
  assert.equal(parseMarkersMap(diffSummaries).get('t').startLine, null);
});

test('parseMarkersMap — multiple threads on the same end-line', () => {
  // Real shape from the captured data: R3 had two threads (two comments on the
  // same source line). Both should be extracted as single-line.
  const diffSummaries = [{
    path: 'a.md',
    markersMap: {
      'R3': { threads: [{ id: 't1' }, { id: 't2' }], annotations: [], ctx: [1, 6] },
    },
  }];
  const map = parseMarkersMap(diffSummaries);
  assert.equal(map.size, 2);
  assert.equal(map.get('t1').line, 3);
  assert.equal(map.get('t2').line, 3);
});

test('parseMarkersMap — falls back to generic id-walk for unexpected shapes', () => {
  // Future-proofing: if `threads` array is missing but there's an `id` field
  // somewhere in the value, we still find it.
  const diffSummaries = [{
    path: 'a.md',
    markersMap: { 'R5': { reviewThreads: [{ id: 'fallback-id' }] } },
  }];
  const map = parseMarkersMap(diffSummaries);
  assert.equal(map.get('fallback-id').line, 5);
});

test('parseMarkersMap — skips entries with non-R/L keys', () => {
  const diffSummaries = [{
    path: 'a.md',
    markersMap: {
      'R3': { threads: [{ id: 'real' }] },
      'meta': { something: 'else' },
      'R3foo': { threads: [{ id: 'bogus' }] },
    },
  }];
  const map = parseMarkersMap(diffSummaries);
  assert.equal(map.has('real'), true);
  assert.equal(map.has('bogus'), false);
});

test('parseMarkersMap — handles missing input gracefully', () => {
  assert.equal(parseMarkersMap(null).size, 0);
  assert.equal(parseMarkersMap(undefined).size, 0);
  assert.equal(parseMarkersMap([]).size, 0);
  assert.equal(parseMarkersMap([{ /* no markersMap */ }]).size, 0);
});

test('parseMarkersMap — first-write wins when a thread appears in multiple keys', () => {
  // Defensive: a thread should never appear under more than one markersMap
  // key, but if it does, we keep the first occurrence.
  const diffSummaries = [{
    path: 'a.md',
    markersMap: {
      'R10': { threads: [{ id: 'dup' }] },
      'R20': { threads: [{ id: 'dup' }] },
    },
  }];
  const map = parseMarkersMap(diffSummaries);
  // Object.entries iteration order on integer-like keys is sorted ascending,
  // so R10 comes first.
  assert.equal(map.get('dup').line, 10);
});

// ── buildAnchorKey / parseLineFromAnchor ────────────────────────────────
//
// These two helpers encode and decode the `<path>:<line>:<startLine>`
// string we stash on each rendered thread as `data-grdc-anchor`. The
// renderer uses them to (1) match same-line peers and (2) decide where to
// slot a new thread among other-line threads on the same anchor element
// (the bug where "line 91" was appearing after "line 94" because the
// walker just appended at the end — fixed in 1.0.2).

test('buildAnchorKey — happy path', () => {
  assert.equal(
    buildAnchorKey({ path: 'a/b.md', line: 42, startLine: null }),
    'a/b.md:42:'
  );
});

test('buildAnchorKey — range (startLine present)', () => {
  assert.equal(
    buildAnchorKey({ path: 'a/b.md', line: 50, startLine: 45 }),
    'a/b.md:50:45'
  );
});

test('buildAnchorKey — missing fields collapse to empty segments', () => {
  // Real inputs from renderExistingComments: path/line may be null on
  // threads whose markersMap entry didn't resolve. We still want a
  // syntactically valid 3-segment key so the parser doesn't choke.
  assert.equal(buildAnchorKey({}), '::');
  assert.equal(buildAnchorKey({ path: 'x.md' }), 'x.md::');
  assert.equal(buildAnchorKey({ line: 5 }), ':5:');
});

test('buildAnchorKey — preserves colons inside path (parser splits from right)', () => {
  // GitHub paths are POSIX so this is paranoid — but the parser is
  // documented to split from the right, so verify the round-trip.
  const key = buildAnchorKey({ path: 'weird:path.md', line: 7, startLine: null });
  assert.equal(key, 'weird:path.md:7:');
  assert.equal(parseLineFromAnchor(key), 7);
});

test('parseLineFromAnchor — happy path', () => {
  assert.equal(parseLineFromAnchor('a/b.md:42:'), 42);
  assert.equal(parseLineFromAnchor('a/b.md:50:45'), 50);
});

test('parseLineFromAnchor — round-trips with buildAnchorKey', () => {
  const cases = [
    { path: 'a.md', line: 1, startLine: null },
    { path: 'src/foo/bar.js', line: 999, startLine: 990 },
    { path: 'README.md', line: 1, startLine: 1 },
  ];
  for (const c of cases) {
    assert.equal(parseLineFromAnchor(buildAnchorKey(c)), c.line);
  }
});

test('parseLineFromAnchor — returns null on malformed / missing input', () => {
  assert.equal(parseLineFromAnchor(''), null);
  assert.equal(parseLineFromAnchor(null), null);
  assert.equal(parseLineFromAnchor(undefined), null);
  assert.equal(parseLineFromAnchor('no-colons-here'), null);
  // Non-numeric line segment.
  assert.equal(parseLineFromAnchor('a.md:abc:'), null);
});

test('parseLineFromAnchor — handles empty line segment (defensive)', () => {
  // If a buggy caller writes `path::startLine`, parseInt('') is NaN.
  assert.equal(parseLineFromAnchor('a.md::5'), null);
});
