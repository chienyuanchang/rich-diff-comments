# Privacy Policy — Markdown PR — Markdown PR Comments for GitHub

**Effective date:** May 18, 2026
**Last updated:** November 26, 2026

Markdown PR — Markdown PR Comments for GitHub is a browser extension that adds inline commenting to GitHub Pull Request rich-diff (rendered markdown) views.

## What data the extension accesses

The extension runs as a content script on `https://github.com/*/pull/*` pages. While on those pages it reads:

- The rendered DOM of the page (paragraphs, headings, tables, code blocks) to position comment affordances.
- The raw markdown source of files in the PR, fetched from the same `github.com` origin.
- Existing review threads and PR metadata, fetched from the same `github.com` origin.
- Mentionable-user suggestions for `@mention` autocomplete, fetched from the same `github.com` origin.

## What data the extension sends

The extension's own GitHub requests go **only to `github.com`**, the same origin you are already logged into. Requests are made on your behalf using the session cookies your browser already holds for `github.com`, with no separate authentication. Specifically:

- New review comments and replies are posted to `github.com` via the same endpoints the GitHub web UI itself uses.
- Resolve / unresolve actions on review threads, again via GitHub's own endpoints.
- A markdown preview request to `github.com/preview` to render the comment-preview tab.
- A user-suggestions request to `github.com/suggestions/...` for `@mention` autocomplete.

The extension has no backend, analytics, or telemetry. As described below, the browser may send spoken PR text to an online voice provider if you opt in to online voices.

**Listen to the changes** (off unless you turn on Enable Listening) speaks PR text with your browser's built-in speech synthesis. By default it offers only voices the browser reports as on-device. If none is available, the play button is disabled unless you opt in to online voices.

If you turn on **Allow online voices** in View options, network voices are also offered. When you listen with an online voice, your browser may send the text being read (PR content) to that voice's provider, such as Google or Microsoft, under that provider's privacy terms. The default voice remains on-device when one is available; otherwise, playback may use an online voice after you opt in. Turning the option off stops playback. Changing to an on-device voice takes effect with the next sentence; text already sent to a provider cannot be recalled.

## Permissions

| Permission | Why |
|---|---|
| `host_permissions: https://github.com/*` | Required to read GitHub pages and make same-origin requests to GitHub's review-comment endpoints. |

The extension does not request any other permissions and does not have access to any other websites.

## Local storage

The extension stores sidebar layout, display and Listening preferences, and the last feature announcement you opened or dismissed in your browser's local storage under the `github.com` origin. It does not store credentials, comment drafts, raw Markdown files, or review-thread contents. Version 1.10.0 also deletes the two legacy PAT-related keys used by an older dormant fallback without reading their values.

## Authentication

The extension does not handle, store, or transmit your GitHub password or a Personal Access Token. Authentication is performed by the GitHub session already established in your browser. Requests succeed only if your signed-in GitHub account is allowed to perform the same action.

## Children

The extension is not directed at children and does not knowingly collect any data from children.

## Changes

Any future change to this policy will be committed to the extension's source repository and reflected in the published version.

## Contact

The extension is open-source. Source and issues:
<https://github.com/chienyuanchang/rich-diff-comments>
