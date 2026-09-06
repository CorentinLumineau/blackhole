---
type: plan
summary: "Deduplicate findAdrFileByNumber (design-aggregate.ts, adr-supersession.check.ts) and the carry-staged-artifacts.ts mkdir/write/catch block, reversing issue #775's keep-local decision and correcting the false F-00097 links.check.ts claim"
status: current
review_trigger: "on file change"
created: 2026-09-06
last_updated: 2026-09-06
---


# Plan - Issue #903

## Objective

Deduplicate two independently-confirmed duplication points, both flagged in the router's
correction comment (which supersedes the issue body's wrong "three copies" count):

1. **`findAdrFileByNumber`** — two behaviourally-identical copies: `scripts/design-aggregate.ts:319`
   (private function declaration) and `scripts/checks/adr-supersession.check.ts:70` (private arrow
   function). A claimed third copy in `links.check.ts` does not exist — that file resolves ADRs via
   `fs.readdirSync(...).filter(/^ADR-\d+-.*\.md$/)`, a different mechanism entirely. Consolidate
   both into one shared, exported implementation.
2. **The mkdir/write/catch block** in `scripts/lib/carry-staged-artifacts.ts` at lines 307-317
   (`new_file` branch) and 325-334 (`append_row` branch) — identical except the written variable
   name. Extract into one shared write-step helper used by both branches.

`task_type: refactor`: both copies of each duplicate are confirmed behaviourally identical (same
`startsWith(\`${adrRef}-\`)` prefix match / same try-mkdir-write-catch shape), so this changes no
observable behaviour — it is pinned by characterization tests written before either extraction.

This plan also **reverses** a recorded decision and **corrects** a false claim (both detailed
under Codebase Conventions below), rather than silently overwriting either.

## Touch-Paths

- `scripts/design-aggregate.ts`
- `scripts/checks/adr-supersession.check.ts`
- `scripts/lib/check-common.ts`
- `scripts/lib/check-common.test.ts`
- `scripts/design-aggregate.test.ts`
- `scripts/verify.adr-supersession.test.ts`
- `scripts/lib/carry-staged-artifacts.ts`
- `scripts/lib/carry-staged-artifacts.test.ts`

## Documentation Impact

None — this is an internal `scripts/**` refactor with no change to any `documentation/` file, and
no change to a public interface any consumer doc describes. The one prose change (correcting the
false claim in `design-aggregate.ts`'s Design Decision 1 comment) is a source-code comment, not a
documentation-tree artifact, and is covered under Codebase Conventions below instead.

## Codebase Conventions

| Concern | Existing convention | Applies here |
|---|---|---|
| Shared check/script primitives | `scripts/lib/check-common.ts` already hosts cross-domain helpers imported by both `*.check.ts` modules (e.g. `adr-status.check.ts`, `adr-supersession.check.ts`) and plain scripts outside `scripts/checks/` (e.g. `scripts/decision-log-append.ts` imports `check-common.ts` directly from `scripts/` root) — confirmed no import-cycle restriction blocks a non-check script importing it, and its own header note ("never any `*.check.ts` module") governs its own imports, not its importers. It also carries **no** enforced `CONTENT_GATE_BUDGETS` ceiling (`scripts/lib/build/facts.ts`'s declared globs are `scripts/checks/*.check.ts` and `scripts/lib/build/*.ts` only) — a safe host for one more small export. | `findAdrFileByNumber` moves here as a named export, imported by both `design-aggregate.ts` and `adr-supersession.check.ts`. |
| Extraction reverses a recorded decision (issue #775) | `scripts/design-aggregate.ts:313-318` carries an inline "Design Decision 1 (issue #775)" comment stating the duplicate was **deliberately kept local rather than exported** — an inline comment, not an ADR, so `V-ARCH-01` does not fire on reversing it. | This plan reverses that call now that both copies are confirmed behaviourally identical (F-00097 investigation). The reversal must be **recorded**, not silently deleted: rewrite the comment (see Task 3) into a short decision-record note on the new shared export in `check-common.ts`, stating what #775 decided, why #903 reverses it, and correcting the false claim below in the same edit. |
| Stale/false claim in that same comment (`F-00097`, `V-DOCFACT-01`) | The comment asserts "The codebase already tolerates this exact small duplicate twice (adr-supersession.check.ts, links.check.ts) without flagging it as DRY debt." The `links.check.ts` half is false — verified by reading that file, which contains no function of that name. This claim propagated from the source comment → issue #867's body → issue #903's filed body, which is the concrete cost of never having corrected it. | Task 3 corrects the claim as part of the same edit that reverses the #775 decision — never deleted as a side effect of removing the duplicated code, since deleting it would erase the false claim without the record ever being corrected anywhere. |
| `carryManifest`'s two near-identical write-step blocks | Both blocks in `scripts/lib/carry-staged-artifacts.ts` already share the exact "mkdirSync(recursive) → writeFileSync → on error, `skipped.push({ index, reason: `write failed for target_path "${entry.target_path}": ${message}` })`" shape (confirmed identical apart from the written variable — `content` vs. `result.content`). | Extract one `writeCarryTarget(targetAbs, content)` helper returning a discriminated result (or throwing only for genuinely unexpected errors — see Task 5), called from both the `new_file` and `append_row` branches. The exact `write failed for target_path "..."` message text must be preserved verbatim — `reviewer.md` § Staged Artifact Carry Audit (`V-AUTO-02`, BLOCK) and the existing test at `carry-staged-artifacts.test.ts:607` both key off it. |
| Test co-location | Tests are colocated with source as `<module>.test.ts` (no `tests/`/`__tests__/` directory in this repo) — e.g. `scripts/lib/check-common.test.ts`, `scripts/lib/carry-staged-artifacts.test.ts`, `scripts/design-aggregate.test.ts`, `scripts/verify.adr-supersession.test.ts`. | New characterization tests land in these existing files, following each file's existing `describe`/`test` and `withTempDir` fixture conventions — no new test-file layout introduced. |

## Dependency Blast-Radius

Live grep found only **one** direct TypeScript import of `carryManifest`
(`scripts/carry-staged-artifacts.ts`, the 72-line CLI wrapper) — below the 3-consumer numeric
threshold that would normally trigger this section on a Standard-track plan. It is included
anyway, per explicit routing instruction, because import-count understates the real blast radius
here: `scripts/lib/carry-staged-artifacts.ts` is the **sole** ADR-021 D2 carry-step, invoked once
per issue by every staged-artifact PR in the campaign (`planner`'s Design/analyze/plan routes,
`implementer`'s review-route staging) and its write-step failure message is read directly by
`reviewer.md` § Staged Artifact Carry Audit (`V-AUTO-02`, BLOCK). A behavioural regression in the
extracted helper would silently break staged-artifact enforcement repo-wide, not just for one PR.

| Consumer | Classification | Note |
|---|---|---|
| `scripts/carry-staged-artifacts.ts` (CLI wrapper, direct import of `carryManifest`) | TRANSPARENT | Calls `carryManifest` only through its existing public signature; the extraction changes internal control flow, not the function's inputs/outputs. Guaranteed by Task 5's characterization tests (both branches' write-failure shape pinned before extraction). |
| `reviewer.md` § Staged Artifact Carry Audit (`V-AUTO-02`) — reads `skippedEntries[].reason` text via the ledger/PR diff, not a code import | TRANSPARENT (behavioral) | Depends on the literal `write failed for target_path "${entry.target_path}": ${message}` string surviving the extraction unchanged — pinned by the existing `carry-staged-artifacts.test.ts:607` test (`new_file` branch, unaffected) and the new characterization test added in Task 5 for the `append_row` branch. |
| Every campaign issue's implement/carry step (operational, not a code import) | TRANSPARENT (behavioral) | No caller passes different inputs or reads a different output shape; risk is confined to "does the shared helper reproduce both branches' current try/catch behaviour exactly," which is what Task 5's tests exist to prove before the extraction lands. |

No consumer is classified BREAKING or DEPRECATION — this is the basis for `task_type: refactor`
holding through to merge, not just at routing time.

## Execution Strategy & Stop Conditions

- If `bun test scripts/design-aggregate.test.ts scripts/verify.adr-supersession.test.ts` fails
  after Task 4 (post-extraction) in a way that was passing after Task 2 (pre-extraction
  characterization tests added), **halt and revert Tasks 3-4** — this means the shared
  `findAdrFileByNumber` diverges from one of the two original implementations, not merely a test
  wiring issue.
- If `bun test scripts/lib/carry-staged-artifacts.test.ts` fails after Task 6 (post-extraction) in
  a way that was passing after Task 5's characterization test lands, **halt and revert Task 6** —
  the shared `writeCarryTarget` helper does not reproduce one of the two branches' error-handling
  shape.
- If the new `append_row`-branch write-failure characterization test (Task 5) cannot be made to
  fail against a stub/no-op helper before the real extraction (i.e. it turns out to pass
  regardless of implementation), **stop and rewrite the fixture** — an unfalsifiable
  characterization test is worse than none (`V-UNFALSIFIABLE-01`, `V-TEST-11`); do not proceed to
  Task 6 until the fixture demonstrably discriminates.
- If `bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-903.md` reports any
  `FAIL`, stop and revise this plan document (not the code) before implementation begins.

## Task Breakdown

- [ ] **Task 1 — TDD Baseline Verification**: Run `bun test` for the full suite before touching
  any file. — **AC**: baseline pass/fail counts captured verbatim in the completion evidence;
  zero pre-existing failures in the files this plan touches (`design-aggregate.test.ts`,
  `verify.adr-supersession.test.ts`, `carry-staged-artifacts.test.ts`, `check-common.test.ts`).

- [ ] **Task 2 — Characterization tests for `findAdrFileByNumber`, added at both existing call
  sites before extraction**: In `scripts/design-aggregate.test.ts` (inside the existing
  `describe('resolveAdrAmendmentTruth ...')` block) and in `scripts/verify.adr-supersession.test.ts`
  (inside the existing `describe('collectDeclaredSupersessionViolations ...')` block), add cases
  exercising the private `findAdrFileByNumber` behaviour indirectly through each file's own public
  entry point (`resolveAdrAmendmentTruth`, `collectDeclaredSupersessionViolations`):
  1. **Not-found**: an ADR reference with no matching file in the fixture `decisionsDir` resolves
     to a `false`/`[]` outcome consistent with "no file found" at that call site (never a thrown
     error).
  2. **Prefix-match discriminator**: fixture `decisionsDir` contains both `ADR-007-foo.md` and
     `ADR-0071-bar.md`; querying for `ADR-007` must resolve against `ADR-007-foo.md` only. This
     discriminates a correct `startsWith(\`${adrRef}-\`)` prefix match from a naive
     `.includes(adrRef)`/`.startsWith(adrRef)` implementation, either of which would incorrectly
     also match `ADR-0071-bar.md` (its filename contains `ADR-007` as a substring but is a
     different ADR number).
  3. **Missing directory**: `decisionsDir` itself does not exist on disk — resolves to `null`/`[]`
     at the call site, never an `ENOENT` throw.
  — **AC**: all three cases added to both test files, run `bun test scripts/design-aggregate.test.ts
  scripts/verify.adr-supersession.test.ts` and confirm all pass against the current
  (pre-extraction) implementations — this is the pinned baseline the extraction must reproduce.

- [ ] **Task 3 — Extract `findAdrFileByNumber` into `scripts/lib/check-common.ts`; update
  `design-aggregate.ts`; correct and reframe the Design Decision 1 comment**:
  1. Add `export const findAdrFileByNumber = (decisionsDir: string, adrRef: string): string | null
     => { ... }` to `scripts/lib/check-common.ts`, body copied verbatim from either existing
     implementation (both are behaviourally identical). Add a direct unit-test `describe` block for
     it in `scripts/lib/check-common.test.ts` covering the same three cases as Task 2 (not-found,
     prefix-match discriminator, missing directory) — this is the new fast, isolated pin sitting
     alongside the two indirect pins from Task 2.
  2. In `scripts/design-aggregate.ts`: replace the local `function findAdrFileByNumber(...) {...}`
     (lines 319-323) with an import from `./lib/check-common.ts`; update the call site inside
     `resolveAdrAmendmentTruth` to use the imported name (unchanged — same identifier).
  3. Replace the inline comment at lines 313-318 (currently: "Design Decision 1 (issue #775) — a
     trivial 3-line duplicate of adr-supersession.check.ts's own findAdrFileByNumber, kept local
     rather than exported from that file... The codebase already tolerates this exact small
     duplicate twice (adr-supersession.check.ts, links.check.ts) without flagging it as DRY debt.")
     with a corrected decision-record comment stating: (a) issue #775 originally decided to keep
     this local rather than export it; (b) issue #903 reverses that decision now that both copies
     are confirmed behaviourally identical, consolidating into `check-common.ts`'s shared export;
     (c) the original comment's claim of a `links.check.ts` duplicate was false — that file
     resolves ADRs via a directory-listing Set (`fs.readdirSync(...).filter(/^ADR-\d+-.*\.md$/)`),
     not a per-number lookup — and this correction is `F-00097`'s remedy. Place the corrected note
     as a doc comment on the new `findAdrFileByNumber` export in `check-common.ts` (its new home),
     not as a dangling comment at the old call site.
  — **AC**: `grep -c "function findAdrFileByNumber" scripts/design-aggregate.ts` returns `0`;
  `scripts/lib/check-common.ts` exports `findAdrFileByNumber`; the corrected comment appears on
  that export and contains neither the phrase "kept local rather than exported" as a live
  decision nor the false `links.check.ts` claim; `bun test scripts/design-aggregate.test.ts
  scripts/lib/check-common.test.ts` passes.

- [ ] **Task 4 — Update `scripts/checks/adr-supersession.check.ts` to use the shared export**:
  Replace the local `const findAdrFileByNumber = (...) => {...}` (lines 70-74) with an import of
  the same name from `../lib/check-common.ts` (this file already imports `walkMdFilesAbs` from
  the same module at line 4 — add to that same import statement). No other line in this file
  changes. — **AC**: `grep -c "const findAdrFileByNumber" scripts/checks/adr-supersession.check.ts`
  returns `0`; `bun test scripts/verify.adr-supersession.test.ts` passes with the same pass count
  as Task 2's baseline.

- [ ] **Task 5 — Characterization test for the `append_row` branch's write-failure path, added
  before extraction**: `scripts/lib/carry-staged-artifacts.test.ts:607` already pins the
  `new_file` branch's write-failure shape (issue #784 AC2/AC3: an `ENOTDIR`-forcing fixture —
  `documentation` pre-created as a plain file — produces a `skipped` entry containing `write
  failed for target_path "..."` and does not throw). Add a symmetric test for the **`append_row`**
  branch (currently unexercised for failure — the existing end-to-end `ARCHITECTURE.md` case only
  exercises its success path): pre-create `documentation` as a plain file, then submit a manifest
  entry with `target_kind: 'append_row'` and `target_path: 'documentation/INDEX.md'` (forcing the
  same `mkdirSync(path.dirname(targetAbs), { recursive: true })` `ENOTDIR` failure inside the
  `append_row` branch's own try/catch at lines 328-337). — **AC**: the new test fails with a
  `TypeError`/assertion mismatch if you temporarily stub the `append_row` write step to always
  throw an *uncaught* error instead of catching it (proving the fixture discriminates a
  swallowed-vs-unswallowed failure, per the Execution Strategy stop condition above) and passes
  against the current, pre-extraction code; both this test and the existing `new_file` failure
  test at line 607 pass together in the same `bun test scripts/lib/carry-staged-artifacts.test.ts`
  run.

- [ ] **Task 6 — Extract the shared write-step helper in `scripts/lib/carry-staged-artifacts.ts`**:
  Add a private helper (not exported — no consumer outside this file needs it):
  ```ts
  const writeCarryTarget = (
    targetAbs: string,
    content: string,
  ): { ok: true } | { ok: false; message: string } => {
    try {
      fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
      fs.writeFileSync(targetAbs, content);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message };
    }
  };
  ```
  Replace both the `new_file` branch (lines 311-318) and the `append_row` branch (lines 329-336)
  with a call to `writeCarryTarget(targetAbs, content)` (or `result.content` for `append_row`),
  pushing to `carriedPaths` on `{ ok: true }` and to `skipped` with the existing `write failed for
  target_path "${entry.target_path}": ${message}` string (message now `result.message`) on
  `{ ok: false }` — the externally-observable message text and control flow (never throws, always
  resolves to either `carriedPaths` or `skipped`) must not change. — **AC**: `grep -c "fs.mkdirSync"
  scripts/lib/carry-staged-artifacts.ts` returns `1` (was `2`); `bun test
  scripts/lib/carry-staged-artifacts.test.ts` passes with the same pass count as Task 5's baseline
  plus the one new test, with zero changes required to any existing assertion text.

- [ ] **Task 7 — Verify Integrity**: Run `bun test` (full suite), `bun run lint` and `bun run
  typecheck` (or this repo's equivalent combined `bun run verify`, whichever the implementer's
  environment resolves — confirm with `cat package.json` if unsure which script names exist). —
  **AC**: full suite green, lint clean, typecheck clean, all three quoted verbatim in the
  completion evidence; pass count is Task 1's baseline count plus exactly the new tests added in
  Tasks 2, 3, and 5 (no regressions, no accidental deletions).

## Sprint Contract

Each task's `## Task Breakdown` AC above is the definition of done for that task; there is no
task in this plan relying on the blanket "all tests and linters pass" fallback — every task names
its own machine-verifiable condition. Task 7's full-suite run is the final confirmation that no
task's AC was satisfied in isolation at the expense of another.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — no schema/API change; pure internal refactor |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS — no `## Critical Files` section (no pre-existing sensitive touchpoint files beyond the Touch-Paths themselves; none warrant listing separately) |
| `mitigation_concrete` | PASS |
| `touch_paths_ssot_gap` | PASS — no companion-file gap detected for this Touch-Paths set |

Verified via `bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-903.md`.

## References

- Issue: `CorentinLumineau/blackhole#903` (routing `R-00010`; body count corrected by the filing
  author's own comment, which supersedes the body)
- Prior decision reversed: issue #775 (`scripts/design-aggregate.ts:313-318`, "Design Decision 1")
- False-claim finding: `F-00097` (`V-DOCFACT-01`) — the `links.check.ts` duplicate claim
- Consumer: `implementer.md` § Carry Staged Artifacts (ADR-021 D2) — the carry-step this plan's
  Tasks 5-6 modify the internals of, without changing its documented behavior
- Enforcement dependency: `reviewer.md` § Staged Artifact Carry Audit (`V-AUTO-02`, BLOCK) — reads
  the `write failed for target_path "..."` message text pinned by Task 5/6's tests
- `blackhole-vcodes.md`: `V-INT-02` (no reimplementation — this plan removes one), `V-TEST-02`
  (tests first), `V-UNFALSIFIABLE-01` / `V-TEST-11` (characterization fixtures must discriminate)
