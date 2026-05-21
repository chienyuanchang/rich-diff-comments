---
description: Pre-publish audit and packaging for the Rich Diff Comments for GitHub browser extension. Use when preparing a new version to submit to the Chrome Web Store or Microsoft Edge Add-ons — runs the policy-lens checks that Chrome's reviewers care about (unused permissions, missing files, stale version) and builds the publish zip.
---

# Pre-publish check & package the extension

This skill prepares a new version of **Rich Diff Comments for GitHub** for submission to the Chrome Web Store and / or Microsoft Edge Add-ons.

## When to use

- The user says "package the extension", "build the zip", "prepare 1.0.X for submission", "check before publishing", "pre-publish audit", or similar.
- After bumping `manifest.json` `"version"`.
- After a Chrome Web Store rejection — to catch the same class of issue before resubmitting.

## When NOT to use

- For changes that don't ship (docs, tests, refactors with no manifest impact).
- For Edge-only listing edits that don't change the package zip (description, screenshots, markets). Those don't require a new build.

## Background

The Chrome Web Store rejected version 1.0.2 (May 2026) for declaring the `activeTab` permission without using it. The violation policy is [Use of Permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions): *"Don't attempt to future-proof your Product by requesting a permission that might benefit services or features that have not yet been implemented."* The full policy context is in [docs/PUBLISHING.md → Chrome Web Store policies — quick reference](../../../docs/PUBLISHING.md#chrome-web-store-policies--quick-reference).

The preflight script (`scripts/preflight.ps1`) implements the **policy-lens checks** from PUBLISHING.md as automated checks so we don't ship another rejection.

## Workflow

### 1. Run the preflight script

From the repository root:

```powershell
.\.github\skills\rdc-publish-check\scripts\preflight.ps1
```

Or with verbose output:

```powershell
.\.github\skills\rdc-publish-check\scripts\preflight.ps1 -Verbose
```

The script:

1. **Reads `manifest.json`** and prints version + declared permissions.
2. **Audits every `permissions` entry** against the codebase — greps for matching `chrome.<api>` calls. Any declared-but-unused permission fails the check (this is the rule that rejected 1.0.2).
3. **Audits `host_permissions`** to confirm at least one `fetch()` / `XMLHttpRequest` call targets a matching URL.
4. **Verifies required files** are present at expected paths (`content.js`, all `src/lib/*.js` declared in manifest, `styles.css`, `PRIVACY.md`, all four icon PNGs).
5. **Runs the test suite** (`node --test tests/*.test.js`) and fails if any tests fail.
6. **Checks the version hasn't shipped yet** — compares against git tags and the live version recorded in `docs/PUBLISHING.md`'s status table. Warns if the manifest version is `<=` the last shipped version (this would be rejected on upload).
7. **Confirms there's a matching `CHANGELOG.md` entry** for the current manifest version. Missing entry = warning.

If everything passes, the script reports `READY TO PACKAGE` and exits 0. If any check fails, it reports the issue and exits non-zero.

### 2. Build the publish zip

If preflight passes, run the existing packager:

```powershell
.\scripts\package.ps1
```

This produces `grdc-<version>.zip` at the extension root.

### 3. Prepare the release folder (zip only)

Organize the zip into a per-version release folder:

```powershell
.\.github\skills\rdc-publish-check\scripts\release-prep.ps1
```

This:

1. Reads the version from `manifest.json`.
2. Creates `releases/<version>/` (e.g. `releases/1.0.2/`). If the folder already exists, pass `-Force` to overwrite.
3. Builds the zip via `package.ps1` (skippable with `-SkipBuild` if a zip already exists at the extension root) and **moves** the zip into the release folder.

Final folder layout for v1.0.2:

```
releases/
└── 1.0.2/
    └── rdc-1.0.2.zip
```

> **Submission copy is not emitted per release.** Titles, descriptions, justifications, reviewer notes, search terms, and the "What's new" block are maintained directly in two **canonical living docs** under `.github/skills/rdc-publish-check/templates/`. The git history of those two files is the audit trail for what was submitted when. See step 4.

### 4. Update the canonical submission docs

The two submission docs live at:

- `.github/skills/rdc-publish-check/templates/CHROME_SUBMISSION.md` — every field the Chrome Web Store Developer Console asks for (product details, single purpose, host permission justification, remote code declaration, data-usage checkboxes, privacy policy URL, reviewer testing notes).
- `.github/skills/rdc-publish-check/templates/EDGE_SUBMISSION.md` — equivalent for Microsoft Edge Partner Center, plus an Edge-only **Search terms** section (≤ 7 terms, ≤ 30 chars each, ≤ 21 words total).

Each store-form field has its own fenced code block so the dashboard form takes the text exactly as written.

Before submitting, edit these two files **in place** with the changes for this release. The agent / user **must** review the following items:

#### Always check

- [ ] **`{{VERSION}}` placeholder** — search-and-replace with the new manifest version (`{{VERSION}}` appears in the title and Package section). Two find-replaces total per file.

- [ ] **`{{CHANGELOG}}` placeholder** — replace with the `## [<version>] — <date>` block from `CHANGELOG.md` (Added / Changed / Fixed bullets). If `CHANGELOG.md` is out of date relative to `manifest.json`, fix `CHANGELOG.md` first.

- [ ] **`## Submission notes (edit before submitting)`** at the top of each file. The block is an HTML comment by default. Fill it in if the reviewer needs context that isn't true of every version. Common cases:
  - **Resubmitting after a rejection** — reference the violation code (e.g. "Purple Potassium") and state exactly what changed.
  - **New host permission or `permissions` entry** — call out what was added and why the existing host-permission justification needs to grow.
  - **Visibility / market changes** — moving from Unlisted to Public, expanding markets.
  - **Major UX changes** that aren't obvious from the description text.

  If there's truly nothing submission-specific, **leave the block as an HTML comment** so the doc reads clean (don't delete it — next release will need it again).

- [ ] **Description** (the long marketing copy) — update if a feature added in this version belongs in the listing description. Per [Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements), all functionality must be disclosed to users. If a new feature is significant enough to appear in screenshots, it should appear in the description.

- [ ] **Permission justification** — if `manifest.json` `permissions` or `host_permissions` changed since the previous version, update the justification text. The current state assumes no `permissions`, only `host_permissions: https://github.com/*`. Versions that add permissions need extra justification paragraphs.

- [ ] **Behavior text drift** — sanity-check that what the docs describe still matches the shipping code. Easy regressions: badge wording (e.g. `"N comments"` vs an old `"💬 N comments"`), keyboard shortcut keys, sidebar tab names, button labels. When `CHANGELOG.md` has a "Changed" entry that touches user-visible UI, double-check the relevant description bullets and the reviewer "How to test" section.

- [ ] **Search terms** (Edge only) — only edit if the extension picks up a meaningful new keyword. Enforce the limits: ≤ 7 terms, ≤ 30 chars per term, ≤ 21 words total.

#### Don't usually need to edit

- Title, summary, category, language — set once, don't change.
- Single purpose statement — only changes if the extension scope changes (which would warrant a separate submission anyway).
- Reviewer testing notes ("how to test" block) — the test steps work for every version of the extension. Only update if the install / activation flow changes, or if a behavior bullet ("Hover any paragraph — a blue + appears") no longer matches the UI.
- Privacy policy URL — only changes if PRIVACY.md is updated and the gist is re-published.


### 5. Prepare screenshots for the store listings

Both Chrome Web Store and Edge Add-ons accept screenshots at exactly **1280×800** (or 640×400). Captures from DevTools' "Capture screenshot" on high-DPI displays come out at 2× the viewport size (e.g. 2560×1600), which need to be downscaled before upload.

Workflow:

1. Put your raw captures into `design/screenshots/` (any size — the script auto-detects).
2. Run the resize helper:

   ```powershell
   .\.github\skills\rdc-publish-check\scripts\resize-screenshots.ps1
   ```

   It writes 1280×800 versions to `design/screenshots/1280x800/`. Originals are preserved.

3. Upload the files in `design/screenshots/1280x800/` to both store dashboards. The store-listing image carousel is the order they're uploaded in — pick the strongest hero shot as #1.

The script supports `-Width` / `-Height` (e.g. for the 640×400 option), `-InputDir` (use a different source), and `-Force` (re-overwrite existing output).

> Note: `design/` is in `.gitignore` for the published zip via the preflight forbidden-paths list — none of these screenshots will leak into `rdc-*.zip`.

### 6. Verify the zip contents

The preflight script can also verify an existing zip:

```powershell
.\.github\skills\rdc-publish-check\scripts\preflight.ps1 -VerifyZip .\releases\1.0.0\rdc-1.0.0.zip
```

This checks that:
- Manifest is at the **top level** of the zip (not nested in a folder — Chrome rejects nested manifests).
- All files listed in `manifest.json` `"content_scripts.js"` are present in the zip.
- No development-only files leaked in (`tests/`, `docs/`, `design/`, `test_md_files/`, `package.json`, `node_modules/`, `.git/`, `local-only/`).

### 7. Tag and publish the GitHub Release

Before submitting to the stores, publish a GitHub Release for the version. This:

- Creates a permanent versioned anchor on the repo (`v<version>` tag).
- Gives users a sideload-ready download mirror (helpful for early adopters and anyone who can't / won't install from the stores).
- Attaches a SHA256 checksum so users can verify the zip.
- Uses the matching `## [<version>]` section from `CHANGELOG.md` as the release body — **not** `CHROME_SUBMISSION.md`, which is reviewer-facing form copy, not user-facing release notes.

Run:

```powershell
.\.github\skills\rdc-publish-check\scripts\github-release.ps1
```

The script:

1. Reads version from `manifest.json` and verifies `releases/<version>/rdc-<version>.zip` exists (run `release-prep.ps1` first if missing).
2. Extracts the `## [<version>]` block from `CHANGELOG.md` into `releases/<version>/RELEASE_NOTES.md`. Fails loudly if the entry doesn't exist.
3. Generates a SHA256 of the zip into `releases/<version>/rdc-<version>.zip.sha256`.
4. Creates an annotated git tag `v<version>` (skips if it already exists).
5. Pushes the tag to `origin` (skip with `-SkipPush`).
6. Calls `gh release create` with the zip + checksum attached and the extracted notes as the release body.

Useful flags:

- `-Draft` — create the release as a draft so it's visible only to maintainers until manually published. Recommended if you want one more look at the rendered notes on GitHub before going live.
- `-SkipRelease` — prepare everything locally (notes, checksum, tag) but skip the `gh release create` call. Useful for inspecting `RELEASE_NOTES.md` before publishing.
- `-SkipPush` — don't push the tag (dry run).
- `-Force` — overwrite existing `RELEASE_NOTES.md` / `.sha256` files in the release folder.

**Prerequisite:** `gh auth login` must have completed in this shell against the GitHub account that owns the repo. For this project that's the personal `chienyuanchang` account, not the `_microsoft` EMU account. The script aborts with a clear message if `gh` is not authenticated.

### 8. Submit

Follow [docs/PUBLISHING.md → Chrome Web Store: step-by-step](../../../docs/PUBLISHING.md#chrome-web-store-step-by-step) and [Edge Add-ons: step-by-step](../../../docs/PUBLISHING.md#edge-add-ons-step-by-step).

Reviewer-notes templates are in [PUBLISHING.md → Notes for certification](../../../docs/PUBLISHING.md#notes-for-certification).

## What this skill does NOT do

- **It doesn't auto-bump the version.** Version bumps need a human decision (patch / minor / major). The user should edit `manifest.json` first, then run preflight.
- **It doesn't update CHANGELOG.md.** CHANGELOG entries are user-facing prose — the user writes them. Preflight just warns if the version row is missing.
- **It doesn't upload to the stores.** Submission goes through the Chrome Web Store dashboard and Edge Partner Center — both require interactive sign-in.
- **It doesn't check the listing copy** (description, screenshots) — those live in the dashboards, not the repo.

## Quick reference — what reviewers actually check

From [Chrome Web Store policies — quick reference](../../../docs/PUBLISHING.md#chrome-web-store-policies--quick-reference):

- Every declared permission is used by code in the build (Chrome's [Use of Permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions)).
- `host_permissions` is the narrowest pattern that works.
- Privacy policy URL resolves on the public internet.
- Listing description matches actual behavior.
- No remote-loaded JavaScript ([Code Readability](https://developer.chrome.com/docs/webstore/program-policies/code-readability)).
- Single-purpose declaration matches actual purpose ([Single purpose](https://developer.chrome.com/docs/webstore/program-policies/minimum-functionality)).
- No Google trademarks in the extension name or logo without permission ([Branding Guidelines](https://developer.chrome.com/docs/webstore/branding/)).
