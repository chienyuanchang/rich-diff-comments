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
  findFrontmatterRange,
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

// ── YAML frontmatter (`---\n...\n---\n`) ────────────────────────────────
// GitHub renders frontmatter as a 2-column <table> in the rich-diff view.
// Without masking, long YAML values (e.g. an inline `related:` array) get
// stringified into one cell whose text accidentally substring-matches body
// content later in the document (a Related Features table, a Change Log row).
// `findTextInSource` then jumps `lastOffset` far downstream and every
// block after frontmatter falls back to the `lastLine + 1` nudge path,
// landing on the very last lines of the file.
//
// Repro from local-only/138_line_issue.md: a 138-line proposal whose H1
// (source line 19) was being anchored at line 85, TOC at 87, etc.
test('findFrontmatterRange — detects leading `---` ... `---` block and lists top-level keys', () => {
  const src = [
    '---',
    'feature: cu-cli',
    'related:',
    '  - foo',
    '---',
    '',
    '# Title',
  ];
  // `feature: cu-cli` (line 2) and `related:` (line 3) are top-level keys.
  // `  - foo` (line 4) is indented + an array item, so excluded.
  assert.deepEqual(findFrontmatterRange(src), { start: 1, end: 5, keyLines: [2, 3] });
});

test('findFrontmatterRange — tolerates blank lines before the opening fence', () => {
  const src = ['', '', '---', 'k: v', '---', '# Title'];
  assert.deepEqual(findFrontmatterRange(src), { start: 3, end: 5, keyLines: [4] });
});

test('findFrontmatterRange — returns null when there is no leading `---`', () => {
  assert.equal(findFrontmatterRange(['# Title', 'body']), null);
  assert.equal(findFrontmatterRange(['intro', '---', 'mid-doc separator']), null);
});

test('findFrontmatterRange — returns null when the opening `---` is never closed', () => {
  assert.equal(findFrontmatterRange(['---', 'k: v', 'no closing fence']), null);
});

test('findFrontmatterRange — keyLines lists every top-level YAML key, skipping nested keys and array items', () => {
  // Mirrors local-only/138_line_issue.md: a `related:` array with nested
  // objects whose own `feature:` / `path:` / `note:` keys are indented and
  // therefore NOT top-level.
  const src = [
    '---',                                                  // 1
    'feature: cu-cli',                                      // 2  ← top
    'semester: CY-2026-H1',                                 // 3  ← top
    'milestone: tbd',                                       // 4  ← top
    'area: integration',                                    // 5  ← top
    'status: proposal',                                     // 6  ← top
    'based-on: {}',                                         // 7  ← top
    'related:',                                             // 8  ← top
    '  - feature: agent-assisted-analyzer-authoring',       // 9  (indented array item)
    '    path: planning/foo/',                              // 10 (indented)
    '    relationship: similar-to',                         // 11 (indented)
    '    note: Same value prop, different shape.',          // 12 (indented)
    '  - feature: markitdown-integration',                  // 13 (indented array item)
    '    relationship: similar-to',                         // 14 (indented)
    '---',                                                  // 15
    '',
    '# Title',
  ];
  const fm = findFrontmatterRange(src);
  assert.deepEqual(fm.keyLines, [2, 3, 4, 5, 6, 7, 8]);
});

test('findFrontmatterRange — keyLines excludes comment lines (`# ...`)', () => {
  const src = [
    '---',
    '# YAML comment, not a key',
    'real-key: value',
    '---',
    '# Markdown heading',
  ];
  const fm = findFrontmatterRange(src);
  assert.deepEqual(fm.keyLines, [3]);
});

test('buildSourceIndex — masks YAML frontmatter so body content matches its real line', () => {
  // Mirrors the bug from local-only/138_line_issue.md, in miniature:
  // a `related:` array value that textually overlaps with a Change Log row
  // later in the document. With masking, frontmatter text is unreachable
  // and the body's H1 resolves to its true source line, not the Change Log.
  const src = [
    '---',                                        // 1
    'feature: cu-cli',                            // 2
    'related: markitdown-integration',            // 3
    '---',                                        // 4
    '',                                           // 5
    '# Feature Proposal',                         // 6
    '',                                           // 7
    '| Date | Change |',                          // 8
    '|------|--------|',                          // 9
    '| 2026 | Added markitdown-integration link |', // 10
  ];
  const idx = buildSourceIndex(src);
  assert.ok(!idx.concat.includes('feature: cu-cli'), 'frontmatter masked');
  assert.ok(!idx.concat.includes('cu-cli'), 'frontmatter masked');
  // Body text still findable
  const r = findTextInSource(idx, 'Feature Proposal', 0);
  assert.equal(r.line, 6, 'H1 anchors to its real source line, not a Change Log row');
});

test('buildSourceIndex — frontmatter `<tr>` walk does not pollute lastOffset for body blocks', () => {
  // Simulate the full buildLineMap loop's effect: walk frontmatter-derived
  // rendered <tr> rows first (whose text comes from GitHub's table cells),
  // then walk body blocks. After the fix, frontmatter rows fail to match
  // (so lastOffset stays at 0); the body's H1 then resolves correctly.
  const src = [
    '---',                                                              // 1
    'feature: cu-cli',                                                  // 2
    'related: markitdown-integration similar-to MarkItDown CLI option', // 3
    '---',                                                              // 4
    '',                                                                 // 5
    '# Feature Proposal: CU CLI',                                       // 6
    '',                                                                 // 7
    '## Related Features',                                              // 8
    '',                                                                 // 9
    'markitdown-integration similar-to MarkItDown CLI option',          // 10 (overlaps frontmatter text)
  ];
  const idx = buildSourceIndex(src);

  // GitHub renders frontmatter as <tr> cells; the cell text includes the key.
  const frontmatterRowTexts = [
    'feature cu-cli',
    'related markitdown-integration similar-to MarkItDown CLI option',
  ];
  let lastOffset = 0;
  for (const t of frontmatterRowTexts) {
    const r = findTextInSource(idx, t, lastOffset);
    // After the fix, frontmatter text isn't in the masked source ⇒ no match
    // ⇒ findTextInSource returns the fallback {line, offset: lastOffset}.
    assert.equal(r.offset, lastOffset, `frontmatter row "${t}" should not advance lastOffset`);
  }

  // Now the body walks: H1 must land on line 6, not line 10.
  const h1 = findTextInSource(idx, 'Feature Proposal: CU CLI', lastOffset);
  assert.equal(h1.line, 6);
});
