---
issue: #717
type: plan
status: current
review_trigger: "on ADR acceptance"
created: 2026-09-02
last_updated: 2026-09-02
related:
  - documentation/plans/plan-retrospective-v0.21.0-remediation.md
---

# Plan - Issue #717

## Objective
Replace the hand-append path for `documentation/reference/decision-log.md` (which keeps
forgetting to bump `last_updated` — frozen at 2026-07-20 despite the orchestrator having
hand-appended 6 rows this turn) with `scripts/decision-log-append.ts`: a script that appends
rows from a `decision_records[]` JSON argument, dedups by `(pr, kind)`, and bumps
`last_updated` itself; `orchestrator.md` § Decision Record Append collapses to one invocation
of it; `doc-health-signal.ts` gains an advisory `decision_log_silent_prs` count in
`doc-health.json` so a decision-log that goes silent (merged PRs never logged) is visible
without a manual audit. R-12 of `documentation/plans/plan-retrospective-v0.21.0-remediation.md`.

## Touch-Paths
- `scripts/decision-log-append.ts` (new)
- `scripts/decision-log-append.test.ts` (new)
- `src/agents/orchestrator.md` — plus all generated dist trees per `scripts/lib/build/targets.ts`
- `scripts/doc-health-signal.ts`
- `scripts/doc-health-signal.test.ts`
- `src/references/doc-governance.md` — plus all generated dist trees per
  `scripts/lib/build/targets.ts`

Out of scope (per issue Scope): changing what gates emit decision records; rotation-threshold
logic (already documented in `decision-log.md` § Rotation, orchestrator.md defers to it
unchanged); `scripts/lib/campaign-status/types.ts`'s shared `QueueIssue` type (not a declared
Touch-Path — `doc-health-signal.ts` reads `queue.json` through a local, narrower inline type
instead, V-SCOPE-02).

## Documentation Impact
`src/references/doc-governance.md` (a declared Touch-Path) gains one short paragraph under its
existing `## Doc-Tree Health Signal` section documenting `decision_log_silent_prs`. No new
`documentation/` file is created and no `documentation/INDEX.md` row changes —
`decision-log.md` is already indexed and this PR only changes how its rows are written, not its
own frontmatter schema (the script bumps the existing `last_updated` field, same value shape).
`blackhole-state.md` § Doc-Health Signal (a rules file, not a declared Touch-Path) is not
updated by this PR — out of Touch-Paths scope; its "visibility only, no ledger append" framing
already covers an additional advisory field without contradiction.

## Critical Files
None — no pre-existing sensitive touchpoint file (database client, auth config) is touched by
this change. `documentation/reference/decision-log.md` and `.blackhole/doc-health.json` are
data files the new/changed scripts write to, not Touch-Paths themselves.

## Codebase Conventions
| Concern | Existing convention to follow |
|---|---|
| Atomic file write | `scripts/doc-health-signal.ts`'s `writeDocHealthSignalAtomic` — `.tmp` write + `fs.renameSync`. Lighter than `scripts/lib/state-write-guard.ts`, which `blackhole-state.md` § Write protocol scopes to `queue.json`/`findings-ledger.json` only; `decision-log.md` is fully recomputed by re-parsing its own content each run, not authoritative campaign state, so the lightweight idiom is the correct-weight choice, not a shortcut. |
| Frontmatter read | `parseMdFrontmatter` / `parseFrontmatterFields` in `scripts/lib/build/content.ts` (already used by `doc-health.check.ts`) — read `last_updated` this way, then bump with a narrow string replace on the frontmatter block; no existing utility writes a frontmatter field back, so that half is new, scoped code, not a reimplementation (V-INT-02 clears: nothing to reuse for the write side). |
| Markdown table row parsing | `split('|').map(trim)` + header/separator-skip idiom in `scripts/lib/check-common.ts`'s `parseIndexTableRows`/`parseVcodeTableRows` — same *technique*, applied to `decision-log.md`'s 5-column `PR/Issue \| Kind \| Touch Paths \| Decision \| Why` schema (a different schema than the INDEX 5-column one those functions parse, so the functions themselves are not reused, only the row-splitting idiom — matches `check-common.ts`'s own documented precedent for `parseRootIndexRows` vs. `parseVcodeTableRows`). |
| Idempotent append shape | `appendIndexRowIfAbsent` in `scripts/checks/doc-health.check.ts` — `{ content, appended }` return shape; `decision-log-append.ts`'s `appendDecisionRecords` mirrors this shape (`{ content, appended, skipped }`, `skipped` counting dedup hits). |
| queue.json read | `readJsonFile` from `scripts/lib/fs.ts`, as used in `scripts/campaign-resume-signal.ts:267`. `doc-health-signal.ts` uses it with a local, narrow inline type (`{ issues?: Record<string, { status?: string; pr?: number \| null }> }`) rather than importing the shared `QueueIssue` type from `scripts/lib/campaign-status/types.ts` (that file is not a declared Touch-Path). |
| Existence-gated no-op | `doc-health-signal.test.ts`'s documented convention: a missing input (docsDir, decision-log.md, queue.json) returns a no-op result (`0` / unchanged), never throws — `evaluateIndexDangling`/`evaluateOrphanFiles` in `doc-health.check.ts` set this precedent. |
| CLI entry pattern | `if (import.meta.main) { main(); }`, used by every `scripts/*.ts` CLI entry point including `doc-health-signal.ts` itself. |

## Database/API Schema Changes
None — `decision-log.md`'s Records table gains no new column; `doc-health.json`'s
`DocHealthSignal` type gains one new field, `decision_log_silent_prs: number` (advisory,
mirrors `doc_debt`'s existing "visibility only, no ledger append" framing — `blackhole-state.md`
§ Doc-Health Signal). No `.blackhole/config.json` key is added.

## Execution Strategy & Stop Conditions
1. **Content-gate headroom is real, not theoretical**: `src/agents/orchestrator.md` is at
   180/185 LOC (`CONTENT_GATE_BUDGETS` in `scripts/lib/build/facts.ts`), 5 lines of file-wide
   headroom, and its `## Decision Record Append` section is at 12/18 section-LOC. After editing
   the section to describe one invocation, run `wc -l src/agents/orchestrator.md`: if the result
   exceeds 185, or `bun run scripts/checks/content-gates.check.ts` (via `bun run verify`) reports
   a `## Decision Record Append` section over 18 LOC, cut prose until both fit — never raise
   either ceiling in `facts.ts` (ground rule 4). Do not touch any other `## ` section to find
   headroom elsewhere in the file; that widens the diff outside this issue's concern.
2. **Dedup identity ambiguity in existing rows**: some existing `decision-log.md` rows use
   `PR #428 / #421` (two numbers in one cell) rather than a bare PR number. If
   `appendDecisionRecords`'s existing-row scan (first `\d+` token in the PR/Issue cell, per
   Codebase Conventions above) mis-identifies a dedup key against a real fixture built from the
   live table, halt and add a second regex pass (all `\d+` tokens, not just the first) before
   proceeding — do not ship a dedup that silently drops a legitimately-new row because it
   collided with a stale extracted id.
3. **`decision_log_silent_prs` must not regress `doc_debt` semantics**: `doc_debt` stays derived
   solely from `evaluateDocTreeHealth`'s `detail` (unchanged). If adding the new field changes
   `doc_debt`'s value in any existing `doc-health-signal.test.ts` case, that is a regression —
   revert the `DocHealthSignal` field addition to additive-only (new key, same `doc_debt`
   derivation) before proceeding to the orchestrator.md edit.
4. **`bun test`/`bun run verify`/`bun run build` are not run by the planner** (memory-constrained
   workstation, per this spawn's tool guidance) — the implementer runs the full IDENTIFY→RUN→
   READ→VERIFY→CLAIM gate (`mercure-verification-evidence.md`) before marking any task complete.

## Task Breakdown
- [ ] **TDD Baseline Verification**: Run the project's existing test suite for the touched area
  (`bun test scripts/doc-health-signal.test.ts`) to confirm it passes before any edit. — **AC**:
  baseline run quoted in the completion evidence, exit code 0.
- [ ] **Write failing tests — `scripts/decision-log-append.test.ts`**: cover (a) appending one
  new `decision_records[]` row to a fixture `decision-log.md` produces the expected table row
  and bumps `last_updated` to the run date; (b) a second append carrying the same `(pr, kind)`
  pair as an existing row is skipped, `last_updated` still bumps, existing row count unchanged;
  (c) a `PR #428 / #421`-shaped existing row is recognized as already covering PR 428 for dedup
  purposes; (d) a malformed/missing `decision-log.md` path fails loud (this file is expected to
  exist — not an existence-gated no-op case, unlike doc-health-signal's queue.json read).
  — **AC**: `bun test scripts/decision-log-append.test.ts` fails for the expected reason
  (module/function not found) before implementation.
- [ ] **Implement `scripts/decision-log-append.ts`**: exports `appendDecisionRecords(logContent,
  records)` returning `{ content, appended, skipped }`, and a `main()` CLI entry (`--log <path>`
  default `documentation/reference/decision-log.md`, `--records-file <path>` pointing at a JSON
  file shaped `{ decision_records: DecisionRecordRow[] }`, row shape per `worker-schemas.md`
  § `decision_records[]`) that reads the log, calls `appendDecisionRecords`, bumps `last_updated`
  in the frontmatter to today's date, and writes atomically via `.tmp` + `fs.renameSync`
  (Codebase Conventions). Escape literal `|` in `decision`/`why`/`touch_paths` cell text as `\|`
  before building a row line. — **AC**: `bun test scripts/decision-log-append.test.ts` passes,
  all cases from the prior task green.
- [ ] **Rewire `orchestrator.md` § Decision Record Append to one invocation**: replace the
  hand-write prose (row-to-column mapping paragraph) with a single sentence naming the
  invocation — `bun scripts/decision-log-append.ts --records-file <path>` — once per completed
  `implementer` worker carrying a non-empty `decision_records[]`, keeping the existing
  "serially, one worker at a time, post-barrier" framing and the § Rotation cross-reference
  unchanged. Stay inside the content-gate headroom (Execution Strategy item 1). — **AC**:
  `wc -l src/agents/orchestrator.md` ≤ 185 and the `## Decision Record Append` section ≤ 18 LOC
  (verify with `bun run scripts/checks/content-gates.check.ts` output or a manual
  `parseSectionLineCounts` check), both quoted in the completion evidence.
- [ ] **Write failing tests — `doc-health-signal.test.ts` additions**: a fixture `queue.json`
  with 2 merged issues carrying `pr` values, one present in a fixture `decision-log.md`'s
  Records table and one absent, asserts `computeDocHealthSignal(...).decision_log_silent_prs
  === 1`; a fixture with a missing `queue.json` path asserts `decision_log_silent_prs === 0`
  (existence-gated no-op, Codebase Conventions); an existing passing case (e.g. "a clean fixture
  tree yields doc_debt: no") re-asserted to confirm `doc_debt`/`detail` are unchanged by the new
  field (Execution Strategy item 3). — **AC**: new cases fail for the expected reason before
  implementation; the existing case's assertion is extended, not deleted.
- [ ] **Implement `doc-health-signal.ts` `decision_log_silent_prs`**: add
  `computeDecisionLogSilentPrs(decisionLogPath, queueJsonPath)` — parses the Records table's
  PR/Issue column for every `\d+` token into a `Set<number>` (Execution Strategy item 2's
  all-tokens pass), reads `queue.json` via `readJsonFile` with the local narrow type, counts
  merged issues whose `pr` is not in that set; returns `0` on either file missing. Wire it into
  `computeDocHealthSignal` as an additive `decision_log_silent_prs: number` field and thread a
  `queueJsonPath` parameter through to `main()` (`.blackhole/queue.json`). — **AC**: `bun test
  scripts/doc-health-signal.test.ts` passes, all cases from the prior task green.
- [ ] **Document in `doc-governance.md`**: one short paragraph under `## Doc-Tree Health Signal`
  naming `decision_log_silent_prs`, its source (`decision-log.md` vs. merged `queue.json`
  issues), and its advisory-only status (mirrors `doc_debt`'s existing framing, cites
  `blackhole-state.md` § Doc-Health Signal rather than restating it — V-DRY-01). — **AC**: the
  paragraph exists and names the field verbatim (`grep -n "decision_log_silent_prs"
  src/references/doc-governance.md` returns a match).
- [ ] **Verify Integrity**: `bun test scripts/decision-log-append.test.ts
  scripts/doc-health-signal.test.ts`, then `bun run build` (regenerates dist trees for the two
  touched `src/` files, V-BUILD-01), then `bun run verify`. — **AC**: all three commands exit 0,
  each command's tail output quoted in the completion evidence.

## Sprint Contract
- Script exists, appends `decision_records[]` rows, dedups by `(pr, kind)` — **AC**: `bun test
  scripts/decision-log-append.test.ts` passes (dedup + append + escaping cases).
- `orchestrator.md` § Decision Record Append is one invocation — **AC**: section prose names the
  `bun scripts/decision-log-append.ts` invocation exactly once, `wc -l` ≤ 185, section ≤ 18 LOC.
- `doc-health-signal.ts` surfaces `decision_log_silent_prs`; `doc-governance.md` documents it —
  **AC**: `bun test scripts/doc-health-signal.test.ts` passes; `grep -n
  "decision_log_silent_prs" src/references/doc-governance.md` matches.
- All other tasks not covered by a narrower AC above close under: full suite green (`bun test`),
  lint/build clean (`bun run build`, `bun run verify`), both quoted in completion evidence.

## Quality Gate Results
| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — no schema/config-key change (Database/API Schema Changes: None) |
| `ac_mapping` | PASS — every `## Task Breakdown` item carries a machine-verifiable `— **AC**:` |
| `critical_files_exist` | PASS — `## Critical Files` lists no path (vacuous) |
| `mitigation_concrete` | PASS — every `## Execution Strategy & Stop Conditions` bullet pairs a concrete trigger to a concrete halt/revert action, no bare "monitor"/"watch"/"be careful" |
| `ac_sweep_conflict` | PASS — no sweep-to-zero AC in this plan |
| `ac_sweep_scope` | PASS — no sweep-to-zero AC in this plan |
| `touch_paths_ssot_gap` | PASS — every Touch-Path is named in at least one Task Breakdown item's text |
