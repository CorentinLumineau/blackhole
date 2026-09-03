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
| `phase` | `handle` \| `plan` \| `implement` \| `review` \| `hunt` | When discovered |
| `issue_ref` | number | Parent campaign issue |
| `pr_ref` | number \| null | Set when PR exists |
| `status` | `open` \| `fixed-in-pr` \| `deferred` \| `resolved` | See state machine |
| `deferred_to_issue` | number \| null | **Required** when `status: deferred` |
| `reconciled_at` | ISO timestamp \| absent | Set the turn the reconciliation check/triage script transitions a `deferred` row off its terminal state (issue #809) — **recorded, not inferred at read time**. Absent means never reconciled |
| `reconciliation_rule` | `closed-pr-title-match` \| `closed-pr-body-match` \| `manual-triage` \| absent | Which reproducible rule (issue #809, `scripts/triage-deferred-findings.ts`) classified the transition; `manual-triage` covers rows where the automated title/body match was ambiguous and a human confirmed the outcome |

### Status transitions

```
open → fixed-in-pr     (addressed in current PR, pre-merge)
open → deferred        (filed as new issue — deferred_to_issue required)
open → resolved        (fixed without deferral, or superseded)
fixed-in-pr → resolved (after merge)
deferred → resolved    (when deferred issue closes AND the work shipped — mandatory, not optional;
                         set reconciled_at + reconciliation_rule, issue #809)
deferred → open        (deferred_to_issue closed WITHOUT the work shipping — reopened into the
                         normal open-finding flow rather than left permanently invisible behind a
                         closed issue; set reconciled_at + reconciliation_rule, issue #809)
```

**Reconciliation (issue #809)**: nothing previously reconciled a `deferred` finding once its
`deferred_to_issue` target closed — the ledger's never-drop invariant was enforced at filing time
(§ Write protocol step 5) but not at closure time. `scripts/checks/deferred-reconciliation.check.ts`
(`V-DEFER-01`, advisory — see `blackhole-vcodes.md`) surfaces every `deferred` row whose target has
closed (`queue.json` status `merged`/`closed`, or the target is absent from `queue.json` entirely —
an "untracked" category) with no `reconciled_at` set, at the same per-turn cadence as forge sync
(`forge-sync.md` § Native auto-sync). `scripts/triage-deferred-findings.ts` is the one-time
migration that classifies the existing backlog via a reproducible rule (closed via a merged PR
whose title/body references the finding's `vcode`/`file` → `resolved`; every other closed-target
row → reopened to `open`, flagged `manual-triage` for human confirmation).

### Known limitation: prose-only sub-deferrals are not mechanically detected

A deferral recorded only as prose inside an issue body, a PR description, or a rule-file decision
record — with no `deferred_to_issue` field anywhere — cannot be found by grepping
`findings-ledger.json`, because the ledger has no row to examine in the first place. Detecting
this shape would require full-text NLP/semantic search across every closed issue's body and every
merged PR's description looking for deferral-shaped language ("deferred to", "follow-up issue",
"tracked separately") with no structured anchor — explicitly out of scope
(`V-KISS-01`/`V-YAGNI-01`: no speculative NLP pipeline for a problem with no current reproducible
trigger). Worked example: issue `#551` recorded such a prose-only sub-deferral in its own body/PR
with no `deferred_to_issue` field pointing at it; the gap went unnoticed for 3 weeks until
independently rediscovered and re-filed as `#803`. This plan does not solve that shape — it is
**not mechanically detected**, documented here as a known, accepted limitation.

**`companion_repairs[]` consumer** (issue #453): on an implementer `status: complete`, the
orchestrator matches each `companion_repairs[]` row's `(vcode, file)` against open/deferred
ledger rows using the **V-ADA-01/V-ADA-05 dedup** rule below (ignore `issue_ref`). For each
match: set `status: fixed-in-pr`, `pr_ref` from the worker's PR, append
`companion-repair: <action>` to `summary`. Unmatched rows are no-ops (repair without a prior
ledger finding is valid).

A `recheck[]` `verdict: fixed` prior row (issue #485) transitions `open → resolved` before the
orchestrator runs § Write protocol step 3's dedup check for the current append batch — this is
what keeps that check's `open`/`deferred` status filter (step 3, above) from silently absorbing
a new, distinct finding sharing the resolved row's key.

## Write protocol

1. **Initialize** if missing:

```json
{ "refreshed_at": "<ISO>", "next_id": 1, "findings": [] }
```

2. **Validate** before any read-dependent step:

```bash
bun run scripts/lib/state-write-guard.ts --tmp .blackhole/findings-ledger.json --entity-key findings
```

Never `jq empty` alone — `blackhole-state.md` § Write protocol.

3. **Dedup** before append — key `(vcode, file, line, issue_ref)`, scoped to `open`/`deferred`
   rows only (issue #485: a `resolved` row — e.g. one whose `recheck[]` verdict came back
   `fixed`, see § Status transitions below — must never suppress append of a new, distinct
   finding that happens to share its key; this is the write-time counterpart to
   `review-aggregate.ts`'s in-memory recheck exclusion, `review-core.md` § Dedup key):

```bash
jq --arg v "V-DRY-01" --arg f "lib/foo.ts" --argjson l 42 --argjson i 298 \
  'any(.findings[]; .vcode == $v and .file == $f and .line == $l and .issue_ref == $i and (.status == "open" or .status == "deferred"))' \
  .blackhole/findings-ledger.json
```

If `true`, skip append.

**V-ADA-01/V-ADA-05 exception**: these two vcodes are structural-presence
checks (repo either has `ARCHITECTURE.md`/`AGENTS.md` at its root or it
doesn't, independent of any single issue's diff), so they dedup by
`(vcode, file)` **ignoring `issue_ref`** — skip append if an open/deferred row
already exists for that `(vcode, file)` under any `issue_ref`:

```bash
jq --arg v "V-ADA-01" --arg f "ARCHITECTURE.md" \
  'any(.findings[]; .vcode == $v and .file == $f and (.status == "open" or .status == "deferred"))' \
  .blackhole/findings-ledger.json
```

See `phase-review.md` § Checklist for the orchestrator-side mechanism.

4. **Append** — read-modify-write atomically (tmp + mv), validating the `.tmp` file before
   install (`blackhole-state.md` § Write protocol):

```bash
# Pseudocode: orchestrator builds JSON patch, writes via jq
jq '.findings += [$new] | .next_id += 1 | .refreshed_at = (now | todate)' \
  .blackhole/findings-ledger.json > .blackhole/findings-ledger.json.tmp \
  && bun run scripts/lib/state-write-guard.ts --tmp .blackhole/findings-ledger.json.tmp \
       --live .blackhole/findings-ledger.json --entity-key findings \
  && mv .blackhole/findings-ledger.json.tmp .blackhole/findings-ledger.json
```

`$new`'s `issue_ref`/`pr_ref` are copied verbatim from `review-aggregate.ts`'s stamped output
(`review-core.md` § Aggregate invocation) — never re-typed or re-derived by hand at append time
(V-LEDGER-01, `scripts/checks/ledger-schema.check.ts`).

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
      "local_analyze": {
        "triggered": true,
        "reason": "plan_mode confidence 55 < threshold 70",
        "touch_paths_scanned": ["src/auth/session.ts"],
        "matches": [
          {
            "file": "src/auth/session.ts",
            "line": 12,
            "pattern": "auth/",
            "verified": true,
            "classification": "real"
          }
        ],
        "security_review_required_raised": true,
        "plan_mode_confidence_boosted": false
      },
      "rationale": "plan_mode confidence 55 is below threshold 70; cautious full plan_mode default applies pending local-analyze scan.",
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
| `trigger` | `initial` \| `clarify-resolved` \| `research-landed` \| `investigation-landed` \| `analysis-landed` | Matches the ADR's four re-route checkpoints plus the initial pass |
| `route` | object | Same shape as `queue.json` issue `route` object — see `queue-dag.md` `### \`route\` object` |
| `rationale` | string \| absent | Copied verbatim from the router return when present; omitted on historical rows predating this field |
| `local_analyze` | object \| `null` | ADR-004 step 5b confidence-boost scan record; `null` when the scan did not trigger (confidence already ≥ threshold, or the row predates this mechanism) |
| `local_analyze.triggered` | boolean | Always `true` when the object is non-null |
| `local_analyze.reason` | string | Human-readable trigger justification (which confidence score, threshold) |
| `local_analyze.touch_paths_scanned` | string[] | The exact globs scanned — the routed issue's own `touch_paths`, never repo-wide |
| `local_analyze.matches` | array | One entry per candidate grep/glob hit, including hits later discarded by verification |
| `local_analyze.matches[].file` / `.line` | string / number | Location of the candidate match |
| `local_analyze.matches[].pattern` | string | Which security-adjacent pattern matched |
| `local_analyze.matches[].verified` | boolean | Result of the one-line verification step |
| `local_analyze.matches[].classification` | `real` \| `comment` \| `fixture` \| `string-literal` | Only `real` may raise `security_review_required` |
| `local_analyze.security_review_required_raised` | boolean | Did this scan raise the flag from `false`→`true`? Auditable proof of the monotonicity invariant, not just the final value |
| `local_analyze.plan_mode_confidence_boosted` | boolean | Did this scan raise `route.confidence.plan_mode`? |
| `created_at` | ISO timestamp | Record creation time |

One entry appended per route computation/revision — **append-only, never mutated**, for
human spot-audit. Same `.tmp` + `mv` atomic-write protocol as the `findings` write protocol
above (validate with `state-write-guard.ts` — never `jq empty` alone, `blackhole-state.md`
§ Write protocol — then read-modify-write atomically, bumping `next_routing_id` and
`refreshed_at`).

## Hunt state (ADR-006)

Schema-only addition — no write logic ships in this issue (that lands with the `hunter`
agent, #199, and orchestrator dispatch, #200). Unlike `routing_decisions[]`, `hunt_state` is
**not** an append-only array of records — it is a single object keyed by kind, a per-kind
watermark of hunt progress:

```json
{
  "refreshed_at": "2026-07-04T12:00:00.000Z",
  "next_id": 1,
  "findings": [],
  "next_routing_id": 1,
  "routing_decisions": [],
  "hunt_state": {
    "kinds": {
      "quickwins": {
        "bands_done": ["src/agents", "src/references"],
        "waves": 2,
        "exhausted": false,
        "last_wave_at": "2026-07-04T12:00:00.000Z"
      }
    }
  }
}
```

### Field rules

| Field | Values | Notes |
|-------|--------|-------|
| `hunt_state.kinds` | object | Keyed by `kaizen.kinds` entry (`quickwins`, `best-practices`, `coverage`, `refactor`, `bug`, ...) |
| `hunt_state.kinds.<kind>.bands_done` | string[] | Territory bands (e.g. directory globs) already scanned for this kind, in scan order |
| `hunt_state.kinds.<kind>.waves` | number | Count of hunt waves dispatched for this kind so far; compared against `kaizen.max_waves` |
| `hunt_state.kinds.<kind>.exhausted` | boolean | `true` once every band is scanned or `waves` reaches `kaizen.max_waves` — no further waves dispatch for this kind until reset |
| `hunt_state.kinds.<kind>.last_wave_at` | ISO timestamp \| `null` | When the most recent wave for this kind completed |

`hunt_state` is a watermark, not a decision log: each key is read-modify-written in place as
hunt waves complete, never appended to as a growing history. Same atomic write protocol as
every other ledger mutation — validate via `state-write-guard.ts` (never `jq empty` alone),
then read-modify-write via `.tmp` + `mv`, bumping `refreshed_at` (`blackhole-state.md`
§ Write protocol).

**Consumer sweep**: no code under `scripts/` or `src/` currently switches/matches on the
findings-ledger row's `phase` field (distinct from the unrelated queue-issue `IssuePhase` enum
in `scripts/recovery-drift.ts`/`scripts/campaign-status.ts`, which is unaffected by this
change). Only `fixtures/findings-ledger.example.json` and doc prose reference finding `phase`
values today — adding `hunt` to the enum is a clean additive extension with zero consumer risk.

## Binding obligations

- Every V-code mentioned in any phase → one ledger row before orchestrator ends turn.
- Chat-only findings are invalid.
- Session handoff includes `LEDGER OPEN: <count of open+deferred>`.
