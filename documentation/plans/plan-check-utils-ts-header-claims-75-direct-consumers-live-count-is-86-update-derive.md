---
issue: 960
rulings_checked_at: 5
ruling_conflicts: []
type: plan
summary: "Implementation plan for check-utils.ts's stale header consumer-count comment: chooses mechanical enforcement (V-BLASTRADIUS-01, a new bun run verify check) over a one-time hand-fix, reusing ground-truth.check.ts's existing declared-vs-scanned comparator"
status: current
review_trigger: "on scripts/checks/check-utils.ts import-site change"
created: 2026-09-07
last_updated: 2026-09-07
related:
  - scripts/checks/check-utils.ts
  - documentation/reference/check-utils-blast-radius.md
  - scripts/checks/ground-truth.check.ts
  - scripts/checks/tree-registry.check.ts
---

# Plan - Issue #960

## Objective

`scripts/checks/check-utils.ts`'s header comment states a hand-maintained "direct consumers"
count that has drifted stale six times already (#410, #462, #498, #570, #882, #945) — each time
caught only by a human noticing during an unrelated PR, never by a mechanical gate. The header
currently reads (verified this planning session, `git -C <repo> rev-parse HEAD` = `a5a7d6f8`):

```
// Dependency blast-radius (75 direct consumers, issue #882 re-measurement — see that doc's §
// Maintenance for the exact command and what this figure counts): documentation/reference/check-utils-blast-radius.md
```

**Live re-derivation performed this session** (issue AC1 — do not trust the 86 the issue itself
cites, which was already a point-in-time #945 measurement; a fresh count is required, both here
and again at implementation time since this is a live multi-worker campaign):

```bash
# 1. documentation/reference/check-utils-blast-radius.md's own table scope (*.check.ts + verify.ts)
rg -l "from ['\"].*check-utils" scripts/checks/*.check.ts scripts/verify.ts | wc -l   # 58 (doc's table already says 57 modules + verify.ts = 58 — this matches, doc is current)

# 2. check-utils.ts's own header scope — every scripts/ file (tests included)
rg -l "from ['\"].*check-utils" scripts --glob '!wt-*' | wc -l                        # 87 (doc's § Maintenance annotates "86" — one file landed since that annotation was last written)

# 3. Files importing the `read` symbol specifically (subset of #2)
rg -l "from ['\"].*check-utils" scripts --glob '!wt-*' \
  | xargs grep -lE "import\s*\{[^}]*\bread\b" | wc -l                              # 42
```

`documentation/reference/check-utils-blast-radius.md` is **not itself stale** — its own table
(command #1) and its § Maintenance section already document all three commands, already correctly
identify command #2 as "what `check-utils.ts`'s own header comment should always match," and
already record the count-conflation root cause from issue #882 (the header, the table, and a
live count are three genuinely different sets, not one number restated three ways). Only
`check-utils.ts`'s own header — which is not mechanically checked by anything — has drifted
against the doc's own prescription.

**Decision (issue AC2): Option 2 — derive it via a new mechanical `bun run verify` check.**

**Rationale — why Option 2 over Option 1 (update the literal) or Option 3 (drop the number):**
- This repo already has the precedent the issue names: `tree-registry.check.ts` (`V-TREE-01`)
  asserts a declared registry against a live scan. More directly on point,
  `ground-truth.check.ts` already exports `findRowCountMismatch(label, declared, actual)` — a
  **declared-count-in-a-comment vs. independently-scanned-count** comparator, the exact shape
  this issue needs, already built and tested for `VCODE_TABLE_ROW_COUNT`. Reusing it (`V-INT-02`)
  rather than writing a second divergent count-comparator is the correct move, not a new pattern.
- Option 1 (hand-update to 87) is what happened five times already (#410, #462, #498, #570, #882)
  and it drifted again every time — the issue's own words, "guarantees this issue recurs," are
  demonstrated by this repo's own history, not hypothetical.
- Option 3 (drop the number) is cheaper but throws away real information: the blast-radius doc's
  own "Overall blast radius: HIGH" framing depends on a maintainer being able to see, at the one
  file they're about to touch, roughly how big "HIGH" is — a bare qualitative warning with no
  number is *less* actionable than a number that is guaranteed accurate. Given this repo already
  has the exact reusable comparator (`findRowCountMismatch`) and an established check-authoring
  pattern (`control-char.check.ts`'s recent, fully red-before-green-documented PR #959, itself the
  PR that surfaced this issue), the marginal cost of Option 2 over Option 3 is small and the
  value is strictly higher: a check that fails is drift made structurally impossible, not merely
  fixed once more.
- **Self-referential consequence, accounted for below**: the new check module itself imports
  `check-utils.ts` (`root`, `read`, `CheckResult` — every check module does), so it becomes one
  more direct consumer the moment it exists. Its paired test file is written to need **no**
  `check-utils.ts` import (pure functions over injected fixtures — see Task Breakdown), so it does
  not also inflate the count. The live counts above are therefore a *starting point*, not the
  final numbers — Task 6 below re-derives them fresh, after the new files exist, immediately
  before writing any literal into `check-utils.ts` or the blast-radius doc.

**New V-code**: `V-BLASTRADIUS-01` (BLOCK — this check can return `ok:false`, unlike the
`V-TREE-01`-family advisory checks the issue cites for precedent; a check that never actually
fails cannot make drift "impossible," it can only note it, and `scripts/verify.ts` treats any
`ok:false` from any check as a required-CI failure regardless of the table's stated
severity column, so BLOCK is the honest severity for a check built to fail).

**Invariance (issue AC5)**: no `check-utils.ts` **function** (`root`, `read`, `CheckResult`) is
modified — only its header comment. `bun test` — every pre-existing test keeps passing
unmodified; the new test file adds strictly new, passing cases (same reporting shape as PR #959's
own evidence: "2527 pass, 0 fail (2513 baseline + 14 new)" — a total increase from new tests is
expected and is not a regression; a *drop* in the pre-existing baseline count would be).

## Touch-Paths

- `scripts/checks/check-utils.ts` — header comment only, no function body change
- `scripts/checks/check-utils-blast-radius.check.ts` — new
- `scripts/verify.check-utils-blast-radius.test.ts` — new (test-pairing convention:
  `scripts/checks/<name>.check.ts` ↔ `scripts/verify.<name>.test.ts`)
- `documentation/reference/check-utils-blast-radius.md`
- `src/references/blackhole-vcodes.md` — plus all generated dist trees per `scripts/lib/build/targets.ts`
- `scripts/lib/build/facts.ts` — `VCODE_TABLE_ROW_COUNT` bump (companion to the `blackhole-vcodes.md`
  row-add above, per the declared-fact/independent-scan SSOT pair `scripts/lib/plan-touch-path-ssot-pairs.ts`
  already tracks for this exact pairing)

Not a Touch-Path: `documentation/reference/decision-log.md` — orchestrator-owned, append-only,
written solely by the orchestrator at merge time (`orchestrator.md`), never by a plan or a worker
(same treatment as `.blackhole/plans/issue-955.md`'s Touch-Paths note).

## Documentation Impact (docs_governance.enabled: true)

Both affected companion docs are already existing files, both already declared as Touch-Paths
above — no new `documentation/` file is created, so search-before-write does not apply:

- `documentation/reference/check-utils-blast-radius.md` — reconcile its consumer table (new
  `check-utils-blast-radius.check.ts` row), its `**Count:**` line, and its § Maintenance
  annotated example outputs against the fresh Task 6 re-derivation; append one reconciliation
  sentence to its existing "refreshed again at #NNN" provenance paragraph, matching that
  paragraph's own established convention.
- `src/references/blackhole-vcodes.md` — one new row for `V-BLASTRADIUS-01` (Code/Rule/Severity/
  Primary enforcement site, matching the live table's exact column shape).
- `ARCHITECTURE.md` / `DESIGN.md` / `documentation/decisions/INDEX.md`: not applicable — no
  architectural decision, no ADR, no visual/design-token change.

## Task Breakdown

- [ ] **TDD Baseline Verification**: `free -m` MemAvailable ≥ 2000MB check, then
  `flock /tmp/blackhole-verify.lock -c 'bun test scripts/checks/ground-truth.check.ts scripts/verify.vcode-citation.test.ts scripts/verify.vcode-severity-sync.test.ts scripts/verify.control-char.test.ts scripts/verify.tree-registry.test.ts'`
  (scoped to the check modules this plan's new file reuses (`ground-truth.check.ts`,
  `control-char.check.ts`) and the check modules that scan `blackhole-vcodes.md`/`facts.ts`,
  which this plan edits — never the full suite for a baseline read, per resource policy). —
  **AC**: all pass; pass count quoted in the completion evidence for later invariance comparison
  (Task 9).
- [ ] **Write Failing Tests**: create `scripts/verify.check-utils-blast-radius.test.ts` importing
  `parseDeclaredBlastRadiusCount`, `hasCheckUtilsImport`, `findCheckUtilsConsumers`, `runChecks`
  from `./checks/check-utils-blast-radius.check.ts` (does not yet exist), plus
  `findRowCountMismatch` from `./checks/ground-truth.check.ts` (already exists, reused not
  reimplemented). Cover: (a) `parseDeclaredBlastRadiusCount` extracts the declared N from a
  `// Dependency blast-radius (N direct consumers...` fixture string and returns `null` when no
  count is present; (b) `hasCheckUtilsImport` is `true` for a fixture string containing
  `from './check-utils.ts'` (any relative depth) and `false` for an unrelated import; (c)
  `findCheckUtilsConsumers(files, readFn)` filters a fixture file-list to only those whose
  injected `readFn` content matches; (d) a **red-before-green demonstration of the control's own
  fallibility (V-UNFALSIFIABLE-01)** — call `findRowCountMismatch('check-utils.ts header
  consumer count', 999, 3)` (deliberately mismatched fixture numbers — the exact comparison
  `checkCheckUtilsBlastRadius()` will perform) and assert it returns a non-null string, proving
  the mismatch branch is reachable and produces a real signal, not an always-`ok:true` no-op;
  also assert `findRowCountMismatch('label', 5, 5)` returns `null` (the match branch); (e) a
  live-repo sanity call `runChecks()[0].ok === true` against the real, currently-correct tree
  (once the header is corrected in Task 6, this becomes the check's own self-verification that
  the live repo passes its own new gate). — **AC**: `bun test
  scripts/verify.check-utils-blast-radius.test.ts` fails — `Cannot find module
  './checks/check-utils-blast-radius.check.ts'` (the module does not exist yet) — quoted in the
  completion evidence, matching PR #959's own red-before-green evidence shape for this exact
  check-authoring pattern.
- [ ] **Implement `scripts/checks/check-utils-blast-radius.check.ts`**: exports (a)
  `parseDeclaredBlastRadiusCount(headerContent: string): number | null` — regex
  `/Dependency blast-radius \((\d+) direct consumers/`; (b) `hasCheckUtilsImport(content:
  string): boolean` — regex `/from\s+['"][^'"]*check-utils(?:\.ts)?['"]/`, same substring-match
  semantics as the doc's own `rg "from ['\"].*check-utils"` command; (c)
  `findCheckUtilsConsumers(candidateFiles: string[], readFn: (rel: string) => string): string[]`
  — pure filter over `hasCheckUtilsImport(readFn(f))`, injectable for fixture testing; (d) an
  unexported `checkCheckUtilsBlastRadius(): CheckResult` wired to the real `root`/`read` (imported
  from `./check-utils.ts`) and the real `listTrackedFiles` (imported from
  `./control-char.check.ts`, reused not reimplemented — `V-INT-02`): reads
  `scripts/checks/check-utils.ts`'s header via `read()`, parses the declared count, lists
  git-tracked files via `listTrackedFiles(root)` filtered to `f.startsWith('scripts/') &&
  f.endsWith('.ts') && f !== 'scripts/checks/check-utils.ts'`, runs `findCheckUtilsConsumers`
  against them with `read` as the injected `readFn`, and compares via
  `findRowCountMismatch('scripts/checks/check-utils.ts header consumer count', declared,
  consumers.length)` (imported from `./checks/ground-truth.check.ts`); returns `{ id:
  'V-BLASTRADIUS-01', ok: false, detail: <mismatch string> }` on a mismatch or when
  `parseDeclaredBlastRadiusCount` returns `null`, else `{ id: 'V-BLASTRADIUS-01', ok: true }`; (e)
  `export const runChecks = (): CheckResult[] => [checkCheckUtilsBlastRadius()]` (the
  `scripts/verify.ts` glob-discovery entry point every `*.check.ts` module provides). — **AC**:
  the Task 2 test file's units (a)-(d) now pass; unit (e)'s live-repo sanity assertion
  (`runChecks()[0].ok === true`) still fails at this point, because `check-utils.ts`'s header
  literal has not been corrected yet (Task 6) — expected and resolved by that task, not a defect
  in this one.
- [ ] **Add the `V-BLASTRADIUS-01` row to `src/references/blackhole-vcodes.md`** (SSOT — the
  built dist-tree copies are regenerated, never hand-edited): insert one row in the existing
  `| Code | Rule | Severity | Primary enforcement site |` table, alphabetically positioned by
  code among the existing `V-B*` rows: `| V-BLASTRADIUS-01 | check-utils.ts header's declared
  direct-consumer count diverges from a live scripts/**/*.ts import scan (recurring silent drift
  — #410/#462/#498/#570/#882/#945/#960) | BLOCK | scripts/checks/check-utils-blast-radius.check.ts |`.
  — **AC**: `grep -c "^| V-" src/references/blackhole-vcodes.md` output (call it `R`) is quoted in
  the completion evidence; `grep -n "V-BLASTRADIUS-01" src/references/blackhole-vcodes.md`
  matches exactly once.
- [ ] **Bump `VCODE_TABLE_ROW_COUNT` in `scripts/lib/build/facts.ts`** to the live `R` value from
  the previous task's `grep -c` re-derivation (never hand-arithmetic on a value frozen at plan
  time — this campaign runs up to 6 concurrent workers, so the live row count at implementation
  time may already differ from any number this plan could state). — **AC**:
  `flock /tmp/blackhole-verify.lock -c "bun test scripts/checks/ground-truth.check.ts"` (or
  equivalent scoped `V-GROUND-01` re-check) passes with the new value.
- [ ] **Live re-derivation + header/doc reconciliation (issue AC1)**: re-run all three
  `rg`/`grep`-based commands from the Objective's Live Re-derivation block, now that Tasks 3-4
  have landed the new check+test files (the new check module is itself one more direct consumer,
  per the Objective's Self-referential-consequence note — cmd2 and cmd3's outputs both shift by
  exactly +1 versus the Objective's numbers; cmd1's `Count:` line shifts by +1 for the same
  reason). Set `check-utils.ts`'s header literal to the fresh cmd2 output, and update its prose
  to name the mechanical check rather than a stale issue-number citation (see the Objective's
  shown header text for the target wording pattern — reference `V-BLASTRADIUS-01` and
  `check-utils-blast-radius.check.ts` by name, drop the "issue #NNN re-measurement" phrasing since
  the number is no longer a point-in-time human measurement). Update
  `documentation/reference/check-utils-blast-radius.md`: add the new check's row to the consumer
  table (alphabetically, between `build.check.ts` and `checkpoint.check.ts`), bump the `##
  CheckResult consumers (N modules)` heading and `**Count:**` line by the same +1, update all
  three § Maintenance annotated example numbers (`# 58`→fresh cmd1, `# 86`→fresh cmd2, `#
  42`→fresh cmd3) to the freshly re-derived values, and append one sentence to the existing
  "refreshed again at #NNN" provenance paragraph documenting #960's reconciliation and the new
  mechanical enforcement (matching that paragraph's established per-issue append convention). —
  **AC**: `bun test scripts/verify.check-utils-blast-radius.test.ts` — every case from Task 2
  now passes, including the live-repo sanity assertion (`runChecks()[0].ok === true`), quoted in
  the completion evidence.
- [ ] **Rebuild dist trees**: `free -m` MemAvailable ≥ 2000MB check, then
  `flock /tmp/blackhole-verify.lock -c 'bun run build'` (regenerates every duplicated copy of
  `blackhole-vcodes.md` from the edited `src/references/blackhole-vcodes.md` SSOT). — **AC**:
  exits 0; `git diff --stat` includes the edited SSOT plus its regenerated mirror paths (per
  `scripts/lib/build/targets.ts`), and no other file changes.
- [ ] **Verify Integrity + Invariance (issue AC5)**: `free -m` MemAvailable ≥ 2000MB check, then
  `flock /tmp/blackhole-verify.lock -c 'bun run verify'` followed by
  `flock /tmp/blackhole-verify.lock -c 'bun test'`. — **AC**: `bun run verify` exits 0 including a
  passing `✓ V-BLASTRADIUS-01`; `bun test`'s pre-existing (Task 1 baseline) pass count is
  unchanged (no regression) and the new file's tests are all green — both counts quoted in the
  completion evidence, matching the Objective's stated Invariance framing.

## Sprint Contract

- Live consumer count re-derived at implementation time and reported, not trusted from the issue
  or this plan (issue AC1) — satisfied by the Objective's initial re-derivation plus Task 6's
  fresh re-derivation after the new files land.
- One of the three options chosen with rationale recorded (issue AC2) — satisfied by the
  Objective's "Decision"/"Rationale" subsections (Option 2 chosen).
- Red-before-green for `V-UNFALSIFIABLE-01`, since Option 2 was chosen (issue AC3) — satisfied by
  Task 2's fixture-based mismatch-branch demonstration plus Task 2's quoted module-not-found
  failure before Task 3 implements the module.
- Invariance: no `check-utils.ts` function changed; `bun test` shows zero regression in the
  pre-existing pass count (issue AC5) — satisfied by Task 9's AC, compared against Task 1's
  baseline.
- Tasks with no narrower AC default to: full test suite green, `bun run verify` clean — already
  the explicit AC on Tasks 1 and 9.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |
