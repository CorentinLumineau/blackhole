---
type: implementation
status: archived
review_trigger: "on reference"
created: 2026-07-21
last_updated: 2026-07-21
related:
  - documentation/decisions/ADR-011-implement-time-accretion-control.md
  - documentation/decisions/ADR-012-shared-artifact-substrate.md
---

# Archived — Companion Substrate Closure (ADR-011 + ADR-012)

**Status:** COMPLETE — all 6 milestones merged to main and pushed. Duration: 2026-07-20 → 2026-07-21
(planned → implemented in one `/x-initiative implement-all` run). Execution mode: mercure initiative
(NOT a blackhole self-campaign — milestones edit blackhole's own agent contracts).

**Goal delivered:** blackhole as *autonomous mercure over a shared artifact substrate* — implement-time
duplication is now caught at occurrence, design decisions reach `documentation/decisions/` on both
autonomous and human-approved paths, implementation decisions are banked durably, and autonomy defaults on.

## Milestones

| M | Title | Merge | Notes |
|---|-------|-------|-------|
| M0 | ADR-011 implement-time accretion control | `54d08f4` | Reuse-Check aperture split (repo-wide existence + rule-of-three); Scout Check unified by diff scope |
| M1 | E1 repo-convention schema precedence | `eed17e5` | `detect-doc-schema.sh` (TDD) picks mercure vs blackhole INDEX/ADR schema; 4 consumers updated |
| M4 | E4 durable decision memory | `1fb772e` | `decision_records[]` + validator; orchestrator single-writer append to new `reference/decision-log.md` |
| M2 | E2 human-approved promotion path | `8f13aef` | Fixed live design-track-resume bug; planner promotes verbatim on `resume_context:design_approved` (never self-grades) |
| M3 | E3 Active Constraints write path | `48581f4` | Trigger A (ADR promotion) + Trigger B (track-independent analyze seeding), 3-question Cross-Cutting Heuristic |
| M5 | E5 autonomy default flip (BREAKING) | `2c6d24e` | `autonomy.enabled: true`, `brainstorm_routing` pinned false; release notes `.github/releases/v0.15.0.md` |

## Key decisions
- **Run as mercure initiative, not a self-campaign** — M0 edits implementer/reviewer, so a self-hosted
  reviewer would review its own contract mid-run.
- **Sequential, merge-between-milestones** — the milestones share `planner.md`/`reviewer.md`/`implementer.md`
  and have hard code deps, so parallel branches were unsafe; each merged to a green main before the next.
- **Planner never computes its own design-autonomy verdict** (ADR-010) — M2's human-approved branch
  promotes byte-for-byte on an external directive, no `design-aggregate.ts` re-invocation.
- **Retired metric:** "kaizen refactor yield trends to zero" — unachievable; all 9 `[Kaizen]` issues
  (#274–#282) were out-of-diff hunter findings. The real fix was the Reuse-Check *aperture* (M0).

## Lessons learned
- **Independent re-verification catches real drift.** Re-checking each milestone (not trusting agent
  self-reports) caught M4's out-of-scope content-gate allowlist edit (legit) and the reviewer section
  renumbering (§15 taken by M4 → M3-parity landed §16/§17).
- **V-CONTENTGATE-01 discipline held** — every new orchestrator section landed grow-never-safe (≤50 LOC,
  barrier section untouched), with the exact-allowlist test updated to keep loud-fail.
- **The V-BUILD-01 post-commit gate** requires committing source + regenerated build output together
  before it reads clean — a sequencing fact every milestone hit.

## ⚠️ Open follow-up (do not lose)
- **CSC-M5 T3 verification is NOT yet observed.** The autonomy flip shipped with the green-campaign
  Entry-Gate (row 6) WAIVED by maintainer decision. The next real campaign is the verification run —
  confirm the 4 criteria from the (now-deleted) milestone-5.md § T3: (1) escalations are substantive,
  not config-wiring artifacts; (2) zero unintended brainstorm dispatch; (3) design gates resolve
  autonomously where confidence permits / block correctly otherwise; (4) analyze dispatch fires for a
  `size:l`+ or design-flagged issue. **Rollback if any Stop Condition hits: `autonomy.enabled: false`.**

## Key deliverables
`detect-doc-schema.sh`, `decision_records[]` + `reference/decision-log.md`, extended
`doc-governance.md` precedence, planner promotion + Active-Constraints write paths, `autonomy.enabled: true`.
End state: `bun run verify` 29/29, `bun test` 529/0, build clean.
