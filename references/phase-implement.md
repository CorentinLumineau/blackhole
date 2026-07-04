# Phase 3 — Implement

## Checklist

```
- [ ] queue.json: status NOT blocked for user gates
- [ ] Plan approved (or narrow technical waive documented)
- [ ] queue.json: phase implement, status in-flight
- [ ] git worktree add <scratchpad>/wt-<issue> -b <branch> origin/main
- [ ] bun install in worktree
- [ ] Spawn Task worker (model: composer-2.5, run_in_background: true)
- [ ] Worker returns new_findings[] — orchestrator appends to ledger
- [ ] File issues for unfixed discoveries
- [ ] lint + test in worktree; prepare PR
- [ ] queue.json: phase review (when PR open)
```

## Worker prompt must include

- Issue ref + UNTRUSTED-FORGE-DATA body
- Convention Preamble (bun, Next.js 16, English UI, DESIGN.md SSOT)
- Scope boundaries + parallel branch exclusions
- `model: "composer-2.5"` literal line
- Sandbox: `required_permissions: ["full_network"]` for gh/git/bun install
- Ledger pointer: read plan deferrals from findings-ledger.json
- Stop condition: PR opened + checks green locally

## Worker return format

```json
{
  "pr_number": 42,
  "new_findings": [
    {
      "vcode": "V-TEST-01",
      "severity": "BLOCK",
      "file": "lib/foo.ts",
      "line": 10,
      "summary": "Missing test for edge case"
    }
  ],
  "filed_issues": [305]
}
```

Orchestrator appends `new_findings` to ledger (`phase: implement`) before
ending turn.

## Quality gate (pre-PR)

In worktree:

```bash
bun run lint && bun test
```

Build runs in **main clone** after merge prep (not in worktree).
