# Balance Status And Release Implementation Plan

## Goal

Implement the approved design in `docs/aegis/specs/2026-08-23-balance-status-release-design.md`: make the default provider visible in new conversations, preserve status-bar controls during continuous output, add side-effect-free testing for an unsaved provider form, and establish validated `vX.Y.Z` GitHub Releases for the published `dsh-balance-quota` package.

## Architecture

- Host owner: `packages/dsh-balance/lib/host/index.js`
  - Owns persistent `defaultProviderId`, provider validation, credentials, formal cache, and HTTP routes.
- Client owner: `packages/dsh-balance/lib/client/client.js`
  - Owns session-local selection, status-bar/menu interaction, request freshness, and settings UI.
- Release owner: root scripts, package manifests/changelogs, and `.github/workflows/`.
- Legacy package copies remain compatibility baselines until reference analysis proves they are not used by the release/install path.

## Tech Stack

- Node.js `>=22`, ESM JavaScript
- pnpm workspace
- Node built-in test runner
- DSH Cordis Host/Client plugin APIs
- GitHub Actions and GitHub Release API
- CodeGraph for local symbol/call-path retrieval; `.codegraph/codegraph.db` stays untracked

## Baseline / Authority Refs

- Product/design authority: `docs/aegis/specs/2026-08-23-balance-status-release-design.md`
- Initial dual baseline: `docs/aegis/baseline/2026-08-23-initial-baseline.md`
- Governance: `docs/aegis/BASELINE-GOVERNANCE.md`
- Runtime owners: `packages/dsh-balance/lib/host/index.js`, `packages/dsh-balance/lib/client/client.js`
- Existing regression entry: `packages/dsh-balance/test/security.test.js`
- Verification entry points: `package.json`, `scripts/check.mjs`, `scripts/pack-check.mjs`

BaselineUsageDraft:
- Required baseline refs: approved design spec, initial dual baseline, runtime owners, package verification scripts
- Delivered context refs: CodeGraph status/explore results and current Git history
- Acknowledged before plan refs: Host/Client ownership, config/cache/credentials boundaries, release package boundary
- Cited in plan refs: all refs listed above
- Missing refs: no prior ADR or release workflow exists
- Decision: continue

## Compatibility Boundary

- Read existing configs without `defaultProviderId`; treat absent/invalid defaults as fallback conditions.
- Manual conversation selection always overrides the global default and never writes it.
- Keep DSH credentials as the only credential store; never return API keys.
- Keep public HTTPS, DNS revalidation/pinning, response-size, header, path-expression, timeout, and cache semantics unchanged except for explicit draft-test cache bypass.
- Keep status-bar toggle, route bindings, official presets, and existing package checks working.
- Do not publish or independently tag `dsh-host-balance`, `dsh-client-balance`, or `dsh-bundle-balance`.
- Do not commit `.codegraph/codegraph.db`.

## TDD Route

- Mode: `off`
- Decision: `skipped`
- Strict authority: `not applicable`
- Test posture: focused post-change regression plus pure helper tests where practical
- Reason: the user approved behavior-first design but did not request strict test-first TDD.
- Verification: run focused Node tests after each slice and full `pnpm verify` before handoff.

## Scope Check

Facts:
- `refreshBar` and `renderBar` currently rebuild summary children after async work.
- Host `query` writes the formal cache and `summary` reads persisted provider config.
- There are no existing tags or GitHub workflows.

Assumptions:
- The published unified package is the active runtime path; legacy copies require reference verification before any sync.
- GitHub repository credentials are available to Actions for creating Releases.

Unknowns to verify during implementation:
- Whether any local install or compatibility script directly loads legacy package copies.
- Exact repository-supported GitHub Action versions and permissions for release creation.

Requirement Ready Check:
- Requirement source refs: approved design spec and confirmed user choices
- Goals and scope refs: spec sections 1, 2, 7
- User / scenario refs: spec sections 4.1-4.4
- Requirement item refs: spec section 2
- Acceptance / verification criteria refs: spec section 6
- Open blocker questions: none
- Decision: ready

## Change Necessity

- User-visible need: new conversations currently do not reliably show the intended provider, continuous output can invalidate controls, settings cannot verify an unsaved provider, and releases lack traceable automation.
- No-change / non-code option: documentation alone cannot alter runtime selection, request freshness, or draft-query side effects; a release-only document cannot validate tags.
- Why code change is necessary: the behavior is owned by existing Host/Client runtime paths and requires a new explicit test action.
- Minimum change boundary: main package Host/Client, focused tests, root/package metadata and changelogs, verification scripts, and GitHub workflows.
- Decision: code-change

## Existence Check

- Proposed default field: existing Host config/preferences owner is sufficient; decision `reuse-existing`.
- Proposed draft-test action: existing summary route reads formal config and writes cache, so a separate test action with a shared side-effect-free query core is justified; decision `add-with-proof`.
- Proposed release workflow: no current workflow exists, and tag validation/release creation requires one; decision `add-with-proof`.
- Proposed new owner: none; new routes and workflow remain under existing Host/release owners.

## Architecture Integrity Lens

- Invariant: persistent defaults, session overrides, formal cache, and draft tests have distinct ownership and side-effect boundaries.
- Canonical owner/contract: Host config and test route; Client session/status bar; root package/release workflow.
- Responsibility overlap: legacy copies duplicate runtime code; do not create another active owner. Verify their use and keep them as baselines unless evidence requires mechanical compatibility sync.
- Higher-level simplification: extract one internal no-cache query/parse function and let formal query wrap it with cache behavior; do not duplicate HTTP parsing in the test route.
- Retirement/falsifier: if legacy packages are not referenced by install/bundle paths, document them as regression baselines; if referenced, sync only the minimum compatibility behavior and record the reason.
- Verdict: proceed with existing owners and explicit compatibility verification.

## Plan-Time Complexity Check

Complexity Budget:
- Artifact class: core runtime owner plus distribution workflow
- Target files/artifacts: two large generated-style JavaScript bundles, one test file, root/package metadata, two changelogs, workflow files, verification scripts
- Current pressure: Client and Host implementations are dense one-line/generated bundle files; runtime behavior has little direct test coverage; release automation is absent
- Projected post-change pressure: at risk if all behavior is added inline without pure helpers or focused tests
- Budget result: `at-risk`
- Planned governance: keep changes in existing owners, extract only pure selection/request helpers needed for testability, add targeted tests and metadata validators, do not refactor unrelated legacy code

Plan-Time Complexity Check:
- Target files: `packages/dsh-balance/lib/host/index.js`, `packages/dsh-balance/lib/client/client.js`, `packages/dsh-balance/test/*.test.js`, `scripts/check.mjs`, `scripts/pack-check.mjs`, `.github/workflows/*.yml`, changelogs/manifests
- Existing size/shape signals: client bundle contains inline DOM rendering and settings React component; host contains inline routes and request logic
- Owner fit: all requested runtime changes fit existing owners
- Add-in-place risk: stale DOM and request race fixes can become harder to verify if mixed into unrelated rendering changes
- Better file boundary: add small pure functions and shared internal query options; keep visible behavior changes isolated by task
- Recommendation: `edit-in-place` for existing owners, `extract helper` only for side-effect-free query and provider-selection logic, add workflow as a separate distribution artifact

## Tasks

### Task 1: Add default provider configuration and new-conversation resolution

Files:
- Modify `packages/dsh-balance/lib/host/index.js`
- Modify `packages/dsh-balance/lib/client/client.js`
- Modify `packages/dsh-balance/test/security.test.js` or add `packages/dsh-balance/test/preferences.test.js`
- Update `README.md`, `README.zh-CN.md`, and `packages/dsh-balance/README.md`

Why:
- New conversations need a deterministic provider before their first model request, while session overrides must remain local.

Change Necessity:
- A documentation/config-only change cannot make the Client read and apply a persisted default. The minimum runtime boundary is the existing Host preferences route, config loader, Client selection resolver, and settings control.

Impact/Compatibility:
- Add optional `defaultProviderId` to `DEFAULT_CONFIG` and preferences handling.
- Accept only an existing provider ID or null/empty value; never persist an invalid ID.
- Resolve selection as session override, global default, first configured provider, empty state.
- When a default provider is deleted, clear it or normalize it during the same serialized mutation.
- Keep old configs valid.

Steps:
1. Add a pure provider-selection helper or equivalent local logic with explicit precedence and write tests for session override, valid default, missing default, invalid default, and empty provider lists.
2. Extend preferences input handling to persist `defaultProviderId` only when it is null/empty or matches a configured provider.
3. Add the settings selector and save behavior without changing conversation selection storage.
4. Update `syncSession`/`refreshBar` to use the global default when the current session has no manual selection, including the no-message new-session state.
5. Add documentation for default selection and the precedence rules.
6. Run `node --test packages/dsh-balance/test/preferences.test.js packages/dsh-balance/test/security.test.js` (or the final focused test paths) and `pnpm check`.

Repair Track:
- Root cause: the current resolver falls directly from session selection to the first provider and has no persisted default contract.
- Canonical repair: Host owns the field; Client consumes it as the second selection priority.
- Verification: pure precedence tests plus route/config behavior tests.

Retirement Track:
- Old first-provider fallback remains as an intentional compatibility fallback when no valid default exists.
- Removal trigger: only after config migration guarantees a valid default or product requirements explicitly remove fallback behavior.

### Task 2: Stabilize status-bar controls and stale async results

Files:
- Modify `packages/dsh-balance/lib/client/client.js`
- Add or modify `packages/dsh-balance/test/status-bar.test.js`
- Use CodeGraph `explore`/`impact` on `refreshBar`, `renderBar`, `syncSession`, and `notifyDock` before editing

Why:
- Continuous output currently overlaps with async refreshes and dock redraws; replacing interactive children can make menu and refresh clicks appear dead, while late results can restore stale provider data.

Change Necessity:
- The failure is in Client lifecycle and async state; no CSS or documentation-only fix can preserve event handlers and ordering. The minimum boundary is request freshness state plus stable status-bar interaction updates.

Impact/Compatibility:
- Keep the existing dock slot and status-bar visual contract.
- Add request generation/current-provider guards.
- On menu selection, update state and render the selected provider before awaiting its summary.
- On refresh, capture provider ID and generation; only apply the result if still current.
- Keep menu openability independent from refresh loading.
- Ensure failure clears loading state and leaves controls usable.

Steps:
1. Add a small pure freshness/selection decision helper if needed and tests covering old response after new selection, old response after session switch, and refresh failure recovery.
2. Introduce request generation state in the Client module and increment it for session changes, provider switches, and refresh requests.
3. Refactor `renderBar` so the stable status root/menu ownership is preserved and the refresh handler targets the provider ID captured at click time.
4. Make provider switching update the visible selection immediately, then query asynchronously with freshness checks.
5. Make manual refresh disable only its button while allowing provider menu interaction.
6. Run focused status-bar tests and the existing package tests, then `pnpm check`.

Repair Track:
- Root cause: asynchronous `refreshBar` completion rebuilds interactive children and lacks a stale-response guard.
- Canonical repair: Client request-generation state is the sole freshness owner.
- Verification: deterministic helper tests plus static checks over the generated client bundle and focused runtime tests where available.

Retirement Track:
- Remove any obsolete whole-bar replacement or caller-side stale-result fallback introduced during repair.
- Do not add a second status-bar implementation in a legacy package without confirming its runtime use.

### Task 3: Add side-effect-free provider draft testing

Files:
- Modify `packages/dsh-balance/lib/host/index.js`
- Modify `packages/dsh-balance/lib/client/client.js`
- Add `packages/dsh-balance/test/provider-test.test.js`
- Update `scripts/check.mjs` if route/contract checks belong there
- Update package README files with test behavior

Why:
- Users need to verify an unsaved endpoint, JSON path, credential, and conversion configuration before saving it.

Change Necessity:
- The existing summary route always loads formal config and the query path writes the formal cache; a distinct test action and an explicit no-cache query option are required to meet the approved isolation contract.

Impact/Compatibility:
- Add `POST /dsh-balance-quota/provider/test` under the existing Host route owner.
- Validate the draft using existing security rules.
- Resolve an existing stored credential when the draft identifies an existing provider and has no API key; never persist a draft API key.
- Refactor query/parse internals so test mode bypasses cache writes while formal summary retains current caching.
- Return redacted result/error only.
- Add settings button states; successful test does not call save, update status bar, or update formal cache.

Steps:
1. Extract the minimum internal request/parse function that accepts a cache-write option; preserve the current formal query path as the cache-enabled caller.
2. Add the Host test route and ensure it validates draft identity/path/endpoint/headers before network access.
3. Add focused tests using a controlled request seam or pure parser/query helper to prove success, validation failure, missing credential, no config write, and no formal cache write.
4. Add the Client settings test button with loading/success/error state and draft payload conversion matching the save form.
5. Run `node --test packages/dsh-balance/test/provider-test.test.js packages/dsh-balance/test/security.test.js`, `pnpm check`, and `pnpm pack:check`.

Repair Track:
- Root cause: formal summary is the only query path and couples provider config loading with cache writes.
- Canonical repair: shared internal request/parse core with explicit cache behavior; formal summary and draft test are callers, not duplicate parsers.
- Verification: side-effect assertions and package route checks.

Retirement Track:
- Retire any temporary test-only persistence or cache bypass implemented outside the shared Host query owner before completion.
- Keep no compatibility test route once the new route is verified; do not expose API credentials in either route.

### Task 4: Establish package version, changelog, tag, and Release checks

Files:
- Modify `package.json` scripts as necessary
- Modify `scripts/check.mjs` and/or add `scripts/release-check.mjs`
- Add `.github/workflows/verify.yml`
- Add `.github/workflows/release.yml`
- Update root `CHANGELOG.md` and `packages/dsh-balance/CHANGELOG.md`
- Update release instructions in `README.md` and `README.zh-CN.md`
- Keep `packages/dsh-balance/package.json` as the published version owner; root version must match it

Why:
- Every published version needs a traceable tag and recorded update content, with automated validation before GitHub Release creation.

Change Necessity:
- Existing repository has no tags or workflows and no automated check that package versions/changelogs agree. Manual-only convention cannot enforce the approved release contract.

Impact/Compatibility:
- Main package is the only release subject.
- Pull request/main verification runs existing `pnpm verify` plus release metadata checks without publishing.
- Tag workflow triggers only for `v*.*.*`, validates the tag against root and published package versions, verifies changelog sections, runs `pnpm verify`, and creates a GitHub Release from the matching changelog section.
- Do not automatically create tags from ordinary commits.
- Use least-privilege GitHub Actions permissions required for release creation.
- Do not add npm publication unless separately required by deployment configuration.

Steps:
1. Define a metadata checker that reads package JSON and both changelogs, validates root/package version equality, validates a supplied tag version, and fails with actionable messages.
2. Add a non-release CI workflow for pull requests and `main` that installs with the lockfile and runs metadata checks plus `pnpm verify`.
3. Add a tag-triggered release workflow that checks out the exact tag, runs the same validation and verification, extracts the matching changelog section, and creates the GitHub Release.
4. Add contributor release instructions describing version bump, changelog update, `pnpm verify`, commit, `vX.Y.Z` tag, and workflow behavior.
5. Add static workflow/metadata tests or script fixtures covering matching versions, mismatched versions, missing changelog sections, and ordinary-commit no-release behavior.
6. Run the metadata checker, `pnpm verify`, and YAML/script syntax validation.

Repair Track:
- Root cause: release state is represented only by informal changelog text and package versions.
- Canonical repair: published package version plus signed/hosted Git tag is the release identity; workflows validate and materialize the GitHub Release.
- Verification: metadata fixtures, workflow checks, and `pnpm verify`.

Retirement Track:
- Retire the current `Unreleased` entries only when the corresponding release version is prepared.
- Do not create a second release pipeline or legacy-package tag path.

### Task 5: Documentation, ADR, and final integration verification

Files:
- Update `docs/aegis/specs/2026-08-23-balance-status-release-design.md` with implementation evidence if needed
- Add `docs/aegis/adr/2026-08-23-balance-status-release-owners.md` after implementation is verified
- Update `docs/aegis/INDEX.md`
- Update relevant root/package README and changelog content

Why:
- The approved design carries durable configuration, Host route, compatibility, and release decisions that must remain discoverable after implementation.

Change Necessity:
- Durable owner and release contracts cannot be inferred reliably from code alone; an ADR is required by the approved design signal.

Impact/Compatibility:
- ADR records the Host/Client/source-of-truth split, default-provider compatibility fallback, draft-test no-side-effect contract, main-package-only release boundary, and legacy-package retirement trigger.
- Do not rewrite governance or create a duplicate spec.

Steps:
1. After runtime and workflow verification, record the final decision and evidence in the ADR.
2. Update the design spec status/evidence without changing approved requirements.
3. Update `docs/aegis/INDEX.md` for the ADR and plan if not already indexed.
4. Run `git diff --check`, `pnpm verify`, the complete Node test suite, and release metadata checks.
5. Confirm `git status` does not include `.codegraph/codegraph.db` and report any unresolved legacy-package reference risk.

## Plan Pressure Test

- Owner / contract / retirement: explicit Host, Client, release, and legacy compatibility boundaries are present.
- Architecture integrity / higher-level path: draft testing reuses shared request/parse internals; no duplicate parser owner is planned.
- Verification scope: each runtime slice has focused tests; final integration runs all existing checks and metadata validation.
- Task executability: each task names files, behavior, side effects, and exact commands.
- Pressure result: `proceed`

## Execution Readiness View

- Intent Lock: implement only the four approved feature/release slices and their verification/docs.
- Scope Fence: no DSH shell rewrite, polling redesign, security-policy change, legacy deletion, or npm-publish expansion.
- Baseline Lock: Host/Client main package remains canonical; existing config, credentials, cache, and package checks remain valid.
- Approved Behavior: default provider for new sessions; session-only manual switching; stable continuous-output controls; isolated draft test; tag-driven main-package Release.
- Owner / Contract Constraints: Host owns persistence/query/test route; Client owns session/UI; root workflow owns release automation.
- Compatibility Boundary: old config reads; old provider/binding/security behavior; legacy packages remain baselines; CodeGraph DB stays untracked.
- Retirement Boundary: no old package or fallback removal without runtime-reference evidence and explicit follow-up decision.
- Task Batches: default config; status-bar concurrency; draft test; release automation; docs/ADR/final verification.
- Test Obligations: focused tests for precedence, stale responses, draft isolation, metadata mismatch, plus full `pnpm verify`.
- Review Gates: CodeGraph impact check before Client/Host edits; focused verification after each task; final review of workflow permissions and changelog extraction.
- Drift / Rewind Rules: if a task requires a new owner, persistent contract, security exception, or legacy deletion not in the spec, stop and return to design; do not silently expand scope.
- Evidence Required Before Completion: passing focused/full checks, clean diff check, documented ADR, verified release metadata, and no tracked CodeGraph database.
- Advisory Boundary: method-pack execution guidance only; not GateDecision, PolicySnapshot, or completion authority.

## Risks

- Dense Client/Host bundle files may make race fixes difficult to isolate; keep pure helpers small and add deterministic tests.
- Legacy package references may require a minimal compatibility sync; verify before editing and document the result.
- GitHub Actions permissions or action versions may differ by repository policy; validate workflow syntax and use the repository's available token permissions.
- Draft testing performs a real provider request; preserve timeout, endpoint, response-size, and credential safeguards.
- Release notes must be extracted consistently from both changelogs; fail closed on mismatch.

## Retirement / Rollback

- Roll back each coherent task independently by reverting its scoped commit or workflow change; do not reset unrelated user changes.
- Keep the legacy first-provider fallback for configs without a valid default until a future migration decision proves it can be removed.
- Keep legacy package copies unless actual install/reference analysis proves they are unused and a separate destructive-retirement decision is approved.
- Remove any duplicate parser, temporary persistence, or alternate release path introduced during implementation before final verification.
- Preserve the ADR and changelog history even if runtime code is later reverted; update their status explicitly in a follow-up decision.
