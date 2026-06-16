/**
 * Raw markdown source files paired with each `.html` fixture. Tests pass
 * these to `setupFixture(page, name, { rawSource: { <path>: SOURCE } })`
 * so the extension's blob-URL fetch returns realistic source for the
 * line-mapping pass.
 *
 * Keep these in sync with the fixture's rendered DOM — the matcher
 * text-matches DOM text against this source to assign line numbers.
 */

// Pairs with fixtures/yaml-frontmatter.html — a doc that starts with YAML
// frontmatter and has a body whose Change Log row text intentionally
// overlaps the frontmatter `related:` value (the 1.5.1 bug pattern).
const YAML_FRONTMATTER_SOURCE = [
  '---',                                                           // 1
  'feature: sample-feature',                                       // 2
  'area: testing',                                                 // 3
  'status: draft',                                                 // 4
  'related:',                                                      // 5
  '  - feature: another-feature',                                  // 6
  '    relationship: similar-to',                                  // 7
  '    note: A note that mentions sample-feature.',                // 8
  '---',                                                           // 9
  '',                                                              // 10
  '# Test Design Doc: Sample Feature Integration',                 // 11
  '',                                                              // 12
  'This document exists to exercise the extension.',               // 13
  '',                                                              // 14
  '## Overview',                                                   // 15
  '',                                                              // 16
  'This is the overview paragraph with some **emphasis**.',        // 17
  '',                                                              // 18
  '- First overview bullet',                                       // 19
  '- Second overview bullet',                                      // 20
  '',                                                              // 21
  '## Change Log',                                                 // 22
  '',                                                              // 23
  '| Date | Author | Change |',                                    // 24
  '|------|--------|--------|',                                    // 25
  '| 2026-06-16 | Test User | Added sample-feature note about another-feature. |', // 26
].join('\n');

module.exports = {
  yamlFrontmatter: {
    path: 'docs/sample-frontmatter.md',
    source: YAML_FRONTMATTER_SOURCE,
    expected: {
      h1Line: 11,
      overviewH2Line: 15,
      changeLogH2Line: 22,
      firstBulletLine: 19,
      // Frontmatter rows map to their YAML key source lines (2-col layout).
      frontmatterRowLines: {
        feature: 2,
        area: 3,
        status: 4,
        related: 5,
      },
    },
  },
};
