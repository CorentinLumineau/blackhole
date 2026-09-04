---
type: plan
summary: "Constrains carry-staged-artifacts.ts's target_path to an allowlist (documentation/**, root ARCHITECTURE.md) and converts write-step failures to per-entry skips, closing the arbitrary-code-execution vector in issue #784"
status: current
review_trigger: "on file change"
created: 2026-09-03
last_updated: 2026-09-03
---

# Plan - Issue #784

## Objective

`carryManifest` (`scripts/lib/carry-staged-artifacts.ts`) bounds a manifest entry's
`target_path` only to `repoRoot` (PR #783 / issue #752's containment fix). It does not
constrain *where inside* `repoRoot` an entry may write. `package.json`, `.github/workflows/*.yml`,
and (under a clone-shaped `repoRoot`) `.git/hooks/pre-commit` all pass containment and reach an
unconditional `writeFileSync`, and each is executed by the campaign or CI immediately after the
carry step — arbitrary code execution from attacker-influenced manifest content (issue #784 AC1).
A secondary defect compounds this: the `ENOTDIR` case (worktree-shaped `.git`) throws uncaught,
aborting the *entire* carry rather than skipping the one offending entry — contradicting the
skip-not-throw failure mode PR #783 established for adversarial entry content (AC2/AC3).

Fix: constrain `target_path` to an explicit allowlist (`documentation/**` + root-level
`ARCHITECTURE.md` — the only two target families any route in `artifact-contract.md`'s
route→artifact table ever declares), and make every filesystem write during the carry
skip-on-failure instead of throw-on-failure, so one bad or unlucky entry never denies the rest
of the manifest.

## Touch-Paths

- `scripts/lib/carry-target-allowlist.ts` (new file — the allowlist primitive)
- `scripts/lib/carry-staged-artifacts.ts` (wire the allowlist check + catch write-step FS errors)
- `scripts/lib/carry-staged-artifacts.test.ts` (regression + characterization tests; one existing
  assertion flip — see Codebase Conventions row 3 and Task Breakdown item 5)
- `src/agents/implementer.md` plus all generated dist trees per `scripts/lib/build/targets.ts`
  (one-line doc update to § Carry Staged Artifacts' "What the script dispatches" bullet)

## Documentation Impact

`src/agents/implementer.md` § Carry Staged Artifacts already documents "What the script
dispatches" in prose; it does not currently mention that `target_path` is constrained to an
allowlist. Extend that existing bullet with one clause naming the allowlist and the
skip-with-reason behavior — do not add a new subsection (V-DRY-01: one sentence, one place).
`blackhole-state.md` § Staging is unaffected — the allowlist is a script-internal invariant
derived from `artifact-contract.md`'s route table, not a manifest *field* or schema change, so
the manifest field table needs no edit. No new V-code: the issue's own triage names `V-SEC-01`
(injection) as the correct code, already defined in `blackhole-vcodes.md` with `reviewer.md` §4
as its primary (review-time) enforcement site; this plan adds carry-time *prevention*, which
doesn't need its own V-code row (reuse, not a new enumeration — V-KISS-01).

## Critical Files

None beyond the Touch-Paths list above — the sensitive touchpoint this issue is about
(`scripts/lib/carry-staged-artifacts.ts`) is already declared as a Touch-Path being modified,
not a pre-existing file consulted only for context.

## Codebase Conventions

| Convention | Existing pattern | Where |
|---|---|---|
| Legal carry targets are exactly two families | `artifact-contract.md`'s route→artifact table: every route (`analyze`, `brainstorm`, `design`, `investigate`, `plan`, `review`, `runbook`) writes under `documentation/**`; the sole exception is the `ARCHITECTURE.md` `## Active Constraints` append documented in that file's "Cross-cutting side artifact" paragraph. No route ever declares a third family — the allowlist in this plan is exhaustive against current usage, not a guess. | `.claude/skills/blackhole/references/artifact-contract.md` |
| Named glob-array constant + boolean predicate, no glob library | `OPS_TOUCH_PATH_GLOBS` + `touchPathsHitOpsSurface()` in `scripts/lib/ops-touch-paths.ts` — a small literal array plus a hand-written predicate, no `minimatch`/`micromatch` dependency anywhere in `scripts/`. `carry-target-allowlist.ts` follows this identical shape (`V-INT-01`). | `scripts/lib/ops-touch-paths.ts` |
| Entry-scoped violation → `skipped[]` + `continue`, never throw | The two `isWithinRoot` containment checks added by PR #783 (`carry-staged-artifacts.ts:264-277`) push `{ index, reason }` and `continue` the loop on a violation; the manifest-shape guard (`readJsonFile`) and the "declared `staged_path` absent" case remain the only two throw sites, both signaling a broken *invocation*, not adversarial entry content. AC2/AC3 extend the identical pattern to the new allowlist check and to write-step FS errors — same discriminator (entry-scoped vs. invocation-scoped), not a new failure taxonomy. | `scripts/lib/carry-staged-artifacts.ts` (current `carryManifest`) |
| V-INT-02 reuse check | `grep -rln "allowlist\|ALLOWLIST" scripts/` before writing a new primitive found five hits: `route-shape.check.ts` (parses a `// omits:` comment, unrelated), `vcode-citation.check.ts` and `agents.check.ts` (tool-policy prose, unrelated), `forge-adapter-routing.check.ts`'s `CLI_ALLOWLIST` (a `Record<CliName, string>` keyed lookup for forge CLI names — different shape and domain), `links.check.ts` (a prose comment, no export). None is a reusable path-target allowlist; `carry-target-allowlist.ts` is new, not a reimplementation. | (search performed at plan time, not a file reference) |
| Doc update site | `implementer.md` § Carry Staged Artifacts, "What the script dispatches" bullet — the single place the carry script's dispatch behavior is described in prose; extend it rather than adding a second description elsewhere. | `src/agents/implementer.md:423-432` |

## Database/API Schema Changes

N/A — no database schema and no public API surface changes. The `ManifestEntry`/`Manifest`
TypeScript types (`scripts/lib/carry-staged-artifacts.ts`) are unchanged; this plan adds an
internal check inside `carryManifest`, not a new field or a signature change.

## Threat Model

Trigger: `route.security_review_required: true`.

| Threat (STRIDE) | Description | Severity | Mitigation Status |
|---|---|---|---|
| Spoofing | Manifest producer identity (`planner`/`investigator`) is not spoofed by this change — the existing trust boundary (untrusted forge issue body → trusted producer → manifest) is unchanged; this plan narrows what a trusted-but-content-untrusted producer may target, not who may produce. | Low | Accepted Risk (unchanged from #752's baseline) |
| Tampering | A manifest entry's `target_path` can currently name any in-repo file (`package.json`, `.github/workflows/*.yml`, `.git/hooks/*`), letting attacker-influenced issue content tamper with files the campaign or CI trusts implicitly. | High | Mitigated (AC1 — allowlist restricts writes to `documentation/**` + root `ARCHITECTURE.md`) |
| Repudiation | A skipped entry must be attributable after the fact — the existing `{ index, reason }` shape already logs a distinguishing reason to stderr (CLI wrapper) and is loggable as `new_findings[]` per `implementer.md` § Carry Staged Artifacts; this plan's new skip reasons follow the identical, already-audited shape. | Low | Mitigated (existing mechanism, reused) |
| Information Disclosure | The carry step does not echo staged content back to an untrusted party; skip reasons name only `target_path`/`staged_path` strings already present in the manifest, disclosing nothing beyond what the manifest itself already states. | Low | Accepted Risk |
| Denial of Service | Today, one entry that resolves to an `ENOTDIR` write path (Vector 3, worktree-shaped `.git`) throws uncaught and aborts the *entire* carry, denying every other legitimate staged artifact for that issue — a real, if narrow, availability failure of the doc-promotion pipeline. | Medium | Mitigated (AC3 — write-step FS errors caught and converted to a per-entry skip) |
| Elevation of Privilege | The crux of issue #784: an attacker-influenced manifest entry targeting `package.json` or `.github/workflows/*.yml` achieves arbitrary code execution in the normal flow — `implementer.md` runs `bun test`/`bun run verify` immediately after the carry step (no CI, no commit, no reviewer required for the `package.json` vector), and CI executes workflow files on push (before any review gate settles). | Critical | Mitigated (AC1 + AC4 regression tests close all three empirically-verified vectors) |

## Execution Strategy & Stop Conditions

- If any existing test in `scripts/lib/carry-staged-artifacts.test.ts` fails after wiring the
  allowlist check, other than the one intentionally-flipped `/etc/passwd` assertion (Task
  Breakdown item 5), halt and investigate before touching the allowlist definition — do not widen
  `CARRY_TARGET_ALLOWLIST` to force a pass; a widened allowlist that isn't `documentation/**` or
  `ARCHITECTURE.md` reopens the vulnerability this plan closes.
- If the write-step try/catch swallows an error class that is not a filesystem write failure
  (e.g. a `TypeError` from a logic bug elsewhere in the branch), stop and narrow the catch to
  `NodeJS.ErrnoException` (checked via `'code' in error`) rather than a bare `catch {}` — a
  blanket catch that also hides programming errors is worse than the throw it replaces.
- If a legitimate route in `artifact-contract.md`'s route→artifact table needs a `target_path`
  outside `documentation/**`/`ARCHITECTURE.md` (none does today per the Codebase Conventions
  search above), stop and re-open this plan's Design Decision rather than silently adding a
  third allowlist entry without updating this plan and its Threat Model row.
- Before any test invocation: verify `free -m` MemAvailable ≥ 3500 MB and
  `cut -d' ' -f1 /proc/loadavg` ÷ `nproc` < 1.0 (resource-frugal-testing gate); below either
  threshold, wait in a background sleep loop rather than running. Route every test invocation
  through `with-test-lock`; the global lock is contended this session — expect to wait, and
  prefer scoped runs (`bun test scripts/lib/carry-staged-artifacts.test.ts`) while iterating,
  reserving the full `bun run verify` for the final pre-PR pass.

## Task Breakdown

- [ ] **TDD Baseline Verification**: Run `bun test scripts/lib/carry-staged-artifacts.test.ts`
  (through `with-test-lock`, resource gates permitting) to confirm all existing tests pass before
  any edit. — **AC**: baseline run reports 0 failures; pass/fail counts quoted in the completion
  evidence.
- [ ] **Write Failing Tests — allowlist regression (AC4)**: In
  `scripts/lib/carry-staged-artifacts.test.ts`, add three tests inside (or alongside) the
  existing `describe('carryManifest — path containment (issue #752)', ...)` block, each written
  to fail against current `main` and pass after the fix:
  1. `target_path: 'package.json'`, `target_kind: 'new_file'` — asserts the entry lands in
     `skippedEntries` (reason mentions `package.json` and "allowlist") and
     `fs.existsSync(path.join(repoRoot, 'package.json'))` is `false` (or the pre-existing fixture
     content, unmodified, if a `package.json` fixture is written first).
  2. `target_path: '.github/workflows/verify.yml'`, `target_kind: 'new_file'` — same shape,
     asserting skip + no write.
  3. `target_path: '.git/hooks/pre-commit'`, `target_kind: 'new_file'`, under a **clone**-shaped
     `repoRoot` — extend the existing `withRoots` helper's fixture with one added line,
     `fs.mkdirSync(path.join(repoRoot, '.git'))`, making `.git` a real directory (not the
     worktree's `.git` file) so the write path would have been reachable pre-fix. Asserts skip +
     no write under this shape specifically (not the worktree shape, which the pre-fix code
     already accidentally blocked via `ENOTDIR`).
  — **AC**: all three tests exist, are placed to run against the pre-fix code first (temporarily
  verified failing, per TDD), and each asserts both a `skippedEntries` entry with a reason
  identifying the rejected `target_path` and that no file was written at that path.
- [ ] **Write Failing Tests — write-failure skip (AC3)**: Add one test that pre-creates
  `documentation` as a **plain file** (not a directory) under `repoRoot`, then submits a manifest
  with two entries — one `target_path: 'documentation/x.md'` (which will hit `ENOTDIR` on
  `mkdirSync` since `documentation` is a file) and one `target_path: 'ARCHITECTURE.md'` (a
  distinct, unaffected append_row entry, using the existing ARCHITECTURE.md fixture pattern from
  the "root-level ARCHITECTURE.md append_row target" test). — **AC**: `carryManifest` does not
  throw; the first entry appears in `skippedEntries` with a reason naming the write failure; the
  second entry's `target_path` appears in `carriedPaths` — proving one bad entry no longer denies
  the rest of the manifest (closes the whole-carry-denial defect independent of the allowlist,
  since `documentation/x.md` is itself allowlisted).
- [ ] **Write Failing Tests — characterization (AC5)**: Confirm (do not newly write — the
  existing suite already covers this) that the pre-existing `documentation/plans/plan-x.md`
  `new_file` test and the "root-level ARCHITECTURE.md append_row target" `append_row` test both
  still pass unmodified after the fix — run them explicitly in the completion evidence as the
  over-tightness characterization guard AC5 requires. — **AC**: both named existing tests pass,
  quoted by name in the completion evidence (no new test file needed for this AC — reusing
  existing coverage satisfies it; adding a duplicate would violate `V-DRY-04`).
- [ ] **Implement `scripts/lib/carry-target-allowlist.ts`**: New file exporting
  `CARRY_TARGET_ALLOWLIST` (a two-entry literal array: `'documentation/**'`, `'ARCHITECTURE.md'`)
  and `isCarryTargetAllowed(targetPath: string): boolean`, modeled on `ops-touch-paths.ts`'s
  shape (backslash-normalize, then `=== 'ARCHITECTURE.md'` or `.startsWith('documentation/')`).
  — **AC**: exported function returns `true` for `'documentation/plans/plan-x.md'` and
  `'ARCHITECTURE.md'`, and `false` for `'package.json'`, `'.github/workflows/verify.yml'`,
  `'.git/hooks/pre-commit'`, `'scripts/foo.ts'`, `'src/agents/planner.md'`, and
  `'.claude/settings.json'` — covering every path named in issue #784 AC1's exclusion list.
- [ ] **Wire the allowlist check into `carryManifest`**: In `scripts/lib/carry-staged-artifacts.ts`,
  import `isCarryTargetAllowed` and insert a check immediately after the existing
  `isWithinRoot(targetAbs, repoRoot)` containment check (before the `fs.existsSync(stagedAbs)`
  fatal-throw check) — on failure, push `{ index, reason: `target_path "${entry.target_path}" is
  outside the carry allowlist (documentation/** or root ARCHITECTURE.md)` }` and `continue`,
  matching the existing containment-check shape exactly (same object literal shape, same
  `continue`). — **AC**: the three AC4 regression tests and the pre-existing containment tests
  all pass; `grep -c isWithinRoot scripts/lib/carry-staged-artifacts.ts` unchanged (no existing
  check removed, only one added).
- [ ] **Wrap write-step filesystem calls in try/catch (AC2 + AC3)**: Wrap the `fs.mkdirSync` +
  `fs.writeFileSync` pair in both the `new_file` branch and the `append_row` branch (the two
  write sites at the end of the `for` loop) in a `try { ... } catch (error) { ... }` that pushes
  `{ index, reason: `write failed for target_path "${entry.target_path}": ${message}` }` (message
  extracted the same way the existing `loadManifest`/CLI error-message pattern already does:
  `error instanceof Error ? error.message : String(error)`) instead of letting the error
  propagate, then `continue`s the loop — never a bare `catch {}`. The existing "declared
  `staged_path` absent" fatal throw (lines 279-286 in the current file) stays **outside** this
  try/catch and keeps throwing — it signals a broken invocation, not adversarial entry content,
  per the Codebase Conventions discriminator above. — **AC**: the AC3 write-failure test passes;
  the existing "declared `staged_path` absent under `--staging-root`" test (asserting a thrown
  `Error`) still passes unchanged, proving the two failure classes stayed distinct.
- [ ] **Flip the `/etc/passwd` containment test's assertion**: The existing test "an
  absolute-looking `target_path` stays contained under `repoRoot` and carries" currently asserts
  `carriedPaths` includes `'/etc/passwd'`. Its own comment ("Regression guard... this input never
  escapes and must keep carrying. Do not flip this assertion to a skip.") predates this plan's
  allowlist and is now superseded by it: `/etc/passwd` is contained (still true, `path.join`
  behavior unchanged) but is **not** on `CARRY_TARGET_ALLOWLIST` (it is neither `documentation/**`
  nor `ARCHITECTURE.md`), so post-fix it must be skipped, not carried. Update the test to assert
  `skippedEntries` contains a reason naming `allowlist`, `carriedPaths` is empty, and
  `fs.existsSync(path.join(repoRoot, 'etc', 'passwd'))` is `false`; update the comment to record
  that AC1's allowlist (issue #784) now supersedes the pure-containment guard this test
  originally encoded — containment alone was never sufficient, which is the whole premise of
  issue #784. — **AC**: the updated test passes; `git diff` on this test shows only the
  assertion + comment changed, no fixture/setup lines touched.
- [ ] **Verify Integrity**: Run `bun test scripts/lib/carry-staged-artifacts.test.ts` (scoped)
  through `with-test-lock`, then the project lint command, then (once, for the final pass only)
  `bun run verify`. — **AC**: scoped suite green (new + existing test count and pass count both
  quoted), lint clean, `bun run verify` clean, all three quoted in the completion evidence.
- [ ] **Doc update**: Extend `src/agents/implementer.md` § Carry Staged Artifacts' "What the
  script dispatches" bullet (currently at `src/agents/implementer.md:423-432`) with one clause:
  the script constrains `target_path` to `documentation/**` and root `ARCHITECTURE.md`, skipping
  (never throwing) any entry outside that allowlist or whose write fails. Rebuild all generated
  dist trees per `scripts/lib/build/targets.ts` (`bun run build`) and commit source + regenerated
  output together, per `phase-implement.md` § Quality gate (pre-PR) build → commit → verify
  ordering. — **AC**: `implementer.md`'s prose names the allowlist; `git diff --stat` shows the
  matching generated dist paths changed alongside the source; `bun run verify` (already run in
  the prior task) stays clean after the rebuild.

## Sprint Contract

Every task above carries its own machine-verifiable `**AC**`. No task in this plan falls back to
the blanket "all tests and linters pass" default — the narrowest AC gate is the `git diff`-scoped
assertion on the `/etc/passwd` test flip (task 6), and the widest is the full `bun run verify`
pass required by the Verify Integrity task.

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
