---
type: plan
status: current
review_trigger: "on release"
created: 2026-09-02
last_updated: 2026-09-02
related:
  - documentation/plans/plan-retrospective-v0.21.0-remediation.md
  - documentation/architecture/retrospective-blackhole.md
  - documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md
---

# Plan - Issue #712

## Objective
Close the RC-E self-disclosure gap named in the v0.21.0 retrospective
(`documentation/architecture/retrospective-blackhole.md` §§ Phase 2 RC-E, Phase 3 P8, item R-09
of the epic, child of #703): PR #408 knowingly reversed ADR-007's R3′ decision ("no file split"
for `orchestrator.md`) but recorded that reversal only in a gitignored plan file
(`.blackhole/plans/issue-366.md`), never in ADR-007 itself or `documentation/decisions/INDEX.md`.
This issue (1) records that specific reversal as a dated ADR-007 amendment, (2) gives future
plans a declared `supersedes_adr` field to make the *same* kind of reversal self-disclosing, (3)
adds a two-legged machine check (`V-ADR-06`) that catches both a declared-but-unstamped reversal
and an undeclared one written straight into tracked prose, and (4) gives the `docs` kaizen hunt
kind a third band that catches the #408 shape specifically — an undisclosed reversal recorded
only in a local, gitignored plan file.

## Touch-Paths
- `documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md`
- `documentation/decisions/INDEX.md`
- `src/references/plan-template.md`
- `src/agents/implementer.md`
- `scripts/checks/adr-supersession.check.ts` (new)
- `scripts/verify.adr-supersession.test.ts` (new)
- `src/references/blackhole-vcodes.md`
- `src/references/hunt/docs.md`
- `scripts/lib/build/facts.ts`

## Documentation Impact
`documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md` gains a new `## Post-acceptance
amendments` section (one dated entry recording R3′'s reversal by #408) and
`documentation/decisions/INDEX.md`'s ADR-007 row summary gains a short clause pointing at it —
both direct edits inside this plan's own Touch-Paths, not a downstream consumer doc. No new
`documentation/` file is created by this issue.

## Task Breakdown
- [ ] **ADR-007 — Post-acceptance amendments**: append a `## Post-acceptance amendments` section
  after `## References` with one dated entry recording R3′'s reversal by #408, accepted on
  condition the split-off files are budgeted (R-02/#705), citing `retrospective-blackhole.md` §
  RC-E for the detection-gap context. — **AC**: the new section exists and cites `#408`.
- [ ] **`documentation/decisions/INDEX.md`**: append a short amendment clause to ADR-007's row
  11 summary cell. — **AC**: row 11 summary references the amendment; ADR-007's status stays
  `accepted` (this is a decision-table amendment, not a status change).
- [ ] **`plan-template.md`**: add an optional `supersedes_adr: [ADR-NNN, ...] | null` frontmatter
  key to the Standard/Quick template block. — **AC**: key present; existing plans omitting it
  remain valid.
- [ ] **`implementer.md` — declared-supersession stamping**: new bullet in `## Carry Staged
  Artifacts` — when a plan's `supersedes_adr` is non-empty, before opening the PR, append one
  dated, issue-cited bullet per named ADR to that ADR's `## Post-acceptance amendments` section
  (creating it if absent) and update that ADR's INDEX summary; idempotent on re-spawn (skip an
  ADR already citing the issue). — **AC**: documented trigger, write target, idempotency rule,
  and INDEX update match what the new check's leg 1 verifies.
- [ ] **`scripts/checks/adr-supersession.check.ts` (new, `V-ADR-06`)**: leg 1 — a plan declaring
  `supersedes_adr` without a matching amendment; leg 2 — tracked `src/`/`documentation/` prose
  (excluding `documentation/decisions/`) matching `supersedes|reverses|contrary to|do not amend
  .* ADR-\d+` without a matching amendment on the cited ADR. Tests for both legs in
  `scripts/verify.adr-supersession.test.ts`. — **AC**: both legs covered by tests; check
  glob-discovered by `scripts/verify.ts` with no registry edit.
- [ ] **`hunt/docs.md` — third band**: scan local, gitignored `.blackhole/plans/*.md` for the
  same trigger phrases near an `ADR-\d+` with no matching INDEX change; `hunter.md` untouched
  (pure reuse of the existing hunt mechanism). — **AC**: new heuristic, calibration row, and
  file/line convention row present.
- [ ] **`blackhole-vcodes.md` + `facts.ts`**: add the `V-ADR-06` table row and bump
  `VCODE_TABLE_ROW_COUNT` (and `EXPECTED_CHECK_COUNT`, conditional on #704/R-01 not yet having
  landed) to the live baseline plus one. — **AC**: row present; check-count constants match
  `bun run scripts/verify.ts`'s actual discovered-check count.

## Sprint Contract
One PR closes all four AC legs from issue #712 in a single reviewable diff — matches the epic's
"one item = one reviewable PR" sizing (`size:s`). `V-ADR-06` is the code reserved for this issue
in `documentation/plans/plan-retrospective-v0.21.0-remediation.md`'s R-09 row; if sibling issue
#711 (R-08, also Wave 0) lands first and claims it, the next free number is used instead and the
deviation is noted in the PR description.
