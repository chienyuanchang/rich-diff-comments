(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.GRDC = root.GRDC || {};
    Object.assign(root.GRDC, api);
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function recentChangelog(markdown, announcementVersion) {
    if (typeof markdown !== 'string' || !markdown.trim()) {
      throw new TypeError('Changelog is missing or empty');
    }
    if (typeof announcementVersion !== 'string' || !announcementVersion.trim()) {
      throw new TypeError('Announcement version is missing');
    }

    const text = markdown.replace(/\r\n?/g, '\n');
    const headings = [...text.matchAll(/^##\s+\[([^\]\n]+)\]([^\n]*)$/gm)];
    const announcementReleased = headings.some((heading) => heading[1].trim() === announcementVersion);
    const releases = [];

    for (let i = 0; i < headings.length && releases.length < 5; i++) {
      const heading = headings[i];
      const name = heading[1].trim();
      const body = text.slice(heading.index + heading[0].length, headings[i + 1]?.index).trim();
      const content = body.replace(/<!--[\s\S]*?-->/g, '').split('\n')
        .some((line) => line.trim() && !/^#{1,6}\s/.test(line.trim()));
      if (name.toLowerCase() === 'unreleased') {
        if (!content) continue;
        releases.push({
          title: announcementReleased ? 'Unreleased' : `Version ${announcementVersion} (unreleased)`,
          body,
        });
      } else {
        if (!content) throw new Error(`Changelog entry ${name} has no details`);
        const suffix = heading[2].trim();
        releases.push({ title: `Version ${name}${suffix ? ` ${suffix}` : ''}`, body });
      }
    }
    if (!releases.length) throw new Error('Changelog contains no release entries');
    return releases;
  }

  return { recentChangelog };
});
