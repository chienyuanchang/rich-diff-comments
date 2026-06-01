# Privacy Policy — Markdown PR Comments for GitHub

**Effective date:** May 18, 2026

Markdown PR Comments for GitHub is a browser extension that adds inline commenting to GitHub Pull Request rich-diff (rendered markdown) views.

## What data the extension accesses

The extension runs as a content script on `https://github.com/*/pull/*` pages. While on those pages it reads:

- The rendered DOM of the page (paragraphs, headings, tables, code blocks) to position comment affordances.
- The raw markdown source of files in the PR, fetched from the same `github.com` origin.
- Existing review threads and PR metadata, fetched from the same `github.com` origin.
- Mentionable-user suggestions for `@mention` autocomplete, fetched from the same `github.com` origin.

## What data the extension sends

The extension sends data **only to `github.com`**, the same origin you are already logged into. Requests are made on your behalf using the session cookies your browser already holds for `github.com`, with no separate authentication. Specifically:

- New review comments and replies are posted to `github.com` via the same endpoints the GitHub web UI itself uses.
- Resolve / unresolve actions on review threads, again via GitHub's own endpoints.
- A markdown preview request to `github.com/preview` to render the comment-preview tab.
- A user-suggestions request to `github.com/suggestions/...` for `@mention` autocomplete.

No data is sent to any other server, analytics provider, or third party. The extension contains no telemetry.

## Permissions

| Permission | Why |
|---|---|
| `host_permissions: https://github.com/*` | Required to read GitHub pages and make same-origin requests to GitHub's review-comment endpoints. |

The extension does not request any other permissions and does not have access to any other websites.

## Local storage

The extension stores the following in your browser's local storage (`localStorage`), all under the `github.com` origin:

- `grdc_use_pat` (optional, off by default): a flag indicating whether to use a Personal Access Token instead of session cookies.
- `grdc_github_token` (optional, only if you choose PAT mode): the PAT you provide. This value never leaves your browser except in `Authorization: token ...` headers sent to `github.com` / `api.github.com`.

Both keys can be cleared at any time from your browser's DevTools (`Application → Storage → Local Storage`).

## Authentication

The extension does not handle, store, or transmit your GitHub password. Authentication is performed by your browser's existing GitHub session cookies (or, in the optional PAT mode, by a token you provide). Requests succeed only if your normal GitHub account would be allowed to perform the same action.

## Children

The extension is not directed at children and does not knowingly collect any data from children.

## Changes

Any future change to this policy will be committed to the extension's source repository and reflected in the published version.

## Contact

The extension is open-source. Source and issues:
<https://github.com/chienyuanchang/rich-diff-comments>
