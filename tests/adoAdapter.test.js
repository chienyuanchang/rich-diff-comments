/**
 * Unit tests for the Azure DevOps adapter's pure helpers.
 *
 * Only the pure / DOM-free / fetch-free parts are covered here:
 *   parsePRUrl, normalizeFilePath, isSystemThread, and the URL builders.
 * The HTTP wrappers (listThreads, createThread, reply, ...) are validated
 * by manual DevTools probes captured in local-only/ado-samples/ — a full
 * mock-fetch harness will land alongside the button-attachment work.
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

// ─── API_VERSION constant ──────────────────────────────────────────────

test('API_VERSION is set (currently 7.1) — bump only after re-verifying probes', () => {
  assert.equal(typeof ado.API_VERSION, 'string');
  assert.match(ado.API_VERSION, /^\d+\.\d+$/);
});
