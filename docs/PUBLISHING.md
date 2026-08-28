# Publishing & Distribution

How to ship the separate GitHub and Azure DevOps browser-extension targets. This doc covers distribution options, target-specific prep, store submission, and policy checks.

## Table of Contents

- [Distribution options](#distribution-options)
- [Recommended path for this team](#recommended-path-for-this-team)
- [Pre-publish checklist](#pre-publish-checklist)
- [Marketing copy](#marketing-copy)
- [Chrome Web Store: step-by-step](#chrome-web-store-step-by-step)
- [Edge Add-ons: step-by-step](#edge-add-ons-step-by-step)
- [Permissions justification](#permissions-justification)
- [Chrome Web Store policies — quick reference](#chrome-web-store-policies--quick-reference)
- [Packaging](#packaging)
- [Versioning & releases](#versioning--releases)
- [Post-publish maintenance](#post-publish-maintenance)

---

## Status

| Target | Store | Listing | Status | Version |
|---|---|---|---|---|
| GitHub | Chrome Web Store | <https://chromewebstore.google.com/detail/markdown-pr-comments-for/bdkcmcdfnhonfcpdgcmemkpcmnhnhemj> | Live (Unlisted) | 1.4.0 |
| GitHub | Microsoft Edge Add-ons | <https://microsoftedge.microsoft.com/addons/detail/agomibenjlnikaldoddminkjbokfocgb> | Live (Unlisted) | 1.4.0 |
| Azure DevOps | Chrome Web Store | New listing | Preparing submission | 1.0.0 |
| Azure DevOps | Microsoft Edge Add-ons | New listing | Preparing submission | 1.0.0 |

> The existing GitHub listings are unlisted. The ADO rows are separate new items and receive their own store IDs after approval. Never upload an ADO package as an update to either GitHub listing.

**End-user install guide:** [INSTALL.md](../INSTALL.md).

## Distribution options

| Option | Effort | Cost | Audience reach | Notes |
|---|---|---|---|---|
| **1. Dev-mode (status quo)** | None | Free | Anyone who can run Developer Mode + `git pull` | Current state. Fine for internal/dogfood use. |
| **2. Chrome Web Store** | Medium (icons, screenshots, listing copy, ~1–3 day review) | **$5 one-time** developer fee | All Chromium users (Chrome, Brave, Vivaldi, Opera, Arc, …) | Standard public distribution path. |
| **3. Edge Add-ons** | Medium (same artifacts as Chrome) | **Free** | All Edge users | Slightly slower review (3–7 days). Same zip works as for Chrome. |
| **4. Self-hosted `.crx`** | Low | Free | Only enterprise-managed machines via Group Policy | Chrome blocks public installs from non-store sources since 2018. Skip unless IT is force-installing it. |
| **5. Microsoft 365 / Intune force-install** | Depends on IT | Free if covered by org licensing | Microsoft / Azure employees on managed machines | Requires a Web Store or Edge Add-ons listing as the source. |

### Distribution modes inside the Chrome Web Store

When you submit, pick one:

- **Public** — anyone can find/install via store search
- **Unlisted** — only people with the install link can install (good for a private beta)
- **Private** — restricted to specific Google Workspace accounts (Workspace domains only)
- **Group** — Trusted Tester group, max 100 testers by email

## Recommended path for this team

- **GitHub:** maintain the existing Chrome and Edge listing IDs.
- **Azure DevOps:** submit v1.0.0 as two new hidden/unlisted listings using the ADO package, icon, privacy policy, screenshots, and canonical form copy.
- Switch either ADO listing to public only after approval and a dogfood period.
- Skip self-hosted CRX distribution unless enterprise policy requires it.

## Pre-publish checklist

Order of operations the first time you publish:

- [ ] Bump the selected target's `extensions/<target>/manifest.json` version
- [ ] Confirm `"description"`, `"author"`, `"homepage_url"` are filled in `manifest.json`
- [ ] Target privacy policy reflects current behavior: [PRIVACY.md](../PRIVACY.md) for GitHub or [PRIVACY_ADO.md](../PRIVACY_ADO.md) for Azure DevOps
- [ ] Icons present at the expected sizes — see [Icons](#icons)
- [ ] At least 2 screenshots ready (1280×800 or 640×400) — see [Screenshots](#screenshots)
- [ ] Marketing description finalized — see [Marketing copy](#marketing-copy)
- [ ] All tests pass: `npm test` from the extension root
- [ ] Manual checklist for the target has been walked through; ADO iteration confirmations live in [ADO_ADAPTER_PLAN.md](./ADO_ADAPTER_PLAN.md)
- [ ] Built the publish zip — see [Packaging](#packaging)

### Icons

The Chrome Web Store requires `128×128` PNG at minimum. Recommended set, all placed in `icons/`:

| Size | Used for |
|---|---|
| `icon-16.png` | favicon-style in the extensions list |
| `icon-32.png` | Windows DPI scaling |
| `icon-48.png` | extensions management page |
| `icon-128.png` | Chrome Web Store listing, install prompt |

After adding the files, declare them in `manifest.json`:

```json
"icons": {
  "16": "icons/icon-16.png",
  "32": "icons/icon-32.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png"
}
```

GitHub uses the original dark speech-bubble icon. ADO uses the separate Fluent-blue speech bubble with a white interior and blue `M` plus down arrow. Sources and render tooling live under `design/icon-v2/`; each target's four runtime PNGs live under `extensions/<target>/icons/`.

### Screenshots

The Web Store accepts up to 5 screenshots at **1280×800 or 640×400** (use the higher resolution). Never reuse screenshots across targets when the service chrome differs.

Suggested ADO v1.0.0 set, in order:

1. Changes tab with cards spanning multiple Markdown files.
2. An expanded inline thread showing the reply and Resolve actions.
3. Pull-request-wide Outline with heading navigation and fold controls.
4. An open inline comment editor beside rendered Markdown.
5. The integrated sidebar and thread UI in Azure DevOps dark theme.

Optional store assets:

- **Promo tile (440×280)** — required only for "featured" placement consideration.
- **Marquee (1400×560)** — same, top-of-store carousels.

## Marketing copy

Canonical store-form copy is versioned with the release tooling:

- GitHub: `CHROME_SUBMISSION.md` and `EDGE_SUBMISSION.md`
- Azure DevOps: `CHROME_SUBMISSION_ADO.md` and `EDGE_SUBMISSION_ADO.md`

These documents are the source of truth for titles, summaries, descriptions, disclosures, search terms, reviewer instructions, and the current release notes. Do not improvise shorter copy in a store dashboard without updating the matching canonical document.

## Chrome Web Store: step-by-step

1. **Create a developer account** at <https://chrome.google.com/webstore/devconsole>.
   - Pay the **$5 USD one-time developer fee** (lifetime).
   - Use a Google account you're willing to attach permanently. Transferring extensions between accounts is non-trivial.
2. **Click "New item"** and upload the zip from [Packaging](#packaging).
3. **Fill the listing**: name, short description, long description, category (suggest *Developer Tools*), language, screenshots, store icon (`128×128`).
4. **Privacy & permissions tab**:
   - Single-purpose declaration: paste the short description.
   - Justify each permission — see [Permissions justification](#permissions-justification).
  - Provide the public target privacy URL: [PRIVACY.md](../PRIVACY.md) for GitHub or [PRIVACY_ADO.md](../PRIVACY_ADO.md) for ADO.
   - Confirm no user data is collected, sold, or transferred.
5. **Distribution tab**: pick visibility (Public / Unlisted / Private / Group).
6. **Submit for review.** Reviews typically take 1–3 business days. Common rejection causes:
   - Missing or insufficient privacy policy
   - Permission scope unjustified
   - Description doesn't match behavior
7. **After approval**, install link is `https://chrome.google.com/webstore/detail/<id>`.

## Edge Add-ons: step-by-step

Mostly identical to the Chrome flow, with three differences: **no fee**, **slightly slower review**, **separate dashboard**.

1. **Create a Partner Center account** at <https://partner.microsoft.com/dashboard/microsoftedge>.
   - Free; uses a Microsoft account.
2. **Click "Submit an extension"** and upload the same zip from [Packaging](#packaging).
3. **Fill the listing** — Edge's form accepts the same screenshots, descriptions, and icons as Chrome.
4. **Edge-specific availability tab**: pick markets (default: all), age rating, certification notes if anything looks unusual.
5. **Submit.** Review typically 3–7 business days.

Edge users can also install Chrome Web Store extensions, so a Chrome listing alone reaches both audiences. The benefit of an Edge listing is discoverability for Edge-first users.

## Permissions justification

Both stores require a justification for each requested permission. Use the exact text in the target's canonical submission docs.

### Single-purpose statement

> Add inline review-comment affordances to GitHub Pull Request rich-diff (rendered markdown) views — letting users comment, reply, resolve threads, and collapse sections directly in the rendered view that GitHub itself does not natively support comments on.

### `host_permissions: https://github.com/*` justification

> The extension's entire functionality is to add inline review comments to github.com Pull Request pages. The host permission `https://github.com/*` is required so the content script can:
>
> 1. Read the rendered diff DOM on github.com pull request pages and inject the inline comment / thread UI.
> 2. Make same-origin requests back to github.com — using the user's existing session cookies — to fetch the raw markdown source of files in the PR, fetch existing review threads, post new review comments, reply to threads, and resolve / unresolve threads. These are the same internal endpoints used by GitHub's own web UI.
> 3. Fetch markdown previews (github.com/preview) and @mention suggestions (github.com/suggestions/...).
>
> The extension does not access any other host, does not transmit user data anywhere except back to github.com, and does not contain analytics or telemetry of any kind.

### ADO single-purpose statement

> Add inline review comments and document navigation to rendered Markdown in Azure DevOps pull request Preview mode, so reviewers can comment, manage threads, scan changes, and navigate headings without switching back to source diff.

### ADO host permissions

`https://dev.azure.com/*` covers current Azure DevOps organizations; `https://*.visualstudio.com/*` covers organizations still using legacy URLs. Both are required because the extension runs directly on those pull request pages and performs same-origin REST requests using the existing browser session. It accesses no unrelated host. Full reviewer-ready wording is in the ADO submission docs.

### Remote code use (Chrome Web Store only)

**Answer:** *No, I am not using Remote code.* All JavaScript is bundled in the package (`content.js` + `src/lib/*.js`). No `eval`, no `new Function(string)`, no remotely-hosted scripts. Responses fetched from github.com are parsed as data only — never executed.

### Data usage (Chrome Web Store only)

Check only these two boxes:

- ☑ **Authentication information** — the extension reads the user's existing github.com session cookies and an optional opt-in PAT from `localStorage`. Never transmitted anywhere except back to github.com.
- ☑ **Website content** — the extension reads the content of github.com PR pages (rendered diff DOM, raw markdown source of changed files, existing review threads). Processed locally in the browser.

Tick all three certifications (do-not-sell / do-not-misuse / do-not-use-for-credit-decisions). All three are truthful for this extension.

## Chrome Web Store policies — quick reference

Three documents govern what Google's review team will check on every submission. Read at least the headlines on each before submitting a new version.

| Document | URL | What it covers |
|---|---|---|
| **Branding Guidelines** | <https://developer.chrome.com/docs/webstore/branding/> | What you can / can't say about Google products in your extension name, logo, and description |
| **Program Policies** | <https://developer.chrome.com/docs/webstore/program-policies> | Hub for all reviewer-enforced policies (privacy, permissions, deceptive behavior, quality, MV3 requirements). Sub-policies link from this page. |
| **Developer Agreement (terms)** | <https://developer.chrome.com/docs/webstore/program-policies/terms> | The contract between the developer and Google. Indemnification, takedown rights, automated updates, etc. |

### Branding (most relevant for us)

From [Branding Guidelines](https://developer.chrome.com/docs/webstore/branding/):

- **Don't use any Google trademarks or any confusingly similar marks as the name of your extension or company without written permission from Google.** ("Google", "Chrome", "Chrome Web Store" are all on [Google's trademark list](https://about.google/brand-resource-center/trademark-list/).) Note: "GitHub" is **not** a Google trademark, so this restriction doesn't apply to our current name. GitHub's own trademark guidance is a separate concern — see [README.md → Legal](../README.md#legal).
- **Describing compatibility is fine** with the words *"for"*, *"for use with"*, or *"compatible with"*, with the ™ symbol. Example: *"for Google Chrome™"*.
- **Don't use Google logos as your own logo.** Our speech-bubble icon does not reference Google or Chrome branding — we're clear here.
- **The "Available in the Chrome Web Store" badge** is allowed on our own marketing pages without pre-approval. Rules: don't modify it (other than resize), don't make it the primary element, don't place it on adult / hate / violent content.

### Program Policies (key sections that trip submissions up)

From [Program Policies](https://developer.chrome.com/docs/webstore/program-policies):

- **[Use of Permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions)** — *"Request access to the narrowest permissions necessary to implement your Product's features or services. Don't attempt to 'future proof' your Product by requesting a permission that might benefit services or features that have not yet been implemented."* **This is the policy that rejected 1.0.2** over an unused `activeTab` declaration.
- **[Single purpose](https://developer.chrome.com/docs/webstore/program-policies/minimum-functionality)** — every extension must have one clear, narrowly-defined purpose. Ours: inline review comments on GitHub PR rich-diff. Don't let scope creep into unrelated areas (e.g. issue tracking, profile editing) without a separate submission.
- **[Privacy Policy](https://developer.chrome.com/docs/webstore/program-policies/privacy)** — required if your extension handles any user data. Our [PRIVACY.md](../PRIVACY.md) (mirrored as a public gist) covers this.
- **[Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)** — data collected can only be used for the user-facing feature; no resale, no off-product ads. We collect no data, so this is trivially satisfied.
- **[Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)** — all functionality must be disclosed in the listing description. Anything the extension does that a user wouldn't infer from the screenshots needs to be in the description.
- **[Code Readability / no remote code](https://developer.chrome.com/docs/webstore/program-policies/code-readability)** — all JS must be in the package, not loaded from a remote URL. We comply — every `.js` file is in the zip.
- **[Manifest V3 Requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)** — new extensions must be MV3. We are MV3 (see `manifest.json` line 2).

### Developer Agreement (terms)

From [Developer Agreement](https://developer.chrome.com/docs/webstore/program-policies/terms):

- **§4.4.1(1)** — *"You agree that you will not engage in any activity with the Web Store … that knowingly violates a third party's terms of service."* This is the clause your reviewer was implicitly worried about regarding our use of GitHub's internal endpoints. Not currently a documented violation (see [README.md → Legal](../README.md#legal) for our reasoning), but worth noting that Google explicitly reserves the right to act on third-party ToS violations.
- **§4.4.2** — accessing the Web Store "by any means other than through the interface" is forbidden (don't try to automate the dev console).
- **§6.2** — using Google Brand Features (Chrome, Chrome Web Store, Google) is governed by the [Brand Guidelines](https://developer.chrome.com/docs/webstore/branding/). One-time license granted only for marketing purposes.
- **§7.2** — Google can pull the extension at any time for any of: IP violation, applicable law violation, malware/spyware, ToS violation, or "may create liability for Google or any third party". Practical implication: trademark complaints from third parties (e.g. GitHub) can lead to a takedown without warning.
- **§7.3** — uploaded updates are auto-pushed to existing users within hours. There's no per-update consent unless permissions change.
- **§13** — developer indemnifies Google for any claim arising from the extension. Pair with the §7.2 takedown right and the practical risk is: if a third party complains, the extension comes down and the developer eats the legal cost.

### Pre-submission checklist (policy lens)

Before every submission, verify:

- [ ] **Every permission in `manifest.json` is used by code in this exact build.** Grep for `chrome.<api>` matching each declared permission. Unused permission = automatic rejection.
- [ ] **`host_permissions` is the narrowest pattern that still works.** GitHub permits only `github.com`; ADO permits current `dev.azure.com` and legacy `*.visualstudio.com`. Never combine both services in one target manifest.
- [ ] **Privacy policy URL resolves on the public internet.** Reviewer 404s on internal URLs.
- [ ] **Listing description matches actual behavior.** No "coming soon" features, no features that require a hidden settings page.
- [ ] **No remote-loaded JavaScript.** Everything `.js` ships in the zip.
- [ ] **Single-purpose declaration matches the actual single purpose.** If you've added a feature outside that purpose since the last submission, reconsider whether it belongs.
- [ ] **No Google trademarks in the extension name or logo** (without written permission). "for Google Chrome™" in descriptions is fine.

## Packaging

Build the publishable zip from the repo root. The store wants the manifest at the **top level** of the zip, so don't include the parent folder.

Target-safe commands:

```powershell
.\scripts\package.ps1 -Target github  # rdc-<version>.zip
.\scripts\package.ps1 -Target ado     # rdc-ado-<version>.zip
```

ADO uses a target-qualified filename and `releases/ado/<version>/` so its first
`1.0.0` cannot overwrite or conflict with GitHub's independent `1.0.0` history.

**Files to include:**

- `manifest.json`
- `content.js`
- `styles.css`
- `src/lib/*.js`
- `src/adapters/ado.js` for ADO
- `icons/*`
- packaged `PRIVACY.md` (sourced from root `PRIVACY_ADO.md` for ADO)

**Files to exclude:**

- `tests/`, `package.json`, `node_modules/` (Node test-runner stuff, not used at runtime)
- `docs/`, `test_md_files/` (development-only)
- `.gitignore`, `.git/`, any local-only files

Do not hand-build or hand-edit the zip. The checked-in packager synchronizes shared source and the correct privacy policy before compression.

After release prep, verify the selected target package:

```powershell
.\.github\skills\rdc-publish-check\scripts\preflight.ps1 -Target ado -VerifyZip .\releases\ado\1.0.0\rdc-ado-1.0.0.zip
```

Verification checks the packaged target identity and hosts, top-level manifest, declared scripts/styles/icons, privacy policy, and absence of development-only files.

## Versioning & releases

Use semver in `manifest.json`. The Web Store enforces a monotonically increasing version — you cannot re-upload the same version number, even to fix a typo in the listing.

Suggested release flow:

1. Select one target; never release both implicitly.
2. Bump `extensions/<target>/manifest.json`.
3. Update [FEATURES.md](./FEATURES.md) when needed and the target changelog.
4. Run target preflight, all browser tests relevant to changed DOM behavior, and manual validation.
5. Run target release prep and zip verification.
6. Commit and push the tested state.
7. Tag with `v<version>` for GitHub or `ado-v<version>` for ADO only after publication approval.
8. Upload the target zip to its own Chrome/Edge listing.

## Notes for certification

Paste reviewer notes from the target's canonical Chrome or Edge submission document. The ADO documents point reviewers to the stable sandbox pull request and explain Preview activation, read-only testing, write permissions, same-origin session authentication, theme testing, and keyboard navigation.

## Gotchas we hit during submission

Documented for next time:

- **Privacy policy URL must be a public HTTPS URL.** GitHub listings use <https://github.com/chienyuanchang/rich-diff-comments/blob/main/PRIVACY.md>; ADO listings use <https://github.com/chienyuanchang/rich-diff-comments/blob/main/PRIVACY_ADO.md>. Never cross-link them.
- **Edge listings cannot be edited in place.** Every change (markets, description, screenshots, anything) creates a new draft submission against the live version. Listing-only edits do **not** require a version bump — you can resubmit with the same `manifest.json` version, as long as the package zip itself hasn't changed. Bump the version only when shipping code/manifest changes.
- **Author field is publicly displayed.** Whatever you put in `manifest.json` `"author"` shows on the store listing. Use a personal handle or the developer name you want attached to the published extension; the value is hard to change later without resubmitting under a different identity.
- **`homepage_url` 404s break review.** Reviewers click through `homepage_url` to verify the developer. Point it at the public source repository (currently <https://github.com/chienyuanchang/rich-diff-comments>) or the store listing URL. Don't point at private / internal pages.
- **Edge market scope matters.** Initial submission defaulted to US-only to keep it simple; expanded to all markets in a listing-only edit (no new package needed).
- **Screenshot aspect ratio:** Edge accepts 1280×800 *or* 640×400. If your source screenshot is a different aspect (e.g. ~1:1), pad with a solid background instead of stretching — stretching will visibly distort UI elements and may be flagged by reviewers.
- **Unlisted (Chrome) / Hidden (Edge) visibility.** Both terms mean the same thing: anyone with the listing URL can install, but it doesn't appear in store search. Good for an initial dogfood phase. Switching to Public is a listing-only edit later. Our Chrome listing is Unlisted; our Edge listing is Hidden.
- **A rejected version number is consumed.** When 1.0.2 was rejected on 2026-05-18 for an unused `activeTab` permission ([Use of Permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions) policy), we could not resubmit a fixed zip under `"version": "1.0.2"` — the developer console rejects re-uploads of any previously-uploaded version regardless of whether it went live. The rule comes from the [Chrome Extensions manifest version field](https://developer.chrome.com/docs/extensions/reference/manifest/version) (*"Each version, including each updated version, must be a higher number than the previous version"*) and is enforced at upload time. Fix: bump to 1.0.3 and resubmit.
- **"Future-proofing" permissions is an automatic rejection.** The Chrome Web Store reviewer team scans the package for `chrome.*` API calls matching each declared permission. Permissions without matching code are flagged immediately under the [Use of Permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions) policy. Audit `manifest.json` against the actual code before every submission. Edge does not enforce this as aggressively as Chrome, but the principle is the same.

## Post-publish maintenance

- **Auto-updates** — both stores deliver updates within a few hours of approval. Users don't need to do anything.
- **Crash reports / reviews** — both stores expose user reviews and crash counts in the developer dashboard. Check weekly.
- **Permission changes** — adding or broadening permissions usually triggers a re-review and the extension may be paused on user machines until they consent.
- **Manifest V3 deprecations** — Google occasionally retires manifest features. Worth checking [the migration page](https://developer.chrome.com/docs/extensions/develop/migrate) annually.

## Things to NOT do

- ❌ Add analytics or telemetry without updating the privacy policy + re-submitting for review.
- ❌ Broaden either target's `host_permissions`, or combine GitHub and ADO hosts in one package, without a strong justification and separate review.
- ❌ Bundle a Personal Access Token in the published code (it would be public and the token would be revoked within hours by GitHub's secret scanning).
- ❌ Republish a previously-rejected build under a different name to circumvent review. Both stores ban this.
