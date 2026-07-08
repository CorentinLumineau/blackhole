# Findings Ledger — Schema + Write Protocol

Path: `.blackhole/findings-ledger.json` (gitignored at runtime).

## Schema

```json
{
  "refreshed_at": "2026-07-04T12:00:00.000Z",
  "next_id": 1,
  "findings": [
    {
      "id": "F-00001",
      "vcode": "V-DRY-01",
      "severity": "BLOCK",
      "phase": "plan",
      "issue_ref": 298,
      "pr_ref": null,
      "file": "lib/foo.ts",
      "line": 42,
      "summary": "Duplicated money formatting logic",
      "status": "open",
      "deferred_to_issue": null,
      "created_at": "2026-07-04T12:00:00.000Z",
      "resolved_at": null
    }
  ]
}
```

### Field rules

| Field | Values | Notes |
|-------|--------|-------|
| `id` | `F-NNNNN` | Zero-padded from `next_id`; increment after append |
| `vcode` | `V-*` | Required on every row |
| `severity` | `BLOCK` \| `WARN` \| `NOTE` | Matches vcodes rule |
| `phase` | `handle` \| `plan` \| `implement` \| `review` | When discovered |
| `issue_ref` | number | Parent campaign issue |
| `pr_ref` | number \| null | Set when PR exists |
| `status` | `open` \| `fixed-in-pr` \| `deferred` \| `resolved` | See state machine |
| `deferred_to_issue` | number \| null | **Required** when `status: deferred` |

### Status transitions

```
open → fixed-in-pr     (addressed in current PR, pre-merge)
open → deferred        (filed as new issue — deferred_to_issue required)
open → resolved        (fixed without deferral, or superseded)
fixed-in-pr → resolved (after merge)
deferred → resolved    (when deferred issue merges — optional cleanup)
```

## Write protocol

1. **Initialize** if missing:

```json
{ "refreshed_at": "<ISO>", "next_id": 1, "findings": [] }
```

2. **Validate** before any read-dependent step:

```bash
jq empty .blackhole/findings-ledger.json
```

3. **Dedup** before append — key `(vcode, file, line, issue_ref)`:

```bash
jq --arg v "V-DRY-01" --arg f "lib/foo.ts" --argjson l 42 --argjson i 298 \
  'any(.findings[]; .vcode == $v and .file == $f and .line == $l and .issue_ref == $i)' \
  .blackhole/findings-ledger.json
```

If `true`, skip append.

4. **Append** — read-modify-write atomically (tmp + mv):

```bash
# Pseudocode: orchestrator builds JSON patch, writes via jq
jq '.findings += [$new] | .next_id += 1 | .refreshed_at = (now | todate)' \
  .blackhole/findings-ledger.json > .blackhole/findings-ledger.json.tmp \
  && mv .blackhole/findings-ledger.json.tmp .blackhole/findings-ledger.json
```

5. **Deferral** — never set `status: deferred` without filing issue first:

```bash
gh issue create --title "..." --body "..." \
  $(bun scripts/forge-scope.ts create-args)
# then append with deferred_to_issue: <number>
```

6. **Archival** — when `resolved` count exceeds 200, move to
   `.blackhole/archive/findings-<timestamp>.json` and prune from
   active ledger (keep `open` and `deferred`).

## Routing decision records (ADR-004)

Schema-only addition — no write logic ships in this issue (that lands in step 5, the
`router` agent). Mirrors the `findings` array convention rather than overloading it: a
routing decision has no `vcode`/`severity`/fixed-deferred lifecycle, so it lives in its own
sibling array instead of weakening the `findings` "vcode required on every row" rule.

New top-level `routing_decisions` array (sibling to `findings`), with its own
`next_routing_id` counter (mirrors `next_id`):

```json
{
  "refreshed_at": "2026-07-04T12:00:00.000Z",
  "next_id": 1,
  "findings": [],
  "next_routing_id": 1,
  "routing_decisions": [
    {
      "id": "R-00001",
      "issue_ref": 298,
      "trigger": "initial",
      "route": {
        "needs_split": false,
        "needs_clarification": false,
        "needs_research": false,
        "needs_investigation": true,
        "needs_design": false,
        "task_type": "bugfix",
        "plan_mode": "quick",
        "security_review_required": false,
        "confidence": { "split": 95, "design": 80, "plan_mode": 70, "security": 90 },
        "body_hash": "<sha>",
        "computed_at_phase": "handle",
        "revision": 1
      },
      "created_at": "2026-07-04T12:00:00.000Z"
    }
  ]
}
```

### Field rules

| Field | Values | Notes |
|-------|--------|-------|
| `id` | `R-NNNNN` | Zero-padded from `next_routing_id`; increment after append |
| `issue_ref` | number | Parent campaign issue |
| `trigger` | `initial` \| `clarify-resolved` \| `research-landed` \| `investigation-landed` | Matches the ADR's three re-route checkpoints plus the initial pass |
| `route` | object | Same shape as `queue.json` issue `route` object — see `queue-dag.md` `### \`route\` object` |
| `created_at` | ISO timestamp | Record creation time |

One entry appended per route computation/revision — **append-only, never mutated**, for
human spot-audit. Same `.tmp` + `mv` atomic-write protocol as the `findings` write protocol
above (validate with `jq empty`, then read-modify-write atomically, bumping
`next_routing_id` and `refreshed_at`).

## Binding obligations

- Every V-code mentioned in any phase → one ledger row before orchestrator ends turn.
- Chat-only findings are invalid.
- Session handoff includes `LEDGER OPEN: <count of open+deferred>`.
<!-- GENERATED by scripts/build.ts from src/references/findings-ledger.md — do not hand-edit -->
