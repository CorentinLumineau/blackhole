---
type: plan
summary: "Advisory review_trigger signal plus an offline grammar lint (on issue-close #N) for issue #1391"
status: current
review_trigger: "on issue-close #1391"
created: 2026-11-26
last_updated: 2026-11-26
---

# Plan - Issue #1391

## Objective

Owner decision PD-11 (2026-11-26, "advisory plus local grammar"): `review_trigger` stays an
advisory signal, and blackhole gains (1) one parseable issue-keyed trigger form,
`on issue-close #N`, (2) an offline grammar lint inside the existing advisory
`V-DOCHEALTH-03`, and (3) planner/doc-governance prose telling producers to emit the form when a
doc is obliged by an issue. No forge lookup, no deprecation step, no new V-code, no blocking
(owner scoped those out). Companion proposal filed: CorentinLumineau/mercure#168 (link it in the
PR body).

Pareto: Gain 7, Effort 4 (reduced scope: lint only), Priority 49 >= 30.

## Touch-Paths

- `scripts/lib/review-trigger-grammar.ts` (new: pure `parseReviewTrigger`, `findMalformedIssueTriggers`)
- `scripts/lib/review-trigger-grammar.test.ts` (new)
- `scripts/checks/doc-health.check.ts` (extend `evaluateDocTreeHealth` detail only; `ok` stays `true`)
- `scripts/verify.doc-health.test.ts` (one case: lint surfaces in V-DOCHEALTH-03 detail, never blocks)
- `src/references/doc-governance.md` (grammar subsection under Lifecycle Frontmatter)
- `src/agents/planner.md` (one sentence in Durable plan staging step 2: use the grammar when an issue obliges the re-read)
- `src/references/blackhole-vcodes.md` (V-DOCHEALTH-03 row text only, if the row wording lists its checks)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

## Documentation Impact

`src/references/doc-governance.md` (grammar, advisory framing). `planner.md` consumer sentence.
Owner-ruling ledger: no conflict found (read-only check; `ruling_conflicts: []`).

## Design

Grammar (SSOT in `review-trigger-grammar.ts`, cited from doc-governance.md, not restated):

- Machine-evaluable issue form: `^on issue-close #(\d+)$` (value after YAML unquoting).
- Every other value (the mercure enum, free text such as "on file change") is `opaque`: never a finding.
- Malformed issue-keyed: a value that is not the exact form but matches `/#\d+/` together with
  `/clos|merge/i` (e.g. "when #5228 closes", "on merge of the issue #4047 PR"). Reported as
  advisory in V-DOCHEALTH-03 detail: `review_trigger not in grammar (use "on issue-close #N"): <path>`.
- Not done here (out of scope per PD-11): checking forge issue state, marking plans deprecated.
  The parse result (`{kind: 'issue-close', issue}`) is the seam a later evaluator would consume.

Existing corpus check: the live `documentation/` tree uses only enum/free-text values containing no
`#N`, except possibly "on merge of the PR implementing this plan" (no `#N`, so opaque). Verify by
running the lint on the live tree once; any hit is reported, not fixed here.

## Task Breakdown

1. **Grammar module (TDD, test first).** Create `scripts/lib/review-trigger-grammar.ts` and its test.
   **AC**: `bun test scripts/lib/review-trigger-grammar.test.ts` passes with cases: exact form parses to issue number; `"when #5228 closes"` and `"on merge of the issue #4047 PR"` are malformed; `"on file change"`, `"on release"`, `""` are opaque; the test fails against a stub returning opaque for everything.
2. **Wire into doc-health.** In `evaluateDocTreeHealth`, append the malformed list to `details` using the already-parsed frontmatter pass (reuse `collectDocFiles`/`parseFrontmatterFields`; no second walk).
   **AC**: `bun test scripts/verify.doc-health.test.ts` passes with a new fixture case asserting a malformed trigger yields a V-DOCHEALTH-03 result with `ok: true` and detail containing the path, and a well-formed `on issue-close #12` yields no detail.
3. **Prose.** Add the grammar subsection to `src/references/doc-governance.md` (cite the module as SSOT, state advisory-only) and the one planner sentence.
   **AC**: `grep -c "on issue-close #N" src/references/doc-governance.md src/agents/planner.md` is >= 1 in each; doc-governance.md stays under the single-doc/content-gate ceiling (`bun run scripts/checks` content-gates result unchanged in CI).
4. **Regenerate mirrors once** (`bun run build` through with-test-lock, once), commit source plus generated trees.
   **AC**: CI `bun run verify` green on the PR head (quote job name and status).
5. **PR body** includes `Closes #1391` and a link to CorentinLumineau/mercure#168.
   **AC**: PR body contains both strings.

## Critical Files

- `scripts/checks/doc-health.check.ts`
- `src/references/doc-governance.md`

## Execution Strategy & Stop Conditions

- Keep the lint advisory: if any change makes V-DOCHEALTH-03 return `ok: false`, revert that change.
- If `doc-governance.md` or `planner.md` exceeds its content-gate ceiling after the edit, stop and trim the new prose rather than raising a budget.
- If the lint reports more than 10 live-tree hits, stop and report them to the orchestrator instead of widening the regex.
- Resource rules: run only the two changed test files locally via with-test-lock after MemAvailable >= 2500 MB; one build only for generated mirrors; CI does the rest.

## Quality Gate Results

- touch_paths_declared: PASS
- schema_baseline: PASS (no schema change)
- ac_mapping: PASS
- critical_files_exist: PASS
- mitigation_concrete: PASS
