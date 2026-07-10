---
type: plan
status: current
review_trigger: "on ADR acceptance"
created: 2026-07-10
last_updated: 2026-07-10
related:
  - documentation/decisions/ADR-006-kaizen-hunt.md
  - documentation/decisions/ADR-004-adaptive-phase-routing.md
---

# ADR-006 Kaizen Hunt — Campaign Implementation Plan

## Strategy

**Dogfood** (same pattern as the ADR-004 campaign): blackhole's own campaign implements
ADR-006. The 7 implementation steps are filed as forge issues with dependency links; the
campaign processes them through the adaptive pipeline. One PR per issue; `bun run build &&
bun run verify` green is an acceptance criterion on every issue. Filed as issues #197–#203 (2026-07-10); the DAG below maps step IDs to issue numbers.

## Issue DAG

```mermaid
flowchart LR
    K1["#197 schema + config<br/>kaizen block, ledger phase:hunt,<br/>hunt_state, hunter contract,<br/>V-HUNT-01/02 (size:s, P0)"]
    K2["#198 hunt kind refs<br/>quickwins + best-practices +<br/>coverage + filing template<br/>(size:m, P0)"]
    K3["#199 HUNTER AGENT<br/>+ build.ts + ground-truth<br/>+ model-routing (size:m, P1)"]
    K4["#200 orchestrator dispatch<br/>SKILL hunt mode, triggers,<br/>filing/dedup/watermark,<br/>campaign-complete (size:m, P1)"]
    K5["#201 LAUNCH FORM<br/>coordinator gate: issue preview,<br/>merge_mode leave-open, merge_after,<br/>parallelism + kaizen (size:m, P1)"]
    K6["#202 refactor + bug kinds<br/>blast-radius effort, severity floor,<br/>design-track disposition e2e<br/>(size:s, P2)"]
    K7["#203 protocol docs + audit<br/>blackhole-protocol hunt section,<br/>F-code, dashboard row (size:s, P2)"]
    K1 --> K2 --> K3 --> K4
    K1 --> K3
    K1 --> K5
    K4 --> K6
    K4 --> K7
    K5 --> K7
```

Parallelizable waves (respecting `parallel_max`): **W1** #197 → **W2** #198, #201 → **W3** #199 →
**W4** #200 → **W5** #202, #203.

K5 (#201) depends only on K1 (#197) (the `kaizen` config fields it asks about) and touches
`coordinator.md` + `config-template.md` + `phase-loop.md`'s merge protocol — it
parallelizes with the hunter-side work.

## Execution Assignments

Per blackhole protocol: `planner` (sonnet) plans each issue, `implementer` (sonnet) builds
in an isolated `wt-<issue>` worktree on `blackhole/issue-N` branches, `reviewer` (sonnet)
audits each PR with V-codes, orchestrator merges on LGTM. Worker tiers pinned by agent
definitions — no session-model inheritance.

## Codebase Conventions (integration touchpoints)

| Touchpoint | Convention | Source |
|------------|------------|--------|
| Edit surface | `src/` only; every platform tree is a build output of `bun run build` | `ARCHITECTURE.md` |
| Agent registration | `scripts/build.ts` agent lists + `ground-truth.md` counts (agent_count 7 → 8, skill_mode_count 7 → 8, vcode_table_rows 41 → 43) | `scripts/build.ts`, `src/references/ground-truth.md` |
| Worker handoff | Hunter output contract added to `src/references/worker-schemas.md`, consistent with existing worker-JSON shapes | `worker-schemas.md` |
| Config gating | `kaizen` block copies the `docs_governance` contract note verbatim: absent block or `enabled: false` = current behavior preserved exactly | `src/references/config-template.md` |
| State mutations | `.tmp` + `mv` atomic writes, `jq empty` validate, `refreshed_at` bump, ledger dedup key; `hunt_state` follows the `routing_decisions[]` sibling-block precedent | `blackhole-state.md`, `findings-ledger.md` |
| Issue filing | `gh issue create … $(bun scripts/forge-scope.ts create-args)` + `deferred_to_issue` linkage — the existing discovery-filing path, no new filing code | `forge-sync.md`, `phase-loop.md` |
| Agent sandbox | `hunter` is read-only (`disallowedTools: [Write, Edit, Delete]` except own wave note), mirroring `investigator.md` | `src/agents/investigator.md` |

## Risks

| Risk | Mitigation |
|------|------------|
| Ledger `phase` enum extension breaks existing consumers | K1 includes a consumer sweep for `phase` switch/match sites as an acceptance criterion; lands before anything produces `phase: hunt` rows |
| K4 (dispatch) proves too large for one PR | Blackhole's own split gate applies — expected split: trigger plumbing vs filing protocol |
| Hunter gain/effort miscalibration floods or starves filings | Calibration tables in K2/K5 carry worked examples per band; `min_priority` tunable upward; first activated campaign runs with `max_issues_per_wave: 10` and human spot-audit of ledger scores |
| Drift from ADR-006's verified decisions (e.g. a second scoring formula sneaks into a kind ref) | Every issue body cites the ADR §; reviewer audits plan-conformance; the SSOT rule is stated in each kind reference |
| `every-n-loops` trigger interacts badly with `merge_mode: gated-batch` | K4 acceptance criterion: wave dispatch is a no-op while a gated batch is mid-merge (merge-gate § 4 sequence is never interleaved with filings) |

## Companion Hardening Batch (mercure imports, filed 2026-07-10)

Scored with the campaign's own gate (`Priority = Gain × (11 − Effort) ≥ 30`) after filtering
capabilities blackhole already has (V-SEC-06/07 adversarial security validation, Scout
Check, anti-slop codes, worktree hygiene, checkpoint/recovery, ADR-004's investigator
hypothesis spec). Independent of the K-issue DAG — parallelizable any time:

| Issue | Import | Priority |
|-------|--------|----------|
| #204 | Verification-evidence gate in implementer (RUN/READ/VERIFY before claim) | 72 |
| #205 | Confidence-based finding filtering + root-cause consolidation in reviewer | 63 |
| #206 | Error classification (Transient/Permanent/Partial) + Failed-Approaches log | 56 |
| #207 | Suggestion-proportionality gate; out-of-diff observations feed kaizen | 45 |

Evaluated and **deferred** (borderline, revisit after the hunt capability proves itself):
adversarial critics panel for design-track plans (42), cross-correlation severity promotion
(40 — only applies where dual scans exist; single reviewer per PR since ADR-003),
post-compact recovery hook (36 — checkpoint-protocol covers most), escalation-registry
formalization (36 — model-routing.md covers the intent). Rejected: structural-output guard
hook (24 — orchestrator already validates worker JSON), post-edit format/typecheck hooks
(32 — consumer-repo tooling varies; review catches it).

## Success Criteria

- [ ] All 7 issues merged, each via its own reviewed PR with `Closes #N` linkage
- [ ] `bun run build && bun run verify` green at every merge; ground-truth counts updated in the same PRs that change them
- [ ] Agent roster = 8 across all build targets; `hunt` mode present in SKILL.md modes table
- [ ] With `kaizen.enabled: true, trigger: on-empty` on a test repo: draining the queue triggers a hunt wave, files ≥1 `[Kaizen]` issue with `deferred_to_issue` ledger linkage, auto-sync ingests it, and it flows handle → merge unmodified
- [ ] A hunted `size:l` refactor finding routes into the design track (`needs_design`) end-to-end
- [ ] A `CRITICAL` bug finding files regardless of Priority score (severity floor observed)
- [ ] Launch form: a fresh bootstrap walks scope (with live issue-count preview), merge policy (all three modes offered, `leave-open` selectable), `merge_after` confirmation on gated-batch, parallelism, and kaizen — and persists the confirmed config before the orchestrator spawns
- [ ] `merge_mode: leave-open`: campaign completes with all PRs LGTM'd and open, `merged_by: blackhole` never set
- [ ] Campaign completes: territory exhausted / `max_waves` reached ends the loop; `enabled: false` reproduces pre-ADR-006 behavior exactly
