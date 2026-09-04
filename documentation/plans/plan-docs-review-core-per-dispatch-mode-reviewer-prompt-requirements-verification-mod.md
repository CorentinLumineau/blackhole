---
type: plan
summary: "Plan for issue #709 (R-06): per-dispatch-mode reviewer prompt requirements table reconciling review-core.md's universal checklist claim with reviewer.md §13/§24's narrower scopes"
status: current
review_trigger: "on file change"
created: 2026-09-02
last_updated: 2026-09-02
related:
  [
    src/references/review-core.md,
    src/agents/reviewer.md,
    documentation/plans/plan-retrospective-v0.21.0-remediation.md,
  ]
---

# Plan: Reviewer Prompt Requirements — Per-Dispatch-Mode Table (Issue #709)

Item R-06 of `documentation/plans/plan-retrospective-v0.21.0-remediation.md` (epic #703).

## Objective

`review-core.md` § Reviewer prompt requirements currently states, unconditionally, that "every
`reviewer` delegation MUST include ... Full V-code audit checklist from `{{VCODES_PATH}}`" —
but `reviewer.md` §13 (Recheck mode) explicitly scopes the audit to fix-commit changed lines
only ("do not re-run the full §§1–10 checklist against the whole PR diff") and §24 (Independent
Security Verification mode) explicitly forbids it outright ("do not run §§1–23's full
checklist"). The requirements list is wrong for two of the four dispatch modes it claims to
govern universally. Fix: replace the flat "MUST include" list with a per-mode table (full /
security-mode / recheck / verification) stating which inputs each mode actually receives, and
point §13/§24 at that table instead of leaving the contradiction standing. Prose only — no new
V-code, no new check, no agent identity change (issue #439's "same agent identity" decision
stands, per R-06's own AC).

## Touch-Paths

- `src/references/review-core.md` — plus all generated dist trees per
  `scripts/lib/build/targets.ts`
- `src/agents/reviewer.md` §13, §24 — plus all generated dist trees per
  `scripts/lib/build/targets.ts`

Edit the two `src/` files only, then `bun run build`, and commit the regenerated trees in the
same PR (`V-BUILD-01`, ~8 mirrored files per touched `src/` file). Do not hand-edit any compiled
tree.

## Codebase Conventions

- **Pointer, not restatement** (`V-DOC-05`): the new per-mode table lives in exactly one place —
  `review-core.md` § Reviewer prompt requirements. `reviewer.md` §13/§24 gain a one-line citation
  into that table, not a copy of its rows.
- **Citation resolvability** (`V-CITE-01`): a citation of the form `` `file.md` § Heading Name ``
  must resolve to a literal heading whose text equals or starts with `Heading Name`
  (`scripts/checks/vcode-citation.check.ts`). The `## Reviewer prompt requirements`,
  `### 13. Recheck-Mode Compliance`, and `### 24. Independent Security Verification Mode (...)`
  headings are not renamed by this change.
- **Content-gate budget is not a constraint on `review-core.md`** (Ground rule 4 of the
  retrospective remediation plan): `review-core.md` is not a `CONTENT_GATE_BUDGETS` key
  (`scripts/lib/build/facts.ts`) — it has no size ceiling. `reviewer.md`'s sole `## ` section
  ("## Audit Checklist") had 107 LOC of headroom against its 804-LOC budget and the whole file
  124 LOC against its 902-LOC budget at this plan's base commit (`f28dcee5`) — the two one-line
  citation additions fit with wide margin; no `CONTENT_GATE_BUDGETS` value was raised.

## Task Steps

1. Replace the flat 5-item "MUST include" list in `review-core.md` § Reviewer prompt
   requirements with a table of four rows (Full, Security-mode, Recheck, Verification), each
   stating: PR diff scope, whether Touch-Paths/schema baseline are supplied, whether the full
   V-code checklist (`{{VCODES_PATH}}`, §§1–23) runs, the findings-input shape, and whether the
   diff-scoped attack-signature scan applies.
2. Insert one citation line immediately after the `### 13. Recheck-Mode Compliance` heading in
   `reviewer.md`, pointing at the table's "Recheck" row instead of leaving §13's own scoping
   rule to silently diverge from the (old) universal claim.
3. Insert the equivalent one citation line after `### 24. Independent Security Verification
   Mode (...)`, pointing at the table's "Verification" row.
4. `bun run build && bun run verify`; targeted tests
   `scripts/verify.content-gates.test.ts` and `scripts/verify.vcode-citation.test.ts`; confirm
   `git diff scripts/lib/build/facts.ts` is empty (no budget raised).

## Out of scope

Any new compiled agent variant; `src/references/phase-review.md`'s own "Reviewer prompt must
include" section (a distinct sibling list at `src/references/phase-review.md:41` sharing the
same unconditional-checklist phrasing, outside this issue's declared Touch-Paths — flagged for a
possible follow-up issue, not fixed here); any renumbering of `blackhole-vcodes.md` V-code rows
(none apply to this change).
