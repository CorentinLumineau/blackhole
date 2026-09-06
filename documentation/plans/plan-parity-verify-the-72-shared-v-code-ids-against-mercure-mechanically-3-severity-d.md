---
issue: #869
supersedes_adr: null
type: plan
summary: "Implementation plan for issue #869 — mechanize V-code severity parity against mercure via a vendored snapshot check"
status: current
review_trigger: "on file change"
created: 2026-09-07
last_updated: 2026-09-07
related:
  - documentation/decisions/ADR-013-mercure-parity-program.md
  - documentation/decisions/ADR-021-durable-artifact-staging.md
  - documentation/decisions/ADR-024-v-pareto-code-split.md
  - documentation/audits/mercure-parity-matrix.md
---

# Plan - Issue #869

## Objective

Mechanize V-code severity parity against mercure by extending the existing vendored-snapshot
pattern (ADR-013 D1, `mercure-parity-matrix.md` / `prj-mercure-sync`) to a second object: the
72 shared V-code IDs between mercure's `mercure-plugin/rules/references/v-codes-*.md` (110
codes, v9.15.0) and blackhole's own `src/references/blackhole-vcodes.md` (114 codes today).

Per `.blackhole/plans/issue-869-analysis.md` (established, not re-derived here): a live cross-repo
parse or a wait-for-mercure-to-emit design are both structurally ruled out — blackhole's PR-gating
CI (`verify.yml`) has zero reachable path to `CorentinLumineau/mercure` (private repo, no
cross-repo secret, and GitHub Actions does not forward secrets to fork-triggered `pull_request`
runs regardless). The only viable shape is option (a): a vendored snapshot, committed to this
repo, refreshed by a maintainer on a cadence, checked at `bun run verify` time as **advisory
only** — it can only assert "as of the last sync," never block on data it cannot currently fetch.

This plan settles the four concrete outputs the issue's "Fix direction" asks for, and explicitly
scopes one item down (description-drift detection) with a stated reason — see Design Decisions.

### What this plan resolves, one line each

1. **Vendoring mechanism**: a new pure-parse script (`scripts/lib/mercure-vcode-snapshot.ts`)
   reads mercure's 8 `v-codes-*.md` files from a maintainer-supplied local clone path and writes
   a committed JSON snapshot (`documentation/audits/mercure-vcode-snapshot.json`); the existing
   `prj-mercure-sync` skill's sweep gains one documented step that invokes it.
2. **The check**: `scripts/checks/vcode-parity.check.ts` (`V-MPARITY-01/02`), advisory (WARN),
   auto-discovered by `verify.ts`'s existing glob runner — no new registration point.
3. **The 2 actionable severity disagreements** (`V-ADA-05`, `V-DOC-GOV-01`): documented
   divergence notes in `blackhole-vcodes.md`, following the `V-PARETO-02`/`V-SOLID-04` precedent
   and upheld by ADR-021 D5 / ADR-024 D4 — no renumbering. `V-DOC-07` is confirmed a
   tier-collapse artifact, not a real disagreement (see Design Decisions) — no code change.
4. **The 2 undocumented collisions** (`V-BRANCH-03`, `V-ADA-05`): same divergence-note treatment.

`mercure-parity-matrix.md` PM-090's stale `gap` row is **not** touched by this plan — see Design
Decisions § PM-090.

## Design Decisions

### D1 — Severity comparison uses blackhole's own tier-collapse mapping, not raw string equality

blackhole's severity column is binary (`BLOCK`/`WARN`); mercure's is four-tier
(`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`, `mercure-enforcement-contract.md`'s own severity model:
CRITICAL/HIGH→BLOCK, MEDIUM→WARN, LOW→INFO). A raw string comparison (`"LOW" !== "WARN"`) would
flag every single shared code as a "disagreement" — that is exactly how the issue's own finding
table over-counted `V-DOC-07` as a severity disagreement when it is not one.

The check maps mercure's severity to blackhole's collapsed action tier before comparing:
`CRITICAL|HIGH → BLOCK`, `MEDIUM|LOW → WARN` (blackhole has no INFO tier, so LOW collapses into
WARN exactly as MEDIUM does). Under this mapping:

| Code | mercure severity | mapped | blackhole actual | Real mismatch? |
|---|---|---|---|---|
| `V-ADA-05` | HIGH | BLOCK | WARN | **yes** — allowlisted, divergence documented |
| `V-DOC-GOV-01` | HIGH | BLOCK | WARN | **yes** — allowlisted, already documented |
| `V-DOC-07` | LOW | WARN | WARN | no — tier-collapse artifact, not allowlisted (nothing to suppress) |
| `V-SOLID-04` | MEDIUM | WARN | WARN | no — existing row note is a historical #441 deliberation record, not a live mismatch |
| `V-PARETO-02` | MEDIUM | WARN | WARN | no — meaning collision only, not a severity mismatch under the mapping |
| `V-BRANCH-03` | MEDIUM | WARN | WARN | no — meaning collision only, not a severity mismatch under the mapping |

This reproduces the orchestrator's own framing (2 actionable severity items, `V-DOC-07` is a
scale artifact) as a *consequence of correct tier mapping*, not as a hand-maintained exclude
list — only `V-ADA-05` and `V-DOC-GOV-01` need an allowlist entry to suppress `V-MPARITY-01`.

### D2 — `V-ADA-05` and `V-BRANCH-03`: document, do not renumber

ADR-021 D5 rejected renumbering `V-PARETO-02` for a mercure naming collision because the SSOT
heading touches 9 hunt-kind files. ADR-024 D4 later **upheld** that specific disposition while
minting a *fresh* code (`V-PARETO-03`) for an unrelated, blackhole-internal semantic overload
(two incompatible blackhole-native rules sharing one ID) — a materially different case from a
cross-plugin ID collision. `V-ADA-05` and `V-BRANCH-03` are the cross-plugin-collision case, not
the internal-overload case: within blackhole's own table each already has exactly one coherent
meaning and one enforcement site. Renumbering either would touch every ledger row, agent prompt,
and check that currently cites it for zero behavioral gain — the fix is documentation, per the
established precedent, not a mint.

`V-ADA-05` is grouped in one table row with `V-ADA-06/07` (`AGENTS.md` family). The divergence
note must be scoped to `V-ADA-05` alone — `V-ADA-06/07` have no mercure counterpart and must not
read as diverging.

### D3 — Description-drift detection is scoped out of this plan (stated, not silently dropped)

The issue's Fix direction #1 asks the check to fail on "shared-ID severity **or description**
drift." mercure's column and blackhole's `Rule` column are independently authored prose for the
same concept in the common case (e.g. `V-SOLID-01/03`: mercure "SOLID — SRP/LSP" vs blackhole
"Single responsibility; substitutability") — a literal string-inequality check would flag
essentially all 72 shared IDs as "drifted," which is not a signal, it is noise that would need
~70 allowlist entries to be usable. That defeats the purpose of an allowlist (a handful of
*decided* divergences, not the majority case). No non-noisy comparison algorithm (e.g. a
calibrated token-overlap threshold) is proposed or validated by this issue's evidence, and
inventing one un-validated is exactly the speculative-feature risk `V-YAGNI-01`/`V-KISS-01` name.

**Scoped out**: description-drift detection ships as a documented gap, not a checked axis, in
this PR. A follow-up issue should first validate a similarity heuristic against the real 72-ID
corpus (measuring false-positive rate) before it is wired into a WARN-emitting check.

### D4 — Refresh mechanism: a new script, not a new maintainer skill (ADR-003)

Two candidates: extend `prj-mercure-sync`'s existing sweep prose only, or a small new
hand-run script. Neither alone is correct: `blackhole-protocol.md`'s ADR-003 states "a step
whose output is a pure function of files or JSON is a `bun run scripts/<name>.ts` invocation;
prose holds only judgment" — parsing mercure's 8 markdown tables into a JSON snapshot is exactly
such a pure function, so it cannot be prose-only. Conversely, minting an entirely new
maintainer-facing skill for one more axis of the same mercure↔blackhole coupling
`prj-mercure-sync` already owns duplicates an existing cross-repo-coupling actor (`V-YAGNI-01`,
`V-DRY-01`).

**Decision**: a new script (`scripts/lib/mercure-vcode-snapshot.ts`) is the mechanism; the
existing `prj-mercure-sync` skill's documented sweep gains one new step naming the script
invocation — judgment (when to run it, whether to accept the diff) stays in the skill's prose,
the mechanical transform lives in the script. This is the same shape `prj-mercure-sync` already
uses for the parity matrix, extended by one artifact, not duplicated by a second actor.

### D5 — `mercure-parity-matrix.md` PM-090 is not touched by this plan

The matrix's own header states the single-writer rule verbatim: "`prj-mercure-sync` is the sole
future writer; a self-audit or reviewer finding a stale row files an issue, it does not edit
this file directly." Issue #869 *is* that filing for PM-090's stale `gap` status. No Touch-Path
in this plan includes `documentation/audits/mercure-parity-matrix.md` — correcting PM-090 is
`prj-mercure-sync`'s job on its next sweep, citing #869. Do not add a task for it.

### D6 — Snapshot staleness threshold is a declared fact, not a check-local literal

`scripts/lib/build/facts.ts` already holds the codebase's numeric-fact SSOT for declared
thresholds (`DOC_HEALTH_THRESHOLDS`, `VCODE_TABLE_ROW_COUNT`, `CONTENT_GATE_BUDGETS`) — this
plan is already touching that file for the row-count bump, so adding one more declared constant
(`MERCURE_VCODE_SNAPSHOT_STALE_DAYS = 90`, same 90-day window already used for doc-deprecation
staleness) follows the established pattern at the touchpoint (`V-INT-01`) rather than inventing a
check-local magic number.

## Touch-Paths

- `src/references/blackhole-vcodes.md`
- `scripts/lib/build/facts.ts`
- `scripts/checks/vcode-parity.check.ts` (new)
- `scripts/verify.vcode-parity.test.ts` (new)
- `scripts/lib/mercure-vcode-snapshot.ts` (new)
- `scripts/lib/mercure-vcode-snapshot.test.ts` (new)
- `documentation/audits/mercure-vcode-snapshot.json` (new)
- `.claude/skills/prj-mercure-sync/SKILL.md`
- plus all generated dist trees per `scripts/lib/build/targets.ts` (build regenerates the
  compiled agent/reference trees that quote `blackhole-vcodes.md`'s content — no other Touch-Path
  here is a build-input source file with its own dist tree)

## Documentation Impact

- `src/references/blackhole-vcodes.md` — updated in place (search-before-write satisfied: this
  is the existing SSOT table for V-codes, not a new file).
- `documentation/audits/mercure-vcode-snapshot.json` — new file, but **not** markdown; `doc-health.check.ts`
  walks `.md` files only (`walkMdFilesAbs`), so it needs no lifecycle frontmatter and no
  `documentation/INDEX.md` row. No `V-DOCHEALTH-02` exposure.
- `documentation/audits/mercure-parity-matrix.md` — **None, deliberately** — see Design
  Decisions § D5 (single-writer rule; this plan does not edit it).
- `.claude/skills/prj-mercure-sync/SKILL.md` — updated in place (existing sweep procedure gains
  one step); this file is a hand-maintained maintainer-only skill outside `src/` (verified: not
  referenced anywhere in `scripts/build.ts`), so it is edited directly, not regenerated by build.
- `ARCHITECTURE.md` `## Active Constraints` — gains one bullet, staged per Step 4 (Trigger B),
  not authored here directly (ADR-021 D1: no branch exists yet at Phase 2).

## Critical Files

- `src/references/blackhole-vcodes.md`
- `scripts/lib/build/facts.ts`
- `.claude/skills/prj-mercure-sync/SKILL.md`

## Codebase Conventions

| Concern | Established pattern | Site |
|---|---|---|
| Blackhole-side table parsing | `parseVcodeTableRows` / `expandVcodeTableKey` (4-column `\| Code \| Rule \| Severity \| Site \|`) — reuse, never reimplement | `scripts/lib/check-common.ts:107-138` |
| Mercure-side table parsing | Same split('\|').map(trim) + length-guard *technique*, different column interpretation (3-column `\| ID \| Severity \| Description \|`) — same precedent relationship as `parseVcodeTableRows`/`parseIndexTableRows` already coexisting in `check-common.ts` (shared technique, distinct shape) | `check-common.ts` doc comment above `parseIndexTableRows` |
| Named, cited, removable allowlist | `{ code, reason }[]` array, e.g. `KNOWN_SEVERITY_EXEMPTIONS` | `vcode-severity-sync.check.ts:60` |
| Check module shape | Pure exported finder functions + a thin `runChecks(): CheckResult[]` at the bottom; glob-discovered by `verify.ts`, no registration | `vcode-severity-sync.check.ts` (bottom), `verify.ts:12-13` |
| File-absent skip semantics | Optional/not-yet-existing artifact → `ok: true` skip branch, never an error | `parity-matrix.check.ts` case 1 |
| Declared numeric threshold | `§ facts` block constant, cited by the check, never a check-local magic number | `scripts/lib/build/facts.ts` `DOC_HEALTH_THRESHOLDS` |
| Check test location/naming | `scripts/verify.<check-name>.test.ts` for `scripts/checks/*.check.ts`; sibling `<name>.test.ts` for `scripts/lib/*.ts` | `scripts/verify.vcode-severity-sync.test.ts`; `scripts/lib/concern-slug.test.ts` |
| Pure function of files → script, not prose | "A step whose output is a pure function of files or JSON is a `bun run scripts/<name>.ts` invocation; prose holds only judgment" | `blackhole-protocol.md` (ADR-003) |
| `VCODE_TABLE_ROW_COUNT` companion bump | Any plan touching `blackhole-vcodes.md` with row-add language must also declare `scripts/lib/build/facts.ts` as a Touch-Path | `scripts/lib/plan-touch-path-ssot-pairs.ts` (`V-GROUND-01`) |

## Database/API Schema Changes

None — no database or public API surface. The only new "schema" is the vendored JSON snapshot's
own shape, fully specified here:

```json
{
  "synced_at": "<ISO8601, when the sync script last ran>",
  "mercure_version": "<mercure-plugin/.claude-plugin/plugin.json's version field>",
  "mercure_commit": "<git rev-parse HEAD in the mercure clone, or null if unresolvable>",
  "source_files": ["mercure-plugin/rules/references/v-codes-ada.md", "... (8 total)"],
  "codes": {
    "V-ADA-01": { "severity": "HIGH", "description": "..." }
  }
}
```

## Task Breakdown

1. **TDD Baseline Verification**: run `bun test` and `bun run verify` on `plan_base_commit` and
   quote pass/fail counts. — **AC**: baseline suite green, counts quoted in the completion
   evidence.

2. **Red: mercure table parser.** Write `scripts/lib/mercure-vcode-snapshot.test.ts` asserting
   `parseMercureVcodeTable(fixtureContent)` extracts `{id, severity, description}[]` from a
   fixture 3-column `| ID | Severity | Description |` markdown table (matching mercure's real
   header shape, including a hyphenated-category id and a lowercase-suffix id like `V-DOC-GOV-01`
   / `V-UX-04a`). — **AC**: test file exists and fails with a module-not-found/undefined error
   (RED, quoted in the PR body) before the module exists. `V-TEST-01/02`, `V-UNFALSIFIABLE-01`.

3. **Red: parity comparator.** Write `scripts/verify.vcode-parity.test.ts` asserting, against
   pure fixture data (never the real repo files):
   - `mapMercureSeverityToBlackholeAction('CRITICAL'|'HIGH')` → `'BLOCK'`;
     `('MEDIUM'|'LOW')` → `'WARN'`.
   - `findVcodeParityMismatches(mercureMap, blackholeSevMap, allowlist)`: a shared,
     non-allowlisted id with `mercure HIGH` vs `blackhole WARN` (e.g. a fake `V-FAKE-01`) is
     reported; the same pair with the id present in `allowlist` is not reported; a shared id with
     `mercure LOW` vs `blackhole WARN` is never reported regardless of allowlist (the mapping
     already agrees — this is the deliberate D1 non-circularity check: a fixture mirroring the
     real `V-DOC-07` shape must NOT produce a finding even with an empty allowlist).
   - `findSnapshotStaleness(syncedAt, thresholdDays, now)`: a `syncedAt` more than
     `thresholdDays` before `now` is stale; less is not; boundary-equal is not stale.
   — **AC**: this test file exists and fails (RED, quoted in the PR body) before
   `scripts/checks/vcode-parity.check.ts` exists. `V-TEST-01/02`, `V-UNFALSIFIABLE-01`.

4. **Implement `scripts/lib/mercure-vcode-snapshot.ts`**: `parseMercureVcodeTable(content)` (same
   idiom as `parseVcodeTableRows`, 3-column shape); a `main()` CLI taking `--mercure-root <path>`
   that reads the 8 known files under `<root>/mercure-plugin/rules/references/v-codes-*.md`,
   merges rows into one `codes` map, reads `<root>/mercure-plugin/.claude-plugin/plugin.json`'s
   `version` field, attempts `git -C <root> rev-parse HEAD` for `mercure_commit` (catches and
   nulls on failure — a non-git install must not crash the sync), and writes the JSON snapshot
   (schema above) to `documentation/audits/mercure-vcode-snapshot.json`. — **AC**: task 2's tests
   now pass (GREEN); the CLI path is exercised only by tests using local fixture files under a
   temp directory, never the real `/Users/morphism/Documents/git/mercure` path (keeps CI
   hermetic — that path does not exist in CI).

5. **Implement `scripts/checks/vcode-parity.check.ts`**: reads
   `documentation/audits/mercure-vcode-snapshot.json` (absent → `ok: true` skip on both codes,
   matching `parity-matrix.check.ts` case 1's precedent) and blackhole's own table via
   `parseVcodeTableRows`/`expandVcodeTableKey`; computes the shared-ID set; exports
   `KNOWN_VCODE_PARITY_DIVERGENCES: {code, reason}[]` seeded with exactly `V-ADA-05` and
   `V-DOC-GOV-01` (per Design Decisions § D1 — no other code needs suppression); emits
   `V-MPARITY-01` (WARN: any shared, non-allowlisted id whose blackhole action disagrees with
   `mapMercureSeverityToBlackholeAction(mercureSeverity)`) and `V-MPARITY-02` (WARN: snapshot
   `synced_at` older than `MERCURE_VCODE_SNAPSHOT_STALE_DAYS`). Add
   `MERCURE_VCODE_SNAPSHOT_STALE_DAYS = 90` to `scripts/lib/build/facts.ts`'s `§ facts` block. —
   **AC**: task 3's tests now pass (GREEN).

6. **Real initial sync.** Run
   `bun run scripts/lib/mercure-vcode-snapshot.ts --mercure-root /Users/morphism/Documents/git/mercure`
   (read-only against the local mercure clone — `fs.readFileSync` only, no git mutation, no write
   inside the mercure clone) to populate the real
   `documentation/audits/mercure-vcode-snapshot.json`. — **AC**: the file is valid JSON; its
   `codes` map length equals the live count of 3-column table rows across the 8 mercure files
   (re-derive at implement time via `parseMercureVcodeTable`, do not hand-copy a literal count —
   same discipline as `VCODE_TABLE_ROW_COUNT`, issue #769); `mercure_version` reads `"9.15.0"` or
   whatever the clone's live `plugin.json` states at implement time.

7. **Divergence-note edits (no row-count change).** In `blackhole-vcodes.md`: append a
   `V-ADA-05`-scoped parenthetical to the `V-ADA-05/06/07` row's Rule cell stating the mercure
   meaning collision (`AGENTS.md → CLAUDE.md` symlink integrity, HIGH) and citing ADR-021 D5 /
   ADR-024 D4 — explicitly scoped to `V-ADA-05` only, not `V-ADA-06/07`. Append a similar
   parenthetical to the `V-BRANCH-03` row's Rule cell stating mercure's `feature-branch.N`
   meaning collision, same citation. — **AC**: `parseVcodeTableRows(content).length` is IDENTICAL
   before and after this task (re-derive both counts live, do not hand-copy either number) —
   proves annotation, not redefinition (the plan's own invariance criterion); both edited rows
   still parse as exactly one row each (no accidental row split from an embedded `|` in the new
   prose — escape or avoid literal pipe characters in the added text).

8. **New rows for the new check.** Add two new `blackhole-vcodes.md` rows: `V-MPARITY-01` (WARN,
   citing `scripts/checks/vcode-parity.check.ts` as enforcement site) and `V-MPARITY-02` (WARN,
   same site). Update `VCODE_TABLE_ROW_COUNT` in `scripts/lib/build/facts.ts` to the live
   post-edit row count (re-derive via `parseVcodeTableRows` against the edited file — do not
   hand-copy a literal `114` → `116` pair, issue #769). — **AC**: `runChecks()` from
   `scripts/checks/ground-truth.check.ts` reports `V-GROUND-01: ok:true` against the edited file.

9. **Extend `prj-mercure-sync`.** Add one documented step to the skill's existing sweep procedure
   naming the new script invocation from task 6, to run on the same cadence as its existing
   parity-matrix sweep. — **AC**: `grep -q 'mercure-vcode-snapshot.ts'
   .claude/skills/prj-mercure-sync/SKILL.md` succeeds.

10. **Carry staged artifacts** per `implementer.md` § Carry Staged Artifacts (the durable plan
    body, its `documentation/INDEX.md` row, and the `ARCHITECTURE.md` Active Constraints bullet
    staged at Phase 2 — see manifest). — **AC**: all 3 staged manifest entries for this issue land
    in the PR; `V-AUTO-02` clean.

11. **Verify Integrity.** Run `bun test` and `bun run verify` in full. — **AC**: full suite green;
    `vcode-parity.check.ts`'s `runChecks()` reports both `V-MPARITY-01` and `V-MPARITY-02` as
    `ok:true` against the real, freshly-synced repo state (zero non-allowlisted mismatches; a
    same-day sync is never stale).

## Execution Strategy & Stop Conditions

- If task 3's `V-DOC-07`-shaped fixture case (mercure `LOW` vs blackhole `WARN`, empty allowlist)
  reports a finding, **stop** — the mapping function is wrong, not the fixture; do not add
  `V-DOC-07` to the allowlist to paper over it, per Design Decisions § D1.
- If the real sync (task 6) discovers a third genuine severity mismatch beyond `V-ADA-05` /
  `V-DOC-GOV-01` under the correct mapping, **halt** implementation of tasks 7-8 and report it —
  a third undocumented divergence is a new decision this plan did not evaluate, not something to
  silently allowlist.
- If parsing mercure's live files finds a 9th `v-codes-*.md` file or a differently-shaped table
  header not matching `| ID | Severity | Description |`, **abort** the sync task and report —
  the parser's shape assumption (verified stable for 4+ months per the analysis) has changed and
  needs re-verification before trusting its output.
- If task 7's row-count check finds the count changed, **revert** the divergence-note edit and
  re-apply as a pure text addition inside the existing cell — a changed count means a row was
  accidentally split or merged.
- If `bun run build` reports compiled-tree drift after any Touch-Path edit, **halt** and report
  rather than hand-editing a dist tree.

## Sprint Contract

Per-task ACs above are binding. For any task without a narrower AC, done means `bun run verify`
green and the full test suite passing.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS (new JSON snapshot schema fully specified above; no DB/public API change) |
| `ac_mapping` | PASS — every Task Breakdown item carries `— **AC**:` |
| `critical_files_exist` | PASS — all 3 Critical Files exist on `plan_base_commit` |
| `mitigation_concrete` | PASS — no vague-mitigation vocabulary used; every stop condition is an explicit if/then abort-halt-stop-revert |
| `ac_sweep_conflict` | PASS |
| `ac_sweep_scope` | PASS |
| `touch_paths_ssot_gap` | PASS — `scripts/lib/build/facts.ts` declared alongside `blackhole-vcodes.md` |
| `ac_facts_literal_bump` | PASS — both `facts.ts` updates specified as live re-derivation, not a frozen literal pair |
