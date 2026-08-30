# Balance Quota Plugin Refactoring Spec

Date: `2026-08-30`
Status: `design approved, ready for plan`

## 1. Context & Objectives

The `dsh-balance-quota` plugin currently has its Host and Client business logic concentrated in single monolith files:
- `packages/dsh-balance/lib/host/index.js` (440 lines, 80 symbols): Mixes network security, DNS pinning, JSON path parsing, preset strategies, provider validation, external status normalization, cache orchestration, config persistence, and an HTTP router with 10 branch conditions.
- `packages/dsh-balance/lib/client/client.js` (395 lines): Mixes composer dock mounting, provider switching menu, session storage memory, CSS string injection, and a monolithic `SettingsSection` React component with 20+ `useState` calls and 2000+ character lines.

### Goal
Refactor `packages/dsh-balance` using established design patterns to maximize maintainability, extensibility (for new presets, APIs, UI widgets, and external status transforms), and simplicity, while strictly maintaining 100% behavior and export compatibility with zero build tooling.

---

## 2. Invariants & Non-Goals

### Invariants (Must NOT Change)
1. **Zero Observable Behavior Change**: All 15 existing test cases in `packages/dsh-balance/test/` and `packages/dsh-host-balance/` must pass without editing the test files.
2. **Public Export Surface Compatibility**: `lib/host/index.js` and `lib/index.js` must export all 11 original public symbols (`OFFICIAL_PROVIDER_IDS`, `formatProviderError`, `isOfficialProvider`, `refreshDue`, `validateProvider`, `readJsonPath`, `readJsonPathExpr`, `redactProvider`, `resolveBinding`, `normalizeExternalStatus`, `validateExternalStatusSource`) with identical signatures.
3. **Security Invariants**: DNS resolution before request + IP pinning against DNS rebinding, private IP rejection, 3xx redirect denial, and Bearer token error sanitization remain strictly enforced in `net.js` and `http-utils.js`.
4. **Credential Isolation**: Key storage remains exclusively in DSH `credentials` service.
5. **Zero-Build Philosophy**: No build tools (no esbuild, rollup, webpack). Raw source files are shipped directly in npm package.
6. **Legacy Packages**: `packages/dsh-host-balance`, `packages/dsh-client-balance`, `packages/dsh-bundle-balance` remain untouched.

### Non-Goals
- No UI redesign or visual changes.
- No new features added during this refactoring phase.
- No schema or config file format migration.

---

## 3. Host Architecture & Design Patterns

The Host side (`packages/dsh-balance/lib/host/`) will be decomposed into 8 cohesive modules + 1 composition root:

```
packages/dsh-balance/lib/host/
├── net.js              # Network security boundary (DNS lookup, IP pinning, safe HTTPS)
├── http-utils.js       # HTTP primitives (json response, body parse, error formatting & sanitization)
├── json-path.js        # JSON path interpreter (safePath, ?? / ?. fallback expression engine)
├── presets.js          # Strategy Pattern: Official provider presets registry & extractors
├── validate.js         # Specification Pattern: Provider and external source input validation
├── external-status.js  # Pipeline & Transform Pattern: External metrics normalization & preview
├── config-store.js     # Facade Pattern: Serialized atomic config persistence (~/.dsh/balance/config.json)
├── query.js            # Service Layer: Provider credential resolution & cached query orchestration
├── routes.js           # Command Pattern: Route table with declarative matching & endpoint handlers
├── security.js         # Credential ref generation & legacy macOS keychain migration (retained)
└── index.js            # Composition Root & Barrel: apply(ctx) lifecycle wiring and re-exports
```

### Key Design Patterns

#### A. Preset Strategy Pattern (`presets.js`)
Instead of `if (preset === "deepseek")` checks inside query and validation:
```javascript
export const PRESET_STRATEGIES = Object.freeze({
  deepseek: {
    id: "deepseek",
    label: "DeepSeek 官方余额",
    endpoint: "https://api.deepseek.com/user/balance",
    method: "GET",
    responsePath: "$.balance_infos",
    currency: "CNY",
    extractBalance(data, provider) {
      const info = Array.isArray(data.balance_infos)
        ? data.balance_infos.find(item => item?.currency === provider.currency) || data.balance_infos[0]
        : undefined;
      return Number(info?.total_balance ?? 0);
    }
  },
  "opencode-go": {
    id: "opencode-go",
    label: "OpenCode Go 官方额度",
    endpoint: "https://opencode.ai/zen/go/v1/usage",
    method: "GET",
    // ...
    extractBalance: () => undefined // No currency balance, usage windows only
  }
});
```

#### B. Command / Route Table Pattern (`routes.js`)
Instead of a giant nested `if-else` chain:
```javascript
const routeTable = [
  { method: "GET", match: url => url.pathname === "/dsh-balance-quota/config", handle: handleGetConfig },
  { method: "GET", match: url => url.pathname === "/dsh-balance-quota/summary", handle: handleGetSummary },
  { method: "POST", match: url => url.pathname === "/dsh-balance-quota/provider", handle: handleSaveProvider },
  { method: "POST", match: url => url.pathname === "/dsh-balance-quota/provider/test", handle: handleTestProvider },
  { method: "DELETE", match: url => url.pathname.startsWith("/dsh-balance-quota/provider/"), handle: handleDeleteProvider },
  // ...
];
```

#### C. Transform Registry (`external-status.js`)
Transform functions mapped cleanly to support adding new transform formats easily:
```javascript
export const EXTERNAL_TRANSFORMS = Object.freeze({
  identity: val => val,
  number: val => { const n = Number(val); return Number.isFinite(n) ? n : val; },
  percent: normalizeAvailability,
  status: normalizeExternalHealth
});
```

---

## 4. Client Architecture & Code Cleanliness

Given the DSH `__ModuleLoader__` client-side runtime constraint (single bundle factory per package without relative module loader), `packages/dsh-balance/lib/client/client.js` remains a single self-contained file, but its internal structure is refactored into distinct functional blocks:

1. **State & Utilities**: Scoped state singleton, money formatting, date formatting, API wrapper.
2. **Custom Hooks (Internal)**:
   - `useModelProviders(connection)`: Encapsulates connection query and settings subscription.
   - `useExternalEditor(config, setConfig, ...)`: Encapsulates external status source form, field mapping, preview test, and custom fields state.
3. **Sub-component Functions**:
   - `ProviderRow`: Individual provider row with active status, model binding, and action buttons.
   - `ProviderInlineEditor`: Clean multi-line JSX/h-structure for provider editing.
   - `ExternalStatusModal`: Modal dialog for external monitoring sources.
   - `JsonTreeView`: Interactive JSON tree for visual field selection.
4. **Style Declarations**: Clean CSS constants at the top rather than concatenated inline blocks.

---

## 5. Verification Plan

1. **Unit & Security Tests**: Run `pnpm test` (executes all 15 tests covering security, json-path, external-status, credential refs).
2. **Package & Syntax Check**:
   - Update `scripts/check.mjs` to include the new `lib/host/*.js` modules in its syntax check list.
   - Run `pnpm check`.
3. **Packaging Dry Run**: Run `pnpm pack:check` to ensure all files exist and match packaging rules.
4. **Full Verification**: Run `pnpm verify` (check + test + pack:check).
