/**
 * Tests for pure text-matching helpers.
 * Run with:  npm test    (uses Node's built-in test runner, no deps required)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  stripMarkdown,
  cleanRenderedText,
  buildSourceIndex,
  findLineAtOffset,
  findTextInSource,
} = require('../src/lib/textMatch.js');

test('stripMarkdown removes headings', () => {
  assert.equal(stripMarkdown('# Hello\n## World'), 'Hello\nWorld');
});

test('stripMarkdown removes bold/italic/code/strikethrough', () => {
  assert.equal(stripMarkdown('**bold** *italic* `code` ~~strike~~'), 'bold italic code strike');
});

test('stripMarkdown removes link / image markup but keeps text', () => {
  assert.equal(stripMarkdown('see [docs](http://x.com) and ![alt](pic.png)'), 'see docs and alt');
});

test('stripMarkdown removes list bullets / blockquotes / pipes / hr', () => {
  assert.equal(stripMarkdown('- item'), 'item');
  assert.equal(stripMarkdown('1. item'), 'item');
  assert.equal(stripMarkdown('> quoted'), 'quoted');
  assert.equal(stripMarkdown('| a | b |'), '  a   b  ');
  assert.equal(stripMarkdown('---'), '');
});

test('cleanRenderedText strips zero-width and bidi chars', () => {
  const input = 'hel\u200blo\u202aworld'; // ZWSP + LRO
  assert.equal(cleanRenderedText(input), 'helloworld');
});

test('cleanRenderedText collapses whitespace, lowercases, strips diff `+`', () => {
  assert.equal(cleanRenderedText('+Hello   WORLD\n  bar'), 'hello world bar');
});

test('findLineAtOffset returns 1-based line for a position', () => {
  // Lines start at offsets [0, 10, 20, 30]
  const offsets = [0, 10, 20, 30];
  assert.equal(findLineAtOffset(offsets, 0), 1);
  assert.equal(findLineAtOffset(offsets, 5), 1);
  assert.equal(findLineAtOffset(offsets, 10), 2);
  assert.equal(findLineAtOffset(offsets, 25), 3);
  assert.equal(findLineAtOffset(offsets, 99), 4);
});

test('buildSourceIndex blanks out mermaid fence content (bug fix)', () => {
  // Bug history: mermaid source like "A --> B" used to leak into the concat
  // and the forward-scan matcher would latch onto it, breaking every block after.
  const src = [
    'Intro paragraph',
    '```mermaid',
    'graph TD',
    'A --> B',
    'B --> C',
    '```',
    'After diagram',
  ];
  const idx = buildSourceIndex(src);
  assert.ok(idx.concat.includes('intro paragraph'), 'intro kept');
  assert.ok(idx.concat.includes('after diagram'), 'after kept');
  assert.ok(!idx.concat.includes('graph td'), 'mermaid body masked');
  assert.ok(!idx.concat.includes('a --> b'), 'mermaid body masked');
});

test('buildSourceIndex keeps non-diagram fenced code searchable', () => {
  const src = [
    'Intro',
    '```python',
    'print("hello")',
    '```',
    'Outro',
  ];
  const idx = buildSourceIndex(src);
  assert.ok(idx.concat.includes('print("hello")'.toLowerCase()), 'python kept');
});

test('buildSourceIndex handles tilde fences', () => {
  const src = ['~~~mermaid', 'graph TD', '~~~', 'After'];
  const idx = buildSourceIndex(src);
  assert.ok(!idx.concat.includes('graph td'));
  assert.ok(idx.concat.includes('after'));
});

test('findTextInSource — happy path: finds a paragraph at correct line', () => {
  const src = [
    '# Title',                       // line 1
    '',                              // line 2
    'This is the overview paragraph.', // line 3
    '',                              // line 4
    'Second paragraph here.',         // line 5
  ];
  const idx = buildSourceIndex(src);
  const r = findTextInSource(idx, 'This is the overview paragraph.', 0);
  assert.equal(r.line, 3);
});

test('findTextInSource — fallback returns inherited line, not 1 (bug fix)', () => {
  // Bug history: unmatched blocks used to all snap to line 1, dropping comments at file top.
  const src = ['# Title', '', 'Paragraph A.', '', 'Paragraph B.'];
  const idx = buildSourceIndex(src);
  const a = findTextInSource(idx, 'Paragraph A.', 0);
  const r = findTextInSource(idx, 'Totally absent text that will not match', a.offset);
  // Should inherit line of last successful match (3), not collapse to 1.
  assert.equal(r.line, a.line, 'unmatched block inherits previous line');
  assert.notEqual(r.line, 1, 'must not fall back to line 1');
});

test('findTextInSource — forward scan picks the later occurrence of duplicate text', () => {
  const src = [
    'Overview',  // line 1
    '',          // line 2
    'Overview',  // line 3 (duplicate)
  ];
  const idx = buildSourceIndex(src);
  const first = findTextInSource(idx, 'Overview', 0);
  const second = findTextInSource(idx, 'Overview', first.offset + 1);
  assert.equal(first.line, 1);
  assert.equal(second.line, 3);
});

test('findTextInSource — empty / whitespace-only needle uses fallback', () => {
  const idx = buildSourceIndex(['Hello world']);
  assert.equal(findTextInSource(idx, '', 0).line, 1);
  assert.equal(findTextInSource(idx, '   ', 0).line, 1);
});

test('findTextInSource — logger is invoked exactly on a no-match', () => {
  const idx = buildSourceIndex(['Hello world']);
  const log = require('../src/lib/textMatch.js');
  const calls = [];
  const r = log.findTextInSource(idx, 'no such text in source', 0, (label, info) => {
    calls.push({ label, ...info });
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].label, 'NO MATCH');
  assert.equal(r.line, 1); // fallback at offset 0
});

test('findTextInSource — offset is monotonically non-decreasing across a real document walk', () => {
  // Walk through paragraphs in document order and verify our returned offsets
  // never go backwards. This is the invariant that prevents the "table rows
  // collapse to the same line" class of bug.
  const src = [
    'Intro para',     // 1
    '',               // 2
    'Second para',    // 3
    '',               // 4
    'Third para',     // 5
    '',               // 6
    'Final para',     // 7
  ];
  const idx = buildSourceIndex(src);
  let lastOffset = 0;
  const lines = [];
  for (const needle of ['Intro para', 'Second para', 'Third para', 'Final para']) {
    const r = findTextInSource(idx, needle, lastOffset);
    assert.ok(r.offset >= lastOffset, `offset regressed: ${r.offset} < ${lastOffset}`);
    lines.push(r.line);
    lastOffset = r.offset;
  }
  assert.deepEqual(lines, [1, 3, 5, 7]);
});

test('buildSourceIndex — nested fenced block inside a mermaid fence is fully masked', () => {
  // Edge case: tutorial-style markdown sometimes contains code-fence snippets
  // inside a diagram description. We currently use simple state-machine
  // matching with the same opening marker — verify the *whole* mermaid block
  // is masked, not just up to the inner ``` line.
  const src = [
    'Intro paragraph',           // 1
    '```mermaid',                // 2  ← outer fence open
    'graph TD',                  // 3  (masked)
    '    A --> B',               // 4  (masked)
    '```',                       // 5  ← outer fence close
    '',                          // 6
    'After diagram paragraph',   // 7
  ];
  const idx = buildSourceIndex(src);
  assert.ok(idx.concat.includes('intro paragraph'));
  assert.ok(idx.concat.includes('after diagram paragraph'));
  assert.ok(!idx.concat.includes('graph td'), 'mermaid body masked');
  assert.ok(!idx.concat.includes('a --> b'), 'mermaid body masked');
});
