'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CONTENT_PATH = path.join(ROOT, 'extensions', 'ado', 'content.js');
const CSS_PATH = path.join(ROOT, 'extensions', 'ado', 'styles.css');
const MANIFEST_PATH = path.join(ROOT, 'extensions', 'ado', 'manifest.json');
const content = fs.readFileSync(CONTENT_PATH, 'utf8');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : '';
}

test('ADO manifest loads shared sidebar helpers before content.js', () => {
  const scripts = manifest.content_scripts[0].js;
  const helperIndex = scripts.indexOf('src/lib/sidebar.js');
  const contentIndex = scripts.indexOf('content.js');
  assert.ok(helperIndex >= 0, 'Expected src/lib/sidebar.js in ADO manifest');
  assert.ok(contentIndex >= 0, 'Expected content.js in ADO manifest');
  assert.ok(helperIndex < contentIndex, 'Sidebar helpers must load before content.js');
});

test('ADO sidebar renders Threads and Outline tabs with separate scoped panes', () => {
  assert.match(content, /data-tab="threads"[^>]*role="tab"/);
  assert.match(content, /data-tab="outline"[^>]*role="tab"/);
  assert.match(content, /data-pane="threads"[^>]*role="tabpanel"/);
  assert.match(content, /data-pane="outline"[^>]*role="tabpanel"/);
  assert.match(content, /class="adrc-sidebar-thread-list"/);
  assert.match(content, /class="adrc-outline-body"/);
});

test('ADO sidebar replaced the standalone Outline panel builder', () => {
  assert.doesNotMatch(
    content,
    /panel\.className\s*=\s*['"]adrc-outline-panel/,
    'Standalone Outline panel should not be constructed after sidebar integration'
  );
  assert.match(content, /function buildSidebarPanel\(\)/);
  assert.match(content, /outlinePanel = panel/);
});

test('ADO collapsed sidebar hides only the body and keeps header controls reachable', () => {
  const collapsed = ruleBody('.adrc-sidebar-collapsed');
  const collapsedBody = ruleBody('.adrc-sidebar-collapsed .adrc-sidebar-body');
  assert.match(collapsed, /height\s*:\s*42px\s*!important/);
  assert.match(collapsedBody, /display\s*:\s*none/);
  assert.doesNotMatch(css, /\.adrc-sidebar-collapsed\s+\.adrc-sidebar-header\s*\{[^}]*display\s*:\s*none/);
  assert.doesNotMatch(css, /\.adrc-sidebar-collapsed\s+\.adrc-sidebar-tabs\s*\{[^}]*display\s*:\s*none/);
});

test('ADO sidebar is draggable, resizable, and persists state', () => {
  assert.match(ruleBody('.adrc-sidebar'), /resize\s*:\s*both/);
  assert.match(content, /function wireSidebarDrag\(panel\)/);
  assert.match(content, /new ResizeObserver/);
  assert.match(content, /localStorage\.setItem\(SIDEBAR_STORAGE_KEY/);
  assert.match(content, /clampDragPos/);
  assert.match(content, /clampSize/);
});

test('ADO Threads pane supports persisted unresolved filtering', () => {
  assert.match(content, /unresolvedOnly/);
  assert.match(content, /filterSidebarThreadItems/);
  assert.match(content, /adrc-sidebar-filter-active/);
  assert.match(content, /aria-pressed/);
});

test('ADO cross-file thread navigation stores and resumes a pending jump', () => {
  assert.match(content, /SIDEBAR_PENDING_THREAD_KEY/);
  assert.match(content, /sessionStorage\.setItem\(SIDEBAR_PENDING_THREAD_KEY/);
  assert.match(content, /function resumePendingThreadJump\(attempt\)/);
});

test('ADO cross-file thread navigation explicitly restores Markdown Preview', () => {
  assert.match(content, /requirePreview:\s*true/);
  assert.match(content, /function ensureAdoPreviewMode\(\)/);
  assert.match(content, /function findVisiblePreviewMenuOption\(\)/);
  assert.match(content, /function findAdoViewModeControls\(\)/);
  assert.match(content, /function getAdoControlLabels\(el\)/);
  assert.match(content, /\.bolt-menuitem-cell-text/);
  assert.match(content, /function continuePendingThreadNavigation\(\)/);
  assert.match(content, /\.bolt-split-button-option/);
  assert.match(content, /controls\.trigger\.click\(\)/);
  assert.match(content, /modeLabel\.startsWith\('preview'\)/);
  assert.doesNotMatch(content, /buttons\.find\(\(button\) => button !== modeButton && isVisibleControl\(button\)\)/);
  assert.doesNotMatch(content, /modeButton\.click\(\)/);
});

test('ADO Preview restoration is one-shot and exposes view-mode diagnostics', () => {
  assert.match(content, /if \(previewRestoreState\.phase === 'opening'\) \{\s*return false/);
  assert.match(content, /if \(previewRestoreState\.phase !== 'selecting'\)/);
  assert.match(content, /viewMode\(\)/);
  assert.match(content, /visibleMenuOptions/);
});

test('ADO cross-file thread navigation activates a scored native tree row without URL fallback', () => {
  assert.match(content, /function findBestAdoFileTreeTarget\(path\)/);
  assert.match(content, /\[role="treeitem"\]/);
  assert.match(content, /\.bolt-tree-row/);
  assert.match(content, /\.bolt-tree-cell \.bolt-table-cell-content/);
  assert.match(content, /fileTarget\.target\.click\(\)/);
  assert.match(content, /repos-changes-viewer/);
  assert.doesNotMatch(content, /const fileLink = links\.find/);
  assert.doesNotMatch(content, /window\.location\.assign/);
  assert.doesNotMatch(content, /fileTarget\.link\.click/);
});

test('ADO `b` shortcut opens the integrated Outline tab without hijacking editors', () => {
  assert.match(content, /function showOutlinePanel\(\)\s*\{\s*showSidebar\('outline'\)/);
  assert.match(content, /tag === 'INPUT' \|\| tag === 'TEXTAREA' \|\| tag === 'SELECT'/);
});
