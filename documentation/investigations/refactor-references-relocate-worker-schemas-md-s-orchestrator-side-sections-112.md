---
type: analysis
status: current
created: 2026-09-04
last_updated: 2026-09-04
review_trigger: "on file change"
issue: 726
confidence: 88
computed_at_revision: 1
---

# Investigation: issue #726 — relocate worker-schemas.md's orchestrator-side sections

## Symptoms

The router flagged issue #726's premise as likely stale/superseded before dispatching this
investigation. Router's stated reasoning:

- `worker-schemas.md`'s targeted sections (`## Flush request`, `## Orchestrator validation`,
  `### Barrier triage`, `### Blocked-iteration escalation`) still exist unmoved.
- ADR-007's 2026-09-04 post-acceptance amendment ("R-19 item 1 accepted with expiry", #802/#844)
  accepted `worker-schemas.md`'s LOC as-is, with an expiry: "revisit when `worker-schemas.md`
  next approaches 850 lines, or at the next `ADR_WATCH_ITEMS` audit, whichever comes first."
- Live `worker-schemas.md` measures 794-795 LOC — below the 850-line figure quoted in the
  amendment, superficially suggesting the expiry hasn't fired.
- The issue's proposed destination, `orchestrator-runtime.md`, has only ~20 LOC of budget
  headroom (223/243 `CONTENT_GATE_BUDGETS`) — nowhere near the ~112 LOC to relocate.

Task: determine whether #726 is (a) closeable as superseded, (b) still valid but needing
re-scoping to a new destination file, or (c) unaffected and should proceed exactly as written.

## Hypotheses

Ranked before testing, per the evidence-strength-vs-accessibility gate:

**Initial (naive) rank — H1 first.** H1 mirrors the router's own framing and requires no further
reading beyond the numbers already quoted — the *accessible* reading, not necessarily the
strongest-evidence one. Per the sub-mode gate, this is grounds to demote H1 in confidence
ranking even though it is tested first (it happens to also be the cheapest test — a single
existing script run that is dispositive for H1 either way, and directly bears on H3).

1. **H1 — Superseded/closeable.** ADR-007's accept-with-expiry amendment already resolved
   `worker-schemas.md`'s LOC pressure via #802's Implementer-section split (970 → 794 LOC); at
   794 LOC the file is under the 850-line figure the amendment names, so the expiry condition
   hasn't fired and #726 can close as moot.
   - *For:* the amendment's own prose: "accepted as-is rather than raised or split
     independently... Expiry: revisit when `worker-schemas.md` next approaches 850 lines...".
     Current LOC (794-795) < 850.
   - *Against:* the expiry clause is a **disjunction** — "...850 lines, **or** at the next
     `ADR_WATCH_ITEMS` audit, **whichever comes first**." The amendment only settled "R-19 item
     1" (whether to raise/split further *right now* for LOC reasons); "R-19 item 2" in the same
     amendment entry was a *different* extraction (the Implementer role-contract section, via
     #802) — not the Flush-request/Orchestrator-validation content #726 targets. Untested
     against the live `ADR_WATCH_ITEMS` check at hypothesis-formation time.

2. **H2 — Still valid, but destination must become `orchestrator-runtime.md` with a raised
   budget** (i.e., the issue's *primary*-named destination is authoritative and the AC's "or a
   new `flush-request.md`" is only a fallback of last resort).
   - *For:* AC bullet 1 names `orchestrator-runtime.md` § Triage first, with the new-file option
     parenthetical.
   - *Against:* This is the more *convenient/literal* reading (take the first-listed option)
     rather than the evidence-favored one — it ignores the budget math and the established
     campaign precedent (see H3). Demoted below H3 before testing.

3. **H3 — Still valid and current; proceed using the issue's own already-declared fallback (a
   new dedicated file), not `orchestrator-runtime.md`.** The concern is a content-ownership/SRP
   argument independent of any LOC threshold, and it has not been addressed by #802.
   - *For:* (evidence gathered below)
   - *Against:* none surviving verification (see Root Cause).

## Root Cause

(Root Cause here is read as: which hypothesis holds, and why.)

**Test 1 (cheapest — discriminates H1 vs. H3 directly): run the live `ADR_WATCH_ITEMS` check.**
Delegated to the actual check script rather than asserting the LOC comparison by hand:

```
$ bun -e "import { runChecks } from './scripts/checks/adr-watch.check.ts'; console.log(JSON.stringify(runChecks()))"
[{
  "id": "V-WATCH-01",
  "ok": true,
  "detail": "ADR-007 — src/references/worker-schemas.md: measured 794, exceeds 700-LOC
  file_loc watch threshold (Rejected-alternatives revisit trigger; reports the ADR-007
  threshold independently of CONTENT_GATE_BUDGETS' own ratcheted ceiling (#492), so the
  original number stays visible even after the budget was raised.); ..."
}]
```

`ADR_WATCH_ITEMS` (`scripts/lib/build/facts.ts`) declares the revisit trigger for
`worker-schemas.md` as **`file_loc: 700`** — a number deliberately kept separate from (and lower
than) `CONTENT_GATE_BUDGETS`'s own ratcheted ceiling (currently 953), precisely so a budget raise
can never silently absorb this trigger. At 794-795 live LOC, this threshold **is already
exceeded, right now** — the "next `ADR_WATCH_ITEMS` audit" leg of the amendment's disjunctive
expiry has already fired (the check exists and reports red), independently of whether the
798-vs-850 comparison the router used has fired. **H1 is refuted**: the premise "already
resolved, under the 850-line trigger" only checked one leg of an "or" condition and missed that
the other leg already tripped.

**Corroborating check: is #726's concern actually a LOC-threshold concern, or something else?**
Read the issue's own evidence (mirrored verbatim from
`documentation/plans/plan-retrospective-v0.21.0-remediation.md` § R-19, lines 379-388): "§ Flush
request... and § Orchestrator validation / Barrier triage / Blocked-iteration escalation... **are
not worker return schemas**; `hook-schemas.md` (#473) is the precedent for extracting
non-contract content." This is an SRP/content-ownership argument — these sections describe what
the *orchestrator* does with a worker's output, not what a worker returns — stated independently
of any LOC number. The 850-LOC AC bullet is a **validation condition on the resulting file**
("no budget change needed after the move"), not the *reason* to do the move.

Read `worker-schemas.md`'s actual `## Orchestrator validation` section (lines 753-795, confirmed
below): its three subsections cross-reference `orchestrator-runtime.md` § Triage, § Error
Classification, and § Background worker barrier **repeatedly** (3 distinct citations) — the
content is already conceptually part of `orchestrator-runtime.md`'s domain; it is only physically
misplaced. This corroborates the SRP argument and is independent of the ADR-007 LOC amendment
entirely. **The ADR-007 accept-with-expiry amendment ("R-19 item 1") only settled the LOC-driven
half of R-19's motivation** (whether the file needed *another* split right now to stay under a
threshold) — it explicitly recorded a *different* extraction as "R-19 item 2" (the Implementer
section, via #802), never touching the Flush-request/Orchestrator-validation content #726 names.
**LOC-threshold resolution via #802 does not supersede #726.**

**Test 2 (verify the issue's own arithmetic, don't trust it uncritically):** re-read
`worker-schemas.md` directly.

- `## Flush request (...)`: lines 633–701 inclusive = **69 LOC** — matches the issue's "69 LOC"
  claim exactly.
- `## Orchestrator validation` (+ `### Barrier triage`, `### Blocked-iteration escalation`
  subsections): lines 753–795, the **last section in the file** (795 total lines) = **43 LOC** —
  matches the issue's "43 LOC" claim exactly.
- Removing both (a non-contiguous pair — `## Partial result`, a worker return schema that stays,
  sits between them at lines 702-751) drops `worker-schemas.md` to 795 − 69 − 43 = **683 LOC**,
  clearing both the 700-LOC `ADR_WATCH_ITEMS` trigger and the 953-LOC `CONTENT_GATE_BUDGETS`
  ceiling with no `worker-schemas.md` budget change — satisfying AC bullet 2 as written.

The issue's line counts and rationale are current and accurate, not stale.

**Test 3 (budget math for both candidate destinations):**

- `orchestrator-runtime.md`: `CONTENT_GATE_BUDGETS['src/references/orchestrator-runtime.md']` =
  `{ maxSectionLoc: 156, maxFileLoc: 243 }` (`scripts/lib/build/facts.ts`). Live file: 223 LOC
  (re-verified via `wc -l`, matches the router's ~222 figure). Headroom = 243 − 223 = **20 LOC**.
  Even the *smaller* piece alone (43 LOC, § Orchestrator validation) exceeds this headroom by 23
  LOC; the 69-LOC Flush-request piece exceeds it by 49 LOC; both together (112 LOC) exceed it by
  92 LOC. **No combination fits without raising `orchestrator-runtime.md`'s ceiling** — the
  router's math is confirmed, not stale.
- New file (the issue's own named fallback, "or a new `flush-request.md`"): needs no existing-
  file budget renegotiation — it needs a **new** `CONTENT_GATE_BUDGETS` row, exactly the pattern
  already used twice in this campaign: `hook-schemas.md` (#473, extracted from
  `worker-schemas.md`) and `implementer-schemas.md` (#802, extracted from `worker-schemas.md`,
  same source file as this issue). Both precedents extracted non-fitting content into a
  dedicated new file rather than raising an existing file's ceiling. **The new-file path is the
  one consistent with established precedent**; raising `orchestrator-runtime.md`'s ceiling by
  90+ LOC to accommodate a one-off relocation would be the outlier choice in this campaign, not
  the norm.

**Dependency check:** #726 lists `depends_on: [710]` in `queue.json`. Issue #710 (R-07,
`ADR_WATCH_ITEMS` + `V-WATCH-01`) is **CLOSED** (verified via `gh issue view 710`), and
`queue.json`'s own notes already record "turn 18 PROMOTED blocked -> ready: every depends_on
entry reached a terminal state (710)". #726 is unblocked.

## Resolution

**Disposition: proceed as written — using the issue's own already-declared fallback.**

None of the three candidate dispositions in the task ("close as superseded", "re-scope", "proceed
as written") is a clean fit in isolation, because the issue's own AC already names two
destinations as an explicit either/or ("`orchestrator-runtime.md` § Triage (or a new
`flush-request.md`)"). The evidence above rules out the first option (budget math) and rules out
closure (the SRP concern is real, current, and not addressed by #802's unrelated Implementer
split; the `ADR_WATCH_ITEMS` revisit trigger for `worker-schemas.md` is tripped right now). That
leaves the issue's *own* stated alternative — a new dedicated file — which is also the option
consistent with the `#473`/`hook-schemas.md` and `#802`/`implementer-schemas.md` precedent this
campaign has used repeatedly for exactly this source file. This is not a scope rewrite requiring
a new plan negotiation; it is selecting the branch the issue already offered.

**One open sub-decision left for the planner** (not resolved here — plan-level, not
investigation-level): whether both extracted sections (Flush request, 69 LOC; Orchestrator
validation/Barrier triage/Blocked-iteration escalation, 43 LOC) land in **one** new file named
`flush-request.md` (as the issue literally names it, even though the second piece isn't about
flush requests thematically), or whether the second piece is better split into its own small file
or folded into a modest, precedent-consistent `orchestrator-runtime.md` budget bump (+23 LOC
minimum beyond current headroom) given its heavy existing cross-references into that file's own
§ Triage / § Error Classification / § Background worker barrier sections. Recommend the planner
resolve this against `hook-schemas.md`'s (#473) own scope precedent for what counts as one
coherent "non-contract content" extraction versus two.

**Recommendation to router/planner:** do not close #726; do not treat the ADR-007 amendment as
superseding it. Re-route to `plan` with the destination adjusted from `orchestrator-runtime.md`
to a new `src/references/flush-request.md` (or equivalent split, per the sub-decision above),
requiring a new `CONTENT_GATE_BUDGETS` row for that file and an `ADR_WATCH_ITEMS` re-point check
(mirroring how #802 re-pointed the Implementer watch item to `implementer-schemas.md`) rather
than a budget increase on `orchestrator-runtime.md`.
