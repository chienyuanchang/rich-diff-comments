'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { splitSentences, changeSpeech, fileSpeech, sentenceRange, localVoices, availableVoices, pickVoice, sentenceStep } = require('../src/lib/readAloud.js');

const dom = (html) => new JSDOM(`<div class="prose-diff"><div class="markdown-body">${html}</div></div>`).window.document;

test('splitSentences: one chunk per sentence, long ones cut near 200 characters', () => {
  assert.deepEqual(splitSentences('First one. Second? Third!'), ['First one.', 'Second?', 'Third!']);
  const long = Array(60).fill('word').join(' ');
  const chunks = splitSentences(long);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 220));
  assert.equal(chunks.join(' '), long);
  assert.deepEqual(splitSentences(''), []);
});

test('changeSpeech: edited block reads the new text; removed words only with Show removed content', () => {
  const doc = dom('<p id="b">Kept <del>old words</del><ins>new words</ins> ending.</p>');
  const block = doc.getElementById('b');
  assert.deepEqual(changeSpeech(block, { includeRemoved: false }), ['Kept new words ending.']);
  assert.deepEqual(changeSpeech(block, { includeRemoved: true }), ['Kept new words ending.', 'Removed: old words.']);
});

test('changeSpeech: wholly removed blocks are announced with at most two words', () => {
  const doc = dom(
    '<del><p id="wrapped">Deleted paragraph here.</p></del>' +
    '<p id="inner"><del>Entirely deleted text.</del></p>' +
    '<ul><li id="cls" class="removed">Gone</li></ul>');
  assert.deepEqual(changeSpeech(doc.getElementById('wrapped')), ['Removed block starting with Deleted paragraph.']);
  assert.deepEqual(changeSpeech(doc.getElementById('inner')), ['Removed block starting with Entirely deleted.']);
  assert.deepEqual(changeSpeech(doc.getElementById('cls')), ['Removed block starting with Gone.']);
  assert.deepEqual(changeSpeech(dom('<p id="x"><del>Two.</del></p>').getElementById('x')), ['Removed block starting with Two.']);
});

test('changeSpeech: table rows, code blocks and our own UI', () => {
  const doc = dom(
    '<table><tr id="row"><td><ins>new cell</ins></td><td>kept</td></tr></table>' +
    '<pre id="code"><code><ins>a\nb\n</ins></code></pre>' +
    '<p id="ui"><ins>Text</ins><button class="grdc-comment-btn">+</button></p>');
  assert.deepEqual(changeSpeech(doc.getElementById('row')), ['new cell kept']);
  assert.deepEqual(changeSpeech(doc.getElementById('code')), ['Code block, 2 lines.']);
  assert.deepEqual(changeSpeech(doc.getElementById('ui')), ['Text']);
  assert.deepEqual(changeSpeech(null), []);
});

test('fileSpeech: a new file is read block by block, a deleted one is announced', () => {
  const doc = dom('<h1>Title</h1><ul><li><p>Item one.</p></li></ul><p>End.</p>');
  const root = doc.querySelector('.prose-diff');
  assert.deepEqual(fileSpeech(root, 'ADDED', 'a.md'), ['New file a.md.', 'Title', 'Item one.', 'End.']);
  assert.deepEqual(fileSpeech(root, 'REMOVED', 'a.md'), ['Deleted file a.md.']);
});

test('sentenceRange: finds each spoken sentence in the visible text, skipping deleted words', () => {
  const doc = dom('<p id="b">First <del>gone</del><ins>one</ins>   here. Second <em>one</em>.<button class="grdc-comment-btn">+</button></p>');
  const block = doc.getElementById('b');
  const [s1, s2] = changeSpeech(block);
  const a = sentenceRange(block, s1, 0);
  // The range spans the sentence on screen, so deleted words inside it are covered too.
  assert.equal(a.range.toString(), 'First goneone   here.');
  const b = sentenceRange(block, s2, a.end);
  assert.equal(b.range.toString(), 'Second one.');
  assert.equal(sentenceRange(block, 'Removed: gone.', 0), null);
  assert.equal(sentenceRange(null, 'x', 0), null);
});

test('localVoices / pickVoice: only on-device voices, never a network one', () => {
  const v = (name, lang, localService, isDefault) => ({ name, lang, localService, default: !!isDefault });
  const voices = [v('Google US English', 'en-US', false, true), v('Zira', 'en-US', true), v('David', 'en-US', true, true), v('Hila', 'he-IL', true), v('Aria Online (Natural)', 'en-US', false)];
  assert.deepEqual(localVoices(voices, 'en-US').map((x) => x.name), ['David', 'Zira', 'Hila']);
  assert.equal(pickVoice(voices, '', 'en-US').name, 'David');
  assert.equal(pickVoice(voices, 'Hila', 'en-US').name, 'Hila');
  assert.equal(pickVoice(voices, 'Google US English', 'en-US').name, 'David'); // a saved network voice is not used
  assert.equal(pickVoice([v('Google US English', 'en-US', false)], '', 'en'), null);
  assert.equal(pickVoice([], '', 'en'), null);
});

test('availableVoices / pickVoice with online voices allowed: network voices offered after on-device ones', () => {
  const v = (name, lang, localService, isDefault) => ({ name, lang, localService, default: !!isDefault });
  const voices = [v('Google UK English Male', 'en-GB', false), v('Zira', 'en-US', true), v('Hila', 'he-IL', true)];
  assert.deepEqual(availableVoices(voices, 'en-US', false).map((x) => x.name), ['Zira', 'Hila']);
  assert.deepEqual(availableVoices(voices, 'en-US', true).map((x) => x.name), ['Zira', 'Google UK English Male', 'Hila']);
  assert.equal(pickVoice(voices, 'Google UK English Male', 'en-US', true).name, 'Google UK English Male');
  assert.equal(pickVoice(voices, '', 'en-US', true).name, 'Zira'); // Default still prefers on-device
  assert.equal(pickVoice([voices[0], voices[2]], '', 'en-US', true).name, 'Hila');
  assert.equal(pickVoice([v('Google US English', 'en-US', false)], '', 'en', true).name, 'Google US English');
});

test('sentenceStep: ← after a change finished replays its last sentence instead of skipping one', () => {
  // Third (last) sentence finished; waiting to move to the next change.
  assert.deepEqual(sentenceStep({ idx: 2, k: 3, count: 3 }, -1, 5), { idx: 2, k: 2 });
  assert.deepEqual(sentenceStep({ idx: 2, k: 3, count: 3 }, 1, 5), { idx: 3, k: 0 });
  assert.deepEqual(sentenceStep({ idx: 2, k: 1, count: 3 }, -1, 5), { idx: 2, k: 0 });
  assert.deepEqual(sentenceStep({ idx: 2, k: 0, count: 3 }, -1, 5), { idx: 1, k: -1 });
  assert.deepEqual(sentenceStep({ idx: 0, k: 0, count: 3 }, -1, 5), { idx: 0, k: 0 });
  assert.equal(sentenceStep({ idx: 4, k: 2, count: 3 }, 1, 5), null); // past the last change
  assert.equal(sentenceStep(null, 1, 5), null);
});
