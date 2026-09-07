---
type: plan
summary: "Fixes the missing archive-snapshot step in scripts/triage-deferred-findings.ts (blackhole-state.md § Write protocol) discovered while re-measuring issue #958's stale 12-finding premise against the live 39-finding V-DEFER-01 backlog"
status: current
review_trigger: "on triage-deferred-findings.ts change"
created: 2026-09-07
last_updated: 2026-09-07
related: [src/references/findings-ledger.md, scripts/triage-deferred-findings.ts, scripts/migrate-ledger-schema.ts]
---


# Plan - Issue #958

## Objective

**Live re-measurement (this session, re-run against `plan_base_commit` above — supersedes the
issue body's stale 12-finding/12-issue list, same "stale issue-body numbers" pattern issue #809's
own plan (`documentation/plans/plan-discovery-70-deferred-findings-sit-behind-closed-issues-with-no-reconciliation-t.md`)
already documented once):**

The issue body names 12 closed targets (`#878 #879 #882 #883 #884 #889 #893 #895 #901 #907 #909
#912`) and 3 already-reconciled example finding ids (`F-00025`, `F-00027`, `F-00122`). Verified
directly against the live ledger and every archived snapshot:

- `grep -lE '"deferred_to_issue":(878|879|882|883|884|889|893|895|901|907|909|912)[,}]'` across
  the live `.blackhole/findings-ledger.json` **and all 129 archived snapshots** under
  `.blackhole/archive/findings-ledger-*.json` returns **zero matches, in every file**. None of
  the 12 cited target issues has ever appeared as a `deferred_to_issue` value in this ledger's
  history.
- `F-00025`, `F-00027`, `F-00122` already carry `status: "resolved"` /
  `reconciliation_rule: "closed-pr-title-match"` (or `"manual-triage"` for F-00122, which was
  actually *reopened* to `status: "open"`, not resolved) with `reconciled_at:
  "2026-09-03T19:51:14.528Z"` — exactly the ledger's own `refreshed_at` timestamp. This confirms
  `scripts/triage-deferred-findings.ts` (built for issue #809) already ran once, on 2026-09-03,
  and reconciled the backlog that existed at that time.
- Running `bun run scripts/checks/deferred-reconciliation.check.ts`'s `checkDeferredReconciliation`
  against the **current** live ledger + `queue.json` (`refreshed_at` 2026-09-07, i.e. newer than
  the ledger — more issues have merged since the last triage run) reports **39** unreconciled
  `deferred` findings, not 12, pointing at **10** distinct targets, not 12: `#730`, `#731`,
  `#779`, `#781`, `#787`, `#798`, `#802`, `#803` (all confirmed `status: "merged"` in
  `queue.json`, with known merge PRs — `#848`, `#855`, `#858`, `#834`, `#835`, `#837`, `#844`,
  `#880` respectively) and `#840`, `#845` (absent from `queue.json` entirely — the "untracked"
  category).

The issue's specific 12-item list is stale — it does not describe any state this ledger has ever
held. Its underlying *objective* (reconcile the deferred backlog behind closed targets) is real
and current: the check output above proves a genuine, larger, un-actioned backlog exists right
now. This plan targets that live backlog, not the stale list.

**Root cause found while investigating why the Sep 3 triage run didn't already cover the current
backlog (Hard Choice Protocol — root cause, not the stated symptom):**

`scripts/triage-deferred-findings.ts`'s `main()` does **not** perform the archive-snapshot step
`blackhole-state.md` § Write protocol requires before every `.tmp` install over
`findings-ledger.json` — it goes straight from `triageFindings()` to
`fs.writeFileSync(tmpPath, ...)` → `validateStateWrite(...)` → `fs.renameSync(...)`, with no
`archive/` copy first. This is exactly the write-protocol step issue #958's own Scope section
calls out as required ("snapshot to `archive/`, write `.tmp`, validate via `state-write-guard.ts`
..., atomic `mv`"). The sibling one-shot ledger-mutation script `scripts/migrate-ledger-schema.ts`
already implements this correctly in its isolated `runMigration()` (mkdir `archiveDir` →
timestamped `fs.copyFileSync` snapshot → `.tmp` write → `validateStateWrite` → atomic rename), and
`scripts/lib/hook-event-triage.ts`'s `archiveConsumedFiles()` follows the same convention for a
different `.blackhole/` artifact class. `triage-deferred-findings.ts` never adopted it.
`scripts/triage-deferred-findings.test.ts` (233 lines) confirms this is untested: it covers
`resolveClosureInfo`/`classifyDeferredFinding`/`triageFindings` (all pure) and states in its own
header that `main()`'s file-write path is "deliberately never run against the live ledger by the
implementer... the orchestrator runs it post-merge as a separate step" — but nothing tests that
path even against a fixture. Zero coverage, not a documented exemption.

**Decision — fix the tool, don't hand-write a second reconciliation (V-INT-02, V-KISS-01):** the
classification logic this issue asks for (`resolveClosureInfo` / `classifyDeferredFinding` /
`triageFindings`) already exists, is already tested, and is already correct — it is exactly the
3-outcome rule the issue's "The work" section describes (closed-title-match → `resolved`;
untracked-body-match → `resolved`; every other closed target → reopened to `open` flagged
`manual-triage` for human confirmation, never guessed `resolved`). Re-implementing that
classification by hand against the 39 real findings would duplicate tested logic this repo
already has. The actual gap is the write-path protocol violation above — fix that, then the
already-existing tool is the correct instrument for the reconciliation itself.

**What this PR does vs. what happens after merge — the full closing sequence for #958:**

`.blackhole/` is entirely `.gitignore`d (`git ls-files .blackhole/` returns nothing) — a PR
cannot contain a ledger diff, and `blackhole-state.md` § Single-writer invariant plus this
script's own test-file header both establish that `triage-deferred-findings.ts` is "deliberately
never run against the live ledger by the implementer... the orchestrator runs it post-merge as a
separate step." This plan's Touch-Paths are therefore the two source files below; the actual
39-finding reconciliation is **not** part of this PR:

1. **This PR** (Touch-Paths below): add the missing archive-snapshot step to
   `scripts/triage-deferred-findings.ts`, TDD'd against a temp-dir fixture.
2. **Post-merge, orchestrator-only** (single-writer invariant): re-run
   `bun run scripts/triage-deferred-findings.ts` (now snapshot-safe) against the live ledger.
   This mechanically resolves or reopens every findable row.
3. **Post-merge, orchestrator-only**: for every row the script reopens to `status: "open"` with
   `reconciliation_rule: "manual-triage"`, read the closing PR named above and record the
   evidence in the finding's own text (PR number + the specific change, or "no longer
   applicable" + reason) per the issue's 3-outcome AC — the script itself only classifies
   mechanically (title/body keyword match), it does not write PR-evidence prose. The issue's own
   text singles out `V-HOOK-*` rows for priority here ("if they were not actually fixed,
   returning them to `open` is more important than tidying the ledger") — none of the current 39
   rows are `V-HOOK-*` (only `F-00355`, `V-HOOK-02`, target `#781`, is hook-related, and #781 is
   merged), so this plan does not know in advance whether that priority note applies to the live
   backlog; the orchestrator confirms at reconciliation time.
4. **Post-merge, orchestrator-only**: re-run `deferred-reconciliation.check.ts` to confirm zero
   unreconciled closed-target findings remain, then close #958 citing the before/after counts
   (invariance AC — total finding count unchanged, per the never-drop rule both the check and
   `triageFindings` already enforce structurally).

This plan (and its implementer) own step 1 only. Steps 2-4 are named here so the orchestrator has
an explicit, plan-recorded closing sequence for #958 rather than the PR merging and the issue
silently going stale a second time.

## Touch-Paths

- `scripts/triage-deferred-findings.ts`
- `scripts/triage-deferred-findings.test.ts`

## Documentation Impact (docs_governance.enabled: true)

None — this fixes an internal implementation gap (missing archive-snapshot step) to bring the
code into compliance with an already-documented protocol
(`blackhole-state.md` § Write protocol, already cited by this script's own header comment); no
documented contract changes. Checked `src/references/findings-ledger.md` (the doc describing
this script): it already correctly describes `triage-deferred-findings.ts` as classifying via
the reproducible rule and does not claim the write path snapshots today, so there is no stale
claim to correct there either.

## Codebase Conventions

| Touchpoint | Convention | Source |
|---|---|---|
| Ledger write protocol (snapshot before mutate) | `fs.mkdirSync(archiveDir, { recursive: true })` → `new Date().toISOString().replace(/[:.]/g, '-')` timestamp → `fs.copyFileSync(livePath, path.join(archiveDir, \`findings-ledger-${timestamp}.json\`))`, **before** the `.tmp` write | `scripts/migrate-ledger-schema.ts`'s `runMigration()` (lines ~90-99) — the sibling one-shot ledger-mutation script already implementing this correctly; reuse verbatim, don't reinvent |
| Write-guard validation | `validateStateWrite({ tmpPath, livePath, entityKey: 'findings' })` from `scripts/lib/state-write-guard.ts`, refuse-and-`rm` the `.tmp` on failure, atomic `fs.renameSync` on success | Already imported and used by `triage-deferred-findings.ts`'s current `main()` — unchanged usage |
| Testable split: isolate file-I/O from the `if (import.meta.main)` CLI entrypoint | Export a named function (`installTriagedLedger` here) taking explicit paths, so tests exercise the full protocol against a `makeTempDir()` fixture, never live `.blackhole/` state | `scripts/migrate-ledger-schema.ts`'s `runMigration(livePath, archiveDir)` split; `scripts/lib/hook-event-triage.ts`'s `archiveConsumedFiles()` |
| Ledger-mutation test fixtures | `bun:test` `describe`/`test`, `makeTempDir()` from `./lib/fs.ts` for an isolated temp directory, `afterEach` cleanup | `scripts/migrate-ledger-schema.test.ts`'s `describe('runMigration (file protocol, temp-dir isolated)', ...)` block |
| CLI flag parsing | `parseFlags` from `./lib/argv-flags.ts` | Already used by `triage-deferred-findings.ts`'s `parseCliArgs` — unchanged |

## Task Breakdown

- [ ] **TDD Baseline Verification**: `flock /tmp/blackhole-verify.lock -c 'bun test scripts/triage-deferred-findings.test.ts scripts/migrate-ledger-schema.test.ts'`
  (scoped to the touched file's test and its closest sibling-convention test — never the full
  suite for a baseline read, per resource policy; check `free -m` MemAvailable ≥ 2000MB first).
  — **AC**: both files' existing tests pass; pass count quoted in the completion evidence for
  later invariance comparison (Task 4).
- [ ] **Write Failing Tests** (`scripts/triage-deferred-findings.test.ts`): add a
  `describe('installTriagedLedger (file protocol, temp-dir isolated)', ...)` block, mirroring
  `migrate-ledger-schema.test.ts`'s equivalent block, with two tests against a `makeTempDir()`
  fixture: (a) "archives a timestamped snapshot of the live ledger to `archive/` before
  installing the update, and installs the update at the live path" — write a fixture ledger with
  1 known finding to `livePath`, call `installTriagedLedger(livePath, archiveDir, updatedLedger)`
  with a distinct `updatedLedger`, then assert `archiveDir` contains exactly one file whose
  parsed JSON matches the **original** (pre-update) fixture content, and that `livePath` now
  contains the **updated** content; (b) "refuses and leaves the live file untouched when
  `validateStateWrite` would reject the write" — call it with an `updatedLedger` whose `findings`
  array is empty against a live fixture with >0 findings (the same zero-collapse refusal
  `state-write-guard.ts` already enforces), assert the function returns `{ ok: false, reason:
  ... }`, `livePath`'s content is byte-identical to the pre-call fixture, and no `.tmp` file is
  left behind. — **AC**: `bun test scripts/triage-deferred-findings.test.ts` fails at exactly
  these two new tests (`installTriagedLedger` does not exist yet — import/reference error), all
  pre-existing tests in the file still pass unmodified.
- [ ] **Add the archive-snapshot step** (`scripts/triage-deferred-findings.ts`): extract an
  exported `installTriagedLedger(ledgerPath: string, archiveDir: string, updatedLedger: {
  findings: LedgerFinding[]; [key: string]: unknown }): { ok: true } | { ok: false; reason:
  string }` implementing, in order: `fs.mkdirSync(archiveDir, { recursive: true })`; snapshot
  `ledgerPath`'s **current on-disk content** to `archiveDir/findings-ledger-<ISO-timestamp-with-
  colons-and-dots-as-dashes>.json` via `fs.copyFileSync` (same timestamp convention as
  `migrate-ledger-schema.ts`'s `runMigration`); write `updatedLedger` to `${ledgerPath}.tmp`;
  call `validateStateWrite({ tmpPath, livePath: ledgerPath, entityKey: 'findings' })`; on
  `!ok`, `fs.rmSync(tmpPath)` and return `{ ok: false, reason: validation.reason }`; on `ok`,
  `fs.renameSync(tmpPath, ledgerPath)` and return `{ ok: true }`. Add one rationale comment at
  this new function's definition citing `blackhole-state.md § Write protocol` by section name
  (not restating it) — the canonical site for that rationale, per Comment Discipline. Update
  `main()` to build `archiveDir = path.join(path.dirname(ledgerPath), 'archive')` and the
  `updatedLedger` object as it already does, then call `installTriagedLedger(...)` in place of
  the current inline write block, printing the same `'Ledger updated.'` /
  `` `state-write-guard refused install: ${reason}` `` strings on the same success/failure paths
  so stdout stays byte-identical to today for any existing consumer. Update the module's opening
  comment's characterization from purely "ONE-TIME" to note it is idempotent and safe to
  re-invoke as new closed-target backlog accumulates (it already skips any row carrying
  `reconciled_at` — this is a documentation-accuracy fix to the comment, not a behavior change;
  Scout Improvement, within this task's diff boundary). Do not touch `triageFindings`,
  `classifyDeferredFinding`, or `resolveClosureInfo` — already correct and already tested. —
  **AC**: both new tests from the previous task now pass; `git grep -n "installTriagedLedger"
  scripts/triage-deferred-findings.ts` shows the exported function and its one call site in
  `main()`.
- [ ] **Verify Integrity + Invariance**: `free -m` MemAvailable ≥ 2000MB check, then
  `flock /tmp/blackhole-verify.lock -c 'bun test scripts/triage-deferred-findings.test.ts scripts/migrate-ledger-schema.test.ts'`
  (full pass count compared to Task 1's baseline — every pre-existing test still passes,
  unchanged count plus the 2 new tests), then (same lock, same memory check)
  `flock /tmp/blackhole-verify.lock -c 'bun run verify'` (project's check/lint suite — no
  separate `lint`/`typecheck` script exists in `package.json`). — **AC**: both commands exit 0;
  the scoped test file's pre-existing pass count is identical to Task 1's baseline (proving
  `triageFindings`'s classification behavior is unchanged — only the write path gained the
  snapshot step); `bun run verify` exits 0 with no new findings attributable to the two touched
  files.

## Sprint Contract

- Issue's stale 12-finding/12-issue premise is verified against live state and corrected before
  any code change — satisfied by the Objective's live re-measurement (grep across all 129
  archived snapshots + the live ledger, zero matches; the live `deferred-reconciliation.check.ts`
  run showing the real 39-finding/10-target backlog).
- Root cause of why the backlog exists at all (not merely "reclassify these rows by hand") is
  identified and fixed — satisfied by the Objective's root-cause finding (missing
  archive-snapshot step in `triage-deferred-findings.ts`'s write path) and Task 3's fix.
- No reimplementation of the existing, tested classification logic (`V-INT-02`) — satisfied by
  the Decision paragraph and by Touch-Paths excluding `resolveClosureInfo` /
  `classifyDeferredFinding` / `triageFindings`.
- Each of the 12 originally-cited findings is classified with evidence; every `resolved` row
  carries `reconciled_at`; every outcome-2 row is reopened or re-pointed; the check reports zero
  afterward; total finding count is unchanged — **not satisfiable inside this PR** (`.blackhole/`
  is gitignored, single-writer invariant reserves the ledger mutation to the orchestrator) —
  explicitly handed to the orchestrator as the 4-step closing sequence in the Objective's "What
  this PR does vs. what happens after merge" subsection. This plan's own scope ends at Task 4;
  #958 itself does not close on this PR merging alone.
- Tasks with no narrower AC default to: full test suite green, `bun run verify` clean — already
  the explicit AC on Tasks 1 and 4.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |
