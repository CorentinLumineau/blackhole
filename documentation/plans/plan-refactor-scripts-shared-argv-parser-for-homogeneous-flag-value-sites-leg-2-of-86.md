---
type: plan
summary: "Extracts a shared argv parser (parseFlags/requireFlag, seeded from stack-repair.ts) and adopts it at 15 scripts/** CLI entrypoints, preserving each site's exit-code contract and fixing a disclosed flag/value mis-pairing defect (leg 2 of #867)"
status: current
review_trigger: "on file change"
created: 2026-09-06
last_updated: 2026-09-06
issue: "#902"
supersedes_adr: null
rulings_checked_at: 5
ruling_conflicts: []
---

# Plan - Issue #902 — shared argv parser for homogeneous `--flag value` sites (leg 2 of #867)

## Objective

Extract one pure `argv → flags` / `flags → required string` pair from
`scripts/stack-repair.ts:187-204`'s private `parseFlags`/`requireFlag` and adopt it at 15
`scripts/**` CLI entrypoints that today each hand-roll an equivalent loop (`V-INT-02`/`V-DRY-01`
— 15 near-identical copies of the same ~10-line parsing idiom). Router: `task_type: refactor`,
`plan_mode: full`, `needs_design: false`, `docs_impact: true`, `security_review_required: false`,
`size: m`. Parent #867 (merged, PR #910) scoped leg 1 (`readJsonFile` bypasses) only and carved
this concern out explicitly; leg 3 (#903, unrelated — `findAdrFileByNumber` triplication +
`carry-staged` mkdir block) does not touch any of the 15 files below.

**This is not a pure refactor — one genuine bug is fixed as part of it (`V-FIX-01` disclosure).**
None of the 15 hand-rolled loops check whether the token immediately following a flag is itself
another flag. `--manifest --repo-root /x` silently binds `manifest = '--repo-root'`, then
resumes scanning from the wrong index and never sees `/x` as anything — a real, reproduced
defect, not a hypothetical:

```
$ bun run scripts/lib/state-write-guard.ts --tmp <tmp.json> --entity-key --live <live.json>
<tmp.json> is missing the required "--live" key or it is not an object/array
$ echo $?
1
```

The user genuinely passed `--live <live.json>`; the parser silently consumed `--live` as
`--entity-key`'s value (because it only checks `argv[i+1] !== undefined`, never whether that
token itself starts with `--`), so `--live` and its path are dropped entirely and the error
message is actively misleading about what went wrong. `stack-repair.ts`'s `parseFlags` already
guards this (`next === undefined || next.startsWith('--')` → bind the flag as boolean `true`
instead of swallowing the next flag), so adopting it fixes this defect at all 15 sites
simultaneously. Task 2 (below) captures the current (wrong) behavior as a red test before any
extraction lands; Task 5 turns it green. This plan does **not** describe the migration as
behavior-preserving — it is 14 preserved exit-code contracts plus one disclosed, deliberate
behavior fix.

**Central constraint — exit codes are load-bearing and are preserved per-site, verbatim.** Six
of the fifteen files have their exit-code integers pinned by `Bun.spawn`-based CLI tests today;
this plan changes **zero** exit-code integers anywhere. See § Codebase Conventions for the full
per-site table this plan is built against.

**Two loop shapes exist across the 15 files, but shape never predicts exit-code convention** —
both shapes get the identical `parseFlags`/`requireFlag` treatment; only the exit-code table
(per-site, not per-shape) determines what each call site's `usage()`/`try-catch` must still do
after adopting the shared primitive.

## Touch-Paths

- `scripts/campaign-resume-signal.ts`
- `scripts/carry-staged-artifacts.ts`
- `scripts/check-review-artifact.ts`
- `scripts/ci-diagnosis.ts`
- `scripts/decision-log-append.ts`
- `scripts/design-aggregate.ts`
- `scripts/lib/companion-file-sync.ts`
- `scripts/lib/state-write-guard.ts`
- `scripts/merge-base-guard.ts`
- `scripts/plan-quality-gate.ts`
- `scripts/promote-review-artifact.ts`
- `scripts/review-aggregate.ts`
- `scripts/triage-deferred-findings.ts`
- `scripts/v-test09-hooks-claim.ts`
- `scripts/validate-worker-json.ts`
- `scripts/lib/argv-flags.ts` (new — the extracted shared module)
- `scripts/lib/argv-flags.test.ts` (new)
- `scripts/checks/argv-flags-adoption.check.ts` (new — closed-allowlist detector)
- `scripts/verify.argv-flags-adoption.test.ts` (new)
- Each of the 15 files' own `*.test.ts` (`scripts/campaign-resume-signal.test.ts`,
  `scripts/carry-staged-artifacts.test.ts`, `scripts/check-review-artifact.test.ts`,
  `scripts/ci-diagnosis.test.ts`, `scripts/decision-log-append.test.ts`,
  `scripts/design-aggregate.test.ts`, `scripts/companion-file-sync.test.ts`,
  `scripts/lib/state-write-guard.test.ts`, `scripts/merge-base-guard.test.ts`,
  `scripts/plan-quality-gate.test.ts`, `scripts/promote-review-artifact.test.ts`,
  `scripts/review-aggregate.test.ts`, `scripts/triage-deferred-findings.test.ts`,
  `scripts/verify.v-test09-hooks-claim.test.ts`, `scripts/validate-worker-json.test.ts`) — read
  and, where a new assertion is added (Task 2/Task 5's mis-pairing test), extended; existing
  assertions in these files are never edited or removed
- `src/references/blackhole-vcodes.md` — plus all generated dist trees per
  `scripts/lib/build/targets.ts` (new `V-ARGV-01` row)

**Explicitly out of scope, by the router's own leg boundary**: `scripts/stack-repair.ts` (the
seed) is **not** migrated to import the new shared module in this PR. See § Codebase Conventions
"On `stack-repair.ts` non-migration" for the reasoning and the disclosed residual duplication.
`scripts/lib/campaign-status/cli.ts`'s `parseStatusArgs` is a different concern (subcommand
dispatch, not flag/value pairs) and is not touched.

## Documentation Impact

`docs_governance.enabled: true`, `write_governance: true` (`.blackhole/config.json`).
**None — verified, not edited.** `src/references/blackhole-state.md` § Write protocol and
`src/references/merge-gate.md` document `state-write-guard.ts`'s and `merge-base-guard.ts`'s
**exit-code contracts** (0/1/2 and 0/1/2/3 respectively) and their CLI invocation shape
(`--tmp`/`--live`/`--entity-key`/`--allow-shrink`, `--mode`/`--base-ref`/`--target-branch`/etc.)
— never their internal parsing implementation. Both files' documented contracts are unchanged by
this plan (Task 7 re-verifies this explicitly against the merged diff before the PR is opened).
No new `documentation/` file is warranted — this is an internal-implementation refactor plus one
disclosed bugfix to unchanged public CLI contracts, not a new pattern or convention needing a
consumer-facing doc.

## Critical Files

- `scripts/lib/state-write-guard.ts` — the sole install-time guard for the campaign's queue and
  ledger writes (see src/references/blackhole-state.md § Write protocol, cited without backticks
  here to avoid the plan-quality-gate's backtick-path extraction misreading a prose citation as
  a second critical-file path); a parsing regression here risks silently validating a malformed
  write.
- `scripts/merge-base-guard.ts` — the pre-/post-merge safety gate (see
  src/references/merge-gate.md); a parsing regression here risks a merge landing without its
  base/target verification actually running.

## Codebase Conventions

**Seed**: `scripts/stack-repair.ts:187-204`'s private (unexported) `parseFlags`/`requireFlag`:

```ts
type Flags = Record<string, string | true>;
const parseFlags = (argv: string[]): Flags => {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
};
const requireFlag = (flags: Flags, name: string): string => {
  const value = flags[name];
  if (typeof value !== 'string') throw new Error(`missing required flag --${name}`);
  return value;
};
```

The `!next.startsWith('--')` check is the fix: a flag immediately followed by another flag name
binds as boolean `true` instead of swallowing the next flag's name as a string value.

**New module**: `scripts/lib/argv-flags.ts` exports `parseFlags`/`requireFlag` verbatim (pure
functions, zero I/O, zero `process.exit` — matches this module's own "pure detector" convention
already used by `scripts/checks/*.check.ts` and `scripts/lib/build/facts.ts`). **Usage-printing
and exit-code selection stay at every call site** — each of the 15 files keeps its own
`usage(): never { ...; process.exit(N); }` (or inline equivalent) and its own `try { requireFlag(...) } catch { usage(); }` (or an
`if (typeof value !== 'string')` check calling its own error path). This is the only shape that
preserves 4+ divergent exit-code conventions (2, 1-then-2, 0/1/2/3, boolean-only) without
centralizing a policy that would have to special-case all of them — a shared `requireFlag` that
also chose the exit code would need a parameter for every call site's own convention, which is
strictly more coupling for no benefit (`V-KISS-01`).

**Two loop shapes in the current 15 files** (shape does not predict exit-code convention — verified
per-file, not inferred from shape):

- *Stride-2* (`for (let i = 2; i < argv.length; i += 2)`, reads `argv[i]`/`argv[i+1]` as a fixed
  key/value pair, `usage()` if the key doesn't start with `--` or the value is `undefined`):
  `carry-staged-artifacts.ts`, `check-review-artifact.ts`, `decision-log-append.ts`,
  `merge-base-guard.ts`, `promote-review-artifact.ts`.
- *Lookahead scan* (`for (let i = 0; i < argv.length; i++)`, `if (arg === '--x' && argv[i+1]) { ...; i++ }`
  per known flag name): `campaign-resume-signal.ts`, `ci-diagnosis.ts`, `design-aggregate.ts`,
  `lib/companion-file-sync.ts`, `lib/state-write-guard.ts`, `plan-quality-gate.ts`,
  `review-aggregate.ts`, `triage-deferred-findings.ts`, `v-test09-hooks-claim.ts`,
  `validate-worker-json.ts`.

Both shapes have the identical mis-pairing defect (a stride-2 loop blindly takes `argv[i+1]` as
the value with no `startsWith('--')` check; a lookahead loop's `&& argv[i+1]` check is truthy for
any non-empty string, flag name included) and both are fixed identically by adopting
`parseFlags`/`requireFlag`.

**Per-site exit-code table — verified directly against `origin/main`'s `process.exit(...)` call
sites and each file's own test file, not asserted from memory.** This table is the plan's
authoritative constraint: after migration, `git diff` for each file's `process.exit(N)` literal
arguments must be empty.

| File | Loop shape | Exit codes in use | Test-pinning (verified) |
|---|---|---|---|
| `campaign-resume-signal.ts` | lookahead | `0` (`--input` success path, `--hook`→`runHook()`'s own 0/1/2 return, or `1` on bare usage) | `0` (`--input` path) exactly pinned at `campaign-resume-signal.test.ts:340`; `--hook`/usage-`1` paths untested by CLI spawn |
| `carry-staged-artifacts.ts` | stride-2 | `0`, `1`, `2` | all three exactly pinned (`carry-staged-artifacts.test.ts`, 11 `expect(code).toBe(...)` assertions) |
| `check-review-artifact.ts` | stride-2 | `0`, `1`, `2` | all three exactly pinned (`check-review-artifact.test.ts`) |
| `ci-diagnosis.ts` | lookahead | `1` only (3 call sites; success falls through to implicit `0`) | boolean-only — `expect(exitCode).not.toBe(0)` (`ci-diagnosis.test.ts:182`), the literal `1` value is free |
| `decision-log-append.ts` | stride-2 | `2` only (usage; no other `process.exit` call in the file) | untested by CLI spawn — no `Bun.spawn` in `decision-log-append.test.ts` |
| `design-aggregate.ts` | lookahead | `1` (2 call sites; success falls through to implicit `0`) | untested by CLI spawn — no `Bun.spawn` in `design-aggregate.test.ts` |
| `lib/companion-file-sync.ts` | lookahead | `2` (2 call sites; both usage) | untested by CLI spawn — no `Bun.spawn` in `companion-file-sync.test.ts` |
| `lib/state-write-guard.ts` | lookahead | `0`, `1`, `2` (via `process.exit(main())`) | all three exactly pinned (`state-write-guard.test.ts:223,247,262,282,290`) |
| `merge-base-guard.ts` | stride-2 | `0`, `1`, `2`, `3` (the fourth code, "verification could not be run at all" — `merge-gate.md:446-451`, confirmed present in prose) | all four exactly pinned (`merge-base-guard.test.ts`, 14 `expect(result.status).toBe(...)` assertions including two `3`s) |
| `plan-quality-gate.ts` | lookahead | `2` (usage) and implicit `0` (falls off the end after printing JSON) — **no `process.exit(1)` exists in this file at all**; gate-failure is communicated via the printed JSON's boolean fields, not the exit code | `0` and `2` both exactly pinned (`plan-quality-gate.test.ts`); there is no `1` to pin |
| `promote-review-artifact.ts` | stride-2 | `2` (usage; no other `process.exit` call) | `0` (success path) exactly pinned (`promote-review-artifact.test.ts:146`); the `2` usage path is untested by CLI spawn |
| `review-aggregate.ts` | lookahead | `1` (4 call sites; success falls through to implicit `0`) | `0` exactly pinned on multiple success-path assertions; nonzero is boolean-only (`expect(result.exitCode).not.toBe(0)`, `review-aggregate.test.ts:819,857`) |
| `triage-deferred-findings.ts` | lookahead | `0`, `1` (via `process.exit(main())`; no usage-2 path — this file has no `usage()` function) | both exactly pinned (`triage-deferred-findings.test.ts:198,220,230`) — **correction to the spawn brief**: this file was not named in any of the three test-pinning buckets it listed; verified here as fully pinned, same tier as `carry-staged-artifacts.ts`/`state-write-guard.ts` |
| `v-test09-hooks-claim.ts` | lookahead | `2` (usage; no other `process.exit` call) | untested by CLI spawn — `verify.v-test09-hooks-claim.test.ts` tests the underlying `checkHooksOnlyClaimAdvisory` function directly, not the CLI wrapper |
| `validate-worker-json.ts` | lookahead | `0`, `1`, `2` in both CLI mode and `--hook` mode (dual-mode dispatcher — see below) | extensively pinned — 33 `expect(result.exitCode).toBe(...)` assertions across both modes (`validate-worker-json.test.ts`) |

**Dual-mode dispatchers keep bespoke dispatch — adopt the extraction primitive only, do not force
either into the other 13 files' shape:**

- `campaign-resume-signal.ts` dispatches on `--hook` / implicit-stdin (`argv.length === 0 &&
  !process.stdin.isTTY`) / `--input <file>` inside `main()`, after `parseCliArgs` returns. Only
  `parseCliArgs`'s internal loop (currently hand-rolled, lookahead shape, flags `--hook`
  (boolean), `--campaign-dir <path>`, `--input <path>`) adopts `parseFlags`/`requireFlag` (for
  the two string flags; `--hook` stays a direct boolean flag lookup). The three-way `if
  (hook || ...) ... else if (inputFile) ... else usage()` dispatch in `main()` is untouched.
- `validate-worker-json.ts` dispatches on `--hook` vs CLI (`--role`/`--file`/`--json`) vs
  `--recover-transcript` inside its own `parseCliArgs`/dispatch logic (5 flags: `--hook`
  (boolean), `--role`, `--file`, `--json`, `--recover-transcript`, `--enum-source`). Only the
  flag-extraction loop adopts the shared primitive; `runHook`/`runCli`/`runRecoverTranscript`'s
  branching and each of their own exit-code returns are untouched.

**Verified: neither `parseArgs` nor `parseCliArgs` is exported from any of the 15 files** (`grep
-n "^export function parse"` over all 15 returns nothing) — no external consumer beyond each
file's own module scope, so the extraction changes an internal implementation detail only, never
a public interface (see § Dependency Blast-Radius, omitted below the 3-consumer trigger).

**On `stack-repair.ts` non-migration**: the router's leg split (#867 → #902/#903) scopes this PR
to exactly the 15 files above and the new shared module; `stack-repair.ts` itself is not touched
(Scout Protocol — stay within the diff boundary, `stack-repair.ts` is untouched code). This
leaves `stack-repair.ts`'s own `parseFlags`/`requireFlag` as a **16th, now-duplicate** copy of
the identical logic once `scripts/lib/argv-flags.ts` exists — a disclosed, deliberate scope
boundary, not an oversight. Task 6's detector's closed allowlist deliberately excludes
`stack-repair.ts` for the same reason (the router explicitly rejected an open `scripts/**` regex
detector for this exact false-positive risk — `analyze-902`). Recommendation for the PR
description: file a small fast-follow issue proposing `stack-repair.ts` import the extracted
module too, rather than silently carrying the duplication forward unremarked (`V-DRY-01`,
advisory, not blocking this PR).

**`scripts/lib/campaign-status/cli.ts`'s `parseStatusArgs` is not the seed and is not touched.**
It solves subcommand dispatch (a different concern from flag/value pairs) — confirmed by the
router (`router-902`) and independently by `analyze-902`; adopting the shared primitive there
would not fit its shape and is out of scope (`V-INT-03` — no third variant is introduced by
leaving it alone; it was never a variant of this concern to begin with).

## Execution Strategy & Stop Conditions

| Task | Agent | Model | Stop Condition |
|---|---|---|---|
| 1. TDD Baseline | implementer | sonnet | If the full suite does not pass cleanly on `plan_base_commit`, HALT and report the pre-existing failures — do not attribute them to this plan's changes. |
| 2. Red mis-pairing test | implementer | sonnet | If the reproduction does NOT fail against `plan_base_commit` (i.e. the bug does not reproduce as described), STOP and escalate — the plan's central disclosed-fix premise would be wrong. |
| 3. Extract `argv-flags.ts` | implementer | sonnet | If `parseFlags`/`requireFlag` require any behavior beyond what `stack-repair.ts:187-204` already implements, STOP and escalate rather than inventing new parsing policy — the seed is deliberately minimal (`V-KISS-01`/`V-YAGNI-01`). |
| 4. Migrate 13 single-dispatch sites | implementer | sonnet | If migrating any site changes even one `process.exit(N)` literal argument from the § Codebase Conventions table, REVERT that file's migration and re-scope — exit codes are this plan's hard constraint, never an incidental casualty. |
| 5. Migrate 2 dual-mode dispatchers | implementer | sonnet | If preserving bespoke dispatch in `main()`/`runHook`/`runCli` requires touching more than the flag-extraction loop itself, STOP — the dispatch logic is explicitly out of scope for this task. |
| 6. Detector + V-ARGV-01 | implementer | sonnet | If the detector's closed allowlist would need to include `stack-repair.ts` or `campaign-status/cli.ts` to pass, STOP — that means the allowlist was built wrong (see § Codebase Conventions boundaries); it must name exactly the 15 files in Touch-Paths, no more. |
| 7. Doc-sync verification | implementer | sonnet | If `blackhole-state.md` § Write protocol or `merge-gate.md`'s exit-code prose is found to have drifted from actual behavior (not expected — no exit code changes), edit the doc in the same diff before merge; do not merge stale prose. |
| 8. Verify Integrity | implementer | sonnet | If `bun run verify` reports any failing check (including the new `argv-flags-adoption` detector) or any test regression outside this diff's own new/modified tests, HALT before opening the PR. |

## Task Breakdown

1. **TDD Baseline Verification.** Run the full test suite on `plan_base_commit` and record the
   pass/fail count, plus specifically `bun test scripts/lib/state-write-guard.test.ts
   scripts/merge-base-guard.test.ts scripts/carry-staged-artifacts.test.ts
   scripts/check-review-artifact.test.ts scripts/plan-quality-gate.test.ts
   scripts/validate-worker-json.test.ts scripts/triage-deferred-findings.test.ts
   scripts/campaign-resume-signal.test.ts scripts/promote-review-artifact.test.ts
   scripts/review-aggregate.test.ts scripts/ci-diagnosis.test.ts
   scripts/design-aggregate.test.ts scripts/decision-log-append.test.ts
   scripts/companion-file-sync.test.ts scripts/verify.v-test09-hooks-claim.test.ts`.
   — **AC**: baseline suite run, pass/fail counts for the full suite and the 15-file subset
   quoted verbatim in the completion evidence.

2. **Red-before-green: author the mis-pairing regression test.** Add a new test to
   `scripts/lib/state-write-guard.test.ts` reproducing the Objective's exact repro
   (`--tmp <tmp> --entity-key --live <live>` binds `entityKey` to the string `'--live'` and
   drops the real `--live` flag and its path entirely) and assert on the **current, wrong**
   observable behavior against `plan_base_commit`'s unmigrated parser — either the misleading
   stderr text ("is missing the required \"--live\" key") or, more robustly, assert that
   `validateStateWrite` never received `entityKey: 'findings'`/`'issues'` (i.e. the swallowed
   value is provably wrong, not merely "some error occurred"). Capture this test's failing
   (red) run verbatim for the PR description before proceeding to Task 3.
   — **AC**: the new test is red against `plan_base_commit`; the failing run's output is quoted
   in the completion evidence.

3. **Extract `scripts/lib/argv-flags.ts`.** Port `stack-repair.ts:187-204`'s `parseFlags`/
   `requireFlag` verbatim into a new, exported, pure module (no I/O, no `process.exit`). Add
   `scripts/lib/argv-flags.test.ts` with unit coverage for: (a) a normal `--flag value` pair
   parses to `{ flag: 'value' }`; (b) a boolean flag (`--flag` with no trailing value, or
   followed by end-of-argv) parses to `{ flag: true }`; (c) **the fix** — a flag immediately
   followed by another flag name (`['--entity-key', '--live', '/x']`) parses to `{ 'entity-key':
   true, live: '/x' }`, never `{ 'entity-key': '--live' }`; (d) `requireFlag` returns the string
   value when present and throws when the value is `true` (boolean) or absent.
   — **AC**: `bun test scripts/lib/argv-flags.test.ts` passes, including the (c) mis-pairing
   assertion; `stack-repair.ts` itself has zero changed lines (verbatim port, not a shared
   import from it — `stack-repair.ts` stays untouched per Touch-Paths).

4. **Migrate the 13 single-dispatch sites** (`carry-staged-artifacts.ts`,
   `check-review-artifact.ts`, `ci-diagnosis.ts`, `decision-log-append.ts`,
   `design-aggregate.ts`, `lib/companion-file-sync.ts`, `lib/state-write-guard.ts`,
   `merge-base-guard.ts`, `plan-quality-gate.ts`, `promote-review-artifact.ts`,
   `review-aggregate.ts`, `triage-deferred-findings.ts`, `v-test09-hooks-claim.ts`) to import
   `parseFlags`/`requireFlag` from `scripts/lib/argv-flags.ts`, replacing each file's own
   parsing loop body while keeping its own `usage()`/`try-catch`/exit-code selection exactly as
   documented in the § Codebase Conventions per-site table.
   — **AC**: for each of the 13 files, `git diff` shows changes confined to the parsing-loop
   function body (`parseArgs`/`parseCliArgs`) and its call site's flag-lookup expressions; every
   `process.exit(N)` literal integer argument in the diff is byte-identical to the pre-migration
   value (verified per-file against the table above); all 13 files' own existing test
   assertions pass unmodified.

5. **Migrate the 2 dual-mode dispatchers** (`campaign-resume-signal.ts`,
   `validate-worker-json.ts`) — adopt the extraction primitive for their flag-parsing loops only,
   per § Codebase Conventions' dual-mode-dispatcher note. Re-run Task 2's regression test: it
   must now pass (green) against the migrated `state-write-guard.ts`.
   — **AC**: both files' `main()`/dispatch/`runHook`/`runCli`/`runRecoverTranscript` bodies have
   zero changed lines outside the flag-extraction loop; Task 2's test is green; all existing
   `campaign-resume-signal.test.ts`/`validate-worker-json.test.ts` assertions pass unmodified.

6. **Detector: `scripts/checks/argv-flags-adoption.check.ts`.** Closed allowlist of exactly the
   15 Touch-Paths file paths above (never `stack-repair.ts`, never
   `scripts/lib/campaign-status/cli.ts`, never any future script) — for each, assert its source
   contains an import of `parseFlags` and/or `requireFlag` from a path ending in `argv-flags`
   (style precedent: `scripts/checks/cwd-pin-guard.check.ts`'s `TARGET_SCRIPTS` allowlist +
   per-line regex scan, reused for the allowlist shape, not the regex content). Add
   `scripts/verify.argv-flags-adoption.test.ts` per the `scripts/verify.<name>.test.ts`
   convention (e.g. `scripts/verify.cwd-pin-guard.test.ts`). Register **one new row**,
   `V-ARGV-01`, in `src/references/blackhole-vcodes.md` (BLOCK severity, matching the structural
   drift-guard class `V-CWDPIN-01`/`V-INCLUDE-01` already use — this is a permanent regression
   guard against a future file reintroducing a hand-rolled parser at one of these 15 paths, not
   a one-time migration check), citing `scripts/checks/argv-flags-adoption.check.ts` as primary
   enforcement site.
   — **AC**: the detector is red before Task 4/5 land (no file yet imports `argv-flags`) and
   green only once all 15 files have migrated — this is the same "red today, green only at full
   adoption" shape as `V-CWDPIN-01`'s own sweep, verified by running the detector against
   `plan_base_commit` (red, quoted in evidence) and against the final diff (green, quoted in
   evidence). `scripts/lib/build/facts.ts`'s `VCODE_TABLE_ROW_COUNT` is re-derived at implement
   time as `(live count) + 1` — never hardcode the literal successor value (issue #769
   convention); re-run `bun run build` so all generated dist trees pick up the new row.

7. **Documentation Impact verification.** Re-read `src/references/blackhole-state.md` § Write
   protocol and `src/references/merge-gate.md`'s exit-code documentation against the final diff
   and confirm both remain accurate — no exit-code integer or CLI flag name changed anywhere in
   this plan. State this explicitly in the PR description with citations to the exact sections.
   **If** verification finds either doc has drifted (not expected), edit it in the same diff
   with `last_updated` bumped before merge.
   — **AC**: PR description contains an explicit "doc-sync verified, no edit needed" line citing
   both sections, OR either doc is edited in the same diff with `last_updated` bumped.

8. **Verify Integrity.** Run the full test suite, lint, and typecheck; run `bun run verify` in
   full (including the new `argv-flags-adoption` check) and confirm 0 failures.
   — **AC**: full suite green, lint clean, `bun run verify` reports 0 failing checks — all
   quoted in the completion evidence.

## Sprint Contract

- Task 1: baseline suite pass/fail counts quoted (full suite + 15-file subset).
- Task 2: new mis-pairing test is red against `plan_base_commit`; failing output quoted.
- Task 3: `argv-flags.test.ts` passes including the mis-pairing fix assertion; `stack-repair.ts`
  has zero changed lines.
- Task 4: 13 files' `process.exit(N)` literals byte-identical to the § Codebase Conventions
  table; all existing per-file tests pass unmodified.
- Task 5: both dual-mode dispatchers' dispatch logic has zero changed lines outside the
  extraction loop; Task 2's test is now green; existing tests pass unmodified.
- Task 6: detector red on `plan_base_commit`, green on the final diff; `V-ARGV-01` row added;
  `bun run build` regenerates all dist trees.
- Task 7: doc-sync statement present (verified-unchanged, or edited with bumped `last_updated`).
- Task 8: full suite + lint + `bun run verify` all green.
- Definition of done for any task with no narrower AC above: full test suite and the repo's
  standard lint/typecheck both pass.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — N/A, no DB/API schema change in this plan |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |
| `ac_sweep_conflict` | PASS — no sweep-to-zero AC in this plan |
| `ac_sweep_scope` | PASS — no sweep-to-zero AC in this plan |
| `touch_paths_ssot_gap` | PASS — no `TOUCH_PATH_SSOT_PAIRS` trigger phrase present |
| `ac_facts_literal_bump` | PASS — Task 6 states `VCODE_TABLE_ROW_COUNT` as a live re-derivation (`count + 1`), never a hardcoded literal |

Verified via:

```
bun run --cwd /Users/morphism/Documents/git/blackhole scripts/plan-quality-gate.ts \
  --plan-file /Users/morphism/Documents/git/blackhole/.blackhole/plans/issue-902.md \
  --repo-root /Users/morphism/Documents/git/blackhole
```

```json
{
  "ac_mapping": true,
  "critical_files_exist": true,
  "mitigation_concrete": true
}
```

(First run flagged `critical_files_exist: false` — the Critical Files section's prose had
backtick-quoted secondary citations (e.g. a ledger filename mentioned in passing) that the
gate's `extractBacktickPaths` heuristic also treats as a critical-file path to check for
existence. Fixed by removing backticks from non-path prose citations in that section; the two
actual critical-file paths are unaffected.)

## References

- Issue: #902 — "refactor(scripts): shared argv parser for homogeneous --flag value sites (leg 2
  of #867)"
- Parent: #867 (merged, PR #910) — scoped to leg 1 (`readJsonFile` bypasses) only; explicitly
  carved legs 2 (#902, this plan) and 3 (#903, unrelated — `findAdrFileByNumber`
  triplication + `carry-staged` mkdir block) out at merge time (`queue.json` issue 867 `notes`
  field).
- Router decision: `task_type: refactor`, `plan_mode: full`, `needs_design: false`,
  `docs_impact: true`, `security_review_required: false`, `ui: false`, size `m`.
- `router-902` / `analyze-902`: rejected an open `scripts/**` regex detector (would inherit and
  worsen #913's raw-text false-positive class); proposed the closed 15-path import-presence
  allowlist adopted in Task 6.
- `src/references/blackhole-state.md` § Write protocol (exit-code contract:
  `state-write-guard.ts` 0/1/2).
- `src/references/merge-gate.md` (exit-code contract: `merge-base-guard.ts` 0/1/2/3, prose
  confirming exit `3` is deliberate — "Keeping that case out of 1 is the whole point").
- Seed: `scripts/stack-repair.ts:187-204` (`parseFlags`/`requireFlag`).
- Style precedent for the closed-allowlist detector: `scripts/checks/cwd-pin-guard.check.ts` /
  `scripts/verify.cwd-pin-guard.test.ts`.
- product-principles.md rulings checked at `rulings_revision: 5` — no `active`-status ruling
  conflicts with this plan (R-001 documentation-integration-floor: satisfied via §
  Documentation Impact's verification-only finding; R-002/R-003/R-004: not applicable to this
  issue's scope).
