# Health Monitor Status Bar Implementation Plan

## Goal

Implement a per-provider health monitoring switch that defaults to off. When enabled for the currently selected balance provider, the status bar exposes a health icon. Clicking it requests that provider's configured external health source and opens a modal showing every normalized model as a status card.

## Architecture

Reuse the existing `externalStatusSources` configuration contract and `GET /dsh-balance-quota/external-status?force=1&source=<id>` request path. `validate.js` owns the persisted `enabled` boolean. `client.js` owns the settings toggle, status-bar icon, on-demand request state, and transient modal. No background polling, second network owner, or new Host module is introduced.

## Tech Stack

Node.js 22, zero-build ESM Host modules, self-contained React/DOM client bundle, Node test runner, existing DSH CSS variables and dock integration.

## Baseline / Authority Refs

- User-approved behavior in this session: per-provider switch, default off, current-provider scope, click-to-request, all-model card modal.
- `AGENTS.md`: main package only, zero-build client, Host owner boundaries, SSRF and credential constraints.
- `docs/aegis/plans/2026-08-23-external-status-sources-plan.md`: existing external status source contract.
- `docs/aegis/specs/2026-08-30-external-preview-cache-design.md`: raw preview cache remains independent from live health summary requests.

## Compatibility Boundary

- Missing `enabled` on old sources is interpreted as `false`.
- Existing source endpoints, mappings, preview cache, summary normalization, balance status bar, provider selection, and refresh behavior remain unchanged.
- Legacy packages remain untouched.
- Closing or reopening the modal creates no interval or background request.
- Existing SSRF, DNS pinning, redirect rejection, timeout, response-size, and safe-path protections remain authoritative.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change regression
- Reason: no explicit strict TDD request; focused contract and static client assertions plus full regression are proportional.
- Verification: focused Node tests, `pnpm verify`, `git diff --check`, real Host route and browser interaction.

## Requirement Ready Check

- Requirement source refs: direct user request and three approved choices in this session.
- Goals and scope refs: per-provider default-off switch, current-provider status-bar entry, click-time request, card modal.
- User / scenario refs: user configures health mappings, enables monitoring, then inspects current provider health from the status bar.
- Acceptance / verification criteria refs: old source hidden by default; enabled source shows icon; one click fetches one source; modal shows all normalized models and errors locally.
- Open blocker questions: none.
- Decision: ready.

## Change Necessity

- User-visible need: expose configured health monitoring outside settings without permanent request load.
- No-change / non-code option: unavailable because the current schema has no enable flag and the status bar has no health entry or modal.
- Why code change is necessary: persistence validation and client interaction both require maintained source edits.
- Minimum change boundary: `validate.js`, `client.js`, focused tests, and syntax test metadata already covering those files.
- Decision: code-change.

## Existence Check

- Proposed new surface: health status-bar entry and modal.
- Existing owner / reuse candidate: existing external source schema, external status API, status-bar `renderBar`, and normalized model cards.
- Why existing surface is insufficient: it lacks enable state and a status-bar interaction, but its request and normalization owners are sufficient.
- Creation proof: add only UI state/functions and one schema property; no new Host service or endpoint.
- Entropy / retirement impact: no duplicate network path; transient modal is destroyed on close.
- Decision: reuse-existing.

## Architecture Integrity Lens

- Invariant: Host remains the only external request/security/normalization owner; Client only invokes its API.
- Canonical contract: `externalStatusSources[].enabled`, default false.
- Responsibility overlap: none; preview cache is not used as live status truth.
- Higher-level simplification: reuse `/external-status` rather than add a modal-specific endpoint.
- Retirement / falsifier: no old path retired; any direct client fetch to external endpoints would invalidate the design.
- Verdict: proceed.

## Complexity Budget

- Artifact class: Host validator and self-contained client bundle.
- Target files: `validate.js`, `client.js`, existing tests.
- Current pressure: client bundle is large but constrained by DSH zero-build loading.
- Projected post-change pressure: moderate; bounded internal functions and CSS selectors.
- Budget result: within-budget.
- Planned governance: keep request, render, close, and state-bar insertion in distinct functions; do not add another cache or timer.

## Files

- Modify `packages/dsh-balance/lib/host/validate.js`: normalize `enabled` to strict boolean, default false.
- Modify `packages/dsh-balance/lib/client/client.js`: form toggle/payload/load, status-bar health button, transient modal, on-demand API request, model cards and error/loading states.
- Modify `packages/dsh-balance/test/external-status.test.js`: assert default-off and explicit enabled persistence.
- Modify `docs/aegis/INDEX.md`: register this plan.

## Tasks

### Task 1: Extend the source configuration contract

**Files:** `validate.js`, `external-status.test.js`

**Why:** The status bar needs a durable, provider-specific enable decision.

**Impact / Compatibility:** Old and omitted values become false; only literal `true` enables monitoring.

**Steps:**

1. Add `enabled: input.enabled === true` to the validated external source object.
2. Add focused assertions for omitted, false, and true values without changing existing source fixtures.
3. Run `node --test packages/dsh-balance/test/external-status.test.js`.

### Task 2: Add the settings switch

**Files:** `client.js`

**Why:** Users need an explicit default-off control in Health Monitoring settings.

**Impact / Compatibility:** Existing sources load as off until explicitly enabled and saved; disabling retains all mappings and cache.

**Steps:**

1. Add `enabled: false` to new-source form defaults.
2. Load saved `enabled` as strict boolean and include it in the save payload.
3. Render a labeled toggle near the top of the health editor using existing switch conventions.
4. Confirm save errors remain modal-local and source preview payload remains excluded.

### Task 3: Add the status-bar entry and modal

**Files:** `client.js`

**Why:** Enabled health monitoring must be inspectable from the current provider's status bar.

**Impact / Compatibility:** The icon appears only when the current provider has one enabled source. Balance provider selection and refresh controls remain intact.

**Steps:**

1. Resolve the enabled source by `providerId === selected.id` from loaded config.
2. Append an icon-only health button with accessible label and tooltip after balance refresh.
3. Add transient modal DOM with close, retry/refresh, loading, error, summary, and responsive card grid states.
4. On click, call `/external-status?force=1&source=<id>` exactly once and render every returned model.
5. Render model name, health, availability, TTFT, response time, sample/history strip, and safe error text; omit absent metrics.
6. Close and remove modal nodes without registering intervals or global duplicate listeners.
7. Ensure provider switching rerenders/removes the health icon according to the newly selected provider.

### Task 4: Verify and activate

**Files:** all modified files and running DSH process.

**Why:** The feature spans persistence, Host runtime loading, client interaction, and existing balance behavior.

**Steps:**

1. Run focused source tests and static client syntax checks.
2. Run `pnpm verify` and `git diff --check`.
3. Confirm no legacy package changes and package contents include all Host modules.
4. Restart the existing DSH Web process on port 3080, not a replacement server.
5. Verify the recovery route no longer returns `unknown endpoint`.
6. In the real GUI, confirm default-off hides the icon, enabling and saving shows it for the current provider, clicking loads all model cards, refresh retries, and errors stay inside the modal.
7. Run `codegraph sync`.

## Risks

- The currently running Host uses stale module instances; a restart is required after implementation.
- The client bundle is self-contained and large; selector and listener names must remain scoped to avoid collisions.
- An enabled source with an invalid or unreachable endpoint must not affect the balance summary; modal-local error handling is mandatory.
- The real config currently has no `enabled`, so the deployed result must remain hidden until the user enables and saves it.

## Retirement

- No existing request path is retired.
- No background health polling or second health cache is introduced.
- Modal DOM and listeners retire on close; the only durable state is `externalStatusSources[].enabled`.

## Execution Readiness View

- Intent Lock: implement only the approved per-provider, click-to-request behavior.
- Scope Fence: no global switch, no all-provider fan-out, no background polling.
- Baseline Lock: main package only; zero-build and Host security owners remain fixed.
- Approved Behavior: default off, current-provider icon, on-demand all-model modal.
- Owner / Contract Constraints: Host validates/fetches/normalizes; Client displays.
- Compatibility Boundary: old sources off, mappings retained, balance status bar unchanged.
- Retirement Boundary: transient modal cleanup; no new fallback or timer.
- Task Batches: contract; settings; status-bar/modal; verification/runtime activation.
- Test Obligations: focused source contract, full 32+ regressions, package check, live route/UI.
- Review Gates: inspect diff after contract and UI slices; full verification before restart.
- Drift / Rewind Rules: stop if implementation requires direct browser fetch or a new Host request owner.
- Evidence Required Before Completion: tests, package check, live 3080 route, GUI behavior.
- Advisory Boundary: method-pack execution guidance only; not completion authority.

## Execution Route

- Decision: inline
- Evidence: tightly coupled edits in one client bundle and one schema contract; parallel agents would create overlapping ownership.
- Fallback: pause at the contract/UI checkpoint if runtime behavior exposes a design drift.
- User confirmation required: no; design and restart were explicitly approved.
