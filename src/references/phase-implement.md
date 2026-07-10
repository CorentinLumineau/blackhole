# Phase 3 — Implement

## Checklist

```
- [ ] queue.json: status NOT blocked for user gates
- [ ] Plan approved (or narrow technical waive documented)
- [ ] queue.json: phase implement, status in-flight
- [ ] git worktree prune (V-WORKTREE-01)
- [ ] git worktree add <scratchpad>/wt-<issue> -b blackhole/issue-<issue> origin/main (V-BRANCH-03)
- [ ] install dependencies in worktree (e.g. `npm install`, `bun install`, etc.)
- [ ] Spawn implementer worker (run_in_background: true)
- [ ] Worker returns new_findings[] — orchestrator appends to ledger
- [ ] implementer status: blocked with escalation_trigger set → orchestrator.md § Escalation dispatch (do not re-spawn implementer directly; spawn investigator instead)
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

## Worker prompt must include (5-Field Delegation Contract)

1. **Objective**: Detailed issue goals and issue ref + UNTRUSTED-FORGE-DATA body.
2. **Output format**: JSON return schema (below) + PR opened + Closes #N linkage.
3. **Scope boundaries**: Touch-Paths restriction (`V-SCOPE-02`) + parallel branch exclusions.
4. **Tool guidance**: Command pointers for running git, gh CLI, install, lint, and test commands within the worktree. Carry the `execution_mode` TDD-mandate branch matching the plan's `route.task_type` derivation (see below), and — when the plan frontmatter carries `task_type: bugfix` (Quick track) — the Bugfix Gate's Decision Record and Scout Check expectations (`implementer.md` § Bugfix Gate).
5. **Stop condition**: PR opened, local lint/tests green, and branch pushed — and, when the diff touches the public-API/schema/config surface within Touch-Paths, companion docs updated in the same PR (`V-DOC-02/04`, `implementer.md` step 6's Companion-doc sync bullet). Phase 0's companion-file scaffold (`SKILL.md` step 2) already creates the *root* `ARCHITECTURE.md`/`AGENTS.md`/`DESIGN.md` when absent, so this bullet only covers diff-triggered *updates* to already-existing companion docs, not initial creation.
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
| `bugfix` (Quick track only) | Bugfix Gate: unconditional Root-Cause Verification gate (Decision Record before the first edit), 2 escalation triggers (`failed_attempts`, `touch_paths_overrun`), Scout Check (in-scope improvement recorded as an Improvement Record, not deferred) |

**Non-goal for this issue**: no orchestrator dispatch logic computes or passes `route.task_type`
to implementer at spawn time yet — same non-wiring status as `execution_mode` above
(`implementer.md` § Bugfix Gate has the full gate spec).

## Worker return format

See [worker-schemas.md](worker-schemas.md) implementer contract. Orchestrator appends `new_findings` to ledger (`phase: implement`) before
ending turn. For each new finding concerning improvements, best practices, UX/UI, performance, or coverage, the orchestrator files a new GitHub tracking issue (`gh issue create`) to schedule it in the backlog campaign queue.
See [multitask-mode.md](multitask-mode.md) § Claude Code harness notes for how to verify a spawned worker's completion without chat polling.


## Quality gate (pre-PR)

In worktree:

```bash
<lint-command> && <test-command>
```

Build runs in **main clone** after merge prep (not in worktree).

## Recovery (mixed worktrees)

When a worktree is dirty after crash, compaction, or mixed-issue edits, the orchestrator **must** complete the recovery checklist in [recovery-protocol.md](recovery-protocol.md) §5 before any `implementer` (re)spawn — do not resume implementation until the worktree matches a single issue scope.
