# Worker Model Routing

Cost-optimized model selection for campaign subagent spawns. Goal: **lowest total backlog
execution cost** by matching each spawn to the **cheapest harness model that is still capable
enough for that specific task** — not a blanket “always fastest” or “always most powerful”
default.

Configured in `.blackhole/config.json`:

| `worker_model_policy` | Behavior |
|-----------------------|----------|
| `cost-optimized` | **Default.** Resolve model per spawn from role + route signals (tables below). |
| `inherit` | Workers inherit the parent session model — omit `model` on spawn (v0.6.1 behavior). |

When the field is absent, treat as `cost-optimized`.

## Resolution algorithm

Before every worker spawn:

1. Read `worker_model_policy` from `.blackhole/config.json`.
2. If `inherit` → omit `model`.
3. If `cost-optimized`:
   1. Determine **task tier** from § Task-tier matrix (role + route + escalation signals).
   2. Pick the **first** slug in the harness § Tier ladder for that tier that the harness
      accepts on spawn.
   3. Never read `model:` from agent markdown (`V-AGENT-01`).

**Escalation rule:** when a worker returns `status: blocked` with `escalation_trigger`, the
*next* spawn for the same issue and role bumps one tier (`economy → standard → premium`). Cap
at `premium`; do not escalate past harness top tier.

## Task-tier matrix

Minimum tier per spawn. Start at the listed tier; apply **all** matching bump rows (max wins).

### Base tier by role and track

| Spawn | Base tier | Rationale |
|-------|-----------|-----------|
| `router` | `economy` | One-pass classification (ADR-004 cheapest-capable discipline) |
| `investigator` (`sub_mode: investigate`) | `economy` | Read-only evidence scan |
| `planner` + `track: skip` | `economy` | Deterministic rationale template |
| `planner` + `track: quick` or `track: standard` (default self-assess) | `standard` | Structured planning, touch-paths |
| `planner` + `track: design` | `premium` | Architecture / trade-off analysis |
| `implementer` | `standard` | TDD implementation in worktree |
| `reviewer` | `standard` | Plan-conformance + quality audit |
| `orchestrator` (background) | `standard` | Coordinate-only — no direct codegen |
| `hunter` | `standard` | Scan quality is the product (ADR-006 § Components) — haiku hunters were the noise source mercure's confidence-filtering machinery exists to clean up after, so `hunter` deliberately skips the `economy` tier `investigator`'s read-only-scan precedent would otherwise suggest |

### Route-derived tier bumps (`queue.json` `route{}`)

Apply after base tier. Take the **maximum** tier when multiple rows match.

| Signal | Affected spawns | Bump to |
|--------|-----------------|---------|
| `route.security_review_required: true` | `implementer`, `reviewer` | `premium` |
| `route.needs_design: true` | `planner` (already `premium` via design track) | — (no-op) |
| `route.plan_mode: full` + `route.confidence.plan_mode` ≥ threshold | `planner` | `standard` (already default) |
| Issue label `size:xl` | `implementer` | `premium` |
| Issue label `size:l` | `implementer` | `standard` (already default) |
| `review_iteration` ≥ 3 on queue entry | `reviewer`, next `implementer` respawn | `premium` |

### Tier ordering

`economy` < `standard` < `premium` (cheapest capable → most capable).

## Harness tier ladders

Each tier lists slugs **cheapest first** within the tier. Pick the first slug the harness
accepts.


### Claude Code

| Tier | Model families (cheapest → most capable within tier) |
|------|--------------------------------------------------------|
| `economy` | Haiku (latest) |
| `standard` | Sonnet (latest) |
| `premium` | Opus (latest) |

Use harness-native identifiers; prefer latest version in each family.

## Orchestrator integration

When spawning workers, the orchestrator must pass **both**:

1. **Track directive** (existing ADR-004 § Route-derived dispatch) — e.g. `track: design`
2. **Resolved `model`** (this doc) — from task-tier matrix + harness ladder

`planner` spawns: tier derives from `track` + `route{}` flags, not from implementer defaults.
`implementer` / `reviewer` spawns: tier derives from role + security/size/review_iteration.

Log the resolved tier in the spawn prompt footer (orchestrator scratchpad only — not
`queue.json`) for cost audit:

```
MODEL_TIER: standard | slug: claude-sonnet-5-thinking-high
```

## Workflow-tool enforcement

On a harness fan-out via a native deterministic orchestration primitive (Pattern C, capability C1
— see [claude-code-native.md](claude-code-native.md)), every `agent()` call in the fan-out script
**MUST** pin both `agentType` and `model` explicitly. Background execution does not inherit the
session model — an unpinned call silently defaults away from the cheapest-capable tier this doc
specifies.

Per-agentType pin table — maps the **existing** tiers from § Task-tier matrix above, no new tier
and no alternate formula:

| `agentType` | Tier |
|---|---|
| `router` | `economy` |
| `investigator` | `economy` |
| `planner` (`track: quick` or `track: standard`) | `standard` |
| `implementer` | `standard` |
| `reviewer` | `standard` |
| `hunter` | `standard` |
| `planner` (`track: design`) | `premium` |
| security / `size:xl` bump (per § Route-derived tier bumps) | `premium` |

This table is a pin-time restatement of § Task-tier matrix / § Harness tier ladders above, not a
second source — resolve the tier from those tables first, then pin the resolved `model` on the
`agent()` call.

## Spawn checklist

```
- [ ] Read worker_model_policy (default: cost-optimized)
- [ ] If inherit → omit model
- [ ] Else resolve task tier from role + track + route{} + escalation bumps
- [ ] Pick cheapest slug in harness ladder for that tier
- [ ] Classification agents (router, investigator) → economy unless escalated
- [ ] Design planner → premium; skip planner → economy; implementer → standard (+ bumps)
```

See `orchestrator.md` § Worker spawn model and `campaign-prompt.md` § Coordinator usage.
<!-- GENERATED by scripts/build.ts from src/references/model-routing.md — do not hand-edit -->
