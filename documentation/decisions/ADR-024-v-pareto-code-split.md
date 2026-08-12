---
type: adr
status: accepted
scope: protocol
review_trigger: "on protocol change"
created: 2026-08-12
last_updated: 2026-08-12
related:
  - documentation/decisions/ADR-021-durable-artifact-staging.md
  - documentation/decisions/ADR-006-kaizen-hunt.md
---

# ADR-024 — Split V-PARETO-02: discovery label vs filing gate

## Status

Accepted — 2026-08-12 (design track, issue #586, `design-aggregate.ts` verdict `ready`).

## Context

`V-PARETO-02` was overloaded with two incompatible rules:

1. **Discovery label** — reviewer logs improvement opportunities at WARN; orchestrator files later
   (`reviewer.md` §6). Thirty-five ledger occurrences, all NOTE/WARN.
2. **Filing gate** — Priority = Gain × (11 − Effort) must be ≥ 30 to file an issue; ready issues
   sorted by Priority descending (`phase-loop.md`, kaizen hunt).

The SSOT table declared **BLOCK** and cited `reviewer.md` §6 as the enforcement site — but §6
instructs **WARN**. A BLOCK severity that has never fired is documented fiction. Issue #567's
`vcode-severity-sync.check.ts` carries a named exemption pending this resolution.

ADR-021 D5 rejected **renumbering** `V-PARETO-02` (40 sites, 9 hunt-kind SSOT headings) to resolve
a mercure naming collision. That decision does not forbid minting a **fresh code** for the gate
rule that had no enforceable home.

## Decision

### D1 — Split by semantics, not by renumbering

| Code | Severity | Meaning | Enforcement site |
|------|----------|---------|------------------|
| `V-PARETO-02` | **WARN** | Improvement discovery label + Priority formula SSOT for hunt scoring | `reviewer.md` §6 (unchanged behavior) |
| `V-PARETO-03` | **BLOCK** | Pareto filing gate: Priority ≥ 30 to file; ready issues sorted descending | `scripts/checks/pareto-filing-gate.check.ts` |

Existing ledger rows keep `V-PARETO-02` — no silent reclassification.

### D2 — Hunt SSOT headings unchanged

The nine `## Scoring — V-PARETO-02 SSOT` headings in `src/references/hunt/*.md` remain — they
document the Priority **formula** for discovery scoring, per ADR-021 D5. Gate prose retargets to
`V-PARETO-03` in `phase-loop.md`, `orchestrator-dispatch.md`, `hunt/filing.md`, and peers.

### D3 — Mechanical gate audit

Add `scripts/checks/pareto-filing-gate.check.ts` verifying:

- `V-PARETO-02` table severity is WARN
- `V-PARETO-03` exists as BLOCK with gate description
- Filing-gate prose cites `V-PARETO-03`, not `V-PARETO-02`, for Priority ≥ 30

Remove `V-PARETO-02` from `KNOWN_SEVERITY_EXEMPTIONS` in `vcode-severity-sync.check.ts` (#567
unblocked).

### D4 — ADR-021 D5 disposition

**Upheld.** The `V-PARETO-02` identifier and hunt SSOT headings are preserved. The mercure
divergence note on the `V-PARETO-02` row remains; mercure's gold-plating meaning, if adopted,
still takes a fresh unused code.

## Consequences

- `VCODE_TABLE_ROW_COUNT` increments by 1; `EXPECTED_CHECK_COUNT` increments by 1 after live verify.
- Positive: both rules enforceable; severity model coherent; #567 exemption removable.
- Negative: one additional V-code row to maintain; ~12 `src/` prose sites retarget gate cites.
- Queue Priority sort remains orchestrator prose obligation under `V-PARETO-03` until a dedicated
  sort audit is warranted — filing gate is mechanically checked first.

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| Demote table to WARN only | Gate stays without BLOCK code or audit site (#438 defect pattern) |
| Elevate reviewer §6 to BLOCK | Contradicts §6 defer instruction; would reclassify 35 ledger rows |
