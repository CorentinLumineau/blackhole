---
type: reference
status: current
review_trigger: "on new ruling"
created: 2026-08-06
last_updated: 2026-08-06
rulings_revision: 4
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

## Ruling: decision-gates-carry-an-executive-summary

- **Id**: R-003
- **Status**: active
- **Date**: 2026-08-06
- **Source**: chat (campaign session, at the #476 split gate)
- **Verbatim**: > "on this case, we should have more information about what is going on, more information to help the user to decide the right choice for him. right now, i was having only the number of issue, the way that the confidence was low ... we need like executive summary of what is going on + ask question about option possible to make the user having all to decide properly"
- **Interpretation**: a user-facing decision gate must carry the reasoning, not a pointer to it.
  Every `AskQuestion` posed to the owner is preceded by an executive summary stating **what** the
  subject is in substance (not by identifier), **why** a gate fired, the **evidence**
  (`file:line` or named mechanism), and the **per-option consequence** — including the strongest
  case for the option not recommended. An issue number, a V-code, and a confidence score are
  labels for context the owner does not have loaded; transferring the label without the reasoning
  produces a question the owner cannot evaluate and can only rubber-stamp.

  Confidence-gate-triggered questions carry an additional obligation: state that the flag was
  resolved by a **threshold rule**, not by a judgment that the cautious default is correct. The
  owner needs to know they are overriding a heuristic, not a conclusion.

  This ruling binds gate **content**, not gate **placement** — which conditions fire a gate is
  untouched. It is the asking-path complement of issue #456's non-asking-path gap (a
  reformulation never posted as the async veto surface); both are failures of the single contract
  that the owner can see what the agent understood.
- **Surfaces**: `src/references/clarify-gates.md`; `src/references/confidence-gates.md`;
  `src/agents/coordinator.md`; any skill or reference specifying an `AskQuestion` interaction
- **Keywords**: `AskQuestion`, clarify gate, split sign-off, plan approval, design approval,
  UI interpretation gate, merge escalation, review-iteration escalation, cautious default
- **Related**: issue #483 (implements this ruling); issue #456 (complement — reformulation never
  posted on the proceed path); `src/references/clarify-gates.md`;
  `src/references/confidence-gates.md`; routing decision R-00010 (the #476 split gate that
  triggered the ruling)

## Applied dispositions (R-003)

| Date | Conflict | Disposition |
|------|----------|-------------|
| 2026-08-06 | The #476 split gate presented issue number + `confidence.split 62 < 70` with no summary of what #476 was, why the gate fired, or what each option cost | **accepted** — owner chose the split anyway, but on the recommendation rather than on the evidence. Re-presented immediately afterward with the full picture and an explicit offer to reverse; ruling filed as #483 so the gate contract is fixed in the product, not just in this session's conduct |
