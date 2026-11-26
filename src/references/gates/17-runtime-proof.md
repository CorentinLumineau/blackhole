## Runtime Proof (`V-PROOF-01`)

**User-visible change** (defined here once): the diff alters behaviour someone outside this repo
can observe — a CLI, API or UI surface, or output a consumer repo sees. Docs, tests, this
repo's own agent and reviewer prompts (`src/agents/`, `src/references/`), and internal scripts
(`scripts/`) that no consumer-visible output depends on are not user-visible: no Proof.

**Run**: for a user-visible change, when the target repo has a project verification skill
(`.claude/skills/control-*`, or the run/verify skill the repo's `AGENTS.md` or `CLAUDE.md`
declares), invoke it on the changed behaviour and save its artifacts (screenshots, video,
logs) under `documentation/reviews/proof/issue-<N>/`. Reuse `visual_evidence[]` captures as
Proof screenshots rather than capturing twice (`V-INT-04`).

**PR body**: add a `## Proof` section listing commands run, artifact links and pass/fail. With
no verification skill, or a run that could not execute, write `unavailable: <reason>` — a
declared outcome, never a silent skip. The reason must name a concrete, checkable cause (e.g. `no verification skill found under .claude/skills/`); `n/a`, `none` or an empty reason is `V-PROOF-01`.

---
