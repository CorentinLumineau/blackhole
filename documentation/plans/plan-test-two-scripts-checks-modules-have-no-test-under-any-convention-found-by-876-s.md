---
type: plan
summary: "Test-coverage plan for the two scripts/checks modules (forge-adapter-routing, reformulation-surface) shipped with no test under any existing convention (found by #876's detector on first dogfood)"
status: current
review_trigger: "on file change"
created: 2026-09-07
last_updated: 2026-09-07
---

# Plan — Issue #943: two `scripts/checks/*.check.ts` modules have no test under any convention

Depends on #876 (closed/merged) — its detector is what surfaced this gap on first dogfood.
Router: `plan_mode: quick`, `task_type: bugfix`, `security_review_required: false`, `ui: false` —
neither the Threat escalation check nor the UI Interpretation Gate fires; both frontmatter
stamps stay `null`.

## Objective

`scripts/checks/forge-adapter-routing.check.ts` (exports `findBareForgeCliSpawns`, id
`V-FORGE-01`) and `scripts/checks/reformulation-surface.check.ts` (exports
`checkReformulationSurface`, id `V-REFORM-01`) ship with no test under either convention this
repo uses (`scripts/verify.<name>.test.ts`, the majority form — 51+/54 modules — or a co-located
`<name>.check.test.ts`, `pareto-filing-gate.check.ts`'s minority form). Add one
`scripts/verify.<name>.test.ts` file per module, at the majority-convention path, exercising the
named exported symbol against both a passing and a deliberately-broken case (`V-UNFALSIFIABLE-01`
red-before-green; `V-TEST-05` real verdict-shape assertions, not just "doesn't throw";
`V-TEST-11` — a test that can't fail pins nothing).

**Invariance is the whole point of this issue**: `forge-adapter-routing.check.ts` and
`reformulation-surface.check.ts` are read-only in this plan. Touch-Paths below list only the two
new test files. If writing either test surfaces a genuine bug in the check it covers, that is a
separate issue, filed not fixed here (issue body, § Scope).

## Touch-Paths

- `scripts/verify.forge-adapter-routing.test.ts` (new)
- `scripts/verify.reformulation-surface.test.ts` (new)

**Narrowed from the router's suggested 4-path set** (which included the two `.check.ts` modules
themselves): the issue's own Scope section and Invariance AC explicitly forbid modifying the
check modules — `git diff --stat` must show only new test files. Widening back to include either
`.check.ts` file would violate the issue's stated AC, not satisfy it.

## Documentation Impact

`docs_governance.enabled: true`. **None** — this plan adds test coverage only; it changes no
public API, no config schema, no companion doc's subject matter (`ARCHITECTURE.md`, `DESIGN.md`,
`documentation/decisions/INDEX.md`), and touches no file under `documentation/`.

## Task Breakdown

- [ ] **TDD Baseline Verification**: run the project's test suite first (resource-frugal —
  `free -m` MemAvailable and `load1 ÷ nproc` both checked before starting; scope to the two new
  files plus a full-suite pass once at the end, never mid-loop) to confirm the current suite is
  green before adding anything. — **AC**: baseline `bun test` pass/fail counts quoted in the
  completion evidence.

- [ ] **Write `scripts/verify.forge-adapter-routing.test.ts`** exercising `findBareForgeCliSpawns`
  (imported alongside `runChecks` from `./checks/forge-adapter-routing.check.ts`; `makeTempDir`
  from `./lib/fs.ts` — the shared fixture kit `verify.build-input-dirs.test.ts` already uses for
  exactly this "pass real files on disk to a file-list-taking pure function" shape, V-INT-02).
  Six cases, each independently discriminating (together they are the red-before-green pair: a
  bug that always returns `[]` fails (a)-(c); a bug that always flags everything fails (d)-(f)):
  - (a) a temp file containing a bare `spawnSync('gh', ...)` call is flagged, result containing
    the string `(gh)`
  - (b) a temp file containing a bare `spawnSync('tea', ...)` call is flagged, containing `(tea)`
  - (c) a temp file containing a bare `spawnSync('glab', ...)` call is flagged, containing
    `(glab)`
  - (d) a temp file with no forge-CLI spawn at all returns `[]`
  - (e) a temp file calling a different CLI (`spawnSync('git', ...)`) is not flagged — proves the
    regex is CLI-name-specific, not a bare `spawnSync(` presence check
  - (f) the **real** allowlisted file `scripts/lib/forge-adapter/cli.ts` (its actual repo path,
    read via `path.join(root, 'scripts/lib/forge-adapter/cli.ts')`) is not flagged even though it
    contains a literal `spawnSync('gh', ...)` call — proves the production `CLI_ALLOWLIST`
    self-exemption against real content, not a synthetic stand-in
  Plus a `runChecks()` live-tree regression pin: exactly one result, `id === 'V-FORGE-01'`,
  `ok === true`, `detail` absent — same shape as `verify.cwd-pin-guard.test.ts`'s
  "runChecks live tree" describe block.
  Clean up every `makeTempDir` directory in a `finally` block (`fs.rmSync(dir, {recursive:true,
  force:true})`), matching `verify.build-input-dirs.test.ts`.
  — **AC**: `bun test scripts/verify.forge-adapter-routing.test.ts` — all cases (a)-(f) plus the
  `runChecks()` pin pass; re-running with any one of (a)-(c)'s expected substring changed to a
  wrong value, or (d)-(f)'s expectation flipped to non-empty/flagged, makes that specific test
  fail (demonstrated once during authoring, not left in the committed file) — this is the
  red-before-green evidence quoted in the completion note.

- [ ] **Write `scripts/verify.reformulation-surface.test.ts`** exercising
  `checkReformulationSurface` (imported alongside `runChecks` from
  `./checks/reformulation-surface.check.ts`). This function takes no parameters and reads four
  fixed real-repo paths directly (`src/references/worker-schemas.md`,
  `scripts/lib/worker-json/validators/planner.ts`, `src/references/phase-plan.md`,
  `fixtures/worker-json/planner-ready.json` via `fs.readFileSync`) — no exported pure
  sub-function exists to unit-test the comparison logic in isolation without touching real state
  (unlike `tree-registry.check.ts`/`config-registration.check.ts`, this module was not written
  with fs-reading factored out from parsing). Use `spyOn(fs, 'readFileSync')` — the mocking
  primitive `scripts/verify.runner.test.ts` already establishes in this codebase (`spyOn(process,
  'exit')`, `spyOn(console, 'log')`) — to intercept exactly one target path per test, transform
  its real content to a deliberately-broken variant, and delegate every other path to the real
  `fs.readFileSync` (captured via `fs.readFileSync.bind(fs)` before the spy is installed). Always
  `spy.mockRestore()` in a `finally` block so the mock never leaks into a later test.
  Five cases:
  - worker-schemas.md content with `reformulation.understood` replaced by a decoy string →
    `ok: false`, `detail` contains `worker-schemas.md: missing reformulation.understood`
  - planner.ts content with `validateReformulation` replaced by a decoy → `ok: false`, `detail`
    contains `planner.ts: missing validateReformulation wiring`
  - phase-plan.md content with `gh issue comment` replaced by a decoy → `ok: false`, `detail`
    contains `phase-plan.md: missing gh issue comment posting for reformulation`
  - the fixture JSON re-serialized with its `reformulation` key deleted → `ok: false`, `detail`
    contains `planner-ready.json: missing reformulation object`
  - the fixture JSON re-serialized with `reformulation.assumed` set to `''` → `ok: false`,
    `detail` contains `planner-ready.json: reformulation.assumed must be a non-empty string`
  Plus the live-tree pass-through case (no mock installed): `checkReformulationSurface()` returns
  `{ id: 'V-REFORM-01', ok: true }` with `detail` absent, and `runChecks()` returns exactly one
  result matching it — the "green" half of red-before-green, proving the five broken-input cases
  above are genuinely discriminating rather than always-false.
  — **AC**: `bun test scripts/verify.reformulation-surface.test.ts` — all 5 broken-input cases
  and the live-tree pass-through case pass; each broken-input case is the demonstrated red state
  (asserted `ok: false` for a real, spied verdict) paired against the same function's real-tree
  green state, without writing to any file on disk.

- [ ] **Invariance check**: confirm the two check modules are byte-identical to
  `plan_base_commit`. — **AC**: `git -C <repo-root> diff --stat a5a7d6f82db967b74bcc13312b7090e950f7fafc -- scripts/checks/forge-adapter-routing.check.ts scripts/checks/reformulation-surface.check.ts`
  produces no output.

- [ ] **Verify Integrity**: run the two new test files together, then the full suite once, then
  `bun run verify` — through the resource-frugal pre-flight gate (`free -m` MemAvailable check,
  `load1 ÷ nproc` check) before each heavy invocation, one test process tree at a time. — **AC**:
  `bun test scripts/verify.forge-adapter-routing.test.ts scripts/verify.reformulation-surface.test.ts`
  green; full `bun test` green (or any pre-existing unrelated failure cited by name, per
  `mercure-verification-evidence.md`); `bun run verify` reports all checks passed; all three
  outputs quoted in the completion evidence.

## Sprint Contract

Definition of done = every task's own `— **AC**:` condition above holds, plus: `git diff --stat`
against `plan_base_commit` shows only the two new test files (Invariance task); both new test
files pass in isolation and as part of the full suite; `bun run verify` clean. No task falls back
to a bare "all tests and linters pass" — every task's AC above is task-specific.

## References

- Issue #943 body — acceptance criteria and the 54-module dogfood table (verified against
  `origin/main`).
- Issue #876 (closed) — the detector whose first dogfood run surfaced this gap.
- `scripts/verify.build-input-dirs.test.ts` — `makeTempDir`/file-list-fixture convention
  (forge-adapter-routing test).
- `scripts/verify.cwd-pin-guard.test.ts` — "pure fixtures + `runChecks()` live-tree pin"
  two-part convention (both new tests).
- `scripts/verify.runner.test.ts` — established `spyOn`/`mockRestore` mocking convention
  (reformulation-surface test).
- `scripts/verify.config-registration.test.ts` — the majority `verify.<name>.test.ts` import
  shape (`describe`/`test`/`expect` from `bun:test`, functions imported from `./checks/<name>
  .check.ts`).
