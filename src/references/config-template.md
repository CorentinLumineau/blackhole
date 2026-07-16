# Campaign Config Template

Committed template: `.blackhole/config.json`

```json
{
  "repo": "owner/repo-name",
  "target_branch": "main",
  "forge": "github",
  "parallel_max": 4,
  "scratchpad_dir": "/tmp/campaign",
  "size_label_prefix": "size:",
  "default_touch_paths": ["src/**", "lib/**", "app/**"],
  "issue_labels": {
    "campaign": "blackhole/backlog"
  },
  "scope_milestone": "v0.4.0",
  "scope_labels": ["blackhole/backlog", "size:m"],
  "auto_sync": true,
  "adaptive_routing": true,
  "router_confidence_thresholds": { "split": 70, "design": 70, "plan_mode": 70, "security": 70, "docs": 70, "analysis": 70 },
  "docs_governance": { "enabled": true, "companion_files": true, "docs_impact_routing": true, "write_governance": true, "severity_overrides": {} },
  "kaizen": { "enabled": false, "kinds": ["quickwins", "best-practices", "coverage", "refactor", "bug", "retrospective"], "trigger": "on-empty", "loop_interval": 5, "min_priority": 30, "max_issues_per_wave": 10, "max_waves": 6 },
  "incident_mode": { "enabled": false, "parallel_max_override": 1, "pause_discovery": true },
  "autonomy": { "enabled": false, "confidence_threshold": 80, "design_dominance_delta": 30, "design_autonomy": true, "analyze_routing": true, "brainstorm_routing": true, "never_bypass": ["destructive", "credentials", "epic-go-no-go"] },
  "worker_model_policy": "cost-optimized",
  "entry_mode": "multitask",
  "merge_mode": "immediate"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `repo` | yes | `owner/name` for `gh` |
| `target_branch` | yes | Merge target (usually `main`) |
| `forge` | yes | `github` (only supported v1) |
| `parallel_max` | no | Max parallel workers (default 4) |
| `scratchpad_dir` | no | Parent dir for git worktrees |
| `size_label_prefix` | no | Label prefix for size tags (default `size:`) |
| `default_touch_paths` | no | Glob patterns for default scope boundary |
| `issue_labels.campaign` | no | Label applied on runtime `gh issue create` (see `forge-sync.md`) |
| `scope_milestone` | no | Milestone **title** (not number). When set, only issues in this milestone are in campaign scope |
| `scope_labels` | no | When set, issue must have **all** listed labels (AND). Empty array treated as unset |
| `auto_sync` | no | When `true` (default), forge reconcile runs automatically |
| `adaptive_routing` | no | Emergency kill switch for ADR-004 router-agent routing (default `true`); when `false`, routing is inert regardless of `route` presence in `queue.json` |
| `router_confidence_thresholds` | no | Per-flag confidence thresholds keyed by `split`, `design`, `plan_mode`, `security`, `docs`, `analysis` (matches `route.confidence` keys); each defaults to `70` when absent. The `analysis` threshold alone does not turn on `needs_analysis` dispatch — that is additionally gated by `autonomy.enabled && autonomy.analyze_routing` (see below) |
| `docs_governance` | no | Nested object of flags/thresholds for companion-file, docs-impact-routing, and write-governance features (`enabled`, `companion_files`, `docs_impact_routing`, `write_governance`, `severity_overrides`); absent block = current behavior preserved (all three sub-flags gate live features — see rows below) |
| `docs_governance.enabled` | no | Emergency kill switch for the whole `docs_governance` block (default `true`); when `false`, every dependent feature is inert regardless of sub-field values |
| `docs_governance.companion_files` | no | Gates the V-ADA companion-file reviewer audit (default `true`); when `false`, that audit is inert regardless of `enabled` — live consumers: `src/agents/reviewer.md` § 10 "Companion-File Audit (`V-ADA-01/02/03/05/06/07`)", config-gated at `reviewer.md:69`, and `src/SKILL.md` Phase 0 step 2 "Companion-file scaffold", config-gated at `SKILL.md:42` |
| `docs_governance.docs_impact_routing` | no | Gates the router `docs_impact` flag (`src/agents/router.md`, `src/agents/orchestrator.md` § Route-derived dispatch, #177); default `true`; when `false` (or `docs_governance.enabled: false`), `docs_impact` resolves to its cautious default (`true`) regardless of computed value or confidence |
| `docs_governance.write_governance` | no | Gates search-before-write/canonical-slug rules for consumer-repo writes (default `true`); when `false`, those rules are inert regardless of `enabled` — live consumers: `src/agents/implementer.md` (companion-doc update step, gated at `implementer.md:67`) and `src/agents/planner.md` (Standard Track Documentation Impact bullet, gated at `planner.md:65`) |
| `docs_governance.severity_overrides` | no | Map of V-code → `BLOCK`\|`WARN`, keyed by docs-governance V-code; empty/absent = defaults apply. May only escalate a WARN-default docs-governance code to BLOCK — must never de-escalate the pre-existing `V-DOC-02`/`V-DOC-04` BLOCK severity |
| `kaizen` | no | Nested object gating the kaizen improvement-hunt loop (ADR-006): `enabled`, `kinds`, `trigger`, `loop_interval`, `min_priority`, `max_issues_per_wave`, `max_waves`; absent block = current behavior preserved (hunting is opt-in, see contract note below) |
| `kaizen.enabled` | no | Kill switch for the whole `kaizen` block (default `false` — hunting is opt-in, unlike `docs_governance` which defaults `true`); when `false`, hunt dispatch never fires regardless of sub-field values |
| `kaizen.kinds` | no | Array of hunt territory kinds to scan (default `["quickwins", "best-practices", "coverage", "refactor", "bug", "retrospective"]`); `retrospective` is included by default whenever `kaizen.enabled: true` |
| `kaizen.trigger` | no | `on-empty` \| `every-n-loops` \| `manual` (default `on-empty`) — when the Phase-5 loop dispatches a hunt wave |
| `kaizen.loop_interval` | no | Number of Phase-5 loop iterations between hunt waves when `trigger: every-n-loops` (default `5`) |
| `kaizen.min_priority` | no | Minimum `Priority = Gain * (11 - Effort)` a finding must clear to be filed as an issue (default `30`, matching the `V-PARETO-02` BLOCK floor); may only be **raised** above `30`, never lowered below the `V-PARETO-02` threshold |
| `kaizen.max_issues_per_wave` | no | Cap on issues filed per hunt wave (default `10`) — exceeding it is `V-HUNT-02` (WARN) |
| `kaizen.max_waves` | no | Cap on total hunt waves per kind before it is marked exhausted (default `6`) |
| `incident_mode` | no | Nested object gating the campaign-wide incident posture (`orchestrator.md` § Incident Mode): `enabled`, `parallel_max_override`, `pause_discovery`; absent block = current behavior preserved (incident mode is a rare, deliberately-armed emergency posture, opt-in like `kaizen`, see contract note below) |
| `incident_mode.enabled` | no | Kill switch for the whole `incident_mode` block (default `false` — armed manually by a human/coordinator, unlike `docs_governance` which defaults `true`); when `false`, incident-mode dispatch behavior never fires regardless of sub-field values |
| `incident_mode.parallel_max_override` | no | `parallel_max` value enforced while incident mode is active (default `1`), regardless of `config.json.parallel_max` |
| `incident_mode.pause_discovery` | no | When `true` (default), `phase-loop.md` § Continuous Discovery of Improvements is paused entirely while incident mode is active |
| `autonomy` | no | Nested object gating the opt-in autonomous thinking-route features (ADR-010): `enabled`, `confidence_threshold`, `design_dominance_delta`, `design_autonomy`, `analyze_routing`, `brainstorm_routing`, `never_bypass`; absent block = current behavior preserved (opt-in, see contract note below) |
| `autonomy.enabled` | no | Kill switch for the whole `autonomy` block (default `false` — opt-in like `kaizen`, unlike `docs_governance` which defaults `true`); when `false`, autonomous-thinking-route dispatch never fires regardless of sub-field values |
| `autonomy.confidence_threshold` | no | Composite confidence score (0–100) a route/design decision must clear to proceed autonomously (default `80`); see [confidence-gates.md](confidence-gates.md) for the 5-dimension kernel and two-band mapping |
| `autonomy.design_dominance_delta` | no | Minimum point spread between the top-scored design alternative and the runner-up required for autonomous design promotion (default `30`); see [confidence-gates.md](confidence-gates.md) |
| `autonomy.design_autonomy` | no | Gates the autonomous design tier — blind-critic scoring, `design-aggregate.ts` verdict, and in-PR ADR promotion (default `true`); when `false` (or `autonomy.enabled: false`), design decisions always route to human ADR review |
| `autonomy.analyze_routing` | no | Gates the router's `needs_analysis` autonomous dispatch to the investigator `analyze` sub-mode (default `true`); when `false` (or `autonomy.enabled: false`), analyze routing is inert |
| `autonomy.brainstorm_routing` | no | Gates the router's `needs_brainstorm` autonomous dispatch to the planner `track: brainstorm` (default `true`); when `false` (or `autonomy.enabled: false`), brainstorm routing is inert |
| `autonomy.never_bypass` | no | Array of categorical triggers that always force human escalation regardless of confidence score (default `["destructive", "credentials", "epic-go-no-go"]`); see [confidence-gates.md](confidence-gates.md) |
| `worker_model_policy` | no | `cost-optimized` (default) — per-spawn model from role/track/route tier matrix, cheapest capable slug on current harness (`model-routing.md`); `inherit` — parent session model, no `model` override (v0.6.1 behavior) |
| `entry_mode` | no | `multitask` (default) — coordinator + orchestrator; `direct` = legacy single session |
| `merge_mode` | no | `"immediate"` (default) \| `"gated-batch"` (ADR-005) \| `"leave-open"` (ADR-006); preserves current behavior exactly when absent/default — each PR merges as soon as it reaches LGTM. Adding `leave-open` is a pure additive enum value — `immediate`/`gated-batch` semantics are unchanged. `gated-batch` waits for all in-scope PRs (per `scope_milestone`/`scope_labels`) to reach LGTM, then merges one PR at a time in `merge_after` dependency order; see `merge-gate.md`. `leave-open`: blackhole never merges — every PR is driven to LGTM and left open for human review/merge; an LGTM'd open PR counts as *delivered* for campaign-complete purposes; `merged_by: blackhole` is never set for these issues; `fixed-in-pr` ledger rows stay `fixed-in-pr` until the human merge is later observed by a sync; see `phase-loop.md` § Merge protocol and `merge-gate.md` |

**`docs_governance` contract note**: when the block is absent, or
`docs_governance.enabled` is `false`, every dependent feature (reviewer V-ADA
companion-file audit, router `docs_impact` flag, write-governance remedies —
`docs_impact`'s dispatch consumer is `src/agents/orchestrator.md:83-89` §
Route-derived dispatch (#177); the reviewer companion-file audit's consumer is
`reviewer.md` § 10 (above); write-governance's consumers are
`implementer.md`/`planner.md` (above)) MUST be a no-op and current behavior is
preserved exactly. Any future issue that wires a dependent feature must check this flag
(and its relevant sub-flag) before acting — the same obligation
`adaptive_routing` already imposes on router-agent routing.
`docs_governance.severity_overrides` may only **escalate** a WARN-default
docs-governance V-code to `BLOCK` per repo; it must never de-escalate the
pre-existing `V-DOC-02`/`V-DOC-04` `BLOCK` severity.

**`kaizen` contract note**: when the block is absent, or `kaizen.enabled` is
`false`, the kaizen improvement-hunt loop (ADR-006) MUST be a no-op and
current behavior is preserved exactly — no hunt wave dispatches, no hunter
agent spawns, `hunt_state` is never written. `kaizen.min_priority` may only be
**raised** above its default of `30`, never lowered below the `V-PARETO-02`
`BLOCK` threshold. This is the same obligation `docs_governance.enabled` and
`adaptive_routing` already impose on their respective features.

**`incident_mode` contract note**: when the block is absent, or
`incident_mode.enabled` is `false`, the incident-mode posture (`orchestrator.md` §
Incident Mode) MUST be a no-op and current behavior is preserved exactly — no
`parallel_max` override, no strict `migration_slot` enforcement beyond the
existing baseline rule, no pausing of `phase-loop.md` § Continuous Discovery of
Improvements. This is the same obligation `docs_governance.enabled` and
`kaizen.enabled` already impose on their respective features.

**`autonomy` contract note**: when the block is absent, or `autonomy.enabled`
is `false`, every dependent feature (design autonomy tier, analyze/brainstorm
routing, confidence-gated escalation) MUST be a no-op and current behavior is
preserved exactly — no route flag changes dispatch, no `design-aggregate.ts`
invocation (that script does not exist until Milestone 2), no confidence math
runs. This is the same obligation `docs_governance.enabled` and
`kaizen.enabled` already impose on their respective features.

**Scope filter composition** (both fields optional — unset means no filter on that axis):

| `scope_milestone` | `scope_labels` | Effective filter |
|-------------------|----------------|------------------|
| unset | unset | All open issues (default) |
| set | unset | Milestone match only |
| unset | set | All labels present |
| set | set | Milestone match **AND** all labels present |

`issue_labels.campaign` is independent of `scope_labels` — scope labels are additive
filters for ingest/completion, not auto-merged into scope unless listed in `scope_labels`.

Runtime state files (gitignored in consumer repos):

| File | Purpose |
|------|---------|
| `queue.json` | Issue DAG and scheduling |
| `findings-ledger.json` | V-code findings SSOT |
| `plans/<issue>.md` | Implementation plans |
| `campaign-checkpoint.md` | Resume summary (see `checkpoint-protocol.md`) |

On first bootstrap, copy template to runtime if missing fields — do not
overwrite existing runtime config without user confirmation.

