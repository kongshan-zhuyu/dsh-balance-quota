# Balance Status And Release Work Intent

## TaskIntentDraft

- Outcome: implement the approved balance status/default provider behavior, stable continuous-output controls, isolated draft testing, and main-package tag-driven release governance.
- Success evidence: focused tests and `pnpm verify` pass; release metadata/workflow checks pass; docs/ADR preserve the owners and boundaries.
- Stop condition: complete all approved slices, or pause on a blocker that requires a new owner, contract, security exception, destructive retirement, or external release authorization.
- Non-goals: DSH shell rewrite, polling redesign, provider security-policy changes, legacy package deletion, npm publication expansion.

## BaselineReadSetHint

- Required: approved design spec, implementation plan, initial baseline, Host/Client owners, verification scripts.
- Retrieved: CodeGraph status/explore results, Git history, package manifests/changelogs.
- Missing authority: no prior ADR or release workflow.

## BaselineUsageDraft

- Required baseline refs: `docs/aegis/specs/2026-08-23-balance-status-release-design.md`, `docs/aegis/plans/2026-08-23-balance-status-release-plan.md`, `docs/aegis/baseline/2026-08-23-initial-baseline.md`
- Delivered context refs: CodeGraph index and current Git snapshot
- Acknowledged before plan refs: Host/Client ownership, config/credentials/cache boundaries, main-package release boundary
- Cited refs: design, plan, baseline, runtime files, package scripts
- Missing refs: prior ADR, workflow
- Decision: continue

## ImpactStatementDraft

- Host: persistent default, provider validation/query, formal cache, draft-test route.
- Client: conversation-local selection, status bar/menu, freshness, settings UI.
- Release: package/root metadata, changelogs, verification scripts, GitHub workflows.
- Invariants: old configs remain readable; credentials never exposed; legacy release line is not created; CodeGraph DB remains untracked.

## Execution Readiness View

- Intent Lock: four approved slices only.
- Scope Fence: no shell rewrite, polling/security redesign, legacy deletion, or npm publish expansion.
- Baseline Lock: unified `packages/dsh-balance` Host/Client are canonical.
- Compatibility Boundary: existing config, credentials, cache, security, bindings, and package checks remain valid.
- Retirement Boundary: no old-owner removal without evidence and explicit follow-up.
- Review Gates: CodeGraph impact before core edits; focused verification per task; final workflow/changelog review.
