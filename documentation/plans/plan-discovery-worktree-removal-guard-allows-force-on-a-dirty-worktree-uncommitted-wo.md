---
type: plan
summary: "Bugfix plan closing the gap where `worktree-removal-guard.js` checks unpushed commits under `--force` but never checks working-tree cleanliness — a mechanical `git status --porcelain` check gated on `force`, covering both the named-branch and detached paths (issue #777)"
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
---

# Plan - Issue #777

## Objective

**Root cause (V-FIX-01)**: `evaluateOneInvocation` in
`templates/hooks/pretooluse/utils/worktree-removal-guard.js:355-407` asks exactly one question of
a `--force` removal — *"does this branch have commits its remote lacks?"* (`checkUnpushedCommits`,
`:370`). It never asks *"is the working tree itself dirty?"* Without `--force`, git's own native
refusal answers that second question for free (`git help worktree`: "Only clean worktrees (no
untracked files and no modification in tracked files) can be removed... remove refuses to remove
an unclean worktree unless --force is used"). `--force` bypasses that native refusal — and nothing
in this module backstops it, so uncommitted and untracked work is discarded silently. This is the
one gap in the guard's own stated purpose ("refusing rather than risk silent data loss") that has
no mechanical check anywhere.

**Provenance (restated from the issue, not re-derived)**: pre-existing, not a PR #776 defect —
before #776 every detached HEAD refused unconditionally, so the dirty case was denied
*incidentally*; the identical gap already existed on the named-branch clean path, before and
after #776. #776 restored parity with an existing gap rather than creating one.

**Docstring contradiction (`F-00371`, folded into this issue)**: the module header currently
asserts both sides of the same fact. `:13` — "`git worktree remove` (with or without `--force`)
refuses on a dirty working tree" (false: `--force` bypasses it). `:18` — "`--force` already
bypasses git's own dirty-tree refusal" (true). A load-bearing safety comment asserting the
opposite of the behavior this fix now depends on cannot be left in place; Task 3 corrects `:13`
so the header agrees with itself before the new check is added below it.

## Design Decisions (ruling on each point in the spawn brief)

**1. Placement — confirmed, sibling check in `evaluateOneInvocation`.** A new function
`checkDirtyWorktree(worktreePath)`, called from `evaluateOneInvocation` in parallel with (not
folded into) `checkUnpushedCommits`. The two ask orthogonal questions via orthogonal commands —
`git status --porcelain` (working-tree state) vs. `git log ref..HEAD` (commit-history
reachability) — and have orthogonal failure modes (a dirty index has nothing to do with whether
HEAD is pushed). Folding the new logic into `checkUnpushedCommits` would make that function
answer two unrelated questions and force every future edit to one concern to re-reason about the
other. **Ordering**: `checkDirtyWorktree` runs *first*, before `checkUnpushedCommits` /
`checkDetachedReachability` — it is the cheaper check (one `git status` call vs. branch
resolution plus `for-each-ref`/`log`), and — the design payoff — it does not touch or depend on
branch/detached-HEAD logic at all, so it denies uniformly on both the named-branch and detached
paths without adding a single line to either `checkUnpushedCommits`'s named-branch ladder or
`checkDetachedReachability`. This directly satisfies AC1's "both paths, same new `pattern_id`"
with zero new branching logic, and confirms the sequencing note below: this plan touches nothing
`#781` (which edits `checkUnpushedCommits`'s ref-selection logic) or `#788` (which edits
`findWorktreeRemoveInvocations`/`evaluateWorktreeRemoval`) also touch.

**2. Gated on `force` — yes.** Git's own dirty-tree refusal for the non-`--force` path is
long-documented, stable behavior (`git help worktree`, quoted above) — `git worktree remove
--force` requiring a *second* `--force` only for a **locked** worktree, not merely a dirty one
(same source: "remove refuses to remove an unclean worktree unless --force is used. To remove a
locked worktree, specify --force twice."). Relying on it for the plain-removal case, rather than
duplicating a `git status --porcelain` check that would fire redundantly ahead of git's own (more
informative, per-file) refusal message, avoids a second, driftable source of truth for a rule git
already enforces correctly — consistent with this issue's own explicit "Out of scope: Non-`--force`
removal" and with `checkUnpushedCommits`'s asymmetric design (that check runs unconditionally,
because *no* git command natively refuses on unpushed history; this one is conditional, because
one already does for the non-force path).

**3. What counts as dirty — git's own "unclean" definition, untracked files included; refuse, not
warn or exclude.** `git help worktree`'s own definition of "clean" is "no untracked files and no
modification in tracked files" — a single `--force` bypasses refusal for **both** classes
identically (only a *locked* worktree needs the second `--force`). So `git status --porcelain`
must run in its default mode (untracked files included) — passing `--untracked-files=no` would
make this check strictly narrower than the exact git behavior `--force` bypasses, silently
re-opening loss of untracked *source* files (a stray build artifact and an uncommitted new source
file are indistinguishable to any check that doesn't know developer intent). AC3 states this
outcome directly ("untracked-only dirt... also denies... exactly the case a `git diff`-based check
would miss") — refuse, matching the AC and matching git's own bar for what `--force` here
discards. **On the #781 false-refusal lesson cited in the brief**: that case (a *miscoverfigured*
`@{u}` producing a wrong verdict on a genuinely clean, fully-pushed branch) is not this case — here
the check is correct by git's own definition, and the failure mode of *not* denying is silent,
irrecoverable data loss on a file that may be precious. The mitigation for the "annoying build
artifact" scenario is not a looser check but an actionable remedy: commit, stash, or run `git
clean` **deliberately** (an explicit, auditable action the caller chooses) rather than the guard
silently making that choice for them.

**4. Docstring fix** — see Task 3 below for the exact corrected text.

## Touch-Paths
- `templates/hooks/pretooluse/utils/worktree-removal-guard.js` — the canonical source. New
  function `checkDirtyWorktree`, one new call site inside `evaluateOneInvocation` (before the
  existing `checkUnpushedCommits` call), one new `pattern_id`, the module docstring correction
  (`:13`), and the `module.exports` list. No other function changes —
  `checkUnpushedCommits`, `checkDetachedReachability`, `findWorktreeRemoveInvocations`,
  `evaluateWorktreeRemoval`, `parseWorktreeRemoveArgs`, `skipGitGlobalOptions`,
  `isCommandWordStart` are all out of scope (owned by merged #761/#774, or by queued #781/#788 —
  see Execution Strategy below).
- plus all generated dist trees per `scripts/lib/build/targets.ts` (`bun run build`, never
  hand-edited): confirmed 4 copies exist today — `.claude/hooks/utils/worktree-removal-guard.js`,
  `.agents/build/hooks/utils/worktree-removal-guard.js`,
  `plugins/blackhole/hooks/utils/worktree-removal-guard.js`,
  `plugins/blackhole-claude/hooks/utils/worktree-removal-guard.js`. (These are copied verbatim
  from `templates/hooks/pretooluse/` by `scripts/lib/build/trees.ts`, not by a `targets.ts`
  compile entry — the phrase above is this campaign's fixed Touch-Paths convention for every
  build-generated dist tree regardless of which script performs the copy, kept for consistency
  with every other plan's Touch-Paths section, not a claim that `targets.ts` itself lists this
  file.)
- `scripts/hooks-validate-bash.test.ts` — new tests only, appended to the end of the existing
  `describe('validate-bash-command.js — worktree-removal guard (#532)', ...)` block (immediately
  before its closing `});`, which currently ends right before the
  `describe('validate-bash-command.js — worktree-removal guard global-option and multi-invocation
  regression (#532)', ...)` block). No existing test in the file is modified.

## Documentation Impact

None — the change is confined to a hook module's own docstring and behavior, plus its test file.
No file under `documentation/` currently names this mechanized check (the closest prior art,
`documentation/plans/plan-discovery-bash-pretooluse-guards-miss-every-path-qualified-invocation-usr-bin-gi.md`,
covers issue #774's unrelated path-qualification defect in the same source file — confirmed by
grep, no overlap). `blackhole-protocol.md`'s own "Removal safety refusal" bullet describes the
**orchestrator-level** manual pre-removal check (`git log @{u}..HEAD`) and remains accurate after
this fix — it is not the mechanized PreToolUse guard this issue changes, and needs no edit. This
plan's own durable copy is staged per the process below (ADR-021 D3), which is the Documentation
Impact this Quick-track plan itself produces, not an impact *on* another doc.

## Threat Escalation Check (route.security_review_required: true)

Per `planner.md`'s Quick Track STRIDE-lite screen, run before finalizing this track:

1. Does this change touch auth/authz? **No** — a local, unauthenticated git-safety check run by a
   PreToolUse hook against the developer's own working tree; no identity or permission boundary.
2. Does it read or write user data? **No** — it reads working-tree status (`git status
   --porcelain`) in a local repository; no application or user data is touched, and nothing is
   written by the check itself.
3. Does it add or modify an endpoint? **No** — no network-facing endpoint anywhere in this file;
   a synchronous, local `execFileSync` wrapper, exactly like the two checks it sits beside.

All three "no" — Quick Track stands, `threat_screen_passed: true` stamped above (`V-THREAT-01`).
As with #761 in the same file, `route.security_review_required: true` reads as raised by the
issue's security-shaped vocabulary ("uncommitted work discarded", "guard", "no check") rather than
an actual auth/data/endpoint surface — the screen exists precisely to catch that over-trigger
without silently skipping it. For visibility beyond the formal 3-question gate, an informal
STRIDE pass over the change itself: Spoofing/Repudiation/Elevation of Privilege — not applicable
(no identity or privilege boundary exists in a local CLI hook). Tampering — the change *reduces*
tamper risk (it prevents `--force` from silently discarding local file state). Information
Disclosure — the denial `reason` string echoes back the first 5 lines of `git status --porcelain`
output already visible to the same local user who ran the command; no new exposure. Denial of
Service — a false-positive refusal on a dirty worktree the caller intends to keep is the
*intended* fail-closed behavior (Design Decision 3), not a DoS; it is user-correctable by
committing, stashing, or cleaning, matching the existing `worktree-remove-unpushed` precedent's
same trade-off. This paragraph is informational context for the reviewer, not a formal `##
Threat Model` section — that section is a Standard-track artifact this plan does not emit,
consistent with `worker-schemas.md`'s section-presence gating (Step 8).

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run `bun test scripts/hooks-validate-bash.test.ts` at
  `plan_base_commit` to confirm the existing worktree-removal-guard suite passes before any edit.
  — **AC**: command output quoted showing every existing test in
  `describe('validate-bash-command.js — worktree-removal guard (#532)', ...)` (and the two later
  worktree-removal-guard describe blocks) passing, 0 failing.

- [ ] **Write Failing Tests (V-TEST-01/02)**: Append four tests to the end of the existing
  `describe('validate-bash-command.js — worktree-removal guard (#532)', ...)` block in
  `scripts/hooks-validate-bash.test.ts`, immediately before its closing `});`:

  1. `'deny: --force does not bypass a tracked-file modification — the file's own docstring
     contradiction this fix corrects (#777)'` — `withRemoteTrackedWorktree`, add+commit a tracked
     file, `push()`, then modify that file's contents without committing. Run
     `git worktree remove --force ${worktree}`. Assert `exitCode === 2`,
     `permissionDecision === 'deny'`, `permissionReason` matches `/uncommitted|untracked/i`, and
     the durable event `toMatchObject({ decision: 'deny', tier: 'block', pattern_id:
     'worktree-remove-force-dirty' })`.
  2. `'deny: untracked-only dirt (no modified tracked files) also denies — exactly the case a git
     diff-based check would miss (#777 AC3)'` — `withRemoteTrackedWorktree`, `push()` on the
     unmodified initial commit (branch stays fully clean/pushed), then write one new file in the
     worktree with **no** `git add`. Run `git worktree remove --force ${worktree}`. Same
     assertions and `pattern_id` as test 1 — proves the check is not merely a `git diff` wrapper.
  3. `'deny: a detached HEAD reachable from a remote-tracking ref (the #761 allow case) still
     denies when dirty — the new check runs uniformly on both paths (#777 AC1)'` — build the exact
     reachable-detached fixture from the existing `'allow: a detached HEAD reachable from a
     remote-tracking ref...'` test above (bare `origin`, throwaway branch pushed to
     `refs/heads/pr-9`, local throwaway branch deleted, `git fetch ... refs/heads/pr-9:refs/remotes/origin/pr-9`,
     `git worktree add --detach ${worktree} ${sha}`), then write one untracked file into the
     worktree. Run `git worktree remove --force ${worktree}`. Assert deny with `pattern_id:
     'worktree-remove-force-dirty'` (**not** `'worktree-remove-detached-unreachable'` —
     `permissionReason` should **not** match `/detached/i`, proving the dirty check fires before,
     and independently of, the detached-reachability ladder).
  4. `'allow: a fully pushed, clean worktree with no unpushed commits is still removed silently
     with --force (#777 retained-behavior control)'` — `withRemoteTrackedWorktree`, `push()`, no
     further writes. Run `git worktree remove --force ${worktree}`. Assert `exitCode === 0`, empty
     stdout, `readHookEvents(mainRepo)` equals `[]` — the over-tightening control the brief calls
     out: `--force` on a genuinely clean, fully pushed worktree must remain unaffected.

  — **AC**: `bun test scripts/hooks-validate-bash.test.ts` run again; all four new tests present
  and **failing** — tests 1-3 fail because today's `evaluateOneInvocation` never calls a dirty
  check at all (falls through to `checkUnpushedCommits`, which returns `'clean'` for a fully
  pushed branch regardless of working-tree state, so the command is allowed); test 4 already
  passes today (it is the retained-behavior control, not a red test) and stays green throughout —
  confirm this explicitly rather than assuming it, since a control that was never actually run
  red-then-green proves nothing. Quote all four results.

- [ ] **Implement Minimal Fix**: In
  `templates/hooks/pretooluse/utils/worktree-removal-guard.js`:
  1. Add a new function `checkDirtyWorktree(worktreePath)`, placed immediately before
     `checkUnpushedCommits` (i.e., right after `checkDetachedReachability`'s closing `};`):
     ```js
     /**
      * Resolves whether `worktreePath`'s working tree has uncommitted or untracked changes — the
      * state a single `--force` bypasses at the git level (`git help worktree`: "Only clean
      * worktrees (no untracked files and no modification in tracked files) can be removed...
      * remove refuses to remove an unclean worktree unless --force is used"). Runs `git status
      * --porcelain` in its default mode (untracked files included, not `--untracked-files=no`):
      * a single `--force` discards untracked-only dirt exactly as it discards tracked
      * modifications, so excluding untracked files here would make this check strictly narrower
      * than the git behavior it exists to backstop (issue #777).
      *
      * Three outcomes:
      *  - `{ status: 'dirty', detail }` — porcelain output is non-empty. Deny.
      *  - `{ status: 'clean' }` — porcelain output is empty. Allow (falls through to
      *    checkUnpushedCommits/checkDetachedReachability).
      *  - `{ status: 'unknown', detail }` — could not run `git status` (bad path, not a repo at
      *    that path). Deny — fail-closed, same posture as checkUnpushedCommits's own 'unknown'
      *    outcome. Reuses the same `pattern_id` as the confirmed-dirty case rather than minting a
      *    second one: this outcome names the same risk (cannot confirm the worktree is safe to
      *    discard), just from a different cause, and the issue's own AC1 asks for exactly one new
      *    `pattern_id` for this check — the `reason` string still carries the specific cause.
      */
     const checkDirtyWorktree = (worktreePath) => {
       let porcelain;
       try {
         porcelain = git(['-C', worktreePath, 'status', '--porcelain'], worktreePath);
       } catch (error) {
         return {
           status: 'unknown',
           detail: `could not run git status in ${worktreePath} (${error.message})`,
         };
       }
       if (porcelain) {
         return { status: 'dirty', detail: porcelain.split('\n').slice(0, 5).join('; ') };
       }
       return { status: 'clean' };
     };
     ```
  2. In `evaluateOneInvocation`, insert this block between the `resolvedPath` assignment and the
     existing `const result = checkUnpushedCommits(resolvedPath);` line, gated on `force`:
     ```js
     if (force) {
       const dirty = checkDirtyWorktree(resolvedPath);
       if (dirty.status !== 'clean') {
         return {
           tier: 'block',
           pattern_id: 'worktree-remove-force-dirty',
           reason:
             dirty.status === 'dirty'
               ? `Worktree at ${resolvedPath} has uncommitted or untracked changes (${dirty.detail}) that --force would discard permanently. Remedy: commit or stash the changes, or run 'git clean' deliberately first if they are genuinely disposable.`
               : `Could not verify ${resolvedPath} is clean (${dirty.detail}) — refusing rather than risk silent data loss.`,
         };
       }
     }
     ```
     Nothing else in `evaluateOneInvocation` changes — the existing `checkUnpushedCommits` call
     and every branch below it (`'unpushed'`, `'unknown'`/detached, `'unknown'`/named,
     fall-through `null`) are untouched.
  3. Correct the module docstring (`:13-19`) so it no longer contradicts itself. Replace:
     ```
      * `git worktree remove` (with or without `--force`) refuses on a dirty working tree but NOT on
      * committed-but-unpushed history (`blackhole-protocol.md` § Branch & Worktree Hygiene,
      * `recovery-protocol.md` §6(c)) — the orchestrator lost a real commit this way (F-00117) before
      * that gap was closed with prose alone (#526). This module makes the check mechanical: it denies
      * the removal (V-HOOK-01) when the worktree's branch carries commits its remote does not have,
      * for `--force` exactly as for a plain removal — `--force` already bypasses git's own dirty-tree
      * refusal, so it is the one removal path with no native safety net at all (issue #532 item 1).
     ```
     with:
     ```
      * `git worktree remove` refuses on a dirty working tree (uncommitted or untracked changes) by
      * default — git's own native check. `--force` bypasses that refusal, which is why this module
      * adds a mechanical `git status --porcelain` check of its own, gated on `force` (issue #777):
      * the one removal path with no native safety net at all (issue #532 item 1) now gets one here
      * instead. Neither form of the command refuses on committed-but-unpushed history
      * (`blackhole-protocol.md` § Branch & Worktree Hygiene, `recovery-protocol.md` §6(c)) — the
      * orchestrator lost a real commit this way (F-00117) before that gap was closed with prose
      * alone (#526). This module makes both checks mechanical: it denies the removal (V-HOOK-01)
      * when the worktree's branch carries commits its remote does not have, for `--force` exactly
      * as for a plain removal, and it denies a `--force` removal separately when the working tree
      * itself is unclean.
     ```
  4. Add `checkDirtyWorktree` to the `module.exports` list, alongside the existing
     `checkUnpushedCommits`/`checkDetachedReachability` exports (same testability convention the
     file already follows for every unit, even though this plan's own tests exercise it only
     through the subprocess hook path).
  — **AC**: all four new tests from the previous task now pass; no existing test's assertions
  change; the corrected docstring no longer contains the contradictory `:13` claim (grep for the
  literal string `refuses on a dirty working tree but NOT on` returns no match after the edit).

- [ ] **Regenerate Distribution Copies**: Run `bun run build` so
  `.claude/hooks/utils/worktree-removal-guard.js`,
  `.agents/build/hooks/utils/worktree-removal-guard.js`,
  `plugins/blackhole/hooks/utils/worktree-removal-guard.js`, and
  `plugins/blackhole-claude/hooks/utils/worktree-removal-guard.js` match the edited source.
  — **AC**: `git diff --stat` shows each of the four generated copies changed identically to the
  source edit; `bun run verify`'s dist-parity check passes.

- [ ] **Verify Integrity**: Run `bun test scripts/hooks-validate-bash.test.ts` (scoped — per the
  resource-frugal testing policy, do not run the full repo suite from this plan) and confirm every
  test in all three worktree-removal-guard describe blocks passes, including the four new tests
  and every pre-existing test (named-branch never-pushed, advanced-past-push, existing `--force`
  unpushed-commit tests, clean/pushed allow, unresolvable path, redirect variants, global-option
  variants, chained-command variants, both #761 detached tests, both #774 path-qualified tests).
  — **AC**: `bun test scripts/hooks-validate-bash.test.ts` output quoted showing the full file's
  pass count with 0 failing.

## Sprint Contract
- TDD Baseline Verification — AC: existing worktree-removal-guard suites pass pre-change.
- Write Failing Tests — AC: all four new tests present; tests 1-3 fail (bug reproduces), test 4
  already passes and is confirmed to stay green — quoted before any source edit.
- Implement Minimal Fix — AC: all four new tests pass; no existing test's assertions change; the
  docstring self-contradiction is gone (grep-confirmed).
- Regenerate Distribution Copies — AC: all 4 generated copies match the source edit.
- Verify Integrity — AC: full `scripts/hooks-validate-bash.test.ts` run, 0 failing.

Every task above carries a machine-verifiable AC; no task is judged by prose alone.

## Execution Strategy & Stop Conditions
- If any of tests 1-3 **passes without modification** at `plan_base_commit` (the bug does not
  reproduce as described) — halt implementation, do not touch `worktree-removal-guard.js`, and
  report back the exact `evaluateOneInvocation`/`checkUnpushedCommits` behavior observed for that
  case, quoted from the live file.
- If the fix causes any existing test in any of the three worktree-removal-guard describe blocks
  to fail — abort and re-inspect before proceeding: `checkDirtyWorktree` is a new function called
  from one new, additive branch in `evaluateOneInvocation`; a failure anywhere else means the
  insertion point was wrong (e.g., landed before `pathArg`/`resolvedPath` resolution, or altered
  an existing `if`/`return` instead of adding a new one) and must be reverted, not worked around.
- Touch-Paths are exactly the two files listed above (plus their build-generated copies) — no
  edit to `checkUnpushedCommits`'s ref-selection logic (declared scope of queued #781), no edit to
  `findWorktreeRemoveInvocations` or `evaluateWorktreeRemoval`'s top level (declared scope of
  queued #788). If the implementer finds a reason to touch either, stop and escalate rather than
  widening scope (`V-SCOPE-02`) — Design Decision 1 above confirms this plan's change needs
  neither.
- If `bun run build` reports no change to any generated copy after the source edit, stop and
  verify the build target list still includes all four distribution trees before concluding the
  build is simply idempotent-safe — a silent build-step no-op on a real source change would mean
  the shipped hook still runs the old logic.

## Hot-File Warning
None. This plan's Touch-Paths do not include `scripts/lib/build/facts.ts` or
`src/references/blackhole-vcodes.md` — no wave-lock sequencing needed. Sequencing note for the
orchestrator only (not a wave-lock, per the spawn brief): #781 and #788 are queued behind this
issue on the same source file. Per Design Decision 1, this plan's diff touches only
`evaluateOneInvocation`'s body (one new `if (force) { ... }` block) plus a new standalone function
and the module docstring/exports — it does not touch `checkUnpushedCommits`'s ref-selection logic
(#781's declared scope) or `findWorktreeRemoveInvocations`/`evaluateWorktreeRemoval`'s top level
(#788's declared scope), so no code-level collision is predicted with either. The only shared
surface is `scripts/hooks-validate-bash.test.ts`, where all three issues append new tests near the
same describe blocks — take this issue's implementation before #781/#788 dispatch (already the
declared queue order) and let their implementers rebase and append after this PR's tests land,
rather than resolving concurrent test-file edits by hand.

## Quality Gate Results
This is a Quick Track plan; `ac_mapping`/`critical_files_exist`/`mitigation_concrete` are
Standard-track checks gated on section presence, not track name (Step 8, "Section-presence
gating, not track-gating"). This plan emits `## Task Breakdown` and `## Execution Strategy & Stop
Conditions`, so both activate automatically; `## Critical Files` is not emitted (no pre-existing
sensitive touchpoint beyond the Touch-Paths file itself, already the subject of this change), so
`critical_files_exist` stays inert.

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — no schema/API/database change |
| `ac_mapping` | PASS — every `## Task Breakdown` item carries a measurable `— **AC**:` |
| `critical_files_exist` | N/A — `## Critical Files` not emitted |
| `mitigation_concrete` | PASS — every `## Execution Strategy & Stop Conditions` bullet pairs a concrete trigger with a concrete abort/halt/escalate action; no bare "monitor"/"be careful"/"watch" language |
