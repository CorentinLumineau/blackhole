# State Branch

Campaign state (`queue.json`, `findings-ledger.json`, the checkpoint, plans, staging) lives in
`.blackhole/` on the main clone's disk. Claude Code cloud sessions, Project threads, Cursor Cloud
agents and CI runners reclaim that disk when the session ends, so a campaign there would restart
from nothing. Run context routes those runs to `state_store: branch`
(`run-context.md`); this file says what that means. Decision:
`documentation/decisions/ADR-049-branch-state-store.md`.

## Push at every turn end

After the checkpoint write order (`checkpoint-protocol.md` § Write order, step 4), from the main
clone:

```bash
bun run scripts/state-branch.ts push --message "chore(state): turn <orchestrator_turn_id>"
```

It commits the state files to the `blackhole/state` branch on `origin`, on top of the branch's
current tip, and pushes it. It never touches the working tree, the index or the checked-out
branch, and it adds no commit when nothing changed. A rejected push means another writer moved
the branch: stop and report it, since a campaign has exactly one orchestrator.

## Pull before reading state

On bootstrap (right after run-context resolution) and on every resume, before reading
`.blackhole/`:

```bash
bun run scripts/state-branch.ts pull
```

| Exit | Meaning |
|------|---------|
| `0` | Restored, already matching, or no `blackhole/state` branch yet (a first run) |
| `1` | A local file differs from the branch; nothing was written. The disk may be newer than the last push: keep it unless the user says otherwise, then `--force` takes the branch copy |
| `2` | Malformed call |

## What travels

Everything under `.blackhole/` except `archive/`, `hook-events/`, `.tmp/`, `*.tmp` files and the
signals that describe one machine (`run-context.json`, `plugin-drift.json`, `doc-health.json`),
which the next machine derives again. Restores are byte-for-byte.

## Local-only steps

On `state_store: branch`, two steps are skipped, each said once in the turn:

- The plugin-cache drift signal (`orchestrator-runtime.md` § Session resume & recovery, step 5).
- The installed plugin cache refresh (`blackhole-protocol.md` § Branch & Worktree Hygiene).

There is no long-lived plugin cache on such a machine. Transcript recovery
(`recovery-protocol.md`) still runs: it reads transcripts of the current session, which exist on
any machine while that session lasts.
