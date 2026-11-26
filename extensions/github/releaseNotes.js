(function (root) {
  'use strict';

  // Bug-fix releases still appear in the changelog, but do not advance this marker.
  const notes = {
    announcementVersion: '1.16.0',
  };

  if (typeof module === 'object' && module.exports) module.exports = notes;
  else root.GRDC_RELEASE_NOTES = notes;
})(typeof self !== 'undefined' ? self : globalThis);
