---
type: plan
summary: "Plan for reconciling `findings-ledger.json` deferred findings whose `deferred_to_issue` target has closed — new terminal-state transitions, a V-DEFER-01 advisory check, and a one-time backlog triage"
status: current
review_trigger: "on implementation"
created: 2026-09-03
last_updated: 2026-09-03
related: [src/references/findings-ledger.md]
---

# Plan - Issue #809

## Objective

`findings-ledger.json`'s `deferred → resolved` transition is documented as "optional cleanup"
(`findings-ledger.md` § Status transitions) and nothing ever reconciles a `deferred` finding
whose `deferred_to_issue` target closes — the ledger's own never-drop invariant is enforced at
filing time but not at closure time. Add a recorded (not read-time-inferred) terminal-state
transition, a per-turn mechanical check that surfaces the gap (advisory, reusing the
`V-WATCH-01`/`adr-watch.check.ts` shape), a one-time triage of the current backlog using a
reproducible classification rule, and an explicit documented answer to whether prose-only
sub-deferrals (the `#551` shape) are mechanically detectable.

**Live re-measurement (this session, re-run against `plan_base_commit` above — supersedes the
issue body's stale 70/54/119 figures, which predate 13+ merges this session):**

| Metric | Issue body (stale) | Live (this plan) |
|---|---|---|
| Total `deferred` findings | 119 | **122** |
| Distinct `deferred_to_issue` targets | — | **70** |
| Distinct targets now `CLOSED` on the forge | 54 | **60** |
| Distinct targets still `OPEN` | — | **10** |
| Findings deferred to a closed target | 70 | **82** |

Method: `jq` over `.blackhole/findings-ledger.json` for `status=="deferred"` rows with a
non-null `deferred_to_issue`, `unique` on that field for the 70 distinct targets, then
`gh issue view <N> --json state` per target (all 70 queried live). Cross-checked against
`.blackhole/queue.json`'s `issues["<N>"].status`: 59 of the 60 closed targets resolve locally to
`merged` or `closed` in queue.json (already forge-synced every turn — no live `gh` call needed
for the recurring check); **#624 is absent from queue.json entirely** (a `[Discovery]` issue
that was apparently never ingested/was pruned) — flagged as its own "untracked" category below,
not silently skipped.

Confirmed live instance (issue body's second example): 5 `V-CONTENTGATE-01` findings
(`F-00139/157/168/186`, plus a related `V-PARETO-02` `F-00192`) are deferred to **#545 (closed,
merged)**, describing a still-live "ceiling exhaustion" pattern. Verified still live at
`plan_base_commit`: `scripts/checks/plan-quality-gate.check.ts` sits at 217/218
`maxFileLoc` (the `scripts/checks/*.check.ts` budget), and `src/references/worker-schemas.md`
sits at 958/970 (budget was raised from 918→950→970 across the deferred findings' history — the
ceiling itself moved, the exhaustion pattern did not stop recurring). `ADR_WATCH_ITEMS`
(`scripts/lib/build/facts.ts`, consumed by `V-WATCH-01`/`adr-watch.check.ts`, #710) independently
tracks `worker-schemas.md`'s `ADR-007` threshold (700) with zero cross-reference to `#545`'s
ledger findings — confirming the issue body's "no cross-awareness" claim.

Confirmed instance one (`#551`): its 3 ledger rows (`F-00149/171/188`) show `#551` was itself a
properly `deferred_to_issue`-tracked target (now closed/merged) — the *un*trackable failure
mode is one level down: a decision recorded only in `#551`'s own issue body/PR prose ("deferred
to a follow-up issue") with no `deferred_to_issue` field anywhere pointing at it, later
rediscovered 3 weeks later and re-filed as `#803`. See AC5 below — this shape is explicitly
**not** solved by this plan.

## Touch-Paths

- `src/references/findings-ledger.md` — schema doc: new terminal-state semantics, new optional
  fields, extended state-transition diagram (source; also builds to
  `.claude/skills/blackhole/references/findings-ledger.md` and 4 sibling generated targets per
  `scripts/lib/build/targets.ts` — plus all generated dist trees per that SSOT, not
  hand-enumerated here per `V-INT-02`/`V-DRY-01`).
- `scripts/checks/deferred-reconciliation.check.ts` — new mechanical check (`V-DEFER-01`).
- `scripts/verify.deferred-reconciliation.test.ts` — pinning tests for the check (mirrors
  `scripts/verify.adr-watch.test.ts` naming/location convention).
- `scripts/triage-deferred-findings.ts` — one-time migration/triage CLI (AC4); reads
  `.blackhole/findings-ledger.json` + `.blackhole/queue.json`, shells out to `gh issue view`
  only for targets absent from `queue.json`, writes the triage result back via the existing
  atomic `.tmp` + `mv` + `state-write-guard.ts` protocol (`blackhole-state.md` § Write protocol
  — reused, not reinvented).
- `src/references/forge-sync.md` — per-turn cadence: add the reconciliation check to the same
  cadence table forge sync already documents (source; builds to `.claude/skills/blackhole/…`
  and the 4 sibling targets, same generated-dist-tree citation as above).
- `src/references/blackhole-vcodes.md` — new `V-DEFER-01` row (WARN, advisory, same severity
  class as `V-WATCH-01`).
- `scripts/lib/build/facts.ts` — no `CONTENT_GATE_BUDGETS`/`ADR_WATCH_ITEMS` value bump planned;
  touched only if `EXPECTED_CHECK_COUNT`-style successor counters exist and must reflect the new
  check (**re-derive the live value at implement time, never hand-freeze it here** — issue #769,
  restated in the Task Breakdown below).

## [docs_governance.enabled] Documentation Impact

- `src/references/findings-ledger.md` is itself the companion doc for the schema change — no
  separate `documentation/` consumer doc describes the ledger schema today (confirmed via grep:
  no `documentation/**/*.md` hit for "deferred_to_issue" or "status transitions" outside this
  reference file and the generated build targets).
- `documentation/audits/*` — none currently documents the ledger reconciliation gap; this plan
  itself becomes the durable record (staged per Step 7 below) rather than requiring a second
  audit doc (`V-DOC-GOV-01` search-before-write: grepped `documentation/` and
  `documentation/INDEX.md` for "reconciliation"/"deferred" — no match, no duplicate risk).
- `ARCHITECTURE.md` — not touched. The new check follows the existing `adr-watch.check.ts`
  pattern exactly (same file, same discovery mechanism via `scripts/verify.ts` glob); no new
  architectural boundary is introduced (Cross-Cutting Heuristic, `planner.md` §4.8 Trigger A,
  scores ≤1/3: single-subsystem, advisory-only, doesn't foreclose future approaches).

## [Standard Only] Critical Files

- `.blackhole/findings-ledger.json` — the live ledger the check reads and the triage script
  mutates; not created by this plan, pre-existing and load-bearing for the whole campaign.
- `.blackhole/queue.json` — read by both the check and the triage script as the local
  merged/closed signal; pre-existing, load-bearing.
- `scripts/lib/state-write-guard.ts` — the write-guard the triage script's mutation must go
  through; pre-existing.

## [Standard Only] Codebase Conventions

| Convention | Where | Reuse instruction |
|---|---|---|
| "Mechanical check surfacing a ledger-state gap, advisory not blocking" | `scripts/checks/adr-watch.check.ts` (`V-WATCH-01`, issue #710) | New `deferred-reconciliation.check.ts` follows the **exact same shape**: pure `find*Violations` function taking already-loaded data + returning `string[]`, a thin `check*` wrapper returning `[{ id, ok: true, ...(detail) }]` (always `ok: true` — advisory), and a file-absent-SKIP `runChecks()` entrypoint glob-discovered by `scripts/verify.ts`. Do not invent a second "advisory ledger gap" shape. |
| No-network-in-checks | Every `scripts/checks/*.check.ts` file (verified: none of the 30+ existing checks shell out to `gh`) | The recurring check reads only `.blackhole/findings-ledger.json` + `.blackhole/queue.json` (both already forge-synced every turn per `forge-sync.md` § Native auto-sync) — it never calls `gh` itself. The one-time triage script (`scripts/triage-deferred-findings.ts`) is the sole exception, and only for targets absent from `queue.json` (e.g. `#624`) — documented inline as a deliberate, scoped divergence. |
| Ledger write protocol | `blackhole-state.md` § Write protocol, `findings-ledger.md` § Write protocol | Triage script's mutation (AC4) reuses the identical `.tmp` + `state-write-guard.ts --entity-key findings` + atomic `mv` sequence — no new write path. |
| File-absent-SKIP discipline | `adr-watch.check.ts`, `queue-coherence.check.ts`, `parity-matrix.check.ts` | New check returns `ok: true` with no violations when either `.blackhole/findings-ledger.json` or `.blackhole/queue.json` is missing (a PR worktree/CI run never has `.blackhole/`, gitignored, main-clone-only). |
| Pure-logic/IO-wrapper split for testability | `findAdrWatchViolations` (pure) vs `checkAdrWatch` (IO) in `adr-watch.check.ts` | New check exports `findUnreconciledDeferrals(findings, queueIssues)` as the pure, in-memory-testable core; `checkDeferredReconciliation` wraps file reads around it — mirrors the existing split exactly (`V-INT-01`/`V-INT-03`: no third variant of "how a check is tested"). |
| V-code table row format | `src/references/blackhole-vcodes.md` | New `V-DEFER-01` row follows the exact column shape (`Code \| Rule \| Severity \| Primary enforcement site`) of the adjacent `V-WATCH-01` row. |

## [Standard Only] Database/API Schema Changes

`.blackhole/findings-ledger.json` finding-row schema gains **additive-only** optional fields —
no existing field's type or required-ness changes, so `V-LEDGER-01`
(`scripts/checks/ledger-schema.check.ts`) is unaffected (verified: that check only inspects
`issue_ref`/`pr_ref`/legacy `pr`, ignores unknown keys).

| Field | Type | When set |
|---|---|---|
| `status` | *(existing enum, unchanged: `open \| fixed-in-pr \| deferred \| resolved`)* | `deferred → resolved` (AC1a: target closed AND the reconciliation rule classifies the work as shipped) or `deferred → open` (AC1b, **new transition**: target closed but the rule classifies the work as NOT shipped — reopens the finding into the normal open-finding flow rather than leaving it permanently invisible behind a closed issue) |
| `reconciled_at` | ISO timestamp \| absent | Set the turn the reconciliation check/triage script transitions the row — **recorded, not inferred at read time** (AC1's explicit requirement) |
| `reconciliation_rule` | string \| absent | One of `"closed-pr-title-match"` \| `"closed-pr-body-match"` \| `"manual-triage"` — which reproducible rule (AC4) fired; `"manual-triage"` covers the one-time backlog triage's human-confirmed rows where the automated title/body match was ambiguous |

`findings-ledger.md` § Status transitions gains one new line:

```
deferred → open        (deferred_to_issue closed WITHOUT the work shipping — reopened, not dropped)
```

and the existing `deferred → resolved (when deferred issue merges — optional cleanup)` line is
reworded to drop "optional" — AC1 makes this transition **mandatory** (mechanically detected by
`V-DEFER-01`, executed by the triage script for the existing backlog and, going forward, by
whatever process closes the orchestrator's own `deferred_to_issue` targets — see Task 3 below
for the exact ownership boundary this plan draws).

## Threat Model

Not applicable — `route.security_review_required: false` in `queue.json`, and this plan touches
no auth/authz, no user-data read/write path, and adds no new endpoint. Per Quick Track's mirror
bullet (this plan is Standard track; same trigger logic): all three STRIDE-lite screen questions
resolve "no". Section omitted per the conditional-omission discipline.

## [Standard Only] Execution Strategy & Stop Conditions

- If `findUnreconciledDeferrals`'s pure-function unit tests cannot express both a "target closed,
  work shipped" and a "target closed, work not shipped" fixture pair (AC3's own requirement),
  halt Task 2 and escalate — a check that cannot demonstrably fail is not shippable per AC3.
- If the one-time triage script's title/body-match heuristic (AC4) produces a false-shipped
  classification on manual spot-check of 5 sampled closed targets, abort the automated
  transition for that batch and fall back to `reconciliation_rule: "manual-triage"` for the
  entire run rather than trusting an unverified heuristic at scale.
- If `bun run scripts/verify.ts` (full suite) regresses any pre-existing check after the new
  check is wired into `scripts/checks/`, revert the `verify.ts` glob-discovery wiring change and
  re-diagnose before re-attempting — never leave `verify.ts` red mid-implementation.
- If the triage script's `gh issue view` fallback (for targets absent from `queue.json`, e.g.
  `#624`) hits a rate limit or auth failure, stop the run and report the partial result rather
  than silently treating an unreachable target as "open" (a false "unreconciled" is safe/visible;
  a false "resolved" from an unreachable target is not).

## Task Breakdown

- [ ] **T1 — Schema doc: terminal-state semantics.** Edit `src/references/findings-ledger.md` §
  Status transitions and § Field rules per the Database/API Schema Changes section above: add
  `reconciled_at`/`reconciliation_rule` optional fields, the new `deferred → open` transition
  line, and reword the existing `deferred → resolved` line to drop "optional". Add a new
  subsection documenting AC5's answer verbatim (see T5). — **AC**: `grep -c "deferred → open"
  src/references/findings-ledger.md` returns ≥1; `grep -c "reconciliation_rule"
  src/references/findings-ledger.md` returns ≥1; rebuild (`bun run build`) and confirm the
  generated `.claude/skills/blackhole/references/findings-ledger.md` mirrors the same 2 greps.

- [ ] **T2 — Mechanical check (`V-DEFER-01`).** Create
  `scripts/checks/deferred-reconciliation.check.ts` following the `adr-watch.check.ts` shape
  (Codebase Conventions row 1): export `findUnreconciledDeferrals(findings: LedgerRow[],
  queueIssues: Record<string, {status: string}>): string[]` — pure, returns one description
  string per `deferred` row whose `deferred_to_issue` target resolves to `queue.json` status
  `closed`/`merged` (or is absent from `queueIssues` entirely — the "untracked" category,
  labelled distinctly in the returned string, per the Objective's `#624` finding) and has no
  `reconciled_at` set yet. Export `checkDeferredReconciliation(ledgerFile, queueFile):
  CheckResult` — file-absent-SKIP on either input, wraps the pure function, always `ok: true`
  (advisory). Export `runChecks()` for `scripts/verify.ts`'s glob discovery. — **AC**: `bun run
  scripts/verify.ts` discovers and runs the new check with no crash; a live invocation against
  `plan_base_commit`'s ledger/queue snapshot reports a count consistent with this plan's live
  re-measurement (82 findings across 60 closed + 1 untracked target, ±drift from any merges
  between plan time and implement time).

- [ ] **T3 — Pinning tests + fixtures (AC3).** Create
  `scripts/verify.deferred-reconciliation.test.ts` mirroring
  `scripts/verify.adr-watch.test.ts`'s structure: (a) pure-function tests for
  `findUnreconciledDeferrals` with an in-memory fixture pair — one `deferred` row whose target is
  `open` in `queueIssues` (must NOT be flagged) and one whose target is `closed` (must BE
  flagged) — proving the check can fail; (b) a temp-dir fixture (`makeTempDir`, reused per
  `V-INT-02`) writing a minimal `findings-ledger.json` + `queue.json` pair to disk and asserting
  `checkDeferredReconciliation` returns `ok: true` with a non-empty `detail` on the violating
  fixture and `ok: true` with no `detail` on the clean one; (c) file-absent-SKIP test for both
  missing-ledger and missing-queue cases. — **AC**: `bun test
  scripts/verify.deferred-reconciliation.test.ts` passes, and includes at least one assertion
  that fails if `findUnreconciledDeferrals` is replaced with a stub returning `[]`
  unconditionally (demonstrates the fixture is not vacuously true — direct AC3 requirement).

- [ ] **T4 — One-time triage script (AC4).** Create `scripts/triage-deferred-findings.ts`: reads
  live `.blackhole/findings-ledger.json`, for each `deferred` row resolves its
  `deferred_to_issue` target's closure state from `.blackhole/queue.json` first, falling back to
  `gh issue view <N> --json state,closedAt` only when the target key is absent from
  `queue.json["issues"]` (documented, scoped exception to the no-network-in-checks convention,
  Codebase Conventions row 2). Classify each closed-target row via the **reproducible rule**
  named in AC4's own text: "closed via a merged PR whose title/body explicitly references the
  finding's `vcode` or `file`" → `status: resolved`, `reconciliation_rule:
  "closed-pr-title-match"` or `"closed-pr-body-match"`; every other closed-target row →
  `status: open` (drop `deferred_to_issue`'s deferral, since the target no longer covers it),
  `reconciliation_rule: "manual-triage"` (flagged for human confirmation in the run's summary
  output, per this plan's Stop Condition on false-shipped risk). Record `reconciled_at` on every
  transitioned row. Write back via the atomic `.tmp` + `state-write-guard.ts` + `mv` sequence
  (Codebase Conventions row 3) — never a direct in-place edit. Print a summary: N rows examined,
  N resolved, N reopened, N flagged manual, N untracked/unreachable. — **AC**: a dry-run
  (`--dry-run` flag, no write) against the live ledger at implement time reproduces this plan's
  count (re-derived live, not the frozen 82/60 figures above — issue #769 discipline) within
  the delta explainable by merges between plan time and implement time; a real run leaves
  `bun run scripts/lib/state-write-guard.ts --tmp <output> --live
  .blackhole/findings-ledger.json --entity-key findings` passing before install.

- [ ] **T5 — AC5: prose-only sub-deferral detectability (documented limitation, not an
  attempted feature).** Add a subsection to `src/references/findings-ledger.md` (part of T1's
  edit) titled "Known limitation: prose-only sub-deferrals are not mechanically detected." State
  plainly: a deferral recorded only as prose inside an issue body, a PR description, or a
  rule-file decision record — with no `deferred_to_issue` field anywhere — cannot be found by
  grepping `findings-ledger.json`, because the ledger has no row to examine in the first place.
  Detecting this shape would require full-text NLP/semantic search across every closed issue's
  body and every merged PR's description looking for deferral-shaped language ("deferred to",
  "follow-up issue", "tracked separately") with no structured anchor — explicitly out of scope
  for this plan (`V-KISS-01`/`V-YAGNI-01`: no speculative NLP pipeline for a problem with no
  current reproducible trigger). The `#551`→`#803` incident (3-week detection lag) is the
  concrete cost of this gap, cited as the worked example. No code task follows from this AC —
  it is fully satisfied by the documentation itself. — **AC**: the subsection exists verbatim in
  `src/references/findings-ledger.md`, states "not mechanically detected" (or equivalent
  unambiguous negative), and cites `#551`/`#803` as the worked example.

- [ ] **T6 — Per-turn cadence wiring (AC2).** Edit `src/references/forge-sync.md` § Native
  auto-sync's cadence table: add a row `| Start of every orchestrator turn (after sync) |
  Run V-DEFER-01 reconciliation check |` immediately after the existing "Start of every
  orchestrator turn | Full sync" row — same table, same cadence, not a new mechanism (mirrors
  `blackhole-state.md` § Doc-Health Signal's "Same cadence as § Sync above" pattern rather than
  inventing a second cadence primitive). Cross-link from `blackhole-vcodes.md`'s new
  `V-DEFER-01` row to this cadence line. — **AC**: `grep -A1 "Start of every orchestrator turn"
  src/references/forge-sync.md` shows the new row; the generated
  `.claude/skills/blackhole/references/forge-sync.md` mirrors it post-build.

- [ ] **T7 — V-code registration.** Add a `V-DEFER-01` row to `src/references/blackhole-vcodes.md`
  in the existing table, severity `WARN`, primary enforcement site
  `scripts/checks/deferred-reconciliation.check.ts` (mirrors the adjacent `V-WATCH-01` row's
  format exactly). If `blackhole-vcodes.md` (the project rule file surfaced to every agent
  prompt, distinct from the `src/references/` source) needs a corresponding sync step, follow
  whatever existing sync mechanism keeps `.claude/rules/blackhole-vcodes.md` and
  `src/references/blackhole-vcodes.md` aligned — do not hand-invent a new sync path; re-derive
  the live mechanism at implement time (grep the build script for how `.claude/rules/*` is
  populated) rather than assuming this plan's read of it is still current. — **AC**: `grep -c
  "V-DEFER-01" src/references/blackhole-vcodes.md` returns ≥1; `bun run verify` still passes
  (no `EXPECTED_CHECK_COUNT`-style counter mismatch — re-derive the live expected count at
  implement time rather than hand-freezing a number here, issue #769).

- [ ] **T8 — Full verify + baseline regression check.** Run `bun run verify` (or the project's
  canonical check-suite command, re-derived at implement time) and the full `bun test` suite
  once at the end, through `with-test-lock` per the resource-frugal-testing rule. — **AC**: full
  suite green, quoted in the completion evidence; no pre-existing check regresses.

## Sprint Contract

All tasks above carry their own machine-verifiable `**AC**`. Definition of done for any task
with no narrower AC (none in this plan — every task above has one): full test suite + lint +
`bun run verify` pass.

## [Standard Only] Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |
| `ac_sweep_conflict` | PASS |
| `ac_sweep_scope` | PASS |
| `touch_paths_ssot_gap` | PASS |
| `ac_facts_literal_bump` | PASS |
