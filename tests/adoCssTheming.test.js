'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', 'extensions', 'ado', 'styles.css');
const CONTENT_PATH = path.join(__dirname, '..', 'extensions', 'ado', 'content.js');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const content = fs.readFileSync(CONTENT_PATH, 'utf8');
const lines = css.split(/\r?\n/);

const REQUIRED_ALIASES = [
  '--adrc-accent',
  '--adrc-accent-hover',
  '--adrc-accent-tint',
  '--adrc-accent-border',
  '--adrc-on-accent',
  '--adrc-danger',
  '--adrc-danger-bg',
  '--adrc-danger-border',
  '--adrc-success',
  '--adrc-warning',
  '--adrc-warning-bg',
  '--adrc-warning-border',
  '--adrc-renamed',
  '--adrc-border',
  '--adrc-focus',
  '--adrc-text',
  '--adrc-text-muted',
  '--adrc-bg',
  '--adrc-bg-subtle',
  '--adrc-bg-hover',
  '--adrc-code-bg',
  '--adrc-shadow',
  '--adrc-shadow-secondary',
];

test('ADO theme aliases consume official semantic properties before palette fallbacks', () => {
  const requiredHostTokens = [
    '--communication-background',
    '--text-on-communication-background',
    '--background-color',
    '--text-primary-color',
    '--text-secondary-color',
    '--border-subtle-color',
    '--focus-border-color',
    '--status-error-text',
    '--status-error-background',
    '--status-success-text',
    '--status-warning-text',
    '--panel-shadow-color',
  ];
  requiredHostTokens.forEach((token) => assert.match(css, new RegExp(`var\\(${token.replace(/-/g, '\\-')},`)));
  assert.match(css, /rgba\(var\(--palette-neutral-0,/);
  assert.match(css, /rgba\(var\(--palette-neutral-100,/);
  assert.match(css, /rgba\(var\(--palette-primary-60,/);
  assert.match(content, /document\.body\.classList\.add\('adrc-theme-host'\)/);
  assert.match(css, /body\.adrc-theme-host/);
  assert.match(content, /theme\(\)/);
  assert.match(content, /forcedColors:\s*matchMedia\('\(forced-colors: active\)'\)\.matches/);
});

test('ADO component rules contain no literal colors outside centralized token declarations', () => {
  const offenders = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || /^(\/\*|\*|\/\/)/.test(trimmed)) return;
    if (/^--adrc-[\w-]+\s*:/.test(trimmed)) return;
    if (/^@keyframes/.test(trimmed)) return;
    if (/:\s*(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|white\b|black\b)/.test(trimmed)) {
      offenders.push(`L${index + 1}: ${trimmed}`);
    }
  });
  assert.deepEqual(offenders, [], `Literal component colors bypass theme tokens:\n${offenders.join('\n')}`);
  assert.doesNotMatch(css, /color-mix\(/, 'Supported Chromium builds must retain range highlighting');
});

test('every referenced ADRC theme alias is declared', () => {
  const defined = new Set(Array.from(css.matchAll(/(--adrc-[\w-]+)\s*:/g), (match) => match[1]));
  const used = new Set(Array.from(css.matchAll(/var\((--adrc-[\w-]+)/g), (match) => match[1]));
  const missing = Array.from(used).filter((token) => !defined.has(token)).sort();
  assert.deepEqual(missing, []);
  REQUIRED_ALIASES.forEach((token) => assert.ok(defined.has(token), `Missing ${token}`));
});

test('dark fallback overrides all core opaque, text, border, accent, and status aliases', () => {
  const dark = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] || '';
  [
    '--adrc-accent', '--adrc-accent-tint', '--adrc-danger', '--adrc-success',
    '--adrc-warning', '--adrc-renamed', '--adrc-border', '--adrc-text',
    '--adrc-text-muted', '--adrc-bg', '--adrc-bg-subtle', '--adrc-bg-hover',
    '--adrc-code-bg', '--adrc-shadow'
  ].forEach((token) => assert.match(dark, new RegExp(token.replace(/-/g, '\\-'))));
});

test('forced-colors mode uses system colors and opts injected roots into deterministic adjustment', () => {
  assert.match(css, /@media\s*\(forced-colors:\s*active\)/);
  assert.match(css, /--adrc-bg:\s*Canvas/);
  assert.match(css, /--adrc-text:\s*CanvasText/);
  assert.match(css, /--adrc-text-muted:\s*GrayText/);
  assert.match(css, /--adrc-accent:\s*Highlight/);
  assert.match(css, /--adrc-on-accent:\s*HighlightText/);
  assert.match(css, /forced-color-adjust:\s*none/);
  assert.match(css, /\.adrc-outline-row\.adrc-outline-active/);
  assert.match(css, /\.adrc-sidebar-change-active/);
});
