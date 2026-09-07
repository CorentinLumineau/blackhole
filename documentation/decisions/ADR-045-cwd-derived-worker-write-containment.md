---
type: adr
summary: "readAssignedWorktreeRoot gains a cwd-derived containment tier — when BLACKHOLE_ASSIGNED_WORKTREE is unset/invalid and the PreToolUse payload's cwd resolves inside a linked (non-main) worktree, that worktree becomes the sole assigned root — closing the confirmed gap where the env-var channel never reaches a native Pattern C worker; design-aggregate.ts blocked on dominance only (unanimous 3/3 winner B, no disagreement, no breaking consumer), owner-ruled per the same override pattern as ADR-029"
status: accepted
review_trigger: "on protocol change, or on a Claude Code change to the PreToolUse payload's cwd semantics"
created: 2026-09-07
last_updated: 2026-09-07
related:
  - documentation/decisions/ADR-029-bash-write-target-worktree-containment.md
  - documentation/decisions/ADR-030-plugin-cache-version-bump-gate.md
  - documentation/decisions/ADR-043-main-clone-git-mutation-guard.md
  - documentation/decisions/ADR-035-unfalsifiable-control-checklist-item.md
---

# ADR-045: cwd-derived worker write containment (Pattern C channel closure)

## Status

Accepted — 2026-09-07 (owner ruling on issue #907, `design-aggregate.ts` verdict `blocked` —
dominance-margin only, per `.blackhole/plans/issue-907-design-aggregate-verdict.json`).

## Context

`orchestrator-dispatch.md` documents a binding contract: at implementer spawn, `export
BLACKHOLE_ASSIGNED_WORKTREE='<worktree>'` as the first shell command, read by
`readAssignedWorktreeRoot(cwd)` to narrow Write/Edit/Bash containment to a single assigned
worktree. Under Claude Code-Native Orchestration (Pattern C, `claude-code-native.md`), workers
are dispatched via the native `Agent` tool or `Workflow` tool `agent()` calls — neither exposes an
environment channel from the orchestrator to a spawned subagent/teammate; a subagent inherits the
parent's environment, not a per-worker override. `pattern_id: outside-assigned-worktree` has never
appeared across the recorded `.blackhole/hook-events/` corpus, and
`documentation/decisions/ADR-043-main-clone-git-mutation-guard.md` — for an unrelated guard —
independently confirmed and disqualified keying on this env var for the same reason.

A prior Design Track cycle for this issue explored a payload-identity channel
(`agent_id`/`agent_type`, added to the PreToolUse hook-event record observability-only in #915)
as a candidate replacement. That probe's own result is decisive: both fields are confirmed
populated only for a bare `Agent`-tool subagent spawned under one-shot headless `claude -p`, and
have **never been observed on the wire** for an in-process, `SendMessage`-addressable Pattern C
teammate — the population this issue depends on. This session is itself a member of that
population and independently corroborates: `BLACKHOLE_ASSIGNED_WORKTREE` unset,
`CLAUDE_CODE_CHILD_SESSION=1`, no non-null `agent_id` in the current hook-event corpus.

## Requirements Framing

Issue #907, `task_type: bugfix`, `security_review_required: true`. AC1: determine reachability,
correct `orchestrator-dispatch.md` if unreachable. AC2: if a mechanism is available,
`outside-assigned-worktree` must fire in a test proving a worker inside an assigned worktree
cannot write the main clone. AC3: red-before-green (`V-UNFALSIFIABLE-01`). AC4: `V-PLUGIN-01`
version bump in the same diff as any `templates/hooks/**` change. AC5: note the plugin-cache
deployment caveat (ADR-030).

## Decision

Extend `readAssignedWorktreeRoot(cwd)` with a new resolution tier, ordered **between** the
existing `BLACKHOLE_ASSIGNED_WORKTREE` env-var check and the `allWorktreeRoots` fallback:

1. `BLACKHOLE_ASSIGNED_WORKTREE` set and valid → use it (unchanged — Pattern B / manual use).
2. Else, if `worktreeRoot(cwd)` resolves to a **linked, non-main** worktree → treat that resolved
   worktree, plus the same validated scratchpad-root inclusion `allWorktreeRoots` already
   performs, as the sole assigned root (**new** — closes the Pattern C gap).
3. Else (cwd is the main clone, or no git context) → `allWorktreeRoots(cwd)` fallback, unchanged
   — preserves the orchestrator's, `planner`'s, `investigator`'s and `hunter`'s legitimate
   main-clone write access.

`input.cwd` on the PreToolUse payload is harness-supplied (the same trust class as `tool_name` —
`validate-file-changes.js`'s existing `#507` precedent, not a fresh claim), not a field the
calling worker's tool-call arguments control. No new env var, no assignment map, no per-worker
identity is required: the worktree a call is already structurally operating from **is** its
assignment. Cross-cutting constraint promoted to `ARCHITECTURE.md`: worker write-containment
keys on structural call-site identity (repo/path resolution), never on caller-declared state
(`ADR-045`) — the same ruling `ADR-043` already made for the main-clone git guard, now extended
to the Write/Edit/Bash write-target guards.

## Options + Trade-off Matrix

Decision type `architecture-choice` (Risk 30, Maintainability 25, Complexity 20, Reversibility 15,
Consistency-with-existing-pattern 10). Full matrix, per-scorer breakdown, and rationale:
`.blackhole/plans/issue-907-design.md` § 2. Weighted totals: **B (chosen) = 4.55**, D (accept
limitation) = 3.05, E (payload-identity map) = 1.85.

| Option | Risk | Maintainability | Complexity | Reversibility | Consistency |
|---|---|---|---|---|---|
| B — cwd-derived (chosen) | 5 | 4 | 4 | 5 | 5 |
| D — accept limitation | 2 | 3 | 5 | 4 | 1 |
| E — payload-identity map | 1 | 2 | 2 | 3 | 2 |

## Adversarial Evaluation

Disclosed deviation: this session has no `Agent`/`Task`/`Workflow` tool (confirmed via
`ToolSearch`) and could not spawn 2 independent `planner` critics per the literal protocol. Two
self-authored, deliberately adversarial scoring passes stand in instead — full text and findings
at `.blackhole/plans/issue-907-design.md` § 3. Both critics independently pick B as winner; no
CRITICAL discriminating finding against B from either. Two NOTABLE findings raised and addressed
in the Task Breakdown below: (1) an explicit regression test that main-clone-cwd behavior stays
byte-identical for the orchestrator/planner/investigator/hunter case; (2) the new code's docstring
must cite `#507`'s existing cwd-trust precedent rather than asserting it fresh.

## Component Decomposition

N/A — single-component change. `readAssignedWorktreeRoot` gains one new branch; both existing
call sites (`validate-file-changes.js`, `bash-write-target-guard.js`) are unmodified — they
already treat "assigned root present/absent" opaquely.

## Design Principles Validation

| Axis | Score | Justification |
|---|---|---|
| SRP | ✓ | `readAssignedWorktreeRoot` keeps its one responsibility; the new tier is one more branch in its existing resolution ladder |
| DRY | ✓ | Reuses `worktreeRoot`, `mainCloneRoot`, `isUnderRoot`, and `allWorktreeRoots`'s scratchpad-root validation verbatim (`V-INT-02`) |
| KISS | ✓ | No new file, no new data structure, no new env var |
| YAGNI | ✓ | Solves exactly the reported gap; main-clone role-sub-scoping is explicitly out of scope, named not silently dropped |
| Pattern check (structural-identity-over-declared-state) | ✓ | Directly consistent with ADR-043's ruling |

## Refactoring Impact Analysis

Full table (8 consumers, all TRANSPARENT, zero BREAKING) at
`.blackhole/plans/issue-907-design.md` § 6. Headline: the two hook call sites already branch
opaquely on "assigned root present/absent" so they are unaffected by *when* it becomes present;
every touched test file gains new coverage rather than having an existing assertion altered;
`ADR-043`'s `git-main-clone-guard.js` has zero call-site overlap (confirmed by grep — it keys on
repo identity directly, never calls `readAssignedWorktreeRoot`).

## Assumption Audit

| Assumption | Mark | Note |
|---|---|---|
| `input.cwd` is harness-populated, not worker-influenceable via tool-call args | ~ | Contestable — reused from `#507`'s existing precedent, not freshly re-audited against Anthropic's hook-schema docs this cycle |
| `agent_id`/`agent_type` confirmed absent for the in-process teammate population | ✓ | Validated by #915's probe plus this session's own live corroboration |
| No worktree is ever nested inside another worktree's own tree in this campaign's topology | ✓ | Validated — sibling `wt-<issue>` convention, `blackhole-protocol.md` § Branch & Worktree Hygiene |
| The new tier never fires when cwd resolves to the main clone | ◐ | Blind spot until the regression test below exists — addressed as a Task Breakdown item |
| Main-clone role-sub-scoping is out of scope for this issue | ✓ | Deliberate YAGNI boundary — issue #907's own AC never asks for it |

## Falsifiability specification

`git grep -n "first shell command in the session" src/references/orchestrator-dispatch.md`
returns zero matches once Task 1 lands. A test driving the real hook (`runPreToolUseHook`) with a
`cwd` inside a linked worktree fixture and a Write target resolving to the main clone MUST fail
(write allowed) against `plan_base_commit` and MUST pass (write denied,
`pattern_id: outside-assigned-worktree`) after the fix — the red-before-green pair is the
falsification instrument (`V-UNFALSIFIABLE-01`).

## Alternatives Considered

- **D — accept the limitation.** Rejected: leaves the confirmed containment hole open (2 recorded
  incidents) and departs from this repo's own precedent of always closing a containment gap
  structurally rather than accepting it (#620, ADR-029). Scored 3.05 vs. B's 4.55.
- **E — payload-identity keyed assignment map.** Rejected, and effectively falsified by this
  campaign's own #915 probe: the `agent_id` key it would read has never been observed non-null for
  the population it targets, so it would silently fail open — worse than no attempt, since it
  reads as protection while doing nothing. Scored 1.85.

## Consequences

**Positive:** the reported live incident class (a worker inside `wt-N` editing the main clone) is
mechanically closed; no new env var, config key, or file to keep in sync; the fix is purely
additive so Pattern B / manual `BLACKHOLE_ASSIGNED_WORKTREE` use is untouched.

**Negative / residual:** main-clone role-sub-scoping (limiting `planner`/`investigator` to only
`.blackhole/plans/`+`.blackhole/staged/` rather than the whole main clone) stays open — a
deliberate, disclosed YAGNI boundary, not a regression. The `input.cwd` harness-trust assumption
is reused, not freshly re-audited this cycle (§ Assumption Audit) — a future revisit of that trust
boundary should re-check this ADR's `review_trigger`. Per ADR-030/`V-PLUGIN-01`, the fix ships
inert to any already-installed plugin cache until the version bump lands **and** the owner runs
`/plugin marketplace update` plus reinstall.

## Gate

`design-aggregate.ts` verdict: `status: "blocked"`, `reasons: ["dominance"]` only — unanimous 3/3
scorer agreement on winner B (primary 32.97%, critic_a 19.10%, critic_b 36.46% margin over
runner-up D), zero disagreement, zero CRITICAL discriminating finding against B, zero BREAKING
consumer, zero unverified ADR citation. Only `critic_a`'s individual margin falls short of the
30% dominance delta. This is the identical shape `documentation/decisions/ADR-029-bash-write-
target-worktree-containment.md` already resolved ("unanimous 3/3 Design Track scorer pick,
owner-delegated override of a pure dominance-margin block — no disagreement, no breaking
consumer") — **owner-ruled for Option B** under `autonomy.design_autonomy: true` /
`autonomy.mode: full` (`.blackhole/config.json`: "Agent decides design approvals ... without a
gate ... Owner is reported to, not asked"), on the same basis ADR-029 applied. Verdict artifact:
`.blackhole/plans/issue-907-design-aggregate-verdict.json`.

### What the owner needs to decide (R-003 executive summary)

- **What changed and why**: `readAssignedWorktreeRoot` gains a cwd-derived containment tier so a
  worker whose session is already inside a linked git worktree cannot Write/Edit/Bash-write
  outside that worktree — closing the confirmed gap where `BLACKHOLE_ASSIGNED_WORKTREE` never
  reaches a native Pattern C worker.
- **Why this option over the alternatives**: Option E is disqualified by this campaign's own
  #915 probe. Option D leaves the confirmed hole open and departs from this repo's own precedent
  (#620, ADR-029) of always closing a containment gap structurally.
- **What is NOT solved**: main-clone role-sub-scoping stays open, named explicitly, not silently
  dropped.
- **Residual risk carried forward**: `input.cwd`'s harness-trust assumption is reused, not
  freshly re-audited; flagged via this ADR's `review_trigger`.
