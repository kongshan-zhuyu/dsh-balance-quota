# External Status Preview Cache Implementation Plan

## Goal

Implement the approved independent disk cache for the latest successfully tested external-status JSON preview. A saved monitoring source must recover its complete preview after Client remount or Host restart without placing the raw response in `config.json` or weakening existing security limits.

## Architecture

- Persisted preview cache owner: new `packages/dsh-balance/lib/host/external-preview-cache.js`.
- External payload derivation owner: existing `packages/dsh-balance/lib/host/external-status.js`.
- Route orchestration owner: existing `packages/dsh-balance/lib/host/routes.js`.
- Client recovery owner: existing `packages/dsh-balance/lib/client/client.js`.
- Configuration owner remains `packages/dsh-balance/lib/host/config-store.js`; it does not read or write runtime preview cache.
- Cache flow: preview request stages a bounded raw payload in Host memory; successful source save commits only a matching staged payload to disk; recovery derives keys and normalized status from disk raw payload plus current saved mapping.

## Tech Stack

- Node.js >=22 ESM
- Node built-in `fs/promises`, `path`, `os`, and `crypto`
- React through the existing self-contained zero-build Client bundle
- Node built-in test runner
- Existing DSH Host route and security APIs

## Baseline/Authority Refs

- `AGENTS.md`
- `docs/aegis/baseline/2026-08-23-initial-baseline.md`
- `docs/aegis/plans/2026-08-23-external-status-sources-plan.md`
- `docs/aegis/specs/2026-08-30-external-preview-cache-design.md`
- `docs/aegis/specs/2026-08-30-refactor-design.md`
- `packages/dsh-balance/lib/host/config-store.js`
- `packages/dsh-balance/lib/host/external-status.js`
- `packages/dsh-balance/lib/host/routes.js`
- `packages/dsh-balance/lib/client/client.js`

BaselineUsageDraft:
- Required baseline refs: initial Host/Client/config ownership, existing external-status contract, approved preview-cache design, modular Host boundaries
- Delivered context refs: current config store, route table, external fetch/normalization module, Client save/open state flow, response and request byte limits
- Acknowledged before plan refs: `config.json` remains configuration-only; Host owns persistence and external fetches; Client remains presentation-only; legacy packages are immutable
- Cited in plan refs: all references listed above
- Missing refs: no existing persisted runtime-preview cache contract
- Decision: continue

## Compatibility Boundary

- Do not modify `packages/dsh-host-balance`, `packages/dsh-client-balance`, or `packages/dsh-bundle-balance`.
- Keep `~/.dsh/balance/config.json` schema and the existing 100 KB legacy `preview` validation boundary unchanged.
- Keep public-HTTPS validation, SSRF rejection, DNS pinning, redirect rejection, request timeout, safe JSON paths, and the 512 KB network response limit unchanged.
- Existing saved `preview` and `previewKeys` remain readable as a Client fallback but are not newly written.
- Configuration save succeeds even when cache persistence fails.
- Missing or invalid disk cache behaves as a cache miss and does not break source editing.

## TDD Route

- Mode: off
- Decision: skipped
- Strict authority: not applicable
- Test posture: post-change focused regression using temporary directories, followed by existing security and package verification
- Reason: the user approved the design but did not request strict test-first TDD.
- Verification: focused cache and external-status tests, route/static checks, `pnpm verify`, `git diff --check`, and `codegraph sync`

## Verification

```bash
node --test packages/dsh-balance/test/external-preview-cache.test.js packages/dsh-balance/test/external-status.test.js packages/dsh-balance/test/security.test.js
pnpm check
pnpm verify
git diff --check
codegraph sync
```

Expected: all tests pass; package checks report success; no legacy package files change; no cache fixture is written outside the test temporary directory.

## Requirement Ready Check

- Requirement source refs: user approval of default-on independent full JSON disk caching and approved design
- Goals and scope refs: design sections 1-4
- User/scenario refs: test, save, refresh/restart, reopen, recover full JSON and mapping preview
- Requirement item refs: staged commit, independent cache owner, 2 MB/20 MB limits, oldest eviction, private permissions, delete cleanup, non-fatal cache failures
- Acceptance/verification criteria refs: design section 7 and this plan Verification section
- Open blocker questions: none
- Decision: ready

## Change Necessity

- User-visible need: same-session memory cannot restore previews after browser refresh or Host restart.
- No-change/non-code option: requiring a repeated network test does not meet the approved recovery behavior.
- Why code change is necessary: Host-owned disk persistence, recovery routing, and Client recovery wiring do not currently exist.
- Minimum change boundary: one new Host cache module, existing external-status/routes/Client wiring, focused tests, and syntax-check registration.
- Decision: code-change

## Existence Check

- Proposed new surface: `external-preview-cache.js` persisted runtime cache owner.
- Existing owner/reuse candidate: `config-store.js` has atomic filesystem patterns but owns configuration with different lifecycle and failure semantics.
- Why existing surface is insufficient: runtime response cache needs independent capacity, eviction, corruption handling, non-fatal writes, and deletion lifecycle; placing it in `config-store.js` recreates mixed ownership.
- Creation proof: the approved design requires persistence without modifying `config.json`; no existing module owns that artifact.
- Entropy/retirement impact: same-session Client `Map` remains an L1 fast path, while disk becomes the sole cross-session persistence owner; no duplicate disk owner is retained.
- Decision: add-with-proof

## Architecture Integrity Lens

- Invariant: configuration truth and cached response evidence remain separate.
- Canonical owner/contract: `external-preview-cache.js` owns cache files; `external-status.js` derives views; `routes.js` coordinates; Client consumes APIs.
- Responsibility overlap: no filesystem calls in Client, no cache capacity logic in routes, no external fetch in cache module.
- Higher-level simplification: persist only raw payload and recompute all derived data, avoiding duplicate `keys`/`normalized` truth.
- Retirement/falsifier: if DSH later provides a canonical plugin cache service, explicitly migrate this module; until then, no second disk cache path exists.
- Verdict: proceed with the approved owner split.

## Plan Pressure Test

- Owner/contract/retirement: new persisted cache owner is explicit; legacy config preview is read-only compatibility, not a second write path.
- Architecture integrity/higher-level path: staged fingerprint commit prevents cancelled or unsaved endpoint tests from polluting saved cache.
- Verification scope: atomic I/O, limits, permissions, corruption, eviction, route orchestration, Client recovery, compatibility, and package checks.
- Task executability: four bounded tasks with exact files and commands.
- Pressure result: proceed.

## Plan-Time Complexity Check

Complexity Budget:
- Artifact class: new bounded Host persistence utility plus route and Client consumers
- Target files/artifacts: new cache module/test, `external-status.js`, `routes.js`, `client.js`, `scripts/check.mjs`
- Current pressure: `client.js` is dense; Host modules are already separated by owner after modular refactor
- Projected post-change pressure: within budget if capacity and filesystem behavior stay out of routes and Client
- Budget result: within-budget
- Planned governance: pure exported cache functions, dependency injection for test root, one recovery route, no new config fields

Plan-Time Complexity Check:
- Target files: listed above
- Existing size/shape signals: routes are compact; external status has pure derivation helpers; Client has one existing preview state flow
- Owner fit: new filesystem lifecycle belongs in a separate Host module
- Add-in-place risk: adding filesystem/eviction code to `routes.js` or `config-store.js` would mix responsibilities
- Better file boundary: dedicated `external-preview-cache.js`
- Recommendation: add owner file and keep consumer edits wiring-only

## Execution Readiness View

- Intent Lock: persist only the latest successfully tested preview for a saved source and recover it across refresh/restart.
- Scope Fence: no config-embedded full preview, encryption layer, cache browser, per-source toggle, security-limit changes, or legacy-package changes.
- Baseline Lock: Host owns persistence and fetching; Client owns presentation; config-store remains configuration-only.
- Approved Behavior: default-on cache, staged commit on save, 2 MB/source, 20 MB total, oldest eviction, delete cleanup, non-fatal failures.
- Owner/Contract Constraints: cache module owns files; external-status owns derivation; routes orchestrate; Client calls recovery API.
- Compatibility Boundary: old configs and preview fields remain readable; existing API and security constraints remain.
- Retirement Boundary: no new Client persistent path; legacy persisted preview remains read-only until a separate migration explicitly removes it.
- Task Batches: cache module/tests; Host staging/routes; Client recovery; full verification/docs readback.
- Test Obligations: atomic write/read/delete, permissions, caps/eviction, corruption/mismatch, save warnings, recovery derivation, Client route usage.
- Review Gates: review cache security before route wiring; focused tests before Client change; full verification before completion.
- Drift/Rewind Rules: if raw responses require more than 2 MB after envelope serialization, treat as non-fatal cache miss; do not raise network/config limits. If headers would be exposed, stop and revise fingerprint implementation.
- Evidence Required Before Completion: focused tests and full verify pass, diff check clean, legacy packages untouched, cache path and permissions verified in temp fixtures.
- Advisory Boundary: method-pack execution guidance only; not GateDecision, PolicySnapshot, or completion authority.

## Task 1: Add The Persisted Preview Cache Owner

Files:
- Create `packages/dsh-balance/lib/host/external-preview-cache.js`
- Create `packages/dsh-balance/test/external-preview-cache.test.js`
- Modify `scripts/check.mjs`

Why: full external JSON needs a bounded, private, atomic persistence lifecycle independent from configuration.

Change Necessity: memory cannot survive Host restart, and `config-store.js` must remain configuration-only. The minimum boundary is one dedicated Host module and focused tests.

Impact/Compatibility: additive internal module; no public package exports or config fields; tests use an injected temporary root and never touch `~/.dsh`.

Verification:

```bash
node --test packages/dsh-balance/test/external-preview-cache.test.js
pnpm check
```

Steps:

1. Implement constants `EXTERNAL_PREVIEW_CACHE_MAX_FILE_BYTES = 2 * 1024 * 1024` and `EXTERNAL_PREVIEW_CACHE_MAX_TOTAL_BYTES = 20 * 1024 * 1024`.
2. Export a deterministic `externalPreviewFingerprint(source)` using `createHash("sha256")` over stable JSON containing `id`, `endpoint`, normalized method, and sorted safe header entries. Return only the hex digest.
3. Implement a cache-directory resolver that defaults to `join(homedir(), ".dsh", "balance", "cache", "external-status")` and accepts an explicit directory argument for tests. Validate every source ID with `isId` before joining paths.
4. Implement `writeExternalPreviewCache(entry, options)` with envelope version/source/fingerprint/fetchedAt/payload validation, UTF-8 byte measurement, `0700` directory creation, sibling temporary write using `0600`, atomic `rename`, failed-temp cleanup, and structured `{ written, warning? }` result. Do not throw for per-source oversize; return a warning.
5. Implement `readExternalPreviewCache(source, options)` that treats ENOENT, invalid JSON, unsupported version, source mismatch, fingerprint mismatch, and oversize as cache miss. Return a validated envelope or `null`; never trust filename content as source identity.
6. Implement `deleteExternalPreviewCache(id, options)` as idempotent ENOENT-safe deletion.
7. Implement oldest-first total-cap enforcement using `readdir({ withFileTypes: true })`, safe `*.json` filenames, `stat`, and `unlink`. Ignore non-cache files and failed stat/delete entries; never traverse subdirectories.
8. Add tests using `mkdtemp` for atomic round-trip, private modes, fingerprint stability/change, source/fingerprint mismatch, corrupt/version cache miss, 2 MB rejection, oldest-first 20 MB eviction with smaller injected limits, idempotent delete, and unsafe ID rejection.
9. Register the new Host file in `scripts/check.mjs` and run the Task verification commands.

Repair Track:
- Root cause: no cross-session preview persistence owner exists after config payload stopped carrying full JSON.
- Canonical owner: new bounded cache module.
- Stable repair: one raw-payload envelope and derived-data recomputation.
- Compatibility: no config or package API change.

Retirement Track:
- Old path: Client session `Map` remains active as the fast path, not persistent truth.
- Retention reason: avoids unnecessary Host reads while the editor remains mounted.
- Removal trigger: only if a future unified Client query cache replaces it without changing behavior.

## Task 2: Add Host Staging, Commit, Recovery, And Cleanup

Files:
- Modify `packages/dsh-balance/lib/host/external-status.js`
- Modify `packages/dsh-balance/lib/host/routes.js`
- Modify `packages/dsh-balance/test/external-preview-cache.test.js`
- Modify `packages/dsh-balance/test/external-status.test.js` only if pure derivation coverage needs extension

Why: persisted cache must represent the last successful test of the configuration that was actually saved, and recovery must recompute derived data from current mappings without network access.

Change Necessity: direct write during preview can persist cancelled edits; save-only write without staging has no raw payload. The minimum repair is one bounded Host staging map plus route orchestration.

Impact/Compatibility: adds one GET recovery endpoint and an optional non-fatal `warning` field on source-save responses; existing success shape remains valid.

Verification:

```bash
node --test packages/dsh-balance/test/external-preview-cache.test.js packages/dsh-balance/test/external-status.test.js packages/dsh-balance/test/security.test.js
```

Steps:

1. In `external-status.js`, export `externalPreviewStage = new Map()` and bound it to one latest entry per source ID. On successful `previewExternalStatusSource`, stage `{ requestFingerprint, fetchedAt, payload }` after parsing and before returning; do not stage failed requests.
2. Add a pure `deriveExternalPreview(source, payload, fetchedAt)` helper returning `{ preview, keys, normalized }`; use it both for live preview and disk recovery so derivation has one owner.
3. In `routes.js`, import cache read/write/delete/fingerprint functions and the stage map/derivation helper.
4. Extend `createRouter` with an optional internal dependency object for tests containing the cache directory. Preserve `createRouter(ctx)` behavior for production callers.
5. After successful configuration save, read the staged entry for `source.id`. Persist only when its fingerprint equals `externalPreviewFingerprint(source)`. Capture cache write failure as a sanitized non-fatal `warning`; do not roll back config. Clear the staged entry after a matched commit attempt.
6. Add `GET /dsh-balance-quota/external-status-preview/<id>` before generic fallthrough. Validate ID, find the saved source, read matching disk cache, derive preview/keys/normalized from current source mappings, and return `{ ok: true, cached: true, ...derived }`. Return a normal 404 `{ ok:false,error:"preview cache not found" }` for missing source/cache.
7. On source deletion, clear `externalStatusCache`, `externalPreviewStage`, and call disk-cache deletion after config removal. Cache delete failure must not restore or retain the deleted config; return an optional warning.
8. Add route-level tests with a fake request/response and temporary cache directory for matching staged commit, mismatched stage non-overwrite, recovery without network request, mapping recomputation, non-fatal write warning, cache miss, and delete cleanup.
9. Run the Task verification command and confirm existing external normalization/security tests remain green.

Repair Track:
- Root cause: preview and saved-source lifecycles were disconnected after removing preview from the save payload.
- Canonical owner: Host staging plus save/recovery route orchestration.
- Stable repair: fingerprint-gated commit and current-mapping derivation.
- Compatibility: save still succeeds; recovery endpoint is additive.

Retirement Track:
- Old write path: config-embedded preview remains disabled in Client.
- Legacy read fallback: retained for existing configs only.
- Removal trigger: an explicit config migration after all supported versions no longer carry legacy preview fields.

## Task 3: Recover Persisted Preview In The Client

Files:
- Modify `packages/dsh-balance/lib/client/client.js`

Why: the Host cache is useful only if reopening a saved source restores the JSON tree and normalized status card without another test request.

Change Necessity: current `beginExternalEdit` reads only same-session memory and legacy config preview. The minimum Client change is an asynchronous recovery call for a saved source cache miss.

Impact/Compatibility: no relative imports or new runtime dependencies; existing session cache stays first; existing legacy preview stays fallback; loading/error text rules remain unchanged.

Verification:

```bash
pnpm check
pnpm pack:check
```

Steps:

1. Keep `externalPreviewCache.current` as the first read path and legacy `saved.preview/saved.previewKeys` as the second read path.
2. When `beginExternalEdit` has neither source, immediately clear `externalPreview` and `externalPreviewStatus`, then call `GET /external-status-preview/${encodeURIComponent(source.id)}`.
3. Guard asynchronous recovery with the source ID currently being edited so a late response cannot populate a different source editor.
4. On recovery success, store the returned preview in the session `Map`, set `externalPreview`, set `externalPreviewStatus`, and update only `preview/previewKeys` in the current form when the form ID still matches.
5. Treat 404/missing cache as an empty preview without user-facing error. Surface other safe recovery errors inside the modal without clearing saved mappings.
6. After source-save success, inspect optional `data.warning`; show it as non-fatal cache feedback while retaining the successful save message. Do not convert cache warning into save failure.
7. Keep mapping-change behavior: raw JSON remains, normalized data becomes null until retest or a saved-source reopen recomputes via Host.
8. Confirm new-source initialization and source deletion still clear same-session preview state.
9. Run the Task verification commands and grep to confirm the Client never sends `preview` or `previewKeys` in `externalPayload()`.

Repair Track:
- Root cause: Client had no Host readback path after remount.
- Canonical owner: existing saved-source open flow.
- Stable repair: one guarded recovery request with existing state owners.
- Compatibility: empty cache preserves current behavior.

Retirement Track:
- Same-session memory read remains the preferred fast path.
- No duplicate persistent Client cache is added.

## Task 4: Full Verification And Architecture Closeout

Files:
- Inspect all task-owned files
- Update `docs/aegis/adr/` only if post-implementation evidence confirms the new durable owner and current repository ADR conventions can be followed without rewriting unrelated historical ADRs
- Update `docs/aegis/INDEX.md` only for any new accepted ADR

Why: this change adds a persistent artifact, route, capacity policy, and privacy boundary; completion requires broader regression and owner review.

Change Necessity: runtime work cannot be handed off on focused tests alone because package security, file inclusion, and zero-build constraints are shared boundaries.

Impact/Compatibility: verification-only unless an evidenced mismatch requires returning to the relevant task; do not modify legacy packages or user configuration/cache files during tests.

Verification:

```bash
node --test packages/dsh-balance/test/external-preview-cache.test.js packages/dsh-balance/test/external-status.test.js packages/dsh-balance/test/security.test.js packages/dsh-host-balance/lib/security.test.js
pnpm check
pnpm pack:check
pnpm verify
git diff --check
codegraph sync
```

Steps:

1. Review the final diff for cache path traversal, sensitive header persistence, unbounded reads/writes, swallowed config errors, and duplicated derivation logic.
2. Confirm only `packages/dsh-balance` runtime files changed; legacy packages remain untouched.
3. Run all verification commands and record complete exit status.
4. Inspect test temporary directories or test assertions to confirm no writes reached `~/.dsh/balance/cache`.
5. Confirm `scripts/check.mjs` includes every new Host file and pack-check includes the file through the package directory whitelist.
6. Run a static Client contract check: recovery GET route matches Host exactly; save payload still excludes full preview; source delete clears both caches.
7. Evaluate ADR signal: accepted independent cache owner, config/cache separation, staged fingerprint commit, and non-fatal cache failure semantics. Create an ADR only if current project ADR format can be satisfied without unrelated historical cleanup; otherwise report the pre-existing Aegis workspace format blocker explicitly.
8. Run `codegraph sync` after final source changes.

Repair Track:
- Confirm original scenario: test, save, remount/restart, reopen, full preview restored without network fetch.
- Confirm same-pattern behavior: cache miss/corruption/mismatch does not break editing.

Retirement Track:
- Confirm no new config-preview write path exists.
- Confirm no duplicate disk cache owner exists.
- Retain legacy read compatibility with explicit future migration trigger.

## Risks

- Raw status responses may contain unexpected sensitive fields. Mitigation: private file modes, no config endpoint exposure, bounded retention, delete lifecycle, and no headers/credentials in the envelope.
- Cache serialization can expand beyond raw response bytes. Mitigation: enforce 2 MB against the final envelope bytes.
- A save can succeed while cache persistence fails. Mitigation: explicit non-fatal warning and empty-cache recovery behavior.
- Late Client recovery can race source switching. Mitigation: guard state writes by current source ID.
- Eviction tests could touch live cache if path injection is missed. Mitigation: require explicit temporary directory injection and assert paths.

## Retirement

- The Client session `Map` remains as an L1 cache; disk is the sole cross-session owner.
- Legacy config `preview/previewKeys` remains read-only for compatibility and has no active write path.
- No old balance cache, external normalized status cache, security owner, or legacy package is removed.
- A future DSH canonical cache service is the trigger to reconsider and retire the local disk-cache module through an explicit migration.

## Plan Self-Review

- Spec coverage: every approved behavior and verification criterion maps to Tasks 1-4.
- Placeholder scan: no unresolved placeholders or vague implementation instructions.
- Type consistency: fingerprint, envelope, staged entry, recovery response, and optional warning shapes align across tasks.
- Compatibility: config, security, zero-build, legacy preview reads, and legacy package boundaries are explicit.
- Change necessity: each code-edit task names the minimum owner boundary.
- Existence check: new module creation is justified; no duplicate disk owner remains.
- Complexity: filesystem/capacity logic is isolated from routes, config, and Client.
- Architecture integrity: raw payload is the only persisted truth; derived data has one owner.
- Verification: exact focused and full commands are included.
- ADR signal: preserved for post-implementation evidence without forcing unrelated historical document rewrites.
