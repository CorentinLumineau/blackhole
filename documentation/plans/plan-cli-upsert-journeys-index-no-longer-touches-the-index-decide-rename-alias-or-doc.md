---
type: plan
summary: "Implementation plan renaming the --upsert-journeys-index CLI flag to --backfill-journeys-summary to match its post-#832 behavior, with the full caller enumeration and rename-vs-alias-vs-leave decision (issue #955)"
status: current
review_trigger: "on file change"
created: 2026-09-07
last_updated: 2026-09-07
issue: 955
---


# Plan - Issue #955

## Objective

`--upsert-journeys-index` (`scripts/lib/companion-file-sync.ts`) no longer upserts an index row —
issue #832 (ADR-031 Phase 2) retired the hand-appended-row mechanism and retargeted the repair to
backfill a `summary:` frontmatter field on `journeys.md` directly (the root
`documentation/INDEX.md` row is now reproduced automatically at carry time from that field). The
internal functions were already renamed at that point (`repairJourneysIndexRow` →
`repairJourneysSummary`, `needsJourneysIndexRepair` → `needsJourneysSummaryRepair`); only the
CLI-facing flag string was left behind. #947 documented the mismatch inline
(`src/references/companion-file-sync.md`'s "CLI flag naming note") rather than fixing it, and
explicitly deferred the rename to this issue.

**Caller enumeration (issue AC1 — completed before any change, per `git grep -n
"upsert-journeys-index" -- '*.ts' '*.md'` scoped to `src/`, `scripts/`, `templates/`,
`documentation/`)**: the literal string `--upsert-journeys-index` (or `upsertJourneysIndex`)
appears in exactly five **live source** locations, plus its regenerated build-output mirrors and
two purely historical documentation artifacts that are not callers:

| File | Role | Action |
|---|---|---|
| `scripts/lib/companion-file-sync.ts` | Flag definition (`parseCliArgs`'s `flags['upsert-journeys-index']` lookup and its returned `upsertJourneysIndex` field), the `USAGE` string's second line, and the `import.meta.main` branch that reads it | Rename |
| `src/SKILL.md` (Phase 0 step 2) | Bootstrap-time invocation prose that shells out with the flag | Rename; regenerates 9 mirrors via `bun run build` |
| `templates/companion-files/README.md` | Prose reference describing when the row is upserted ("at bootstrap via `--upsert-journeys-index`") | Rename; regenerates its own mirrors via `bun run build` |
| `src/references/companion-file-sync.md` | The #947 "CLI flag naming note" documenting the mismatch, plus one cross-reference in the "Out of scope" list | Remove the now-stale mismatch note (issue AC3); update the cross-reference |
| `scripts/verify.cwd-pin-guard.test.ts` | Two fixture strings (lines 115, 121) asserting `V-CWDPIN-01` detection against a literal bootstrap-invocation shape | Rename (fixture text only — the check's own detection logic matches on the `companion-file-sync.ts` invocation shape, not the trailing flag, so no logic change) |

Not callers, left unmodified:
- `.claude/`, `.cursor/`, `codex-*/`, `skills/`, `plugins/*/`, `.agents/build/`, and the root
  `SKILL.md`/`references/companion-file-sync.md` copies — all regenerated build-output mirrors
  of the two `src/**`/`templates/**` sources above (`scripts/lib/build/targets.ts` is the SSOT for
  which trees each source compiles to); `bun run build` regenerates them, no hand-edit.
- `documentation/plans/plan-fix-scaffold-phase-0-journeys-md-companion-scaffold-creates-an-unindexed-doc-v-d.md`
  — the historical plan artifact for issue #728 (the flag's original introduction); a frozen
  record of what was planned at the time, not a live caller.
- `documentation/reference/decision-log.md` (row 232, issue #957) — the orchestrator-owned,
  append-only historical record of #947's decision to defer the rename to this issue. It remains
  accurate regardless of this issue's outcome ("filed follow-up issue #955 for the rename") and is
  never edited by a worker per its own header ("Written solely by the orchestrator").
- No caller outside this repository was found — `--upsert-journeys-index` is a bootstrap-only CLI
  flag invoked exclusively by `src/SKILL.md`'s own Phase 0 step, which ships in the same package
  version as `scripts/lib/companion-file-sync.ts` and is rebuilt/reinstalled together
  (`blackhole-protocol.md` § "Installed plugin cache refresh").

**Decision (issue AC2): rename outright**, to `--backfill-journeys-summary` (the issue's own
suggested name, chosen because it names what the code does — matches the already-renamed
`repairJourneysSummary`/`needsJourneysSummaryRepair` functions — not what the retired mechanism
used to do).

**Rationale — rename over alias or leave:**
- **Alias rejected**: an alias only earns its cost when a real external caller depends on the old
  name. The caller enumeration above found none — every invocation site lives inside this
  package and is rebuilt/reinstalled in lockstep with the flag's definition (same version, same
  `bun run build` pass, same plugin-cache refresh). Carrying two names for one behavior
  permanently (the issue's own words: "the alias tends to become permanent") for zero real
  compatibility need is exactly the `V-YAGNI-01`/`V-KISS-01` failure mode this repo's own quality
  gates flag — premature compatibility machinery with no measured consumer.
- **Leave-and-document rejected**: that is the status quo #947 already shipped (the "CLI flag
  naming note"). This issue exists specifically because #947 deferred the actual fix; re-choosing
  "leave" would close #955 with no change, which is not what the issue's acceptance criteria (a
  populated caller list *and* a stated, rationale-backed choice) call for on a `size:s` issue
  scoped precisely to make this call.
- **Rename accepted**: cleanest resolution, zero real breakage risk given the caller enumeration,
  and it removes a permanent papercut (issue title) plus a stale doc note (issue AC3) in one
  small, scoped PR — proportionate to `size:s`.

**Invariance (issue AC5)**: `repairJourneysSummary`/`needsJourneysSummaryRepair` themselves are
untouched — this plan renames only the CLI-facing flag string and the prose that names it. The
repair's behavior (what gets written to `journeys.md`, when) does not change.

## Touch-Paths

- `scripts/lib/companion-file-sync.ts`
- `scripts/companion-file-sync.test.ts`
- `scripts/verify.cwd-pin-guard.test.ts`
- `src/SKILL.md` — plus all generated dist trees per `scripts/lib/build/targets.ts`
- `src/references/companion-file-sync.md` — plus all generated dist trees per `scripts/lib/build/targets.ts`
- `templates/companion-files/README.md` — plus all generated dist trees per `scripts/lib/build/targets.ts`

## Documentation Impact (docs_governance.enabled: true)

The Touch-Paths above **are** the affected companion/consumer docs — this plan renames a CLI
flag named inside three prose surfaces (`src/SKILL.md`'s bootstrap step, `templates/companion-files/README.md`'s
scaffold contract, `src/references/companion-file-sync.md`'s implement-time reference) plus the
CLI definition itself. No new `documentation/` file is created (search-before-write does not
apply — all three prose files already exist and are updated in place), and no other companion
doc is affected:

- `ARCHITECTURE.md` / `DESIGN.md`: not applicable — no structural or visual-design change.
- `documentation/decisions/INDEX.md`: not applicable — no ADR is created or amended (this is a
  CLI-surface rename, not an architectural decision).
- `documentation/reference/decision-log.md`: not a Touch-Path — orchestrator-owned, append-only;
  see caller enumeration above for why its existing #957 row needs no edit.

## Task Breakdown

- [ ] **TDD Baseline Verification**: `bun test scripts/companion-file-sync.test.ts scripts/verify.cwd-pin-guard.test.ts`
  (scoped — never the full suite for a baseline read, per resource policy). — **AC**: both files'
  existing tests pass; pass count quoted in the completion evidence for later invariance
  comparison (Task 8).
- [ ] **Write Failing Tests**: add a CLI-level subprocess test to `scripts/companion-file-sync.test.ts`
  (same `Bun.spawn(['bun', 'run', scriptPath, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })`
  convention already used by `scripts/carry-staged-artifacts.test.ts`) asserting two things against
  a temp repo with a `journeys.md` missing `summary:`: (a) `--repo-root <tmp> --backfill-journeys-summary`
  performs the same backfill `repairJourneysSummary` already performs today (`repairs: [...]`
  with `vcode: 'V-ADA-09'` printed to stdout, and the file's frontmatter gains `summary:`); (b)
  `--repo-root <tmp> --upsert-journeys-index` (the old flag) now falls through to the `USAGE`/exit-2
  path (unrecognized flag) rather than performing the repair — proving the rename replaced the old
  name rather than merely adding the new one. — **AC**: `bun test scripts/companion-file-sync.test.ts`
  fails at exactly this new test (both current code paths do the opposite: old flag works, new
  flag doesn't), all pre-existing tests in the file still pass unmodified.
- [ ] **Rename the CLI flag** (`scripts/lib/companion-file-sync.ts`): change the flag literal
  `'upsert-journeys-index'` to `'backfill-journeys-summary'` in `parseCliArgs`'s `flags[...]`
  lookup and its returned field (`upsertJourneysIndex` → `backfillJourneysSummary`); update the
  `USAGE` constant's second line (`--upsert-journeys-index` → `--backfill-journeys-summary`);
  update the `if (import.meta.main)` destructure and the `if (upsertJourneysIndex)` branch
  variable to match. Do not touch `repairJourneysSummary`/`needsJourneysSummaryRepair` — already
  correctly named since #832. — **AC**: the failing test from the previous task now passes;
  `git grep -n "upsert-journeys-index\|upsertJourneysIndex" scripts/lib/companion-file-sync.ts`
  returns zero matches.
- [ ] **Update the bootstrap-scaffold invocation** (`src/SKILL.md` Phase 0 step 2): change the
  `bun run --cwd <path> scripts/lib/companion-file-sync.ts --repo-root <path> --upsert-journeys-index`
  line to `--backfill-journeys-summary`. — **AC**: `grep -n "backfill-journeys-summary" src/SKILL.md`
  matches; `grep -n "upsert-journeys-index" src/SKILL.md` returns no match.
- [ ] **Update the scaffold contract doc** (`templates/companion-files/README.md`): change "at
  bootstrap via `--upsert-journeys-index`" to "at bootstrap via `--backfill-journeys-summary`". —
  **AC**: `grep -n "backfill-journeys-summary" templates/companion-files/README.md` matches;
  `grep -n "upsert-journeys-index" templates/companion-files/README.md` returns no match.
- [ ] **Remove the stale mismatch note and update the CLI reference** (`src/references/companion-file-sync.md`):
  delete the `**CLI flag naming note**: ...` paragraph (issue AC3 — "the inline mismatch note
  added by #947 removed as now-stale") and replace the preceding sentence's cross-reference so the
  "Repair" paragraph states the CLI-reachable flag is `--backfill-journeys-summary`; update the
  "Out of scope" bullet's parenthetical (`reachable at bootstrap via the --upsert-journeys-index
  CLI flag, see naming note above`) to name the new flag and drop the now-deleted "naming note"
  cross-reference. — **AC**: `grep -n "CLI flag naming note\|upsert-journeys-index"
  src/references/companion-file-sync.md` returns zero matches; `grep -n "backfill-journeys-summary"
  src/references/companion-file-sync.md` matches at least twice (Repair paragraph + Out-of-scope
  bullet).
- [ ] **Update the cwd-pin-guard test fixtures** (`scripts/verify.cwd-pin-guard.test.ts`): change
  the two literal fixture strings at lines 115 and 121 from `--upsert-journeys-index` to
  `--backfill-journeys-summary` (text only — `cwd-pin-guard.check.ts`'s detection matches the
  `companion-file-sync.ts` invocation shape, not the trailing flag, so its logic is unaffected). —
  **AC**: `bun test scripts/verify.cwd-pin-guard.test.ts` passes; `grep -n "upsert-journeys-index"
  scripts/verify.cwd-pin-guard.test.ts` returns no match.
- [ ] **Rebuild dist trees**: `free -m` MemAvailable ≥ 2000MB check, then
  `flock /tmp/blackhole-verify.lock -c 'bun run build'` (regenerates `.claude/`, `.cursor/`,
  `codex-*/`, `skills/`, `plugins/*/`, `.agents/build/`, and the root `SKILL.md`/`references/`
  mirrors from the edited `src/SKILL.md` and `src/references/companion-file-sync.md`). —
  **AC**: exits 0; diff includes the edited `src/` sources plus their regenerated mirrors, with
  zero remaining `upsert-journeys-index` occurrences in any generated tree.
- [ ] **Repo-wide zero-residual sweep** (scope: `src/`, `scripts/`, `templates/`, all generated
  dist trees under `scripts/lib/build/targets.ts` — everything except the two exempted historical
  documents named in the Objective's caller enumeration,
  `documentation/plans/plan-fix-scaffold-phase-0-journeys-md-companion-scaffold-creates-an-unindexed-doc-v-d.md`
  and `documentation/reference/decision-log.md`, which are frozen/append-only records and are
  never edited by this plan): `git grep -n "upsert-journeys-index"` scoped to the paths above. —
  **AC**: command output is empty (zero matches).
- [ ] **Verify Integrity + Invariance (issue AC5)**: `free -m` MemAvailable ≥ 2000MB check, then
  `flock /tmp/blackhole-verify.lock -c 'bun run verify'`. — **AC**: exits 0; the pass/fail count
  it reports is identical to the Task 1 baseline (same total, same pass count) — proving the
  repair behavior itself is unchanged and only the CLI surface was renamed, per the issue's
  Invariance acceptance criterion.

## Sprint Contract

- Every caller of `--upsert-journeys-index` is enumerated in the Objective's table before any
  change lands (issue AC1) — satisfied by the caller-enumeration table above, produced from a
  `git grep` pass across `src/`, `scripts/`, `templates/`, `documentation/` before this plan's
  first edit task.
- The chosen option (rename) is stated with its rationale (issue AC2) — satisfied by the
  Objective's "Decision" and "Rationale" subsections.
- All callers updated in the same PR, mirrors regenerated via `bun run build` (never hand-edited),
  and the #947 inline mismatch note removed as now-stale (issue AC3) — satisfied by Tasks 3-6 and
  8's individual ACs.
- Invariance: repair behavior unchanged, `scripts/verify.*` pass counts identical before/after
  (issue AC5) — satisfied by Task 10's AC, compared against Task 1's baseline.
- Tasks with no narrower AC default to: full test suite green, `bun run verify` clean — already
  the explicit AC on Tasks 1 and 10.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |

## Sweep scope note

The "Repo-wide zero-residual sweep" task above is this plan's one sweep/grep-to-zero AC. Scope
path: `src/`, `scripts/`, `templates/`, and every generated dist tree named in
`scripts/lib/build/targets.ts`. Exemption clause: exactly two paths are exempted —
`documentation/plans/plan-fix-scaffold-phase-0-journeys-md-companion-scaffold-creates-an-unindexed-doc-v-d.md`
(frozen historical plan artifact for issue #728) and `documentation/reference/decision-log.md`
(orchestrator-owned, append-only, row 232 stays historically accurate regardless of this issue's
outcome) — both named explicitly in the Objective's caller enumeration, neither is a live caller.
