(function (root) {
  'use strict';

  // Change this version only when publishing new feature announcements.
  const notes = {
    version: '1.16.0',
    highlights: [
      'Listen to changes aloud and follow along with highlighted sentences.',
      'Choose online voices in View options, with a privacy notice before use.',
      'Browse elsewhere while listening without being pulled back to the current change.',
    ],
  };

  if (typeof module === 'object' && module.exports) module.exports = notes;
  else root.GRDC_RELEASE_NOTES = notes;
})(typeof self !== 'undefined' ? self : globalThis);
