---
type: plan
status: current
review_trigger: "on file change"
created: 2026-09-04
last_updated: 2026-09-04
---


# Design Note - Issue #795

Review phase accepts the worker's self-report as evidence; independent re-verification found
~1 real defect per PR that report-review alone missed.

## Requirements Framing

**Issue body (verbatim source)**: field report from a sibling repo (`CorentinLumineau/invest`,
v0.20.0) — across ~12 PRs, workers returned accurate, well-argued, CI-green reports, but
independent re-verification (checking claims against source, not the report) found ~1 real
defect per PR anyway. Cited instances: an a11y fix whose own 3 new tests all passed against
genuinely broken CSS positioning (tests structurally can't see positioning); a shell arg parser
whose own test stub flattened `argv` so a real bug couldn't have failed it; a test-environment
allowlist entry with no DOM; 2 conflict resolutions that would have silently reverted a same-day
fix; a correct code change leaving 2 live docs instructing the reverse. The suggested handling
has four legs: (1) verify claims against source, name `file:line` for every load-bearing claim;
(2) a "what else did this diff touch" blast-surface step; (3) a candidate new V-code for a test
structurally incapable of failing even if the bug it claims to cover were present; (4) grep the
docs tree for the affected symbol before merging a change that resolves a documented deviation.

**Router classification rationale** (`queue.json` issue 795, `route` object, `computed_at_phase:
handle`, confidence: design 85, analysis 72, security 80, docs 80): `needs_design: true`,
`needs_analysis: true`, `task_type: feature`, `plan_mode: full`, `security_review_required:
false`, `docs_impact: true`, `ui: false`. No `plans/issue-795-analysis.md` exists on disk — the
`investigator` `analyze` sub-mode has not run for this issue, so Step 4 (Seed Active Constraints
from analyze note) is inert; this design proceeds on independent codebase discovery only, per
the documented fallback.

**This campaign is itself a confirming instance** — the queue's own `notes` field for #795
records: "independent verification of worker claims caught 4 orchestrator errors and disproved 3
issue premises (#774, #767, #710) in a single turn, and review-743 found that none of 7 original
tests could have caught the bug they were written for." This is a second, independent data point
inside *this* campaign for the exact defect class the issue reports (a test suite structurally
unable to fail), separate from the fresh evidence supplied at spawn time.

**Fresh evidence supplied at spawn time (this session)**: two `reviewer` spawns this session,
given prompts explicitly instructing independent re-derivation ("trace the actual control flow,
don't trust a docstring claiming it's fixed"; "read the actual test bodies, don't trust the
description"), caught genuine bugs a report-trusting review would have missed — a tilde-expansion
silent write-containment bypass on PR #818/issue #804 (a security-hardening PR that would have
shipped its own vulnerability), and a subcommand-token-normalization gap on PR #819/issue #788
(new code in a bug-bypass-closing PR that reintroduced the exact bypass class it was meant to
close). Both catches trace to ad-hoc orchestrator spawn-prompt diligence, not to any standing
`reviewer.md` obligation.

**What is actually being decided**: whether to protocolize some or all of the four suggested legs
into `reviewer.md`'s own checklist (so the catch-rate stops depending on whoever is orchestrating
that turn remembering to ask for it), and if so, how much of the four-leg proposal to adopt in one
pass versus keep narrow.

## Options + Trade-off Matrix

**Decision type**: `architecture-choice` (`design-rubric.md`) — this changes `reviewer.md`'s core
methodology, a structural boundary in what the review phase is obligated to check on every PR,
not a one-off bugfix. Fixed columns/weights: **Risk 30, Maintainability 25, Complexity 20,
Reversibility 15, Consistency-with-existing-pattern 10**. "Risk" is read as the compound of (a)
residual risk that the reported defect class keeps shipping under this option, and (b) collateral
risk the option itself introduces (reviewer token/time cost blowup, false-positive friction).
"Maintainability" is read as ongoing sustainability of the approach across many future PRs,
forever — the exact "costs real orchestrator turns per PR" tension the issue names as a genuine
axis, not a straw concern.

**Option A — Comprehensive protocolization.** Add one new **unconditional** `reviewer.md` section
(applies to every PR, no gating trigger — same posture as §0 Iron Law and §26 Comment Discipline)
implementing all four suggested legs: (i) every load-bearing claim in the implementer's
report/PR body must be independently re-verified against its cited `file:line`; (ii) a
"blast-surface" step — for each touched file, name properties of the changed code that were NOT
the stated subject of the change, confirm the diff didn't silently alter them; (iii) a new V-code
(`V-TEST-11`, sibling to `V-TEST-10`) for a test structurally incapable of failing even if the bug
it claims to cover were present ("what would this assertion do if the bug were present?"); (iv)
when a diff resolves a documented deviation, grep the docs tree for the affected symbol before
approving — folded into `V-DOCFACT-01`'s existing trigger (§18).

**Option B — Narrow, targeted fix.** Adopt only leg (iii) above: a new V-code
(`V-TEST-11`) for a structurally-unfalsifiable test, mechanically detectable from the diff, placed
beside `V-TEST-10` in the existing Test Integrity Audit (§23). No new unconditional section, no
blast-surface step, no source-verification mandate beyond the narrow spot-checks that already
exist at §§5/8/23.

**Option C — Status quo.** No `reviewer.md` change. Source-verification and blast-surface
awareness stay orchestrator/spawn-prompt discretion, documented at most as an informal note in an
orchestrator playbook — never enforced or auditable by `reviewer.md`'s own checklist.

**Primary's provisional trade-off matrix** (1-5 scale, `design-rubric.md` anchors — drafted before
the blind critics were spawned, per §4.3's ordering, and left unrevised after seeing their scores
so the disagreement below is genuine, not hindsight-smoothed):

| Option | Risk (30) | Maintainability (25) | Complexity (20) | Reversibility (15) | Consistency (10) | Weighted total |
|---|---|---|---|---|---|---|
| A | 4 | 4 | 3 | 4 | 5 | **3.90** |
| B | 2 | 4 | 5 | 4 | 5 | 3.70 |
| C | 1 | 1 | 5 | 5 | 2 | 2.50 |

Primary's provisional Chosen: **Option A** — it is the only option that closes all four legs the
issue names, and the two independently-confirming data points inside this very campaign (#815's
"none of 7 original tests could have caught the bug", the tilde-expansion and subcommand
catches) span more than the "unfalsifiable test" subclass Option B alone would mechanize.

## Adversarial Evaluation

Two blind `planner` sub-invocations (critique-only mode, no file writes, no further spawns)
scored the same three options, stripped of the primary's Chosen field, against the identical
fixed rubric. Full findings preserved verbatim for the record; only the discriminating ones are
excerpted here (domain-inherent findings noted but not repeated in full):

**Critic A** — Risk/Maintainability/Complexity/Reversibility/Consistency:
A = 2/2/2/3/2 (2.15); B = 3/4/4/5/5 (**3.95**); C = 1/2/5/5/5 (3.05). Winner: **Option B**,
margin 22.8%.
- *Option A, discriminating, NOTABLE*: "Makes full source-re-verification of every load-bearing
  claim mandatory and unconditional on every future PR forever, regardless of risk profile...
  disproportionate cost for the demonstrated yield (V-KISS-01/V-PARETO-01 tension)."
- *Option A, discriminating, NOTABLE*: the blast-surface step "has no stated mechanical detection
  criterion — it is a narrative judgment call... layered onto every review."
- *Option A, discriminating, MINOR*: bundles one clearly good, narrow idea (identical to Option B)
  with three broader, costlier, harder-to-audit obligations.
- *Option B, discriminating, NOTABLE*: only closes 2 of the 6 cited defect instances (the
  a11y-test and arg-parser-stub cases); the conflict-revert, no-DOM-allowlist, and
  docs-instructing-the-reverse subclasses stay unaddressed.
- *Option C, discriminating, CRITICAL*: "the defect class is real and currently caught only by
  ad-hoc orchestrator diligence... that survives only as long as whoever is orchestrating happens
  to keep asking for it. Status quo leaves catch-rate dependent on unenforced, non-auditable
  discretion."

**Critic B** — Risk/Maintainability/Complexity/Reversibility/Consistency:
A = 2/2/2/2/2 (2.00); B = 3/4/4/5/5 (**3.95**); C = 1/2/5/5/3 (2.85). Winner: **Option B**,
margin 27.8%.
- *Option C, discriminating, CRITICAL*: status quo "recreates the exact fragility the issue exists
  to close" — with Risk weighted 30/100, this is the dominant discriminator against C.
- *Option A, discriminating, NOTABLE*: "an unconditional 'independently re-verify every
  load-bearing claim' mandate is itself a prose instruction the reviewer self-reports compliance
  with — it recreates the same self-report-trust failure mode one level up... with no mechanical
  check comparable to `V-TEST-10`'s diff-pattern detection."
- *Option A, discriminating, NOTABLE*: the blast-surface step "has no scoping or cap and applies
  unconditionally to every PR forever — on a large diff this is unbounded reviewer-turn cost with
  no escape hatch, unlike every other trigger-gated `reviewer.md` section."
- *Option B, discriminating, NOTABLE*: "only mechanizes one of roughly six observed defect
  subtypes"; the rest "stay entirely dependent on prompt discretion, same as status quo."
- *Option B, discriminating, MINOR*: placement beside `V-TEST-10` "matches the established
  narrow-spot-check precedent... lowest integration risk of the three options."
- *Option A, domain-inherent, MINOR*: the "pays for itself" evidence was two **targeted, scoped**
  spawn-prompt instructions, closer in shape to a narrow instruction than to Option A's blanket
  every-claim mandate — "A over-generalizes it, B doesn't capture it at all."

**Both critics score B as a clear winner over A on this rubric**, primarily by penalizing Option
A's Risk and Consistency columns for exactly the property the primary scored favorably: an
unconditional, narratively-judged (not mechanically-checkable) mandate. This is the single most
important output of this design note — see § Gate.

`scripts/design-aggregate.ts` was run against the primary matrix + both raw critic JSONs
(`weights` per above, `design_dominance_delta` default 30):

```json
{
  "status": "blocked",
  "winner": null,
  "reasons": ["dominance", "disagreement"],
  "scorer_results": [
    { "scorer": "primary", "winner": "Option A", "margin": 5.13 },
    { "scorer": "critic_a", "winner": "Option B", "margin": 22.78 },
    { "scorer": "critic_b", "winner": "Option B", "margin": 27.85 }
  ]
}
```

Two independent block reasons, not one: the primary and both critics don't even agree on the
winner (`disagreement`), and no scorer clears the 30% dominance margin over its own runner-up
(`dominance` — primary's own A-over-B margin is 5.1%, well short of 30%). This is not an
edge-case near-miss; it is a decision genuinely too close, and too contested, for any autonomous
tier to resolve.

## Component Decomposition

N/A — single-concern change. Whichever option is approved touches `reviewer.md` (new/extended
checklist section) plus, for Options A/B, one new row in `blackhole-vcodes.md` — this is the
same 1:1 V-code-definition/enforcement-site coupling all 100 existing rows in that table already
use, not a new boundary within the system. No new component, service, or module is introduced.

## Design Principles Validation

Scored against the primary's provisional Chosen (Option A), since that is the option under
scrutiny — not a claim that A is the eventual answer (see § Gate: the adversarial evaluation
above disputes exactly this).

| Axis | Score | Justification |
|---|---|---|
| SRP | `~` Contestable | One section bundles 4 distinct sub-checks (source-verify, blast-surface, unfalsifiable-test, docs-grep). `reviewer.md` elsewhere keeps these as separate numbered sections (§18 vs §23) — bundling is a legitimate SRP question the human gate should weigh, not a settled violation. |
| DRY | `~` Contestable | Generalizing the narrow spot-checks already at §§5/8/23 into one blanket mandate either subsumes them cleanly or restates the same "verify, don't trust" idea a fourth time in slightly different words — depends on how the eventual prose is drafted, not decidable from the option description alone. |
| KISS | `◐` Blind spot | Both critics independently converged on the same weakness: an unconditional, narratively-judged obligation (no mechanical detection criterion, no scope cap) is the opposite of "minimal design, avoid premature abstraction." The primary's own scoring under-weighted this before critique. |
| YAGNI | `~` Contestable | The underlying defect is real and evidenced twice over inside this campaign, not speculative — but the *breadth* of the intervention (every load-bearing claim, every PR, forever) is broader than the evidenced need (a handful of specific defect subclasses), which is the textbook YAGNI tension. |
| Pattern check (established spot-check precedent) | `~` Contestable | Item (iii) alone matches the established narrow-spot-check pattern cleanly (✓, per both critics). Items (i)/(ii) depart from it into unscoped, uncapped, unconditional territory that no existing `reviewer.md` section currently occupies. |

## Refactoring Impact Analysis

Grepped every existing citation of a `reviewer.md` section number to check whether adding new
content would break a consumer:

| Consumer | Classification | Note |
|---|---|---|
| `src/references/blackhole-vcodes.md:34` (`V-TEST-10` → `reviewer.md §23`) | TRANSPARENT | Any new section is appended after §29 (current last section); no existing section number shifts, so this citation stays correct under either Option A or B. |
| `src/references/blackhole-vcodes.md:51` (`V-DOCFACT-01` → `reviewer.md §18`) | TRANSPARENT | Option A leg (iv) extends §18's trigger *in place* rather than moving or renumbering it. |
| `src/references/review-core.md`, `merge-gate.md` (per-mode dispatch tables referencing numbered `reviewer.md` sections) | TRANSPARENT | Append-only placement (new §30, and §31 for the V-code sub-check if kept separate) leaves every existing section-number cross-reference untouched. |

Zero BREAKING consumers under either Option A or B, **conditional on append-only placement** —
this was a real design choice, not a default: inserting the new section earlier in the numbering
(e.g., right after §0 for prominence) would have forced renumbering every section from the
insertion point onward, which would have made every row above BREAKING instead of TRANSPARENT.
Append-only was chosen specifically to keep this analysis clean. `scripts/lib/build/facts.ts`'s
`VCODE_TABLE_ROW_COUNT` (currently 100) would need a `+1` bump for Options A or B (new `V-TEST-11`
row) — a mechanical, single-line, non-breaking change, not a consumer-impact risk.

## Assumption Audit

| # | Assumption | Status | Note |
|---|---|---|---|
| 1 | The evidenced catch-rate (fresh session: 2 catches; queue notes: 4 orchestrator errors + 3 disproved premises + a 7-test unfalsifiable suite; issue body: ~1/12 PRs) generalizes beyond these specific reporting instances | `~` Contestable | All three data sources are drawn from the same small set of recent, unusually-scrutinized turns on two closely related campaigns — not an independently sampled baseline. |
| 2 | An unconditional prose instruction ("independently re-verify every load-bearing claim") is actually followed rather than merely claimed-followed | `◐` Blind spot | Both critics flagged this independently: Option A's mandate has no mechanical enforcement, so a reviewer pass could self-report compliance without truly tracing control flow — recreating the exact self-report-trust failure this issue exists to close, one level up. |
| 3 | Appending new sections at the end (§30+) avoids renumbering every existing citation | `✓` Validated | Confirmed by direct grep of every `reviewer.md §N` citation across `blackhole-vcodes.md`, `review-core.md`, and `merge-gate.md` (§ Refactoring Impact Analysis above) — append-only leaves all of them TRANSPARENT. |
| 4 | The "what would this assertion do if the bug were present" heuristic is mechanically well-defined enough for consistent reviewer application | `~` Contestable | Works cleanly for the cited examples (CSS-position test, argv-flattening stub); less clear for an integration test spanning multiple layers where "the bug" isn't localized to one assertion. |
| 5 | `.blackhole/config.json`'s `autonomy.design_autonomy` sub-field defaults to `true` when the `autonomy` block is present but that sub-field is unset | `✓` Validated | Confirmed by reading `config-template.md`'s own contract note directly ("absent block or an unset sub-field falls back to that sub-field's own default... `design_autonomy: true`"), not inferred from the block's presence/absence alone — this campaign's `config.json` has an `autonomy` block with `mode: full` but no explicit `design_autonomy` key, which resolves to the default `true`, not "off." Getting this wrong by inference rather than by reading the cited source would have been exactly the failure mode issue #795 is about. |
| 6 | Independent-verification cost is bounded rather than unbounded per PR | `◐` Blind spot | The reporting engineer's "paid for itself every time" claim is anecdotal — one engineer, ~12 PRs, no comparison group, and no token/turn measurement was collected either for the informal practice or for what Option A's mandate would cost if applied literally to every load-bearing claim on every future PR. |

## Gate

`.blackhole/config.json` has an `autonomy` block (`mode: full`) but does not set
`autonomy.design_autonomy` explicitly. Per `config-template.md`'s own contract note, an unset
sub-field falls back to its documented default — `design_autonomy: true` — so the config gate for
this decision **is** on (see Assumption 5 above), and `scripts/design-aggregate.ts` invocation is
mandatory, not skippable, per `planner.md` §4.8 (skipping it would itself be a `V-AUTO-01` BLOCK
finding).

The script was invoked with the primary's matrix, both critics' raw JSON, and the refactoring
impact rows above (`design_dominance_delta` default 30). Its verdict, reproduced in full in
§ Adversarial Evaluation: **`status: "blocked"`**, reasons `["dominance", "disagreement"]`. The
planner does not substitute its own judgment for this — per ADR-010 D4, only the script's
computed verdict authorizes `ready`, and it did not compute one. This design returns to a human
approval gate.

### What the owner needs to decide (R-003 executive summary)

**What, in substance**: whether to add a new, unconditional (applies to every future PR, forever)
`reviewer.md` obligation requiring independent source-verification of load-bearing implementer
claims plus a "blast-surface" scan (Option A); or to adopt only the one clearly mechanical piece
of that proposal — a new V-code for a test that could never have failed even if the bug it claims
to cover were present (Option B); or to make no protocol change and continue relying on
orchestrator spawn-prompt discretion (Option C).

**Why this gate fired**: `needs_design` resolved `TRUE` at confidence 85 (a computed judgment,
not a cautious-default flip). The design-aggregate script then independently computed
`status: blocked` for two separate reasons — the primary planner and both blind critics do not
agree on the winning option (`disagreement`), and no scorer's own margin over its runner-up
clears the required 30% dominance threshold (`dominance`, primary's own margin was 5.1%). This is
an intentionally-designed autonomy tier declining to decide a genuinely contested trade-off, not
a rubber-stamped block.

**Evidence**: issue #795 body (verbatim in § Requirements Framing); `queue.json` issue 795 `notes`
field (in-campaign confirming instances: #774/#767/#710 disproved premises, review-743's
7-test unfalsifiable suite); this session's fresh reviewer catches (PR #818/issue #804
tilde-expansion bypass, PR #819/issue #788 subcommand-normalization gap); `reviewer.md:464-517`
(§23 `V-TEST-10`, the nearest existing precedent, which explicitly does not cover a congenitally
unfalsifiable test); both blind critics' full JSON (§ Adversarial Evaluation); the
`design-aggregate.ts` run's own output (`status: blocked`, `reasons: ["dominance",
"disagreement"]`, reproduced above).

**Per-option consequence, including the strongest case for what is not recommended**:

- **Option A (comprehensive)** — the primary's own provisional Chosen, but **not the design
  note's final recommendation**, because both independent blind critics scored it worst on Risk
  and Consistency for the same concrete reason: an unconditional, narratively-judged mandate with
  no mechanical detection criterion and no scope cap is a materially different (and riskier) kind
  of obligation than every other unconditional `reviewer.md` section (§0, §26), which are either a
  bright-line rule or narrowly diff-triggered. Strongest case for choosing it anyway: it is the
  only option that closes all four legs the issue names, and this campaign's own history already
  shows the narrower catches (blast-surface-shaped: tilde-expansion, subcommand-normalization)
  came from exactly this kind of instruction, not from a mechanical check.
- **Option B (narrow V-code only)** — both critics' preferred option (margins 22.8% and 27.8%,
  though below the 30% autonomous threshold). Strongest case against: it mechanizes only the
  "structurally unfalsifiable test" subclass — 2 of 6 cited defect instances — leaving the
  conflict-resolution silent-revert, no-DOM-allowlist, and docs-instructing-the-reverse subclasses
  exactly as unprotected as status quo. Chosen by both critics anyway because it is cheap,
  reversible, fits the established narrow-spot-check precedent exactly, and does not recreate a
  self-report-trust problem one level up the way Option A's own mandate does.
- **Option C (status quo)** — recommended by no scorer; every scorer's own weighting put it last
  or tied-last, driven almost entirely by the Risk column (30/100 weight) given the issue's own
  evidence that the current ad-hoc practice "survives only as long as whoever is orchestrating
  happens to keep asking for it." Strongest case for it anyway: zero implementation cost, zero
  risk of over-scoping `reviewer.md` into an unbounded per-PR obligation, and the option every
  future maintainer can revisit with full information once real per-PR cost data exists for
  Option A or B.

No option is recommended over the others by this design note — that is the substantive output of
the adversarial evaluation, not an omission. The owner's decision is between closing more of the
defect surface at real, ongoing, per-PR cost (A), closing a narrower, cheaply-mechanizable slice
of it now (B), and deferring (C) until either more data exists or a mechanically-checkable version
of the broader mandate can be designed.

## Blast Radius (every surface that must move together, if approved as-is)

- `src/agents/reviewer.md` — new §30 (Option A: full section; Option B: a `V-TEST-11` sub-bullet
  appended to existing §23), plus all generated dist trees per `scripts/lib/build/targets.ts`.
- `src/references/blackhole-vcodes.md` — new `V-TEST-11` row (Options A/B only); `VCODE_TABLE_ROW_COUNT`
  100→101 in `scripts/lib/build/facts.ts`.
- Option A only: `src/agents/reviewer.md` §18 (`V-DOCFACT-01`) trigger extended in place for leg
  (iv) — no new V-code, no renumbering.
- Not touched by this design: `config-template.md` (no new config knob proposed — an unconditional
  section needs none, and introducing a speculative gating flag before the human even picks an
  option would itself be a `V-YAGNI-01` violation of this note's own advice).
