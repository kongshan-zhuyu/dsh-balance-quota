# dsh-balance-quota Initial Baseline

Date: `2026-08-23`
Status: `initial dual-baseline snapshot`

## 1. Purpose

Record the current product and runtime boundaries before implementing the approved balance status and release design.

## 2. Workspace Structure

- `packages/dsh-balance`: published unified Host, Client, and Bundle package
- `packages/dsh-host-balance`: legacy Host compatibility baseline
- `packages/dsh-client-balance`: legacy Client compatibility baseline
- `packages/dsh-bundle-balance`: legacy Bundle compatibility baseline
- `scripts/`: verification, package, and development-install scripts
- `.github/workflows/`: currently no release workflow
- `.codegraph/`: local CodeGraph index, not committed

## 3. Current Authority Surfaces

- Root and package READMEs: product usage and behavior documentation
- Root and package `CHANGELOG.md`: release history candidates
- `packages/dsh-balance/package.json`: published package manifest and version
- `packages/dsh-balance/lib/host/index.js`: Host runtime owner
- `packages/dsh-balance/lib/client/client.js`: Client runtime owner
- `SECURITY.md` and package `SECURITY.md`: security constraints
- No existing ADR or formal release workflow was found.

## 4. Product / Requirement Baseline

### 4.1 Current Truth

- The plugin displays configured balance/quota providers in the DSH Web composer.
- Provider selection is intended to be remembered per conversation.
- The settings page configures providers, bindings, and status-bar visibility.
- The requested target adds a settings-controlled default provider, stable interaction during continuous output, an unsaved-draft test action, and governed releases.

### 4.2 Non-negotiables

1. Conversation switching never changes the global default.
2. Manual switching remains available during continuous output.
3. Draft testing does not persist configuration, credentials, or formal cache data.
4. Only `dsh-balance-quota` is independently released.

### 4.3 Product Non-goals

- No DSH Web shell rewrite.
- No background polling redesign.
- No provider security policy change.
- No deletion of legacy packages.

## 5. Architecture / Runtime Boundary Baseline

### 5.1 Current Truth

- Host owns `~/.dsh/balance/config.json`, credentials resolution, provider requests, and the in-memory formal cache.
- Client owns conversation-local selection and status-bar/menu interaction.
- The published package is `packages/dsh-balance`.
- Existing configurations lack `defaultProviderId`; missing values must remain valid.

### 5.2 Architecture Non-negotiables

1. Persistent defaults remain Host-owned.
2. Session overrides remain Client-owned.
3. Credentials remain in DSH `credentials`.
4. Local CodeGraph database files remain untracked.

### 5.3 Architecture Non-goals

- No second configuration owner.
- No independent legacy-package release line.
- No duplicate request parser for draft testing.

## 6. Ownership / Contract Snapshot

- `packages/dsh-balance/lib/host/index.js` -> persistent config, provider validation/query, cache, Host routes
- `packages/dsh-balance/lib/client/client.js` -> status bar, provider menu, session selection, settings UI
- `packages/dsh-balance/test/security.test.js` -> main package Host behavior regression tests
- `package.json` / `packages/dsh-balance/package.json` -> version and verification entry points
- `.github/workflows/` -> future CI/release automation owner

## 7. Current State And Risks

- No Git version tags currently exist.
- No GitHub Actions workflow currently exists.
- `refreshBar`, `SettingsSection`, and Host `query` lack direct tests for the requested behaviors.
- Legacy package copies may still be used by compatibility paths; implementation must verify references before deciding whether to sync code.

## 8. Alignment Use

Read the Product / Requirement sections when changing visible behavior or acceptance criteria. Read the Architecture sections when changing configuration, routes, cache, credentials, package ownership, or release automation.

## 9. Compatibility Boundary

Keep existing security checks, credentials storage, provider APIs, config readability, status-bar toggle, bindings, and package verification behavior intact unless the approved design explicitly changes them.
