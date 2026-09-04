---
type: plan
summary: "Relocate worker-schemas.md's orchestrator-side sections (Flush request, Orchestrator validation/Barrier triage/Blocked-iteration escalation) to a new orchestrator-handoff.md reference file — pure content relocation, no behavior change"
status: current
created: 2026-09-04
last_updated: 2026-09-04
review_trigger: "on ADR acceptance"
related:
  - documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md
  - documentation/plans/plan-retrospective-v0.21.0-remediation.md
---

# Plan — Relocate worker-schemas.md's Orchestrator-Side Sections (issue #726)

## Objective

Relocate `src/references/worker-schemas.md`'s two orchestrator-side sections — `## Flush
request` (69 LOC) and `## Orchestrator validation` (+ `### Barrier triage`, `### Blocked-
iteration escalation`, 42 LOC) — verbatim into a new dedicated reference file,
`src/references/orchestrator-handoff.md`. This is a pure content relocation: no behavior change,
no schema change, no protocol change — only where the prose lives. Per the issue's investigation
note (authoritative, not re-litigated here):

- The destination is a **new file**, not `orchestrator-runtime.md` — that file has only 20 LOC
  of `CONTENT_GATE_BUDGETS` headroom (223/243), which even the smaller of the two sections alone
  (42 LOC) overflows by 22 LOC.
- This is not superseded by #802/#844's ADR-007 amendment — that amendment settled a *different*
  extraction (the Implementer role-contract section) and an unrelated whole-file LOC trip;
  neither addressed this content. The `ADR_WATCH_ITEMS` `file_loc: 700` trip on
  `worker-schemas.md` (currently 794 LOC) is independently active right now.
- The two sections cross-reference `orchestrator-runtime.md` § Triage / § Error Classification /
  § Background worker barrier repeatedly — they describe what the *orchestrator* does with a
  worker's output, not a worker return schema. This is the substantive SRP/content-ownership
  reason for the move, independent of any LOC number.

**Naming decision:** one new file, named `src/references/orchestrator-handoff.md` — not the
issue's literal parenthetical fallback `flush-request.md`. Rationale: 112 combined LOC does not
warrant a further split (matches the `#473`/`#802` precedent's own scale — both of those
extractions landed in one file each). But `flush-request.md` would be an inaccurate name for a
file whose second half (`Orchestrator validation`) is not about flush requests at all.
`orchestrator-handoff.md` names the actual shared concern both sections have — the
orchestrator↔worker handoff boundary (the ask *before* a worker stops, and the validation
*after* a worker returns) — and it slots into the existing `orchestrator-*.md` file family
already established at `src/references/` (`orchestrator-dispatch.md`, `orchestrator-runtime.md`,
`orchestrator-delegation.md`), unlike `-schemas.md`-suffixed names (`hook-schemas.md`,
`implementer-schemas.md`) which are reserved for files whose content actually *is* a
worker-authored JSON schema — `Orchestrator validation` is procedural prose, not a schema, so a
`-schemas.md` name would misdescribe it.

## Touch-Paths
- `src/references/worker-schemas.md` (plus all generated dist trees per `scripts/lib/build/targets.ts`)
- `src/references/orchestrator-handoff.md` (new file; plus all generated dist trees per `scripts/lib/build/targets.ts`)
- `src/references/phase-stop.md` (plus all generated dist trees per `scripts/lib/build/targets.ts`)
- `src/references/orchestrator-runtime.md` (plus all generated dist trees per `scripts/lib/build/targets.ts`)
- `scripts/lib/build/facts.ts`
- `scripts/checks/stop-mode.check.ts`
- `scripts/verify.stop-mode.test.ts`
- `scripts/verify.content-gates.test.ts`
- `documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md`

## Documentation Impact

- `documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md` — append a
  `## Post-acceptance amendments` entry recording this relocation as the disposition of R-19's
  original scope (the entry landed by #802/#844 covered R-19 "item 1" (accept-with-expiry) and
  "item 2" (the *Implementer* split) — neither was R-19's own named target). Mirrors the existing
  entry format for #802.
- `documentation/plans/plan-retrospective-v0.21.0-remediation.md` § R-19 — no edit needed; its
  AC is satisfied by this plan's Task Breakdown and the ADR-007 amendment above. Left as
  historical record, not touched.
- No other consumer-facing `documentation/` content is affected — this is an internal
  build-source relocation between two `src/references/*.md` files with no public-API or
  user-facing surface.

## Critical Files
- `scripts/lib/build/facts.ts` — shared SSOT for content-gate budgets, ADR watch items, and
  multiple other declared-fact tables consumed by the whole `scripts/verify.ts` check suite. An
  incorrect edit here can silently green-light or red-flag unrelated files.

## Codebase Conventions

| Concern | Convention | Touchpoint |
|---|---|---|
| Extracting non-contract content out of `worker-schemas.md` | Move section(s) verbatim to a new `src/references/*.md` file; add a one-line "split out of `worker-schemas.md` (issue #N)" provenance sentence to the new file's intro | `hook-schemas.md` (#473), `implementer-schemas.md` (#802) — both followed verbatim |
| `CONTENT_GATE_BUDGETS` after a split | Add a new row for the extracted file; re-measure (never hand-freeze) both the new file's and the source file's `maxSectionLoc`/`maxFileLoc` as `ceil(live_measured_LOC × 1.2)` | `scripts/lib/build/facts.ts` (`#473`, `#802` precedent) |
| Stale cross-reference citations after a move | Grep the whole `src/` tree for the old section's citation and replace with the new file's name at every hit — never leave a citation pointing at the old location | `#802`'s 4-citation fix in `implementer.md`, mirrored here for `phase-stop.md` (×5) and `orchestrator-runtime.md` (×1) |
| Hardcoded content-presence checks | A `scripts/checks/*.check.ts` module that reads `worker-schemas.md` and checks for a section title's presence must be repointed at the new file when that section moves | `scripts/checks/stop-mode.check.ts` (this plan) |
| `inline-schema-drift.check.ts` `EXCLUDED_REFERENCE_FILES` | Only add a new reference file to this set when its content actually needs the exclusion (a role-named heading immediately preceding a fenced JSON block containing a `"status"` literal). Verified not applicable here. | `scripts/checks/inline-schema-drift.check.ts` |

## Execution Strategy & Stop Conditions

- If, after moving both sections out, the `V-WATCH-01` `worker-schemas.md` `file_loc` row does
  not report green (i.e. live LOC is still ≥ 700), halt and re-verify the section boundaries were
  captured correctly before proceeding to the `facts.ts` budget edits.
- If the content-gates test fails after the `facts.ts` edit, revert the `facts.ts` edit and
  re-derive the LOC numbers live before reapplying — never hand-tune a budget number to force the
  test green.
- If the stop-mode test fails after the `stop-mode.check.ts` edit, halt and diff the failing
  assertion's expected string against the live file content before touching any other file.
- If any diff-content-equality check finds the moved content differs from the source
  byte-for-byte (beyond the added intro/provenance line), abort the move and re-extract — this
  plan promises a verbatim relocation, not a rewrite.

## Task Breakdown

See the campaign plan artifact (`.blackhole/plans/issue-726.md`) for the full numbered task
breakdown with machine-verifiable acceptance criteria (8 tasks: extract sections into the new
file; update stale cross-reference citations in `phase-stop.md`/`orchestrator-runtime.md`;
re-derive and update `CONTENT_GATE_BUDGETS`; update the content-gates declared-key test; verify
`inline-schema-drift.check.ts` needs no edit; repoint `stop-mode.check.ts`'s hardcoded
Flush-request check; confirm the `ADR_WATCH_ITEMS` trip clears; record the ADR-007
post-acceptance amendment).

## Sprint Contract

Definition of done = all 8 numbered tasks' acceptance criteria pass, plus a clean baseline before
and a clean full-suite run after, with zero regressions.
