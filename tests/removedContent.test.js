'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { findRemovedContent } = require('../src/lib/changes');

function removedIds(html) {
  const document = new JSDOM(`<div id="root">${html}</div>`).window.document;
  return findRemovedContent(document.getElementById('root')).map((element) => element.id).sort();
}

test('findRemovedContent rejects missing or non-DOM roots', () => {
  assert.deepEqual(findRemovedContent(null), []);
  assert.deepEqual(findRemovedContent({}), []);
});

test('findRemovedContent hides markers without hiding retained prose or additions', () => {
  assert.deepEqual(removedIds('<p id="mixed">Kept <del id="old">old</del><ins id="new">new</ins></p>'), ['old']);
});

test('findRemovedContent hides paragraphs emptied by deletions', () => {
  assert.deepEqual(removedIds('<p id="paragraph"> <del id="old">old</del> </p>'), ['old', 'paragraph']);
});

test('findRemovedContent preserves nested list branches with retained items', () => {
  assert.deepEqual(removedIds('<ul id="list"><li id="parent"><del id="old">old</del><ul><li>kept</li><li id="gone" class="removed">gone</li></ul></li></ul>'), ['gone', 'old']);
});

test('findRemovedContent hides lists containing only deleted items', () => {
  assert.deepEqual(removedIds('<ul id="list"><li id="item"><del id="old">old</del></li></ul>'), ['item', 'list', 'old']);
});

test('findRemovedContent keeps table cells aligned but hides entirely deleted rows', () => {
  assert.deepEqual(removedIds('<table><tbody><tr id="mixed"><td id="cell"><del id="old">old</del></td><td>kept</td></tr><tr id="gone"><td><del id="gone-text">gone</del></td></tr></tbody></table>'), ['gone', 'gone-text', 'old']);
});

test('findRemovedContent hides wrapped blocks and explicitly removed rows', () => {
  assert.deepEqual(removedIds('<del id="wrapper"><h2 id="heading">old</h2></del><table id="table"><tbody id="body"><tr id="row" class="removed"><td>gone</td></tr></tbody></table>'), ['body', 'row', 'table', 'wrapper']);
});

test('findRemovedContent does not treat review UI as retained document content', () => {
  assert.deepEqual(removedIds('<p id="paragraph"><del id="old">old</del><button class="grdc-comment-btn">+</button></p><div class="grdc-existing-thread"><del id="comment">authored strike</del><p class="removed" id="comment-block">comment</p></div>'), ['old', 'paragraph']);
});

test('findRemovedContent preserves images and ordinary strikethrough elements', () => {
  assert.deepEqual(removedIds('<p id="media"><del id="old">old</del><img src="diagram.png"></p><p><s id="strike">authored strike</s></p>'), ['old']);
});

test('findRemovedContent preserves a code block with added or unchanged lines', () => {
  assert.deepEqual(removedIds('<pre id="code"><del id="old">old\n</del><ins>new\n</ins>kept</pre>'), ['old']);
});

test('findRemovedContent preserves even whitespace-only additions', () => {
  assert.deepEqual(removedIds('<pre id="code"><del id="old">old\n</del><ins>\n</ins></pre>'), ['old']);
});
