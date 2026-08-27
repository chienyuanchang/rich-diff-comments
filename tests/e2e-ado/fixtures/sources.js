'use strict';

const DESIGN_PATH = '/docs/design.md';
const OTHER_PATH = '/docs/other.md';
const NEW_PATH = '/docs/new.md';
const DELETED_PATH = '/docs/deleted.md';
const RENAMED_PATH = '/docs/renamed.md';
const OLD_RENAMED_PATH = '/docs/legacy.md';

const DESIGN_SOURCE = [
  '# Design Review',                            // 1
  '',                                           // 2
  'This document explains the queue worker.',   // 3
  '',                                           // 4
  '## Architecture',                            // 5
  '',                                           // 6
  'The worker uses a durable queue.',            // 7
  '',                                           // 8
  '- Retry failed work',                        // 9
  '- Emit delivery metrics',                    // 10
  '',                                           // 11
  '## Implementation',                          // 12
  '',                                           // 13
  'The worker starts with three attempts.',      // 14
  '',                                           // 15
  '```js',                                      // 16
  'const retries = 3;',                          // 17
  'enqueue(job);',                               // 18
  '```',                                        // 19
  '',                                           // 20
  '## Ownership',                               // 21
  '',                                           // 22
  '| Area | Owner |',                           // 23
  '| --- | --- |',                              // 24
  '| API | Platform |',                         // 25
  '| UI | Experience |',                        // 26
].join('\n');

const DESIGN_BASE_SOURCE = [
  '# Design Review',
  '',
  'This document explains the queue worker.',
  '',
  '## Architecture',
  '',
  'The worker uses an in-memory queue.',
  '',
  '- Retry failed work',
  '- Emit basic metrics',
  '',
  '## Implementation',
  '',
  'The worker starts with three attempts.',
  '',
  '```js',
  'const retries = 2;',
  'enqueue(job);',
  '```',
  '',
  '## Ownership',
  '',
  '| Area | Owner |',
  '| --- | --- |',
  '| API | Platform |',
  '| UI | Experience |',
].join('\n');

const OTHER_SOURCE = [
  '# Other Document',                           // 1
  '',                                           // 2
  'Cross-file review target.',                  // 3
  '',                                           // 4
  '## Notes',                                   // 5
  '',                                           // 6
  'This page proves Preview-preserving navigation.', // 7
].join('\n');

const OTHER_BASE_SOURCE = [
  '# Other Document',
  '',
  'Cross-file review target.',
  '',
  '## Notes',
  '',
  'This page used to describe only local navigation.',
].join('\n');

const NEW_SOURCE = [
  '# Brand New Guide',
  '',
  'This Markdown file exists only on the pull request branch.',
].join('\n');

const DELETED_SOURCE = [
  '# Retired Guide',
  '',
  'This Markdown file was removed by the pull request.',
].join('\n');

const RENAMED_SOURCE = [
  '# Renamed Notes',
  '',
  'Updated wording after the rename.',
].join('\n');

const RENAMED_BASE_SOURCE = [
  '# Legacy Notes',
  '',
  'Old wording before the rename.',
].join('\n');

const CURRENT_USER = {
  id: 'identity-current',
  descriptor: 'aad.current-user',
  uniqueName: 'reviewer@example.test',
  displayName: 'Current Reviewer',
};

const OTHER_USER = {
  id: 'identity-other',
  descriptor: 'aad.other-user',
  uniqueName: 'author@example.test',
  displayName: 'Document Author',
};

function comment(id, content, author, publishedDate) {
  return {
    id,
    parentCommentId: 0,
    commentType: 1,
    content,
    author,
    publishedDate,
    lastContentUpdatedDate: publishedDate,
    isDeleted: false,
  };
}

function defaultThreads() {
  return [
    {
      id: 101,
      status: 'active',
      threadContext: {
        filePath: DESIGN_PATH,
        rightFileStart: { line: 7, offset: 1 },
        rightFileEnd: { line: 7, offset: 1 },
      },
      comments: [comment(
        1,
        'Should this queue have a dead-letter policy?',
        CURRENT_USER,
        '2026-08-20T10:00:00.000Z'
      )],
    },
    {
      id: 102,
      status: 'fixed',
      threadContext: {
        filePath: DESIGN_PATH,
        rightFileStart: { line: 14, offset: 1 },
        rightFileEnd: { line: 18, offset: 1 },
      },
      comments: [comment(
        1,
        'Retry and metrics behavior is now documented.',
        OTHER_USER,
        '2026-08-20T11:00:00.000Z'
      )],
    },
    {
      id: 103,
      status: 'active',
      threadContext: {
        filePath: OTHER_PATH,
        rightFileStart: { line: 3, offset: 1 },
        rightFileEnd: { line: 3, offset: 1 },
      },
      comments: [comment(
        1,
        'Cross-file thread for navigation coverage.',
        OTHER_USER,
        '2026-08-20T12:00:00.000Z'
      )],
    },
    {
      id: 900,
      comments: [{
        id: 1,
        commentType: 'system',
        content: 'The source branch was updated.',
        publishedDate: '2026-08-20T09:00:00.000Z',
      }],
      threadContext: null,
      properties: {
        CodeReviewThreadType: { $type: 'System.String', $value: 'RefUpdate' },
      },
    },
  ];
}

function defaultChanges() {
  // ADO's iteration API has been observed returning the reverse of the native
  // file tree. Keep this fixture reversed so E2E tests prove the extension
  // derives UI order from the tree/path contract rather than response order.
  return [
    { changeId: 1, changeTrackingId: 101, changeType: 'edit', item: { path: DESIGN_PATH } },
    { changeId: 2, changeTrackingId: 102, changeType: 'edit', item: { path: OTHER_PATH } },
    { changeId: 3, changeTrackingId: 103, changeType: 'add', item: { path: NEW_PATH } },
    { changeId: 4, changeTrackingId: 104, changeType: 'delete', item: { path: DELETED_PATH } },
    {
      changeId: 5,
      changeTrackingId: 105,
      changeType: 'rename, edit',
      originalPath: OLD_RENAMED_PATH,
      item: { path: RENAMED_PATH },
    },
    { changeId: 6, changeTrackingId: 106, changeType: 'edit', item: { path: '/src/ignored.js' } },
    {
      changeId: 7,
      changeTrackingId: 107,
      changeType: 'rename',
      originalPath: '/docs/was-markdown.md',
      item: { path: '/docs/now-text.txt' },
    },
  ].reverse();
}

module.exports = {
  DESIGN_PATH,
  OTHER_PATH,
  NEW_PATH,
  DELETED_PATH,
  RENAMED_PATH,
  OLD_RENAMED_PATH,
  DESIGN_SOURCE,
  DESIGN_BASE_SOURCE,
  OTHER_SOURCE,
  OTHER_BASE_SOURCE,
  NEW_SOURCE,
  DELETED_SOURCE,
  RENAMED_SOURCE,
  RENAMED_BASE_SOURCE,
  CURRENT_USER,
  OTHER_USER,
  defaultThreads,
  defaultChanges,
};
