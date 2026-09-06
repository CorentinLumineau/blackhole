---
type: plan
summary: "Design-track plan for issue #907 -- the worker write-containment assignment channel is unreachable under Pattern C; options, blind-critic evaluation, and a blocked verdict pending an owner ruling"
status: current
review_trigger: "on ADR-043 acceptance"
created: 2026-09-06
last_updated: 2026-09-06
related: [decisions/ADR-029-bash-write-target-worktree-containment.md, decisions/ADR-030-plugin-cache-version-bump-gate.md]
---

# Plan: issue #907 — worker write-containment has no reachable assignment channel

> **CONTINGENT.** `scripts/design-aggregate.ts` returned `status: "blocked"`
> (`.blackhole/plans/issue-907-design-aggregate-verdict.json`). Every task below whose text names
> a mechanism is conditional on the owner's ruling. Only Task 1 is unconditional — it is issue
> acceptance criterion 1 and is common to every option. Do not begin Tasks 3-7 before the ruling.

## Objective

Make the worker write-containment story true. Either wire a channel that can actually carry the
per-worker assignment, or state plainly that none is wired — but stop shipping
`orchestrator-dispatch.md:212-216` as a binding contract that has never once fired.

Full analysis, options, blind-critic evaluation and gate:
`.blackhole/plans/issue-907-design.md`.

## Pareto gating

`Gain 8 × (11 − Effort 5) = 48` ≥ 30 (`V-PARETO-03`). Gain is high because the gap is a live
containment hole that has produced two recorded incidents (`F-00034`, `F-00098`); effort is
mid-range because the design work is done and the change is one resolver plus its two call sites,
tests, and a version bump.

## Touch-Paths

Conditional on the ruling. Under **any** mechanical option (A or E):

- `templates/hooks/pretooluse/utils/hook-event-log.js`
- `templates/hooks/pretooluse/validate-file-changes.js`
- `templates/hooks/pretooluse/utils/bash-write-target-guard.js`
- `templates/hooks/pretooluse/validate-bash-command.js`
- `scripts/hooks-validate-file.test.ts`
- `scripts/hooks-validate-bash.test.ts`
- `scripts/lib/test-fixtures.ts`
- `package.json` (`version` — `V-PLUGIN-01`, same diff)
- `src/references/hook-schemas.md`, `src/references/orchestrator-dispatch.md` — plus all generated
  dist trees per `scripts/lib/build/targets.ts`
- `documentation/decisions/ADR-043-<slug>.md`, `documentation/decisions/INDEX.md`

Under **D** (accept the limitation), only the last three bullets apply, and `package.json` does
not (no `templates/hooks/**` change, so `V-PLUGIN-01` does not fire).

## Documentation Impact

- `src/references/orchestrator-dispatch.md` § Implementer assigned-write-root env — the export
  contract is corrected or removed under every option. Its scope note (*"every implementer spawn
  only"*) must also be revisited: `F-00034` was a reviewer.
- `src/references/hook-schemas.md:141,145` — the `outside-assigned-worktree` and
  `bash-outside-assigned-worktree` contracts name the env var as the sole channel.
- `documentation/decisions/ADR-043-<slug>.md` — **new file.** Search-before-write performed: no
  existing ADR covers the assignment-channel question. ADR-029 covers Bash write-target
  containment semantics and ADR-030 the plugin cache gate; neither decides the channel. Number
  verified free against `origin/main` and every `.blackhole/staged/*/manifest.json`
  (`V-ADR-05`).
- `documentation/decisions/INDEX.md` — append row (hand-appended; the root
  `documentation/INDEX.md` is generated).

## Critical Files

- `templates/hooks/pretooluse/utils/hook-event-log.js`
- `templates/hooks/pretooluse/validate-file-changes.js`
- `templates/hooks/pretooluse/utils/bash-write-target-guard.js`
- `package.json`

## Codebase Conventions

No `plans/issue-907-analysis.md` exists, so these were discovered directly.

| Concern | Established pattern | Where |
|---|---|---|
| Containment comparison | `isUnderRoot` / `resolveExistingAncestor`, never a fresh path comparison (`V-INT-02`) | `hook-event-log.js` |
| Degradation posture | Fail **open** on an unrecognized declaration (stderr notice, fall back to all roots); fail **closed** on an unreadable containment state | `readAssignedWorktreeRoot`, `allWorktreeRoots`, `failClosed` |
| Config-gated trust | Read `<mainClone>/.blackhole/config.json`, validate breadth, return null on any degradation | `readScratchpadDir` |
| Env override shape | Read once, validate, stderr on rejection, null on absence | `BLACKHOLE_HOOK_EVENT_DIR`, `BLACKHOLE_SCRATCHPAD_DIR` |
| Hook test harness | `runPreToolUseHook` spawns the real hook with a JSON payload on stdin | `scripts/lib/test-fixtures.ts` |
| Event record schema | `version: 1`, fixed field set, one file per event | `hook-schemas.md` § `.blackhole/hook-events/` |

## Threat Model

`route.security_review_required: true`. Six STRIDE rows, four-tier severity.

| Category | Threat | Severity | Mitigation status |
|---|---|---|---|
| Spoofing | A worker forges its own assignment to widen its write scope | High | **Mitigated by design** under A/E — `agent_id`/`agent_type` are set by the harness on the hook's stdin and cannot be set by the worker, unlike an env var the worker could `export`. |
| Tampering | A worker rewrites the assignment source to widen its own scope | High | **Open** under A — `.blackhole/worker-assignments.json` sits in the main clone and the Bash guard's documented unresolvable-command allow (`python3 -c`, `perl -i`, `awk`, `dd`, `rsync`; `git` and `node -e` absent entirely) permits the rewrite with only a warn record. **Not applicable** under E (no map) or D (no mechanism). |
| Repudiation | A refusal happens but leaves no ingestible record | Medium | **Mitigated** — `denyAndRecord` writes `.blackhole/hook-events/` before refusing, and Triage ingests it as `V-HOOK-01`. Residual, pre-existing: a silent widening on a failed membership check logs to **stderr only**, which Triage does not read (design note §3.1). |
| Information Disclosure | The assignment source leaks worktree paths | Low | **Accepted risk** — paths are already in `queue.json` and in event records; no new exposure. |
| Denial of Service | A wrong or stale assignment denies a worker's legitimate writes and stalls it unattended | High | **Mitigated** under A/E by fail-open on absent field / absent entry / unregistered path. **Explicitly NOT mitigated under C**, which is why C fails: an empty root set is truthy and would default-deny every subagent write in every single-clone install. |
| Elevation of Privilege | A subagent obtains write access to a root it was never assigned | High | **Open** — the current state, and what this issue exists to close. Under A/E it narrows to the Write/Edit path only; the Bash `git` path (`F-00034`'s actual vector) stays open until #897 lands. |

## Dependency Blast-Radius

11 affected consumers — full table with `file:line` and BREAKING/DEPRECATION/TRANSPARENT
classification at `.blackhole/plans/issue-907-design.md` § 6. Headline: `readAssignedWorktreeRoot`
has two call sites; its documented contract has two reference-file sites; issue **#897's
acceptance criterion 1 is a BREAKING external consumer** and must be restated by whichever option
lands.

## Execution Strategy & Stop Conditions

- **If the observability probe shows `agent_id` absent for a `taskKind: in_process_teammate`
  spawn, halt** and re-open the ruling with options A and E withdrawn — the payload-identity
  family is inert and only D remains.
- **If the red-before-green test does not fail against `plan_base_commit`** (i.e. the main-clone
  write is already denied without the fix), **abort** — the premise is wrong and the issue needs
  re-diagnosis, not an implementation.
- **If any change lands under `templates/hooks/**` without `package.json`'s `version` changing in
  the same diff, stop and add it** — `V-PLUGIN-01` is a BLOCK.
- **If a new deny path is added without a passing test proving a legitimate in-worktree write is
  still allowed, revert it** — C's empty-root-set defeat is exactly this failure, and it would
  reach production before anyone could reinstall a fix.
- **If the owner's ruling is D, stop after Task 2** — Tasks 3-7 must not run.

## Task Breakdown

1. **Correct `orchestrator-dispatch.md`'s export contract** (unconditional; issue AC1). Rewrite
   § Implementer assigned-write-root env so it no longer reads as a binding, reachable contract;
   state that `export` does not survive between `Bash` tool calls and that the native `Agent` tool
   has no environment channel; correct the misapplied #604 citation, noting that #604's and
   #729's overrides need only a session-wide value and remain reachable. — **AC**: `git grep -n
   "first shell command in the session" src/references/orchestrator-dispatch.md` returns zero
   matches, and the section states the unreachability explicitly. Scope: `src/references/` only;
   no exemptions.
2. **Record the decision as `ADR-043`** (unconditional once the ruling lands). Whichever option is
   chosen, including D. If D: the ADR must state there is **no** compensating control, per the
   critic finding that the prose prohibition has already failed twice. — **AC**: the file exists,
   its heading shape matches `ADR_SHAPES.designTrack`, its `documentation/decisions/INDEX.md` row
   agrees with its frontmatter `status`, and `bun run scripts/checks/adr-status.check.ts` passes.
3. **Observability probe** (conditional — A or E). Add `agent_id` and `agent_type` to the
   `.blackhole/hook-events/` record payload, bump the record `version`, and update
   `hook-schemas.md`'s field table. No decision change. — **AC**: after one campaign turn, at
   least one event file written by a named teammate carries a non-null `agent_id`.
4. **Red-before-green test** (conditional; `V-UNFALSIFIABLE-01`, issue AC3). Add a test driving
   `runPreToolUseHook` with a payload whose `cwd` is the **main clone** and whose `agent_id` names
   an assigned worker, asserting a Write to the main clone is denied. Show it failing (write
   allowed) against `plan_base_commit` first. — **AC**: the test fails on `f38ca6b9` with the
   write allowed, and the failure output is quoted in the PR body.
5. **Implement the chosen mechanism** (conditional). Thread the payload into
   `readAssignedWorktreeRoot` and both call sites; add the chosen resolution leg; keep the env leg
   at higher precedence so `test-fixtures.ts` and manual use are unaffected; fail open on absent
   field, absent source, or unregistered path. — **AC**: task 4's test passes; `bun test` and
   `bun run verify` are green; no file outside Touch-Paths modified.
6. **Regression guard for legitimate writes** (conditional). Tests asserting: a subagent write
   under `.blackhole/` in the main clone is allowed; a main-thread payload (no `agent_id`) is
   unaffected; a single-clone repo with no linked worktrees is unaffected. — **AC**: all three
   pass, and each fails if its guard clause is removed.
7. **Version bump + deployment note** (conditional, `V-PLUGIN-01`). Bump `package.json` `version`
   in the same diff; state in the PR body that the fix is inert until the owner runs `/plugin
   marketplace update` and reinstalls, citing the measured `0.20.0` installed vs `0.21.8` repo
   drift. — **AC**: `git diff --name-only` includes `package.json` whenever it includes any
   `templates/hooks/**` path.

## Sprint Contract

Each task above carries its own `— **AC**`. Where a task states no narrower criterion, the
definition of done is `bun test` and `bun run verify` green with no new findings.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS — declared, with the option-conditional split stated explicitly. |
| `schema_baseline` | PASS — the only schema change is the `.blackhole/hook-events/` record `version` bump specified in task 3. Correction (post-merge): the initial #907 PR implemented task 3's `agent_id`/`agent_type` fields but shipped without the `version` bump this row cites; the #918 follow-up PR landed the bump (`version: 2`) and corrected the `hook-schemas.md` overclaim, closing task 3 fully. |
| `ac_mapping` | PASS — all 7 `## Task Breakdown` items carry a machine-verifiable `— **AC**`. |
| `critical_files_exist` | PASS — all four listed paths resolve on `origin/main`. |
| `mitigation_concrete` | PASS — all five `## Execution Strategy & Stop Conditions` bullets pair a condition to an abort/halt/revert/stop action. |
| `design_pending_approval` | **FAIL** — `design-aggregate.ts` returned `blocked`; owner ruling required. |

ADVISORY: `ac_sweep_scope` — task 1's grep-to-zero AC states its scope path (`src/references/`)
and an explicit "no exemptions" clause; no finding.
ADVISORY: `touch_paths_ssot_gap` — `src/references/*.md` Touch-Paths cite
`scripts/lib/build/targets.ts` for the generated dist trees rather than hand-enumerating them; no
gap.

## References

- Design note: `.blackhole/plans/issue-907-design.md`
- Verdict: `.blackhole/plans/issue-907-design-aggregate-verdict.json`
- **ADR**: `documentation/decisions/ADR-029-bash-write-target-worktree-containment.md` — chosen
  approach: containment against a single assigned root; the channel supplying that root is what
  #907 decides.
- `documentation/decisions/ADR-030-plugin-cache-version-bump-gate.md`
- `documentation/decisions/ADR-035-unfalsifiable-control-checklist-item.md`
- Sequenced with issue **#897** (Bash `git` vocabulary) — #907 first; see design note § 6.1.
