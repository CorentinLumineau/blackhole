---
type: plan
summary: "Add a Queue health verdict, cap the Routing and Waves dashboard sections, and reconcile coordinator-dashboard.md's section list with formatDashboard()'s actual render order"
status: current
review_trigger: "on file change"
created: 2026-09-06
last_updated: 2026-09-06
related:
  - src/references/coordinator-dashboard.md
---

# Plan — Dashboard Queue Health Verdict, Section Caps, and Doc Reconciliation

Issue #929.

## Objective
`scripts/lib/campaign-status/dashboard.ts`'s `formatDashboard()` prints Scope/Turn/Queue-refreshed,
Forge, Queue-counts and Ledger-counts lines and stops — there is no derived health signal, so a
reader has to mentally combine three separate counters every turn to know whether the campaign is
actually moving. Two of its three list-rendering sections (`renderRoutingSection`,
`renderWavesSection`) have no output cap, unlike the third (`renderLedgerOpenSection`, which
already caps at 10 with an `…and N more` line). And `src/references/coordinator-dashboard.md`
documents an 11-section list, in an order that no longer matches `formatDashboard()`'s actual push
order, including a "Hunt" section (`renderHuntSection`) that does not exist anywhere in
`dashboard.ts` — zero occurrences confirmed by grep.

Split from #865 (child B of 2, sibling to #928's crash fix, which ships separately). All three
items below touch the same two files and are bundled deliberately — splitting further would
produce repeated overlapping diffs to one ~150-line pair for no gain. Re-verified against `main`
at `plan_base_commit`: PRs #931 and #924 only touched `campaign-status.ts`'s `main()`, never
`dashboard.ts` or the doc, so the surface is unchanged since the #865 split and no further split
applies here (`V-SCOPE-01`/split-test re-run, confirmed by `router-929`).

**Design Decision — verdict scope and label.** `main()` (`scripts/campaign-status.ts:112-140`)
calls `renderPluginDriftWarning()` **after** `formatDashboard()`, unconditionally — including a
clean `✓ Plugin cache: … clean.` line. Any verdict computed inside `formatDashboard()` therefore
always renders *above* the plugin-drift line, never beside or below it. An unqualified
`**Campaign:** ✓ HEALTHY` sitting directly above a `⚠ Plugin cache drift` warning would
misrepresent its own scope — it would read as a summary that subsumes drift, when in fact
`formatDashboard()` has no visibility into `plugin-drift.json` at all (that file is read directly
in `main()`, and `renderPluginDriftWarning` takes it as an explicit parameter — `formatDashboard`
never sees it).

The same applies to doc-health: confirmed zero references to `doc-health`, `docHealth`, or
`doc_debt` anywhere in `campaign-status.ts` or `scripts/lib/campaign-status/*`.
`.blackhole/doc-health.json` is consumed only by the orchestrator's own turn-start step
(`src/references/blackhole-state.md` § Doc-Health Signal) — `bun run status` never renders it.

**Resolution**: label the new line `**Queue health:**`, not `**Campaign:**`, and scope its inputs
to counts `formatDashboard()` already has in hand (`forge.ok`, `blocked.length`, `inFlight.length`
— the exact three the issue names). Plugin-drift and doc-health are **not** folded into this
verdict's inputs — doing so would pull `plugin-drift.json` reads into `dashboard.ts` (a new
file-read dependency `formatDashboard()` doesn't have today) and would still say nothing true
about doc-health, since that file is never read here at all. The narrow label is what keeps the
verdict honest about what it does and doesn't cover; this is a plan-level design decision, not an
ADR (no cross-cutting architectural constraint, no consumer outside this one function).

## Touch-Paths
- `scripts/lib/campaign-status/dashboard.ts`
- `scripts/lib/campaign-status/dashboard.test.ts`
- `src/references/coordinator-dashboard.md` plus all generated dist trees per
  `scripts/lib/build/targets.ts`

## Documentation Impact
`src/references/coordinator-dashboard.md` is both the affected companion doc and a declared
Touch-Path (build source) — it is reconciled in place (Task 7 below), not created new. No other
companion or consumer doc references `formatDashboard()`'s section list or the Hunt section by
name (confirmed by grep: `renderHuntSection` and `hunt_state` do not appear in `dashboard.ts`, and
no other `src/references/*.md` or `src/agents/*.md` file cites `coordinator-dashboard.md`'s
now-stale section numbering). No `documentation/` companion file needs a new row beyond the
durable plan promotion itself (§ Staging below).

## Critical Files
None — this diff touches only dashboard-rendering code (a read/format layer over the campaign
queue and findings-ledger JSON state, plus forge counts, all already loaded elsewhere) and a
reference doc. No database client, auth config, or other highly sensitive pre-existing touchpoint
is in scope.

## Codebase Conventions
- **One `render*Section` helper per independently-addable section** — `dashboard.ts`'s own header
  comment states this convention explicitly ("each returns the section's lines … or `[]` when the
  section has nothing to show"). `computeQueueHealth`/`renderQueueHealthLine` follow the same
  shape: a pure classifier plus a pure line-renderer, mirroring how `renderRouteChain` (in
  `queue.ts`) separates chain computation from line formatting.
- **Reuse the existing cap pattern, do not invent a second variant (`V-INT-03`)**. Confirmed:
  `renderLedgerOpenSection` (`dashboard.ts:120-141`) is the only one of the three list sections
  that already caps (`.slice(0, 10)` + `…and N more`, `dashboard.ts:132,141`);
  `renderRoutingSection`/`renderWavesSection` have zero `.slice()` calls. Rather than duplicating
  the 3-line cap-and-overflow idiom a third time (which would itself become the "second variant"
  V-INT-03 warns against, just duplicated instead of merely copied), this plan extracts one shared
  `SECTION_CAP` constant and `capOverflowLine()` helper in `dashboard.ts`, and refactors
  `renderLedgerOpenSection` to call it too — one behavior, three call sites, matching the file's
  own `formatScopeLabel` precedent ("shared … so the two can never drift into two wordings for the
  same scope (V-DRY-01 / V-INT-02)").
- **Exported-for-direct-testing convention**: `renderLedgerOpenSection` is already exported solely
  so `dashboard.test.ts` can test it without going through `formatDashboard()`
  ("Exported: ADR-042 Task 2(d)/(e) unit-test this directly"). `renderRoutingSection` and
  `renderWavesSection` gain the same `export` keyword for the same reason — no behavior change,
  just matching the established test-access pattern.
- **Barrel re-export discipline**: `scripts/campaign-status.ts` re-exports a fixed subset of
  `dashboard.ts`'s exports for `scripts/campaign-status.test.ts`'s consumption. This plan adds no
  new re-export there — `computeQueueHealth`, `renderRoutingSection`, and `renderWavesSection` are
  tested directly against `./dashboard.ts` from `dashboard.test.ts` (matching how
  `renderLedgerOpenSection` is already tested), so `scripts/campaign-status.ts` and
  `scripts/campaign-status.test.ts` are untouched by this plan (`V-KISS-01` — no export surface
  grows beyond what a test actually needs).

## Database/API Schema Changes
N/A — no schema, config-key, or public API surface changes. `formatDashboard()`'s own signature
(`opts: {...}`) is unchanged; the new verdict line and section caps are additive output only.

## Excluded from scope (flagged, not silently absorbed)
The issue's "Reviewer exposure" section flags `V-UX-05` (data encoding) for the bare-number
confidence rendering at `scripts/lib/campaign-status/queue.ts:61-73`
(`` conf split:0.8 design:0.6 `` etc., no scale or context) and asks the plan to decide in/out of
scope rather than silently absorb it. **Decision: out of scope for this issue.** `queue.ts` is a
different file than the two Touch-Paths above, the confidence-rendering concern is orthogonal to
the verdict/caps/doc-reconciliation trio this `size:s` issue was split out to cover, and folding
it in would expand Touch-Paths past what was scoped and reviewed at split time
(`V-SCOPE-01`/`V-SCOPE-02`). If a reviewer raises `V-UX-05` against this diff, the correct
disposition is "not in this diff's Touch-Paths" (`queue.ts` untouched) with a recommendation to
file it as its own issue — not a fix folded in here.

`V-UX-01` (information hierarchy) is confirmed in scope regardless of `route.ui: false`:
`reviewer.md`'s Information Hierarchy Audit trigger names dashboards/lists explicitly, independent
of whether the surface is a web UI or terminal markdown. Pre-empting it here: the verdict line and
the two capped sections are each already tiered (at-a-glance verdict → summary counts → capped
detail rows → an explicit "…and N more" pointer to the uncapped truth in `queue.json`/ledger
directly) rather than a flat unbounded dump, which is exactly what `V-UX-01` checks for. No
further design change is needed to satisfy it; this note exists so a reviewer sees it was
considered, not discovered.

## Execution Strategy & Stop Conditions
- If refactoring `renderLedgerOpenSection` to call the new shared `capOverflowLine()` helper
  changes any of its four existing test assertions in `dashboard.test.ts` (occurrences/
  last_seen_at rendering, the no-suffix case, the severity-then-recency sort, or the 350-row cap
  test), halt before proceeding to Task 5 — the refactor is scoped to be output-identical, and any
  assertion diff means the extraction changed observable behavior, not just its implementation.
- If the doc reconciliation (Task 7) still leaves any `render*Section` function in `dashboard.ts`
  undocumented in `coordinator-dashboard.md`'s numbered list, or any documented section number
  with no matching function, stop before merging — the two lists must match by direct
  side-by-side comparison (AC 3), not by memory or partial review.
- If `bun run build` (Task 8) reports a diff in any generated target under
  `scripts/lib/build/targets.ts` other than the expected `coordinator-dashboard.md` copies (e.g.
  an unrelated file changes because the working tree was stale), abort the build step and rebase
  onto current `main` before re-running — do not hand-edit a generated target to paper over drift.
- If the plan-quality-gate CLI (Step 8, plan-time) reports any of `ac_mapping`,
  `critical_files_exist`, or `mitigation_concrete` as `false` after this plan is revised, revert
  to the prior passing revision of this plan file rather than merging a Standard-track plan that
  fails its own blocking gate.

## Task Breakdown
1. **TDD Baseline Verification**: Run `bun test scripts/lib/campaign-status/dashboard.test.ts scripts/campaign-status.test.ts` before any code change. — **AC**: baseline run recorded, pass/fail counts quoted in the completion evidence (expected: all green, since no source change has landed yet).
2. **Write failing tests — Queue health verdict**: In `dashboard.test.ts`, add a `computeQueueHealth` boundary-matrix `describe` block (forge unavailable → `degraded` regardless of counts; forge available + blocked > 0 + in-flight = 0 → `stalled`; the `inFlightCount` 0→1 boundary flipping `stalled`→`healthy`; the `blockedCount` 1→0 boundary flipping `stalled`→`healthy`; forge available + blocked = 0 + in-flight = 0 → `healthy`) importing `computeQueueHealth` from `./dashboard.ts`, plus one `formatDashboard`-level integration test asserting a `**Queue health:**` line appears. — **AC**: new tests fail on this commit (import of a not-yet-exported `computeQueueHealth` fails / the assertion finds no `**Queue health:**` line) before Task 6 lands.
3. **Write failing tests — Routing/Waves caps**: Add a `renderRoutingSection` test building 350 synthetic routed `IssueRow`s and asserting exactly `SECTION_CAP` (10) issue blocks render plus one `- …and 340 more` line; add a `renderWavesSection` test building a 350-issue linear dependency chain (issue *i* depends on issue *i-1*, producing 350 sequential waves) and asserting exactly 10 `**Wave N:**` lines render plus one `- …and 340 more` line — mirroring the existing 350-row `renderLedgerOpenSection` cap test. — **AC**: both tests fail on this commit (all 350 entries currently render, no `SECTION_CAP` export exists) before Task 5 lands.
4. **Extract shared section-cap helper**: In `dashboard.ts`, add a `SECTION_CAP = 10` constant and a `capOverflowLine(totalCount, shownCount): string[]` helper (returns `['- …and ${totalCount - shownCount} more']` when `totalCount > shownCount`, else `[]`); refactor `renderLedgerOpenSection` to slice with `SECTION_CAP` and call `capOverflowLine` in place of its current inline `if (openFindings.length > 10)` block, with no change to its rendered output. — **AC**: all four pre-existing `renderLedgerOpenSection` tests (occurrences/last_seen_at, no-suffix case, sort order, 350-row cap) still pass unchanged.
5. **Apply the cap to Routing and Waves**: Export `renderRoutingSection` and `renderWavesSection`; in `renderRoutingSection`, slice `routed` to `SECTION_CAP` before the render loop and append `capOverflowLine(routed.length, shown.length)`; in `renderWavesSection`, slice `waves` to `SECTION_CAP` before the `forEach` and append `capOverflowLine(waves.length, shown.length)` before the `unresolved` line. — **AC**: the two Task 3 tests now pass.
6. **Implement the Queue health verdict**: Add `computeQueueHealth(input: { forgeOk: boolean; blockedCount: number; inFlightCount: number }): 'healthy' | 'stalled' | 'degraded'` (degraded when `!forgeOk`, regardless of the other two; stalled when `forgeOk && blockedCount > 0 && inFlightCount === 0`; healthy otherwise) and `renderQueueHealthLine(verdict, blockedCount): string`; call both from `formatDashboard()` and push the resulting line immediately after the existing Ledger-counts line (before the blank-line separator that precedes `renderInFlightSection`). — **AC**: the Task 2 tests now pass; the verdict line is the 4th context line (Scope/Turn/Queue-refreshed, Forge, Queue, Ledger, **Queue health**) in every existing `formatDashboard` fixture in `dashboard.test.ts`.
7. **Reconcile `src/references/coordinator-dashboard.md`**: Rewrite the "Dashboard sections" numbered list to match `formatDashboard()`'s actual push order — 1 Header, 2 Counts (mention the new Queue health verdict and its three states here), 3 In-flight, 4 Blocked, 5 Ready, 6 Routing (note the `SECTION_CAP`/`…and N more` cap), 7 Waves (same cap note), 8 Completed, 9 Issues filed, 10 Ledger open, 11 Active workers — and delete the old "10. Hunt" entry entirely (confirmed zero `renderHuntSection`/`hunt_state` occurrences in `dashboard.ts`; nobody has claimed intent to build it, so deletion is the correct move per the issue's own instruction). — **AC**: `grep -c '^[0-9]\+\.' src/references/coordinator-dashboard.md`'s numbered items, read top-to-bottom, name the same 11 sections in the same order `formatDashboard()`'s `lines.push(...)` calls appear in `dashboard.ts`, checkable by direct comparison of the two lists; `grep -i hunt src/references/coordinator-dashboard.md` returns no match in the section-list body.
8. **Rebuild generated distribution targets**: Run `bun run build` so `coordinator-dashboard.md`'s compiled copies (every target `scripts/lib/build/targets.ts` produces for `src/references/*.md`, e.g. `.claude/skills/blackhole/references/coordinator-dashboard.md`) pick up Task 7's edit. — **AC**: `bun run build` exits 0; `git diff --stat` shows only the expected `coordinator-dashboard.md` copies changed across the generated trees, with identical content to the `src/` source (mirrored, not diverged).
9. **Verify Integrity**: Run the full project test suite and lint (`bun test`, `bun run lint` or the project's declared equivalents). — **AC**: full suite green and lint clean, both quoted verbatim in the completion evidence.

## Sprint Contract
Definition of done is the per-task AC above, restated once here for a single at-a-glance read:
baseline suite green before any change (Task 1); the verdict and cap tests are written and fail
for the expected reason before their implementation lands (Tasks 2-3, red-before-green, AC 4);
the shared cap helper preserves `renderLedgerOpenSection`'s existing output exactly (Task 4); the
new cap tests pass once applied to Routing/Waves (Task 5); the verdict line renders in the correct
position and every boundary case classifies correctly (Task 6); the doc's section list matches
the code's actual render order with the Hunt entry removed, verifiable by direct list comparison
(Task 7); every generated distribution copy mirrors the source edit (Task 8); the full suite and
lint are clean at the end (Task 9). Any task without a narrower AC above falls back to "all tests
and linters pass" — no task here lacks a narrower AC, so this fallback does not currently apply.

## Quality Gate Results
| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |
| `ac_sweep_conflict` | PASS |
| `ac_sweep_scope` | PASS |
| `touch_paths_ssot_gap` | PASS |
| `ac_facts_literal_bump` | PASS |
