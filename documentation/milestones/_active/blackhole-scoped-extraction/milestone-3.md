---
type: plan
status: current
review_trigger: "on milestone completion"
created: 2026-07-06
last_updated: 2026-07-06
plan_base_commit: 015e7cc
related:
  - documentation/architecture/retrospective-blackhole.md
  - documentation/audits/architecture-coherence.md
initiative: blackhole-scoped-extraction
milestone: 3 of 3 (Governance & Cleanup)
track: quick
---

# Milestone 3: Governance & Cleanup

## Objective

Close three small, independent Top-5 effort/impact cleanups identified in the
retrospective (§7.5 V-ADA-02 Exit Gate; §1.6 Anti-Patterns #3 and #4):

1. Fix the V-ADA-02 gap by creating `documentation/decisions/INDEX.md` to index the
   3 existing ADRs.
2. Prune the orphaned `src/references/agent-tools.md` reference doc, confirmed to have
   zero functional citations (it appears only as a stray inventory-list entry in
   `src/references/ground-truth.md:93`, which must be cleaned up alongside the deletion).
3. Fix `src/agents/coordinator.md`'s cross-boundary reference to
   `.cursor/rules/release-milestone-governance.mdc` — confirmed (read at lines 48–68)
   to be **unconditional**, i.e. not wrapped in a `{{#cursor}}...{{/cursor}}` block, so
   the Maintainer release routing section currently renders a dead link on 4 of the 5
   compiled platform mirrors.

All three items are independently deployable and can land in a single PR or three small
ones; no cross-item dependency exists. This is a Quick-track plan — no architectural
decisions, no integration touchpoints beyond the build pipeline itself.

## Task Breakdown

### Task 1 — Create `documentation/decisions/INDEX.md`

Create a new index file with one row per existing ADR.

- **Files**: `documentation/decisions/INDEX.md` (new)
- **Content**: 3-row table using the project's scaled-down format
  `| path | summary | type | status | review_trigger |`:
  - `ADR-001-five-phase-lifecycle.md` — status `Accepted`
  - `ADR-002-synthesizer-extraction.md` — status `Superseded` (superseded by ADR-003)
  - `ADR-003-synthesizer-removal.md` — status `Accepted`
- **Acceptance criteria**:
  - [ ] `documentation/decisions/INDEX.md` exists and contains exactly 3 rows, one per
        ADR file currently in `documentation/decisions/`
  - [ ] ADR-002's row status reads `Superseded` (not `Accepted`)
  - [ ] Each row's summary is a one-line description matching the ADR's actual title/decision
  - [ ] No plugin-scale governance machinery is introduced — 3 rows, no extra sections

### Task 2 — Delete orphaned `src/references/agent-tools.md`

Confirmed via grep: `agent-tools.md` has zero functional citations across
`src/agents/*.md` and `src/references/*.md` — the only match found was a stray listing
entry in `src/references/ground-truth.md:93` (a reference-file inventory list, not a
functional cross-reference).

- **Files**: `src/references/agent-tools.md` (delete), `src/references/ground-truth.md`
  (edit — remove the `agent-tools.md` list entry at/near line 93)
- **Acceptance criteria**:
  - [ ] `src/references/agent-tools.md` no longer exists in `src/`
  - [ ] `src/references/ground-truth.md` no longer lists `agent-tools.md` in its
        reference-file inventory
  - [ ] `bun run build` regenerates all 5 compiled mirror targets with `agent-tools.md`
        removed from each
  - [ ] `bun run verify` passes with no dangling-reference or stale-mirror errors

### Task 3 — Gate the Cursor-only reference in `src/agents/coordinator.md`

Lines 48–68 ("Maintainer release routing" section) are unconditional. Line 62
references `.cursor/rules/release-milestone-governance.mdc`, a maintainer-only Cursor
rule deliberately excluded from `build.ts`'s compile pipeline (copied verbatim by
`copyMaintainerCursorRules()`, never generated from `src/`). Confirmed: no
`{{#cursor}}...{{/cursor}}` wrapper currently exists around this line or section, so the
link 404s on the 4 non-Cursor compiled platform mirrors.

- **Files**: `src/agents/coordinator.md` (edit line 62, or the enclosing bullet)
- **Fix**: Wrap the cross-boundary reference in `{{#cursor}}...{{/cursor}}` so it only
  renders in the Cursor-compiled mirror; for the other 4 platforms, either omit the
  bullet entirely or rephrase it to remove the dead link (e.g., a platform-neutral
  instruction to "defer milestone closure to the maintainer's Cursor governance rule
  where applicable"). Prefer the conditional-wrap approach since
  `applyPlatformConditionals()` in `build.ts` already implements this exact mechanism.
- **Acceptance criteria**:
  - [ ] Line 62's reference to `release-milestone-governance.mdc` is wrapped in
        `{{#cursor}}...{{/cursor}}` (or removed/rephrased for non-Cursor targets)
  - [ ] `bun run build` produces a Cursor mirror that retains the reference, and the
        other 4 compiled mirrors do not contain a dead link to
        `.cursor/rules/release-milestone-governance.mdc`
  - [ ] `bun run verify` passes with no cross-boundary reference errors

### Task 4 — Confirm compiled mirrors stay in sync

Combined verification pass after Tasks 1–3 land.

- **Files**: none (verification only)
- **Acceptance criteria**:
  - [ ] `bun run build` completes with no errors after all three edits
  - [ ] `bun run verify` passes cleanly (exit 0)
  - [ ] Manual diff check: no compiled mirror still references `agent-tools.md` or an
        unconditional `.cursor/rules/release-milestone-governance.mdc` link

## Dependency Blast-Radius

- Task 1 is additive only (new file) — zero blast radius on existing consumers.
- Task 2 removes a file with zero functional citations (grep-confirmed) — blast radius
  limited to the one cosmetic inventory-list entry in `ground-truth.md`, already
  accounted for in the task.
- Task 3 changes rendered output only for non-Cursor compiled mirrors (removes a dead
  link); the Cursor mirror's behavior is unchanged. No consumer of coordinator.md's
  release-routing logic depends on the removed/gated line's presence outside of Cursor.
- Combined blast radius: 3 files edited/deleted in `src/`, 5 compiled mirror targets
  regenerated by `bun run build`. No runtime/application code paths affected.
