'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ROLE_LABELS, roleLabel, isPRAuthor } = require('../src/lib/roles.js');

// ───────────────────────────────────────────────────────────────────────────
// ROLE_LABELS
// ───────────────────────────────────────────────────────────────────────────

test('ROLE_LABELS — has all six recognised associations', () => {
  assert.equal(ROLE_LABELS.OWNER, 'Owner');
  assert.equal(ROLE_LABELS.MEMBER, 'Member');
  assert.equal(ROLE_LABELS.COLLABORATOR, 'Collaborator');
  assert.equal(ROLE_LABELS.CONTRIBUTOR, 'Contributor');
  assert.equal(ROLE_LABELS.FIRST_TIME_CONTRIBUTOR, 'First-time contributor');
  assert.equal(ROLE_LABELS.FIRST_TIMER, 'First-timer');
});

test('ROLE_LABELS — no entry for MANNEQUIN or NONE (GitHub suppresses)', () => {
  assert.equal(ROLE_LABELS.MANNEQUIN, undefined);
  assert.equal(ROLE_LABELS.NONE, undefined);
});

test('ROLE_LABELS — is frozen so callers cannot mutate it', () => {
  assert.throws(
    () => { ROLE_LABELS.OWNER = 'Boss'; },
    /(read[- ]?only|Cannot assign|object is not extensible)/i
  );
});

// ───────────────────────────────────────────────────────────────────────────
// roleLabel
// ───────────────────────────────────────────────────────────────────────────

test('roleLabel — returns label for each known association', () => {
  assert.equal(roleLabel('OWNER'), 'Owner');
  assert.equal(roleLabel('MEMBER'), 'Member');
  assert.equal(roleLabel('COLLABORATOR'), 'Collaborator');
  assert.equal(roleLabel('CONTRIBUTOR'), 'Contributor');
  assert.equal(roleLabel('FIRST_TIME_CONTRIBUTOR'), 'First-time contributor');
  assert.equal(roleLabel('FIRST_TIMER'), 'First-timer');
});

test('roleLabel — returns null for unrecognised associations', () => {
  assert.equal(roleLabel('NONE'), null);
  assert.equal(roleLabel('MANNEQUIN'), null);
  assert.equal(roleLabel('SOMETHING_NEW_GITHUB_INVENTED'), null);
});

test('roleLabel — null / undefined / non-string input returns null', () => {
  assert.equal(roleLabel(null), null);
  assert.equal(roleLabel(undefined), null);
  assert.equal(roleLabel(''), null);
  assert.equal(roleLabel(42), null);
  assert.equal(roleLabel({}), null);
});

test('roleLabel — case-sensitive (GitHub sends uppercase)', () => {
  assert.equal(roleLabel('owner'), null);
  assert.equal(roleLabel('Owner'), null);
});

// ───────────────────────────────────────────────────────────────────────────
// isPRAuthor
// ───────────────────────────────────────────────────────────────────────────

test('isPRAuthor — exact match returns true', () => {
  assert.equal(isPRAuthor('alice', 'alice'), true);
});

test('isPRAuthor — case-insensitive match (GitHub logins are case-insensitive)', () => {
  assert.equal(isPRAuthor('Alice', 'alice'), true);
  assert.equal(isPRAuthor('ALICE', 'alice'), true);
  assert.equal(isPRAuthor('alice', 'ALICE'), true);
});

test('isPRAuthor — non-matching logins return false', () => {
  assert.equal(isPRAuthor('alice', 'bob'), false);
});

test('isPRAuthor — null / undefined / empty PR author returns false', () => {
  assert.equal(isPRAuthor('alice', null), false);
  assert.equal(isPRAuthor('alice', undefined), false);
  assert.equal(isPRAuthor('alice', ''), false);
});

test('isPRAuthor — null / undefined / empty comment user returns false', () => {
  assert.equal(isPRAuthor(null, 'alice'), false);
  assert.equal(isPRAuthor(undefined, 'alice'), false);
  assert.equal(isPRAuthor('', 'alice'), false);
});

test('isPRAuthor — non-string input returns false (no throw)', () => {
  assert.equal(isPRAuthor(42, 'alice'), false);
  assert.equal(isPRAuthor('alice', 42), false);
  assert.equal(isPRAuthor({}, 'alice'), false);
});
