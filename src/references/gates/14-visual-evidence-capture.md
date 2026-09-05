## Visual Evidence Capture (conditional)

**Config gate**: read `.blackhole/config.json`. If `display_targets` is absent or an empty
array, skip this subsection entirely — no capture, no `visual_evidence[]` field, current
behavior preserved exactly (`config-template.md`'s `display_targets` contract note).

**Detection**: `route.ui` (from `<PLAN_CONTEXT>`) resolved `true` for this issue; when
`route.ui` is absent/unresolved, fall back to the frontend-detection keyword SSOT
(`scripts/detect-frontend.sh`, cited by `reviewer.md` §§10/14, not restated, `V-INT-02`).
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
Evidence Audit (`reviewer.md` §22) turns into a `V-VIS-02` WARN finding, not a stalled campaign.
