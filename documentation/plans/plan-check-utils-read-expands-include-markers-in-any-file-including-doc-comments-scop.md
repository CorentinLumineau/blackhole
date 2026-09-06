---
type: plan
summary: "Option-C implementation plan for issue #882 — gate {{INCLUDE}} expansion inside expandIncludes on a declared INCLUDE_MARKER_SITES allowlist, with the build-test fixture seam as the named mitigation for the accepted build-primitive verification cost"
status: current
review_trigger: "on ADR-039 amendment or a new agent adopting the include seam"
created: 2026-09-06
last_updated: 2026-09-06
related:
  - documentation/decisions/ADR-039-declared-include-marker-sites.md
  - documentation/reference/check-utils-blast-radius.md
  - documentation/decisions/ADR-034-audit-module-seam.md
---


# Plan - Issue #882

> **Active.** The Design Track verdict was `blocked` (`dominance`, `disagreement`,
> `breaking-consumer`); the owner ruled for **Option C** on 2026-09-06 via the campaign gate,
> with the dissenting critic's counter-case in view. The ruling accepts the larger verification
> surface of gating inside the build primitive as a **known cost**, not a settled question — the
> mitigation is Task 4 below, and it may not be met by loosening or skipping the affected tests
> (`V-TEST-10`). Decision record: `documentation/decisions/ADR-039-declared-include-marker-sites.md`
> (staged at `.blackhole/staged/882/`, carried by the implementer's carry-step).

## Objective

Make `{{INCLUDE:<dir>/*}}` expansion fire only at files explicitly declared as marker sites, so
that a marker appearing anywhere else — a doc comment, a reference table, a plan document — is
inert prose in **every** entry path into the primitive (`read()`, `vcode-citation.check.ts`'s
direct call, and `processFile`'s build-time call). Replace the current
comment-writing-discipline dependency, still load-bearing at `scripts/lib/build/facts.ts:51`,
with a mechanical, two-way-checked boundary.

Constraints: `bun run verify` stays green (92/92 at plan time); `V-CONTENTGATE-01` keeps
measuring real file LOC; the compiled output trees stay byte-identical; no call site of `read()`
changes.

## Touch-Paths

- `scripts/lib/build/facts.ts` — new `INCLUDE_MARKER_SITES` declared fact
- `scripts/lib/build/content.ts` — site gate inside `expandIncludes`; fixture seam
- `scripts/checks/build-input-dirs.check.ts` — new bidirectional scan leg (`V-INCLUDE-02`)
- `scripts/build.test.ts` — fixture-site registration for the ADR-034 T1/T6 suites
- `scripts/verify.build-input-dirs.test.ts` — unit coverage for the new scan leg
- `src/references/blackhole-vcodes.md` — one new V-code row, **plus all generated dist trees per `scripts/lib/build/targets.ts`**
- `documentation/reference/check-utils-blast-radius.md` — consumer-count reconciliation
- `documentation/plans/plan-retrospective-v0.21.0-remediation.md`, `documentation/architecture/retrospective-blackhole.md` — normalize the two latent literal markers (AC-3)

## Documentation Impact

- `documentation/reference/check-utils-blast-radius.md` — **update in place** (search-before-write:
  this is the existing canonical doc for this concern; no new file). Its header comment says 29
  direct consumers, its table lists 32 rows, and a live count of `read` importers is 39. Three
  different sets, one inconsistent document. Task 8.
- `scripts/lib/build/facts.ts` — the doc comment describing the `{{...}}`-quoting workaround must
  be rewritten to describe the declared-site rule. The workaround itself becomes unnecessary;
  leaving the comment claiming otherwise is `V-DOCFACT-01`. Task 8.
- **Staged for the carry-step** at `.blackhole/staged/882/` (manifest written, `V-STAGE-01/02/03`
  green) — the implementer commits these inside this issue's PR, it does not re-author them:

  | Staged artifact | Target | Kind |
  |---|---|---|
  | `ADR-039-declared-include-marker-sites.md` | `documentation/decisions/ADR-039-declared-include-marker-sites.md` | `new_file` |
  | `decisions-index-row.md` | `documentation/decisions/INDEX.md` | `append_row` |
  | `architecture-active-constraint.md` | `ARCHITECTURE.md` § Active Constraints | `append_row` |
  | `plan-check-utils-...-scop.md` | `documentation/plans/plan-check-utils-...-scop.md` | `new_file` |

- **No row is staged for the root `documentation/INDEX.md`.** `ARCHITECTURE.md` § Active
  Constraints (ADR-031) forbids hand-appending to it — it is generated from each doc's `summary:`
  frontmatter, and `scripts/lib/doc-index-generate.ts` excludes `decisions/**` from that walk,
  which is why the decisions index still takes a hand-appended row and the root index must not.
  The staged plan body carries `summary:` so the generator emits its row.


## Critical Files

- `scripts/lib/build/content.ts` — the shared expansion primitive; `processFile` compiles every source file under the
  src tree into every target tree. A defect here corrupts all compiled output.
- `scripts/lib/build/facts.ts` — the `§ facts` declared-fact SSOT block.
- `scripts/checks/check-utils.ts` — shared verify primitive; consumer graph documented in
  `documentation/reference/check-utils-blast-radius.md`.
- `scripts/checks/build-input-dirs.check.ts` — the existing `V-INCLUDE-01` two-leg check this
  work extends.

## Codebase Conventions

| Integration touchpoint | Established pattern to follow | Where it is already done |
|---|---|---|
| Declaring a new repo fact | Named `export const` in `facts.ts`'s `§ facts` block with a doc comment naming its independent-scan counterpart, explicitly stating the scan is never derived from the declared side | `BUILD_INPUT_ONLY_DIRS` (`facts.ts:46`), `REVIEWER_AUDIT_MODULE_COUNT` (`facts.ts:67`), `IMPLEMENTER_GATE_MODULE_COUNT` (`facts.ts:57`) |
| Checking a declared fact | A `*.check.ts` module with a two-leg shape: Leg A declared→live, Leg B live→declared; each leg returns its own `CheckResult` | `build-input-dirs.check.ts` (`V-INCLUDE-01` Legs A/B) |
| Adding a V-code | One row in `src/references/blackhole-vcodes.md` with rule, severity, and a primary-enforcement-site citation that resolves; rebuild all dist trees | every row in that table; enforced by `vcode-citation.check.ts` and `vcode-severity-sync.check.ts` |
| Exporting a pure predicate for unit test | Export the pure function from the check module and test it directly, rather than exercising it only through the filesystem-closing entrypoint | `isAgentCountError` (`codex-build.check.ts`), `leakedPlatformConditionalMarkers` (`check-common.ts:44`), `findUndeclaredIncludeMarkers` (`build-input-dirs.check.ts:62`) |
| Optional injected parameter on a build primitive | Trailing parameter with a default that reproduces current behaviour byte-for-byte, doc-commented as such | `expandIncludes(content, srcPath, extraSources = [])`; `generatedMarkerLine(relSrcPath, style, extraSources = [])` |
| Path comparison inside `content.ts` | `path.relative(root, p).split(path.sep).join('/')` to get a repo-relative POSIX path | `isBuildInputOnlyPath` (`content.ts:242`), `processFile`'s `relSrcPath` (`content.ts:201`) |
| Test-only seam into a shelled-out build | (**no established pattern — see Task 4**) | — |

## Database/API Schema Changes

No database or wire schema changes. Two in-repo interface changes:

| Interface | Before | After | Breaking? |
|---|---|---|---|
| `expandIncludes(content, srcPath, extraSources?)` | Expands every marker in `content` unconditionally | Returns `content` unchanged unless `srcPath` resolves to a declared marker site; expands as before when it does | Yes — for callers passing a non-declared `srcPath` and expecting expansion. The only such callers are `scripts/build.test.ts`'s fixtures (Task 4) |
| `facts.ts` exports | — | `+ INCLUDE_MARKER_SITES: string[]` (repo-relative POSIX paths) | No — additive |
| `blackhole-vcodes.md` | — | `+ V-INCLUDE-02` row | No — additive |

## Execution Strategy & Stop Conditions

- Sequence is fixed: Task 1 (baseline) → 2 (failing tests) → 3 (gate) → 4 (fixture seam) → 5
  (scan leg) → 6 (V-code row + rebuild) → 7 (latent markers) → 8 (docs) → 9 (verify).
  Task 4 must land in the same commit as Task 3 — `bun test` is red between them. **If Task 4's
  seam cannot be built without changing `build.ts`'s public CLI surface, stop and escalate
  rather than widening Touch-Paths.**
- Assignment: single `implementer` agent (sonnet), one worktree, one PR. No fan-out — the tasks
  are strictly sequential and share one file set.
- The change lands inside the build primitive, so verification is a full `bun run verify` (which
  runs `bun run build` plus byte-parity checks) **and** a full `bun test`, not the check suite
  alone. **If `git status --porcelain` shows any modification under a compiled tree
  (`.claude/`, `.cursor/`, `.agents/build/`, `agents/`, `codex-*`, `plugins/`, `skills/`,
  `references/`) that is not attributable to Task 6's intended `blackhole-vcodes.md` rebuild,
  abort and revert** — that is the signature of the gate suppressing a legitimate expansion.
- **If `bun run verify` reports fewer than 92 passing checks at any point after Task 5, stop and
  revert to the last green commit** rather than adjusting the check to match the code.
- **If the T6 end-to-end fixture cannot be made to pass without adding its fixture path to the
  production `INCLUDE_MARKER_SITES` value, stop and escalate** — a test fixture inside a
  production declared fact would make the new scan leg unfalsifiable.

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run `bun run verify` and `bun test` on a fresh worktree at
  `plan_base_commit` before modifying anything. — **AC**: both commands run; verify's
  passed/total ratio and `bun test`'s pass/fail counts quoted verbatim in the completion
  evidence. Expected at plan time: verify 92/92, `bun test scripts/build.test.ts` 79/79.
- [ ] **Write Failing Tests** (`V-TEST-01/02`): Author, before any implementation, (a) a
  regression test that plants a literal `{{INCLUDE:references/audits/*}}` in a `.ts` doc comment
  under a `content-gates` glob target and asserts `read()` returns it byte-identically and the
  file's measured LOC is unchanged — the issue's AC-2 verbatim; (b) a unit test asserting
  `expandIncludes` expands for a declared site and no-ops for an undeclared one; (c) unit tests
  for both legs of the new scan (Task 5). — **AC**: all three test groups exist and fail for the
  expected reason (not for an import or syntax error) before Task 3 lands; failure output quoted.
- [ ] **Declare the fact and gate the primitive**: Add `INCLUDE_MARKER_SITES` to `facts.ts`'s
  `§ facts` block, doc-commented in the same declared-fact/independent-scan idiom as its
  neighbours and cross-referencing `BUILD_INPUT_ONLY_DIRS` as the sibling registry (critic B's
  adjacent-SSOT finding). Gate `expandIncludes` on it, computing the repo-relative path with the
  `path.relative(root, …).split(path.sep).join('/')` idiom `isBuildInputOnlyPath` already uses.
  — **AC**: `bun run verify` reports 92/92; test group (a) and (b) from the previous task pass;
  `git diff --stat` shows no compiled tree touched.
- [ ] **Build the fixture seam — highest-risk task, the accepted cost of this decision**
  (`V-TEST-10`, `V-UNFALSIFIABLE-01`): The gate breaks 6 of 79 tests in `scripts/build.test.ts`
  (verified, not predicted) because the ADR-034 T1 and T6 fixture suites drive `expandIncludes`
  with shell paths that are not declared sites. Two legs, two different seams — they cannot share
  one:
  * **T1 (unit)** — the fixtures call `expandIncludes` directly, so add an optional trailing
    site-list parameter defaulting to `INCLUDE_MARKER_SITES`, matching the existing
    `extraSources = []` convention on the same function (a default that reproduces production
    behaviour byte-for-byte). The T1 fixtures pass their own list.
  * **T6 (end-to-end)** — this leg shells out to `bun run build` and cannot receive a function
    parameter. Read one environment variable in `content.ts`, parsed once at module scope into a
    path list and unioned with `INCLUDE_MARKER_SITES`; the T6 test sets it for the child process
    only. **No established pattern for this exists in the repo** (see § Codebase Conventions) —
    if it cannot be built without changing `build.ts`'s public CLI surface, stop and escalate
    rather than widening Touch-Paths.
  * **Forbidden resolutions**, each of which would make `V-INCLUDE-02` unfalsifiable or hide the
    regression rather than fix it: adding a fixture path to the committed `INCLUDE_MARKER_SITES`
    value; adding a skip marker (`.skip`, `test.todo`) to any of the six tests; deleting or
    weakening any assertion in them; broadening the gate to accept any path containing
    `__fixture`.
  — **AC**: `bun test scripts/build.test.ts` reports 79 pass / 0 fail; `git diff` on that file
  adds no skip marker and removes no `expect(` call (verify with
  `git diff -- scripts/build.test.ts | grep -E '^-.*expect\(|^\+.*\.skip|^\+.*test\.todo'`
  returning empty); `INCLUDE_MARKER_SITES`'s committed value is exactly the two production agent
  shells; the environment seam is absent from the environment during a normal `bun run build` and
  `bun run verify` stays 92/92 with it unset.
- [ ] **Add the bidirectional scan leg** (`V-INCLUDE-02`): Extend
  `build-input-dirs.check.ts` with two legs mirroring `V-INCLUDE-01`'s A/B shape — Leg A: every
  path in `INCLUDE_MARKER_SITES` exists and contains at least one marker; Leg B: every marker
  found by a live scan of `src/**` sits in a declared site. Export both predicates as pure
  functions. — **AC**: `bun run verify` shows a passing `V-INCLUDE-02` row; adding a marker to an
  undeclared `src/` file makes Leg B fail (demonstrated in the unit test, not by hand); removing
  the marker from a declared site makes Leg A fail.
- [ ] **Register the V-code and rebuild**: Add the `V-INCLUDE-02` row to
  `src/references/blackhole-vcodes.md` (severity BLOCK, enforcement site
  `scripts/checks/build-input-dirs.check.ts`) and run `bun run build`. Re-derive any `§ facts`
  count this changes by reading the live value with its own parser at implement time — never
  write a literal before/after pair. — **AC**: `V-VCODE-01`, `V-CITE-01..03` and
  `V-SEVSYNC-01/02` all pass; the `blackhole-vcodes.md` row appears in every generated dist tree.
- [ ] **Normalize the latent markers** (issue AC-3): Rewrite
  `documentation/plans/plan-retrospective-v0.21.0-remediation.md:326` and
  `documentation/architecture/retrospective-blackhole.md:165` to the `<dir>` placeholder spelling.
  — **AC**: `grep -rn '{{INCLUDE:[^<]' documentation/ src/ scripts/` returns exactly two hits,
  both being `src/agents/reviewer.md` and `src/agents/implementer.md`. Scope: `documentation/`,
  `src/`, `scripts/`. Exemptions: the two declared marker sites, and this plan's own quoted
  examples if it is later promoted into `documentation/plans/`.
- [ ] **Reconcile the documentation** (`V-DOCFACT-01`): (a) Rewrite `facts.ts`'s
  `{{...}}`-quoting workaround comment to state the declared-site rule and drop the workaround —
  the comment is currently the only thing preventing the bug it describes. (b) Correct
  `documentation/reference/check-utils-blast-radius.md`'s three disagreeing consumer counts
  (header 29, table 32 rows, live `read` importers 39) by re-measuring each with the `rg` command
  in that doc's own § Maintenance section, and label which set each number counts — they are three
  different sets, none wrong, in one internally inconsistent document. (c) Add a one-line comment
  at `check-common.ts:26` recording the § Accepted Residuals item 1 no-op proof, so the next
  reader does not delete the wrong call. — **AC**: no comment or doc sentence in the diff asserts
  that a literal marker in a non-site file would expand; each of the blast-radius doc's three
  counts is reproducible by a command quoted in that doc; `check-common.ts` carries the no-op
  note and both its `expandIncludes` and `read` calls are unchanged.
- [ ] **Verify Integrity**: Run `bun run verify` and `bun test` in full. — **AC**: verify ≥ 92/92
  with `V-INCLUDE-02` present; `bun test` shows zero failures, zero skips added, no assertion
  removed; `git status --porcelain` clean apart from intended Touch-Paths and the Task 6 rebuild.

## Sprint Contract

One issue, one branch (`blackhole/issue-882`), one PR closing #882. No scope beyond Touch-Paths.
All four staged artifacts (ADR-039 body, decisions INDEX row, ARCHITECTURE.md constraint, durable
plan body) are carried into this PR by the implementer's carry-step per ADR-021 D2 — the
implementer commits them, it does not re-author them. A declared-but-uncarried artifact is
`V-AUTO-02` (BLOCK).

## Dependency Blast-Radius

The changed interface is `expandIncludes`, reached by three call paths plus one local
reimplementation. `read()` — itself one of those callers — has its own large consumer graph,
which is why this section is required (`V-SCOPE-03`; 29–39 consumers, well past the 3-consumer
trigger).

| Consumer tier | Count | Classification | Evidence |
|---|---|---|---|
| Direct `expandIncludes` callers | 4 (`check-utils.ts:16`, `vcode-citation.check.ts:142`, `content.ts:200`, `router-local-analyze.test.ts:18`) | TRANSPARENT | `bun run verify` 92/92 under a patched detached worktree |
| `read()` importers | 39 modules (32 `*.check.ts` rows in the blast-radius table; 29 in its stale header) | TRANSPARENT | none require a source edit — verified, not assumed |
| Compiled output trees | 6 agent trees + 9 reference trees | TRANSPARENT | build byte-parity checks ran inside the same 92/92 verify pass |
| `scripts/build.test.ts` fixtures | 6 of 79 tests | **BREAKING** | `bun test scripts/build.test.ts` → 73 pass / 6 fail under the naive gate. Task 4 exists to close exactly this |

Underestimation risk: the build path is the widest surface and the one a check-suite-only
verification would miss. Both the Execution Strategy stop conditions and Task 9's AC require the
full `bun run verify` (which builds) plus full `bun test`.

## Accepted Residuals

Recorded so the next reader does not re-derive them, or "fix" one by deleting the wrong side.

1. **`readComposedAgentDoc`'s double expansion survives as a provable no-op.**
   `scripts/lib/check-common.ts:26` calls `expandIncludes(read(rel), …)` where `read()` has
   already expanded. **Proof it is a no-op, not luck**: after the first pass a declared site's
   content contains no `{{INCLUDE:...}}` substring, so `INCLUDE_MARKER` — a global regex over the
   already-expanded string — matches nothing on the second pass; and for a non-declared path the
   site gate returns the input unchanged in both passes. It is *not* deleted here because
   choosing which of the two helpers should own composition is the rejected call-site-opt-in
   option's territory, and settling it inside this diff would be scope creep (`V-SCOPE-01`).
   **Do not read the duplication as evidence that either call is wrong.** Add a one-line comment
   at that call site stating the no-op proof (Task 8) rather than removing either call.
2. **Adjacent SSOT.** `INCLUDE_MARKER_SITES` (files) and `BUILD_INPUT_ONLY_DIRS` (directories)
   both describe where `{{INCLUDE}}` is intentionally live, at different granularities, in
   separate registries free to drift. Mitigation is a cross-reference in each declaring doc
   comment (Task 3), not a mechanical join — joining them would couple "where modules live" to
   "where a marker is a directive", which are genuinely different questions. Revisit if a third
   registry on this axis is ever proposed.
3. **The two latent `documentation/` markers become inert by construction**, not by their wrong
   directory depth. Task 7 still normalizes them to the `<dir>` spelling so the placeholder
   convention stays legible, but after this change neither could expand even if the depth were
   corrected.

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

## References

- **Design note**: `.blackhole/plans/issue-882-design.md` — three options, blind-critic scoring,
  and the `blocked` verdict this plan is contingent on
- **ADR**: `documentation/decisions/ADR-039-declared-include-marker-sites.md` — chosen approach:
  declared marker-site allowlist gated inside `expandIncludes`; rejected: path-prefix gating in
  `read()`, call-site opt-in via `readComposedAgentDoc`, `<dir>`-placeholder convention
  enforcement. Accepted 2026-09-06 by owner ruling over a `blocked` design-aggregate verdict.
  Staged at `.blackhole/staged/882/`, not yet in the tree at plan time
- **ADR**: `documentation/decisions/ADR-034-audit-module-seam.md` — the `{{INCLUDE:<dir>/*}}`
  primitive this plan scopes; chosen approach: generic marker expanded in `processFile`;
  rejected: runtime `hunt/`-style loading, per-target assembly. Read for
  `## Post-acceptance amendments` before citing: none present at plan time
- **Blast radius**: `documentation/reference/check-utils-blast-radius.md`
- **Provenance**: PR #872 recheck; commit `afc62f9f` introduced the unconditional call
