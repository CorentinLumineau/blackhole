---
type: analysis
status: current
created: 2026-09-04
last_updated: 2026-09-04
review_trigger: "on file change"
issue: 802
confidence: 78
computed_at_revision: 1
---

# Analysis — Issue #802: Act on the three ADR watch thresholds V-WATCH-01 fires on

## Conventions Catalog

One row per current live measurement/threshold, each re-derived from the actual check code
(not trusted from the issue body), with `file:line` citation and cross-reference to the shared
parser it reuses.

| Item | File / section | Metric | Current (re-measured) | Watch threshold | Ratio | Since filed |
|---|---|---|---:|---:|---:|---|
| 1 | `src/references/worker-schemas.md` (whole file) | `file_loc` | **958** | 700 (`facts.ts:72`) | 1.37x | Unchanged — 958 at HEAD, 958 at `de392c4e` (the commit that landed the check, 2026-09-03) |
| 2 | `src/references/worker-schemas.md` § `## Implementer (\`implementer\`)` | `section_loc` | **179** | 80 (`facts.ts:79`) | 2.24x | Unchanged since filing |
| 3 | `src/references/phase-implement.md` § `## Git operations must not depend on inherited cwd (issue #516)` | `section_loc` | **49** | 15 (`facts.ts:86`) | 3.3x | Unchanged since filing |

Re-measurement method: ran `parseSectionLineCounts` (`scripts/checks/content-gates.check.ts`) —
the same fence-aware parser `adr-watch.check.ts:24` imports (V-INT-02: not re-implemented) —
directly against the live files. `measureAdrWatchItem` (`scripts/checks/adr-watch.check.ts:18-28`)
takes `Math.max(...sections)` over **all** `##` sections in the file for `section_loc`, not a
named section — see Architecture Coherence below for why this matters for item 3.

Growth-trend check: `git show de392c4e:<file> | wc -l` against HEAD's `wc -l` for both watched
files returns identical counts (958 / 190 total lines respectively) — zero growth in either file
since the check that surfaces this signal landed (2026-09-03) and since the issue was filed
("turn 18 immediately before #801 merged" per `queue.json`'s `notes` field). This confirms the
issue's own framing: day-one saturation, not further drift while unactioned.

**Sibling content-gate ceilings for the same two files** (`CONTENT_GATE_BUDGETS`,
`facts.ts:176-188`), re-measured live the same way:

| File | Metric | Current | Content-gate ceiling | % of ceiling |
|---|---|---:|---:|---:|
| `worker-schemas.md` | `maxFileLoc` | 958 | 970 (`facts.ts:181`) | 98.8% |
| `worker-schemas.md` | `maxSectionLoc` (Implementer) | 179 | 179 (`facts.ts:181`) | **100%** |

**#712 citation-format precedent** (issue AC #3's "amendment discipline"): confirmed via
`grep -rl "Post-acceptance amendments" documentation/decisions/` — three hits
(`INDEX.md`, `ADR-021-durable-artifact-staging.md`, `ADR-007-drift-proof-toolchain-reseating.md`).
The mechanically-enforced half of the discipline is narrow: `V-ADR-06`
(`scripts/checks/adr-supersession.check.ts:29-33`, `hasPostAcceptanceAmendmentCitingIssue`) only
requires the `## Post-acceptance amendments` section body to contain a literal `#<issue-number>`
substring — no prose-shape enforcement beyond that. The *stylistic* convention actually followed
by ADR-007's own entry (the one #802 points to as precedent, since it's the ADR being amended
here too) is:

```
- **YYYY-MM-DD — <short title> (#<issue-that-recorded-it>, recording #<source-PR-or-commit>).**
  <prose: what changed, which prior decision/rejected-alternative it reverses or amends,
  any retroactive-acceptance condition, and a citation to the mechanism that now makes a
  future recurrence self-disclosing (e.g. a V-code / check name).>
```

ADR-021's own `## Post-acceptance amendments` section uses a *different* shape (`### A1` … `###
A4` subsections with severity/decision-changed tags) — that format is for pre-Gate-2 adversarial
critique findings recorded post-acceptance, a different provenance than a retroactive
undisclosed-reversal disclosure. Since ADR-007 is the ADR item 1/2 would amend, the design track
should follow **ADR-007's own bullet format** above, not ADR-021's subsection format.

## Architecture Coherence

**Confirmed divergence between the two threshold mechanisms** (issue's point 2, AC-relevant):
`ADR_WATCH_ITEMS` and `CONTENT_GATE_BUDGETS` measure the *identical* value for `worker-schemas.md`
— both call the same `parseSectionLineCounts` and take the max `##`-section LOC — but declare
independently-set ceilings for it: 80 (watch, ADR-007's original rejected-alternatives number,
never revised) vs. 179 (content-gate, ratcheted at issue #323's *current-measured × 1.2* seed and
never re-ratcheted since). `facts.ts:73`'s own comment already documents this as intentional
("reports the ADR-007 threshold independently of CONTENT_GATE_BUDGETS' own ratcheted ceiling"),
so the divergence is not a bug — but it does mean the Implementer section is simultaneously
**2.24x over its advisory revisit threshold** and **at exactly 100% of its hard content-gate
ceiling**. A response that only raises the watch threshold (option b) would leave the
hard-gate proximity completely unaddressed — the two systems' purposes (revisit-trigger vs.
build-blocking budget) are distinct, but a plan that treats them as independent inputs to the
*same* underlying growth problem, rather than reconciling them, risks solving the advisory signal
while the load-bearing constraint (the 970/179 hard ceiling) stays maxed out.

**Item 3's target has drifted from its own justification note.** `facts.ts:83-88`'s note for the
`phase-implement.md` item explicitly names `"## Worker prompt must include (5-Field Delegation
Contract)"` (currently 36 LOC) as the section the 15-LOC threshold was calibrated against.
`measureAdrWatchItem` does not measure a named section, though — it takes the max over the whole
file, and the current maximum is a *different, newer* section,
`"## Git operations must not depend on inherited cwd (issue #516)"` (49 LOC), added by commit
`0dc64ecc` (issue #528) — a git-safety concern unrelated to the delegation-contract density the
note discusses. This is not a new pattern variant (no third implementation exists — one shared
measurement function, reused correctly), but it is a **target-identity gap**: raising the
threshold "to give the named section headroom" (response b, read literally) would not remove
today's trip, because the section actually driving the trip is a different one the note never
discusses. Any response to item 3 needs to first decide whether the check should keep measuring
"whichever section is currently largest" (current behavior) or pin to the originally-named
section — that decision is prior to picking (a)/(b)/(c) for item 3.

## Performance Baselines

Not applicable in the traditional latency/throughput/query-count sense — this is a docs-line-count
threshold issue with no runtime surface. The measurable analog (LOC-over-time) is reported above
under Conventions Catalog rather than fabricated as a runtime figure; the one relevant baseline
fact is the **zero-growth-since-filing** confirmation.

**Structural split-feasibility per item** (evidence only — response-shape decision left to the
design track per the spawn's scope boundary):

1. **`worker-schemas.md` file_loc (958/700, 98.8% of hard ceiling).** The file is organized into
   clearly separable `##` role-contract sections (Router, Planner, Investigator, Hunter,
   Implementer, Reviewer, plus protocol sections like "Flush request" / "Partial result"). A
   direct structural precedent exists: issue #473 already extracted `hook-schemas.md` out of this
   same file via the same kind of section-level split, leaving `worker-schemas.md`'s own row
   "unchanged, never raised" per that issue's own discipline (`facts.ts:143`). Splitting is
   low-effort by precedent, not novel.
2. **`worker-schemas.md` Implementer section (179/80, and separately at 179/179 = 100% of the
   content-gate hard ceiling).** Zero headroom remains under the hard gate. The same lever as
   item 1 applies at section granularity: extracting the Implementer role-contract section to its
   own file mirrors #473's `hook-schemas.md` extraction exactly — same file, same kind of section,
   same precedent.
3. **`phase-implement.md` dispatch section (49/15, worst ratio at 3.3x).** The actual max section
   (git-safety cwd-independence) is thematically self-contained and was added whole in a single
   commit (#528) — splitting it to its own reference file is structurally easy. Separately worth
   surfacing: this file's other sections range 12-36 LOC (`## Recovery (mixed worktrees)`: 3 LOC
   up to `## Worker prompt must include`: 36 LOC) — a 15-LOC ceiling sits below nearly every
   section in the file already, which is evidence a straight re-split-forever strategy may not be
   sustainable at this file's normal section size, distinct from whether *this particular*
   section should be split now.

## Sources

- `scripts/lib/build/facts.ts:67-89` (`ADR_WATCH_ITEMS`), `:176-188` (`CONTENT_GATE_BUDGETS`)
- `scripts/checks/adr-watch.check.ts:18-56` (`measureAdrWatchItem`, `findAdrWatchViolations`)
- `scripts/checks/content-gates.check.ts` (`parseSectionLineCounts`, shared parser)
- `scripts/checks/adr-supersession.check.ts:13-33` (`V-ADR-06` mechanical citation requirement)
- `documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md` § Post-acceptance amendments
  (the `#712` citation-format precedent)
- `documentation/decisions/ADR-021-durable-artifact-staging.md` § Post-acceptance amendments
  (contrasting subsection-critique format, not the one to follow here)
- `git log --oneline` on `src/references/worker-schemas.md` and `src/references/phase-implement.md`;
  `git show de392c4e:<file> | wc -l` vs. live `wc -l` (zero-growth-since-filing confirmation)
- Live re-measurement performed via `parseSectionLineCounts` against the checked-out files, this
  session, 2026-09-04
- `.blackhole/queue.json` issue 802 entry (`route.revision: 1`, `notes` field — filing timing)
