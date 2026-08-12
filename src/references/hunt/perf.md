# Hunt Kind: Perf

Scan heuristics, calibration table, and scoring rule for the `perf` hunt kind
(`kaizen.kinds`, [config-template.md](../config-template.md)). Ships the runtime hot-path hunt
kind named as a deferred seam in ADR-006 § Hunt kinds: audits **structural performance defects**
visible in code (v1 primary) and **documented baseline regressions** when a merged plan artifact
carries a `## Performance Budget` row (v1 secondary). `perf` is a pure additive extension: it
reuses every existing kaizen mechanism verbatim — the `V-HUNT-01` `CONFIRMED` verification
gate, `V-PARETO-02` scoring, per-wave caps, ledger idempotency dedup, and the `hunt_state`
watermark (`territory.bands_scanned` / `bands_done`). It introduces no new scoring formula, no
new ledger field, no new finding schema, and no change to `V-HUNT-01`/`V-HUNT-02` gating logic —
every candidate passes through the existing CONFIRMED verification pass (`hunter.md` §
Verification pass) and the existing `phase-loop.md` § Kaizen hunt dispatch 5-step wave protocol
unmodified.

## Territory bands

`perf` bands by **runtime-criticality directory globs** (`coverage.md`-style) — one band per wave,
picked from unscanned `hunt_state.kinds.perf.bands_done` at spawn:

| Band | Territory (illustrative — reason from the actual codebase, not a fixed list) |
|------|-------------------------------------------------------------------------------|
| P1 | `scripts/verify.ts`, `scripts/build.ts`, forge-sync hot paths |
| P2 | `scripts/lib/**`, `scripts/checks/**` |
| P3 | `src/agents/**` (protocol agents — LOC/content gates, not latency, but sync patterns matter) |
| P4 | Peripheral tooling, fixtures, templates |

## Scan heuristics

A `perf` wave audits a campaign repo's runtime hot paths for evidence-backed performance gaps —
never a hunch, and never a subjective "feels slow" judgment. Every candidate is read/trace-verified
before it is reported (`hunter.md` § Verification pass). `CONFIRMED` for `perf` means **either**
Path 1 or Path 2 below after the unconditional `V-HUNT-01` re-read of every cited `file:line`
(or sentinel) and `evidence_snippet` verification.

### Static hot-path anti-patterns (Path 1 — v1 primary)

The cited `file:line` still exhibits a read-verified **structural perf defect** from this closed
list aligned with `V-PERF-01`:

1. **N+1 query pattern** — query/IO inside a loop over a collection
2. **Synchronous blocking I/O** in an async or request-handling path
3. **Unbounded pagination** — missing `limit` on a list fetch
4. **Full-table scan or unindexed sort** where an index/key path exists
5. **Repeated identical expensive call** inside a loop without memoization
6. **Nested loop over full collection** where a map/index lookup is available

**Not CONFIRMED via Path 1:** plausible hunches, structural issues already covered by `bug`
(wrong output), missing tests (`coverage`/`quickwins`), pure complexity/SRP
(`best-practices`/`refactor`), or latency claims without a visible code pattern.

### Regression heuristics (Path 2 — v1 secondary, gated)

A **re-run measurement** during the wave shows violation of a **pre-existing documented threshold**
with a committed source citation — either:

- A `## Performance Budget` row in a merged plan artifact (`.blackhole/plans/issue-N.md` or
  promoted plan) with component, baseline metric, threshold, and source citation; **or**
- A future companion `perf-budgets.md` with `status: current` (**out of scope v1** — do not
  scaffold or invent)

For Path 2, `CONFIRMED` additionally requires the measurement output to be captured in
`evidence_snippet` (≤8 lines) and the threshold breach demonstrated against the cited baseline
row — not a subjective judgment.

When Path 2 prerequisites are absent (no measurement command **and** no `status: current` budget
artifact), see § No-baseline degradation below — do not round up unmeasured hunches to
`CONFIRMED`.

Every finding is read-verified before it is reported: the hunter re-reads the cited `file:line`,
sentinel, or measurement output and only reports `CONFIRMED` findings
([worker-schemas.md](../worker-schemas.md) § Hunter). A `CONFIRMED` `perf` finding that clears
the `Priority >= 30` gate files through the same shared [filing.md](filing.md) issue-body template
every other kind uses.

## Finding file/line convention

Like `parity.md` and `ux-coherence.md`, this kind's candidates are not naturally
single-file/single-line for every heuristic:

| Heuristic | `file` | `line` | Rationale |
|-----------|--------|--------|-----------|
| Static hot-path anti-pattern (Path 1) | The source file exhibiting the defect | line of the defect | Anchors to the read-verified structural pattern |
| Regression baseline breach (Path 2) | Sentinel `budget:<plan-issue>` or `budget:<component-slug>` | `0` | The finding concerns a documented budget row, not a single source line |

## Severity-term reconciliation note

Like every other hunt kind, the hunter's already-shipped output contract
(`worker-schemas.md` § Hunter, Finding shape) gives `severity` the enum
`LOW | MEDIUM | HIGH | BLOCK`. This kind **reuses that enum as-is** — it does not introduce a
new tier, and it introduces no severity floor the way `bug.md` does. **This kind never assigns
`severity: BLOCK`**: performance gaps surfaced by this hunt are maintainability and runtime-efficiency
items, not code-breaking defects. `perf` findings go through the normal `Priority >= 30` gate like
every kind other than `bug`'s severity-floor exception (precedent: `parity.md`, `ux-coherence.md`).

## Calibration table

| Heuristic | Trigger | Gain range | Effort range | Severity range | Worked example |
|-----------|---------|------------|---------------|-----------------|-----------------|
| N+1 query / IO-in-loop (Path 1) | Read-verified query or I/O call inside a loop over a collection in a hot path | 6–9 | 3–6 | MEDIUM–HIGH | `scripts/lib/sync.ts` issues one `gh api` call per issue inside `for (const issue of issues)` with no batching (illustrative, invented) → gain 8, effort 4, severity HIGH → Priority 8 × (11 − 4) = 8 × 7 = 56 (strong candidate) |
| Sync blocking I/O in async path (Path 1) | Read-verified synchronous `readFileSync`/`execSync` in an async handler or request path | 5–8 | 2–5 | MEDIUM–HIGH | `scripts/verify.ts` uses `readFileSync` inside an `async function runCheck()` on every verify invocation (illustrative, invented) → gain 7, effort 3, severity HIGH → Priority 7 × (11 − 3) = 7 × 8 = 56 (strong candidate) |
| Unbounded fetch / missing limit (Path 1) | Read-verified list fetch without pagination cap on a potentially large collection | 4–7 | 2–4 | MEDIUM | A forge-sync helper fetches all open issues with no `limit` or cursor (illustrative, invented) → gain 6, effort 3, severity MEDIUM → Priority 6 × (11 − 3) = 6 × 8 = 48 (moderate) |
| Performance Budget regression (Path 2) | Re-run measurement breaches a cited `## Performance Budget` row threshold with evidence in `evidence_snippet` | 7–9 | 3–6 | MEDIUM–HIGH | Plan `issue-100.md` documents `verify.ts` wall time baseline 12s / threshold 15s; wave re-run shows 18s captured in `evidence_snippet` (illustrative, invented) → gain 8, effort 4, severity HIGH → Priority 8 × (11 − 4) = 8 × 7 = 56 (strong candidate) |

`gain` and `effort` are each 1–10, matching the hunter output contract (`worker-schemas.md` §
Hunter, Finding shape). Severity never reaches `BLOCK` for this kind, per the reconciliation note
above.

## No-baseline degradation

When a wave targets Path 2 regression heuristics but **both** (a) no detectable measurement
command exists in `package.json`/CI **and** (b) no `status: current` budget artifact exists
(no merged plan `## Performance Budget` row and no `perf-budgets.md` companion), the wave
degrades to a **logged no-op** — explicitly **not** a failure, and **not** an empty `CONFIRMED`
findings list to be read as "perf is fine."

The wave note must say plainly that no baseline artifact and no measurement runner were found and
no regression analysis ran. Path 1 static heuristics remain fully applicable in the same wave when
the territory band contains scannable source — only the regression branch is skipped.

This distinction matters for the orchestrator's dry-wave counting: ADR-006's stop condition
("3 consecutive waves filing zero issues → territory exhausted") is about *waves that ran and
genuinely found nothing to file*. A degraded, non-running regression branch must not be conflated
with a dry wave.

## Scoring — V-PARETO-02 SSOT

`Priority = Gain * (11 - Effort)`; a finding must score `>= 30` to be filed as an issue, and
ready issues are sorted by Priority descending
([blackhole-vcodes.md](../blackhole-vcodes.md), `V-PARETO-02`). This is the **only** scoring
formula for the `perf` kind — no alternate or per-kind formula is introduced. Findings scoring
below 30 are archived in the ledger and never filed, per the same rule every other kind follows.
