# Blackhole State

## Protocol SSOT

Campaign protocol state lives **only** under `.blackhole/*`:

- `config.json` — campaign configuration
- `queue.json` — issue phase, status, DAG
- `findings-ledger.json` — V-code findings
- `plans/<issue>.md` — plan artifacts
- `staged/<issue>/` — durable artifact staging area (see § Staging (ADR-021 D1) below)
- `archive/` — rotated ledger snapshots and pre-mutation `queue.json` snapshots

The following are **not** blackhole protocol state:

- `.agents/orchestrator/`, `.agents/worker_*/`, `.agents/explorer_*/` — ephemeral session handoff dirs
- All build-output trees (`.cursor/`, `.claude/`, `skills/`, `codex-*`, `.agents/build/`, etc.)

Full harness-wide rule: `blackhole-protocol.md` § Campaign state vs. agent handoff dirs.

Mutations to `.blackhole/queue.json` and
`findings-ledger.json` MUST follow these rules.

## Paths

| File | Purpose |
|------|---------|
| `config.json` | Campaign config (see `config-template.md`) |
| `queue.json` | Issue phase, status, DAG (gitignored) |
| `findings-ledger.json` | V-code findings (gitignored) |
| `plans/<issue>.md` | Plan artifacts (gitignored) |
| `staged/<issue>/manifest.json` | Durable artifact staging manifest (gitignored, see § Staging (ADR-021 D1)) |
| `archive/` | Rotated ledger snapshots and pre-mutation `queue.json` snapshots (gitignored) |

Full schemas: `plugins/blackhole-claude/skills/blackhole/references/findings-ledger.md`,
`queue-dag.md`.

## Write protocol

**`jq empty <file>` is never sufficient as a write guard on its own — do not reintroduce it as a
simplification.** It exits 0 on a zero-byte file: it detects malformed JSON, not *absent* JSON.
Issue #489 traced a real incident to exactly this gap — a heredoc-authored `jq` program failed to
compile, the shell redirect had already truncated the `.tmp` file to 0 bytes before `jq` ran,
`jq empty` on that 0-byte file exited 0, and the empty file was atomically installed over live
`queue.json`, losing all 98 issue entries. `findings-ledger.json` was untouched only because that
mutation happened not to run in the same incident.

1. Snapshot the live file to `archive/<file>-<timestamp>.json` before mutating it (queue and
   ledger alike) — recovery must never depend on a scratchpad `.tmp` file surviving by luck.
2. Write the candidate output to `<file>.tmp`.
3. Validate the `.tmp` file with `scripts/lib/state-write-guard.ts`'s `validateStateWrite()`
   (queue.json's `entityKey` is `issues`, the ledger's is `findings`) before installing it. The
   guard fails closed on any of:
   - the `.tmp` file is empty (0 bytes) — the case `jq empty` cannot catch
   - malformed JSON — the one case `jq empty` does catch
   - the required top-level entity key (`issues`/`findings`) is absent
   - the entity count is lower than the live file's, unless the caller passes `allowShrink: true`
     for a legitimate reduction (an issue removed, a ledger rotated to `archive/`) — even with
     `allowShrink`, a collapse to exactly zero is always refused; a declared shrink is not a
     declared wipe
4. Only on a passing validation, atomically install: `mv <file>.tmp <file>`.
5. Bump `refreshed_at` on every mutation.
6. Idempotency: dedup ledger by `(vcode, file, line, issue_ref)` before append.

## Single-writer invariant

The orchestrator is the sole writer of `queue.json` and `findings-ledger.json`. Workers
spawned as part of a parallel batch (e.g. a router wave, `orchestrator-runtime.md` § Background worker
barrier) never write either file directly — each worker computes and returns its result as
JSON, and the orchestrator applies mutations serially, one completed worker at a time, post-barrier
(`orchestrator-runtime.md` § Triage), even though the batch itself ran in parallel. This closes the
lost-update race that a direct-write-per-worker protocol would otherwise create (concurrent
read-before-either-writes on the same counter/array — issue #224). File locking (`flock`) and
optimistic retry/CAS were considered and explicitly deferred in favor of this invariant, because
the documented single-orchestrator-per-campaign topology (`multitask-mode.md` already forbids a
second live orchestrator) closes the race without new locking/CAS machinery.

## Staging (ADR-021 D1)

Thinking-time agents (`planner` Design Track, `investigator`'s `analyze`/`investigate`
sub-modes) cannot commit into `documentation/` — no PR branch exists yet at Phase 2
(`documentation/decisions/ADR-021-durable-artifact-staging.md` D1). They instead write into
`.blackhole/staged/<issue>/`, a durable staging area the orchestrator passes to the agent as an
**absolute repo-root path** at spawn time — the same convention `phase-implement.md` § "Plan
artifact paths (worktree rule)" already uses for the plan file
(`{repo_root}/.blackhole/plans/issue-N.md`), because these agents may run before any worktree
exists. `phase-plan.md`, `phase-handle.md`, and `orchestrator-dispatch.md` each point back to
this section for that absolute-path-passing convention rather than restating it.

Gated by `docs_governance.enabled` / `docs_governance.write_governance`, "absent or false ⇒
inert" — identical phrasing to `artifact-contract.md`'s existing kill switch: when either flag
resolves absent or `false`, no staging write happens and no manifest entry is appended.

### `.blackhole/staged/<issue>/manifest.json`

```json
{
  "issue": 465,
  "updated_at": "2026-08-06T18:00:00.000Z",
  "entries": [
    {
      "route": "design",
      "sub_mode": null,
      "produced_by": "planner",
      "declared_at": "2026-08-06T17:55:00.000Z",
      "staged_path": ".blackhole/staged/465/ADR-021-durable-artifact-staging.md",
      "target_path": "documentation/decisions/ADR-021-durable-artifact-staging.md",
      "target_kind": "new_file"
    },
    {
      "route": "design",
      "sub_mode": null,
      "produced_by": "planner",
      "declared_at": "2026-08-06T17:55:00.000Z",
      "staged_path": ".blackhole/staged/465/decisions-index-row.md",
      "target_path": "documentation/decisions/INDEX.md",
      "target_kind": "append_row"
    },
    {
      "route": "analyze",
      "sub_mode": "analyze",
      "produced_by": "investigator",
      "declared_at": "2026-08-06T17:40:00.000Z",
      "staged_path": ".blackhole/staged/465/analysis-issue-465.md",
      "target_path": "documentation/audits/analysis-issue-465.md",
      "target_kind": "new_file"
    },
    {
      "route": "analyze",
      "sub_mode": "analyze",
      "produced_by": "investigator",
      "declared_at": "2026-08-06T17:40:00.000Z",
      "staged_path": ".blackhole/staged/465/index-row.md",
      "target_path": "documentation/INDEX.md",
      "target_kind": "append_row"
    }
  ]
}
```

The `design` pair above stages an ADR body and its `documentation/decisions/INDEX.md` row
(`planner.md` §4.8). The `analyze`/`investigate` pair stages an investigator-authored note and
its **root** `documentation/INDEX.md` row (issue #490, ADR-021 D2) — same `new_file` +
`append_row` two-entry shape, different producer and different target file. No new `route` or
`target_kind` enum member was required for this second pair — both `analyze`/`investigate`
(`route`) and `append_row` (`target_kind`) already existed in the schema below.

| Field | Values | Notes |
|---|---|---|
| `issue` | number | Matches the `<issue>` directory name |
| `updated_at` | ISO8601 | Bumped on every append |
| `entries[].route` | `analyze` \| `investigate` \| `design` \| `brainstorm` | Matches `artifact-contract.md`'s route→artifact table; `brainstorm` is reserved for schema completeness — it is **not** populated yet (brainstorm already has its own working `.blackhole/plans/issue-N-brainstorm.md` → docs-only-implementer mechanism, untouched here) |
| `entries[].sub_mode` | `research` \| `investigate` \| `analyze` \| `null` | Set by `investigator` entries (`research` never appears — it has no `documentation/` target); `null` for `planner`/design entries |
| `entries[].produced_by` | `planner` \| `investigator` | Which agent staged the artifact |
| `entries[].declared_at` | ISO8601 | When the entry was staged |
| `entries[].staged_path` | string | Repo-relative path under `.blackhole/staged/<issue>/` |
| `entries[].target_path` | string | Repo-relative `documentation/` target, per `artifact-contract.md`'s route table. For `target_kind: append_row` this is either `documentation/decisions/INDEX.md` (`design` route, `planner.md` §4.8) or `documentation/INDEX.md` (`analyze`/`investigate` routes, issue #490) — no new `route`/`target_kind` enum member required for either |
| `entries[].target_kind` | `new_file` \| `append_row` | Tells the carry-step whether to copy a whole file or append a row fragment to an existing file (e.g. `INDEX.md`) |

### Write protocol extension

Same atomic `.tmp` + `mv` read-modify-write as § Write protocol above, applied to
`manifest.json`. Each producer (`planner`, `investigator`) appends only its own entries and never
mutates another producer's row. This is **not** covered by § Single-writer invariant above — that
invariant is scoped to `queue.json`/`findings-ledger.json` only. Concurrency safety here instead
comes from `planner` and `investigator` never running for the same issue in the same phase
(design-track `planner` runs in Phase 2; `analyze`/`investigate` `investigator` runs in Phase 1 or
at escalation — never overlapping for one issue), so there is no lost-update race to close.

### Consumers of this section's manifest schema

- The **carry-step** that copies staged artifacts into their `documentation/` targets and commits
  them inside the PR is implemented at `implementer.md` § Carry Staged Artifacts (D2) — this
  section only documents the manifest shape that step consumes.
- The **reviewer audit** that diffs the staged manifest against the PR to detect a declared but
  never-carried artifact is **not implemented by this section** — it is a separate deliverable
  (D4, tracked issue #468) that will consume the manifest shape this section documents.

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

## Worktree & Branch obligations

- Run `git worktree prune` and `git fetch --prune` before creating a new worktree or branch.
- Before removing a worktree — post-merge cleanup included, not only the mergeable-release
  boundary — refuse when `git -C <worktree> log @{u}..HEAD` is non-empty: `git worktree remove`
  only refuses on a dirty tree, not on unpushed history, so a merged PR alone does not prove
  nothing local is still unpushed. Full guard and rationale: `blackhole-protocol.md` § Branch &
  Worktree Hygiene; procedure: `recovery-protocol.md` §4/§6(c).
- Verify worktree directories are clean and removed from disk after worker tasks finish. Do not leave orphaned worktree directories in the scratchpad.

Note: `config.json`'s `docs_governance` block is a kill switch for companion-file,
docs-impact-routing, and write-governance state mutations. Any future feature that
reads or mutates state under this block's scope must check `docs_governance.enabled`
(and the relevant sub-flag) before acting. The absent-block default is defined once, in
`config-template.md`'s `docs_governance.enabled` row and contract note — this file does
not restate it (V-DRY-01, issue #477).
<!-- GENERATED by scripts/build.ts from src/references/blackhole-state.md — do not hand-edit -->
