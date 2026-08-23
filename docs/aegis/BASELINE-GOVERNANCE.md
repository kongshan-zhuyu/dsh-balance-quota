# Baseline Governance

## 1. Baseline Roles
- Product / Requirement Baseline: confirmed requirement sources, target state, goals and scope, users / scenarios, requirement items, acceptance / verification criteria, non-goals, workflow constraints, open questions, change records, and approved requirement/spec intent.
- Architecture / Runtime Boundary Baseline: canonical owner, contract, source-of-truth boundary, dependency direction, compatibility, runtime-ready boundary, and retirement state.

## 2. Design Defect
A confirmed error, gap, contradiction, or wrong abstraction in the relevant requirement, design, or baseline.

## 3. Implementation Drift
Implementation, plan, review, or documentation has deviated from a confirmed, correct, unchanged requirement or architecture baseline.

## 4. Compatibility Aliases
- Architecture Defect = architecture-scoped Design Defect.
- Architecture Drift = architecture-scoped Implementation Drift.

## 5. Baseline Check Protocol
Before non-trivial changes:
1. Read the latest Product / Requirement Baseline candidate.
2. Read the latest Architecture / Runtime Boundary Baseline candidate.
3. Compare current work against requirement acceptance and architecture owner / contract boundaries.
4. Report aligned / Design Defect / Implementation Drift / missing-authority / needs-clarification, with scope.

## 6. Architecture Review
After each non-trivial change, review ownership integrity, module boundaries, contract changes, dependency direction, retirement completeness, and entropy flow.

## 7. Hard Boundaries
- This file governs this project's Aegis workspace.
- Baseline snapshots are evidence, not authority.
- ADRs record decisions; they do not replace baseline governance.
- Changes to this file require explicit user review.
