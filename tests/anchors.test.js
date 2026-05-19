'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { slugifyHeading } = require('../src/lib/anchors.js');

test('slugifyHeading — simple title', () => {
  assert.equal(slugifyHeading('Change Log'), 'change-log');
});

test('slugifyHeading — punctuation dropped', () => {
  assert.equal(slugifyHeading('Phase 1: Foundation'), 'phase-1-foundation');
});

test('slugifyHeading — apostrophe dropped, parentheses dropped', () => {
  assert.equal(slugifyHeading("Won't do (trade-offs)"), 'wont-do-trade-offs');
});

test('slugifyHeading — multiple spaces collapse to single hyphen', () => {
  assert.equal(slugifyHeading('Hello    World'), 'hello-world');
});

test('slugifyHeading — leading / trailing whitespace becomes hyphens', () => {
  // Matches GitHub renderer: leading whitespace produces leading hyphen.
  assert.equal(slugifyHeading('  hello'), '-hello');
  assert.equal(slugifyHeading('hello  '), 'hello-');
});

test('slugifyHeading — emoji and accented chars dropped', () => {
  assert.equal(slugifyHeading('🚧 Planned'), '-planned');
  assert.equal(slugifyHeading('Café résumé'), 'caf-rsum');
});

test('slugifyHeading — preserves digits, hyphens, underscores', () => {
  assert.equal(slugifyHeading('v1.0_alpha-2'), 'v10_alpha-2');
});

test('slugifyHeading — null / undefined / non-string returns empty', () => {
  assert.equal(slugifyHeading(null), '');
  assert.equal(slugifyHeading(undefined), '');
  assert.equal(slugifyHeading(42), '42');
});

test('slugifyHeading — already-lowercased identifier passes through', () => {
  assert.equal(slugifyHeading('overview'), 'overview');
});

test('slugifyHeading — tabs and newlines treated as whitespace', () => {
  assert.equal(slugifyHeading('a\tb\nc'), 'a-b-c');
});
