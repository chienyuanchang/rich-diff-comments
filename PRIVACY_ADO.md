# Privacy Policy — Markdown PR Comments for Azure DevOps

**Effective date:** August 27, 2026

Markdown PR Comments for Azure DevOps is a browser extension that adds inline review commenting and navigation to rendered Markdown in Azure DevOps pull request Preview mode.

## What data the extension accesses

The extension runs only on Azure DevOps pull request pages matching:

- `https://dev.azure.com/*/_git/*/pullrequest/*`
- `https://*.visualstudio.com/*/_git/*/pullrequest/*`

While on those pages, it reads:

- The rendered Markdown Preview content needed to position comment buttons, threads, change navigation, and the document outline.
- The raw Markdown source of changed files and pull request metadata needed to map rendered blocks to source lines and identify changed sections.
- Existing pull request review threads, comments, statuses, and the current signed-in Azure DevOps identity needed to display and manage review conversations.

## What data the extension sends

The extension sends data **only to the Azure DevOps origin currently open in your browser** (`dev.azure.com` or your organization's legacy `visualstudio.com` origin). Requests use the Azure DevOps session your browser already holds. Specifically:

- New review comments and replies are posted to Azure DevOps when you submit them.
- Edits and deletes are sent only when you choose those actions on your own comments.
- Resolve and unresolve actions are sent when you change a thread's status.
- Read requests fetch pull request metadata, changed-file information, Markdown source, review threads, and the current signed-in identity.

No data is sent to any other server, analytics provider, advertising network, or third party. The extension has no telemetry and no backend service.

## Permissions

| Permission | Why |
|---|---|
| `host_permissions: https://dev.azure.com/*` | Required to run on current Azure DevOps pull request pages and make same-origin requests to Azure DevOps review and Git endpoints. |
| `host_permissions: https://*.visualstudio.com/*` | Required for organizations that still use legacy Azure DevOps `visualstudio.com` URLs. |

The extension requests no Chrome or Edge API permissions and cannot access unrelated websites.

## Local and session storage

The extension stores only interface preferences under the Azure DevOps page's own origin, including sidebar visibility, selected tab, unresolved-only filter, position, and size. It may temporarily store a pending cross-file navigation target in session storage while Azure DevOps switches files. Pending targets expire automatically and contain only a changed-file path and the selected review item identifier.

The extension does **not** store passwords, Azure DevOps access tokens, Personal Access Tokens, comment drafts, raw Markdown files, or review-thread contents in persistent storage.

You can clear these preferences through your browser's site-data controls or DevTools (`Application → Storage`).

## Authentication

The extension does not handle, store, or transmit your Microsoft account password or a Personal Access Token. Authentication is performed by the Azure DevOps session already established in your browser. A request succeeds only when your signed-in Azure DevOps account is allowed to perform the same action.

## Children

The extension is not directed at children and does not knowingly collect data from children.

## Changes

Any future change to this policy will be committed to the extension's public source repository and reflected in the published version.

## Contact

Source code and issue tracker:
<https://github.com/chienyuanchang/rich-diff-comments>
