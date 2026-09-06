---
type: plan
summary: "Fix hook-event ingest so archiving a consumed event happens only after its ledger update is durably persisted (persist-then-archive, ADR-042 Option 1), closing a silent-loss window on crash or write-guard refusal"
status: current
review_trigger: "on ADR-042 amendment or hook-event-triage.ts change"
created: 2026-09-06
last_updated: 2026-09-06
---


# Plan - Issue #909

## Objective

`scripts/lib/hook-event-triage.ts`'s `ingestHookEvents` archives each consumed
`.blackhole/hook-events/*.json` file with a per-event `fs.renameSync` **inside** its loop
(`origin/main@2c05b869`, line 193), while the accumulated ledger update it computes is persisted
**once**, in `main()`, after the loop returns (the `.tmp` → `validateStateWrite` →
`fs.renameSync(tmpPath, ledgerPath)` protocol at lines 245-256). A crash or a fail-closed guard
refusal occurring after some or all events have been archived but before that final ledger
install therefore loses the ledger contribution of every already-archived event in that run — the
event file itself survives (moved to `.blackhole/archive/hook-events-<ts>/`, never deleted), but
nothing ever re-surfaces it, because it is gone from the intake directory the next run scans.

**Chosen option: #1, persist-then-archive ordering** (of the issue's four). Reorder the two
side effects so the ledger install is durable **before** any event file is archived, by moving
archiving out of `ingestHookEvents` (a computation step) entirely and into `main()`, gated on a
successful `fs.renameSync(tmpPath, ledgerPath)`. `ingestHookEvents` becomes side-effect-free with
respect to the filesystem — it returns which files were consumed (`consumedFiles`) without
touching them — and a new exported `archiveConsumedFiles` performs the archival, called from
`main()` strictly after the install.

**Failure-direction analysis (the trap the issue calls out)**: the two failure directions are not
symmetric.
- **Silent loss** (today's bug): an event is archived, the process dies before the ledger write,
  and nothing ever indicates a finding was dropped. Unrecoverable and invisible.
- **Duplicate ingest** (Option 1's residual window — crash strictly *after* the ledger rename
  succeeds but *before* `archiveConsumedFiles` runs): the event file is still sitting in
  `.blackhole/hook-events/` on the next run, so it is re-ingested. Because ADR-042 gives
  hook-derived findings **per-class identity** `(vcode, pattern_id, worktree)` with an
  `occurrences` counter, a duplicate ingest of the *same* event does not create a second row — it
  bumps `occurrences` on the existing row by one extra than the real world warrants. This is
  visible (the count is in the ledger, inspectable, and every row is already understood as "how
  many times this class fired," not "exactly N distinct physical events" — `hook-schemas.md`'s
  own framing), bounded (at most one extra count per un-archived file, and only until the next
  successful run archives it), and self-limiting (a re-ingested file gets archived for real on the
  very next successful run, closing the window). Losing a finding forever is strictly worse than
  over-counting it once — Option 1 chosen because it converts an unrecoverable, invisible failure
  into a recoverable, visible, bounded one, at zero added write cost (still exactly one ledger
  install per run, matching today's cost — see Options 2/3 below for what was rejected and why).

**Options 2 and 3 rejected**: Option 2 (persist after every single event) turns one ledger write
into up to N, each paying the full `.tmp` + `validateStateWrite` + atomic-rename protocol cost —
the issue itself flags this against the measured live corpus (412 events at PR #908's review), and
this plan's own corpus-scale test (392 events, inherited from the existing test suite) makes that
cost concrete: up to 392 ledger installs in one run versus 1. Option 3 (two-phase commit with an
intent marker + reconciliation on next start) is the most correct but adds a second piece of
on-disk protocol state and a reconciliation code path for a failure window this plan's chosen
option already bounds to "one visible over-count, self-correcting on next run" — the issue's own
framing calls this `V-KISS-01` territory, and this plan agrees: the machinery is disproportionate
to the residual risk once Option 1 is in place.

## Touch-Paths

- `scripts/lib/hook-event-triage.ts`
- `scripts/lib/hook-event-triage.test.ts`

## [docs_governance.enabled] Documentation Impact

None — router resolved `docs_impact: false`. This is a two-file, internal campaign-tooling
correctness fix with no change to a public interface, config schema, or consumer-facing doc
surface. (Separately, this plan document itself is durably staged into `documentation/plans/`
per this agent's own ADR-021 D3 obligation — see "Staged Artifacts" below; that is not a
Documentation Impact of the code change.)

## Critical Files

- `scripts/lib/state-write-guard.ts` — the write-protocol dependency (`validateStateWrite`) this
  fix's ordering guarantee depends on. Not modified by this plan, but the fix's entire premise
  (archive only after a successful install) rests on this file's guard semantics staying exactly
  as they are today; any implementer touching it accidentally is out of scope and must revert.

## Codebase Conventions

| Concern | Convention | Evidence |
|---|---|---|
| Write protocol (snapshot → `.tmp` → `validateStateWrite` → atomic rename) | `blackhole-state.md` § Write protocol; already implemented in `main()` at lines 241-256 | `scripts/lib/hook-event-triage.ts:241-256` |
| Per-class finding identity + `occurrences` counter | ADR-042 (issue #893) — `(vcode, pattern_id, worktree)` dedup key, `occurrences`/`last_seen_at` fields, additive-only schema (`ledger-schema.check.ts` never rejects an unknown key) | `scripts/lib/hook-event-triage.ts:56-60` (`findingDedupKey`), `:33-36` (`occurrences?`/`last_seen_at?`) |
| Archive-not-delete for consumed events | ADR-042 item 4 — a consumed event file is moved into `.blackhole/archive/hook-events-<ts>/`, never unlinked, so it survives even after its ledger row collapses | `scripts/lib/hook-event-triage.ts:189-193` (current, in-loop); this plan relocates the *timing*, not this invariant |
| `deps`-injection seam for CLI entrypoints | `main(deps: { validateStateWrite } = { validateStateWrite })` — a real default, overridable by a test stub, used today to exercise the guard-refusal branch without manufacturing a genuine rejection | `scripts/lib/hook-event-triage.ts:220`, exercised by the existing `'write guard refuses...'` test |
| `withTempDir` fixture for filesystem-touching tests | Every `ingestHookEvents`-level test in this file builds an isolated temp repo root via `withTempDir('hook-triage-', (repoRoot) => {...})` rather than touching the real repo | `scripts/lib/hook-event-triage.test.ts` (every test in the `describe('ingestHookEvents — Triage 1b round-trip')` block) |
| `main()`-level tests use a real `.blackhole/` at repo root, guarded and cleaned up | `describe('main() CLI entrypoint')`'s `withCampaignDir` helper asserts no pre-existing `.blackhole/` before running, and always removes it in `finally` | `scripts/lib/hook-event-triage.test.ts` (`describe('main() CLI entrypoint')`) |

**Design decision — no new `deps` parameter on `main()`.** The obvious way to test the residual
"ledger installed, archive not yet run" window would be to add `deps.archiveConsumedFiles` to
`main()`'s injectable seam (mirroring `deps.validateStateWrite`) and force it to throw. This plan
rejects that in favor of composing the two now-separately-exported pure primitives
(`ingestHookEvents` and the new `archiveConsumedFiles`) directly in the test: call
`ingestHookEvents`, persist its returned ledger by hand, deliberately *skip* calling
`archiveConsumedFiles` (simulating "the crash happened right here"), assert the safe intermediate
state, then call the real `main()` again to prove recovery. This exercises the identical contract
without widening `main()`'s public signature for a scenario three already-exported functions can
reconstruct — `V-KISS-01`/`V-YAGNI-01` at plan time, not just at review time.

## Execution Strategy & Stop Conditions

- If, after Task 2, `bun test scripts/lib/hook-event-triage.test.ts` reports the modified
  `'write guard refuses...'` test **passing** against the pre-fix code (i.e. before Task 3 lands),
  **halt and rewrite the added assertion** — it means the assertion did not reach the real defect
  window and the red-before-green requirement (`V-UNFALSIFIABLE-01`, `V-TEST-11`) is not met.
- If, after Task 4 (the fix), any of the pre-existing tests in `describe('ingestHookEvents —
  Triage 1b round-trip')` that directly assert on immediate post-`ingestHookEvents` archiving
  (the first test in the file, and `'2c — a consumed event is archived...'`) still fail once
  updated to call the new `archiveConsumedFiles` explicitly, **halt and revert Task 4** — it means
  `consumedFiles`'s contents do not match what was actually tier-mapped and previously archived
  in-loop, a behavior-preservation regression, not a test-wiring issue.
- If the corpus-scale test (`'Task 3 AC — 392-event replay...'`) fails after the fix, **halt and
  revert Task 4** — the `occurrences`-sum-to-`ingested` invariant (ADR-042, verified against the
  live 412-event corpus at PR #908 review) must hold unchanged in the clean, no-crash path; this
  plan's fix must never touch that arithmetic, only the timing of the archive side effect.
- If `bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-909.md` reports any
  `FAIL`, stop and revise this plan document (not the code) before implementation begins.

## Task Breakdown

- [ ] **Task 1 — TDD Baseline Verification**: Run `bun test scripts/lib/hook-event-triage.test.ts`
  before touching any file. — **AC**: baseline pass/fail counts quoted verbatim in the completion
  evidence; zero pre-existing failures.

- [ ] **Task 2 — Red-before-green: extend the guard-refusal test to prove archiving is not gated
  on a successful ledger install**. In the existing `'write guard refuses: does not install the
  tmp file, removes it, and exits non-zero'` test (`describe('main() CLI entrypoint')`), add one
  assertion after the existing ones:
  `expect(fs.existsSync(path.join(eventsDir, 'guard-refusal-event.json'))).toBe(true);` — the
  event must still be sitting in `.blackhole/hook-events/`, un-archived, because the ledger write
  it was meant to feed was refused. On current `main` this assertion fails: `ingestHookEvents`
  archives `guard-refusal-event.json` unconditionally, as a side effect of computing the ledger
  update, before `main()` ever calls `validateStateWrite` — so by the time the guard runs (and
  refuses), the file is already gone from `eventsDir` (`fs.existsSync` returns `false`), and the
  new assertion reports `Expected: true, Received: false`. A fail-closed guard refusal is used
  here as the deterministic, in-process stand-in for "the process died before the ledger install"
  — it exercises the exact same code path (`main()` never reaching
  `fs.renameSync(tmpPath, ledgerPath)`) that a `SIGKILL` at that point would, without needing to
  manufacture a genuine crash. — **AC**: `bun test scripts/lib/hook-event-triage.test.ts -t "write
  guard refuses"` fails with exactly that assertion mismatch before Task 4, and passes after.

- [ ] **Task 3 — Red-before-green: add the crash-recovery test proving a duplicate ingest inflates
  the occurrence count rather than losing the event**. New test in `describe('ingestHookEvents —
  Triage 1b round-trip')`, using `withTempDir`:
  1. Write one event file (`tier: 'warn'`, a fixed `pattern_id`/`worktree`) into a fresh
     `eventsDir`.
  2. Call `ingestHookEvents({ repoRoot, queueIssues: {}, ledger: { refreshed_at: '', next_id: 1,
     findings: [] } })`. Assert `ingested === 1`, `updated.findings[0].occurrences === 1`, **and**
     assert the event file still exists at its original path in `eventsDir` — this is the
     "crash happened between persist and archive" state, constructed directly rather than by
     throwing inside `main()`, per the Codebase Conventions design decision above. On current
     `main` this existence assertion fails: `ingestHookEvents` already archived the file as part
     of computing the update, so it is gone from `eventsDir` by the time the test checks — this is
     the same underlying defect as Task 2's assertion, reached through the lower-level API instead
     of the CLI entrypoint.
  3. Write `updated` ledger to a real `findings-ledger.json` under a temp `.blackhole/` (simulating
     "the ledger install succeeded") — do **not** call `archiveConsumedFiles` (simulating "then it
     crashed").
  4. Call `ingestHookEvents` again against the same `eventsDir` and the just-persisted ledger
     (simulating the next run's fresh ingest, which finds the still-present event file). Assert
     `ingested === 1` again and `occurrences === 2` on the same (`vcode`, `pattern_id`, `worktree`)
     row — the duplicate is visible as an inflated count, not a second row and not silence.
  5. Call `archiveConsumedFiles` for real this time and assert the event file is now gone from
     `eventsDir` and present under `.blackhole/archive/hook-events-<ts>/` — the window closes on
     the next successful run.
  — **AC**: this test fails at step 2's file-existence assertion against current `main` (documented
  failure: `expect(fs.existsSync(eventFile)).toBe(true)` receives `false`); after Task 4 it passes
  end-to-end including the final `occurrences === 2` assertion.

- [ ] **Task 4 — Implement Option 1 (persist-then-archive)**:
  1. In `ingestHookEvents`: remove the in-loop `archiveDir`/`archiveDirEnsured`/`fs.renameSync`
     side effect. Instead, push each successfully tier-mapped event's absolute `filePath` onto a
     new `consumedFiles: string[]` array. Add `consumedFiles` to the function's return type and
     return value (alongside the existing `ingested` and `ledger`).
  2. Add a new exported function `archiveConsumedFiles({ repoRoot, consumedFiles }: { repoRoot:
     string; consumedFiles: string[] }): void` that creates `.blackhole/archive/hook-events-<ts>/`
     (one directory per call, `Date.now()`-suffixed exactly as today) and `fs.renameSync`s each
     path in `consumedFiles` into it — this is the archiving logic extracted verbatim from the old
     loop, unchanged in *what* it does, changed only in *when* it is called.
  3. In `main()`: capture `consumedFiles` from `ingestHookEvents`'s return value; call
     `archiveConsumedFiles({ repoRoot: root, consumedFiles })` only immediately after
     `fs.renameSync(tmpPath, ledgerPath)` succeeds (i.e. after the durable ledger install, before
     the final `console.log`). The existing early-return branches (`ingested === 0`, guard
     `ok: false`) must **not** call `archiveConsumedFiles` — an un-persisted batch's events stay in
     `.blackhole/hook-events/` for the next run.
  4. Add one inline comment at the new `archiveConsumedFiles` call site in `main()` stating the
     chosen option (Option 1, issue #909) and the accepted duplicate-ingest tradeoff in one or two
     sentences — this is the code-level record of the AC #1 decision, alongside this plan document.
  — **AC**: Tasks 2 and 3's tests now pass; `bun test scripts/lib/hook-event-triage.test.ts`
  reports zero failures.

- [ ] **Task 5 — Update the tests written against the old in-loop-archive contract**: the first
  test in the file (`'tier error ingests as V-HOOK-03 ... archives (not deletes)...'`) and
  `'2c — a consumed event is archived under .blackhole/archive/hook-events-<ts>/, not unlinked'`
  both currently assert archiving as an immediate side effect of calling `ingestHookEvents` alone.
  Update both to call the new `archiveConsumedFiles({ repoRoot, consumedFiles: result.consumedFiles
  })` explicitly before asserting on the archive directory's contents — no assertion is removed or
  weakened (`V-TEST-10`), only the missing intermediate step is made explicit. The CLI-level happy
  path test (`'ledger + hook events present: ingests, archives the event, writes the ledger
  through the guard'`) needs **no** change — it drives real `main()` end to end and already
  asserts both the ledger update and the archived file together, which now additionally pins that
  `main()` performs both steps in the correct order. — **AC**: `bun test
  scripts/lib/hook-event-triage.test.ts` — 0 failures; `grep -c "archiveConsumedFiles"
  scripts/lib/hook-event-triage.test.ts` reports at least 3 (the two updated tests plus Task 3's
  new test).

- [ ] **Task 6 — Verify Integrity**: Run `bun test scripts/lib/hook-event-triage.test.ts` and
  `bun run scripts/verify.ts` (or the project's full lint/typecheck entrypoint, whichever this
  repo's `package.json` names for CI parity) — **AC**: full suite green for the touched file, no
  new lint/typecheck errors introduced, both outputs quoted in the completion evidence.

## Sprint Contract

- Task 1: baseline suite passes (0 pre-existing failures) before any edit.
- Task 2: the extended guard-refusal assertion fails on current `main`, passes after Task 4.
- Task 3: the new crash-recovery test fails at its step-2 assertion on current `main`, passes
  end-to-end (including the `occurrences === 2` inflation check) after Task 4.
- Task 4: Tasks 2 and 3's tests pass; no other test in the file regresses.
- Task 5: `bun test scripts/lib/hook-event-triage.test.ts` reports 0 failures; at least 3
  `archiveConsumedFiles` call sites in the test file.
- Task 6: full touched-file test run and lint/typecheck both green, quoted verbatim in completion
  evidence.

Tasks with no narrower AC than "all tests and linters pass" (none here — every task above carries
its own machine-verifiable AC).

## [Standard Only] Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |

CLI output (`bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-909.md`):

```json
{
  "ac_mapping": true,
  "critical_files_exist": true,
  "mitigation_concrete": true
}
```
