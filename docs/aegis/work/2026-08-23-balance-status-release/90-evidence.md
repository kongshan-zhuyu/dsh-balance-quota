# Evidence Bundle Draft

## Commands

- `pnpm verify`: passed after runtime and release metadata changes.
- `node --test packages/dsh-host-balance/lib/security.test.js packages/dsh-balance/test/security.test.js`: 14 tests passed.
- `node scripts/release-check.mjs`: passed.
- `node scripts/release-check.mjs --tag=v0.3.2`: passed.
- `node scripts/release-check.mjs --tag=v0.3.1`: rejected as expected.
- `pnpm check`: passed during runtime slices and release metadata validation.
- `node --check packages/dsh-balance/lib/host/index.js`: passed.
- `node --check packages/dsh-balance/lib/client/client.js`: passed.
- `git diff --check`: passed during slices.

## Scope Evidence

- Runtime edits are limited to unified `packages/dsh-balance` Host/Client.
- Legacy package code was not changed.
- Release subject is `dsh-balance-quota`; no tag was created and no GitHub API call was made.
- `.codegraph/codegraph.db` remains local/untracked.

## Remaining Verification Gap

- No browser-level DSH Web GUI test was run.
- No live provider draft test was run because it requires user credentials and an external provider endpoint.
- No actual GitHub tag or Release was created in this implementation session.
