---
issue: #928
supersedes_adr: null
rulings_checked_at: 5
ruling_conflicts: []
type: plan
summary: "Fix bun run status (scripts/campaign-status.ts) so a directory with no .blackhole/ campaign prints a clear message and exits 0, instead of an uncaught stack trace from loadCampaignState/readJsonFile; a malformed config.json stays distinguishable and still errors"
status: current
review_trigger: "on file change"
created: 2026-09-06
last_updated: 2026-09-06
related: [decisions/ADR-021-durable-artifact-staging.md]
---

# Plan - Issue #928 — bun run status crashes with a stack trace when no campaign exists

## Objective
Fix `bun run scripts/campaign-status.ts` (and `bun run status`) so that running the dashboard
against a directory with no `.blackhole/` campaign prints a clear message naming the directory
it looked in and exits cleanly (0), instead of an uncaught exception with a full internal stack
trace naming `readJsonFile`/`loadCampaignState`/`main`. A malformed (present but unparseable)
`config.json` must remain distinguishable from the absent case — it must still surface as an
error, never collapse into the same "no campaign" message (AC 2). `scripts/lib/fs.ts`'s
`readJsonFile` is unchanged — it has 16 other call sites that depend on its current
throw-with-label behavior (AC 4).

Split from #865 (child A of 2) — the only one of that issue's four complaints that makes the
tool unusable rather than merely worse.

`task_type: bugfix` is stamped above per the router's classification; this activates
`implementer.md`'s Bugfix Gate (Root-Cause Verification) — the root cause is documented in
full below so that gate has something concrete to verify against.

Checked against `documentation/reference/product-principles.md`'s owner-rulings ledger (`rulings_revision: 5`, `docs_governance.companion_files` enabled): none of the four active rulings (R-001 docs-integration floor, R-002 merge-mode-no-default, R-003 executive-summary gates, R-004 campaign-implements-ActionMan-reviews) bear on a CLI dashboard error-handling fix. `ruling_conflicts: []`.

## Touch-Paths
- `scripts/lib/campaign-status/state.ts`
- `scripts/campaign-status.ts`
- `scripts/campaign-status.test.ts`

## Documentation Impact
None — this is an internal error-handling fix inside `scripts/lib/campaign-status/state.ts` and
`scripts/campaign-status.ts`. No companion doc (`ARCHITECTURE.md`, `DESIGN.md`,
`documentation/decisions/INDEX.md`) documents `loadCampaignState`'s error contract today, and no
consumer-facing doc changes. (Distinct from the durable plan-body staging this plan itself
undergoes per ADR-021 D3, below — that is a process artifact about this plan, not a Touch-Path
Documentation Impact.)

## Root Cause & Approach

**Root cause**: `loadCampaignState` (`scripts/lib/campaign-status/state.ts:8-13`) calls
`readJsonFile` on `config.json` unconditionally. `readJsonFile` (`scripts/lib/fs.ts:53-59`)
catches both `ENOENT` and `SyntaxError` and re-throws one generic `Error(`${label}: ${message}`)`,
preserving neither `error.code` nor `{ cause }`. `main()` (`scripts/campaign-status.ts:97`, its
sole caller — confirmed by grep, so there is no ripple risk from where a guard sits) has no
`try/catch` around the call, so the generic error propagates uncaught to Bun's default handler,
which prints a full stack trace and exits non-zero. Reproduced against a genuinely-absent
`.blackhole/` directory at plan time:

```
$ bun run scripts/campaign-status.ts --campaign-dir <scratch-dir-with-no-.blackhole> --no-gh
error: <path>/config.json: ENOENT: no such file or directory, open '...'
      at readJsonFile (scripts/lib/fs.ts:58:15)
      at loadCampaignState (scripts/lib/campaign-status/state.ts:13:18)
      at main (scripts/campaign-status.ts:97:5)
EXIT_CODE=1
```

**Why guard-before-load, not catch-and-classify**: because `readJsonFile` preserves no
distinguishing error metadata, a `try/catch` around `loadCampaignState()` could only tell
"absent" from "corrupt" by substring-matching `"ENOENT"` in the thrown message — brittle, and
exactly the fragile approach AC 4 warns against ("the fix belongs at the call site that knows
absence is expected, not in a shared helper 16 other sites depend on"). `scripts/doctor.ts:160-168`'s
`checkConfigExists` already establishes the pattern this fix reuses: an `fs.existsSync` guard
**before** any read, structurally separate from the function that does the parse
(`checkConfigValid`) and is the one allowed to fail on corruption. This plan reuses that
guard-before-load *shape* — not `checkConfigExists`'s `DoctorCheck` return type, since the
dashboard has no aggregate-checks structure to plug into (`V-INT-02`: reuse the pattern, not the
type).

**Where the guard lives**: inside `loadCampaignState` (`state.ts`), not inside `readJsonFile`
(AC 4 — the helper itself is unchanged) and not bolted onto `main()` alone.
`loadCampaignState` is "the call site that knows absence is expected" (AC 4's own phrasing).
Concretely: `loadCampaignState` gains one exported `CampaignNotFoundError extends Error` class
and a single `fs.existsSync(campaignDir)` check ahead of its three `readJsonFile` calls
(`config.json`, `queue.json`, `findings-ledger.json` — all three currently unguarded and would
all throw identically today; `campaign-checkpoint.md` is already guarded at `state.ts:23`). On a
miss, `loadCampaignState` throws `new CampaignNotFoundError(campaignDir)` (message names the
directory) before the first `readJsonFile` call is reached — one directory check covers all
three JSON reads at once, so this does not need three separate guards. `main()` wraps its
existing `loadCampaignState(campaignDir)` call in a `try/catch`: on
`err instanceof CampaignNotFoundError`, `console.log(err.message); return;` (falls off the end
of `main()` → exit 0 — nothing else calls `main()`, so no `process.exit` call is introduced, and
no other exit code changes, per AC 4); any other error rethrows uncaught, preserving today's
crash-with-stack-trace behavior for a genuinely corrupt `config.json` (AC 2 — "no campaign" and
"campaign state is corrupt" stay distinguishable, and only the first is a normal state).

**Residual, explicitly out of scope**: a *partial* campaign directory — `campaignDir` exists but
one or more of `config.json` / `queue.json` / `findings-ledger.json` was never written — passes
the directory-existence guard and would still throw past it, uncaught, exactly as today. No
bootstrap script writes the three files atomically, so this state is theoretically reachable. It
is outside this issue's AC 2, which only requires "no campaign" and "corrupt campaign" to stay
distinguishable — a partial directory is corrupt-adjacent, not the fresh-checkout case AC 1
describes. One sentence, no wider fix: if the implementer finds it trivially covered by the same
guard, that is a bonus, not a requirement.

## Task Breakdown
- [ ] **TDD Baseline Verification**: Run `bun test scripts/campaign-status.test.ts` to verify all existing tests pass before modifying any file. — **AC**: baseline run's pass/fail counts quoted in the completion evidence.
- [ ] **Write Failing Tests (RED)**: In `scripts/campaign-status.test.ts`, add a `describe('main() CLI entrypoint — no campaign directory')` block that spawns the real script as a subprocess — `Bun.spawnSync({ cmd: ['bun', 'run', 'scripts/campaign-status.ts', '--campaign-dir', <fresh nonexistent temp path>, '--no-gh'], cwd: root, stdout: 'pipe', stderr: 'pipe' })`, reusing the exact subprocess-CLI-test shape already established at `scripts/lib/hook-event-triage.test.ts`'s `describe('main() CLI entrypoint', …)` (V-INT-02 — do not invent a second pattern) — and asserts: (a) `proc.exitCode === 0`; (b) `proc.stdout.toString()` contains the campaign directory path and a human-readable "no campaign" phrase; (c) `proc.stderr.toString() === ''` (the no-stack-trace assertion — a thrown-but-uncaught error still produces stack-frame lines on stderr even when some stdout text also appears, so stderr emptiness is the falsifiable check, not stdout content alone). Add a companion test: a `config.json` written with invalid JSON inside an otherwise-real campaign dir still exits non-zero (AC 2 — distinguishable, still an error). — **AC**: both new tests exist; running `bun test scripts/campaign-status.test.ts` against the current, unfixed `state.ts`/`campaign-status.ts` fails the first new test for the expected reason (non-zero exit code and/or non-empty stderr) — the failing output is pasted into the completion evidence before any implementation file changes.
- [ ] **Implement Minimal Logic**: In `scripts/lib/campaign-status/state.ts`, export `CampaignNotFoundError` and add the `fs.existsSync(campaignDir)` guard described above at the top of `loadCampaignState`. In `scripts/campaign-status.ts`, wrap the `loadCampaignState(campaignDir)` call in `main()` in `try/catch` per the approach above. No change to `scripts/lib/fs.ts`. — **AC**: both new tests from the previous task pass; `git diff --name-only` against `plan_base_commit` shows no file outside the three declared Touch-Paths.
- [ ] **Verify Integrity**: Run `bun test scripts/campaign-status.test.ts` (full file) and `bun run verify`. — **AC**: full suite green and `bun run verify` clean, both quoted in the completion evidence.

## Sprint Contract
Every task above carries its own machine-verifiable AC; none relies on a blanket "tests and
linters pass" fallback. Definition of done: both new tests pass, the full
`scripts/campaign-status.test.ts` suite is green, `bun run verify` is clean, and
`git diff --name-only` against `plan_base_commit` (`514c19b5`) shows only the three declared
Touch-Paths changed.

## Quality Gate Results (advisory — Quick track; `plan-quality-gate.ts` is a Standard-track-only
gate per Step 8, run here at the orchestrator's explicit request for evidence)

```json
{
  "ac_mapping": true,
  "critical_files_exist": true,
  "mitigation_concrete": true
}
```

`ac_mapping`, `critical_files_exist`, and `mitigation_concrete` all resolve vacuously true on
this Quick-track plan: it carries no `## Critical Files` or `## Execution Strategy & Stop
Conditions` heading (both are `[Standard Only]` per `plan-template.md`), so those two checks see
an empty section and find nothing to flag; `ac_mapping` is genuinely exercised against `## Task
Breakdown` above and every bullet does carry a `**AC**:` clause. `touch_paths_declared` and
`schema_baseline` (Step 8's other two checks, not covered by the CLI) both pass: Touch-Paths are
declared explicitly above, and this bugfix introduces no schema/API-baseline change.
