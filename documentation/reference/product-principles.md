---
type: reference
status: current
review_trigger: "on new ruling"
created: 2026-08-06
last_updated: 2026-08-06
rulings_revision: 3
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

## Ruling: merge-mode-no-default

- **Id**: R-002
- **Status**: active
- **Date**: 2026-08-06
- **Source**: chat (issue #440 owner-ruling comment)
- **Verbatim**: > "`merge_mode` should have no default — bootstrap must force an explicit choice."
- **Interpretation**: the highest-autonomy merge posture must never be inherited silently.
  `merge_mode` (`immediate` \| `gated-batch` \| `leave-open`) is structurally still an optional
  JSON key — no schema validator rejects its absence — but an absent or invalid value now trips
  a bootstrap-blocking condition (`coordinator.md` § Bootstrap preflight condition 4) rather than
  silently resolving to `immediate`, which was the prior committed-template default and the
  behavior `dashboard.ts`'s `renderConfigSummary()` used to render. This is the same "no silent
  default for the highest-autonomy option" posture the issue's audit source
  (`documentation/audits/documentation-framework-alignment.md` §10.1) argued for; a future field
  gating an irreversible or highest-autonomy action should default to bootstrap-blocking rather
  than to its most permissive value, absent explicit owner sign-off to the contrary.
  - **This campaign's disposition (AC item 1)**: `.blackhole/config.json` already sets
    `merge_mode: "immediate"` explicitly (owner-set) — not inherited from the removed template
    default. AC item 1 ("set explicitly, whatever the chosen value") is satisfied on this repo
    as of this ruling.
  - **Compensating controls for the retained `immediate` posture (AC item 3)**: blackhole's own
    merge protocol gates every autonomous merge on CI-green before `gh pr merge --squash` runs
    (`phase-loop.md` § Merge protocol steps 1-2; `merge-gate.md`'s `mergeEligible()`). Verified
    directly against this repo at ruling time: `main` carries **no GitHub branch protection**
    (`gh api repos/CorentinLumineau/blackhole/branches/main` → `"protected": false`) and
    therefore zero required status checks — this is a missing defense-in-depth layer on top of
    blackhole's own CI gate, not an open door, since blackhole's protocol-level check is the only
    thing standing between a green PR and `main` either way. Recommended, non-blocking follow-up:
    enable branch protection with required status checks on `main`. Two further compensating-
    control gaps are tracked as open/in-progress work rather than closed here: the single-
    reviewer-pass depth gap (issue #439, open — `V-SEC-07` adversarial re-verification is not
    structurally satisfiable by one reviewer agent) and the absent PreToolUse safety gate for
    unattended workers (issue #447, implementing concurrently with this ruling).
- **Related**: issue #440; `documentation/audits/documentation-framework-alignment.md` §10.1;
  `src/references/config-template.md` `merge_mode` contract note; `src/agents/coordinator.md` §
  Bootstrap preflight condition 4; issues #439, #447
