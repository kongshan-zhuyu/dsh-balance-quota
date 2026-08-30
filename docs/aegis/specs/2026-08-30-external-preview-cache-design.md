# External Status Preview Cache Design

Date: `2026-08-30`
Status: `approved for implementation`
Scope: `packages/dsh-balance`

## 1. Purpose

Persist the latest successfully tested external-status JSON preview independently from `~/.dsh/balance/config.json`, so users can reopen a saved monitoring source after a browser refresh or DSH restart without testing the endpoint again.

The cache is runtime evidence, not configuration. Configuration saving must remain valid when preview caching fails.

## 2. Confirmed Product Decisions

- Full raw JSON caching is enabled by default.
- No per-source cache toggle is added.
- Saving a monitoring source after a successful test makes that preview recoverable across browser refreshes and DSH restarts.
- Deleting a monitoring source deletes its preview cache.
- A mapping change may continue using the cached raw JSON for field binding, but normalized status must be recomputed from the current saved mapping.
- The existing configuration file must not contain new full JSON previews.
- Cache limits are 2 MB per source and 20 MB total.
- Total-cap enforcement evicts the oldest cache files first.

## 3. Current State

### 3.1 Product State

The Client keeps the latest preview in React state and a session-local `Map`. Saving a monitoring source no longer sends `preview` or `previewKeys`, because full previews can exceed the 100 KB persisted-preview validation boundary. Reopening works in the same mounted settings session, but a browser refresh or Host restart loses the preview.

### 3.2 Runtime Boundary

- `config-store.js` exclusively owns `~/.dsh/balance/config.json`.
- `external-status.js` owns external requests, JSON parsing, path collection, normalization, and the in-memory normalized status cache.
- `routes.js` owns API orchestration.
- `client.js` owns preview and binding presentation.
- The network layer accepts at most 512 KB per provider response.

The new cache must not turn `config-store.js` into a mixed configuration/runtime-response owner.

## 4. Architecture

### 4.1 Cache Owner

Add `packages/dsh-balance/lib/host/external-preview-cache.js` as the sole owner of persisted external preview cache files.

Responsibilities:

- derive safe cache paths from validated source IDs;
- atomically write cache envelopes;
- read and validate cache envelopes;
- delete a source cache;
- enforce the per-source and total byte limits;
- evict oldest cache files by modification time;
- maintain private filesystem permissions.

It must not fetch endpoints, normalize model status, mutate configuration, or expose credentials.

### 4.2 Storage Layout

```text
~/.dsh/balance/cache/external-status/<source-id>.json
```

Directory permissions are `0700`; file permissions are `0600`. Writes use a sibling temporary file followed by `rename`. Temporary files are removed after failed writes.

Each file stores only:

```json
{
  "version": 1,
  "sourceId": "ai-input",
  "requestFingerprint": "...",
  "fetchedAt": "2026-08-30T00:00:00.000Z",
  "payload": {}
}
```

The cache does not store request headers, credentials, `keys`, or `normalized`. Derived path catalogs and normalized status are recomputed from the raw payload and current saved mapping.

### 4.3 Request Fingerprint

A deterministic fingerprint covers only request identity fields that affect the returned representation:

- source ID;
- endpoint;
- request method;
- safe request headers.

It must not contain the original header values in the cache filename or response. A SHA-256 digest is sufficient.

The mapping fields are intentionally excluded: the same raw payload remains useful when a user changes mappings.

### 4.4 Staging And Commit Flow

`POST /external-status-preview` continues to fetch, parse, and return the full preview. After a successful test, the Host records a bounded in-memory staged result keyed by source ID:

```text
{ requestFingerprint, fetchedAt, payload }
```

`POST /external-status-source` performs these steps:

1. Validate the source.
2. Atomically save the configuration through the existing config owner.
3. Clear the normalized in-memory status cache.
4. If a staged preview exists and its fingerprint matches the saved source, attempt to persist it.
5. Return successful configuration save even if preview-cache persistence fails.

A failed cache write is observable through a non-fatal response warning, but never rolls back valid configuration. A mismatched or missing staged preview is not written.

This prevents a cancelled test or an unsaved endpoint change from overwriting the cache for a saved source.

### 4.5 Recovery Flow

Add:

```text
GET /dsh-balance-quota/external-status-preview/<source-id>
```

The route:

1. validates the source ID;
2. finds the saved source in current configuration;
3. reads the cache envelope;
4. rejects or ignores a source-ID/fingerprint mismatch;
5. derives the complete preview, path catalog, and normalized status using current code;
6. returns a normal preview-shaped response.

A missing, corrupt, oversized, unsupported-version, or stale-fingerprint cache returns a normal not-found/empty result and must not break the settings page or source configuration.

The Client calls the recovery route when opening a saved source and no same-session preview exists. Same-session memory remains the fastest read path. Existing legacy `source.preview` and `source.previewKeys` remain a read-only compatibility fallback.

### 4.6 Deletion And Eviction

Deleting a monitoring source:

- removes its configuration;
- clears normalized and staged in-memory entries;
- deletes its persisted preview cache.

A cache delete failure is non-fatal after configuration deletion.

Before or after a successful cache write, total cache size is measured. If it exceeds 20 MB, oldest files are deleted until within the cap. The file being written may be retained unless it alone violates the 2 MB per-source limit. Non-cache files and unsafe names are ignored.

## 5. Security And Privacy

- Existing public-HTTPS, SSRF, DNS pinning, redirect rejection, timeout, and 512 KB response limits remain unchanged.
- Cache paths are derived only from IDs accepted by `isId`; no user-controlled path traversal is allowed.
- Raw external responses can contain arbitrary fields, so cache files use private permissions and are never returned through the configuration endpoint.
- No credentials or unsafe request metadata are stored in cache envelopes.
- The existing 100 KB persisted-preview validation remains unchanged for backward compatibility; new full previews do not use that field.
- Invalid cache content is treated as disposable cache failure, not trusted configuration.

## 6. Compatibility And Failure Semantics

- Existing configurations remain readable without migration.
- Existing `preview` and `previewKeys` fields remain accepted and readable but are not newly written by the Client.
- Configuration save success is independent from cache write success.
- Cache recovery does not issue an external network request.
- Cache absence leaves the current empty-preview/test-again behavior intact.
- Legacy packages remain unchanged.

## 7. Verification Criteria

1. A successful test followed by save creates one private cache file for the source.
2. Reopening after Client remount or Host restart restores full JSON, complete paths, and normalized cards without calling the external endpoint.
3. Saving without a matching staged preview does not overwrite an existing cache.
4. Testing an endpoint and cancelling does not write a persisted cache.
5. Changing mappings preserves raw JSON usability and recomputes normalized output from current saved mappings.
6. A cache write failure does not fail configuration save and returns a non-fatal warning.
7. A corrupt, mismatched, unsupported, or missing cache fails closed as a cache miss.
8. A payload envelope above 2 MB is not persisted.
9. Total cache size above 20 MB evicts oldest valid cache files.
10. Deleting a source deletes its persisted and in-memory cache entries.
11. Cache directories/files use `0700`/`0600` permissions.
12. `pnpm verify`, `git diff --check`, and focused cache/security tests pass.

## 8. Non-Goals

- No arbitrary cache browsing or download API.
- No encryption-at-rest mechanism beyond private filesystem permissions.
- No per-source enable/disable switch.
- No change to external response size, SSRF, DNS pinning, or redirect policies.
- No cache persistence inside `config.json`.
- No migration that removes legacy persisted preview fields.
- No modification of legacy Host/Client/Bundle packages.

## 9. Ownership And Complexity

The new module is justified because persisted runtime response data has a different lifecycle, failure policy, capacity policy, and trust boundary from configuration. `config-store.js` remains the sole configuration owner, while `external-preview-cache.js` is the sole persisted preview-cache owner.

`routes.js` only coordinates save/recovery/delete flows. `external-status.js` continues to own derivation from raw payloads. The Client does not read the filesystem or become a persistence owner.

## 10. Design Self-Review

- Placeholder scan: no unresolved placeholders.
- Consistency: staging prevents cancelled edits from overwriting saved cache; save remains independent from cache failure.
- Scope: one Host cache module, route wiring, Client recovery wiring, focused tests, and syntax-check registration.
- Ambiguity: capacities, fingerprint fields, failure semantics, permissions, and recovery behavior are explicit.
- Compatibility: old config fields remain readable; legacy packages and security limits remain unchanged.
- Residual risk: raw public status responses may contain unexpected sensitive data; private permissions and bounded retention reduce but do not eliminate that operator-controlled risk.
