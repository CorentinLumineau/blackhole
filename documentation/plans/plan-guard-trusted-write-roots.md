---
issue: #1296
type: plan
summary: "One shared trustedWriteRoots(cwd, input) helper for the Write and Bash containment guards: admit the validated harness scratchpad in both tools and the linked worktrees of other blackhole repos listed in permissions.additionalDirectories, never a directory the guard cannot tie to a campaign"
status: current
review_trigger: "on rule update"
created: 2026-11-19
last_updated: 2026-11-19
related: [plans/plan-hook-schemas-md-overstates-the-v-hook-visibility-guarantee-for-foreign-pretoolus.md]
---

# Plan - Issue #1296 - Trusted write roots for the containment guards

Track: **Standard** (multi-file hook change, trust-boundary change, `security_review_required`).
Base: `origin/main` ca9d3cd0. **Implementation starts after PR #1346 (#1280) merges**; this plan is
written against that branch (`origin/blackhole/issue-1280-state-dir-trust`, `feed33922`), which
adds `campaignStateRoot`, `isStateDirTrustedPath` and the state-dir landing helper in
`templates/hooks/pretooluse/utils/hook-event-log.js`. `plan_base_commit` for the implementer is the
merge commit of #1346, to be re-stamped at start.

## Objective

Two reported symptoms, one cause: each containment guard builds its own list of writable roots.

1. **Scratchpad**: the Write guard admits the harness scratchpad (through `allWorktreeRoots`); the
   Bash guard (`bash-write-target-guard.js`, `bash-outside-assigned-worktree`) never does. A
   campaign session can `Write` a probe file into its scratchpad but not `cat > file`.
2. **Cross-repo**: a session whose cwd is repo A runs a campaign on repo B. B's issue worktree is
   added as a harness working directory, but the guards only know `git worktree list` of the
   payload cwd's repo, so every Write/Edit is denied `[outside-worktree]`.

Fix: a single `trustedWriteRoots(cwd, input)` in `utils/hook-event-log.js`, called by both guards,
so a root can never be trusted by one tool and refused by the other.

## Design

### Facts established by reading #1346's branch

- `validate-file-changes.js:146`: `roots = assignedRoot ? [assignedRoot] : allWorktreeRoots(cwd)`.
  With an assigned root, the scratchpad is only present if `readCwdDerivedAssignedRoot` returned a
  scratchpad that *nests* the worktree; a disjoint harness scratchpad (`/tmp/claude-<uid>/...`) is
  excluded. That matches the comment-reported Write denial `outside-assigned-worktree`, and
  contradicts the #1346 probe (Write allowed, Bash denied). **Task 0 re-probes before any code.**
- `bash-write-target-guard.js:1614-1649`: only `assignedRoot` plus `isStateDirTrustedPath`.
- `input.scratchpad_dir` (v2.1.257+) is a documented PreToolUse common field; neither guard reads
  it. Documented additional working directories are **not** in the payload (docs summary, to be
  confirmed by Task 0's payload dump).
- `isAcceptableScratchpadDir` and `isExistingDirectory` already implement the breadth and
  existence checks; `isTrustedLinkedWorktree` / `isBackLinkedWorktree` already prove a directory
  is a registered worktree of a given repo (`--git-common-dir` back-link).

### `trustedWriteRoots(cwd, input)` (new, `utils/hook-event-log.js`)

Returns the extra roots beyond the assigned/family roots the caller already computed:

1. **Scratchpad roots** (validated, deduplicated by `resolveExistingAncestor`): `input.scratchpad_dir`,
   config `scratchpad_dir`, `BLACKHOLE_SCRATCHPAD_DIR`. Each must pass `isAcceptableScratchpadDir`
   and `isExistingDirectory`. `/`, `$HOME`, `/tmp` and bare temp roots stay refused.
2. **Declared cross-repo worktree roots**: union of `permissions.additionalDirectories` from
   `~/.claude/settings.json`, `<project>/.claude/settings.json`, `<project>/.claude/settings.local.json`
   (`<project>` = `CLAUDE_PROJECT_DIR` or the cwd's worktree root). A candidate is admitted only when
   **all** hold: absolute, `isAcceptableScratchpadDir`, exists; it is a *registered linked worktree*
   (`git worktree list` of its own repo, `isBackLinkedWorktree`), **not** the main clone; and its
   repo's main clone has `.blackhole/config.json`. Anything else is dropped silently (never an error).
3. Callers pass the result to the existing containment check as additional allowed roots. The
   assigned-root narrowing is unchanged for the *assigned* decision; the extras are an explicit
   second allow-list so `[outside-assigned-worktree]` stops firing for a validated scratchpad.
4. Fail-closed posture is inherited: a settings file that is unreadable or malformed contributes
   zero roots (narrower, never wider). git failures propagate to the existing `failClosed`.

Not weakened (asserted by tests, listed so the implementer does not "simplify" them away):
`isStateDirTrustedPath` denials of `config.json`, `hook-events/**`, the state root and `archive/` as
write destinations; main-clone tracked-file protection; path traversal and system-path checks. A
trusted extra root is checked with the same protected-name rules as any other root.

### Split decision: **one PR**

Both legs are one helper plus two call sites per guard; the cross-repo mechanism reuses existing
predicates and adds one settings reader (~40 lines). Splitting would land the helper in PR 1 and a
single caller-visible `if` in PR 2, doubling the review and the plugin cache refresh for no
isolation benefit. Only if Task 0 shows the scratchpad cause is *not* the missing union (e.g. a
payload-field mismatch) does the scratchpad leg become its own PR; the plan then ships leg 2 first.

## Decision Record

- **Context**: the PreToolUse payload carries no additional working directories, yet cross-repo
  campaign workers must write to a worktree of repo B.
- **Alternatives**:
  - (a) Orchestrator-declared roots (`BLACKHOLE_ASSIGNED_WORKTREE` or config). Easy to reason
    about, but env never reaches Pattern C workers (the code at `readCwdDerivedAssignedRoot` says so),
    and a config key in repo A cannot name B's worktrees without a new registry.
  - (b) **Settings union of `permissions.additionalDirectories`, restricted to blackhole worktrees**
    (chosen). Works for native `Agent` workers, uses the grant the user already made, and the
    tie-to-campaign check is mechanical.
  - (c) `DirectoryAdded` hook event writing a per-session state file. Would cover `--add-dir`, but
    its schema is unverified and the state file is a new trust store a worker could write
    (the very class of hole #1280 closes).
  - (d) Trust every additional directory. Rejected outright: the harness grant is for reading and
    editing by the *user's* intent, not a campaign boundary.
- **Choice**: (b), with scratchpad handled by (a)-style validated sources plus `input.scratchpad_dir`.
- **Harder alternative named**: (c), because it would be exact where (b) is best-effort. Rejected
  for now: unverifiable schema, new writable trust store, extra hook registration to ship and
  cache-refresh. Session-only `--add-dir` directories are the known gap of (b); documented, and
  revisited if #1296 follow-ups show it matters.
- **Rationale**: short-term cost is a missed session-only grant (worker falls back to its own
  worktree or the orchestrator persists the directory in settings); long-term benefit is no new
  trust store and one auditable predicate.
- **Confidence**: Medium (payload shape is docs-inferred until Task 0).

## Threat Model (STRIDE; `security_review_required: true`)

| Threat | Description | Severity | Mitigation | Status |
|---|---|---|---|---|
| Spoofing | A directory named like a campaign worktree but not registered in a blackhole repo | High | Admit only `git worktree list` members with a verified `--git-common-dir` back-link into a repo that has `.blackhole/config.json` | Mitigated |
| Tampering | Worker adds a broad directory (`/tmp`, `$HOME`, a sibling repo) to a settings file to widen its own roots | Critical | Breadth check on every candidate; sibling repo without `.blackhole/` and main clones refused; `.claude/settings.local.json` is itself a write target the existing sensitive-file path warns on (Task 4 adds an explicit test that a settings edit in-session does not widen roots mid-call, since roots are read per call from files the worker could edit: the plan treats settings files as protected, see Task 4) | Mitigated by Task 4 |
| Repudiation | A write allowed through an extra root is not attributable | Low | Allowed calls log nothing today; denials keep `pattern_id`; no change | Accepted Risk |
| Information Disclosure | Scratchpad or extra worktree used as an exfiltration staging area | Medium | Roots grant write containment only; reads were never contained; secrets patterns unchanged | Accepted Risk |
| Denial of Service | Many `additionalDirectories` entries make each hook call run many `git worktree list` | Low | Cap at 16 candidates per call; per-call dedup; hooks run once per call | Mitigated |
| Elevation of Privilege | Symlink under a trusted root pointing at the main clone or `$HOME` | High | All comparisons via `resolveExistingAncestor` (existing); `isAcceptableScratchpadDir` judges both readings; test for a symlinked scratchpad | Mitigated |

Open item for the implementer: a worker that can Write `.claude/settings.local.json` could grant
itself roots on the *next* call. Task 4 makes `permissions.additionalDirectories` edits to any
settings file a deny (`settings-roots-write`) under campaign scope, or documents why the existing
sensitive-file tier already covers it; the decision is the implementer's, with the test fixed here.

## Touch-Paths

- `templates/hooks/pretooluse/utils/hook-event-log.js` (add `trustedWriteRoots`, export it)
- `templates/hooks/pretooluse/validate-file-changes.js` (use it)
- `templates/hooks/pretooluse/utils/bash-write-target-guard.js` (use it)
- `templates/hooks/pretooluse/README.md` (document sources and the session-only-grant gap)
- `src/references/blackhole-state.md` (one sentence in the hook/containment description, if #1346
  placed the state-dir sentence there; otherwise omit)
- `scripts/hooks-trusted-write-roots.test.ts` (new)
- Plus all generated dist trees per `scripts/lib/build/targets.ts` (regenerated by `bun run build`,
  never hand-edited).

Hook changes ship with regenerated build output (`bun run build`). `V-PLUGIN-01` (version bump)
is **owner-waived** for this issue; the PR body states the waiver and the stale-cache consequence
(`blackhole-protocol.md` § Installed plugin cache refresh).

## Documentation Impact

`templates/hooks/pretooluse/README.md` and (if present after #1346) `src/references/blackhole-state.md`
containment wording. No new doc files, `documentation/INDEX.md` is not regenerated by this plan.

## Critical Files

- `templates/hooks/pretooluse/utils/hook-event-log.js`
- `templates/hooks/pretooluse/utils/bash-write-target-guard.js`
- `templates/hooks/pretooluse/validate-file-changes.js`

## Codebase Conventions

CommonJS hook modules, `'use strict'`, reuse `isAcceptableScratchpadDir`, `isExistingDirectory`,
`resolveExistingAncestor`, `isUnderRoot`, `isBackLinkedWorktree` (V-INT-02: no second breadth or
back-link check). Tests are `bun test` files under `scripts/` that spawn the hook with a JSON
payload, same shape as `scripts/hooks-state-dir-trust.test.ts` (#1346). Data-structure orientation:
`allWorktreeRoots` returns `string[]` of root paths (`hook-event-log.js` ~440), consumed by
`isInsideAnyRoot(filePath, roots)` at `validate-file-changes.js:163`; `trustedWriteRoots` returns the
same element type so no axis confusion.

## Task Breakdown (test first; CI verifies, run only the one focused spec locally via `with-test-lock`)

0. **Re-probe, no code.** Print `assignedRoot`, `roots` and the full PreToolUse payload keys for a
   Write and a Bash call to the harness scratchpad, with and without `BLACKHOLE_ASSIGNED_WORKTREE`.
   Record in the PR body. **AC**: PR body contains the observed payload keys (including whether
   `scratchpad_dir` is present and whether any additional-directory field exists) and the observed
   Write/Bash verdict for the four combinations; if `scratchpad_dir` is absent, Task 2 drops that source.
1. **Failing tests first** in `scripts/hooks-trusted-write-roots.test.ts`. **AC**: file fails (red)
   against the unmodified guards with the cases below, then passes after Tasks 2-4.
   - Must-DENY: (i) an `additionalDirectories` entry that is not a campaign worktree; (ii) a sibling
     repo's linked worktree whose repo has no `.blackhole/`; (iii) a broad scratchpad (`/tmp`,
     `$HOME`) as `input.scratchpad_dir`; (iv) a tracked file in the main clone of repo B; (v) the
     main clone of repo B itself listed as an additional directory; (vi) a symlinked scratchpad
     pointing at `$HOME`; (vii) every #1346 denial: `config.json`, `hook-events/**`, state root,
     `archive/` as destinations through a trusted extra root.
   - Must-ALLOW: (viii) the validated scratchpad for **both** Write and Bash, with and without
     `BLACKHOLE_ASSIGNED_WORKTREE`; (ix) a declared campaign worktree in another repo (has
     `.blackhole/config.json`, registered linked worktree) for Write and Bash.
   - Parity: one table-driven test runs every target above through both guards and asserts the same
     allow/deny verdict.
2. **Implement `trustedWriteRoots`** (scratchpad sources). **AC**: cases (iii), (vi), (viii) green;
   helper is the only place that reads `input.scratchpad_dir`.
3. **Cross-repo settings reader** and trust tie. **AC**: cases (i), (ii), (iv), (v), (ix) green;
   candidate cap of 16 covered by a test.
4. **Wire both guards** and settings-write protection. **AC**: parity test green; grep shows
   neither guard builds its own scratchpad root list; a worker write to a settings file's
   `permissions.additionalDirectories` is denied or documented as already covered, with a test.
5. **Docs and build.** **AC**: `bun run build` output is committed with no hand edits;
   `README.md` names the three scratchpad sources, the settings-union mechanism and the
   session-only `--add-dir` gap; PR body states the V-PLUGIN-01 owner waiver.

## Execution Strategy & Stop Conditions

- If Task 0 shows `input.scratchpad_dir` absent from the real payload, then drop that source and
  keep config/env sources only; do not guess a field name.
- If Task 0 shows the payload carries an additional-directories field, then stop and revise this
  plan to read it instead of settings files.
- If any #1346 denial test (config.json, hook-events/**, state root, archive/) goes red, then revert
  the change and halt for review.
- If a candidate directory cannot be tied to a `.blackhole/config.json` repo, then drop it; never
  widen to make a test pass.
- If the PR exceeds one comfortable review after Task 3, then split leg 2 into its own PR.

## Sprint Contract

Each task's AC above is the definition of done; for Task 5 additionally CI green on the pushed head
(job name and status quoted as evidence). No full suite locally.

## Quality Gate Results

- touch_paths_declared: PASS
- schema_baseline: PASS (no schema change)
- ac_mapping: PASS (every task carries an AC)
- critical_files_exist: PASS (all three exist on `origin/main`; the new test file is listed under Touch-Paths only)
- mitigation_concrete: PASS (each stop condition is "if X then drop/stop/revert/halt/split")
- ADVISORY touch_paths_ssot_gap: none expected; `plan-quality-gate.ts` was not run here (read-only, no heavy tooling on the recovering workstation), the implementer should run it.
