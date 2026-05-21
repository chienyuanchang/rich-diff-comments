/**
 * Pure helpers for comment-author role badges.
 *
 * Maps GitHub's `author_association` enum (returned on every PR review
 * comment) to the same human-readable labels GitHub's native source-diff
 * thread renders, and decides whether a comment author is the PR opener
 * (which earns the separate `Author` pill alongside the role pill).
 *
 * No DOM, no fetch — safe to unit-test in Node.
 *
 * Loaded in two contexts:
 *   • Extension content script  → exports attached to `window.GRDC.*`
 *   • Node test runner          → exports via `module.exports`
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.GRDC = root.GRDC || {};
    Object.assign(root.GRDC, api);
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // MANNEQUIN (migrated-account placeholder) and NONE (no relationship)
  // are intentionally absent — GitHub's native UI doesn't render a pill
  // for those, and neither do we.
  const ROLE_LABELS = Object.freeze({
    OWNER: 'Owner',
    MEMBER: 'Member',
    COLLABORATOR: 'Collaborator',
    CONTRIBUTOR: 'Contributor',
    FIRST_TIME_CONTRIBUTOR: 'First-time contributor',
    FIRST_TIMER: 'First-timer',
  });

  // Return the human-readable label for an `author_association` value,
  // or `null` if the value isn't one we render a pill for.
  function roleLabel(authorAssociation) {
    if (typeof authorAssociation !== 'string') return null;
    return ROLE_LABELS[authorAssociation] || null;
  }

  // Is the commenter the PR opener? Case-insensitive match; both args
  // must be non-empty strings. Returns `false` for any falsy / non-string
  // inputs so callers can pass possibly-null logins without guarding.
  function isPRAuthor(commentUser, prAuthorLogin) {
    if (typeof commentUser !== 'string' || !commentUser) return false;
    if (typeof prAuthorLogin !== 'string' || !prAuthorLogin) return false;
    return commentUser.toLowerCase() === prAuthorLogin.toLowerCase();
  }

  return {
    ROLE_LABELS,
    roleLabel,
    isPRAuthor,
  };
}));
