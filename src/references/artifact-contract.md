# Durable Artifact Contract (ADR-010 D5)

Per-route durable artifacts in the consumer repo, gated by
`docs_governance.write_governance` (absent or `false` ⇒ this entire contract is inert —
no route writes a `documentation/` artifact, no reviewer audits one; see
[doc-governance.md](doc-governance.md) for the kill switch), honoring search-before-write and
repo-convention precedence.

## Canonical folder taxonomy

Eleven folders under a consumer repo's `documentation/` tree — created on first write, never
pre-seeded as empty placeholders:

| Folder | Typical `type` values | Primary routes / notes |
|--------|----------------------|------------------------|
| `audits/` | `analysis` | `analyze` route |
| `brainstorms/` | `brainstorm` | `brainstorm` route |
| `decisions/` | `adr` | `design` route (+ per-folder `INDEX.md`) |
| `investigations/` | `analysis` | `investigate` route |
| `plans/` | `plan` | `plan` route (ADR-021 D3) |
| `reviews/` | `review` | `review` route (ADR-021 D3) |
| `assessments/` | `analysis`, `reference` | feasibility / go-no-go notes (mercure parity) |
| `runbooks/` | `runbook` | operational procedures (mercure parity) |
| `architecture/` | `reference` | long-form narratives paired with root `ARCHITECTURE.md` |
| `reference/` | `reference` | owner rulings (`product-principles.md`), stable lookup docs |
| `milestones/` | `reference`, `plan` | initiative tracking; `_archived/` holds curated deprecated docs |

Root `documentation/INDEX.md` indexes every live doc across these folders (see
[doc-governance.md](doc-governance.md) § INDEX.md Maintenance). `decisions/` keeps its own
per-folder `INDEX.md` with ADR-specific column conventions.

## Route → artifact table

| Route | Artifact |
|-------|----------|
| analyze | `documentation/audits/analysis-issue-N.md` |
| brainstorm | `documentation/brainstorms/{concern-slug}.md` |
| design (auto-approved or human-approved) | `documentation/decisions/ADR-{NNN}-{slug}.md` + `documentation/decisions/INDEX.md` row — schema (both the INDEX row shape and the ADR frontmatter shape) follows [doc-governance.md](doc-governance.md) § Repo Convention Precedence's detection |
| investigate | `documentation/investigations/{concern-slug}.md` |
| plan | `documentation/plans/plan-{concern-slug}.md` (or `documentation/plans/{concern-slug}.md` when the issue title already carries a `Plan` prefix — see `scripts/lib/concern-slug.ts`) + root `documentation/INDEX.md` row — **unconditional** on every issue that reaches Phase 2 plan (Quick, Standard, Skip rationale records included) |
| review | `documentation/reviews/review-{concern-slug}.md` + root `documentation/INDEX.md` row — **unconditional** at merge-readiness; body synthesized from `findings-ledger.json` rows for `issue_ref`, not reviewer prose (ADR-021 A2) |

**Cross-cutting side artifact**: independent of the primary artifact above, `planner.md` §4.8
Trigger A (`design` route) and Step 4 Trigger B (seeded from an `analyze` note, any track) may
additionally stage an `ARCHITECTURE.md` `## Active Constraints` bullet through the identical
staging mechanism below — `target_path: "ARCHITECTURE.md"` at the repo root, rather than under
`documentation/` (ADR-012 E3, issue #474; schema: `blackhole-state.md` § Staging).

## Delivery mechanism — who writes, who approves

The write-capable worker commits the artifact **inside the issue's PR** — never as a
separate write, never through the orchestrator:

- the investigator or planner writes the artifact at thinking time, but no PR branch
  exists yet at that point — the artifact is staged instead, to
  `.blackhole/staged/<issue>/`, per [blackhole-state.md](blackhole-state.md) § Staging
  (ADR-021 D1);
- the implementer's Carry Staged Artifacts step copies each staged entry into its
  `documentation/` target and commits it inside the issue's own PR once the route reaches
  implement — see `implementer.md` § Carry Staged Artifacts for the copy/rewrite mechanics
  (not restated here).

The reviewer audits the artifact like code — [doc-governance.md](doc-governance.md)'s
V-DOC-GOV-01..04 obligations and V-ADA-02 apply to it exactly as they apply to any other
diff. **Merge = approval**: there is no draft→final flip machinery, no orchestrator file
write, and no post-merge mutation. Once the PR merges, the artifact is final.

## Working copy vs. durable record

The gitignored `.blackhole/plans/` copy (see [blackhole-state.md](blackhole-state.md)) is
the working state used during the route's own turn — it is never the record of truth. The
`documentation/` copy committed in the PR is the durable record; only that copy is subject
to the doc-governance V-codes and only that copy survives campaign state rotation.
