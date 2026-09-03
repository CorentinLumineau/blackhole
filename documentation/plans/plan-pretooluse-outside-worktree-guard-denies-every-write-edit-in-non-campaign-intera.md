---
type: plan
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
---


# Plan - Issue #729

## Objective

Fix the PreToolUse `outside-worktree` containment so a non-campaign interactive session (no
`BLACKHOLE_ASSIGNED_WORKTREE` set) sitting in any git worktree of a plugin-enabled repo family
can still `Write`/`Edit` inside its own worktree and inside the Claude Code harness's own
per-session scratchpad — today both are denied because `allWorktreeRoots(cwd)` filters
`git worktree list --porcelain` down to roots nested under the main clone or the campaign
`scratchpad_dir`, dropping the worktree the hook's own `cwd` resolves to and dropping the
harness scratchpad entirely (it is not a git worktree and not under any repo).

## Touch-Paths

- `templates/hooks/pretooluse/utils/hook-event-log.js` — plus all generated dist trees per
  `scripts/lib/build/targets.ts` (confirmed canonical source via `scripts/lib/build/trees.ts`'s
  copy step; `.agents/build/hooks/utils/hook-event-log.js` cited in the issue body is a
  generated copy)
- `templates/hooks/pretooluse/validate-file-changes.js` — plus all generated dist trees
- `scripts/hooks-validate-file.test.ts`
- `scripts/lib/test-fixtures.ts` (if a new fixture helper is needed for the scratchpad-env-var case)
- `src/references/hook-schemas.md` — plus all generated dist trees

## Documentation Impact

`hook-schemas.md`'s `outside-worktree` denial-reason entry needs a one-line update noting the
two new admitted roots (cwd's own git toplevel; the opt-in `BLACKHOLE_SCRATCHPAD_DIR` override).
No other companion doc is affected — this is hook-internal containment logic, not a protocol or
agent-contract change.

## Codebase Conventions

- `readAssignedWorktreeRoot(cwd)` (issue #620) already short-circuits `allWorktreeRoots` when
  `BLACKHOLE_ASSIGNED_WORKTREE` is set — campaign implementer/reviewer/planner spawns are
  unaffected by this bug today; this fix only changes behavior for the unmarked, non-campaign
  session path.
- `isAcceptableScratchpadDir` already exists as the breadth-check gate for accepting a
  scratchpad-shaped path — reuse it rather than inventing a second check (`V-INT-02`).
- Follow the existing `BLACKHOLE_HOOK_EVENT_DIR` / `BLACKHOLE_ASSIGNED_WORKTREE` env-var
  precedent for the new `BLACKHOLE_SCRATCHPAD_DIR` override (naming convention, read-once,
  validated through `isAcceptableScratchpadDir`).

## Database/API Schema Changes

None.

## Threat Model

`route.security_review_required: true` (this sits directly in the Write/Edit containment/authz
boundary; #510/#512/#620 all previously hardened this exact boundary).

| Threat | Severity | Mitigation status |
|---|---|---|
| **Spoofing** — a process sets `BLACKHOLE_SCRATCHPAD_DIR` to impersonate a trusted root | Medium | Mitigated — the value still passes through the existing `isAcceptableScratchpadDir` breadth check (same validation as every other admitted root; no new bypass of that gate) |
| **Tampering** — widening the root set lets a write land somewhere it previously couldn't | High | Mitigated — the only widening is (a) `cwd`'s own git toplevel, which the hook already trusts unconditionally as the sole bound in the *no-git-context* fallback branch (#512), so trusting it when git context *does* resolve is strictly no broader; (b) an *opt-in*, explicitly-set env var validated by the pre-existing breadth check, not an auto-detected pattern |
| **Repudiation** — n/a, no logging/audit trail change | Low | Accepted Risk — out of scope, unaffected by this fix |
| **Information Disclosure** — n/a, this hook only gates write targets, never reads/returns file contents | Low | Accepted Risk — unaffected |
| **Denial of Service** — a session with a valid worktree could now write where it previously couldn't; this could not create a *new* unbounded-write vector since containment stays scoped to `cwd`'s own resolved worktree, not "any worktree" | Medium | Mitigated — root set grows by exactly one entry (`cwd`'s own toplevel), never becomes unbounded; #510's original invariant (a session cannot write into an *unrelated* worktree it doesn't own) is preserved by a split regression test (see Task Breakdown) |
| **Elevation of Privilege** — a worker could set `BLACKHOLE_ASSIGNED_WORKTREE` itself to escape containment | Medium (downgraded from an initial Critical mislabel — this is a pre-existing trust boundary this fix neither introduces nor narrows; the severity was miscalibrated at first authoring, corrected during review per F-00394) | Accepted Risk (pre-existing, unchanged by this fix) — env vars are already implicitly trusted campaign-side; this issue does not touch that trust boundary, and closing it is out of scope for #729 |

## Execution Strategy & Stop Conditions

- Ship reporter's option (1) unconditionally: always include the git toplevel of the payload's
  own `cwd` in the root set returned by `allWorktreeRoots`, regardless of which branch (git
  context resolved vs. not) is taken.
- Ship a scoped variant of option (2): add a new `BLACKHOLE_SCRATCHPAD_DIR` env-var override
  (mirrors `BLACKHOLE_HOOK_EVENT_DIR` / `BLACKHOLE_ASSIGNED_WORKTREE`), validated through the
  existing `isAcceptableScratchpadDir` check, admitted as a root when set. This is an **opt-in**
  fix, not full auto-detection: Claude Code's PreToolUse hook payload/env exposes no field or
  var naming the session's own scratchpad directory (verified against the harness's own hooks
  documentation), so hardcoding a regex against the `/tmp/claude-<uid>/...` shape shown in agent
  system prompts would be brittle, undocumented-internal-contract-coupled logic. If the harness
  later exposes the scratchpad path natively, replace the env-var opt-in with that field —
  tracked as a follow-up, not blocking this fix.
- Reject option (3) (scope containment to campaign workers only, fail-open for unmarked
  sessions) — broader than necessary; it would also fail open for a genuinely misconfigured
  campaign session, which is a worse failure mode than the current narrow bug.
- Stop condition: if adding `cwd`'s own toplevel to the root set causes the existing #510
  regression test (`scripts/hooks-validate-file.test.ts:227-247`, which uses `cwd: evilWorktree`
  as its repro) to start passing for the wrong reason (i.e., the split described below doesn't
  cleanly separate the two invariants), stop and re-examine — do not weaken #510's actual
  guarantee (a session cannot write into a worktree that is neither its own `cwd` nor a nested
  campaign worktree) to make this fix easier.

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run the existing hook test suite (`scripts/hooks-validate-file.test.ts` and siblings) to confirm current green state before touching source. — **AC**: baseline suite run, pass/fail counts quoted in the completion evidence.
- [ ] **Split the #510 regression test**: `scripts/hooks-validate-file.test.ts:227-247` currently uses `cwd: evilWorktree` to assert a denial; since this fix now intentionally allows a session to write within its own `cwd`'s toplevel, split this into (a) a test preserving #510's actual invariant using a `cwd` that is a worktree *other than* the target's own (still denied), and (b) a new test asserting the new allow-case (`cwd` inside its own worktree, target inside that same worktree → allowed). — **AC**: both tests exist, (a) fails before any source change is reverted (regression-safe), (b) fails before the fix lands and passes after.
- [ ] **Write failing tests for issue #729's cases**: one test asserting a `Write`/`Edit` denial today for cwd's own non-nested worktree becomes an allow after the fix; one test asserting a target under `BLACKHOLE_SCRATCHPAD_DIR` (when set and validated) is allowed; one test asserting the harness scratchpad path is *still denied* when `BLACKHOLE_SCRATCHPAD_DIR` is unset (no silent full auto-detection). — **AC**: all three tests exist and fail for the expected reason before implementation.
- [ ] **Implement the fix**: in `allWorktreeRoots(cwd)` (`templates/hooks/pretooluse/utils/hook-event-log.js`), always union in the `git rev-parse --show-toplevel` result for the payload's own `cwd` (when resolvable) with the existing main-clone/scratchpad-nested root set; read `BLACKHOLE_SCRATCHPAD_DIR` once, validate via `isAcceptableScratchpadDir`, and admit it as an additional root when present and valid. — **AC**: previously-failing tests from the prior two tasks now pass; no file outside Touch-Paths modified.
- [ ] **Update `hook-schemas.md`'s `outside-worktree` entry**: one-line note on the two new admitted roots. — **AC**: doc updated, matches actual denial-reason behavior.
- [ ] **Verify Integrity**: run the full hook test suite and the project's lint/typecheck. — **AC**: full suite green, lint clean, both quoted in the completion evidence.

## Sprint Contract

Definition of done = every `## Task Breakdown` AC above satisfied; no additional untested
"all tests pass" catch-all beyond what each task already states.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — no schema/API changes |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS — `templates/hooks/pretooluse/utils/hook-event-log.js` and `validate-file-changes.js` both exist on disk |
| `mitigation_concrete` | PASS — Threat Model mitigations name concrete mechanisms (existing breadth check reuse, no-broader-than-existing-fallback argument), not "monitor"/"be careful" |
| `ac_sweep_conflict` | PASS |
| `ac_sweep_scope` | PASS |
| `touch_paths_ssot_gap` | PASS |
