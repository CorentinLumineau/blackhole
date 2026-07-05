# Findings Ledger — Schema + Write Protocol

Path: `.bc-campaign/findings-ledger.json` (gitignored at runtime).

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
jq empty .bc-campaign/findings-ledger.json
```

3. **Dedup** before append — key `(vcode, file, line, issue_ref)`:

```bash
jq --arg v "V-DRY-01" --arg f "lib/foo.ts" --argjson l 42 --argjson i 298 \
  'any(.findings[]; .vcode == $v and .file == $f and .line == $l and .issue_ref == $i)' \
  .bc-campaign/findings-ledger.json
```

If `true`, skip append.

4. **Append** — read-modify-write atomically (tmp + mv):

```bash
# Pseudocode: orchestrator builds JSON patch, writes via jq
jq '.findings += [$new] | .next_id += 1 | .refreshed_at = (now | todate)' \
  .bc-campaign/findings-ledger.json > .bc-campaign/findings-ledger.json.tmp \
  && mv .bc-campaign/findings-ledger.json.tmp .bc-campaign/findings-ledger.json
```

5. **Deferral** — never set `status: deferred` without filing issue first:

```bash
gh issue create --title "..." --body "..." \
  $(bun scripts/forge-scope.ts create-args)
# then append with deferred_to_issue: <number>
```

6. **Archival** — when `resolved` count exceeds 200, move to
   `.bc-campaign/archive/findings-<timestamp>.json` and prune from
   active ledger (keep `open` and `deferred`).

## Binding obligations

- Every V-code mentioned in any phase → one ledger row before orchestrator ends turn.
- Chat-only findings are invalid.
- Session handoff includes `LEDGER OPEN: <count of open+deferred>`.
