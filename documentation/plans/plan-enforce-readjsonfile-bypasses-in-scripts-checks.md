---
type: plan
summary: "Implementation plan for issue #867 — migrate all 16 bare JSON.parse(fs.readFileSync(...)) call sites across scripts/ onto the shared readJsonFile helper (V-INT-02), classified by severity (campaign-state vs. static-manifest readers), and add a scripts/checks/read-json-file.check.ts drift-prevention check (V-JSONREAD-01) so the bypass class cannot silently recur"
status: current
review_trigger: "on a new bare JSON.parse(fs.readFileSync(...)) call site added under scripts/, or on scripts/lib/fs.ts's readJsonFile contract changing"
created: 2026-09-06
last_updated: 2026-09-06
---


# Plan - Issue #867

## Objective

Issue #867 was scoped down during routing (issue comment, 2026-09) to **leg 1 only**: close every
bare `JSON.parse(fs.readFileSync(...))` call site across `scripts/**` that bypasses
`scripts/lib/fs.ts`'s declared shared helper `readJsonFile` (V-INT-02). Legs 2 (`#902`, shared
argv parser) and 3 (`#903`, `findAdrFileByNumber`/`carry-staged-artifacts.ts` duplication —
merged as PR #906) are out of scope for this plan.

Re-verified against `origin/main@2c05b869` (not the main clone's stale working tree, which was
4+ commits behind): the live count is **13 files / 16 call sites**, confirmed by direct grep —
matching the issue comment's corrected count exactly, not the original issue body's "nine."

## Touch-Paths

- `scripts/checks/claude-native-settings.check.ts` (line 32)
- `scripts/checks/codex-build.check.ts` (lines 35, 49)
- `scripts/checks/config-registration.check.ts` (line 74)
- `scripts/checks/deferred-reconciliation.check.ts` (lines 65, 66)
- `scripts/checks/hooks.check.ts` (line 44)
- `scripts/checks/ledger-schema.check.ts` (line 71)
- `scripts/checks/playbook.check.ts` (line 86)
- `scripts/checks/queue-coherence.check.ts` (line 101)
- `scripts/checks/reformulation-surface.check.ts` (line 38)
- `scripts/lib/hook-event-triage.ts` (line 144)
- `scripts/lib/test-fixtures.ts` (line 278)
- `scripts/stack-repair.ts` (line 169)
- `scripts/triage-deferred-findings.ts` (lines 182, 183)
- `scripts/checks/read-json-file.check.ts` (new file — drift-prevention check)
- `scripts/verify.read-json-file.test.ts` (new file — check's own test)

## [docs_governance.enabled] Documentation Impact

None — every Touch-Path is under `scripts/**`. No `documentation/`, `ARCHITECTURE.md`, or
`AGENTS.md` content is affected by this substitution; nothing in this diff changes a public
interface, config schema, or ADR-relevant decision. (Separately, this plan document itself is
durably staged into `documentation/plans/` per the planner's own ADR-021 D3 obligation — that is
this agent's artifact-staging step, not a Documentation Impact of the code change.)

## Critical Files

None — no database client, auth config, or other conventionally-sensitive touchpoint file is
touched. Every Touch-Path is a check or lib utility script under scripts/; none are pre-existing
sensitive touchpoints in the sense this section exists to flag.

## Codebase Conventions

| Concern | Convention | Evidence |
|---|---|---|
| Labeled JSON read | `readJsonFile(filePath, label)` from `scripts/lib/fs.ts:53` — parses and, on failure (ENOENT or malformed JSON), rethrows `Error(\`${label}: ${message}\`)` instead of a bare `SyntaxError`/`ENOENT` | `scripts/lib/fs.ts:53-59`; existing correct call sites: `scripts/lib/campaign-status/state.ts:13,18,19`, `scripts/lib/carry-staged-artifacts.ts:60`, `scripts/lib/companion-file-sync.ts:88`, `scripts/lib/hook-event-triage.ts:231,233`, `scripts/lib/state-write-guard.ts:49,63` |
| Label value | Every existing correct call site passes the **same string** for both `filePath` and `label` (e.g. `readJsonFile(configPath, configPath)`, `readJsonFile(queuePath, queuePath)`) — the label is the path itself, not a human-readable description | `scripts/lib/campaign-status/state.ts:13`, `scripts/lib/state-write-guard.ts:49` |
| Import path | Same-directory `lib/*.ts` files import via `./fs.ts`; `scripts/checks/*.check.ts` files import via `../lib/fs.ts`; top-level `scripts/*.ts` entrypoints import via `./lib/fs.ts` | `scripts/lib/hook-event-triage.ts:3`, `scripts/lib/state-write-guard.ts:2` |
| Drift-prevention check shape | A recurring bypass class gets its own `scripts/checks/<name>.check.ts` pure-function-plus-`CheckResult` module, glob-discovered by `scripts/verify.ts`, paired with `scripts/verify.<name>.test.ts` — never a one-off manual fix with no guard against recurrence | `scripts/checks/jq-empty-guard.check.ts` (closes the same class of drift for `jq empty`, cited by the issue's own Rationale) |
| Scanning `scripts/**/*.ts` excluding tests | `walkFilesAbs(scriptsDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))` — the established pattern for a check that must ignore test fixtures containing the flagged pattern for their own coverage | `scripts/checks/vocabulary.check.ts:128-131` (`scanScriptsTs`) |
| Read-only detection helper | `evaluateXxx`/`findXxx` pure functions exported separately from the `CheckResult`-returning entrypoint, so tests exercise the pure function against synthetic input without touching the live repo tree | `scripts/checks/jq-empty-guard.check.ts`'s `findBareJqEmptyPrescriptions`; `scripts/checks/queue-coherence.check.ts`'s exported `checkQueueCoherence` |

## Severity classification (re-derived from live code, not the issue's or router's framing)

The failure scenario in the issue ("a truncated `.blackhole/*` state file silently misreads on a
future `readJsonFile` hardening pass, but a bypass site doesn't get that hardening for free")
only bites readers of **mutable, machine-written `.blackhole/*` campaign state** — `queue.json`,
`findings-ledger.json`, `config.json`. It does not bite readers of a static, human/build-authored
manifest or fixture file. Classifying all 16 sites against live code (not just the four the router
flagged) surfaces one correction to the issue's own framing: `hooks.check.ts:44` was one of the
original "nine" campaign-state sites in the issue body, but it actually reads
`<bundleRoot>/hooks/hooks.json` — a **compiled build-output manifest**, the same tier as
`codex-build.check.ts` and `claude-native-settings.check.ts`, not campaign state.

**HIGH — mutable `.blackhole/*` campaign-state readers (9 sites / 7 files):**
- `config-registration.check.ts:74` — `.blackhole/config.json`
- `deferred-reconciliation.check.ts:65` — `.blackhole/findings-ledger.json`
- `deferred-reconciliation.check.ts:66` — `.blackhole/queue.json`
- `ledger-schema.check.ts:71` — `.blackhole/findings-ledger.json`
- `playbook.check.ts:86` — `.blackhole/queue.json`
- `queue-coherence.check.ts:101` — `.blackhole/queue.json`
- `stack-repair.ts:169` — `.blackhole/queue.json`
- `triage-deferred-findings.ts:182` — `.blackhole/findings-ledger.json`
- `triage-deferred-findings.ts:183` — `.blackhole/queue.json`

**MEDIUM — mutable `.blackhole/*` state, but already fail-safe (1 site / 1 file):**
- `hook-event-triage.ts:144` — reads one `.blackhole/hook-events/<file>.json` at a time, already
  wrapped in `try { ... } catch { continue; }` that deliberately skips a malformed single event
  file rather than aborting the whole ingest batch. This file's **other** two reads (queue,
  ledger — lines 231/233) already went through `readJsonFile`, fixed by PR #908's rewrite; only
  this one per-event read remains a bypass. Migrating it is still safe (see Task 4) but the
  helper's error-context value is smaller here since the caller discards the error either way.

**LOW — static build manifests / test fixtures, not mutable campaign state (6 sites / 5 files):**
- `claude-native-settings.check.ts:32` — `.claude/settings.json` (build target)
- `codex-build.check.ts:35` — `.codex-plugin/plugin.json` (build target)
- `codex-build.check.ts:49` — `codex-marketplace.json` (build target)
- `hooks.check.ts:44` — `<bundleRoot>/hooks/hooks.json` (build target — **reclassified out of
  the issue's original campaign-state bucket**, see above)
- `reformulation-surface.check.ts:38` — `fixtures/worker-json/planner-ready.json` (static repo
  fixture)
- `test-fixtures.ts:278` (`readHookEvents`) — used exclusively by `scripts/hooks-validate-bash.test.ts`
  and `scripts/hooks-validate-file.test.ts` (confirmed via repo-wide grep — zero non-test
  consumers); reads a *test-fixture* `.blackhole/hook-events/` tree under a `makeTempDir()`
  sandbox, never the live campaign's

All 16 sites are still real `V-INT-02` bypasses worth the same one-line fix in this PR — severity
only changes urgency, not scope.

## What `readJsonFile` actually provides (V-INT-02 justification)

`scripts/lib/fs.ts:53-59` wraps `JSON.parse(fs.readFileSync(filePath, 'utf-8'))` in a try/catch
that rethrows `Error(\`${label}: ${message}\`)`. Concretely, today it buys exactly one thing over
the bare pattern: **labeled error context** — a parse/read failure names which file failed
(`.blackhole/queue.json: Unexpected end of JSON input`) instead of a bare, path-less
`SyntaxError`/`ENOENT` that the caller has to trace back to a call site manually. It does **not**
currently special-case empty files or add a zero-byte guard — the issue's "readJsonFile gains the
zero-byte guard from #489" framing describes the value of centralizing *now*: a future hardening
of the one shared helper (e.g. a zero-byte short-circuit) reaches every migrated call site for
free, while a bypass site would need the same fix applied a second time, exactly the drift
`state-write-guard.ts`'s existing zero-byte guard on the *write* path was built to prevent
(`blackhole-state.md` § Write protocol). This justifies the migration on `V-INT-02` grounds even
though the immediate observable behavior change today is limited to error-message text.

No site is excluded from migration. The one site with a plausible "different failure mode"
argument — `hook-event-triage.ts:144`'s outer swallow-and-continue — still fits `readJsonFile`
cleanly: the existing `try { ... } catch { continue; }` already wraps the call, and `readJsonFile`
throwing an `Error` (as it always does on failure) is caught by that same `catch` exactly as the
bare `JSON.parse`'s `SyntaxError`/`ENOENT` was. Swapping the inner call changes nothing the outer
catch observes.

## Execution Strategy & Stop Conditions

- If any of the 13 files' own existing test suite fails after migration with a *new* failure
  (not present on the TDD-baseline run), halt and revert that file's change — re-check whether
  the failure asserts on an exact error message/type from the bare `JSON.parse` path (none were
  found in this plan's search of `verify.playbook.test.ts`, `verify.ledger-schema.test.ts`,
  `verify.queue-coherence.test.ts`, `verify.deferred-reconciliation.test.ts`,
  `verify.config-registration.test.ts`, `verify.hooks.test.ts`, `verify.claude-native-settings.test.ts`,
  `verify.codex-build.test.ts`, `stack-repair.test.ts`, `triage-deferred-findings.test.ts`,
  `lib/hook-event-triage.test.ts`, `lib/test-fixtures.test.ts`, `hooks-validate-bash.test.ts`,
  `hooks-validate-file.test.ts` — if one is found live at implement time that this plan's search
  missed, that is the abort trigger).
- If `scripts/checks/read-json-file.check.ts`, once written, does not fail (`ok: false`) against
  the live pre-migration tree citing at least the 16 sites enumerated in this plan, stop and
  re-derive the detection regex before touching any of the 13 files — a check that doesn't
  reproduce the known-bad state first is not proven to detect anything (`V-UNFALSIFIABLE-01`).
- If after migrating all 16 sites `scripts/checks/read-json-file.check.ts` still reports any
  violation, stop and re-grep `scripts/**/*.ts` for a missed bypass before declaring the task done
  — do not narrow the check's scope to make it pass.
- If `bun run verify` or `bun test` regresses a check unrelated to this plan's Touch-Paths, halt
  and report — do not touch a file outside the Touch-Paths list to silence it (`V-SCOPE-02`).

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run `bun test` and `bun run verify` on `origin/main@2c05b869`
  before any change. — **AC**: baseline pass/fail counts for both commands quoted verbatim in the
  completion evidence.
- [ ] **Write the drift-prevention check, red-before-green**: Author
  `scripts/checks/read-json-file.check.ts` exporting a pure detector (e.g.
  `findBareJsonParseBypasses`) matching `/JSON\.parse\(\s*(?:fs\.)?readFileSync\(/` against every
  `scripts/**/*.ts` file (via `walkFilesAbs`, same convention as `vocabulary.check.ts`'s
  `scanScriptsTs`), excluding `scripts/lib/fs.ts` itself (the SSOT definition) and any
  `*.test.ts` file, returning `V-JSONREAD-01` `CheckResult`. Pair it with
  `scripts/verify.read-json-file.test.ts` asserting: (a) a synthetic fixture string containing
  `JSON.parse(fs.readFileSync(...))` on a named line IS flagged at that line — the discriminating
  input a check with no detection logic at all would fail to flag; (b) an identical line inside a
  fixture path ending `.test.ts` is NOT flagged; (c) an identical line under the literal path
  `scripts/lib/fs.ts` is NOT flagged (proves the SSOT-file exemption, not just the test-file
  exemption); (d) running the exported detector against the **live** `scripts/**` tree at this
  point in the task sequence returns exactly the 16 sites enumerated in this plan's Severity
  classification section (the actual red state — before any of the 13 files are touched).
  — **AC**: `scripts/verify.read-json-file.test.ts` passes for cases (a)-(c); case (d)'s assertion
  against the live tree fails (red) until Tasks 3-5 land, and the task-sequence completion
  evidence quotes the 16-site list the live-tree run reported.
- [ ] **Migrate the 9 HIGH-severity campaign-state sites** (`config-registration.check.ts:74`,
  `deferred-reconciliation.check.ts:65,66`, `ledger-schema.check.ts:71`, `playbook.check.ts:86`,
  `queue-coherence.check.ts:101`, `stack-repair.ts:169`, `triage-deferred-findings.ts:182,183`):
  replace each bare `JSON.parse(fs.readFileSync(<path>, 'utf-8'))` with
  `readJsonFile(<path>, <path>) as <existing-cast-type>`, importing `readJsonFile` from the
  correct relative `fs.ts` path per this plan's Codebase Conventions table. Preserve every
  existing surrounding `try/catch` exactly as-is (e.g. `playbook.check.ts`'s catch-and-return
  `V-PLAN-01 invalid JSON` detail path) — this is a pure substitution, not a behavior change; no
  new test is written for these 9 sites beyond confirming their existing suites still pass. —
  **AC**: none of the 9 lines match `scripts/checks/read-json-file.check.ts`'s detector pattern
  post-change; `verify.config-registration.test.ts`, `verify.deferred-reconciliation.test.ts`,
  `verify.ledger-schema.test.ts`, `verify.playbook.test.ts`, `verify.queue-coherence.test.ts`,
  `stack-repair.test.ts`, and `triage-deferred-findings.test.ts` all pass unmodified.
- [ ] **Migrate the 1 MEDIUM-severity site** (`hook-event-triage.ts:144`): replace the bare parse
  inside the existing `try { event = JSON.parse(...); } catch { continue; }` with
  `readJsonFile(filePath, filePath) as HookEvent`, leaving the outer try/catch untouched — the
  swallow-and-continue-on-malformed-event semantics are unchanged, since `readJsonFile` always
  throws an `Error` on failure exactly where the bare parse would have thrown a
  `SyntaxError`/`ENOENT`, and the same `catch` intercepts either. — **AC**: line 144 no longer
  matches the detector pattern; `scripts/lib/hook-event-triage.test.ts` passes unmodified,
  including any case exercising a malformed `.blackhole/hook-events/*.json` fixture (that case
  must still show the malformed event skipped, not the whole ingest run aborted).
- [ ] **Migrate the 6 LOW-severity sites** (`claude-native-settings.check.ts:32`,
  `codex-build.check.ts:35,49`, `hooks.check.ts:44`, `reformulation-surface.check.ts:38`,
  `test-fixtures.ts:278`): same pure substitution as Task 3, importing `readJsonFile` per the
  Codebase Conventions table (note `hooks.check.ts:44` is inside a small local `readJson` wrapper
  function — replace that wrapper's body, not its call sites). — **AC**: none of the 6 lines match
  the detector pattern post-change; `verify.claude-native-settings.test.ts`,
  `verify.codex-build.test.ts`, `verify.hooks.test.ts`, and `scripts/lib/test-fixtures.test.ts`
  all pass unmodified; `scripts/hooks-validate-bash.test.ts` and `scripts/hooks-validate-file.test.ts`
  (the only consumers of `test-fixtures.ts`'s `readHookEvents`) pass unmodified.
- [ ] **Verify Integrity**: Run `bun test` and `bun run verify` in full. Additionally run the new
  check's live-tree assertion (Task 2's case (d) re-run) and confirm it now returns zero
  violations. — **AC**: full `bun test` suite green, `bun run verify` green including
  `V-JSONREAD-01: ok: true`, both quoted in the completion evidence; no file outside this plan's
  Touch-Paths modified.

## Sprint Contract

Every task above carries its own machine-verifiable AC; there is no task relying on the blanket
"all tests and linters pass" fallback. Definition of done for the issue as a whole: `bun test` and
`bun run verify` both green, `scripts/checks/read-json-file.check.ts` reports zero violations
against the live tree, and all 16 originally-enumerated bypass sites are confirmed absent by that
check's own detector rather than by manual line-count recount.

## Quality Gate Results

Ran `bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-867.md` →
`{"ac_mapping": true, "critical_files_exist": true, "mitigation_concrete": true}`.

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — no DB/API schema in scope |
| `ac_mapping` | PASS (CLI-verified) |
| `critical_files_exist` | PASS (CLI-verified) — section is prose-only, no unresolvable glob paths |
| `mitigation_concrete` | PASS (CLI-verified) |
| `ac_sweep_conflict` | PASS — no sweep-to-zero AC in this plan |
| `ac_sweep_scope` | PASS — n/a |
| `touch_paths_ssot_gap` | PASS |
| `ac_facts_literal_bump` | PASS — no `facts.ts` literal bumped |

## References

- **Issue**: #867 (scoped to leg 1 only per issue comment, 2026-09)
- **Related, out of scope**: #902 (leg 2, shared argv parser), #903 / PR #906 (leg 3, merged)
- **Precedent check**: `scripts/checks/jq-empty-guard.check.ts` / `scripts/verify.jq-empty-guard.test.ts`
  (issue #558) — same "pin the class, not the instance" shape for a different recurring bypass
- **Helper definition**: `scripts/lib/fs.ts:53` (`readJsonFile`)
- **Recent rewrite context**: PR #908 rewrote `scripts/lib/hook-event-triage.ts`'s queue/ledger
  reads onto `readJsonFile` already; this plan closes only its one remaining per-event bypass
- **V-codes**: `V-INT-02` (BLOCK, reviewer.md § Code Quality & Conventions — no reimplementing an
  existing utility); new internal check id `V-JSONREAD-01` (repo-hygiene tier, alongside
  `V-JQEMPTY-01`/`V-CODEX-01`/`V-QUEUE-01` — not part of the campaign-review `blackhole-vcodes.md`
  table, same tier as those precedents)
