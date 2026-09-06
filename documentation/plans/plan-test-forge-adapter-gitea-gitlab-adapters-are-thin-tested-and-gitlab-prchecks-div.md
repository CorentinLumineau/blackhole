---
type: plan
summary: "Implementation plan for issue #868 — extend value-pinning test coverage across the gitea/gitlab/github forge adapters and their CLI wrapper layers, and fix GitLabForgeAdapter.prChecks's V-SOLID-03 substitutability bug (a single synthetic 'pipeline' row instead of one ForgeCheck per real CI job)"
status: current
review_trigger: "on ADR-027 amendment or a new prChecks() caller"
created: 2026-09-06
last_updated: 2026-09-06
related:
  - documentation/decisions/ADR-027-forge-adapter-interface.md
---


# Plan - Issue #868

## Objective

Shore up test coverage on the three ADR-027 forge adapters (`gitea.ts`, `gitlab.ts`, `github.ts`)
and their CLI-wrapper layers (`tea-cli.ts`, `glab-cli.ts`, `cli.ts`, `forge-doctor.ts`), and fix
one real behavioral bug the coverage gap was hiding: `GitLabForgeAdapter.prChecks` violates the
`ForgeAdapter` interface's documented per-check contract (ADR-027 §"Forge Adapter Interface",
`prChecks(number): Promise<ForgeCheck[]>`) by collapsing an entire GitLab pipeline — however many
jobs it actually ran — into one synthetic `{ name: 'pipeline' }` row, where `gitea.ts` and
`github.ts` both return one `ForgeCheck` per real CI check/job (V-SOLID-03 substitutability).

Router notes on this issue (`.blackhole/queue.json` #868) already independently confirmed the
same divergence at `gitlab.ts:201-212` vs `gitea.ts:204-221` / `github.ts:218-224`, classified it
`task_type: refactor` (not `bugfix`), `security_review_required: false`, `ui: false`, and
explicitly declined to fold in rewiring `merge-gate.md` off its direct `gh pr checks` read — that
stays out of scope here as a separate, larger blast-radius change. Grep confirms `.prChecks(` has
**zero** current callers anywhere under `scripts/` outside `*.test.ts` — this fix restores
interface substitutability for whichever future caller adopts `prChecks()` across all three
backends, it does not change any live campaign behavior today.

**Coverage-reporting judgment (concern 3)**: the issue's "do not re-file" note about
`scripts/validate-worker-json.ts` / `scripts/lib/state-write-guard.ts` being exercised only
through a spawned **subprocess** (`templates/hooks/pretooluse/utils/*.js` follows the same
pattern) does **not** apply to the forge-adapter layer. `tea-cli.ts`, `glab-cli.ts`, `cli.ts`, and
`forge-doctor.ts` are not run in a child process invoking a separate file — they **are** the code
that calls `spawnSync('tea'|'glab'|'gh', args)` directly, in-process. `bun test --coverage`
already instruments them; the reason they read at 14%/14%/18%/0% today (measured this session,
close to the issue's 2026-09-05 snapshot) is that every existing adapter test mocks over the
*wrapper* functions (`runTeaJson`, `runGlabJson`, `runGhJson`, …) rather than ever calling them —
so the wrapper bodies themselves (argv construction, JSON parsing, error-throw-on-nonzero-exit,
ENOENT handling) never execute. A real instrumentation fix is available and cheap: spy one level
lower, on `child_process.spawnSync`, and call the wrapper exports directly. No blind-spot
annotation is needed for this layer; the reviewable signal stays the normal line-coverage
percentage (Tasks 6-9 below).

## Split recommendation: **no split — one PR**

All three concerns live in the same `scripts/lib/forge-adapter/` + `scripts/lib/forge-doctor.ts`
surface, and are not "unrelated" under `issue-splitting.md`'s split trigger table:

- The regression test for concern 2 (the `gitlab.prChecks` shape bug) **is** a coverage test —
  splitting it out would either ship an untested behavior change (the fix, alone) or a test-only
  PR asserting a shape the production code doesn't yet provide (confusing, and not how TDD red/
  green is normally reviewed as one unit).
- This is one domain (forge adapters), not "3+ top-level domains" (`size:m` + 3+ domains is the
  stated split trigger; this is `size:m` + 1 domain).
- The `gitlab.ts` production diff is small (one method body) and the blast radius is zero live
  callers (confirmed by grep above) — there is no risk-concentration reason to isolate it.
- Router already computed `needs_split: false` at routing time.

Track: **Standard** (multi-file: 1 production file + 3 existing test files edited + 4 new test
files; `plan_mode: full` from router). Not Quick — this is not a single-file bug with one test.

## Touch-Paths

- `scripts/lib/forge-adapter/gitlab.ts` (production fix, concern 2)
- `scripts/lib/forge-adapter/gitlab.test.ts` (existing, extend)
- `scripts/lib/forge-adapter/gitea.test.ts` (existing, extend)
- `scripts/lib/forge-adapter/github.test.ts` (existing, extend)
- `scripts/lib/forge-adapter/tea-cli.test.ts` (new)
- `scripts/lib/forge-adapter/glab-cli.test.ts` (new)
- `scripts/lib/forge-adapter/cli.test.ts` (new)
- `scripts/lib/forge-doctor.test.ts` (new)

No non-test file besides `gitlab.ts` is modified. No change to `scripts/lib/forge-adapter/types.ts`
(the `ForgeAdapter` contract is unchanged — `gitlab.ts` is brought into conformance with it, not
the other way around).

## Documentation Impact

None — `gitlab.ts`'s fix conforms an existing implementation to the interface ADR-027 already
documents (`documentation/decisions/ADR-027-forge-adapter-interface.md` line 167:
`prChecks(number: number): Promise<ForgeCheck[]>`); no interface change, no new consumer-facing
behavior, no doc to update. `docs_governance.enabled: true` / `write_governance: true` in
`.blackhole/config.json` are both true, so this section is populated rather than omitted, per
Step 7 — the justification above is the required content.

## Critical Files

Pre-existing sensitive touchpoints this plan does not modify but whose behavior constrains the
fix's design:

- `scripts/lib/forge-adapter/types.ts` — the `ForgeAdapter` interface's `prChecks` method returns
  `Promise<ForgeCheck[]>`; this is the contract the GitLab adapter must conform to. A change here
  would ripple across all three adapters and is explicitly out of scope.
- `scripts/checks/forge-adapter-routing.check.ts` — CI gate enforcing that forge CLI spawns live
  only in forge-adapter's per-backend CLI wrapper files (ADR-027). The GitLab adapter fix's two new
  API calls MUST go through the existing `runGlabJson` export in
  `scripts/lib/forge-adapter/glab-cli.ts` — never a direct `spawnSync('glab', ...)` inside the
  adapter file itself — or this check fails.

## Codebase Conventions

| Concern | Convention | Touchpoint |
|---|---|---|
| CLI spawn routing | All `tea`/`glab`/`gh` subprocess spawns live only in `*-cli.ts` / `cli.ts` under `forge-adapter/` (ADR-027) | `scripts/checks/forge-adapter-routing.check.ts` |
| `prChecks` return shape | One `ForgeCheck` per real CI check/job, never a synthesized aggregate row | `github.ts:normalizeCheck`+`prChecks`, `gitea.ts:prChecks` (rows.map) |
| No swallow-to-`[]` on CLI failure | `prChecks` must let a `run*Json` throw propagate uncaught — issue #864's fix, both existing adapters and the current `gitlab.ts` already do this; the new two-call `gitlab.ts` body must not wrap either call in try/catch | `gitea.ts`/`gitlab.ts` comment blocks above `prChecks` (both cite #864) |
| Adapter unit-test mocking granularity | Existing suites `spyOn` the `run*Json` *wrapper* export (module-level), not `child_process.spawnSync` | `gitea.test.ts`, `gitlab.test.ts`, `github.test.ts` |
| Value-pinning over existence checks | Tests assert concrete returned field values (name, state, headRefName, …), never bare `toBeDefined()`/shape-only checks | `github.test.ts` (`prView includes headRefOid...`, `prChecks normalizes check conclusions`) |
| GitLab CLI passthrough calls | `glab api <endpoint>` is the generic REST-API passthrough, parallel to `gh api` (`runGhApiJson`) already used in `cli.ts` for GitHub's workflow-run/job endpoints | `scripts/lib/forge-adapter/cli.ts` (`runGhApiJson`, `runGhApiText`) |
| Repo path shape passed to adapters | `GitLabForgeAdapter` is constructed with `'group/project'` (existing tests); GitLab's REST API requires the project path URL-encoded (`encodeURIComponent`) when used as `:id` in an endpoint path | `gitlab.test.ts` (`new GitLabForgeAdapter('group/project')`) |

## Dependency Blast-Radius

Grep for `.prChecks(` across `scripts/**/*.ts` (excluding `*.test.ts`) returns **zero** matches —
no production caller exists today. 8 files import `forge-adapter` for other exports
(`stack-repair.ts`, `doctor.ts`, `ci-diagnosis.ts`, `triage-deferred-findings.ts`,
`forge-adapter-routing.check.ts`, `forge-detection.ts`, `forge-doctor.ts`,
`campaign-status/forge.ts`) — none of them touch `prChecks` or `GitLabForgeAdapter` specifically.
Below the Standard-track section's own 3-consumer trigger threshold; included here per the spawn
request rather than because the trigger fired. No `## Threat Model` section:
`route.security_review_required: false` (router). No `## UI Interpretation Gate`: `route.ui:
false` (router).

## Execution Strategy & Stop Conditions

1. **Abort if the concern-2 regression test (Task 2) does not fail against unmodified `gitlab.ts`.**
   A test that passes against the known-buggy implementation proves nothing (`V-UNFALSIFIABLE-01`)
   — re-derive the assertion (exact call interception, exact pinned values) until it discriminates,
   and record the actual red output in the completion evidence before writing any fix code.
2. **Abort if `bun run scripts/checks/forge-adapter-routing.check.ts` fails after the `gitlab.ts`
   change.** That means a `glab` spawn leaked outside `glab-cli.ts` — route the new calls through
   `runGlabJson` instead of adding a second spawn site.
3. **Abort (for that one file only) if `spyOn(child_process, 'spawnSync')` does not intercept the
   calls `runTea`/`runGlab`/`runGh` make** (a known cross-module built-in-mocking risk in some Bun
   versions). Fall back to mocking at the existing `run*` wrapper-export granularity for that file,
   report the coverage percentage actually achieved instead of the Task's stated target, and note
   the fallback in the completion evidence — do not silently skip the file's test.
4. **Reject any new test that only asserts existence/shape** (`toBeDefined()`, `toHaveProperty()`,
   a `toEqual()` with wildcard/`expect.any()` fields standing in for a real fixture value) —
   V-TEST-05. Every new adapter test must pin concrete field values against a realistic CLI
   response fixture (mirroring `github.test.ts`'s existing `prChecks normalizes check conclusions`
   test).
5. **Do not touch `merge-gate.md` or any code path currently calling `gh pr checks` directly** —
   router explicitly scoped that rewiring out; it is a separate, larger blast-radius change.
6. **Do not modify `scripts/lib/forge-adapter/types.ts`** — the fix conforms `gitlab.ts` to the
   existing contract; it never redefines the contract.
7. Work in a dedicated worktree on branch `blackhole/issue-868`. Never commit to `main`
   (`V-BRANCH-01/02`).

## Task Breakdown

- [ ] **1. TDD Baseline Verification** — run `bun test scripts/lib/forge-adapter scripts/lib/forge-doctor.ts`
  and `bun run scripts/checks/forge-adapter-routing.check.ts` before touching any file. — **AC**:
  baseline pass/fail counts quoted verbatim in the completion evidence. Measured at `c8350578`
  during planning: `bun test --coverage scripts/lib/forge-adapter scripts/lib/forge-doctor.ts` →
  `14 pass, 0 fail, 24 expect() calls`, line coverage `cli.ts 17.86%`, `gitea.ts 38.12%`,
  `github.ts 45.54%`, `gitlab.ts 41.25%`, `glab-cli.ts 14.29%`, `tea-cli.ts 14.29%`,
  `index.ts 100%` (`forge-doctor.ts` absent from the report — no test imports it). Re-run at
  implement time and use the live numbers if `main` has moved.

- [ ] **2. Write the failing red test for `gitlab.prChecks`'s shape bug** — add to `gitlab.test.ts`:
  `test('prChecks returns one ForgeCheck per GitLab pipeline job')`. Mock `runGlabJson` with
  `mockImplementation((args: string[]) => { ... })` branching on the endpoint string (`args[1]`):
  return `[{ id: 55 }]` for a `.../merge_requests/9/pipelines` call and
  `[{ name: 'lint', status: 'success' }, { name: 'test', status: 'failed' }]` for a
  `.../pipelines/55/jobs` call; throw `Error('unexpected glab api call: ' + args.join(' '))` for
  anything else (this is what makes the test fail red today — current `gitlab.ts` calls
  `['ci', 'status', ...]`, which hits neither branch). Assert
  `checks` equals exactly
  `[{ name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }, { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }]`
  — two distinct pinned names and two distinct pinned conclusions, not an existence check
  (`V-TEST-05`). — **AC**: run this test alone against unmodified `gitlab.ts` and confirm it fails
  with the "unexpected glab api call: ci status …" error (quote the actual failure text in the
  completion evidence) — the red-before-green requirement for this concern (`V-TEST-02`,
  `V-UNFALSIFIABLE-01`).

- [ ] **3. Fix `GitLabForgeAdapter.prChecks`** — replace the single `glab ci status --mr` call with
  a two-step `glab api` passthrough (GitLab's stable public REST API, not `glab`'s own undocumented
  `ci status`/`ci get` JSON serialization — see § References for the endpoint shapes):
  1. `runGlabJson<Array<{ id: number }>>(['api', 'projects/' + encodeURIComponent(this.repo) + '/merge_requests/' + number + '/pipelines'])`
     — pick the pipeline with the highest `id` (`.slice().sort((a,b) => b.id - a.id)[0]`), not
     `[0]` by assumed response order, to avoid depending on an unconfirmed API ordering guarantee;
     return `[]` if the pipeline list is empty (no pipeline yet — a genuine "no checks" state, not
     a swallowed error, since nothing is caught here).
  2. `runGlabJson<Array<{ name: string; status: string }>>(['api', 'projects/' + encodeURIComponent(this.repo) + '/pipelines/' + latest.id + '/jobs'])`
     — map each row to one `ForgeCheck`: `status: 'running' → IN_PROGRESS`, `'pending'|'created' →
     QUEUED`, else `COMPLETED`; `conclusion: 'success' → SUCCESS`, `'failed' → FAILURE`,
     `'canceled' → CANCELLED`, `'skipped' → SKIPPED`, else `null` — mirroring the enum mapping
     style already used in this file's aggregate version and in `github.ts:normalizeCheck`.
  Neither call is wrapped in try/catch (Codebase Conventions: no swallow-to-`[]`). — **AC**: Task
  2's test now passes; the existing `prChecks propagates a glab CLI failure instead of returning an
  empty check list` test (issue #864 regression) passes **unmodified**; `bun run
  scripts/checks/forge-adapter-routing.check.ts` exits 0.

- [ ] **4. Gitea adapter value-pinning tests** — extend `gitea.test.ts` with tests for `authStatus`
  (both the `ok: true` branch and the `result.status !== 0` branch — ENOENT is already covered via
  the shared #864-style pattern once added), `labelAdd`, `labelRemove`, `issueCreate`, `issueEdit`,
  `issueComment`, `prCreate`, `prComment`, `prView`, and a value-pinning `prChecks` test (distinct
  `name`/`status`/`conclusion` per row, using `tea actions status`'s real row shape:
  `{ name, status: 'in_progress'|'queued'|..., conclusion }`). Every assertion pins concrete field
  values from a realistic `tea` JSON fixture. — **AC**: `bun test --coverage
  scripts/lib/forge-adapter/gitea.test.ts` reports `gitea.ts` line coverage **≥75%** (from the
  38.12% baseline).

- [ ] **5. GitLab adapter value-pinning tests** — extend `gitlab.test.ts` with the same method
  coverage as Task 4, adapted to `glab`'s row shapes (`iid`, `source_branch`, `merge_at`, etc.).
  — **AC**: `bun test --coverage scripts/lib/forge-adapter/gitlab.test.ts` reports `gitlab.ts` line
  coverage **≥75%** (from the 41.25% baseline, post-Task-3 fix).

- [ ] **6. GitHub adapter parity tests** — extend `github.test.ts` with `authStatus`'s
  `result.status !== 0` branch, `labelAdd`, `labelRemove`, `issueCreate`, `issueEdit`,
  `issueComment`, `prCreate`, `prComment`. Do **not** add tests for `resolveDefaultRepo`,
  `getPrHeadSha`, `listWorkflowRuns`, `listWorkflowJobs`, `getJobLog`, `getFailedRunLog` — these
  are GitHub-only CI-diagnosis methods already covered by `scripts/ci-diagnosis.test.ts`
  (confirmed via grep); duplicating that coverage here is out of scope (`V-PARETO-01`,
  `V-DRY-01`). — **AC**: `bun test --coverage scripts/lib/forge-adapter/github.test.ts` reports
  `github.ts` line coverage **≥65%** (from the 45.54% baseline; lower target than Gitea/GitLab
  because the 6 CI-diagnosis methods are intentionally excluded from this plan's scope).

- [ ] **7. New `tea-cli.test.ts`** — spy on `child_process.spawnSync` (not the wrapper exports) and
  call `runTea`, `runTeaJson`, `runTeaText` directly. Cover: (a) exact `argv` passed to
  `spawnSync('tea', argv)` for a representative call; (b) `runTeaJson` appends `--json` only when
  absent from the input args; (c) JSON stdout is parsed and returned; (d) a non-zero exit status
  throws with `stderr.trim() || stdout.trim() || 'tea ... failed'` as message; (e) `error.code ===
  'ENOENT'` surfaces on the raw `runTea` result untouched. — **AC**: `bun test --coverage
  scripts/lib/forge-adapter/tea-cli.test.ts` reports `tea-cli.ts` line coverage **≥85%** (from the
  14.29% baseline), or the Task 3 stop-condition fallback is invoked and documented.

- [ ] **8. New `glab-cli.test.ts`** — same shape as Task 7 for `runGlab`/`runGlabJson`/
  `runGlabText`, covering `runGlabJson`'s `--output json` auto-append (only when `--output` is
  absent from the input args, distinct from `tea-cli`'s `--json` flag). — **AC**: `bun test
  --coverage scripts/lib/forge-adapter/glab-cli.test.ts` reports `glab-cli.ts` line coverage
  **≥85%** (from the 14.29% baseline), or the Execution Strategy Task 3 fallback is invoked and
  documented.

- [ ] **9. New `cli.test.ts`** — same shape as Task 7 for `runGh`/`runGhJson`/`runGhText`/
  `runGhApiJson`/`runGhApiText`, covering the `options.repo` auto-append-`--repo`-unless-already-
  present behavior distinct from the other two CLI wrappers. — **AC**: `bun test --coverage
  scripts/lib/forge-adapter/cli.test.ts` reports `cli.ts` line coverage **≥75%** (from the 17.86%
  baseline).

- [ ] **10. New `forge-doctor.test.ts`** — test `checkForgeAuthSync` for all three forges
  (`github`, `gitea`, `gitlab`) crossed with `{ok, ENOENT, non-zero-exit}` branches, spying on
  `runGh`/`runTea`/`runGlab` module exports (the existing adapter-test mocking granularity, since
  `forge-doctor.ts` calls those wrappers directly, not `spawnSync`). — **AC**: `bun test --coverage
  scripts/lib/forge-doctor.test.ts` reports `forge-doctor.ts` line coverage **≥85%** (from
  effectively 0% today — no test currently imports this file).

- [ ] **11. Verify Integrity** — run `bun test --coverage scripts/lib/forge-adapter
  scripts/lib/forge-doctor.ts`, `bun run scripts/checks/forge-adapter-routing.check.ts`, and
  `bun run verify`. — **AC**: full targeted suite green with the per-file coverage floors from
  Tasks 4-10 all met or their documented fallback recorded; `forge-adapter-routing.check.ts` exits
  0; `bun run verify` exits 0.

## Sprint Contract

Per-task acceptance criteria above are binding and are not superseded by a blanket "tests pass".
Cross-cutting conditions applying to every task:

1. No test added in Tasks 4-10 asserts existence/shape only — every one pins concrete field values
   (Execution Strategy #4).
2. The `gitlab.ts` production diff is confined to the `prChecks` method body — no other method,
   and no file outside § Touch-Paths, is touched.
3. The issue #864 regression test in both `gitea.test.ts` and `gitlab.test.ts` passes unmodified
   throughout.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS — no schema/API contract change; `gitlab.ts` conforms to the existing `ForgeAdapter.prChecks` signature, unchanged |
| `ac_mapping` | PASS — every Task Breakdown item carries a machine-verifiable `— **AC**:` |
| `critical_files_exist` | PASS — `scripts/lib/forge-adapter/types.ts` and `scripts/checks/forge-adapter-routing.check.ts` both confirmed present on disk during planning |
| `mitigation_concrete` | PASS — every Execution Strategy item is an "abort if X" stop condition, no bare "monitor"/"be careful" language |

Verified via `bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-868.md` →
`{"ac_mapping":true,"critical_files_exist":true,"mitigation_concrete":true}`.

## References

- **ADR**: `documentation/decisions/ADR-027-forge-adapter-interface.md` — chosen approach: one
  thin per-forge adapter module behind a shared `ForgeAdapter` interface, `prChecks(number):
  Promise<ForgeCheck[]>` (line 167); this plan conforms `gitlab.ts` to that interface, it does not
  revisit the ADR's decision.
- Issue #864 (merged, PR referenced in both `gitea.ts`/`gitlab.ts` comment blocks and both
  adapters' existing `prChecks propagates a … CLI failure` regression tests) — established the
  "never swallow a CLI failure into `[]`" convention this plan's Task 3 fix preserves.
- GitLab REST API (evidence gathered via web search during planning, `glab` CLI not installed in
  this environment to verify empirically):
  - `glab api <endpoint>` is a documented generic authenticated-request passthrough, parallel to
    `gh api` (docs.gitlab.com/cli/api/) — already the pattern `cli.ts`'s `runGhApiJson` uses for
    GitHub's workflow-run/job endpoints.
  - `GET /projects/:id/merge_requests/:merge_request_iid/pipelines` and
    `GET /projects/:id/pipelines/:pipeline_id/jobs` are GitLab's stable, long-documented public
    REST endpoints for per-MR pipelines and per-pipeline job rows respectively (job fields include
    `id`, `status`, `name`, `stage` — the `status` enum `created|pending|running|failed|success|
    canceled|skipped|manual|waiting_for_resource` is stable public API surface). Preferred over
    `glab ci status`/`glab ci get`'s own JSON serialization (confirmed via GitLab CLI docs +
    DeepWiki source summary to wrap `GetPipeline` — a single aggregate object, not a per-job
    array — which is why the *current* `gitlab.ts` code, calling `glab ci status`, can only ever
    produce one synthetic row no matter how many jobs really ran).
- Router notes, `.blackhole/queue.json` issue 868 entry — independent confirmation of the
  `gitlab.ts:201-212` vs `gitea.ts:204-221`/`github.ts:218-224` divergence, `needs_split: false`,
  `security_review_required: false`, `ui: false`, `task_type: refactor`.
