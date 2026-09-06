---
issue: 879
type: plan
status: current
summary: "Corrects hook-schemas.md's outside-worktree root-set description to name all five allWorktreeRoots() members -- adding the omitted scratchpad_dir-itself member (isExistingDirectory-gated) and distinguishing it from the BLACKHOLE_SCRATCHPAD_DIR env var -- across src/ and all 9 generated dist copies; doc-only, no code change, and separately corrects ledger finding F-00082's incorrect cross-reference to this issue"
review_trigger: "on file change"
created: 2026-09-06
last_updated: 2026-09-06
---

# Plan - Issue #879

## Objective

`src/references/hook-schemas.md`'s description of `outside-worktree`'s root set (#729) names
only two of the five members `allWorktreeRoots()` (`templates/hooks/pretooluse/utils/hook-event-log.js`)
actually computes. It omits member 3 entirely — the validated `scratchpad_dir` config value
**itself** (not just worktrees nested under it), admitted only when `isExistingDirectory()`
confirms it still exists on disk. This is a **documentation-only** fix: `allWorktreeRoots()`'s
code is the intended, already-reviewed outcome of #853/#839 and is not being changed. The task
is to correct the prose at the one canonical site (`src/references/hook-schemas.md`, `V-DOC-05`)
and propagate the fix through the build to its 9 generated dist copies.

**Scope separation from #907 (do not fold together)**: #907 concerns
`BLACKHOLE_ASSIGNED_WORKTREE` being unreachable under Pattern C, so the *narrowing* mechanism
never fires and containment degrades to the fallback `allWorktreeRoots(cwd)` root set. #879 is
that `allWorktreeRoots()` itself works exactly as designed but the doc describing its membership
is incomplete. These are independent: even after #907 lands, `allWorktreeRoots()` remains both
the fallback set *and* `outside-assigned-worktree`'s own membership test, so this doc fix stands
on its own regardless of #907's outcome. A future reader of either issue should not merge them.

**Ledger-row correction to surface in the PR body (not a code fix — a finding for whoever
triages that row next)**: `.blackhole/findings-ledger.json` finding `F-00082` (a worktree-
containment denial on the harness scratchpad, `status: deferred`, `deferred_to_issue: 895`)
speculates: *"Possibly already intended-and-unimplemented... the root-set may have been extended
in docs without the enforcement path following."* That speculation is incorrect and conflates two
distinct mechanisms: the config-derived `scratchpad_dir` (root-set members 2 and 3 below) and the
env-var `BLACKHOLE_SCRATCHPAD_DIR` (root-set member 5). #879 concerns member 3's **documentation**
only — there is no enforcement gap; `allWorktreeRoots()` already implements all five members
correctly. This PR does not edit `F-00082` (ledger state is orchestrator-owned) but its body must
state this correction so the row's actual denial gets re-triaged on the right premise.

## Touch-Paths

- `src/references/hook-schemas.md` plus all generated dist trees per `scripts/lib/build/targets.ts`
  (9 dist copies — `.cursor/skills/blackhole/references/hook-schemas.md`,
  `.claude/skills/blackhole/references/hook-schemas.md`,
  `.agents/build/skills/blackhole/references/hook-schemas.md`,
  `skills/blackhole/references/hook-schemas.md`, `references/hook-schemas.md`,
  `codex-skills/blackhole/references/hook-schemas.md`,
  `plugins/blackhole/skills/blackhole/references/hook-schemas.md`,
  `plugins/blackhole-claude/skills/blackhole/references/hook-schemas.md`,
  `plugins/blackhole-agent-plugins/skills/blackhole/references/hook-schemas.md`
  — regenerated via `bun run build`, never hand-edited)

## Documentation Impact

None — `src/references/hook-schemas.md` is an internal agent-reference file compiled into the
plugin distribution trees, not a `documentation/` consumer doc. No `documentation/` file
describes `allWorktreeRoots()`'s root-set membership, so nothing there goes stale. The
`ARCHITECTURE.md` and `documentation/decisions/` trees are unaffected — no ADR, no Active
Constraint, no companion file references this paragraph.

## Task Steps

- [ ] **Red-before-green baseline** (prose change, no code under test — the grep pairs below are
  the falsifiable check). At implement time, re-read `src/references/hook-schemas.md` fresh
  (working tree may be behind `main` — confirm via `git fetch` + `git log -1 --format=%H` against
  the plan's `plan_base_commit`, and re-locate the paragraph by content match, not by the line
  number cited here, since it has already drifted once, #143 -> #171, across PR #930).
  Run:
  ```
  grep -c "isExistingDirectory" src/references/hook-schemas.md   # expect 0 (RED)
  grep -c "scratchpad_dir\` itself" src/references/hook-schemas.md   # expect 0 (RED)
  grep -c "BLACKHOLE_SCRATCHPAD_DIR" src/references/hook-schemas.md  # expect 1 (baseline, unchanged by this fix)
  ```
  — **AC**: all three commands run and their output quoted verbatim in the implementation
  evidence before any edit is made; the first two must read `0`, the third must read `1`.

- [ ] **Replace the root-set paragraph** in `src/references/hook-schemas.md`, verbatim
  replacing the single line beginning `` `outside-worktree`'s root set (#729) always includes
  the payload's own `cwd` worktree `` with:

  > `outside-worktree`'s root set (#729) is `allWorktreeRoots()`'s union of five members: every
  > registered worktree nested under the main clone; every registered worktree nested under a
  > validated `scratchpad_dir` (the campaign's own `.blackhole/config.json` value, breadth-checked
  > via the same check `scratchpad_dir` uses elsewhere in this file); `scratchpad_dir` itself,
  > admitted only when `isExistingDirectory()` confirms it is still present on disk — a target
  > sitting directly at the scratchpad root, not just inside one of its `wt-*` subdirectories, is
  > in-bounds; the payload's own `cwd` worktree, always included when not already covered by the
  > three roots above (#729); and, when set and valid (same breadth and existence checks as
  > `scratchpad_dir`), an opt-in `BLACKHOLE_SCRATCHPAD_DIR` env var — a distinct mechanism from
  > the config `scratchpad_dir` above, naming the harness's own per-session scratchpad directory,
  > which is never a git worktree and so never appears in `git worktree list` output at all.

  No other line in this file changes. — **AC**: `git diff src/references/hook-schemas.md` shows
  exactly one changed paragraph (one old line removed, one new paragraph added), nothing else in
  the file touched.

- [ ] **Green + invariance check**. Run:
  ```
  grep -c "isExistingDirectory" src/references/hook-schemas.md   # expect >=1 (GREEN — member 3's gate is now documented)
  grep -c "BLACKHOLE_SCRATCHPAD_DIR" src/references/hook-schemas.md  # expect 1, unchanged from baseline
  ```
  — **AC**: first command's count increases from the red baseline (0 -> >=1); second command's
  count is identical to the red baseline (1 -> 1), proving the edit added member 3's description
  without touching member 5's — the two are easy to conflate (both involve "scratchpad", one is
  an env var) and that conflation is exactly how ledger row `F-00082`'s wrong speculation arose.

- [ ] **Rebuild and propagate to all dist copies**. Run `bun run build`. — **AC**:
  `grep -rl "isExistingDirectory" --include="hook-schemas.md" .` returns exactly the 10 paths
  listed under Touch-Paths (src + 9 dist copies), each containing the identical replacement
  paragraph text (`diff` each dist copy's paragraph against `src/references/hook-schemas.md`'s —
  zero differences); `grep -rc "BLACKHOLE_SCRATCHPAD_DIR" --include="hook-schemas.md" .` reports
  `1` for each of the same 10 paths, unchanged from baseline.

- [ ] **PR body**: include a `## Ledger correction` section (or equivalent) stating the F-00082
  speculation is incorrect, per the Objective section above, so a future triage of that
  `deferred`/`deferred_to_issue: 895` row is not misled by it. Do not edit
  `.blackhole/findings-ledger.json` — that file is orchestrator-owned state; a worker must never
  write it directly. — **AC**: PR body contains the correction text verbatim (or a faithful
  paraphrase preserving the F-00082 id, the member 2/3/5 distinction, and the "no enforcement
  gap" conclusion).

## Sprint Contract

- Red-before-green grep pair passes as specified (Task Step 1), before any edit.
- The corrected paragraph lands verbatim, and only that paragraph changes, in
  `src/references/hook-schemas.md` and all 9 generated dist copies (Task Steps 2, 4).
- The `BLACKHOLE_SCRATCHPAD_DIR` invariance count (`1`, unchanged) holds in all 10 files
  post-edit (Task Steps 3, 4).
- The PR body carries the F-00082 ledger-row correction (Task Step 5).
- No change to `templates/hooks/pretooluse/utils/hook-event-log.js` or any other code file —
  this is prose-only. Any diff touching a `.js`/`.ts` file is out of scope and must be reverted
  before requesting review.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS |
| `ac_mapping` | PASS (advisory on Quick track — `## Task Breakdown` heading absent; every `## Task Steps` bullet above nonetheless carries an explicit `— **AC**:` clause) |
| `critical_files_exist` | PASS (advisory on Quick track — `## Critical Files` heading absent, nothing to Glob-check; this plan creates no new file and touches no pre-existing sensitive touchpoint) |
| `mitigation_concrete` | PASS (advisory on Quick track — `## Execution Strategy & Stop Conditions` heading absent; no vague-mitigation language used in Task Steps) |

CLI run (`bun run scripts/plan-quality-gate.ts --plan-file .blackhole/plans/issue-879.md`)
reports all three keys `true` — expected and vacuous on Quick track, since the CLI's section
extractors find no `## Task Breakdown` / `## Critical Files` / `## Execution Strategy & Stop
Conditions` headings in a Quick-track plan (`planner.md` Step 8, "Section-presence gating, not
track-gating"). Exact JSON output quoted in the worker return below.
