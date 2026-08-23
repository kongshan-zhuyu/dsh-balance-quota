# External Status Sources Implementation Plan

## Goal

Add a user-configured external model-status panel to `dsh-balance-quota`. The first version accepts arbitrary public HTTPS JSON APIs through `GET` requests and user-supplied JSON-path mappings, normalizes source data into one model-status shape, and renders it inside the existing plugin settings card. It must not call the user's model APIs, use model quota, store credentials, or change the existing balance/quota provider behavior.

## Architecture

- Host owner: `packages/dsh-balance/lib/host/index.js`
  - Owns external-source persistence, public HTTPS fetching, safe JSON-path validation, response normalization, caching, and routes.
- Client owner: `packages/dsh-balance/lib/client/client.js`
  - Owns source configuration UI, mapping fields, source refresh controls, loading/error/empty states, and normalized model cards.
- Test owner: `packages/dsh-balance/test/*.test.js`
  - Pure mapping/normalization/security regression coverage.
- Existing balance provider configuration remains the canonical owner for balances and quotas; external sources are a separate config collection.

## Tech Stack

- Node.js >=22, ESM JavaScript
- pnpm workspace
- Node built-in test runner
- Existing DSH Host/Client plugin APIs
- Existing safe public HTTPS and JSON-path helpers where their contracts fit

## Baseline/Authority Refs

- `docs/aegis/baseline/2026-08-23-initial-baseline.md`
- `docs/aegis/specs/2026-08-23-balance-status-release-design.md`
- `docs/aegis/plans/2026-08-23-balance-status-release-plan.md`
- `packages/dsh-balance/lib/host/index.js`
- `packages/dsh-balance/lib/client/client.js`
- `SECURITY.md`
- External source evidence: `https://status.input.im/api/status`, `https://speed.sbbbbbbbbb.xyz/api/pulse?window=604800`

BaselineUsageDraft:
- Required baseline refs: initial dual baseline, existing balance design/plan, Host/Client owners, security policy
- Delivered context refs: inspected Host routes/query/cache/security and Client settings architecture; inspected both external pages' frontend calls and response field usage
- Acknowledged before plan refs: Host owns persistence and public HTTPS requests; Client owns settings UI; credentials must not enter config
- Cited in plan refs: all refs above
- Missing refs: no existing external-status specification or adapter contract
- Decision: continue

## Compatibility Boundary

- Existing balance/quota routes, config fields, credentials, cache semantics, provider bindings, and status bar remain unchanged.
- Existing configs without `externalStatusSources` remain valid.
- External sources are independent from balance providers and do not participate in provider selection.
- Only `GET` and JSON responses are supported in this version; no POST bodies, auth, cookies, or browser-side cross-origin requests.
- User may enter any public HTTPS hostname, but loopback/private/link-local/internal hosts, redirects, embedded URL credentials, unsafe headers, oversized responses, and invalid JSON paths remain rejected.
- External data is labeled as external monitoring and must not be presented as the user's account health.
- No active model request, prompt, response, API key, or model credential is stored or sent to external sources.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: focused post-change regression and pure normalization tests
- Reason: the user approved the feature behavior but did not request strict test-first TDD.
- Verification: focused Node tests, existing security tests, `pnpm check`, and `pnpm verify` where practical.

## Requirement Ready Check

- Requirement source refs: user approval of external status panel, user-configured API address, GET + JSON + mapping scope
- Goals and scope refs: this plan Goal and Compatibility Boundary
- User/scenario refs: configure Input/Neco-like APIs without consuming model quota; view normalized external model status
- Requirement item refs: Host fetch/normalize/cache, Client config/display, safe public HTTPS, separate source ownership
- Acceptance/verification refs: task verification sections below
- Open blocker questions: none
- Decision: ready

## Change Necessity

- User-visible need: the current plugin only displays balances/quotas and has no external model-status surface.
- No-change option: documentation cannot fetch, normalize, persist, or render external status data.
- Why code change is necessary: the behavior spans the existing Host route/config owner and Client settings owner.
- Minimum boundary: existing Host/Client files plus focused tests and user documentation.
- Decision: code-change

## Existence Check

- Proposed external-source collection: existing Host config owner is sufficient; no second config owner. Decision: reuse-existing.
- Proposed normalized status contract: required because Input and Neco expose incompatible response shapes and Client must not parse source-specific fields. Decision: add-with-proof.
- Proposed adapter registry: first version does not add per-site adapters; user JSON paths are the adapter contract. Decision: reuse-existing generic path parser.
- Proposed cache: existing Host in-memory cache pattern is sufficient; add a separate namespace/key to avoid balance collisions. Decision: reuse-existing pattern.
- Creation proof: mapping contract enables both observed APIs without provider-specific code; tests cover field normalization and invalid inputs.
- Entropy/retirement impact: no legacy owner is removed; the generic mapping can later support additional sources without new source-specific branches.
- Decision: add-with-proof for the smallest normalized contract; reuse existing owners/patterns elsewhere.

## Architecture Integrity Lens

- Invariant: external status is read-only observation and never becomes balance data or model routing state.
- Canonical owner/contract: Host owns source config/fetch/normalization; Client consumes normalized data and edits Host-owned config.
- Responsibility overlap: do not let Client fetch external URLs or parse source-specific schemas.
- Higher-level simplification: one generic JSON mapping normalizer handles both Input and Neco; no hidden webpage scraping or per-site adapter fork.
- Retirement/falsifier: if a future DSH status-source API becomes canonical, migrate the source contract explicitly; do not silently duplicate it in Client.
- Verdict: proceed with existing owners and one explicit normalized external-status contract.

## Plan Pressure Test

- Owner/contract/retirement: explicit Host/Client split; no old logic retirement required.
- Architecture integrity/higher-level path: generic GET/JSON mapping avoids per-provider branches and browser SSRF.
- Verification scope: pure mapping, URL security, route/config compatibility, and UI static checks.
- Task executability: four bounded tasks with exact files and commands.
- Pressure result: proceed.

## Plan-Time Complexity Check

- Complexity Budget:
  - Artifact class: existing Host/Client core owners plus a new persisted config collection and normalized response contract
  - Target files: `packages/dsh-balance/lib/host/index.js`, `packages/dsh-balance/lib/client/client.js`, focused tests, README/security docs
  - Current pressure: dense generated-style one-line runtime files and limited direct UI tests
  - Projected post-change pressure: at risk if source parsing and UI are duplicated per external site
  - Budget result: at-risk
  - Planned governance: pure exported helpers for path mapping/normalization, one generic external fetch path, no site-specific branches, focused tests before broad verification
- Plan-Time Complexity Check:
  - Better file boundary: keep runtime integration in existing owners; isolate pure normalization helpers within Host module for testability
  - Recommendation: edit-in-place plus pure helper extraction; do not create a second package or external adapter directory in this slice

## Execution Readiness View

- Intent Lock: user-approved external status panel using user-entered API URL and JSON mapping.
- Scope Fence: GET + JSON only; no auth, POST, model calls, automatic webpage scraping, or independent full-screen shell.
- Baseline Lock: Host owns config/fetch/cache; Client owns settings/rendering; existing balance behavior stays intact.
- Approved Behavior: arbitrary public HTTPS source; normalized model cards; external-data labeling; no quota use.
- Owner/Contract Constraints: separate `externalStatusSources`; normalized source/model/status/history shape; Client never fetches external URLs.
- Compatibility Boundary: old configs and balance routes remain valid; security restrictions remain.
- Retirement Boundary: no legacy package deletion or balance logic retirement.
- Task Batches: Host contract; tests; Client UI; docs and full verification.
- Test Obligations: mapping/normalization, numeric conversion, status mapping, invalid paths/URLs, config compatibility, response/error behavior.
- Review Gates: inspect Host contract before Client wiring; run focused tests after Host; run full verification before handoff.
- Drift/Rewind Rules: if external APIs require auth/POST or non-JSON data, stop at the config contract and return to design; do not add hidden scraping.
- Evidence Required Before Completion: focused tests pass, `pnpm check` passes, package verification passes, and the two observed APIs map using documented paths.
- Advisory Boundary: planning guidance only; not runtime authority.

## Tasks

### Task 1: Add the Host external-source contract and generic normalizer

Files:
- Modify `packages/dsh-balance/lib/host/index.js`
- Add/modify `packages/dsh-balance/test/external-status.test.js`

Why: the Host must safely fetch user-configured JSON and return one source/model shape without using model credentials or balance cache entries.

Change Necessity: Client-only fetching would expose external requests to browser/CORS behavior and duplicate security logic. The minimum owner boundary is the existing Host config, request security, route, and cache path.

Impact/Compatibility: add optional `externalStatusSources: []` to defaults; validate source ids/names/endpoints/paths/intervals; preserve unknown legacy config fields; use a separate external cache map; return source-level errors without failing other sources.

Steps:
1. Add a default empty `externalStatusSources` collection and a bounded source schema: id, name, GET HTTPS endpoint, optional safe headers excluding auth, interval seconds, model list path, and field paths for model/status/availability/TTFT/response/history/error.
2. Reuse or extract safe JSON-path evaluation for one path at a time; reject prototype paths and excessive depth.
3. Add pure helpers that normalize boolean/string/numeric status, convert availability from 0..1 or 0..100, convert latency units, and map source history into bounded normalized records.
4. Add a generic `fetchExternalStatusSource` path using the existing public HTTPS/DNS pinning and response-size safeguards; never resolve DSH model credentials.
5. Add `GET /dsh-balance-quota/external-status` returning normalized configured sources, and `POST /dsh-balance-quota/external-status-source` / `DELETE /dsh-balance-quota/external-status-source/:id` for validated config changes. Keep source fetch GET-only and JSON-only.
6. Add tests for Input-like and Neco-like payloads, 0/1 vs 0/100 availability, status conversion, missing optional fields, invalid paths, private/redirect/oversized/error responses, and old config defaults.
7. Run `node --test packages/dsh-balance/test/external-status.test.js packages/dsh-balance/test/security.test.js`.

Verification: focused tests pass; balance provider tests remain unchanged and pass.

### Task 2: Add the settings UI for configuring external sources

Files:
- Modify `packages/dsh-balance/lib/client/client.js`

Why: users need to add, edit, delete, refresh, and test external status APIs without editing JSON files.

Change Necessity: configuration is user-facing behavior and cannot be delivered by Host routes alone.

Impact/Compatibility: add a separate collapsible section inside the existing plugin card; do not change provider rows or status-bar selection. Use plain text inputs/selects consistent with current settings UI.

Steps:
1. Load external sources and normalized summaries alongside existing config/balance summary.
2. Add a compact source list with source name, endpoint, last fetch time, overall state, and refresh button.
3. Add an inline editor with fields for name, GET API URL, refresh interval, model list path, model/status/availability/TTFT/response/history/error paths, and latency units.
4. Add save/delete actions through the new Host routes; never place API keys or arbitrary request credentials in the form.
5. Add loading, empty, invalid-config, network-error, and source-level-error states; label results as external monitoring data.
6. Render normalized model cards with status, availability, TTFT, response latency, samples, recent errors, and bounded history bars when present.
7. Keep external fetches Host-side and use a manual refresh plus configured visible-page refresh interval; do not introduce background polling while the page is hidden.
8. Run `node --test packages/dsh-balance/test/security.test.js` and `pnpm check`.

Verification: static checks pass; UI route calls and field names match Host contract; existing balance settings code remains intact.

### Task 3: Document the external status-source contract and security boundary

Files:
- Modify `README.zh-CN.md`
- Modify `README.md`
- Modify `packages/dsh-balance/README.md`
- Modify `SECURITY.md`

Why: users must know that external status is third-party observation, not their own account health, and must know the exact API mapping for Input and Neco.

Change Necessity: undocumented JSON mappings and external-data semantics would make the feature unusable and unsafe to operate.

Impact/Compatibility: document only the new optional section; retain balance/query docs and existing security claims.

Steps:
1. Add an external status section with the generic source configuration fields and Input/Neco example API URLs and JSON paths.
2. State explicitly that the feature does not call model APIs and does not consume the user's model quota.
3. State that arbitrary public HTTPS endpoints are allowed but private/loopback/internal targets, redirects, oversized responses, unsafe paths, and unsafe headers are rejected.
4. State that source schemas can change and that the plugin displays third-party status, not current-account health.
5. Add a changelog entry if the repository's existing release process requires one.
6. Run `pnpm check`.

Verification: docs match actual route names, field names, security behavior, and observed API examples.

### Task 4: Full verification and package boundary review

Files:
- No new runtime owner; inspect modified files and package scripts.

Why: external fetch/config changes touch security and persisted configuration, so the complete package must be verified before handoff.

Steps:
1. Run `node --test packages/dsh-balance/test/external-status.test.js packages/dsh-balance/test/security.test.js packages/dsh-host-balance/lib/security.test.js`.
2. Run `pnpm check`.
3. Run `pnpm pack:check`.
4. Run `pnpm verify` if the existing workspace state permits the full suite.
5. Confirm no API keys, prompt content, model outputs, or `.codegraph/codegraph.db` are added to tracked changes.
6. Confirm the published package remains `dsh-balance-quota` and legacy packages remain untouched except where an existing compatibility check explicitly requires it.

Verification: all applicable commands pass; any unavailable external endpoint is reported as an environment limitation rather than converted into a false success.

## Risks

- External API schema drift can invalidate user mappings; surface path errors and retain manual refresh/test behavior.
- User-configured URLs expand SSRF risk; preserve DNS revalidation/pinning and private-address rejection.
- Public status may not represent the user's account; label source and provenance on every panel.
- Dense Client file may become harder to review; keep normalization in Host and avoid site-specific UI branches.
- External polling can create unnecessary load; cache Host results and honor per-source intervals.

## Retirement

No old balance owner, fallback, or compatibility package is removed. The external status collection is additive. A future canonical DSH monitoring API would require an explicit contract review before replacing user mappings; until then, the generic GET/JSON mapping remains the sole external-status ingestion path.
