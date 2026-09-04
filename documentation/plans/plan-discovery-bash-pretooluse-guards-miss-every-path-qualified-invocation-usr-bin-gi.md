---
type: plan
summary: "Bugfix plan fixing `worktree-removal-guard.js`'s `isCommandWordStart` predicate to recognize path-qualified `git` invocations (`/usr/bin/git`) without reopening the `--git-dir=/x/.git` fragment false positive it was introduced to reject (issue #774)"
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
---

# Plan - Issue #774

## Objective

**Scope correction is binding** (issue #774 comment, owner, 2026-09-03T10:10:06Z): the issue's
own title/body claim that *every* `bash-patterns.json` rule misses path-qualified invocations is
false — measured, 14/14 caught, 0 bypassed (`.blackhole/tmp/pattern-bypass-test.js`). The real
defect is confined to `templates/hooks/pretooluse/utils/worktree-removal-guard.js`, and only to
its `isCommandWordStart` predicate. `validate-bash-command.js` and `bash-patterns.json` are out
of scope — neither is defective.

**Root cause (V-FIX-01)**: `isCommandWordStart` (`:103`) is the sole gate on which `\bgit\b`
regex matches `findGitWordIndices` (`:109-119`) treats as a real command word:

```js
const isCommandWordStart = (command, index) => index === 0 || /[\s;&|(\n]/.test(command[index - 1]);
```

It accepts a match only when the character immediately before it is the start of the command or a
shell separator (`\s;&|(\n`). This predicate exists specifically to reject the harmless `git`
fragment inside `--git-dir=/x/.git` — `\bgit\b` alone also matches that fragment because `.` is a
non-word character, so plain `\b` fires there too (docstring `:97-102`). The fix for that false
positive over-corrected: `/` is not in the allowed-predecessor set either, so a **genuine**
command word written as `/usr/bin/git`, `/home/linuxbrew/.linuxbrew/bin/git`, or `./git` is
discarded by the exact same check that discards the `.git` fragment. `findGitWordIndices` returns
`[]` for any command whose only `git` invocation is path-qualified,
`findWorktreeRemoveInvocations` (`:162`) has nothing to walk, and `evaluateWorktreeRemoval`
returns `null` — the command is allowed with **no unpushed-commit check at all**. This is a
fail-open on the guard `blackhole-protocol.md` § Branch & Worktree Hygiene relies on to prevent
committed-but-unpushed history from being destroyed (the same class of loss `checkUnpushedCommits`
exists to catch — see issue #761's plan/PR, already merged into this branch's base commit).

**The distinguishing signal, precisely** (issue's own framing, confirmed by tracing both sides):
a real invocation's `git` word sits at the end of a path token that itself starts at a genuine
command-word boundary (string start / whitespace / `;&|(\n`) — nothing but path characters (`/`,
alnum, `.`, `-`, `_`) between that boundary and the word. A fragment's `git` sits inside a token
that contains an `=` before the match — the `--git-dir=` prefix of an attached long-option value.
Walking backward from the character before the match to the nearest real word boundary, and
checking whether an `=` is crossed first, separates the two classes without needing to special-case
`.git` specifically (which would re-break on a `--git-dir=/x/git` value with no leading dot, an
equally real instance of the same fragment class the current code happens not to be tested against).

**Fix — one new predicate, one existing predicate widened by OR, nothing else touched**:

```js
/** True when a `git` word match at `index` is a path-qualified real invocation (#774) — e.g. the
 * "git" in "/usr/bin/git" or "./git" — rather than a fragment embedded in an `=`-attached option
 * value (the "git" in "--git-dir=/x/.git"). The distinguishing signal is position, not merely
 * "preceded by a slash": walk backward from the character before `index` (which must be `/`, or
 * this is not path-qualified at all) to the nearest real command-word boundary (start of string /
 * whitespace / separator). Reaching that boundary without crossing `=` means the whole path token
 * starts at a genuine command position — accept. Crossing `=` first means the path lives inside an
 * attached option value (`--flag=/some/path`) — reject, preserving the fragment exclusion
 * isCommandWordStart was introduced for (see its docstring above). */
const isPathQualifiedGitWordStart = (command, index) => {
  if (index === 0 || command[index - 1] !== '/') return false;
  let i = index - 1;
  while (i > 0 && !/[\s;&|(\n]/.test(command[i - 1])) {
    if (command[i - 1] === '=') return false;
    i -= 1;
  }
  return true;
};
```

`findGitWordIndices`'s single condition changes from
`isCommandWordStart(command, m.index)` to
`isCommandWordStart(command, m.index) || isPathQualifiedGitWordStart(command, m.index)`.
No other function in the file changes. `isCommandWordStart` itself is untouched — it still owns
the bare-word case exactly as before; the new predicate only ever fires for a match it currently
rejects (preceded by `/`), so the two conditions cannot double-fire on the same character class
and cannot change any existing accept/reject outcome.

**Worked trace, both sides of the line (required by the spawn brief)**:

| Input | `command[index-1]` | Backward walk hits first | Verdict |
|---|---|---|---|
| `/usr/bin/git worktree remove X` | `/` | string start (no `=` crossed) | accept — real invocation |
| `./git worktree remove X` | `/` | string start (no `=` crossed) | accept — real invocation |
| `cmd1 && /usr/bin/git worktree remove X` | `/` | the space after `&&` (no `=` crossed) | accept — real invocation |
| `git --git-dir=/x/.git status` (the `.git` fragment) | `.` | — (fails the `/` guard immediately) | reject — fragment |
| `git --git-dir=/x/git status` (no dot, hypothetical) | `/` | `=` (the one after `--git-dir`) | reject — fragment |
| `--git-dir` itself (the first `git` occurrence, inside `git-dir`) | `-` | — (fails the `/` guard immediately) | reject — flag name, not a path |

The second-to-last row is not asked for by the issue's literal AC2 (`--git-dir=/x/.git`, which
already fails at the first `/` guard, same as the third-to-last row) but is included in the trace
and in Task 2's test below because it is the case that would silently break if a future edit
weakened the walk to "just check for a preceding `/`" without the `=`-crossing check — exactly the
kind of over-tightening/under-tightening trap the issue's spawn brief calls out.

## Design Decision (V-CHOICE-01)

**Easy path**: widen `isCommandWordStart`'s allowed-predecessor character class to include `/`
directly (`/[\s;&|(\n\/]/`). **Rejected** — traced explicitly, per the spawn brief's requirement:
against `--git-dir=/x/.git`, the character immediately before the `.git` fragment's `git` is `.`,
not `/`, so this one-character widening would not even reach the fragment (it stays rejected by
accident, not by design) — but it does not correctly generalize: it says nothing about the `=`
boundary, so a value written without a leading dot (`--git-dir=/x/git`) would newly become an
**accepted** false invocation, silently reopening a narrower version of the same class of bug this
predicate exists to prevent, just never exercised by the one test case the issue quotes. A
one-character class widening also gives a future reader no way to tell, by reading the code, why
`/` is safe to add but `=` is not — the reasoning has to live somewhere.

**Hard path (chosen)**: a dedicated `isPathQualifiedGitWordStart` predicate that walks back to the
real token boundary and explicitly checks for a crossed `=`. Costs a few more lines and a small
backward scan (bounded by the token length, never more than one shell token) instead of a single
character-class check. Chosen because it encodes the actual invariant ("real invocation = path
token starting at a command boundary; fragment = inside an attached option value") rather than a
character that happens to distinguish today's one test case, and because the module's own
docstring convention (this file explains *why*, not just *what*, at every predicate) means the
next editor gets the reasoning inline rather than needing to re-derive it from a regression test
alone.

**Confidence**: High. The four-row worked trace above and Task 1/2's discriminating tests exercise
both sides of the line the fix draws, including the hypothetical no-dot fragment case the easy
path would have missed.

## Touch-Paths
- `templates/hooks/pretooluse/utils/worktree-removal-guard.js` — the canonical source; edit only
  `isCommandWordStart`'s immediate neighborhood (new `isPathQualifiedGitWordStart` function,
  `findGitWordIndices`'s condition, and the `module.exports` list). No other function in this file
  changes — `checkUnpushedCommits`, `checkDetachedReachability`, `evaluateOneInvocation`,
  `skipGitGlobalOptions`, `parseWorktreeRemoveArgs`, `findWorktreeRemoveInvocations`'s body, and
  `clauseTailFrom` are all out of scope for this plan (issue #761, already merged into this base
  commit, owns `checkUnpushedCommits`/`checkDetachedReachability`; #777, not yet dispatched, is a
  separate later issue in this same file — see Execution Strategy below for the conflict note).
- plus all generated dist trees per `scripts/lib/build/targets.ts` (`bun run build`, never
  hand-edited): confirmed 4 copies exist today —
  `.claude/hooks/utils/worktree-removal-guard.js`,
  `.agents/build/hooks/utils/worktree-removal-guard.js`,
  `plugins/blackhole/hooks/utils/worktree-removal-guard.js`,
  `plugins/blackhole-claude/hooks/utils/worktree-removal-guard.js`.
- `scripts/hooks-validate-bash.test.ts` — new tests only, appended as a new
  `describe('validate-bash-command.js — worktree-removal guard path-qualified git invocation
  (#774)', ...)` block placed after the existing
  `describe('validate-bash-command.js — worktree-removal guard global-option and
  multi-invocation regression (#532)', ...)` block (ends immediately before the
  `describe('validate-bash-command.js — uncaught validator crash fails closed, not open (#580)',
  ...)` block) — no existing test in this file is modified.

`validate-bash-command.js` and `templates/hooks/pretooluse/patterns/bash-patterns.json` are
explicitly out of scope (issue comment's scope correction) — do not touch either file. If the
implementer finds a reason to touch them, stop and escalate rather than widening scope
(`V-SCOPE-02`).

## [docs_governance.enabled] Documentation Impact

None — this is an internal predicate fix inside a PreToolUse hook's own module. The only prose
describing `isCommandWordStart`'s behavior lives in this same source file's docstrings (updated as
part of the fix itself, per convention already established at `:28-35`/`:97-102`). No
`documentation/` file, `ARCHITECTURE.md`, `AGENTS.md`, or `DESIGN.md` describes this predicate's
logic; `blackhole-vcodes.md`/`blackhole-protocol.md` describe the guard's *purpose*
(V-HOOK-01/`V-WORKTREE` obligations), not its regex-matching internals, and neither changes.

## Codebase Conventions

| Concern | Convention | Touchpoint |
|---|---|---|
| Predicate functions in this file are pure, take `(command, index)` or `(command, masked)`, and carry a docstring explaining the *why*, not just the *what* | Follow exactly — `isCommandWordStart`, `skipGitGlobalOptions`, `isLiteralPathArg` all do this | New `isPathQualifiedGitWordStart` function |
| Every testable pure unit in this file is re-exported in `module.exports` even when tests exercise it only through the subprocess hook path (see `checkDetachedReachability`, exported per issue #761's plan, never imported directly by a test) | Follow exactly | Add `isPathQualifiedGitWordStart` to `module.exports` alongside the existing `isCommandWordStart` |
| Regression tests for this guard run end-to-end through `runPreToolUseHook(SCRIPT, bashPayload(...), repo)` against the real subprocess, never by importing guard internals directly into the test file | Follow exactly — established across every `describe` block in `scripts/hooks-validate-bash.test.ts`, including the `#488`/`#580` non-executing-text and must-still-deny suites | Task 2's three new tests |
| `withRemoteTrackedWorktree(prefix, branch, fn)` / `withTempGitRepo(prefix, fn)` / `runGit(cwd, args)` (module-scoped in the test file since `:732`) are the established fixtures for worktree-removal-guard tests — no new fixture helper is added to `scripts/lib/test-fixtures.ts` for this plan | Follow exactly | Task 2 reuses all three unchanged |
| One `describe` block per issue/round, named `'validate-bash-command.js — <topic> (#<issue>)'` | Follow exactly | New block titled `'validate-bash-command.js — worktree-removal guard path-qualified git invocation (#774)'` |

## Threat Model

`route.security_review_required: true` (spawn brief). Six STRIDE categories, all evaluated
(`V-THREAT-03`):

| Category | Threat | Severity | Mitigation status |
|---|---|---|---|
| Spoofing | N/A — the guard reads only the literal command string and local git ref state; no identity claim is involved | Low | Accepted Risk — out of the guard's threat surface by design |
| Tampering | A worker crafts a `git` invocation specifically to evade `worktree-remove-unpushed` and destroy committed-but-unpushed history — this **is** the vulnerability #774 reports | Critical | Mitigated — `isPathQualifiedGitWordStart` closes the path-qualified evasion; Task 1's discriminating test proves the same never-pushed worktree that is silently allowed today is denied after the fix, with the identical `pattern_id`/reason a bare `git worktree remove` produces |
| Repudiation | A denied/allowed removal is recorded to `.blackhole/hook-events/` (`hook-event-log.js`) regardless of which predicate matched — unchanged by this fix | Low | Mitigated — pre-existing, verified unchanged by Task 4 (no new event-shape assertions needed; existing `readHookEvents` assertions in Task 2's tests confirm the record still fires) |
| Information Disclosure | The guard's refusal message names the resolved worktree path and git detail already present in the command the worker itself issued — no new information crosses a trust boundary here that the worker did not already have | Low | Accepted Risk — pre-existing behavior, not touched by this fix |
| Denial of Service | Over-tightening the predicate could cause a legitimate path-qualified `git` invocation to be *mis-detected* as a worktree-remove and incorrectly refused, blocking legitimate work — the reverse-direction failure mode the spawn brief explicitly asks to be ruled out | Medium | Mitigated — Task 2's `--git-dir=` retained-rejection test and Task 3's 14-case characterization test together prove the widened predicate does not fire on any of the fragment/flag-name shapes traced in the Objective's worked-trace table; `findWorktreeRemoveInvocations`'s own `tokens[0] !== 'git'` defensive check (`:165`, unchanged) independently guards against a match landing mid-token |
| Elevation of Privilege | N/A — the guard runs with the same local process privileges as the worker it is checking; it grants no new capability | Low | Accepted Risk — out of scope, unchanged by this fix |

All Critical/High-severity rows carry `Mitigated` status (`V-THREAT-02`): the one Critical row
(Tampering) is mitigated by the fix itself and Task 1's discriminating test; the one Medium row
(Denial of Service, the over-tightening direction) is Medium, not High/Critical, but is mitigated
anyway by Task 2 and Task 3's negative-control coverage.

## Task Breakdown

- [ ] **Task 0 — TDD Baseline Verification**: Run
  `bun test scripts/hooks-validate-bash.test.ts` at `plan_base_commit` to confirm every existing
  test in the file passes before any edit, and separately execute
  `.blackhole/tmp/pattern-bypass-test.js` (`bun run .blackhole/tmp/pattern-bypass-test.js` from
  the repo root) to reconfirm the 14/14-caught baseline the scope correction cites, so the
  characterization test in Task 3 is written against a freshly-observed baseline, not a stale
  quote.
  — **AC**: both command outputs quoted; the test file shows 0 failing, and the reproduction
  script prints `caught=14 bypassed=0`.

- [ ] **Task 1 — Write the discriminating bypass regression test (must fail pre-fix, pass
  post-fix)**: In a new `describe('validate-bash-command.js — worktree-removal guard
  path-qualified git invocation (#774)', ...)` block in `scripts/hooks-validate-bash.test.ts`, add:

  `'deny: /usr/bin/git worktree remove <path> on a never-pushed branch is denied — today it is
  silently allowed (#774)'` — build with `withRemoteTrackedWorktree('blackhole-hook-wt-',
  'blackhole/issue-774a', async (mainRepo, worktree) => {...})`, **never call `push()`** (mirrors
  the existing bare-`git` `'deny: a branch that was never pushed at all is refused'` test at
  `:740-757` exactly, substituting only the command string). Run
  `runPreToolUseHook(SCRIPT, bashPayload(\`/usr/bin/git worktree remove ${worktree}\`), mainRepo)`
  and assert: `result.exitCode === 2`, `permissionDecision(result.stdout) === 'deny'`,
  `readHookEvents(mainRepo)` has length 1 with
  `{ decision: 'deny', tier: 'block', pattern_id: 'worktree-remove-unverifiable' }` — the identical
  `pattern_id` the bare-word equivalent test asserts, satisfying AC1's "same `pattern_id` and
  reason a bare `git worktree remove` produces today" verbatim.

  **Mutation check the implementer must perform in both directions** (V-TEST-01/02 discipline):
  1. Run this test against the **current, unmodified** `worktree-removal-guard.js` (before Task 4's
     edit) — it must **FAIL**: `isCommandWordStart` rejects the `/`-preceded match, so
     `findWorktreeRemoveInvocations` returns `[]`, `evaluateWorktreeRemoval` returns `null`, and
     the command is allowed (`exitCode === 0`, `readHookEvents(mainRepo)` is `[]`) — the opposite
     of every assertion above. Quote the failing assertion output.
  2. After Task 4's fix lands, re-run — it must **PASS** with every assertion above holding.
     Quote the passing output.
  If step 1 does not fail as described, halt (see Execution Strategy below) — the bug does not
  reproduce as understood and the fix must not proceed on a false premise.
  — **AC**: test added; step 1's pre-fix failure and step 2's post-fix pass both captured and
  quoted in the completion evidence.

- [ ] **Task 2 — Write the retained-rejection tests (fix must not over-loosen)**: Same new
  `describe` block, two tests:

  1. `'allow: git --git-dir=/x/.git status is still allowed silently — the fragment class the
     predicate was introduced for (#774 AC2)'` — `withTempGitRepo('blackhole-hook-wt-', async
     (repo) => {...})`, run
     `runPreToolUseHook(SCRIPT, bashPayload('git --git-dir=/x/.git status'), repo)`, assert
     `result.exitCode === 0`, `result.stdout.trim() === ''`, `readHookEvents(repo)` is `[]`. This
     is the literal command the issue's AC2 quotes.
  2. `'allow: /usr/bin/git --git-dir=<mainRepo>/.git worktree remove <clean-pushed-worktree> is
     allowed, and the fragment does not create a second phantom invocation (#774)'` —
     `withRemoteTrackedWorktree('blackhole-hook-wt-', 'blackhole/issue-774b', async (mainRepo,
     worktree, push) => { push(); ... })`, run
     `runPreToolUseHook(SCRIPT, bashPayload(\`/usr/bin/git --git-dir=${path.join(mainRepo, '.git')}
     worktree remove ${worktree}\`), mainRepo)`, assert `result.exitCode === 0`,
     `result.stdout.trim() === ''`, `readHookEvents(mainRepo)` is `[]`. This exercises the exact
     shape the Objective's worked-trace table's last two rows describe — a path-qualified real
     leading invocation immediately followed by a `--git-dir=` option whose value itself ends in
     `.git` — and generalizes the existing `'BLOCK 1 negative control: --git-dir=<path>/gitdir
     ... still correctly denies'` test (`:1142-1160`, bare-`git` form, unpushed target, deny
     outcome) to the path-qualified + clean/pushed + allow combination, so both the deny-side and
     allow-side of the retained rejection are pinned across path qualification.

  Both tests pass **unmodified** on the current (pre-fix) code — they only start to matter as
  regressions once Task 4's widened predicate exists; running them now (Task 0's spirit) confirms
  they are true negative controls, not vacuous ones, before the fix changes any behavior they
  assert on.
  — **AC**: both tests added and passing both before and after Task 4's edit (no assertion in
  either test may change value across the fix — this is the "must not over-loosen" guarantee made
  machine-verifiable).

- [ ] **Task 3 — One parameterized characterization test over the 14 `bash-patterns.json` cases
  (not ~26 per-pattern tests — struck as `V-YAGNI-01`/`V-PARETO-01` per the issue comment)**: Same
  new `describe` block, one `test.each` covering exactly the 14 `(id, command, tier)` triples from
  `.blackhole/tmp/pattern-bypass-test.js` (`rm-rf-root`, `rm-rf-home`, `rm-no-preserve-root`,
  `mkfs`, `dd-to-device`, `curl-pipe-shell`, `wget-pipe-shell`, `chmod-777-root` — all `block` tier
  — plus `git-push-force`, `git-push-force-refspec`, `git-reset-hard`, `git-clean-force`,
  `npm-publish`, `docker-prune` — all `warn` tier per the live `bash-patterns.json`). For each
  case, run `runPreToolUseHook(SCRIPT, bashPayload(command), repo)` inside `withTempGitRepo` and
  assert on tier: `block` cases assert `result.exitCode === 2` and
  `permissionDecision(result.stdout) === 'deny'`; `warn` cases assert `result.exitCode === 0`
  (warn is a recorded allow, not a denial — `hook-event-log.js`'s `warnAndRecord` sets
  `decision: 'allow', tier: 'warn'`). Both tiers assert
  `readHookEvents(repo)[0].pattern_id === id` (proving the *specific* pattern fired, not merely
  *some* pattern) and `readHookEvents(repo)[0].tier === tier`. This pins the property that these
  14 rules already catch path-qualified forms (measured in the scope-correction comment) so a
  future well-meaning tightening of `bash-patterns.json`'s regexes cannot silently reintroduce a
  bypass there without a test failing.
  — **AC**: `test.each` with 14 cases added; all 14 pass against the current (unmodified)
  `bash-patterns.json`/`validate-bash-command.js` both before and after Task 4's edit (this test
  exercises a file this plan does not touch, so it must show identical pass/fail status on both
  sides — any change here is a signal something outside Touch-Paths moved, which is a stop
  condition, see below).

- [ ] **Task 4 — Implement the minimal fix**: In
  `templates/hooks/pretooluse/utils/worktree-removal-guard.js`, immediately after
  `isCommandWordStart`'s definition (`:103`) and before `GIT_WORD_RE` (`:105`), add the
  `isPathQualifiedGitWordStart` function exactly as specified in the Objective above (docstring
  included). In `findGitWordIndices` (`:109-119`), change the single condition on line `:114` from
  `isCommandWordStart(command, m.index)` to
  `(isCommandWordStart(command, m.index) || isPathQualifiedGitWordStart(command, m.index))`. Add
  `isPathQualifiedGitWordStart` to `module.exports` (`:404-411`) immediately after the existing
  `isCommandWordStart` entry. No other line in the file changes.
  — **AC**: Task 1's test 1 now passes (deny), Task 1's step-1 pre-fix failure and step-2 post-fix
  pass are both captured; Task 2's two tests still pass unmodified; Task 3's 14 cases still pass
  unmodified; every pre-existing test in the file (`bun test
  scripts/hooks-validate-bash.test.ts`, full file) still passes with 0 regressions.

- [ ] **Task 5 — Regenerate distribution copies**: Run `bun run build` so
  `.claude/hooks/utils/worktree-removal-guard.js`,
  `.agents/build/hooks/utils/worktree-removal-guard.js`,
  `plugins/blackhole/hooks/utils/worktree-removal-guard.js`, and
  `plugins/blackhole-claude/hooks/utils/worktree-removal-guard.js` match the edited source.
  — **AC**: `git diff --stat` shows all four generated copies changed identically to the source
  edit; no other generated file changes.

- [ ] **Task 6 — Verify Integrity**: Run `bun test scripts/hooks-validate-bash.test.ts` (scoped —
  per the resource-frugal testing policy, do not run the full repo suite from this plan) and
  `bun run verify`.
  — **AC**: `bun test scripts/hooks-validate-bash.test.ts` output quoted showing the full file's
  pass count with 0 failing (including every test from Tasks 1-3 and every pre-existing test);
  `bun run verify` output quoted showing 0 failures, confirming dist-parity and any lint/typecheck
  gates it runs.

## Sprint Contract
- Task 0 — AC: baseline suite passes; reproduction script reconfirms `caught=14 bypassed=0`.
- Task 1 — AC: discriminating test fails pre-fix (quoted), passes post-fix (quoted), same
  `pattern_id`/reason as the bare-word equivalent.
- Task 2 — AC: both retained-rejection tests pass unchanged before and after the fix.
- Task 3 — AC: 14-case characterization test passes unchanged before and after the fix (proves
  Touch-Paths discipline — this file is out of scope and must show no behavior change).
- Task 4 — AC: all of Tasks 1-3's tests pass; full existing suite has 0 regressions.
- Task 5 — AC: all 4 generated copies match the source edit exactly.
- Task 6 — AC: full test file 0 failing; `bun run verify` 0 failures.

Every task above carries a machine-verifiable AC; no task is judged by prose alone.

## Execution Strategy & Stop Conditions

- If Task 1's discriminating test **passes without modification** against the unmodified
  `plan_base_commit` code (the path-qualified bypass does not reproduce as described) — halt
  before Task 4, do not edit `worktree-removal-guard.js`, and report back the exact
  `findGitWordIndices`/`isCommandWordStart` behavior observed, quoted from the live file at that
  line range. This would mean the scope-correction's own root-cause analysis is stale relative to
  the current base commit and needs re-verification before any fix proceeds.
- If either Task 2 test or any of Task 3's 14 cases **changes outcome** after Task 4's edit
  (an assertion that held pre-fix now fails, or vice versa) — abort Task 4's edit and revert it;
  this is the over-loosening or out-of-scope-file-touched failure mode respectively, and the fix
  must be reworked, not shipped with a changed negative control.
- Touch-Paths are exactly `isPathQualifiedGitWordStart` (new), `findGitWordIndices`'s one
  condition line, and `module.exports` in `worktree-removal-guard.js`, plus the new test
  `describe` block — no edit to `checkUnpushedCommits`, `checkDetachedReachability`,
  `evaluateOneInvocation`, `skipGitGlobalOptions`, `parseWorktreeRemoveArgs`, `clauseTailFrom`,
  `validate-bash-command.js`, or `bash-patterns.json` under any circumstance. If the implementer
  finds a reason to touch any of them, stop and escalate rather than widening scope
  (`V-SCOPE-02`).
- **Sequencing conflict flag for #777** (not yet dispatched, per spawn brief): #777 is described
  as "the third issue in this same guard-file sequence." This plan appends its new `describe`
  block at the very end of the file (after the `#532` global-option block, before the `#580`
  uncaught-crash block) specifically so a later append from #777 has a stable, unambiguous
  insertion point (after this plan's new block) rather than needing to interleave. If #777 turns
  out to also touch `findGitWordIndices`, `isCommandWordStart`, or the new
  `isPathQualifiedGitWordStart`, its implementer must rebase onto this PR's merge commit first —
  do not let #777 land on a stale base that reverts this fix's `findGitWordIndices` condition
  line, the same sequencing discipline issue #761's plan already applied to this plan's own
  predecessor in this file.
- If `bun run build` reports no change to any of the four generated copies after the Task 4 edit,
  stop and verify `scripts/lib/build/targets.ts` still includes all four distribution trees before
  concluding the build is idempotent-safe — a silent build-step no-op on a real source change
  would mean the shipped hook still runs the old, vulnerable predicate.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — no schema/API/database change |
| `ac_mapping` | PASS — every `## Task Breakdown` item carries a measurable `— **AC**:` |
| `critical_files_exist` | PASS — no `## Critical Files` section emitted (no pre-existing
sensitive touchpoint beyond the Touch-Paths file itself, which is already the subject of this
change), so the CLI's Glob check is vacuously true |
| `mitigation_concrete` | PASS — every `## Execution Strategy & Stop Conditions` bullet pairs a
concrete trigger with a concrete abort/halt/escalate action; no bare "monitor"/"be careful"/"watch"
language |

CLI invocation and full output, run against the file at its current path:

```
$ bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-774.md
{
  "ac_mapping": true,
  "critical_files_exist": true,
  "mitigation_concrete": true
}
```

All three checks pass — `failing_checks: []`, `status: ready`.
