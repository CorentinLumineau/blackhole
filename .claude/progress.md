# Progress — implement-all: companion-substrate-closure + mercure-parity-program

## Current Status
- Branch: `main`. Executing two initiatives end-to-end via mercure `/x-initiative implement-all`.
- Model: sequential, merge-between-milestones. companion-substrate-closure (priority 1) fully,
  then mercure-parity-program (priority 2). Each milestone: branch → implement (per-milestone
  agent) → review → green `bun run verify` + `bun run build` + `bun test` → merge to main → next.
- Run as a **mercure initiative, NOT a blackhole self-campaign** (milestones edit blackhole's own
  agent contracts; a self-campaign would review changes to its own contract).
- Currently: **ALL 10 AUTONOMOUS MILESTONES COMPLETE** (companion M0/M1/M4/M2/M3; parity M1-M5).
  Only the 2 gated milestones remain (CSC-M5, MPP-M6) — awaiting user decision.

## Green baseline (main @ 22a84bb)
- `bun run verify` → 28/28
- `bun run build` → clean, zero drift
- `bun test` → 490 pass / 0 fail / 25 files
This is the regression gate for every milestone.

## Execution order (task IDs in TaskList)
1. CSC-M0 accretion control (wave1)      ✅ merged 54d08f4
2. CSC-M1 schema precedence (wave1)       ✅ merged eed17e5
3. CSC-M4 decision memory (wave1)         ✅ merged 1fb772e
4. CSC-M2 promotion path (needs M1)       ✅ merged 8f13aef
5. CSC-M3 Active Constraints (needs M2)   ✅ merged 48581f4
6. MPP-M1 sync/Lens v2 (wave1)            ✅ merged 8d0842b
7. MPP-M2 matrix seed (needs M1)          ✅ merged 3a87aba
8. MPP-M3 threat/perf (needs M2)          ✅ merged bf875a4
9. MPP-M4 merge/delivery hardening (needs M2)  ✅ merged a808875
10. MPP-M5 parity hunt kind (needs M2)         ✅ merged 4e20a79

## Deferred (gated — hand to user)
- CSC-M5 autonomy.enabled flip — BREAKING; needs a real green campaign + human T3 sign-off.
- MPP-M6 first matrix-driven backlog sweep — runs prj-mercure-sync live; files real GitHub issues.

## Completed Milestones
- **CSC-M0** (ADR-011 accretion control) — merged `54d08f4`. reviewer.md §5 3-form Reuse Check
  tolerance + negative-claim BLOCK spot-check + Improvement Record WARN; implementer.md aperture
  split (repo-wide existence vs neighbourhood convention) + rule-of-three; Scout Check consolidated
  to one unconditional section; ADR-008 flipped Accepted. Gate: verify 28/28, build clean, tests 490/0.
- **CSC-M1** (ADR-012 E1 schema precedence) — merged `eed17e5`. New `scripts/detect-doc-schema.sh`
  (+12-case TDD test) detects mercure vs blackhole INDEX-header/ADR-frontmatter schema; doc-governance.md
  Repo Convention Precedence extended to both layers citing the script as SSOT; planner.md/artifact-contract.md
  emitters + reviewer.md V-ADA-02/SKILL.md F-DOCS-01 auditors accept either schema. Counts held (28/46).
  Gate: verify 28/28, build clean, tests 502/0.
- **CSC-M4** (ADR-012 E4 decision memory) — merged `1fb772e`. `decision_records[]` schema+validator
  (TDD), worker-schemas.md subsection, implementer.md emission at 4 gates, NEW orchestrator
  `## Decision Record Append` section (12/50 LOC; barrier grandfathered 46 LOC untouched), new
  `documentation/reference/decision-log.md`, reviewer §15 audit. Single-writer preserved (impl never
  writes the log). verify.test.ts allowlist updated for the new section (keeps loud-fail). Counts held
  (28/46). Gate: verify 28/28, build clean, tests 509/0.
  NOTE: orchestrator.md non-baseline section allowlist in scripts/verify.test.ts now lists
  `## Decision Record Append` + `## Design Autonomy Dispatch`; M2's new resume-dispatch section must
  be ADDED to that exact-list assertion (file order).
- **CSC-M2** (ADR-012 E2 promotion path) — merged `8f13aef`. T1 repaired the live design-track-resume
  bug (`awaiting-design-approval` now recognized in coordinator.md/queue-dag.md/SKILL.md); orchestrator
  new `## Design-Approval Resume Dispatch` section (20 LOC); planner §4.8 third branch promotes a
  human-approved design VERBATIM on `resume_context: design_approved` — never self-grades, never
  re-invokes design-aggregate.ts. V-DESIGN-01/02 + V-CONTENTGATE-01 green; verify.test.ts allowlist now
  lists 3 non-baseline sections. Counts held. Gate: verify 28/28, build clean, tests 509/0.
- **CSC-M3** (ADR-012 E3 Active Constraints) — merged `48581f4`. T0 neutralized template `{e.g.}`
  placeholders; Trigger A (planner §4.8 ready branch) appends `(ADR-{NNN})`-attributed constraint via
  the 3-question Cross-Cutting Heuristic; Trigger B (new track-independent planner Workflow step,
  "seeds", reachable from Quick track) seeds from analyze notes with `(analyze: issue #N)` attribution
  + dedup. V-DESIGN markers intact, counts held. Gate: verify 28/28, build clean, tests 509/0.
  → **companion-substrate-closure autonomous scope COMPLETE (5/6; M5 deferred).**
- **MPP-M1** (ADR-013 D2/D3 sync/Lens v2) — merged `8d0842b`. Rewrote `.claude/skills/prj-mercure-sync/SKILL.md`
  (edited directly — prj-* exempt from src build): tiered Adoption Lens v2 (ADOPT/ADAPT-async/N/A), exactly
  2 hard rejections, Release/Backlog dual-mode workflow. New `scripts/checks/parity-matrix.check.ts` +12-case
  TDD test (V-PMATRIX-01, file-absent SKIP until M2 seeds the matrix). **EXPECTED_CHECK_COUNT 28→29**;
  VCODE_TABLE_ROW_COUNT held 46. Gate: verify 29/29 (V-PMATRIX-01 green), build byte-identical, tests 521/0.
- **MPP-M2** (ADR-013 D1 matrix seed) — merged `3a87aba`. New `documentation/audits/mercure-parity-matrix.md`:
  82 rows (75 mechanism: checklist 21/gate 19/plan-section 13/artifact 13/protocol 5/fleet 4, + 7 ADR-011/012
  in-flight rows citing companion milestones), all 10 GAP-N + Likely-N/A represented, 20 gap rows scored,
  `## Gap Priority Scoring` section. mercure-sync.md Coverage table deprecated (note only). V-PMATRIX-01 green
  against the real matrix. Gate: verify 29/29, build clean, tests 521/0.
- **MPP-M3** (ADR-013 GAP-1 threat/perf) — merged `bf875a4`. 4 new V-codes (V-THREAT-02/03, V-PERF-01/02)
  in blackhole-vcodes.md, **VCODE_TABLE_ROW_COUNT 46→50** (V-GROUND-01 green) + TDD registration test;
  conditional Standard-track planner sections (## Threat Model STRIDE, ## Performance Budget), reviewer
  §16/§17 audits (plan-section-conditional). NOTE: plan said §15/§16 but §15 was taken by CSC-M4, so
  landed as §16/§17. 5 tracks + V-DESIGN preserved. Gate: verify 29/29, build clean, tests 522/0.
- **MPP-M4** (ADR-013 GAP-2/3/8 merge/delivery hardening) — merged `a808875`. GAP-2 spec-drift-at-merge
  check (review-core.md § Recheck + reviewer §13, paired); GAP-3 delivery-boundary evidence in
  implementer.md Verification Evidence Gate (V-GATE-01 markers intact); GAP-8 BLOCKING acceptance-criteria
  gate in planner (implements documented ac_mapping, Standard track only). No new V-code. Gate: verify
  29/29, build clean, tests 522/0.

## Failed Approaches
(none yet)

## Known Limitations / Constraints
- src/ is the only editable source; .claude/**, .agents/build/**, codex-*, plugins/* are `bun run
  build` output. Exception: `.claude/skills/prj-mercure-sync/` is edited directly (prj-* exempt).
- V-CONTENTGATE-01: orchestrator.md sections are grow-never; new content goes in a new ≤50 LOC
  section + one-line pointer.
- Planner never computes its own design-autonomy verdict (ADR-010).
- Single-writer invariant: only the orchestrator writes queue.json/findings-ledger.json/decision-log.md.
- Resource-frugal testing: one `bun test`/`bun run verify` at a time; check `free -m` before heavy runs.
