---
type: plan
status: current
review_trigger: "on file change"
created: 2026-09-04
last_updated: 2026-09-04
summary: "Bugfix plan closing the false-refusal gap where `checkUnpushedCommits` in `worktree-removal-guard.js` trusts a PRESENT `@{u}` even when it resolves to a different branch's remote-tracking ref (e.g. `origin/main` on a worktree whose own `refs/remotes/origin/<branch>` already contains HEAD) — issue #781"
---


# Plan - Issue #781

## Objective

**Root cause (V-FIX-01)**: `checkUnpushedCommits` in
`templates/hooks/pretooluse/utils/worktree-removal-guard.js:456-489` resolves the ref it diffs
`HEAD` against with:

```js
const compareRef = upstream || `refs/remotes/origin/${branch}`;
```

This trusts *any* resolvable `@{u}`, without checking that the upstream it resolved to actually
tracks `branch`. When a worktree's branch has a misconfigured or stale upstream — `@{u}` points at
`refs/remotes/origin/main` while the branch's own `refs/remotes/origin/<branch>` (the ref that
actually reflects whether *this* branch's history reached the remote) already contains `HEAD` —
`compareRef` resolves to `origin/main` instead. `git log origin/main..HEAD` then reports every
commit on the branch that isn't yet on `main`, which is nearly always non-empty for a feature
branch, producing a false `'unpushed'` verdict and a refused removal on a worktree that is, in
fact, fully pushed and already merged. This is the live incident described in the issue: observed
during a mergeable-worktree release after PR #780 merged.

**Fix shape**: validate that a resolved `upstream` ref actually names `branch` (its remote-tracking
segment must end in `/${branch}`, matching this campaign's own convention of pushing a worktree's
branch to a same-named remote ref, e.g. `blackhole/issue-N` → `refs/remotes/origin/blackhole/issue-N`)
before trusting it as `compareRef`. When `upstream` is absent, or present but mistracked, fall back
to the constructed `refs/remotes/origin/${branch}` — exactly the existing fallback path, just
reached by a wider set of inputs. When *neither* the validated `upstream` nor the constructed
fallback ref resolves, `git log ${compareRef}..HEAD` still throws and the existing `catch` block
still returns `{ status: 'unknown', detail: ... }` — the fail-closed `worktree-remove-unverifiable`
outcome is untouched, because the `catch` block itself is not being edited, only the value fed
into it.

**Independence from concurrent work on the same file (confirmed by the issue and re-verified
here)**: `#788`/`#804` (merged, `findWorktreeRemoveInvocations`/executable-detection) and `#777`
(merged, `checkDirtyWorktree` — the `force`-gated dirty-tree check, now visible at
`:349-437`/`:544-565` in the live file) both touch disjoint functions. This plan's diff is confined
to `checkUnpushedCommits`'s body (`:456-489`) and its docstring — no other function in the file is
read or modified.

## Design Decisions

**1. Validation shape — suffix match on the upstream's remote-tracking path, not a hardcoded
`origin/` check.** `upstream` is already a fully-qualified ref
(`git rev-parse --symbolic-full-name @{u}` → `refs/remotes/<remote>/<path>`). Checking
`upstream.endsWith(`/${branch}`)` confirms the ref's own path segment equals the local branch name
— the exact condition the fallback `refs/remotes/origin/${branch}` also encodes — without
re-deriving or hardcoding the remote name a second time. This handles branch names that themselves
contain `/` (this campaign's own `blackhole/issue-N` convention): `refs/remotes/origin/blackhole/issue-2`
`.endsWith('/blackhole/issue-2')` is `true`, and a mismatched case like
`refs/remotes/origin/main` `.endsWith('/blackhole/issue-2')` is `false` — no false match is
possible from a shorter unrelated ref ending in a different final segment, because `endsWith`
requires the full `/${branch}` substring, not just a shared suffix character.

**2. Fallback, not `'unknown'`, on a validated mismatch.** A mismatched `upstream` does not mean
"this branch has no known pushed state" — it means "this particular tracking pointer isn't
authoritative for this branch's push status", and the existing fallback ref
(`refs/remotes/origin/${branch}`) is exactly the mechanism the module's own docstring
(`:24-25`) already documents for the "no upstream configured" case. Reusing it for "upstream
configured but wrong" rather than returning `'unknown'` immediately keeps one fallback path
instead of two, and correctly allows the AC3 case (mistracked upstream, but the branch's own
remote ref is fully caught up) instead of denying it on a technicality.

**3. No new `pattern_id`.** This is a correction to which ref feeds the existing `'unpushed'` /
`'clean'` / `'unknown'` outcomes in `checkUnpushedCommits` — it does not add a new outcome or a new
caller-visible decision branch. `evaluateOneInvocation`'s existing `pattern_id` assignments
(`worktree-remove-unpushed`, `worktree-remove-force-unpushed`, `worktree-remove-unverifiable`,
`worktree-remove-detached-unreachable`) are unchanged and untouched by this plan.

## Touch-Paths
- `templates/hooks/pretooluse/utils/worktree-removal-guard.js` — the canonical source.
  `checkUnpushedCommits`'s upstream-validation logic only (`:467-475` in the live file: the
  `upstream` resolution block and the `compareRef` assignment immediately after it), plus the
  module docstring paragraph describing `@{u}` trust (`:22-25`) updated to state the validation.
  No other function changes — `checkDirtyWorktree`, `checkDetachedReachability`,
  `findWorktreeRemoveInvocations`, `evaluateWorktreeRemoval`, `parseWorktreeRemoveArgs`,
  `skipGitGlobalOptions`, `isCommandWordStart`, `normalizeShellWord` are all out of scope (each
  already closed by a separate merged issue).
- plus all generated dist trees per `scripts/lib/build/targets.ts` (`bun run build`, never
  hand-edited): confirmed 4 copies exist today — `.claude/hooks/utils/worktree-removal-guard.js`,
  `.agents/build/hooks/utils/worktree-removal-guard.js`,
  `plugins/blackhole/hooks/utils/worktree-removal-guard.js`,
  `plugins/blackhole-claude/hooks/utils/worktree-removal-guard.js`.
- `scripts/hooks-validate-bash.test.ts` — new tests only, appended to the end of the existing
  `describe('validate-bash-command.js — worktree-removal guard (#532)', ...)` block (the block
  starting at `:740` in the live file, immediately before its closing `});` at `:1259`). No
  existing test in the file is modified.

## Documentation Impact

None — the change is confined to a hook module's internal ref-selection logic plus its test file.
Grep of `templates/hooks/pretooluse/README.md`, `.claude/hooks/README.md`, and
`documentation/reference/decision-log.md` for `upstream`/`compareRef`/`checkUnpushedCommits`
returns no match: no doc describes this internal comparison logic today, so none goes stale.
`blackhole-protocol.md` § "Removal safety refusal" describes the orchestrator-level manual
pre-removal check (`git log @{u}..HEAD`), a separate human-run procedure this issue does not
change. This plan's own durable copy is staged per the process below (ADR-021 D3) — that staging
is this Quick-track plan's own Documentation Impact output, not an impact on another doc.

## Threat Escalation Check (route.security_review_required: true)

Per `planner.md`'s Quick Track STRIDE-lite screen, run before finalizing this track:

1. Does this change touch auth/authz? **No** — a local, unauthenticated git-safety check run by a
   PreToolUse hook against the developer's own working tree; no identity or permission boundary.
2. Does it read or write user data? **No** — it reads git ref state (`git rev-parse`, `git log`)
   in a local repository; no application or user data is touched, and nothing is written.
3. Does it add or modify an endpoint? **No** — no network-facing endpoint anywhere in this file; a
   synchronous, local `execFileSync` wrapper, exactly like every other check in this module.

All three "no" — Quick Track stands, `threat_screen_passed: true` stamped above (`V-THREAT-01`).

## Threat Model (STRIDE)

Router flagged `security_review_required: true` — this is a data-loss-prevention guard, so a
STRIDE table is included for reviewer visibility even though the 3-question screen above cleared
Quick Track (no auth/data/endpoint surface; this section documents the informal STRIDE pass, not
a Standard-track `## Threat Model` section subject to `V-THREAT-02`/`V-THREAT-03`).

| STRIDE category | Applicable? | Assessment | Mitigation status |
|---|---|---|---|
| Spoofing | No | No identity or principal exists in a local CLI hook invocation. | N/A |
| Tampering | No (risk-reducing) | The fix *removes* a tamper-adjacent false-positive: a misconfigured `@{u}` is local git config, not attacker-controlled input, and the fix makes the guard trust it *less*, not more. | Mitigated |
| Repudiation | No | No audit/identity trail applicable; the guard already writes a `.blackhole/hook-events/` record on every deny, unchanged by this fix. | N/A |
| Information Disclosure | No | The denial `reason` string echoes back ref names and `git log` output already visible to the same local user who ran the command; no new exposure introduced. | N/A |
| Denial of Service | Yes — this *is* the bug | The current (pre-fix) behavior is itself a DoS on a legitimate, safe operation: a fully-pushed, merged worktree is refused removal because of a stale/misconfigured upstream, forcing a manual workaround. The fix directly closes this. | Mitigated (by this fix) |
| Elevation of Privilege | No | No privilege boundary exists; the check only ever narrows or widens what a local developer's own `git worktree remove` is permitted to do. | N/A |

No HIGH/CRITICAL unmitigated threat remains after the fix (`V-THREAT-02` n/a — the one applicable
row, DoS, is the defect this plan closes). All six STRIDE categories evaluated (`V-THREAT-03`).

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run `bun test scripts/hooks-validate-bash.test.ts` at
  `plan_base_commit` to confirm the existing worktree-removal-guard suite passes before any edit.
  — **AC**: command output quoted showing every existing test in
  `describe('validate-bash-command.js — worktree-removal guard (#532)', ...)` (and the other
  worktree-removal-guard describe blocks in the file) passing, 0 failing.

- [ ] **Write Failing Tests (V-TEST-01/02, AC3 + AC4)**: Append two tests to the end of the
  existing `describe('validate-bash-command.js — worktree-removal guard (#532)', ...)` block in
  `scripts/hooks-validate-bash.test.ts`, immediately before its closing `});`:

  1. **AC3 regression** — `'allow: a branch whose @{u} points at a different branch's
     remote-tracking ref, but whose own refs/remotes/origin/<branch> contains HEAD, is removed
     silently (#781)'`. Build with `withRemoteTrackedWorktree('blackhole-hook-wt-',
     'blackhole/issue-781a', async (mainRepo, worktree, push) => { ... })`:
     - `push()` to put `HEAD` on `refs/remotes/origin/blackhole/issue-781a` (fully caught up).
     - In `mainRepo`, fetch `origin/main` into a local remote-tracking ref so it exists:
       `runGit(mainRepo, ['fetch', '--quiet', 'origin', 'main'])`.
     - Deliberately mistrack the worktree's branch upstream onto `origin/main`:
       `runGit(worktree, ['branch', '--set-upstream-to=origin/main', 'blackhole/issue-781a'])`.
     - Run `git worktree remove ${worktree}` via `runPreToolUseHook`.
     - Assert `result.exitCode === 0`, `result.stdout.trim() === ''`,
       `readHookEvents(mainRepo)` equals `[]`.
  2. **AC4 mutation guard** — `'deny: a branch with genuinely unpushed commits is still denied
     even when its @{u} is mistracked onto a different branch (#781)'`. Same setup as test 1
     (mistrack upstream onto `origin/main` after `push()`), but after mistracking, add one further
     local commit that is never pushed to `refs/remotes/origin/blackhole/issue-781b` (write a
     file, `git add`, `git commit`). Run `git worktree remove ${worktree}`. Assert
     `result.exitCode === 2`, `permissionDecision(result.stdout) === 'deny'`,
     `permissionReason(result.stdout)` matches `/remote/i`, and
     `readHookEvents(mainRepo)` has length 1 matching `{ decision: 'deny', tier: 'block',
     pattern_id: 'worktree-remove-unpushed' }`.

  — **AC**: `bun test scripts/hooks-validate-bash.test.ts` run again; both new tests present and
  **failing** at `plan_base_commit` — test 1 fails because today's `compareRef` resolves to the
  mistracked `origin/main` and `git log origin/main..HEAD` reports the branch's own commits as
  "unpushed" (false deny); test 2 already passes today (retained-behavior control — the existing
  fallback-free `compareRef = upstream` already denies on real unpushed history via `origin/main`,
  just for the wrong structural reason) — confirm explicitly rather than assuming, and quote both
  results.

- [ ] **Implement Minimal Fix**: In `checkUnpushedCommits`
  (`templates/hooks/pretooluse/utils/worktree-removal-guard.js:456-489`), replace:
  ```js
  const compareRef = upstream || `refs/remotes/origin/${branch}`;
  ```
  with:
  ```js
  // A resolvable `@{u}` is not sufficient on its own: it may point at a DIFFERENT branch's
  // remote-tracking ref (misconfigured or stale tracking config), which would compare HEAD
  // against the wrong history and produce a false 'unpushed' verdict on a branch that is
  // actually fully pushed under its own name (#781). Trust `upstream` only when its own
  // remote-tracking path segment names this branch; otherwise fall back to the constructed
  // ref exactly as when no upstream is configured at all.
  const upstreamTracksThisBranch = upstream !== null && upstream.endsWith(`/${branch}`);
  const compareRef = upstreamTracksThisBranch ? upstream : `refs/remotes/origin/${branch}`;
  ```
  Update the module docstring paragraph at `:22-25` (the `@{u}` trust rationale) to note that a
  resolved `@{u}` is now validated against the branch name before use, not merely resolved.
  — **AC**: both new tests from the previous task now pass; no existing test's assertions change
  (full worktree-removal-guard suite re-run, 0 failing); grep for `upstream ||
  \`refs/remotes/origin/\${branch}\`` (the pre-fix expression) returns no match after the edit.

- [ ] **Regenerate Distribution Copies**: Run `bun run build` so
  `.claude/hooks/utils/worktree-removal-guard.js`,
  `.agents/build/hooks/utils/worktree-removal-guard.js`,
  `plugins/blackhole/hooks/utils/worktree-removal-guard.js`, and
  `plugins/blackhole-claude/hooks/utils/worktree-removal-guard.js` match the edited source, with
  no hand-edited generated copy (AC5).
  — **AC**: `git diff --stat` shows each of the four generated copies changed identically to the
  source edit; `bun run verify`'s dist-parity check passes.

- [ ] **Verify Integrity**: Run `bun test scripts/hooks-validate-bash.test.ts` (scoped — per the
  resource-frugal testing policy, do not run the full repo suite from this plan) and confirm every
  test in every worktree-removal-guard describe block passes, including the two new tests and
  every pre-existing test (never-pushed, advanced-past-push, force-variants, dirty-worktree
  variants, clean/pushed allow, unresolvable path, redirect variants, global-option variants,
  chained-command variants, detached-HEAD variants, path-qualified variants).
  — **AC**: `bun test scripts/hooks-validate-bash.test.ts` output quoted showing the full file's
  pass count with 0 failing.

## Sprint Contract
- TDD Baseline Verification — AC: existing worktree-removal-guard suites pass pre-change.
- Write Failing Tests — AC: both new tests present; AC3 test fails (bug reproduces), AC4 test
  already passes and is confirmed to stay green — quoted before any source edit.
- Implement Minimal Fix — AC: both new tests pass; no existing test's assertions change; the
  pre-fix expression is gone (grep-confirmed).
- Regenerate Distribution Copies — AC: all 4 generated copies match the source edit, no
  hand-edited generated copy.
- Verify Integrity — AC: full `scripts/hooks-validate-bash.test.ts` run, 0 failing.

Every task above carries a machine-verifiable AC; no task is judged by prose alone.

## Execution Strategy & Stop Conditions
- If the AC3 test **passes without modification** at `plan_base_commit` (the false-refusal does
  not reproduce as described) — halt implementation, do not touch `worktree-removal-guard.js`,
  and report back the exact `checkUnpushedCommits` behavior observed for that case, quoted from
  the live file, rather than proceeding on an unconfirmed premise.
- If the fix causes any existing test in any worktree-removal-guard describe block to fail —
  abort and re-inspect before proceeding: the fix is a single-line `compareRef` derivation change
  with no new branch in the surrounding control flow; a failure elsewhere means the edit reached
  further than `:467-475`, or an existing test's fixture accidentally relies on the pre-fix
  overtrust behavior, and either case must be diagnosed, not worked around.
- Touch-Paths are exactly the two files listed above (plus their build-generated copies) — no
  edit to `checkDirtyWorktree`, `checkDetachedReachability`,
  `findWorktreeRemoveInvocations`/`evaluateWorktreeRemoval`, or any parsing helper. If the
  implementer finds a reason to touch any of those, stop and escalate rather than widening scope
  (`V-SCOPE-02`) — Design Decision 1 above confirms this fix needs none of them.
- If `bun run build` reports no change to any generated copy after the source edit, stop and
  verify the build target list still includes all four distribution trees before concluding the
  build is simply idempotent-safe — a silent build-step no-op on a real source change would mean
  the shipped hook still runs the old, overtrusting logic.

## Hot-File Warning
None. This plan's Touch-Paths do not include `scripts/lib/build/facts.ts` or
`src/references/blackhole-vcodes.md` — no wave-lock sequencing needed. Dependencies `#774` and
`#777` are already merged (queue.json `depends_on: [774, 777]`, both terminal) — no sequencing
conflict remains on the shared source file; the guard-file-sequencing constraint that blocked this
issue is fully resolved.

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
