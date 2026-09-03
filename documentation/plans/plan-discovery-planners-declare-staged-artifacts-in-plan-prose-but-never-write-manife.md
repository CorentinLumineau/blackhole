---
type: plan
status: current
review_trigger: on ADR-021 amendment
created: 2026-09-03
last_updated: 2026-09-03
---


# Issue #782 — Planners declare staged artifacts in plan prose but never write manifest.json

## Objective

Close the gap where a `planner` invocation narrates staged durable artifacts (analyze/plan/design
routes) in the plan document without actually writing the paired
`.blackhole/staged/<issue>/manifest.json` entry in the same spawn — the write instruction already
exists in `planner.md` at all three producer-route sites, but nothing states that prose narration
is not itself sufficient, and nothing makes the planner self-verify the write before returning.
Scope is explicitly narrower than #782's original framing: only the design/analyze/plan routes
(`produced_by: "planner"`). The review route's manifest write is `implementer`'s job by design
(`implementer.md` § Promote Review Artifact) and is out of scope here — that is #806's concern, a
different problem (circular verification) with no shared code path. The fix is route-conditional,
not blanket (§ Route-conditionality constraint below): it strengthens only the 3 already-valid
staging obligations, adds one explicit scope-boundary statement, and adds a mechanical guard
(`V-STAGE-04`) against the opposite mistake — instructing staging for a route/sub_mode pairing
that has no `documentation/` target.

## Touch-Paths

- `src/agents/planner.md` — plus all generated dist trees per `scripts/lib/build/targets.ts`
- `scripts/checks/staging-schema.check.ts`
- `scripts/verify.staging-schema.test.ts` — companion test file for the check above (existing
  file, extended with new fixtures + the updated `runChecks (real tree)` expectation); not named
  in the spawning instruction's touch-path list but required by `V-TEST-01/02` (tests are
  mandatory) and by the existing one-file-per-check test convention this repo already uses
  (`scripts/verify.<check-name>.test.ts` alongside every `scripts/checks/<check-name>.check.ts`,
  confirmed against `scripts/verify.staging-schema.test.ts` itself and `scripts/verify.adr-status.test.ts`).
  Flagging this explicitly rather than silently widening scope.

## Documentation Impact (docs_governance.enabled: true)

None — this is a prompt-wording and mechanical-check fix internal to the campaign harness
(`src/agents/planner.md`, `scripts/checks/`). No `documentation/` file describes the manifest
write instruction's wording; the authoritative schema description
(`src/references/blackhole-state.md` § Staging) is unchanged by this plan — only planner.md's
*compliance* with the existing schema is strengthened. No companion doc needs a follow-up edit.

## Critical Files

None — `src/agents/planner.md` and `scripts/checks/staging-schema.check.ts` are Touch-Paths
(one edited, one extended), not pre-existing sensitive touchpoints outside the diff.

## Codebase Conventions

| Convention | Where established | How this plan follows it |
|---|---|---|
| Manifest schema SSOT | `src/references/blackhole-state.md` § Staging — field table + JSON example | This plan does not change the schema; it only strengthens planner.md's instruction to actually write entries already defined there, and adds a check that planner.md keeps doing so |
| Fixed-phrase producer-literal scanning idiom | `scripts/checks/staging-schema.check.ts`'s `PRODUCER_LITERAL_RE` (scans planner.md/investigator.md/implementer.md for `` `field: "value"` `` literals) and its own `V-STAGE-01`/`V-STAGE-02` pattern | The new `V-STAGE-03` check reuses the same "read prompt text as a static string, scan for fixed markers" idiom — no new parsing framework, no runtime filesystem dependency on `.blackhole/staged/` |
| `(ADR-{NNN})` / `(analyze: issue #N)` mandatory citation suffix as a machine-checkable marker | `planner.md` §4.8 Trigger A and Step 4 Trigger B — a fixed literal suffix future tooling can grep for | The new mandatory-pairing callout follows the same pattern: a fixed literal sentence containing `does not satisfy ADR-021 D3`, repeated verbatim at each of the 3 producer-route staging sites, so `V-STAGE-03` can grep for it deterministically |
| `scripts/checks/*.check.ts` → `scripts/verify.*.test.ts` one-to-one test file pairing | Every existing check in `scripts/checks/` (confirmed for `adr-status.check.ts`, `staging-schema.check.ts`) | New `checkStagingInstructionPairing`/`findMissingMandatoryPairing` exports get their tests added to the existing `scripts/verify.staging-schema.test.ts`, not a new test file |
| `CheckResult` return shape (`{ id, ok, detail? }`), pure exported detector + thin wrapper split | `scripts/checks/check-utils.ts` and every existing check module | `findMissingMandatoryPairing` is a pure function taking `(content, anchors, phrase)` and returning a string array (mirrors `findManifestFieldNameMismatch`'s "name what's wrong, never a boolean" idiom already in this file); `checkStagingInstructionPairing()` is the thin `CheckResult` wrapper, added to `runChecks()`'s return array |
| `artifact-contract.md`'s Route → artifact table as SSOT for which routes are stageable | `.claude/skills/blackhole/references/artifact-contract.md` § Route → artifact table (7 rows: analyze, brainstorm, design, investigate, plan, review, runbook) | Cited in § Route-conditionality constraint below as the authoritative source of which routes have a live `documentation/` target; the new `V-STAGE-04` check does not re-derive route enum membership from it (that is already `V-STAGE-02`'s job against `blackhole-state.md`'s identical 7-route enum) — it instead enforces the one documented exception this table cannot itself express: `sub_mode: "research"` has no target regardless of route, per `blackhole-state.md:198` |
| Reuse of already-extracted producer literals | `scripts/checks/staging-schema.check.ts`'s `extractProducerFieldValueLiterals` (already called once per producer doc for `V-STAGE-02`) | `V-STAGE-04` calls the same extraction function again rather than inventing a second literal-scanning primitive (`V-INT-02`/`V-DRY-01`) |

## Bugfix classification

`task_type: bugfix` (stamped above). No `route` object exists on this queue entry (today's queue,
per `planner.md`'s route-first/content-fallback fallback); the issue is self-evidently a bug fix —
an existing, documented instruction is not reliably followed, verified against live campaign
state (see § Verified prerequisite state below), not a new feature or missing capability.

## Threat escalation check

No `route` object exists on this queue entry, so this bullet is inert per `planner.md`'s own
fallback (no route → no screen, no stamp). `threat_screen_passed: true` is stamped per the
3-question STRIDE-lite screen applied manually: (1) does this touch auth/authz? No. (2) does it
read or write user data? No. (3) does it add or modify an endpoint? No — this is prompt text and
a static doc-linting check, no runtime data path. Quick-Track-style screen passes; Standard track
is used regardless because the change spans multiple files with a required regression test, per
Step 2's own Standard-track criterion ("multi-file changes... logic additions").

## Verified prerequisite state (evidence, not part of the diff)

Read live campaign state before drafting this plan, to confirm or correct the spawn prompt's
six-for-six premise:

- `src/agents/planner.md` was read in full (488 lines). The manifest-write instruction is
  **present, not absent**, at all three `produced_by: "planner"` staging sites:
  - Step 4 (analyze route, Trigger B): `planner.md:44-46` — "append a manifest entry
    (`route: "analyze"`, ...) to `.blackhole/staged/<issue>/manifest.json`".
  - Step 7 (plan route, ADR-021 D3): `planner.md:73-76` — "Append manifest entries
    (`route: "plan"`, ...) to `.blackhole/staged/<issue>/manifest.json`... Never commit into
    `documentation/`".
  - Design Track §8, `ready` branch: `planner.md:346-351` — "Append both entries to
    `.blackhole/staged/<issue>/manifest.json` per that section's schema."
  - Design Track §8, `resume_context: design_approved` branch: `planner.md:403-408` — "stage
    both at ... via the same Bash heredoc + atomic `mv` write and manifest append as the `ready`
    branch above."
  - `src/references/plan-template.md` (the actual plan-body template, SSOT confirmed identical
    to its 5 build-output copies except for the generated-footer line) has **no** `## Staged
    Artifacts` heading anywhere — the "declares staging in the plan document's `## Staged
    Artifacts` section" framing in #782's own evidence table does not correspond to any
    templated section. Any such narration a planner produces is free-form prose, not a mandated
    template block — which is itself informative: nothing structurally ties "I wrote staging
    prose" to "I executed the staging write."
- Live `.blackhole/staged/` state (this campaign, read directly, not the issue's turn-18
  snapshot) corroborates the failure shape for the `plan` route specifically:
  - `.blackhole/staged/752/manifest.json` exists today but contains **only** a later-added
    `review`-route entry (`produced_by: "implementer"`) — no `plan`-route entry, even though
    `.blackhole/staged/752/review.md` shows a plan clearly ran. The `review` entry was written
    by a *different* agent (`implementer`, at promotion) at a *later* timestamp — it does not
    retroactively prove the planner's own write ran.
  - `.blackhole/staged/757/` does not exist at all — nothing was ever staged for that issue.
  - By contrast, `.blackhole/staged/{710,756,774,777}/manifest.json` each contain a correctly
    shaped `plan`-route entry (`produced_by: "planner"`, `target_kind: "new_file"` +
    `"append_row"`) matching a staged `plan-*.md` body file that exists on disk.
- **Conclusion — premise refined, not disproven**: the six-for-six table's "instruction present
  vs absent" framing does not hold literally (the instruction is present at every site). What
  the evidence does show is *non-uniform execution of a present instruction* under the same
  `docs_governance` config (`enabled: true`, `write_governance: true` — confirmed uniform via
  `.blackhole/config.json`, so the config gate is not the differentiator). This changes the fix:
  instead of filling an absent instruction, the fix (a) makes explicit that plan-body narration
  never substitutes for the manifest write, (b) adds a self-verification step so a compliant-hour
  planner catches its own omission before returning, and (c) adds a static regression guard so a
  future prompt edit cannot silently weaken or delete the instruction at any of the four sites.
  This does not disprove #782's premise that a wording fix is cheap and plausible — it narrows
  what "wording fix" must mean.

## Route-conditionality constraint (team-lead near-miss, folded in mid-plan)

The team lead spawned an `investigator` in `research` sub-mode with an explicit instruction to
stage its note, and the investigator correctly declined, citing `blackhole-state.md:198`
("`research` never appears — it has no `documentation/` target") and the absence of any
`research` row in `artifact-contract.md`'s Route → artifact table (7 rows: analyze, brainstorm,
design, investigate, plan, review, runbook — no `research`). This is a near-miss of the same
class this plan is fixing, in the opposite direction: an instruction to stage a route/sub_mode
pairing that has no target is worse than no instruction, because it produces a manifest entry
that fails `V-STAGE-02`'s route enum check (for a genuinely invalid route) or, worse, one that
passes schema validation while still being uncarryable (for `sub_mode: "research"`, which is a
schema-*valid* enum member with no wired target at all — `V-STAGE-02` cannot catch it because
the value is not out-of-enum).

**Checked against this plan's own fix — no widening needed for direction (1)**: none of the 4
mandatory-pairing callouts this plan adds are blanket ("always stage what you narrate") — each is
scoped to one already-valid, already-target-bearing route (`analyze` at `planner.md:44-46`,
`plan` at `:73-76`, `design` at `:346-351`/`:403-408`). No callout instructs staging for
`brainstorm`, `runbook`, or any `sub_mode: research` pairing. Confirmed no such literal exists in
`planner.md`, `investigator.md`, or `implementer.md` today (`grep` for `` `route: `` and
`` `sub_mode: `` literals across all three, cross-checked against `artifact-contract.md`'s table).

**What is added regardless, per the team lead's explicit ask**:

1. A 5th, general scope-boundary sentence in `planner.md` (Task 4 below), placed once before the
   staging-related steps rather than repeated at all 4 sites, making the "only stage a route with
   a live target, never `sub_mode: research`" rule visible in the prompt text itself — not just
   true by construction of the 4 scoped callouts, but stated, so a future editor cannot
   accidentally generalize the "manifest write is mandatory" language into a blanket instruction.
2. A new `V-STAGE-04` check in `staging-schema.check.ts` (direction 2, the reverse of `V-STAGE-03`):
   scans the same producer literals `V-STAGE-02` already extracts from `planner.md`,
   `investigator.md`, and `implementer.md`, and fails if any literal is `sub_mode: "research"` —
   the one documented case (`blackhole-state.md:198`) of a schema-enum-valid value with
   structurally no `documentation/` target. This is narrower than a full "route has no target"
   allowlist because, per `artifact-contract.md`'s table, every one of the 7 enum `route` values
   *does* have a target row (even `brainstorm`, which is merely un-wired today per
   `blackhole-state.md:197`'s note, not structurally targetless) — so `route`-value validity is
   already fully covered by `V-STAGE-02`'s existing enum check against the identical 7-route
   table, and a second, redundant route-allowlist check would be `V-DRY-01`/`V-PARETO-01`
   duplication for zero marginal protection. `sub_mode: "research"` is the one case that is
   enum-valid yet target-less, and `V-STAGE-04` closes exactly that gap, not a broader one.

This check currently passes against the real tree (no such literal exists anywhere today) — it
is a pure forward regression guard, not fixing a live defect, unlike `V-STAGE-03` which is
genuinely red-then-green against `planner.md`'s real text. Its own fixture tests still prove it
can fail (a fixture containing the forbidden literal), satisfying the "a test that cannot fail is
itself a finding" requirement independent of the real-tree state.

## Answers to the three questions (spawn prompt)

1. **Where exactly the instruction is missing** — nowhere; it is present at all 4 sites
   (`planner.md:44-46`, `:73-76`, `:346-351`, `:403-408`). What's missing is (a) an explicit
   statement that narrating staging in plan prose does not substitute for the write, and
   (b) a self-verification step. See § Verified prerequisite state above.
2. **Is `staging-schema.check.ts` the right home for a mechanical check** — yes, for a
   **source-level** check: does `planner.md`'s text keep the mandatory-pairing callout attached
   to each of the 4 staging-obligation sites. This is squarely the file's existing job (`V-STAGE-01`/
   `V-STAGE-02` already scan planner.md/investigator.md/implementer.md as static text, glob-discovered
   by `scripts/verify.ts`, run at `bun run verify`/CI time). **What it does and does not guarantee**:
   it can read prompt text and assert the callout phrase is present in each section; it **cannot**
   observe whether any given live `planner` invocation actually executed the write at runtime — no
   static check can. A runtime, plan-acceptance-time gate (comparing a specific issue's plan
   document against its actual `.blackhole/staged/<issue>/manifest.json`) is a different mechanism
   entirely, would require orchestrator/`phase-plan.md` wiring changes, and is out of this plan's
   touch-paths. Recommend filing that as a separate follow-up issue if the campaign wants runtime
   enforcement, not this plan's job to build.
3. **Does this make `V-AUTO-02` able to fire** — no, not directly, and here is why: `V-AUTO-02`
   already fires correctly whenever a manifest entry exists to diff against — it does so today for
   #710/#756/#774/#777, whose manifests are populated. The actual detection gap is a planner
   skipping the write at runtime; no static/source-level check (the only kind in scope here) can
   force a specific future invocation to comply, only make non-compliance less likely and prevent
   the instruction itself from regressing. Stating this as `V-AUTO-02` becomming "able to fire" would
   overclaim what a text-scanning check can do. The acceptance criterion that would make this fully
   true — an accept-time gate — is explicitly out of scope per the spawn prompt's touch-path
   restriction, and is named as a residual gap rather than silently dropped.

## Database/API Schema Changes

N/A — no schema, no `.blackhole/staged/` manifest field/enum changes. The manifest schema itself
is explicitly out of scope per #782 ("The manifest schema itself... is correct; nothing is writing
to it.").

## Execution Strategy & Stop Conditions

- If, after editing `planner.md`, `scripts/verify.staging-schema.test.ts`'s existing
  `findManifestFieldNameMismatch`/`findProducerEnumViolations` fixture tests fail, halt and
  revert the `planner.md` edit — those tests must stay green; this plan does not touch the
  manifest field/value literals those tests exercise (only prose *around* the existing literals
  is added).
- If the new `findMissingMandatoryPairing` anchor-lookup returns "anchor not found" for any of
  the 4 known anchors against the real `src/agents/planner.md` after the wording edit, halt —
  it means the edit accidentally altered/removed one of the anchor headings this check depends
  on; fix the anchor list or the heading text to match, do not silence the check.
- If `bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-782.md` reports any
  of `ac_mapping`/`critical_files_exist`/`mitigation_concrete` as `false`, revise this plan
  document before implementation starts — do not proceed with a `failing_checks` plan.
- Cap: at most 3 edited sites landing the mandatory-pairing sentence gain new text but zero
  restructuring of surrounding prose — if a task drifts into rewording unrelated parts of Step 4/
  Step 7/Design Track §8, stop and scope back down (`V-SCOPE-01`).
- If `V-STAGE-04`'s fixture tests cannot make the check fail (i.e. the forbidden-literal fixture
  passes when it should fail), halt — a check that cannot fail is itself a finding, not a
  deliverable; do not wire a vacuous check into `runChecks()`.
- If implementing `V-STAGE-04` tempts adding a second, broader "route has a target" allowlist
  duplicating `V-STAGE-02`'s existing enum check, stop — that is out of scope per
  § Route-conditionality constraint's explicit reasoning (`V-DRY-01`/`V-PARETO-01`); only the
  `sub_mode: "research"` case is added.

## Sprint Contract

Definition of done for every task below: its own `AC` line passes, `bun run scripts/checks-runner.ts`
(or the repo's `bun run verify` entrypoint) reports `V-STAGE-01`, `V-STAGE-02`, and the new
`V-STAGE-03`/`V-STAGE-04` all `ok: true` against the real tree, and
`bun test scripts/verify.staging-schema.test.ts` passes in full — no narrower per-task exception.

## Task Breakdown

1. **Write failing synthetic-fixture tests for both new pure functions** (TDD red step 1).
   Add to `scripts/verify.staging-schema.test.ts`:
   - A `describe('findMissingMandatoryPairing (V-STAGE-03)', ...)` block importing a
     not-yet-exported `findMissingMandatoryPairing` from `./checks/staging-schema.check.ts`.
     Cases: (a) all 4 synthetic anchors present, each followed (before the next anchor) by the
     mandatory phrase → `[]`; (b) one anchor's window missing the phrase → array of length 1
     naming that anchor; (c) an anchor string absent from the content entirely → array entry
     `"anchor not found: ..."`; (d) two anchors close together where anchor A's phrase is placed
     *after* anchor B's position in a scrambled fixture → windowing must not let anchor B's
     phrase satisfy anchor A (asserts document-order windowing, not naive fixed-size windowing).
   - A `describe('findForbiddenSubModeLiterals (V-STAGE-04)', ...)` block importing a
     not-yet-exported `findForbiddenSubModeLiterals` from the same module. Cases: (e) a literals
     array containing `{ field: 'sub_mode', value: 'research', source: 'planner.md' }` → array of
     length 1 naming the source and value; (f) a literals array with only `sub_mode: 'analyze'`/
     `'investigate'`/`null` and `route` values → `[]`; (g) an empty literals array → `[]`.
   At this point both imports fail (functions do not exist) — this is the required red state.
   — **AC**: `bun test scripts/verify.staging-schema.test.ts` fails specifically on both new
   `describe` blocks (import/undefined error), with zero changes yet to `staging-schema.check.ts`.

2. **Implement both pure functions plus their `CheckResult` wrappers, wire both into
   `runChecks()`** (TDD green step 1). In `scripts/checks/staging-schema.check.ts`:
   - `STAGING_OBLIGATION_ANCHORS` (4 exact substrings: `Seed Active Constraints from analyze note`,
     `` Durable plan staging (ADR-021 D3, issue #445) ``, `` `status: "ready"` (from `design-aggregate.ts`) → ``,
     `` `resume_context: design_approved` ``) and `MANDATORY_PAIRING_PHRASE = 'does not satisfy ADR-021 D3'`
     constants; the pure `findMissingMandatoryPairing(content, anchors, phrase): string[]` (sorts
     anchor occurrences by document position, windows each anchor to the next anchor's position or
     EOF, checks phrase membership in the window); the `checkStagingInstructionPairing(): CheckResult`
     wrapper reading `plannerDoc` via the existing `read()` helper and returning `id: 'V-STAGE-03'`.
   - The pure `findForbiddenSubModeLiterals(literals: ProducerLiteral[]): string[]` (filters
     `literals` for `field === 'sub_mode' && value === 'research'`, maps each to
     `` `${source}: sub_mode: "research" has no documentation/ target (blackhole-state.md:198)` ``);
     the `checkNoResearchStaging(): CheckResult` wrapper reusing the exact same 3-file literal
     extraction already built in `checkProducerConformance` (call `extractProducerFieldValueLiterals`
     on `plannerDoc`/`investigatorDoc`/`implementerDoc` again — same pattern, not a shared-state
     refactor) and returning `id: 'V-STAGE-04'`.
   - Add both wrappers to `runChecks()`'s returned array, after the existing two, in the order
     `V-STAGE-03`, `V-STAGE-04`.
   — **AC**: task 1's synthetic-fixture tests (a)-(g) all pass; `runChecks (real tree)` test (not
   yet updated) now fails because it asserts exactly `['V-STAGE-01', 'V-STAGE-02']` — this is the
   expected, deliberate red state carried into task 3.

3. **Update the `runChecks (real tree)` id-list assertion** to
   `['V-STAGE-01', 'V-STAGE-02', 'V-STAGE-03', 'V-STAGE-04']`. `V-STAGE-04.ok` is already `true`
   against the real tree (no `sub_mode: "research"` literal exists anywhere today — confirmed by
   direct grep during planning); `V-STAGE-03.ok` is `false` because `planner.md`'s real text does
   not yet contain the mandatory phrase at any of the 4 sites. Net: this assertion still fails at
   this point (red), on `V-STAGE-03` specifically — this is the deliberate "test fails before the
   fix, on the real file" state the campaign lead asked for.
   — **AC**: `bun test scripts/verify.staging-schema.test.ts` — exactly one failure, on
   `'both checks pass against the current, unmodified tree'` (now asserting 4 checks), with
   failure detail naming all 4 missing-phrase sections and *not* naming any `V-STAGE-04` finding.

4. **Edit `src/agents/planner.md`: add the mandatory-pairing callout at all 4 producer-route
   staging sites, plus one general scope-boundary note** (TDD green step 2, closes the actual gap
   and the near-miss):
   - Immediately after the `## Workflow & Planning Steps` heading (`planner.md:16`), before item
     1, insert: "**Staging scope** (issue #782 near-miss): every staging obligation named below
     (Steps 4 and 7, and Design Track §8) targets a route that already has a live
     `documentation/` target per `artifact-contract.md`'s Route → artifact table — the SSOT for
     which routes are stageable. Never generalize the staging mechanism to a route absent from
     that table, and never stage a `sub_mode: \"research\"` entry: `blackhole-state.md` § Staging
     states explicitly that `research` has no `documentation/` target." This is a single,
     one-time note scoping the whole numbered list — not repeated at each of the 4 sites below.
   - After `planner.md:51` ("...attribution suffix is mandatory."), append: "**Manifest write is
     mandatory, not narration** (issue #782): staging the bullet file above without also
     completing this manifest append — or narrating the staging in the plan body without
     executing it — does not satisfy ADR-021 D3 and leaves `V-AUTO-02` unable to detect the gap.
     Before returning `status`, confirm the entry exists on disk (e.g. `grep -q '"route":
     "analyze"' .blackhole/staged/<issue>/manifest.json`)."
   - After `planner.md:76` (end of the existing numbered step 4 in the Durable plan staging
     block), add a new numbered step 5: "**Manifest write is mandatory, not narration** (issue
     #782): completing steps 2-3 (the plan body and INDEX row files) without this manifest
     append — or describing staged artifacts in the plan document's prose without executing step
     4 — does not satisfy ADR-021 D3 and leaves `V-AUTO-02` unable to detect the gap. Before
     returning `status`, confirm both entries are present on disk (e.g. `grep -c '"route":
     "plan"' .blackhole/staged/<issue>/manifest.json` returns `2`)."
   - After `planner.md:351` ("...Append both entries to `.blackhole/staged/<issue>/manifest.json`
     per that section's schema."), insert before "This is staging, not a commit...": "**Manifest
     write is mandatory, not narration** (issue #782): rendering the ADR body and INDEX row
     fragment without this manifest append — or describing the staging in the design note's
     prose without executing it — does not satisfy ADR-021 D3 and leaves `V-AUTO-02` unable to
     detect the gap. Before returning `status: "ready"`, confirm both entries exist on disk."
   - After `planner.md:408` ("...manifest append as the `ready` branch above."), insert before
     "no orchestrator file write": "**Manifest write is mandatory, not narration** (issue #782):
     promoting the on-disk design note verbatim does not itself satisfy ADR-021 D3 — this
     manifest append must still execute in this same spawn, and its absence leaves `V-AUTO-02`
     unable to detect the gap."
   Line numbers above are pre-edit anchors against the file as read during planning
   (`plan_base_commit`); apply edits in the listed order and locate each subsequent anchor by its
   quoted text, not by a stale line number, since each insertion shifts everything after it.
   Each insertion is additive prose only — no restructuring of surrounding numbered
   steps/bullets, no change to the manifest field/enum literals `V-STAGE-01`/`V-STAGE-02` check.
   — **AC**: `git diff --stat src/agents/planner.md` shows only added lines (no deletions beyond
   the minimum needed to splice in a new numbered step 5 in the plan-route block); the literal
   substring `does not satisfy ADR-021 D3` appears exactly 4 times in the file; the literal
   substring `never stage a` (from the new scope-boundary note) appears exactly once.

5. **Regenerate build output trees** per `scripts/lib/build/targets.ts` (`bun run build`), so the
   5 compiled copies of `planner.md` (`.claude/`, `.cursor/`, `skills/`, `codex-*`,
   `.agents/build/`) match the `src/agents/planner.md` edit. This is the standard build-source
   Touch-Path convention already declared above ("plus all generated dist trees").
   — **AC**: `bun run build` exits 0; `git diff --stat` shows the 5 generated `planner.md` copies
   changed identically to the `src/` edit (modulo the generated-footer line already present).

6. **Full verification pass** (final green state — TDD green step 3): run
   `bun test scripts/verify.staging-schema.test.ts` and confirm all tests pass, including the now
   correctly-green `runChecks (real tree)` assertion; run the repo's `bun run verify` entrypoint
   and confirm `V-STAGE-01`, `V-STAGE-02`, `V-STAGE-03`, `V-STAGE-04` all report `ok: true`.
   — **AC**: `bun test scripts/verify.staging-schema.test.ts` exit code `0`, zero failures;
   `bun run verify` (or equivalent checks-runner invocation) reports no `V-STAGE-*` failures.

## Out of scope (named, not dropped)

- **#782 AC4** (retroactive manifests for #752/#757): not a code change and not on this plan's
  touch-paths — it is a one-off data decision/operation the orchestrator can execute directly
  against `.blackhole/staged/`. Live state check during this plan's drafting: `752/manifest.json`
  already exists (implementer wrote a `review`-route entry at promotion) but has no retroactive
  `plan`-route entry; `757/` has no staged directory at all. Recommend the orchestrator decide
  explicitly (repair vs accept-as-lost) rather than leaving it implicit, per the issue's own AC4 —
  this plan does not decide it.
- **Runtime, plan-acceptance-time gate** (would make `V-AUTO-02` genuinely "able to fire" against
  a specific non-compliant planner invocation): requires orchestrator/`phase-plan.md` wiring
  outside this plan's touch-paths (`src/agents/planner.md`, `scripts/checks/staging-schema.check.ts`).
  Recommend filing as a separate follow-up issue if runtime enforcement (rather than a prompt
  regression guard) is wanted.
- **#806** (`check-review-artifact.ts` circularity on the review route): explicitly a different
  issue, different code path, different owner — not touched by this plan.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS (N/A — no schema/manifest field changes) |
| `ac_mapping` | PASS (`bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-782.md` → `true`) |
| `critical_files_exist` | PASS (`true`; `## Critical Files` is empty — nothing to Glob) |
| `mitigation_concrete` | PASS (`true`) |
| `ADVISORY: touch_paths_ssot_gap` | none found (`findTouchPathSsotGaps` on `## Touch-Paths` + `## Task Breakdown` → `[]`, re-checked after the route-conditionality revision) |
| `ADVISORY: ac_sweep_conflict` / `ac_sweep_scope` | N/A — no sweep/grep-to-zero AC in this plan |

Re-run after folding in the team lead's route-conditionality constraint (V-STAGE-04, the
scope-boundary note, § Route-conditionality constraint) — all three CLI checks and the SSOT-gap
advisory still pass unchanged.

## References

- Issue: #782 (this plan's scope)
- Related, explicitly out of scope: #806 (split sibling)
- `src/references/blackhole-state.md` § Staging — manifest schema SSOT, `:198` (`sub_mode:
  research` has no target), `:197` (`brainstorm` reserved but not un-targetable)
- `.claude/skills/blackhole/references/artifact-contract.md` § Route → artifact table — SSOT
  for which routes are stageable (§ Route-conditionality constraint)
- `scripts/checks/staging-schema.check.ts` — existing V-STAGE-01/V-STAGE-02 checks, extended
  here with V-STAGE-03 (mandatory-pairing) and V-STAGE-04 (forbidden `sub_mode: research`)
- ADR-021 D1/D2/D3 — staging, carry-step, durable plan promotion
