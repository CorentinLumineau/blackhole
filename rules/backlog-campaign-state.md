---
description: Queue and findings-ledger write protocol for backlog campaign state
globs:
  - .backlog-campaign/**
alwaysApply: false
---

# Backlog Campaign State

Mutations to `.backlog-campaign/queue.json` and
`findings-ledger.json` MUST follow these rules.

## Paths

| File | Purpose |
|------|---------|
| `config.json` | Committed campaign config (template) |
| `queue.json` | Issue phase, status, DAG (gitignored) |
| `findings-ledger.json` | V-code findings (gitignored) |
| `plans/<issue>.md` | Plan artifacts (gitignored) |
| `archive/` | Rotated ledger snapshots (gitignored) |

Full schemas: `{{AGENT_DIR}}/skills/backlog-campaign/references/findings-ledger.md`,
`queue-dag.md`.

## Write protocol

1. Validate before read-dependent logic: `jq empty <file>`
2. Read-modify-write via `.tmp` + `mv` (atomic)
3. Bump `refreshed_at` on every mutation
4. Idempotency: dedup ledger by `(vcode, file, line, issue_ref)` before append

## Ledger obligations

- Append before orchestrator ends turn
- `deferred` without `deferred_to_issue` is invalid
- Increment `next_id` when adding `F-NNNNN` ids

## Queue obligations

- `in-flight` set when worker spawned; clear on merge or blocker
- At most one `migration_slot: true` in `in-flight`
- Promote `blocked → ready` only when dependencies satisfied and user gates pass

## Sync

**Native auto-sync** — reconcile with forge automatically (see
`forge-sync.md`). Never ask the user to run sync. Runs at: Phase 0 bootstrap,
start of every orchestrator turn, Phase 5 loop, before parallel batch scheduling.
Fix drift before spawning workers.
