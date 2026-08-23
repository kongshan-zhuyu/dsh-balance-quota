# Balance Status And Release Design

Date: `2026-08-23`
Status: `implemented; see ADR and verification evidence`
Scope: `dsh-balance-quota` main package

## 1. Purpose

Improve the balance/quota status bar and settings workflow, and establish a reproducible release contract for the published `dsh-balance-quota` package.

This design covers:

1. Default provider display for new conversations.
2. Status-bar interaction during continuous assistant output.
3. Testing an unsaved provider form draft.
4. Version, tag, changelog, and GitHub Release governance.

## 2. Confirmed Product Decisions

- A provider selected in the conversation affects only the current conversation.
- The global default provider is changed only in Balance settings.
- A new conversation displays the configured global default provider.
- During continuous output, provider switching and manual refresh remain available.
- Switching takes effect immediately; it does not wait for a balance request.
- A refresh locks only the current provider refresh control, not the provider menu.
- Stale asynchronous responses must not overwrite the current provider selection.
- The settings test button tests the current unsaved form draft.
- Draft testing does not save provider configuration, credentials, or formal cache data.
- Only `dsh-balance-quota` is a release subject; legacy Host / Client / Bundle packages remain compatibility baselines.
- A release is intentionally created by pushing a `vX.Y.Z` tag after the release commit passes verification.
- GitHub Actions validates the tag and creates the GitHub Release; ordinary commits do not create releases.

## 3. Current Baseline

### 3.1 Product / Requirement Baseline

The existing plugin provides a balance/quota status bar, per-conversation provider selection, a settings page, Host-side provider caching, and manual refresh. Current documentation promises a status bar, provider switching, and manual refresh, but the new-conversation default and draft test behavior are not yet implemented.

### 3.2 Architecture / Runtime Boundary Baseline

- Host owner: `packages/dsh-balance/lib/host/index.js`
- Client owner: `packages/dsh-balance/lib/client/client.js`
- Persistent configuration: `~/.dsh/balance/config.json`
- Credentials: DSH `credentials` service
- Formal balance cache: Host in-memory provider cache
- Published package: `packages/dsh-balance`
- Legacy compatibility packages: `packages/dsh-host-balance`, `packages/dsh-client-balance`, `packages/dsh-bundle-balance`
- Existing CodeGraph index: local `.codegraph/codegraph.db`; it must not be committed.

The current Client refresh path can rerender the status summary and recreate interactive children after asynchronous requests. `refreshBar`, `syncSession`, `SettingsSection`, and Host `query` have no direct covering tests for the requested behaviors.

## 4. Target Behavior

### 4.1 Provider Resolution

The displayed provider is resolved in this order:

1. A manual selection stored for the current conversation.
2. The configured global `defaultProviderId`.
3. The first configured provider.
4. The empty state `未配置余额供应商`.

A missing `defaultProviderId` in an existing configuration preserves the legacy fallback behavior. A manual conversation selection never changes `defaultProviderId`.

The Balance settings page provides a default-provider selector containing configured providers. Saving the preference validates that the selected ID exists. Removing the default provider removes or safely falls back from the invalid value.

### 4.2 Continuous Output Interaction

The status bar retains its root and menu ownership while data changes. Rendering updates the content and state of existing controls rather than invalidating user interaction through unnecessary replacement.

Each asynchronous balance refresh records its request generation and target provider. A response may update the provider data only when it is still relevant; it must not change the selected provider or restore stale content after the user has switched providers.

Provider switching:

- updates the current conversation selection immediately;
- updates the visible provider state immediately when possible;
- queries the selected provider asynchronously;
- keeps the menu usable during assistant output.

Manual refresh:

- targets the current provider at click time;
- locks only that provider's refresh button;
- remains recoverable after success or failure;
- does not disable the provider menu.

### 4.3 Draft Provider Test

The Host exposes a test action for the current provider form draft. The action reuses the existing provider validation, credential resolution, endpoint security, JSON-path parsing, and value conversion rules, but has no persistence side effects.

The test action must not:

- call `saveConfig`;
- write or replace credentials;
- write the formal Host cache;
- modify the selected provider or status bar.

For an existing provider with an empty API key field, the stored credential referenced by the provider may be used. A new provider must provide a usable credential source. API keys are never returned to the browser.

The settings button exposes idle, loading, success, and error states. A successful test displays only the parsed balance/quota result and does not save the form.

### 4.4 Release Governance

The published release subject is `dsh-balance-quota` in `packages/dsh-balance`.

- Version tag format: `vX.Y.Z`.
- The tag must point to a commit that passes `pnpm verify`.
- The root workspace version and published package version must agree.
- Root and package changelogs must contain the same released version and content.
- Release notes move the relevant `Unreleased` entries into the released version section.
- Legacy packages do not receive independent tags or release automation.
- Pull requests and main-branch checks run verification and release metadata checks.
- A pushed `vX.Y.Z` tag runs verification, validates the tag/package version match, extracts the matching changelog section, and creates a GitHub Release.
- Ordinary commits and merges do not create tags or releases automatically.

Whether npm publication is enabled is an implementation/deployment choice; this design requires GitHub Release creation but does not require automatic npm publication.

## 5. Ownership And Compatibility

- Host owns persistent defaults, provider validation, credentials, formal query cache, and the draft-test route.
- Client owns conversation-local selection, status-bar rendering, menu interaction, and stale-response suppression.
- Settings UI edits Host preferences and submits draft tests; it does not become a second configuration owner.
- Existing configurations remain readable without migration because absent `defaultProviderId` is valid.
- Existing security restrictions remain unchanged: public HTTPS only, DNS revalidation/pinning, bounded response size, safe headers, safe JSON paths, and DSH credential storage.
- The legacy package copies are not removed by this change. Their actual install/reference role must be verified during implementation before deciding whether compatibility code needs a mechanical sync.

## 6. Verification Criteria

1. A new conversation displays the configured default provider when providers exist.
2. A manually selected provider survives leaving and returning to the conversation.
3. Conversation switching does not modify the global default.
4. The provider menu opens and switching works during continuous output.
5. Refresh remains clickable during continuous output and stale responses cannot replace a newer selection.
6. The settings test action reports success or a specific failure for an unsaved draft.
7. Draft testing leaves configuration, credentials, and formal cache unchanged.
8. Deleting the default provider cannot leave an invalid active default.
9. A matching `vX.Y.Z` tag passes metadata and `pnpm verify` checks and creates a GitHub Release.
10. An ordinary commit does not create a tag or Release.
11. Existing security tests and package checks continue to pass.

## 7. Non-Goals

- No DSH Web shell rewrite.
- No background polling redesign.
- No change to provider endpoint security policy.
- No global-default mutation from the conversation status bar.
- No independent release line for legacy packages.
- No deletion or retirement of legacy packages in this change.
- No commit of local CodeGraph database files.

## 8. Architecture Decision Signals

This change introduces a persistent configuration field, a Host test action with an explicit no-side-effect contract, and a repository release contract. Implementation should record these decisions in an ADR or equivalent durable decision log after the behavior is verified.

## 9. Design Self-Review

- Placeholder scan: no unresolved `TBD` or `TODO` requirements.
- Consistency: global default, conversation override, draft test isolation, and release ownership are consistent.
- Scope: four related slices can be implemented under existing Host/Client/settings/release owners.
- Boundary check: persistence, credentials, cache, compatibility, legacy packages, and local CodeGraph data are explicit.
- Residual risk: the legacy package copies may still be referenced by a compatibility install path; implementation must verify this before choosing sync versus baseline-only treatment.
