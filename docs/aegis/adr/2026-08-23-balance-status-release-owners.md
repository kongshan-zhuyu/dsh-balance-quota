# Balance Status And Release Owners

Date: `2026-08-23`
Status: `accepted after implementation verification`

## Context

The balance plugin needs a global default provider for new conversations, reliable status-bar interaction while asynchronous output and balance queries overlap, a way to test unsaved provider forms, and a traceable release process. The repository also contains legacy Host/Client/Bundle package copies.

## Decision

1. `packages/dsh-balance/lib/host/index.js` remains the canonical owner for persistent configuration, provider validation, credentials, formal cache, and the draft-test route.
2. `packages/dsh-balance/lib/client/client.js` remains the canonical owner for conversation-local provider selection, status-bar/menu interaction, freshness guards, and settings UI.
3. `defaultProviderId` is optional in persisted configuration. Selection precedence is conversation-local manual choice, valid global default, first configured provider, then empty state. Missing or invalid defaults preserve compatibility through fallback.
4. `POST /dsh-balance-quota/provider/test` reuses the Host request/parser core with cache writes disabled. It does not save configuration, credentials, or formal cache data, and it never returns API keys.
5. `dsh-balance-quota` in `packages/dsh-balance` is the only independent release subject. Root and package versions/changelogs must agree. A matching `vX.Y.Z` tag triggers verification and GitHub Release creation; ordinary commits do not trigger releases.
6. Legacy package copies remain compatibility/regression baselines. They are not independently tagged or released. Their removal requires separate runtime-reference evidence and an explicit retirement decision.

## Alternatives Considered

- Keep first configured provider as the only default: rejected because new conversations need user-configurable deterministic display.
- Let conversation switching update the global default: rejected because session-local choice must not alter settings for other conversations.
- Save before testing a provider: rejected because users need to validate unsaved drafts without persisting partial configuration.
- Add a second request parser for testing: rejected because it would create behavior drift and duplicate security-sensitive logic.
- Independently release all legacy packages: rejected because current installs use the unified package and multiple release lines increase version drift.

## Consequences

- Existing configuration files remain readable without migration.
- Client request generations prevent stale asynchronous results from changing the current selection; refresh loading is scoped to the current provider.
- The Host route surface grows by one explicit test action, but the request/parser owner remains shared.
- Release preparation requires synchronized root/package changelog content and version metadata.
- Legacy copies remain maintenance debt and need a future retirement review rather than silent deletion.

## Verification Evidence

- `pnpm verify` passed after the runtime and release metadata changes.
- Existing 14 security tests passed.
- `node scripts/release-check.mjs` passed with no tag and `--tag=v0.3.2`.
- `--tag=v0.3.1` was rejected as a version mismatch.
- `pnpm check`, syntax checks, and `git diff --check` passed during implementation.

## Follow-up / Retirement Trigger

Re-evaluate the legacy packages only after an install/bundle reference audit proves they are not needed by supported compatibility paths. Do not remove them or introduce independent tags without a new reviewed decision.
