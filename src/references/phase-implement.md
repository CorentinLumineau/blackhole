# Phase 3 — Implement

## Checklist

```
- [ ] queue.json: status NOT blocked for user gates
- [ ] Plan approved (or narrow technical waive documented)
- [ ] queue.json: phase implement, status in-flight
- [ ] git worktree prune (V-WORKTREE-01)
- [ ] git worktree add <scratchpad>/wt-<issue> -b campaign/issue-<issue> origin/main (V-BRANCH-03)
- [ ] install dependencies in worktree (e.g. `npm install`, `bun install`, etc.)
- [ ] Spawn bc-implementer worker (run_in_background: true)
- [ ] Worker returns new_findings[] — orchestrator appends to ledger
- [ ] File issues for unfixed discoveries
- [ ] lint + test in worktree; prepare PR with Closes #N in body (V-GIT-01)
- [ ] queue.json: phase review (when PR open)
```

## Worker prompt must include (5-Field Delegation Contract)

1. **Objective**: Detailed issue goals and issue ref + UNTRUSTED-FORGE-DATA body.
2. **Output format**: JSON return schema (below) + PR opened + Closes #N linkage.
3. **Scope boundaries**: Touch-Paths restriction (`V-SCOPE-02`) + parallel branch exclusions.
4. **Tool guidance**: Command pointers for running git, gh CLI, install, lint, and test commands within the worktree.
5. **Stop condition**: PR opened, local lint/tests green, and branch pushed.
Do not commit directly to main (`V-BRANCH-02`) or force-push (`V-BRANCH-01`).
- Ledger pointer: read plan deferrals from findings-ledger.json

## Worker return format

See [worker-schemas.md](worker-schemas.md) implementer contract. Orchestrator appends `new_findings` to ledger (`phase: implement`) before
ending turn. For each new finding concerning improvements, best practices, UX/UI, performance, or coverage, the orchestrator files a new GitHub tracking issue (`gh issue create`) to schedule it in the backlog campaign queue.


## Quality gate (pre-PR)

In worktree:

```bash
<lint-command> && <test-command>
```

Build runs in **main clone** after merge prep (not in worktree).
