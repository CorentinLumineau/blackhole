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
  "router_confidence_thresholds": { "split": 70, "design": 70, "plan_mode": 70, "security": 70 },
  "docs_governance": { "enabled": true, "companion_files": true, "docs_impact_routing": true, "write_governance": true, "severity_overrides": {} },
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
| `router_confidence_thresholds` | no | Per-flag confidence thresholds keyed by `split`, `design`, `plan_mode`, `security` (matches `route.confidence` keys); each defaults to `70` when absent |
| `docs_governance` | no | Nested object of flags/thresholds for companion-file, docs-impact-routing, and write-governance features (`enabled`, `companion_files`, `docs_impact_routing`, `write_governance`, `severity_overrides`); absent block = current behavior preserved (no dependent feature exists yet) |
| `docs_governance.enabled` | no | Emergency kill switch for the whole `docs_governance` block (default `true`); when `false`, every dependent feature is inert regardless of sub-field values |
| `docs_governance.companion_files` | no | Gates the future V-ADA companion-file reviewer audit (default `true`); when `false`, that audit is inert regardless of `enabled` — unimplemented as of this issue (see #172+/B5) |
| `docs_governance.docs_impact_routing` | no | Gates the future router `docs_impact` flag (default `true`); when `false`, that flag is inert regardless of `enabled` — unimplemented as of this issue (see B6) |
| `docs_governance.write_governance` | no | Gates future search-before-write/canonical-slug rules for consumer-repo writes (default `true`); when `false`, those rules are inert regardless of `enabled` — unimplemented as of this issue (see B7) |
| `docs_governance.severity_overrides` | no | Map of V-code → `BLOCK`\|`WARN`, keyed by docs-governance V-code; empty/absent = defaults apply. May only escalate a WARN-default docs-governance code to BLOCK — must never de-escalate the pre-existing `V-DOC-02`/`V-DOC-04` BLOCK severity |
| `worker_model_policy` | no | `cost-optimized` (default) — per-spawn model from role/track/route tier matrix, cheapest capable slug on current harness (`model-routing.md`); `inherit` — parent session model, no `model` override (v0.6.1 behavior) |
| `entry_mode` | no | `multitask` (default) — coordinator + orchestrator; `direct` = legacy single session |
| `merge_mode` | no | `immediate` (default) or `gated-batch` (ADR-005); preserves current behavior exactly when absent/default — each PR merges as soon as it reaches LGTM. `gated-batch` waits for all in-scope PRs (per `scope_milestone`/`scope_labels`) to reach LGTM, then merges one PR at a time in `merge_after` dependency order; see `merge-gate.md` |

**`docs_governance` contract note**: when the block is absent, or
`docs_governance.enabled` is `false`, every dependent feature (reviewer V-ADA
companion-file audit, router `docs_impact` flag, write-governance remedies —
none of which exist yet) MUST be a no-op and current behavior is preserved
exactly. Any future issue that wires a dependent feature must check this flag
(and its relevant sub-flag) before acting — the same obligation
`adaptive_routing` already imposes on router-agent routing.
`docs_governance.severity_overrides` may only **escalate** a WARN-default
docs-governance V-code to `BLOCK` per repo; it must never de-escalate the
pre-existing `V-DOC-02`/`V-DOC-04` `BLOCK` severity.

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

<!-- GENERATED by scripts/build.ts from src/references/config-template.md — do not hand-edit -->
