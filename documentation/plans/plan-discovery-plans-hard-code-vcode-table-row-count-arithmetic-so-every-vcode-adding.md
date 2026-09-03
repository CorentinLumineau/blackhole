---
issue: #769
supersedes_adr: null
type: plan
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
---


# Plan — Issue #769: generalize the facts.ts literal-bump anti-pattern in plan-authoring

Filed as a Discovery after PR #765 (90→91 on `VCODE_TABLE_ROW_COUNT`) invalidated five queued
plans at once. Two of those five (`#710`, `#718`) have already merged this session — #718 via
PR #820, which itself bumped `VCODE_TABLE_ROW_COUNT` from a **live** count, not a stale literal,
so it is not an instance of the bug. Router notes confirm scope is reduced to the 3 remaining
live plans: `#711` (ready/implement), `#724` (ready/implement), `#719` (ready/plan). Re-verified
directly against `.blackhole/queue.json` at plan time (see Codebase Conventions).

The live `VCODE_TABLE_ROW_COUNT` in `scripts/lib/build/facts.ts:31` is currently **94** — already
moved twice past the issue body's cited values (91 → 94), which is itself the proof this class of
bug reproduces every time a `V-` row is added. The fix is not "correct the number" (it will be
wrong again within hours) but "make the plan-authoring convention structurally unable to freeze
that number."

## Objective

`src/references/plan-template.md` must state — as a general rule, not a `VCODE_TABLE_ROW_COUNT`-
specific footnote — that an acceptance criterion referencing a live-derived count from
`scripts/lib/build/facts.ts`'s `§ facts` block (`VCODE_TABLE_ROW_COUNT`, `EXPECTED_CHECK_COUNT`
successor counters, `CONTENT_GATE_BUDGETS` entries, `DOC_HEALTH_THRESHOLDS` values, or any future
addition to that block) MUST be expressed as a re-derivation instruction to run at implement time
(e.g. "read the live table via `parseVcodeTableRows`, then declare `count + 1`"), never as a
literal number measured at plan time. `scripts/checks/plan-quality-gate.check.ts` gains a matching
advisory detector (`findFactsLiteralBumps`) that flags a Task Breakdown bullet containing this
anti-pattern shape, surfaced the same way `ac_sweep_conflict`/`ac_sweep_scope` already are —
`ADVISORY:` rows in `## Quality Gate Results`, never `failing_checks`, never blocking (issue's own
AC: "advisory, plan-authoring smell not a code defect"). The three still-live stale plans
(`#711`, `#724`, `#719`) get their frozen-number instructions corrected to the same re-derivation
pattern, gated on a fresh queue-status check at dispatch time (they may drift again between this
plan's approval and its implementation).

**Out of scope** (per issue body): removing `VCODE_TABLE_ROW_COUNT` itself — `V-GROUND-01`
depends on it existing as a declared fact to check the live table against.

## Touch-Paths

- `src/references/plan-template.md` — generalizes the literal-bump prohibition beyond
  `VCODE_TABLE_ROW_COUNT` to the `facts.ts` `§ facts` class, and adds the `ac_facts_literal_bump`
  advisory row to the `## Quality Gate Results` table example (Standard Track section).
  Plus all generated dist trees per `scripts/lib/build/targets.ts`.
- `scripts/checks/plan-quality-gate.check.ts` — new pure export `findFactsLiteralBumps`
  (detector only; not wired into `PLAN_QUALITY_GATE_REQUIRED_MARKERS` or the CLI's
  `{ac_mapping, critical_files_exist, mitigation_concrete}` JSON contract — same
  advisory-only, ungrounded shape as the existing `findSweepRetainConflicts`/
  `findUnscopedSweepACs` exports in this same file).
- `scripts/verify.plan-quality-gate.test.ts` — TDD tests for `findFactsLiteralBumps` (this is
  where the file's other pure-detector tests already live — `findMissingCriticalFiles`,
  `findVagueMitigations`, `findSweepRetainConflicts`, `findUnscopedSweepACs` — not
  `scripts/plan-quality-gate.test.ts`, which tests only the CLI wrapper's own
  `findMissingAcMapping`/`extractSection`/argv parsing).
- `.blackhole/plans/issue-711.md` — gitignored campaign protocol state, not part of the git
  diff/PR; corrects the frozen "`VCODE_TABLE_ROW_COUNT` in `facts.ts` from `89` to `90`"
  instruction (line ~192) to a live re-derivation. Edited only if #711 is still
  `status: ready` at dispatch time (Task Breakdown gate below).
- `.blackhole/plans/issue-724.md` — same gitignored-state caveat; corrects the frozen
  "currently `89`" / "from `89` to `90`" instructions (lines ~52, ~209-212). Edited only if
  #724 is still `status: ready` at dispatch time.
- `.blackhole/plans/issue-719.md` — same gitignored-state caveat; corrects T5's frozen
  "must read `90`" / "bumped to `91`" AC (lines ~144-145) to a live re-derivation. Edited only
  if #719 is still `status: ready` at dispatch time.

## Documentation Impact

`src/references/plan-template.md` **is** the doc being fixed — the anti-pattern this issue closes
lives entirely in that file's Standard Track template prose (`## [Standard Only] Execution
Strategy & Stop Conditions` / `## Task Breakdown` example text and the `## Quality Gate Results`
table). No other consumer doc references this convention independently (confirmed by grep: no
hits for "literal bump" / "VCODE_TABLE_ROW_COUNT" outside `plan-template.md`,
`plan-quality-gate.check.ts`'s own comments, `facts.ts`, and the three stale plan files listed
under Touch-Paths). This plan's own durable body is staged for promotion into
`documentation/plans/` per ADR-021 D3 (see § Execution Strategy).

## Critical Files

None — this is a plan-authoring/tooling convention fix. No database client, auth config, or
other pre-existing sensitive touchpoint is in scope.

## Codebase Conventions

| Concern | Convention | Citation |
|---|---|---|
| Live row-count derivation | Never hand-count a markdown table; parse it | `parseVcodeTableRows` (`scripts/lib/check-common.ts:73-86`) — already the pattern `.blackhole/plans/issue-712.md` § Execution Strategy risk 3 cites as the correct approach |
| Pure detector + CLI split | Detection logic lives in `*.check.ts` as pure, fixture-testable exports; a thin CLI (`scripts/plan-quality-gate.ts`) wraps only the mechanical/blocking subset against real fs | `scripts/checks/plan-quality-gate.check.ts` header comment; `scripts/plan-quality-gate.ts:52-65` |
| Advisory-only detectors stay ungrounded | `findSweepRetainConflicts`/`findUnscopedSweepACs`/`findTouchPathSsotGaps` are exported for the planner to invoke directly (not in `PLAN_QUALITY_GATE_REQUIRED_MARKERS`, not in the CLI's JSON contract) since they never gate merge | `scripts/checks/plan-quality-gate.check.ts:67-100` |
| Queue status is re-verified live, never trusted from an issue body | `python3 -c "import json; d=json.load(open('.blackhole/queue.json')); print(d['issues']['<N>']['status'], d['issues']['<N>']['phase'])"` — confirmed at plan time: #710/#718 `status: merged`; #711/#724/#719 `status: ready` | `.blackhole/queue.json` (read at plan time, `plan_base_commit` above) |
| Durable-artifact staging (never a direct `documentation/` write at Phase 2) | Atomic heredoc + `mv` into `.blackhole/staged/<issue>/`, manifest append | `.claude/rules/blackhole-state.md` § Staging (ADR-021 D1/D3) |

## Database/API Schema Changes

None.

## Threat Model

Triggered mechanically by `route.security_review_required: true` — router notes explicitly
attribute this to an incidental "token" identifier grep match in
`scripts/checks/plan-quality-gate.check.ts` (existing text-parser variable/comment vocabulary,
e.g. token/parsing terminology unrelated to auth), not a real security exposure. Per `V-SEC-09`
(raise-only rule), the flag cannot be lowered even though the underlying finding is a false
positive — so this section is required by the mechanical trigger while its rows are, correctly,
mostly N/A. This is a plan-authoring/documentation-and-static-analysis change with no runtime
surface, no network boundary, no auth/session/credential touchpoint, and no user-facing data path.

| Threat | Severity | Mitigation Status |
|---|---|---|
| Spoofing | N/A | Accepted Risk — no identity/auth surface in scope |
| Tampering | N/A | Accepted Risk — no runtime data path; changes are to markdown templates and a static-analysis detector |
| Repudiation | N/A | Accepted Risk — no user-attributable action recorded by this change |
| Information Disclosure | N/A | Accepted Risk — the "token" grep hit is a pre-existing parser-identifier false positive (router-confirmed); no secret/credential handling is touched |
| Denial of Service | N/A | Accepted Risk — `findFactsLiteralBumps` runs the same bounded per-line regex scan as its sibling detectors in this file; no unbounded loop or resource amplification introduced |
| Elevation of Privilege | N/A | Accepted Risk — no authorization logic in scope |

## Execution Strategy & Stop Conditions

1. **Stale-scope re-verification is mandatory before any `.blackhole/plans/issue-*.md` edit.**
   If a fresh `queue.json` read at dispatch time shows #711, #724, or #719 has since merged,
   been superseded, or moved off `status: ready`, **abort** that file's correction task and
   record it as a no-op in the completion evidence — do not edit a plan file for a
   no-longer-live issue (this issue's own body demonstrates exactly this failure mode: it was
   filed against 5 targets, 2 of which had already merged by plan time).
2. **The new detector must not become a merge gate.** If any part of this implementation wires
   `findFactsLiteralBumps` into `PLAN_QUALITY_GATE_REQUIRED_MARKERS`, the CLI's
   `{ac_mapping, critical_files_exist, mitigation_concrete}` JSON contract, or any
   `failing_checks` value, **halt and revert that wiring** — the issue's own AC calls this
   "advisory, plan-authoring smell not a code defect," matching the existing
   `ac_sweep_conflict`/`ac_sweep_scope` precedent exactly.
3. **Re-derivation instructions must not themselves freeze a number.** If the corrected text in
   `#711`/`#724`/`#719` (or the generalized `plan-template.md` rule) states a specific integer
   for `VCODE_TABLE_ROW_COUNT` or any other `facts.ts` `§ facts` value rather than a
   `parseVcodeTableRows`-style live-derivation instruction, **stop and rewrite** — landing a
   fresh literal is the exact regression this issue exists to close.
4. **Hot-file coordination.** `scripts/checks/plan-quality-gate.check.ts` is touched by this
   plan alone in this wave (confirmed no other `in_flight` issue in `queue.json` at
   `plan_base_commit` declares it as a touch-path); no wave-lock coordination note is required,
   unlike `facts.ts`/`blackhole-vcodes.md`'s documented hot-file status.

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run `bun test scripts/plan-quality-gate.test.ts scripts/verify.plan-quality-gate.test.ts` before any change. — **AC**: baseline pass/fail counts quoted in the completion evidence; all green (neither file is otherwise touched at `plan_base_commit`).
- [ ] **T1 — `findFactsLiteralBumps` (Red)**: Add failing tests to `scripts/verify.plan-quality-gate.test.ts`: (a) a Task Breakdown bullet containing `` `VCODE_TABLE_ROW_COUNT` (currently `89`) `` plus "from `89` to `90`" is flagged with the constant name and both numbers; (b) a bullet naming a live re-derivation (e.g. "read via `parseVcodeTableRows`, then declare `count + 1`") is NOT flagged; (c) a bullet with an unrelated `from X to Y` phrase but no SCREAMING_SNAKE_CASE constant token is NOT flagged (false-positive guard); (d) empty section returns `[]`. — **AC**: all 4 new tests exist and fail for the expected reason (no `findFactsLiteralBumps` export yet).
- [ ] **T1 — `findFactsLiteralBumps` (Green)**: Implement in `scripts/checks/plan-quality-gate.check.ts`, reusing `splitTaskBreakdownBullets` (never a new bullet-parsing primitive — `V-INT-02`). Detect a bullet matching a literal-arithmetic pattern (`from` + digit + `to` + digit) co-occurring with a SCREAMING_SNAKE_CASE identifier token, mirroring `findSweepRetainConflicts`'s existing regex-pair shape in this same file. Export the function and its pattern constants alongside the existing advisory exports (no CLI wiring — see § Execution Strategy item 2). — **AC**: all 4 T1 tests pass; no change to `scripts/plan-quality-gate.ts`'s `if (import.meta.main)` JSON output; `PLAN_QUALITY_GATE_REQUIRED_MARKERS` unchanged.
- [ ] **T2 — Generalize `plan-template.md`**: Edit `src/references/plan-template.md`'s Standard Track section to state the general rule (name the class: "any `facts.ts` `§ facts` value a plan proposes to bump" — `VCODE_TABLE_ROW_COUNT` as the worked example, not the only instance) and add an `ac_facts_literal_bump` row (`PASS \| ADVISORY`) to the `## Quality Gate Results` table example, in the same style as the existing `ac_sweep_conflict`/`ac_sweep_scope`/`touch_paths_ssot_gap` rows. — **AC**: `grep -c '^| \`ac_' src/references/plan-template.md` increases by exactly 1; the new prose names `facts.ts` `§ facts` as the general class, not only `VCODE_TABLE_ROW_COUNT`.
- [ ] **Rebuild dist trees**: Run `bun run build` and commit every regenerated mirror of `plan-template.md` (`V-BUILD-01`). — **AC**: `git status --porcelain` empty after build; only `src/references/plan-template.md`'s own mirrors change (`scripts/checks/plan-quality-gate.check.ts` is under `scripts/`, not mirrored).
- [ ] **T3 — Re-verify live queue status**: Immediately before editing any of `.blackhole/plans/issue-711.md`, `issue-724.md`, `issue-719.md`, re-read `.blackhole/queue.json` fresh (not this plan's `plan_base_commit` snapshot) for each issue's `status`/`phase`. — **AC**: for each of the 3 issues, the completion evidence quotes its live `status`/`phase` at edit time; any issue found off `status: ready` is skipped per § Execution Strategy item 1, with a one-line note, and its corresponding correction task below is marked no-op rather than applied.
- [ ] **T4 — Correct `issue-711.md`**: If still live per T3, replace the frozen "bump `VCODE_TABLE_ROW_COUNT` in `facts.ts` from `89` to `90`" instruction (~line 192) with a `parseVcodeTableRows`-style live-derivation instruction (read the live row count N via the parser against `src/references/blackhole-vcodes.md`, then declare `N + 1` after the new row is added). — **AC**: `grep -n 'from .89. to .90.' .blackhole/plans/issue-711.md` returns zero matches after the edit; the replacement text names `parseVcodeTableRows` by name.
- [ ] **T5 — Correct `issue-724.md`**: If still live per T3, replace the frozen "currently `89`" / "from `89` to `90`" instructions (~lines 52, 209-212, including the AC's literal `grep ... = 90` assertion) with the same live-derivation pattern as T4. — **AC**: no remaining literal `89`/`90` arithmetic tied to `VCODE_TABLE_ROW_COUNT` in the file; the corrected AC asserts against a live-computed count, not a frozen one.
- [ ] **T6 — Correct `issue-719.md`**: If still live per T3, replace T5's frozen "must read `90`" / "must be bumped to `91`" AC (~lines 144-145) with a generalized live-derivation instruction — note in the edit that this plan's own frozen numbers had *already* drifted stale relative to the live count (94) by the time this correction was written, reinforcing why the literal form must not recur. — **AC**: no remaining literal `90`/`91` arithmetic tied to `VCODE_TABLE_ROW_COUNT` in the file's T5 task.
- [ ] **Verify Integrity**: Run `bun test scripts/plan-quality-gate.test.ts scripts/verify.plan-quality-gate.test.ts`, then `bun run verify` — under `with-test-lock`, one at a time (`resource-frugal-testing.md`). — **AC**: all commands report success; full output quoted in the completion evidence.

## Sprint Contract

Every task above carries its own machine-verifiable AC; there is no task relying on the bare
"all tests and linters pass" fallback. The Baseline Verification and Verify Integrity tasks are
the floor beneath all of them.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — no DB/API schema change; § Database/API Schema Changes states this explicitly |
| `ac_mapping` | PASS — every `## Task Breakdown` item carries a machine-verifiable `— **AC**:` clause |
| `critical_files_exist` | PASS — `## Critical Files` section is empty (no pre-existing sensitive touchpoint in scope); vacuously satisfied |
| `mitigation_concrete` | PASS — every § Execution Strategy bullet pairs a trigger (if/when) with a stop verb (abort/halt/stop/revert); none uses bare "monitor"/"watch"/"be careful" |
| `ac_sweep_conflict` | PASS — no sweep-to-zero AC in this plan overlaps a same-plan retain instruction |
| `ac_sweep_scope` | PASS — no `## Task Breakdown` item is a grep/search sweep-to-zero AC over a codebase-wide scope; T4/T5/T6's `grep`/`grep -c` checks are single-file-scoped with an explicit target path, not open sweeps |
| `touch_paths_ssot_gap` | PASS — every path named in a task's AC (`plan-template.md`, `plan-quality-gate.check.ts`, `verify.plan-quality-gate.test.ts`, the three `issue-*.md` plan files) appears in § Touch-Paths, and vice versa |
| `ac_facts_literal_bump` (new, this plan) | ADVISORY: N/A — this plan's own Task Breakdown intentionally *names* the literal-bump anti-pattern in prose (T4/T5/T6's descriptions of what to remove) without itself proposing a frozen `facts.ts` bump; no task here bumps a `facts.ts` constant |
