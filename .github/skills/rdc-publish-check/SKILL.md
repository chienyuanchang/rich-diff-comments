---
description: Pre-publish audit and packaging for the separate GitHub and Azure DevOps Markdown PR Comments extensions. Use when preparing a target for Chrome Web Store or Microsoft Edge Add-ons submission—audits policy-sensitive permissions, files, versions, and packages a collision-safe release zip.
---

# Pre-publish check & package the extension

This skill prepares either **Markdown PR Comments for GitHub** or **Markdown PR Comments for Azure DevOps** for submission to the Chrome Web Store and / or Microsoft Edge Add-ons. Always keep the targets separate: manifests, privacy policies, changelogs, zips, release folders, store listings, and git tags are target-specific.

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

## CHANGELOG / release-notes writing rules

> **⚠️ CHANGELOG, README "What's new" blocks, and submission-template release notes are user-facing, not engineering notes.** Every bullet must read like a feature announcement to someone who has never opened the source code.
>
> Applies to **every** doc that ships release notes:
>
> - [CHANGELOG.md](../../../CHANGELOG.md) for GitHub or [CHANGELOG_ADO.md](../../../CHANGELOG_ADO.md) for Azure DevOps (the target's source of truth)
> - The `🆕 What's new in v...` lead block at the top of the Description in the target's Chrome and Edge submission templates
> - The `## What's new in this version` section at the bottom of each submission template
> - Any new-feature mention in [README.md](../../../README.md)
>
> **Forbidden:** internal class names (`.prose-diff`, `.added`, `<ins>`), CSS variable names (`--fgColor-accent`), file or function names (`siblingAnchor`, `routeData.diffSummaries`), URL paths (`/changes`, `/files`), pixel measurements, JS API hints (`localStorage` keys, event listeners), DOM-shape detail ("2-column key/value table vs wide table"), specific source line numbers from a bug repro file, and "we did X via Y" implementation talk.
>
> **Required:** describe what the user sees, when they'd notice it, and why it's better. Use product names ("the threads sidebar", "the Outline tab", "the Files-changed page") not selectors. Keep entries to 1–3 sentences — longer prose is a smell that you're explaining the mechanism instead of the change.
>
> **Examples of the right level:**
>
> - ❌ *"Bound `bindSidebarResizeClamp` IIFE on `window.resize` to call `clampDragPos` with `{dx:0,dy:0}`."*
> - ✅ *"The sidebar can no longer get stranded offscreen after a window resize."*
>
> - ❌ *"GitHub renders frontmatter as a 2-column table; long values used to substring-match body content downstream, pushing the H1 to line ~85."*
> - ✅ *"Comments on Markdown files that start with YAML frontmatter no longer land at the bottom of the file."*
>
> Implementation detail belongs in [docs/DEV_NOTES.md](../../../docs/DEV_NOTES.md) (engineer-facing) and the per-change comment block in `content.js` — keep CHANGELOG, README, and submission "What's new" blocks clean.
>
> **When in doubt**: write the entry, then ask "would a non-developer Chrome extension user understand what changed for them?" If no, rewrite.

## Workflow

### 1. Run the preflight script

From the repository root:

```powershell
.\.github\skills\rdc-publish-check\scripts\preflight.ps1 -Target github
.\.github\skills\rdc-publish-check\scripts\preflight.ps1 -Target ado
```

Or with verbose output:

```powershell
.\.github\skills\rdc-publish-check\scripts\preflight.ps1 -Target ado -Verbose
```

The script:

1. **Reads `manifest.json`** and prints version + declared permissions.
2. **Audits every `permissions` entry** against the codebase — greps for matching `chrome.<api>` calls. Any declared-but-unused permission fails the check (this is the rule that rejected 1.0.2).
3. **Audits `host_permissions`** to confirm at least one `fetch()` / `XMLHttpRequest` call targets a matching URL.
4. **Verifies required files** are present at expected paths (`content.js`, all `src/lib/*.js` declared in manifest, `styles.css`, `PRIVACY.md`, all four icon PNGs).
5. **Runs the test suite** (`node --test tests/*.test.js`) and fails if any tests fail.
6. **Checks the version hasn't shipped yet** — compares against git tags and the live version recorded in `docs/PUBLISHING.md`'s status table. Warns if the manifest version is `<=` the last shipped version (this would be rejected on upload).
7. **Confirms the target changelog has a matching version entry**: `CHANGELOG.md` for GitHub or `CHANGELOG_ADO.md` for Azure DevOps. Missing entry = warning.

If everything passes, the script reports `READY TO PACKAGE` and exits 0. If any check fails, it reports the issue and exits non-zero.

### 2. Build the publish zip

If preflight passes, run the packager:

```powershell
.\scripts\package.ps1                # defaults to -Target github
.\scripts\package.ps1 -Target github  # explicit
.\scripts\package.ps1 -Target ado     # separate ADO package
```

The packager runs `scripts/dev-sync.ps1` first, then zips only the target folder. Shared helpers are mirrored into both targets. GitHub receives root `PRIVACY.md`; ADO receives root `PRIVACY_ADO.md` under the packaged name `PRIVACY.md`. Outputs are `rdc-<version>.zip` for GitHub and `rdc-ado-<version>.zip` for ADO.

### 3. Prepare the release folder (zip only)

Organize the zip into a per-version release folder:

```powershell
.\.github\skills\rdc-publish-check\scripts\release-prep.ps1 -Target github
.\.github\skills\rdc-publish-check\scripts\release-prep.ps1 -Target ado
```

This:

1. Reads the version from `extensions/<target>/manifest.json`.
2. Creates `releases/<version>/` for GitHub or `releases/ado/<version>/` for ADO. If the folder already exists, pass `-Force` to overwrite.
3. Builds the zip via `package.ps1` (skippable with `-SkipBuild` if a zip already exists at the extension root) and **moves** the zip into the release folder.

Final folder layouts:

```
releases/
├── 1.4.0/
│   └── rdc-1.4.0.zip
└── ado/
  └── 1.0.0/
    └── rdc-ado-1.0.0.zip
```

> **Submission copy is not emitted per release.** Titles, descriptions, justifications, reviewer notes, search terms, and the "What's new" block are maintained directly in two **canonical living docs** under `.github/skills/rdc-publish-check/templates/`. The git history of those two files is the audit trail for what was submitted when. See step 4.

### 4. Update the canonical submission docs

Each target has two submission docs:

- GitHub: `CHROME_SUBMISSION.md` and `EDGE_SUBMISSION.md`.
- Azure DevOps: `CHROME_SUBMISSION_ADO.md` and `EDGE_SUBMISSION_ADO.md`.

The Chrome document covers product details, single purpose, host-permission justification, remote-code declaration, data usage, privacy, and reviewer notes. The Edge document contains equivalent fields plus **Search terms** (≤ 7 terms, ≤ 30 chars each, ≤ 21 words total).

Each store-form field has its own fenced code block so the dashboard form takes the text exactly as written.

Before submitting, edit these two files **in place** with the changes for this release. The agent / user **must** review the following items:

#### Always check

- [ ] **`{{VERSION}}` placeholder** — search-and-replace with the new manifest version (`{{VERSION}}` appears in the title and Package section). Two find-replaces total per file.

- [ ] **`## What's new in this version` section at the bottom** — replace with up to the **latest 3 versions** from the target changelog, newest first, each under an `### v<version> — <date>` subheading followed by `#### Added` / `#### Changed` / `#### Fixed` blocks. A target with fewer than three public releases lists only those available.

  Why three versions, not one: the store's "What's new" field is the only per-release surface the dashboard shows, but **users who skip a release or two only ever see the most recent submission's `What's new`** — so collapsing the last few releases here ensures someone auto-updating from v1.3.0 → v1.5.0 isn't missing v1.4.0's changes. Three is the sweet spot: enough recent history for users who skip a release, short enough that reviewers don't have to scroll past every change since v1.0.0.

  Trim per-bullet detail where it's safe to do so—keep the headline sentence and drop engineering rationale retained in the target changelog.

  If the target changelog is out of date relative to its manifest, fix the changelog first.

  See [CHANGELOG / release-notes writing rules](#changelog--release-notes-writing-rules) above — same rules apply here.

- [ ] **`## Submission notes (edit before submitting)`** at the top of each file. The block is an HTML comment by default. Fill it in if the reviewer needs context that isn't true of every version. Common cases:
  - **Resubmitting after a rejection** — reference the violation code (e.g. "Purple Potassium") and state exactly what changed.
  - **New host permission or `permissions` entry** — call out what was added and why the existing host-permission justification needs to grow.
  - **Visibility / market changes** — moving from Unlisted to Public, expanding markets.
  - **Major UX changes** that aren't obvious from the description text.

  If there's truly nothing submission-specific, **leave the block as an HTML comment** so the doc reads clean (don't delete it — next release will need it again).

- [ ] **Description** (the long marketing copy) — update if a feature added in this version belongs in the listing description. Per [Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements), all functionality must be disclosed to users. If a new feature is significant enough to appear in screenshots, it should appear in the description.

- [ ] **"What's new in recent releases" lead block at the TOP of the Description**—every release must rotate this block so it shows up to the **latest 3 versions** from the target changelog, newest first, each under a `vX.Y.Z (YYYY-MM-DD)` sub-header.
  - Existing users who auto-update only see the **store listing description**, not the changelog or release notes — so the "What's new" block at the top of the description is the only place they'll learn what changed.
  - Putting it **first** (before the evergreen "GitHub's Files changed rich-diff…" pitch) means returning visitors immediately see the new value without having to re-read the full description.
  - Showing **3 versions** (not just the current one) catches users who skip a release: someone auto-updating from v1.3.0 → v1.5.0 still sees v1.4.0's changes here. Same reasoning as the bottom "What's new in this version" section, just in shorter form.
  - Keep it short—**1–2 bullets per version, 4–6 total**, one line each, in the same user-facing voice as the target changelog.
  - Pull bullets from the target changelog's `Added` / `Changed` / `Fixed` entries, choosing the most user-visible items.
  - **Include the release date in each sub-header** in the form `vX.Y.Z (YYYY-MM-DD)`; it must match the target changelog.
  - **⚠️ Don't delete the `📌 Just installed?` line that sits right below the "What's new" block.** It's evergreen (same text every release, only the per-store verb changes — *"clicked Add to Chrome"* in `CHROME_SUBMISSION.md`, *"clicked Get"* in `EDGE_SUBMISSION.md`) and lives next to "What's new" deliberately so returning users who scan only the top of the listing see the hard-refresh reminder when they auto-update. When you rotate the "What's new" block, scope your edit to the version groups only — leave the `📌` line untouched.

- [ ] **Permission justification** — if target `permissions` or `host_permissions` changed since the previous version, update the justification text. GitHub uses `https://github.com/*`; ADO uses current `https://dev.azure.com/*` and legacy `https://*.visualstudio.com/*` origins. Neither target currently declares Chrome API `permissions`.

- [ ] **Behavior text drift**—sanity-check that the target docs still match shipping code: badge wording, keyboard shortcuts, sidebar tab names, and button labels. When the target changelog changes visible UI, recheck the description and reviewer test steps.

- [ ] **Search terms** (Edge only) — only edit if the extension picks up a meaningful new keyword. Enforce the limits: ≤ 7 terms, ≤ 30 chars per term, ≤ 21 words total.

#### Don't usually need to edit

- Title, summary, category, language — set once, don't change.
- Single purpose statement — only changes if the extension scope changes (which would warrant a separate submission anyway).
- Reviewer testing notes ("how to test" block) — the test steps work for every version of the extension. Only update if the install / activation flow changes, or if a behavior bullet ("Hover any paragraph — a blue + appears") no longer matches the UI.
- Privacy policy URL—GitHub uses public `PRIVACY.md`; ADO uses public `PRIVACY_ADO.md`.
- **Open-source GitHub repo line** (`Open source on GitHub: …`) right before the legal disclaimer — present because the Chrome Web Store listing **does NOT render the Website / Homepage URL form field as a visible link** (only Support URL and Privacy Policy URL show up as clickable buttons). Without this line, users browsing the listing can reach `/issues` but have no path back to the repo home, README, or roadmap. Keep it as one short line; if it grows, Chrome's "promotional content" policy may flag it.


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
.\.github\skills\rdc-publish-check\scripts\preflight.ps1 -Target github -VerifyZip .\releases\1.4.0\rdc-1.4.0.zip
.\.github\skills\rdc-publish-check\scripts\preflight.ps1 -Target ado -VerifyZip .\releases\ado\1.0.0\rdc-ado-1.0.0.zip
```

This checks that:
- Manifest is at the **top level** of the zip (not nested in a folder — Chrome rejects nested manifests).
- Packaged name, version, and host permissions match the selected target manifest.
- All manifest-declared scripts, styles, and icons plus the target privacy policy are present.
- No development-only files leaked in (`tests/`, `docs/`, `design/`, `test_md_files/`, `package.json`, `node_modules/`, `.git/`, `local-only/`).

### 7. Tag and publish the GitHub Release

Before submitting to the stores, publish a GitHub Release for the version. This:

- Creates a permanent target-safe anchor: `v<version>` for GitHub or `ado-v<version>` for ADO.
- Gives users a sideload-ready download mirror (helpful for early adopters and anyone who can't / won't install from the stores).
- Attaches a SHA256 checksum so users can verify the zip.
- Uses the matching section from the target changelog as the release body—not a reviewer-facing submission template.

Run:

```powershell
.\.github\skills\rdc-publish-check\scripts\github-release.ps1 -Target github
.\.github\skills\rdc-publish-check\scripts\github-release.ps1 -Target ado
```

The script:

1. Reads the selected target manifest and verifies its target-specific release zip exists.
2. Extracts the matching block from `CHANGELOG.md` or `CHANGELOG_ADO.md` into the target release folder's `RELEASE_NOTES.md`.
3. Generates a SHA256 beside the target zip.
4. Creates an annotated `v<version>` or `ado-v<version>` git tag (skips if it already exists).
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
- **It doesn't update the target changelog.** Entries are user-facing prose; preflight only warns if the version row is missing.
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
