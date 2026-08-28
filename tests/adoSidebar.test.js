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

test('ADO manifest loads shared sidebar and Changes helpers before content.js', () => {
  const scripts = manifest.content_scripts[0].js;
  const sidebarIndex = scripts.indexOf('src/lib/sidebar.js');
  const outlineIndex = scripts.indexOf('src/lib/outline.js');
  const changesIndex = scripts.indexOf('src/lib/changes.js');
  const contentIndex = scripts.indexOf('content.js');
  assert.ok(sidebarIndex >= 0, 'Expected src/lib/sidebar.js in ADO manifest');
  assert.ok(outlineIndex >= 0, 'Expected src/lib/outline.js in ADO manifest');
  assert.ok(changesIndex >= 0, 'Expected src/lib/changes.js in ADO manifest');
  assert.ok(contentIndex >= 0, 'Expected content.js in ADO manifest');
  assert.ok(sidebarIndex < contentIndex, 'Sidebar helpers must load before content.js');
  assert.ok(outlineIndex < contentIndex, 'Outline helpers must load before content.js');
  assert.ok(changesIndex < contentIndex, 'Changes helpers must load before content.js');
});

test('ADO sidebar renders Changes, Threads, Outline tabs in GitHub parity order', () => {
  const re = /data-tab="(changes|threads|outline)"[^>]*role="tab"/g;
  assert.deepEqual(Array.from(content.matchAll(re), (match) => match[1]), [
    'changes', 'threads', 'outline'
  ]);
  assert.match(content, /data-pane="changes"[^>]*role="tabpanel"/);
  assert.match(content, /data-tab="threads"[^>]*role="tab"/);
  assert.match(content, /data-tab="outline"[^>]*role="tab"/);
  assert.match(content, /data-pane="threads"[^>]*role="tabpanel"/);
  assert.match(content, /data-pane="outline"[^>]*role="tabpanel"/);
  assert.match(content, /class="adrc-sidebar-change-list"/);
  assert.match(content, /class="adrc-sidebar-thread-list"/);
  assert.match(content, /class="adrc-outline-body"/);
});

test('ADO Changes loads the latest PR inventory and compares target/head sources with bounded concurrency', () => {
  assert.match(content, /adapter\.resolveIds\(ctx\)\.then\(\(\) => adapter\.getPullRequest\(ctx\)\)/);
  assert.match(content, /lastMergeTargetCommit/);
  assert.match(content, /versionType:\s*'commit'/);
  assert.match(content, /function getBaseFileSource\(filePath\)/);
  assert.match(content, /adapter\.listPullRequestChanges\(ctx\)/);
  assert.match(content, /adapter\.normalizePullRequestChange\(entry\)/);
  assert.match(content, /mapWithConcurrency\([\s\S]*?prMarkdownChanges,[\s\S]*?4,/);
  assert.match(content, /GRDC\.buildPrChangeStops\(change, baseSource, headSource/);
  assert.match(content, /changeHeadSourcePromises/);
  assert.match(content, /changeBaseSourcePromises/);
  assert.match(content, /inventory\.iteration\?\.sourceRefCommit\?\.commitId/);
  assert.match(content, /inventory\.iteration\?\.commonRefCommit\?\.commitId/);
  assert.match(content, /versionType:\s*'commit'/);
});

test('ADO Changes keeps DOM-free PR cards across SPA Preview resets', () => {
  assert.match(content, /Stable, DOM-free PR-wide cards/);
  assert.match(content, /requestVersion !== changesGeneration/);
  const resetStart = content.indexOf('function resetPreviewContext(');
  const resetEnd = content.indexOf('// ── Init flow', resetStart);
  const resetBody = content.slice(resetStart, resetEnd);
  assert.doesNotMatch(resetBody, /sidebarChangeStops\s*=\s*\[\]/);
  assert.doesNotMatch(resetBody, /sidebarChangesStatus\s*=\s*'idle'/);
  assert.match(resetBody, /currentLineToBlock\s*=\s*new Map\(\)/);
});

test('ADO Changes and Threads share stable native file order without current-file promotion', () => {
  assert.match(content, /function getStableAdoFileOrder\(paths\)/);
  assert.match(content, /ranked\.every\(\(entry\) => entry\.target\)/);
  assert.match(content, /a\.target\.index - b\.target\.index/);
  assert.match(content, /prMarkdownFileOrder = getStableAdoFileOrder/);
  assert.match(content, /GRDC\.sortSidebarThreadItems\(filtered, null, fileOrder\)/);
  assert.doesNotMatch(content, /GRDC\.sortSidebarThreadItems\(filtered, currentFilePath/);
});

test('ADO Changes cards support kind styling, click navigation, active tracking, and pulse', () => {
  assert.match(content, /adrc-sidebar-change-\$\{stop\.kind\}/);
  assert.match(content, /navigateToSidebarChange\(index\)/);
  assert.match(content, /function updateActiveSidebarChange\(\)/);
  assert.match(content, /adrc-change-target-pulse/);
  assert.match(css, /\.adrc-sidebar-change-added/);
  assert.match(css, /\.adrc-sidebar-change-removed/);
  assert.match(css, /\.adrc-sidebar-change-mixed/);
  assert.match(css, /\.adrc-sidebar-change-renamed/);
  assert.match(css, /\.adrc-sidebar-change-unavailable/);
  assert.match(content, /dataset\.lifecycle/);
  assert.match(content, /NEW FILE|stop\.label/);
});

test('ADO Changes navigation reveals folded sections and re-resolves its current block', () => {
  assert.match(content, /function revealChangedBlock\(block\)/);
  assert.match(content, /adrc-section-collapsed/);
  assert.match(content, /applyCollapseVisuals\(heading, toggle, false\)/);
  assert.match(content, /function resolveCurrentChangeBlock\(stop\)/);
  assert.match(content, /currentLineToBlock\.get\(stop\.line\)/);
  assert.match(content, /const block = resolveCurrentChangeBlock\(stop\)/);
});

test('ADO navigation crosses nested scroll containers with verified scrollIntoView fallback', () => {
  assert.match(content, /el\.scrollIntoView\(\{ behavior, block: 'start', inline: 'nearest' \}\)/);
  assert.match(content, /el\.style\.scrollMarginTop = OUTLINE_STICKY_OFFSET \+ 'px'/);
  assert.match(content, /if \(!moved && Math\.abs\(interimRect\.top - OUTLINE_STICKY_OFFSET\) > 8\)/);
  assert.match(content, /invoke\('auto'\)/);
  assert.match(content, /lastScrollNavigation/);
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

test('ADO collapsed sidebar hides body/tabs but keeps both header nav clusters reachable', () => {
  const collapsed = ruleBody('.adrc-sidebar-collapsed');
  const collapsedBody = ruleBody('.adrc-sidebar-collapsed .adrc-sidebar-body');
  const collapsedTabs = ruleBody('.adrc-sidebar-collapsed .adrc-sidebar-tabs');
  assert.match(collapsed, /height\s*:\s*42px\s*!important/);
  assert.match(collapsedBody, /display\s*:\s*none/);
  assert.match(collapsedTabs, /display\s*:\s*none/);
  assert.doesNotMatch(css, /\.adrc-sidebar-collapsed\s+\.adrc-sidebar-header\s*\{[^}]*display\s*:\s*none/);
  assert.doesNotMatch(css, /\.adrc-sidebar-collapsed\s+\.adrc-sidebar-changes-nav\s*\{[^}]*display\s*:\s*none/);
  assert.doesNotMatch(css, /\.adrc-sidebar-collapsed\s+\.adrc-sidebar-thread-nav\s*\{[^}]*display\s*:\s*none/);
});

test('ADO header exposes scoped Changes and Threads nav controls with live counters', () => {
  assert.match(content, /class="adrc-sidebar-nav-cluster adrc-sidebar-changes-nav"/);
  assert.match(content, /class="adrc-sidebar-nav-cluster adrc-sidebar-thread-nav"/);
  assert.match(content, /class="[^"]*adrc-sidebar-prev-change[^"]*"/);
  assert.match(content, /class="[^"]*adrc-sidebar-next-change[^"]*"/);
  assert.match(content, /class="[^"]*adrc-sidebar-prev-thread[^"]*"/);
  assert.match(content, /class="[^"]*adrc-sidebar-next-thread[^"]*"/);
  assert.ok((content.match(/aria-live="polite"/g) || []).length >= 2);
  assert.match(content, /function updateSidebarNavigation\(\)/);
});

test('ADO keyboard maps 1/2/3 to Changes/Threads/Outline and b to Outline', () => {
  assert.match(content, /const tab = e\.key === '1' \? 'changes' : e\.key === '2' \? 'threads' : 'outline'/);
  assert.match(content, /if \(e\.key === 'b' && !e\.shiftKey\)[\s\S]*?showOutlinePanel\(\)/);
});

test('ADO keyboard wires thread and change step plus boundary navigation', () => {
  assert.match(content, /e\.key === 'j'[\s\S]*?jumpSidebarThread\(1\)/);
  assert.match(content, /e\.key === 'k'[\s\S]*?jumpSidebarThread\(-1\)/);
  assert.match(content, /e\.key === 'h'[\s\S]*?jumpSidebarThreadBoundary\(false\)/);
  assert.match(content, /e\.key === 'l'[\s\S]*?jumpSidebarThreadBoundary\(true\)/);
  assert.match(content, /e\.key === '\]'[\s\S]*?jumpSidebarChange\(1\)/);
  assert.match(content, /e\.key === '\['[\s\S]*?jumpSidebarChange\(-1\)/);
  assert.match(content, /jumpSidebarChangeBoundary\(true\)/);
  assert.match(content, /jumpSidebarChangeBoundary\(false\)/);
  assert.match(content, /nextWrappingIndex/);
  assert.match(content, /nextChangeIndex/);
  assert.match(content, /navigateToSidebarThread\(items\[next\], \{ preserveSidebar: true \}\)/);
  assert.match(content, /navigateToSidebarThread\(items\[index\], \{ preserveSidebar: true \}\)/);
});

test('ADO keyboard t toggles and Shift+T resets while preserving tab/filter', () => {
  assert.match(content, /e\.key\.toLowerCase\(\) === 't' && e\.shiftKey/);
  assert.match(content, /resetSidebarLayout\(\)/);
  assert.match(content, /e\.key === 't' && !e\.shiftKey/);
  assert.match(content, /toggleSidebarCollapsed\(\)/);
  assert.match(content, /const tab = sidebarState\.tab/);
  assert.match(content, /const unresolvedOnly = sidebarState\.unresolvedOnly/);
  assert.match(content, /collapse\.setAttribute\('aria-label', sidebarState\.collapsed \? 'Expand sidebar' : 'Collapse sidebar'\)/);
});

test('ADO keyboard guards typing/modifiers and only prevents available list navigation', () => {
  assert.match(content, /isShortcutTypingTarget\(e\.target\)/);
  assert.match(content, /e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/);
  assert.match(content, /if \(handled\) e\.preventDefault\(\)/);
  assert.match(content, /document\.addEventListener\('keydown',[\s\S]*?\}, true\)/);
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

test('ADO cross-file change navigation stores a stable key and resumes against the live Preview map', () => {
  assert.match(content, /SIDEBAR_PENDING_CHANGE_KEY/);
  assert.match(content, /sessionStorage\.setItem\(SIDEBAR_PENDING_CHANGE_KEY/);
  assert.match(content, /key:\s*stop\.key/);
  assert.match(content, /function continuePendingChangeNavigation\(\)/);
  assert.match(content, /function resumePendingChangeJump\(attempt\)/);
  assert.match(content, /sidebarChangeStops\.findIndex\(\(stop\) => stop\.key === pending\.key\)/);
  assert.match(content, /function scrollToCurrentChange\(index\)/);
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
  assert.match(content, /label\.addEventListener\('click', \(\) => navigateToOutlineTarget/);
  assert.match(content, /function scrollToLiveOutlineHeading\(heading\)[\s\S]*?revealChangedBlock\(heading\.el\)[\s\S]*?scrollToWithStickyOffset\(heading\.el\)/);
});

test('ADO Outline builds a DOM-free PR-wide catalog from cached Markdown sources', () => {
  assert.match(content, /let prOutlineCatalog = new Map\(\)/);
  assert.match(content, /function ensurePrOutlineCatalog\(\)/);
  assert.match(content, /GRDC\.extractMarkdownHeadings\(source, path\)/);
  assert.match(content, /snapshotOutlineHeading/);
  assert.match(content, /getPrOutlineFileOrder\(\)/);
  assert.match(content, /prOutlineCatalog\.set\(path/);
});

test('ADO Outline renders stable file groups, heading thread counts, and lifecycle states', () => {
  assert.match(content, /className = 'adrc-outline-file'/);
  assert.match(content, /attributeThreadsToHeadings\(allHeadings, sidebarThreadItems\)/);
  assert.match(content, /className = 'adrc-outline-thread-count'/);
  assert.match(content, /Deleted file — no Preview outline/);
  assert.match(content, /NO HEADINGS/);
  assert.match(css, /\.adrc-outline-file-current/);
  assert.match(css, /\.adrc-outline-thread-count/);
});

test('ADO Outline cross-file rows preserve Preview and resume by stable heading key', () => {
  assert.match(content, /SIDEBAR_PENDING_OUTLINE_KEY/);
  assert.match(content, /function navigateToOutlineTarget\(target\)/);
  assert.match(content, /savePendingOutlineJump\(target\)/);
  assert.match(content, /function continuePendingOutlineNavigation\(\)/);
  assert.match(content, /function resumePendingOutlineJump\(attempt\)/);
  assert.match(content, /outlineHeadings\.find\(\(heading\) => heading\.key === pending\.key\)/);
});

test('ADO Outline has per-row and bulk fold controls backed by stable source keys', () => {
  assert.match(content, /class="adrc-outline-toolbar"/);
  assert.match(content, />Fold H1</);
  assert.match(content, />Fold H2</);
  assert.match(content, />Fold H3</);
  assert.match(content, />Expand all</);
  assert.match(content, /function setOutlineHeadingCollapsed\(heading, collapsed\)/);
  assert.match(content, /function foldOutlineAtLevel\(level\)/);
  assert.match(content, /function expandAllOutlineSections\(\)/);
  assert.match(content, /outlineCollapsedKeys/);
});
