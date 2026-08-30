# Modular Architecture Refactor

Date: `2026-08-30`
Status: `accepted after implementation verification`

## Context

The `packages/dsh-balance` package initially had all Host logic consolidated into a single monolithic `lib/host/index.js` (440 lines) and all Web Client UI and lifecycle into `lib/client/client.js` (395 lines with 2000+ char single lines). As new features (such as official provider presets, external metrics, draft testing, and session routing) were planned, this single-file layout increased change entropy and risk of regression.

## Decision

1. **Host-Side Layered Modularization**:
   - `lib/host/net.js`: Dedicated network boundary owning DNS lookup, IP pinning against DNS rebinding, and safe HTTPS fetching.
   - `lib/host/http-utils.js`: HTTP serialization, error formatting, and Bearer token error sanitization.
   - `lib/host/json-path.js`: Standalone JSON path and fallback chain (`?.` / `??`) interpreter.
   - `lib/host/presets.js` (**Strategy Pattern**): Centralized preset registry containing official API definitions and response extraction strategies.
   - `lib/host/validate.js` (**Specification Pattern**): Request input and external source schema validation.
   - `lib/host/external-status.js` (**Pipeline & Transform Pattern**): Third-party monitoring payload normalization and transform registry.
   - `lib/host/config-store.js` (**Facade Pattern**): Atomic filesystem storage (`~/.dsh/balance/config.json`) and serialized config mutations.
   - `lib/host/query.js`: Provider credentials resolution and cached querying service.
   - `lib/host/routes.js` (**Command Pattern**): Declarative route table replacing nested if-else statements.
   - `lib/host/index.js` (**Composition Root & Barrel**): Wires DSH plugin lifecycle, routes, and re-exports all 11 original public symbols with 100% signature compatibility.

2. **Client-Side Structure Refactoring**:
   - Maintained single bundle factory contract (`lib/client/client.js`) without introducing external build tools (zero-build philosophy preserved).
   - Extracted internal Custom Hooks (`useModelProviders`) to decouple stateful effects.
   - Split 2000+ character single-lines into formatted, readable React element hierarchies.

3. **Zero-Regression & Compatibility Verification**:
   - All 15 existing test suites pass unchanged.
   - `scripts/check.mjs` was updated to perform syntax validation on all 17 source files.
   - Package distribution contract (`package.json`, `cordis.patch.yml`, `files` whitelist) is strictly preserved.

## Consequences

- Future additions (new official providers, new API routes, new external monitoring transforms, new UI components) have single, well-defined extension points.
- Code size per file is now 40–130 lines, drastically lowering cognitive load and maintenance costs.
- Verification remains dependency-free and 100% test-backed.

## Verification Evidence

- `pnpm verify` (check + test + pack:check) passed with 21/21 test assertions passing.
- `scripts/check.mjs` verified syntax for all 17 files.
- CodeGraph graph index updated smoothly with 141 nodes.
