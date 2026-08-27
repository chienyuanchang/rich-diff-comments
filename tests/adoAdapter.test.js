/**
 * Unit tests for the Azure DevOps adapter's pure helpers.
 *
 * Pure URL/normalization behavior is covered directly. The iteration inventory
 * wrapper also uses a small mock fetch to pin latest-iteration selection and
 * pagination. Thread mutations are exercised by the stateful ADO Playwright
 * fixture and live DevTools probes captured in local-only/ado-samples/.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const ado = require('../src/adapters/ado.js');

// ─── parsePRUrl ────────────────────────────────────────────────────────

test('parsePRUrl - happy path: dev.azure.com PR', () => {
  const ctx = ado.parsePRUrl('/chienyuanchang/test-ado-md-comments/_git/test-ado-md-comments/pullrequest/1');
  assert.deepEqual(ctx, {
    org: 'chienyuanchang',
    projectName: 'test-ado-md-comments',
    repoName: 'test-ado-md-comments',
    prId: 1
  });
});

test('parsePRUrl - tolerates trailing query string / hash / path segments', () => {
  const ctx = ado.parsePRUrl('/myorg/proj/_git/repo/pullrequest/42?_a=files&path=/README.md');
  assert.equal(ctx.org, 'myorg');
  assert.equal(ctx.projectName, 'proj');
  assert.equal(ctx.repoName, 'repo');
  assert.equal(ctx.prId, 42);
});

test('parsePRUrl - returns null on non-PR paths', () => {
  assert.equal(ado.parsePRUrl('/'), null);
  assert.equal(ado.parsePRUrl('/myorg/proj'), null);
  assert.equal(ado.parsePRUrl('/myorg/proj/_git/repo'), null);
  assert.equal(ado.parsePRUrl('/myorg/proj/_git/repo/branches'), null);
  assert.equal(ado.parsePRUrl(''), null);
  assert.equal(ado.parsePRUrl(null), null);
  assert.equal(ado.parsePRUrl(undefined), null);
});

test('parsePRUrl - parses prId as an integer, not a string', () => {
  const ctx = ado.parsePRUrl('/o/p/_git/r/pullrequest/12345');
  assert.equal(typeof ctx.prId, 'number');
  assert.equal(ctx.prId, 12345);
});

// ─── normalizeFilePath ─────────────────────────────────────────────────

test('normalizeFilePath - adds leading slash when missing', () => {
  assert.equal(ado.normalizeFilePath('README.md'), '/README.md');
  assert.equal(ado.normalizeFilePath('docs/design.md'), '/docs/design.md');
});

test('normalizeFilePath - preserves existing leading slash', () => {
  assert.equal(ado.normalizeFilePath('/README.md'), '/README.md');
  assert.equal(ado.normalizeFilePath('/docs/design.md'), '/docs/design.md');
});

test('normalizeFilePath - returns empty string for falsy input', () => {
  assert.equal(ado.normalizeFilePath(''), '');
  assert.equal(ado.normalizeFilePath(null), '');
  assert.equal(ado.normalizeFilePath(undefined), '');
});

// ─── isSystemThread ────────────────────────────────────────────────────

test('isSystemThread - detects RefUpdate lifecycle thread (threadContext null)', () => {
  const t = {
    id: 1,
    threadContext: null,
    comments: [{ id: 1, commentType: 'system', content: 'The reference refs/heads/main was updated.' }],
    properties: { CodeReviewThreadType: { $type: 'System.String', $value: 'RefUpdate' } }
  };
  assert.equal(ado.isSystemThread(t), true);
});

test('isSystemThread - detects thread whose first comment is commentType:system', () => {
  const t = {
    id: 2,
    threadContext: { filePath: '/x.md' }, // (unusual, but exercised for completeness)
    comments: [{ id: 1, commentType: 'system', content: 'anything' }]
  };
  assert.equal(ado.isSystemThread(t), true);
});

test('isSystemThread - returns false for a real user thread anchored to a file', () => {
  const t = {
    id: 3,
    threadContext: { filePath: '/README.md', rightFileStart: { line: 1, offset: 1 } },
    comments: [{ id: 1, commentType: 'text', content: 'nice heading' }],
    status: 'active'
  };
  assert.equal(ado.isSystemThread(t), false);
});

test('isSystemThread - returns false for null / undefined / empty', () => {
  assert.equal(ado.isSystemThread(null), false);
  assert.equal(ado.isSystemThread(undefined), false);
  assert.equal(ado.isSystemThread({}), true); // no threadContext → system-like
});

// ─── URL builders ──────────────────────────────────────────────────────

const CTX = { org: 'myorg', repoId: 'REPO-GUID', prId: 42 };
const CTX_WITH_PROJECT = { org: 'myorg', projectId: 'PROJ-GUID', repoId: 'REPO-GUID', prId: 42 };

test('threadsUrl - builds the collection endpoint with the api-version query', () => {
  assert.equal(
    ado.threadsUrl(CTX),
    `/myorg/_apis/git/repositories/REPO-GUID/pullRequests/42/threads?api-version=${ado.API_VERSION}`
  );
});

test('threadUrl - builds a single-thread endpoint', () => {
  assert.equal(
    ado.threadUrl(CTX, 7),
    `/myorg/_apis/git/repositories/REPO-GUID/pullRequests/42/threads/7?api-version=${ado.API_VERSION}`
  );
});

test('commentsUrl - builds the comments-collection endpoint for a thread', () => {
  assert.equal(
    ado.commentsUrl(CTX, 7),
    `/myorg/_apis/git/repositories/REPO-GUID/pullRequests/42/threads/7/comments?api-version=${ado.API_VERSION}`
  );
});

test('commentUrl - builds a single-comment endpoint', () => {
  assert.equal(
    ado.commentUrl(CTX, 7, 3),
    `/myorg/_apis/git/repositories/REPO-GUID/pullRequests/42/threads/7/comments/3?api-version=${ado.API_VERSION}`
  );
});

test('pullRequestUrl - builds the single-PR metadata endpoint', () => {
  assert.equal(
    ado.pullRequestUrl(CTX),
    `/myorg/_apis/git/repositories/REPO-GUID/pullRequests/42?api-version=${ado.API_VERSION}`
  );
});

test('iterationsUrl - uses the project-scoped latest-iteration collection', () => {
  assert.equal(
    ado.iterationsUrl(CTX_WITH_PROJECT),
    `/myorg/PROJ-GUID/_apis/git/repositories/REPO-GUID/pullRequests/42/iterations?api-version=${ado.API_VERSION}`
  );
});

test('iterationChangesUrl - requests cumulative changes with explicit paging', () => {
  const url = new URL('https://dev.azure.com' + ado.iterationChangesUrl(
    CTX_WITH_PROJECT,
    7,
    { compareTo: 0, top: 250, skip: 500 }
  ));
  assert.equal(
    url.pathname,
    '/myorg/PROJ-GUID/_apis/git/repositories/REPO-GUID/pullRequests/42/iterations/7/changes'
  );
  assert.equal(url.searchParams.get('$compareTo'), '0');
  assert.equal(url.searchParams.get('$top'), '250');
  assert.equal(url.searchParams.get('$skip'), '500');
  assert.equal(url.searchParams.get('api-version'), ado.API_VERSION);
});

test('connectionDataUrl - builds the org-scoped connection-data endpoint', () => {
  const url = ado.connectionDataUrl(CTX);
  assert.match(url, /^\/myorg\/_apis\/connectionData\?/);
  assert.match(url, /connectOptions=IncludeServices/);
  // connectionData is a preview-only resource — plain `7.1` returns
  // HTTP 400, so the URL must pin `7.1-preview.1`.
  assert.match(url, /api-version=7\.1-preview\.1/);
});

test('itemUrl - builds the file-content endpoint with project scope + branch version', () => {
  const url = ado.itemUrl(CTX_WITH_PROJECT, '/README.md', { version: 'test_pr', versionType: 'branch' });
  assert.match(url, /^\/myorg\/PROJ-GUID\/_apis\/git\/repositories\/REPO-GUID\/items\?/);
  assert.match(url, /path=%2FREADME.md/);
  assert.match(url, /includeContent=true/);
  assert.match(url, /versionDescriptor.version=test_pr/);
  assert.match(url, /versionDescriptor.versionType=branch/);
  assert.match(url, /api-version=/);
});

test('itemUrl - omits versionDescriptor when no version is passed (default branch)', () => {
  const url = ado.itemUrl(CTX_WITH_PROJECT, '/README.md', {});
  assert.doesNotMatch(url, /versionDescriptor/);
});

test('itemUrl - falls back to project-less URL when projectId missing (edge case)', () => {
  const url = ado.itemUrl({ org: 'myorg', repoId: 'REPO-GUID' }, '/foo.md', {});
  assert.match(url, /^\/myorg\/_apis\/git\/repositories\/REPO-GUID\/items\?/);
});

test('itemUrl - normalizes filePath so callers can pass with or without leading slash', () => {
  const withSlash = ado.itemUrl(CTX_WITH_PROJECT, '/README.md', {});
  const noSlash = ado.itemUrl(CTX_WITH_PROJECT, 'README.md', {});
  assert.equal(withSlash, noSlash);
});

// ─── pull-request change normalization ─────────────────────────────────

test('normalizePullRequestChange - normalizes add/edit/delete entries', () => {
  assert.deepEqual(
    ado.normalizePullRequestChange({ changeId: 1, changeTrackingId: 11, changeType: 'add', item: { path: 'new.md' } }),
    { changeId: 1, changeTrackingId: 11, type: 'add', path: '/new.md', oldPath: '/new.md', rawChangeType: 'add' }
  );
  assert.equal(ado.normalizePullRequestChange({ changeType: 'edit', item: { path: '/edit.md' } }).type, 'edit');
  assert.equal(ado.normalizePullRequestChange({ changeType: 'delete', item: { path: '/gone.md' } }).type, 'delete');
});

test('normalizePullRequestChange - rename wins combined flags and preserves originalPath', () => {
  const change = ado.normalizePullRequestChange({
    changeId: 9,
    changeTrackingId: 19,
    changeType: 'rename, edit',
    originalPath: '/docs/old.md',
    item: { path: '/docs/new.md' }
  });
  assert.equal(change.type, 'rename');
  assert.equal(change.path, '/docs/new.md');
  assert.equal(change.oldPath, '/docs/old.md');
});

test('normalizePullRequestChange - falls back through item.originalPath and sourceServerItem', () => {
  assert.equal(ado.normalizePullRequestChange({
    changeType: 'sourceRename',
    item: { path: '/new.md', originalPath: '/item-old.md' }
  }).oldPath, '/item-old.md');
  assert.equal(ado.normalizePullRequestChange({
    changeType: 'targetRename',
    sourceServerItem: 'source-old.md',
    item: { path: '/new.md' }
  }).oldPath, '/source-old.md');
});

test('normalizePullRequestChange - rejects malformed entries without a path', () => {
  assert.equal(ado.normalizePullRequestChange(null), null);
  assert.equal(ado.normalizePullRequestChange({ changeType: 'edit', item: {} }), null);
});

test('listPullRequestChanges - selects latest iteration and follows nextSkip/nextTop pages', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (/\/iterations\?/.test(url)) {
      return response({ value: [{ id: 1 }, { id: 4 }, { id: 2 }] });
    }
    const parsed = new URL('https://dev.azure.com' + url);
    const skip = parsed.searchParams.get('$skip');
    if (skip === '0') {
      return response({
        changeEntries: [{ changeId: 1, item: { path: '/one.md' }, changeType: 'edit' }],
        nextSkip: 1,
        nextTop: 1
      });
    }
    return response({
      changeEntries: [{ changeId: 2, item: { path: '/two.md' }, changeType: 'add' }],
      nextSkip: 0,
      nextTop: 0
    });
  };

  const result = await ado.listPullRequestChanges(CTX_WITH_PROJECT, fetchImpl);
  assert.equal(result.iteration.id, 4);
  assert.deepEqual(result.changeEntries.map((entry) => entry.changeId), [1, 2]);
  assert.equal(calls.length, 3);
  assert.match(calls[1], /\/iterations\/4\/changes\?/);
  assert.equal(new URL('https://dev.azure.com' + calls[2]).searchParams.get('$skip'), '1');
});

function response(data, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() { return data == null ? '' : JSON.stringify(data); }
  };
}

// ─── API_VERSION constant ──────────────────────────────────────────────

test('API_VERSION is set (currently 7.1) — bump only after re-verifying probes', () => {
  assert.equal(typeof ado.API_VERSION, 'string');
  assert.match(ado.API_VERSION, /^\d+\.\d+$/);
});
