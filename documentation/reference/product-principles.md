---
type: reference
status: current
review_trigger: "on new ruling"
created: 2026-08-06
last_updated: 2026-08-06
rulings_revision: 2
---

# Product Principles: blackhole

<!--
  Owner-rulings ledger. Durable owner preferences/decisions stated in chat, an issue comment,
  or a clarify-gate answer are appended here in the same turn — verbatim quote first, dated
  interpretation second. `planner`/`implementer`/`reviewer` read this file as binding input;
  `reviewer` BLOCKs a diff that contradicts an `active`-status ruling (V-RULE-01).

  Append protocol: assign the next sequential `Id` (never reused/renumbered, even when a
  ruling is later superseded/retracted), and increment the frontmatter `rulings_revision`
  counter by exactly 1 for every append or status edit.
-->

## Ruling: documentation-integration-floor

- **Id**: R-001
- **Status**: active
- **Date**: 2026-08-06
- **Source**: chat
- **Verbatim**: > "blackhole should at least have the same level of integration of mercure with `documentation` framework that mercure is also creating/maintaining and even more if blackhole need to add a new category of documentation"
- **Interpretation**: mercure's `documentation/` integration is a **floor, not a target**.
  Blackhole's integration with the `documentation/` framework must be at least equal to
  mercure's on every axis — folder taxonomy, lifecycle frontmatter, INDEX maintenance,
  doc-tree health governance, and per-phase artifact persistence. Where blackhole's autonomous
  operation requires a documentation category mercure does not have, blackhole may and should
  exceed mercure's taxonomy rather than constrain itself to it. A blackhole design that
  deliberately persists *less* than the equivalent mercure workflow requires explicit owner
  sign-off against this ruling.
- **Related**: `documentation/audits/documentation-framework-alignment.md`;
  `documentation/decisions/ADR-021-durable-artifact-staging.md` § D3 (amended under this ruling);
  audit §4 (INDEX.md + doc-tree health signal absent), §6 (`investigations/`, `assessments/`,
  `runbooks/` folders absent); issues #441, #442

## Applied dispositions

| Date | Conflict | Disposition |
|------|----------|-------------|
| 2026-08-06 | ADR-021 § D3 persisted less than mercure — plan on Standard/Design track only, review only on a deferred BLOCK, on proportionality grounds | **amend** — D3 rewritten to unconditional promotion for both classes. Doc-tree volume is reassigned to D6's health machinery, with D6 made a hard prerequisite for D3 rather than a parallel track |
