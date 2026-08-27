'use strict';

/**
 * Fixture harness for the Azure DevOps Playwright suite.
 *
 * A real Chromium page is served at a syntactically valid ADO PR URL. The
 * fixture contains ADO Preview/file-tree shapes while this helper supplies a
 * stateful cookie-auth REST mock. Manifest scripts are injected in production
 * order, including the source-of-truth shared libraries and ADO adapter.
 */
const fs = require('fs');
const path = require('path');
const fixtureData = require('./fixtures/sources');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EXT_ROOT = path.join(REPO_ROOT, 'extensions', 'ado');
const FIXTURE_FILE = path.join(__dirname, 'fixtures', 'preview.html');
const FIXTURE_HTML = fs.readFileSync(FIXTURE_FILE, 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT_ROOT, 'manifest.json'), 'utf8'));
const CONTENT_SCRIPTS = MANIFEST.content_scripts[0].js;

const ORG = 'test-org';
const PROJECT_NAME = 'test-project';
const PROJECT_ID = 'project-guid';
const REPO_NAME = 'test-repo';
const REPO_ID = 'repo-guid';
const PR_ID = 42;
const TARGET_COMMIT = 'b'.repeat(40);
const FAKE_PR_PATH = `/${ORG}/${PROJECT_NAME}/_git/${REPO_NAME}/pullrequest/${PR_ID}`;
const FAKE_PR_URL = `https://dev.azure.com${FAKE_PR_PATH}?_a=files&path=${encodeURIComponent(fixtureData.DESIGN_PATH)}`;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveScriptPath(scriptPath) {
  const normalized = scriptPath.replace(/\\/g, '/');
  return normalized.startsWith('src/')
    ? path.join(REPO_ROOT, normalized)
    : path.join(EXT_ROOT, normalized);
}

function statusName(value) {
  if (value === 2 || value === 'fixed') return 'fixed';
  return 'active';
}

function nowIso() {
  return '2026-08-26T12:00:00.000Z';
}

async function readRequestBody(request) {
  const text = request.postData() || '';
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return text; }
}

function fulfillJson(route, data, status) {
  return route.fulfill({
    status: status || 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(data),
  });
}

function userThreadCount(threads) {
  return threads.filter((thread) => {
    if (!thread || thread.threadContext == null) return false;
    return thread.comments?.[0]?.commentType !== 'system';
  }).length;
}

/**
 * Install the fake ADO document and REST surface.
 *
 * The returned server state is intentionally mutable. Tests can add source
 * delays after initial setup to create deterministic SPA races, and can inspect
 * `requests` to assert exact HTTP payloads.
 */
async function installAdoRoutes(page, options) {
  const opts = options || {};
  const state = {
    requests: [],
    completedSources: [],
    pageLoads: 0,
    threads: clone(opts.threads || fixtureData.defaultThreads()),
    headSources: Object.assign({
      [fixtureData.DESIGN_PATH]: fixtureData.DESIGN_SOURCE,
      [fixtureData.OTHER_PATH]: fixtureData.OTHER_SOURCE,
    }, opts.headSources || {}),
    baseSources: Object.assign({
      [fixtureData.DESIGN_PATH]: fixtureData.DESIGN_BASE_SOURCE,
      [fixtureData.OTHER_PATH]: fixtureData.OTHER_SOURCE,
    }, opts.baseSources || {}),
    sourceDelays: Object.assign({}, opts.sourceDelays || {}),
    nextThreadId: 1000,
  };

  await page.route('https://dev.azure.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = await readRequestBody(request);
    state.requests.push({ method, url: url.toString(), pathname: url.pathname, search: url.search, body });

    if (method === 'GET' && url.pathname === FAKE_PR_PATH) {
      state.pageLoads++;
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: FIXTURE_HTML,
      });
    }

    if (method === 'GET' && url.pathname === `/${ORG}/_apis/git/repositories`) {
      return fulfillJson(route, {
        count: 1,
        value: [{
          id: REPO_ID,
          name: REPO_NAME,
          project: { id: PROJECT_ID, name: PROJECT_NAME },
        }],
      });
    }

    if (method === 'GET' && url.pathname === `/${ORG}/_apis/connectionData`) {
      return fulfillJson(route, { authenticatedUser: clone(fixtureData.CURRENT_USER) });
    }

    const prPath = `/${ORG}/_apis/git/repositories/${REPO_ID}/pullRequests/${PR_ID}`;
    if (method === 'GET' && url.pathname === prPath) {
      return fulfillJson(route, {
        pullRequestId: PR_ID,
        sourceRefName: 'refs/heads/feature/fixture',
        targetRefName: 'refs/heads/main',
        lastMergeTargetCommit: { commitId: TARGET_COMMIT },
      });
    }

    if (method === 'GET' && /\/_apis\/git\/repositories\/repo-guid\/items$/.test(url.pathname)) {
      const filePath = url.searchParams.get('path');
      const versionType = url.searchParams.get('versionDescriptor.versionType');
      const sourceSet = versionType === 'commit' ? state.baseSources : state.headSources;
      const delayKey = `${versionType || 'head'}:${filePath}`;
      const delay = Number(state.sourceDelays[delayKey] || state.sourceDelays[filePath] || 0);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      state.completedSources.push({ path: filePath, versionType: versionType || 'head' });
      if (!Object.prototype.hasOwnProperty.call(sourceSet, filePath)) {
        return route.fulfill({ status: 404, body: `No fixture source for ${filePath}` });
      }
      return fulfillJson(route, { content: sourceSet[filePath] });
    }

    const threadsPath = `${prPath}/threads`;
    if (url.pathname === threadsPath) {
      if (method === 'GET') {
        return fulfillJson(route, { count: state.threads.length, value: clone(state.threads) });
      }
      if (method === 'POST') {
        const id = state.nextThreadId++;
        const requestComment = body.comments[0];
        const created = {
          id,
          status: statusName(body.status),
          threadContext: clone(body.threadContext),
          comments: [{
            id: 1,
            parentCommentId: requestComment.parentCommentId || 0,
            commentType: requestComment.commentType || 1,
            content: requestComment.content,
            author: clone(fixtureData.CURRENT_USER),
            publishedDate: nowIso(),
            lastContentUpdatedDate: nowIso(),
            isDeleted: false,
          }],
        };
        state.threads.push(created);
        return fulfillJson(route, clone(created), 201);
      }
    }

    const commentMatch = url.pathname.match(new RegExp(`^${threadsPath}/(\\d+)/comments/(\\d+)$`));
    if (commentMatch) {
      const thread = state.threads.find((item) => String(item.id) === commentMatch[1]);
      const comment = thread?.comments?.find((item) => String(item.id) === commentMatch[2]);
      if (!thread || !comment) return route.fulfill({ status: 404, body: 'Comment not found' });
      if (method === 'PATCH') {
        comment.content = body.content;
        comment.lastContentUpdatedDate = nowIso();
        return fulfillJson(route, clone(comment));
      }
      if (method === 'DELETE') {
        comment.isDeleted = true;
        delete comment.content;
        comment.lastContentUpdatedDate = nowIso();
        return route.fulfill({ status: 200, body: '' });
      }
    }

    const commentsMatch = url.pathname.match(new RegExp(`^${threadsPath}/(\\d+)/comments$`));
    if (commentsMatch && method === 'POST') {
      const thread = state.threads.find((item) => String(item.id) === commentsMatch[1]);
      if (!thread) return route.fulfill({ status: 404, body: 'Thread not found' });
      const nextId = Math.max(0, ...thread.comments.map((item) => Number(item.id) || 0)) + 1;
      const created = {
        id: nextId,
        parentCommentId: body.parentCommentId || 1,
        commentType: body.commentType || 1,
        content: body.content,
        author: clone(fixtureData.CURRENT_USER),
        publishedDate: nowIso(),
        lastContentUpdatedDate: nowIso(),
        isDeleted: false,
      };
      thread.comments.push(created);
      return fulfillJson(route, clone(created), 201);
    }

    const threadMatch = url.pathname.match(new RegExp(`^${threadsPath}/(\\d+)$`));
    if (threadMatch && method === 'PATCH') {
      const thread = state.threads.find((item) => String(item.id) === threadMatch[1]);
      if (!thread) return route.fulfill({ status: 404, body: 'Thread not found' });
      thread.status = statusName(body.status);
      return fulfillJson(route, clone(thread));
    }

    return route.fulfill({
      status: 404,
      contentType: 'text/plain; charset=utf-8',
      body: `No ADO fixture route for ${method} ${url.pathname}${url.search}`,
    });
  });

  return state;
}

async function injectAdoExtension(page) {
  for (const scriptPath of CONTENT_SCRIPTS) {
    await page.addScriptTag({ path: resolveScriptPath(scriptPath) });
  }
}

async function waitForAdoReady(page, expectedPath, expectedThreadCount) {
  await page.waitForSelector('.markdown-preview-container [data-adrc-has-button]', { timeout: 8000 });
  await page.waitForFunction(
    ({ path, threadCount }) => {
      if (!window.ADORC_probe) return false;
      const state = window.ADORC_probe.sidebar();
      return state.currentFile === path &&
        state.changesStatus !== 'loading' &&
        state.threadCount === threadCount;
    },
    { path: expectedPath, threadCount: expectedThreadCount },
    { timeout: 8000 }
  );
}

async function setupAdoExtensionPage(page, options) {
  const opts = options || {};
  const server = await installAdoRoutes(page, opts);
  const logs = [];
  const pageErrors = [];
  page.on('console', (message) => logs.push(message.text()));
  page.on('pageerror', (error) => pageErrors.push(String(error.message || error)));

  await page.goto(FAKE_PR_URL, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ path: path.join(EXT_ROOT, 'styles.css') });
  await page.evaluate(() => {
    localStorage.setItem('adrc-sidebar-state-v1', JSON.stringify({
      visible: true,
      collapsed: false,
      tab: 'changes',
      unresolvedOnly: false,
      left: 820,
      top: 8,
      width: 420,
      height: 620,
    }));
  });
  await injectAdoExtension(page);

  if (opts.waitForReady !== false) {
    await waitForAdoReady(
      page,
      opts.initialPath || fixtureData.DESIGN_PATH,
      userThreadCount(server.threads)
    );
  }

  return { server, logs, pageErrors };
}

function matchingRequests(server, method, pathnameSuffix) {
  return server.requests.filter((request) =>
    request.method === method && request.pathname.endsWith(pathnameSuffix)
  );
}

module.exports = {
  REPO_ROOT,
  EXT_ROOT,
  CONTENT_SCRIPTS,
  FAKE_PR_URL,
  FAKE_PR_PATH,
  TARGET_COMMIT,
  setupAdoExtensionPage,
  waitForAdoReady,
  matchingRequests,
  userThreadCount,
};
