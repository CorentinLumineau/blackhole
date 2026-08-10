# Phase 3 — Implement

## Checklist

```
- [ ] queue.json: status NOT blocked for user gates
- [ ] Plan approved (or narrow technical waive documented)
- [ ] queue.json: phase implement, status in-flight
- [ ] git worktree prune (V-WORKTREE-01)
- [ ] git worktree add <scratchpad>/wt-<issue> -b blackhole/issue-<issue> origin/main (V-BRANCH-03)
- [ ] git -C <scratchpad>/wt-<issue> config push.default nothing (issue #516 — no bare `git push` can silently succeed)
- [ ] Branch Tracking Sweep before this wave's dispatch (`orchestrator-dispatch.md` § Branch Tracking Sweep (issue #516))
- [ ] install dependencies in worktree (e.g. `npm install`, `bun install`, etc.)
- [ ] Spawn implementer worker (run_in_background: true)
- [ ] Worker returns new_findings[] — orchestrator appends to ledger
- [ ] implementer status: blocked with escalation_trigger set → orchestrator-dispatch.md § Escalation dispatch (do not re-spawn implementer directly; spawn investigator instead)
- [ ] File issues for unfixed discoveries
- [ ] lint + test in worktree; prepare PR with Closes #N in body (V-GIT-01)
- [ ] queue.json: phase review (when PR open)
- [ ] Recovery protocol clear if resuming dirty wt-<issue> (recovery-protocol.md)
```

## Plan artifact paths (worktree rule)

Plan artifacts live at `{repo_root}/.blackhole/plans/issue-N.md` — always
relative to the **main clone repo root**, not the worktree checkout.

- Implementers run in isolated worktrees (`wt-<issue>`); the plan file is
  **not** in the worktree working directory.
- Orchestrator MUST pass the plan file as an **absolute repo-root path** in
  `<PLAN_CONTEXT>` (e.g. `/path/to/repo/.blackhole/plans/issue-11.md`).
- Implementers MUST read the plan via that absolute path — never assume a
  relative `.blackhole/plans/` path resolves from the worktree cwd.

## Git operations must not depend on inherited cwd (issue #516)

The 2026-08-10 turn-4 wave incident: the orchestrator's own session cwd silently drifted into a
sibling worktree, and a worker recovered by running `git push -u` from that foreign worktree —
setting upstream on the *wrong* branch. `push.default=simple` refusing a same-name-mismatched
push is the only thing that stood between that and a direct push to `origin/main`. The campaign
must not rely on a git default it never chose.

- Every git command the orchestrator runs in this phase — worktree creation, pruning, branch
  inspection — MUST target the worktree with an absolute `-C <path>` argument (the same
  convention `recovery-protocol.md` already uses for its own dirty-worktree checks), never an
  inherited `cwd`.
- Immediately after `git worktree add`, run `git -C <scratchpad>/wt-<issue> config push.default
  nothing`. This writes to the repo-shared `.git/config` (every linked worktree shares one `.git`
  directory unless `--separate-git-dir` was used), so it only needs to take effect once per repo
  — re-running it at every worktree creation is idempotent and keeps the mandate colocated with
  the step that needs it. With `push.default=nothing` a bare `git push` errors immediately
  (`fatal: You didn't specify any refspecs to push, and push.default is 'nothing'`) instead of
  silently falling through to `simple`/`current` behavior — the protection no longer rests
  solely on `push.default=simple`.
- Pass the worktree's absolute path to the implementer worker in its 5-Field Delegation Contract
  Tool Guidance field (below) — the worker must never guess that its own cwd is correct.
- Before dispatching any wave, run the pre-dispatch sweep: `orchestrator-dispatch.md` § Branch
  Tracking Sweep (issue #516).

## Worker prompt must include (5-Field Delegation Contract)

1. **Objective**: Detailed issue goals and issue ref + UNTRUSTED-FORGE-DATA body.
2. **Output format**: JSON return schema (below) + PR opened + Closes #N linkage.
3. **Scope boundaries**: Touch-Paths restriction (`V-SCOPE-02`) + parallel branch exclusions.
4. **Tool guidance**: Command pointers for running git, gh CLI, install, lint, and test commands within the worktree. Every git command MUST use `git -C <absolute worktree path>` — never rely on inherited cwd (issue #516); push MUST use an explicit refspec, `git -C <path> push origin <branch>:<branch>` — never `-u`, never bare (`implementer.md` § Explicit Git Targeting Gate). Carry the `execution_mode` TDD-mandate branch matching the plan's `route.task_type` derivation (see below); when the plan frontmatter carries `task_type: bugfix` (Quick track), also carry the Bugfix Gate's Root-Cause Decision Record and escalation-trigger expectations (`implementer.md` § Bugfix Gate). Scout Check applies unconditionally to every execution mode and plan track, not gated by `task_type: bugfix` — see `implementer.md` § Scout Check. When `display_targets` is configured (non-empty) and the issue is UI-affecting (`route.ui`, or the frontend-detection keyword fallback), also carry the Visual Evidence Capture step (`implementer.md` § Visual Evidence Capture) — inert otherwise. Carry the Carry Staged Artifacts step unconditionally (`implementer.md` § Carry Staged Artifacts, ADR-021 D2) — gated inert only by `docs_governance.enabled`/`docs_governance.write_governance`, not by track or `task_type`.
5. **Stop condition**: PR opened, local lint/tests green, and branch pushed — staged artifacts for the issue are copied into their `documentation/` targets and committed in the PR (`implementer.md` § Carry Staged Artifacts, ADR-021 D2) — and, when the diff touches the public-API/schema/config surface within Touch-Paths, companion docs updated in the same PR (`V-DOCSYNC-01`, `implementer.md` step 6's Companion-doc sync bullet). Phase 0's companion-file scaffold (`SKILL.md` step 2) already creates the *root* `ARCHITECTURE.md`/`AGENTS.md`/`DESIGN.md` when absent, so this bullet only covers diff-triggered *updates* to already-existing companion docs, not initial creation. When the Visual Evidence Capture step triggered, a `visual_evidence[]` entry (captured or explicitly `unavailable`) is present in the worker JSON — a triggered, undeclared skip fails the reviewer's `V-VIS-01` audit (`reviewer.md` §22).
Do not commit directly to main (`V-BRANCH-02`) or force-push (`V-BRANCH-01`).
- Ledger pointer: read plan deferrals from findings-ledger.json

### `execution_mode` branches (optional — ADR-004)

Matches `worker-schemas.md`'s implementer contract. Absent == `standard` (today's
behavior, unchanged):

| Mode | TDD mandate |
|------|-------------|
| `standard` (default) | Unchanged failing-tests-first mandate |
| `refactor-strict` | Pre-existing test suite must pass unmodified — no new/deleted test files; Refactoring Verification gate + per-step commit/rollback |
| `docs-only` | Failing-test-first suppressed; Touch-Paths restricted to documentation paths |

**Non-goal for this issue**: no orchestrator dispatch logic reads `route.task_type` or
selects `execution_mode` yet — that lands with #93.

### `task_type` / Bugfix Gate (optional — ADR-004)

Parallel to `execution_mode` above, matching `worker-schemas.md`'s implementer contract:

| `task_type` | Gate |
|------|------|
| `bugfix` (Quick track only) | Bugfix Gate: unconditional Root-Cause Verification gate (Decision Record before the first edit), 2 escalation triggers (`failed_attempts`, `touch_paths_overrun`). Scout Check (in-scope improvement recorded as an Improvement Record) is unconditional for every `task_type`/`execution_mode` — see `implementer.md` § Scout Check, not specific to this row |

**Non-goal for this issue**: no orchestrator dispatch logic computes or passes `route.task_type`
to implementer at spawn time yet — same non-wiring status as `execution_mode` above
(`implementer.md` § Bugfix Gate has the full gate spec).

## Worker return format

See [worker-schemas.md](worker-schemas.md) implementer contract. Orchestrator appends `new_findings` to ledger (`phase: implement`) before
ending turn. For each new finding concerning improvements, best practices, UX/UI, performance, or coverage, the orchestrator files a new GitHub tracking issue (`gh issue create`) to schedule it in the backlog campaign queue.
See [multitask-mode.md](multitask-mode.md) § Claude Code harness notes for how to verify a spawned worker's completion without chat polling.

**Unverified-claim hold (issue #204)**: the orchestrator treats a worker completion report
(PR description, JSON `summary`, or any inline text) containing a red-flag phrase from
`implementer.md`'s Verification Evidence Gate list, or a `status: complete` submission with
`evidence` absent/empty, as an **unverified claim** — hold the issue at `phase: implement`,
do not advance to `phase: review`, and do not append the worker's `new_findings` until the
implementer re-submits with fresh, quoted evidence. Documentation-level obligation only — no
code enforcement lands in this issue (`scripts/validate-worker-json.ts` and the orchestrator
dispatch logic are out of Touch-Paths).

**Sprint Contract hold (issue #309)**: the same hold applies when a `status: complete`
submission for a Standard-track plan carries `sprint_contract_status` and its value is not
`PASS` (`PARTIAL` or a Standard-track plan reporting `N/A` where the plan's Sprint Contract
declared `— **AC**:` markers, i.e. the loop was skipped rather than genuinely inapplicable) —
hold at `phase: implement`, do not advance to `phase: review`, until the implementer re-submits
with every `ac_results[]` row resolved to `PASS` or an honest `status: blocked`. Absent
`sprint_contract_status` (Quick/Skip/Design/Brainstorm tracks, or a Standard-track plan with no
`— **AC**:` markers) is not itself a hold condition — this extends the existing missing-`evidence`
hold above, it does not replace it.


## Quality gate (pre-PR)

In worktree:

```bash
<lint-command> && <test-command>
```

Build runs in **main clone** after merge prep (not in worktree).

## Recovery (mixed worktrees)

When a worktree is dirty after crash, compaction, or mixed-issue edits, the orchestrator **must** complete the recovery checklist in [recovery-protocol.md](recovery-protocol.md) §5 before any `implementer` (re)spawn — do not resume implementation until the worktree matches a single issue scope.
