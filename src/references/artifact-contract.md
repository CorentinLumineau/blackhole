# Durable Artifact Contract (ADR-010 D5)

Per-route durable artifacts in the consumer repo, gated by
`docs_governance.write_governance` (absent or `false` ⇒ this entire contract is inert —
no route writes a `documentation/` artifact, no reviewer audits one; see
[doc-governance.md](doc-governance.md) for the kill switch), honoring search-before-write and
repo-convention precedence.

## Route → artifact table

| Route | Artifact |
|-------|----------|
| analyze | `documentation/audits/analysis-issue-N.md` |
| brainstorm | `documentation/brainstorms/{concern-slug}.md` |
| design (auto-approved or human-approved) | `documentation/decisions/ADR-{NNN}-{slug}.md` + `documentation/decisions/INDEX.md` row — schema (both the INDEX row shape and the ADR frontmatter shape) follows [doc-governance.md](doc-governance.md) § Repo Convention Precedence's detection |
| investigate | `documentation/investigations/{concern-slug}.md` |

## Delivery mechanism — who writes, who approves

The write-capable worker commits the artifact **inside the issue's PR** — never as a
separate write, never through the orchestrator:

- the investigator or planner writes the artifact at thinking time (the note lands in the
  same PR branch the route is already working);
- the implementer carries the note into the PR branch when the route reaches implement.

The reviewer audits the artifact like code — [doc-governance.md](doc-governance.md)'s
V-DOC-GOV-01..04 obligations and V-ADA-02 apply to it exactly as they apply to any other
diff. **Merge = approval**: there is no draft→final flip machinery, no orchestrator file
write, and no post-merge mutation. Once the PR merges, the artifact is final.

## Working copy vs. durable record

The gitignored `.blackhole/plans/` copy (see [blackhole-state.md](blackhole-state.md)) is
the working state used during the route's own turn — it is never the record of truth. The
`documentation/` copy committed in the PR is the durable record; only that copy is subject
to the doc-governance V-codes and only that copy survives campaign state rotation.
