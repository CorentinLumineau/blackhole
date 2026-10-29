## Visual Evidence Capture (conditional)

**Config gate**: read `.blackhole/config.json`. If `display_targets` is absent or an empty
array, skip this subsection entirely — no capture, no `visual_evidence[]` field, current
behavior preserved exactly (`config-template.md`'s `display_targets` contract note).

**Detection**: `route.ui` (from `<PLAN_CONTEXT>`) resolved `true` for this issue; when
`route.ui` is absent/unresolved, fall back to the frontend-detection keyword SSOT
(`scripts/detect-frontend.sh`, cited by `reviewer.md` § Companion-File Audit and § Information-Hierarchy Audit, not restated, `V-INT-02`).
Neither signal fires — skip this subsection, emit no `visual_evidence[]` field.

**Capture**: when both gates pass, after the Verification Evidence Gate's lint/test pass, run
the consumer repo's own Playwright/dev-server command once per width in `display_targets` —
blackhole ships no browser driver (`V-INT-02`); the worktree already has dependencies installed
(`phase-implement.md` checklist). Commit each viewport-clipped (not full-page) screenshot under
`documentation/reviews/visual-evidence/issue-<N>/<target>px-<route-slug>-<state>.png` and link
it in the PR body. Emit one `visual_evidence[]` entry per capture with `target`, `path`,
`route`, and `state` set (`implementer-schemas.md` § `visual_evidence[]`).

**Capture failure**: when no runnable Playwright/dev-server stack exists, emit a
`capture_status: "unavailable"` entry with an explicit `note` stating why —
never silently skipped (R5). A capture failure is **never** a `status: blocked` return on this
basis alone; it is a declared, non-blocking-at-implement outcome that the reviewer's Visual
Evidence Audit (`reviewer.md` § Visual Evidence Audit) turns into a `V-VIS-02` WARN finding, not a stalled campaign.

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

