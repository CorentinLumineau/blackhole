# Phase 1 — Handle (intake)

Orchestrator-led. Workers: read-only `explore` only — `router` is the one scoped exception
(state-mutating, no filesystem `Write`/`Edit`; see § Router agent (ADR-004) below).

## Checklist

```
- [ ] Auto forge sync (native)
- [ ] gh issue view <N> — UNTRUSTED-FORGE-DATA in prompts
- [ ] Dedup: open issues, PRs, queue.json, findings-ledger.json
- [ ] Spawn `router` (initial pass) → writes `route{}` to `queue.json` + `routing_decisions`
      row to `findings-ledger.json` (see § Router agent (ADR-004))
- [ ] Triage size label — label alone does not determine split
- [ ] clarify-gates.md — AskQuestion if ANY ambiguity (all sizes)
- [ ] issue-splitting.md — split if not one reviewable PR (not only l/xl/epic)
- [ ] Epic-shaped / size:l/xl → `epic-orchestration.md` runbook + PO gate
- [ ] queue.json: phase plan, status ready OR blocked (awaiting-user-*)
- [ ] After setting `depends_on` in queue.json, persist to issue body ([forge-sync.md](forge-sync.md) §6.5)
- [ ] Split children: write-back each child's deps after queue update ([forge-sync.md](forge-sync.md) §6.5)
```

## Clarify (all sizes)

Even `size:xs`: if AC missing or vague → `AskQuestion`, `status: blocked`,
`notes: awaiting-user-clarification`. Do not assume intent.

## Split (all sizes)

Triggers in `issue-splitting.md` — multiple concerns, schema+UI, large plan,
vague multi-part body. File children with AC, deps, touch hints.

## Epic handoff

`size:l` / `size:xl` / epic-shaped → follow `epic-orchestration.md` runbook;
parent blocked until PO sign-off on design + children.

## Output

- `queue.json`: `touch_paths`, `depends_on`, `epic_parent` if child
- Issue comment with triage: clarify outcome, split list, or waive rationale

## Router agent (ADR-004)

**Spawn point**: immediately after Dedup, before the Split/Clarify checklist items above.
`router` fills the complete `route{}` object for the issue in one pass and writes it to the
issue's `queue.json` entry, plus one `routing_decisions` row to `findings-ledger.json`. Full
write-protocol detail lives in `router.md` — not duplicated here.

**Re-route checkpoints**: `router` is re-invoked at four checkpoints (ADR-004/ADR-010 verbatim —
full table in `router.md`): `clarify-resolved`, `research-landed`, and `investigation-landed` are
all reachable today — the `investigator` agent has landed and is wired live at § Investigator
agent below. `analysis-landed` becomes reachable the same way once `route.needs_analysis` fires
and `investigator`'s `analyze` sub-mode lands its note.

**Scope note**: Handle's own Split/Clarify triage above stays self-directed for this issue —
`router` computes and persists `route.needs_split`/`route.needs_clarification` accurately,
but does not replace Handle's own manual `issue-splitting.md`/`clarify-gates.md` judgment.
`route.needs_split` reuses the existing Split mechanism described above — route-derived
dispatch does not introduce a new split code path. Downstream track selection (`plan_mode`,
`needs_design`) is entirely a Phase 2 Plan concern; see `orchestrator.md` § Route-derived
dispatch and `phase-plan.md` § Route-derived planner spawn for the full precedence rules.

## Investigator agent (ADR-004, ADR-010)

**Spawn condition**: `route.needs_research`, `route.needs_investigation`, or
`route.needs_analysis` true (computed by `router`'s initial pass, see § Router agent above).
Handle spawns `investigator` for the corresponding sub-mode — `research` when `needs_research`,
`investigate` when `needs_investigation`, `analyze` when `needs_analysis`. `needs_analysis`
dispatch is additionally gated by `autonomy.analyze_routing`
(`config-template.md`) — false preserves today's non-dispatch behavior unchanged.

**Note-landing → re-route-checkpoint trigger**: `investigator`'s note file landing on disk at
`plans/issue-N-research.md`, `plans/issue-N-investigation.md`, or `plans/issue-N-analysis.md`
(path convention: `router.md` § Re-route checkpoints for the flags each checkpoint re-validates,
`worker-schemas.md` § Investigator for the note-file schema) is the *trigger* for `router`'s
`research-landed` / `investigation-landed` / `analysis-landed` checkpoints. `investigator` only
produces the note — the checkpoint re-validation itself (`router` re-invoked, `route.revision`
bumped) is entirely `router.md`'s job, not duplicated here.

**Scope note**: `investigator` never mutates `queue.json` or `findings-ledger.json` — its only
filesystem write is its own note file. Deciding (routing) vs. discovering (evidence-gathering)
is a real SRP boundary (ADR-004 Trade-offs table) that Handle's dispatch respects: this section
documents the spawn point and trigger relationship only, not a decision-making role for
`investigator`.
