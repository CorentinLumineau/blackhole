---
type: plan
summary: "Release contract claim labels for issues a stop resets or triages, lane or no lane"
status: current
review_trigger: "on release"
created: 2026-11-27
last_updated: 2026-11-27
---

# Plan - Issue #1500

## Objective
Stop must release every contract claim label (`claim_labels`, e.g. `in-progress:claude`) the campaign put on an issue it worked, with no lane set. Release of dispatched `in-flight`/`merged`/`closed` entries already ships (#1605, #1617, #1650). The residual defect: `phase-stop.md` `--abandon` step 2 resets the killed workers' issues to `ready` (or `blocked`) before running `scripts/release-claims.ts`, and that script only considers `DISPATCHED_STATUSES`, so the abandoned issue keeps its label. The same holds for any issue a stop/drain triage turns `blocked`. Fix: `release-claims.ts` takes `--issues <csv>`, the issues this stop just triaged or reset, and treats them as the campaign's own regardless of queue status; keep/release logic is unchanged (open own PR keeps the claim).

## Touch-Paths
- `scripts/release-claims.test.ts` (tests first, fake forge via the existing `fake()` adapter, never the real forge)
- `scripts/release-claims.ts`
- `src/references/phase-stop.md` (abandon step 2 and drain step 3 pass `--issues`)
- `src/references/orchestrator-dispatch.md` (§ Contract claim labels: document `--issues`)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

Not touched: `src/agents/implementer.md`, `src/agents/reviewer.md` (token ceilings 11,300 / 14,000 stay as is).

## Documentation Impact
`src/references/orchestrator-dispatch.md` § Contract claim labels and `src/references/phase-stop.md` (both in Touch-Paths). `config-template.md` unchanged (no new config key).

## Task Steps
1. RED: in `scripts/release-claims.test.ts` add tests: (a) queue entry `ready`, `--issues 12` names it, label present, no open PR: released and commented; (b) same with an open PR linking it: kept; (c) a `ready` entry NOT named stays untouched; (d) `--issues` value not a comma list of positive integers throws `UsageError`; (e) `--issues` with no `claim_labels` prints empty sets, no forge read; (f) named issue absent from the queue is still released (it is the campaign's own). Run only this file via `with-test-lock` after `free -m` MemAvailable >= 2500 MB; confirm (a),(f) fail.
2. GREEN: in `scripts/release-claims.ts` add `issues` to the allowed flags, parse (`/^[1-9]\d*(,[1-9]\d*)*$/`), union with the `DISPATCHED_STATUSES` set, dedup. Reuse `releaseClaimLabels` unchanged (V-INT-02); no new module.
3. Prose: `phase-stop.md` abandon step 2 runs `release-claims.ts --campaign-dir .blackhole --issues <just-reset issues>`; drain step 3 passes the issues whose workers it triaged. Keep the report lines (`released`/`kept`) and Exit Invariant wording. `orchestrator-dispatch.md` documents the flag in one sentence.
4. One `bun run build` through `with-test-lock` to regenerate mirrors, then run the content-gates check for the touched sections (V-CONTENTGATE-01) and `release-claims.test.ts` once more. CI runs everything else.

## Acceptance Criteria
- **AC**: `bun test scripts/release-claims.test.ts` passes, including a test where a `ready` queue entry named by `--issues` with a claim label and no open PR is released with the comment (fails before the change).
- **AC**: a named issue with an open linking PR is kept (reported in `kept`), asserted in the same file.
- **AC**: an unnamed `ready`/`blocked` entry is never touched (asserted).
- **AC**: `grep -c -- "--issues" src/references/phase-stop.md` is >= 2 and every generated mirror carries the same text after the build.
- **AC**: no test calls the real forge: the file imports only the injected `adapter` option (`runReleaseClaims(argv, {adapter})`).

## Quality Gate
Touch-Paths declared; no schema/API change (CLI gains one optional flag, back-compatible); Pareto: Gain 7 x (11 - Effort 3) = 56 >= 30. Design note: recording claims in `queue.json` (issue proposal item 1) was weighed and rejected: it adds a second writer for the single-writer file and a state schema for no case the explicit `--issues` list does not cover, since the stop procedure already knows the issues it triaged. PR labels (item 3): no `in-progress:*` label is added to PRs by the campaign today, so nothing to release.
