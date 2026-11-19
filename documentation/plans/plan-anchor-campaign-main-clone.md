---
issue: #1352
type: plan
summary: "Anchor the campaign main clone the PreToolUse hooks read config.json, the state dir and scratchpad_dir from to the harness project dir (CLAUDE_PROJECT_DIR) instead of git metadata in cwd, so a worker-forged clone can no longer mint write roots (variants B, C, D)"
status: current
review_trigger: "on rule update"
created: 2026-11-19
last_updated: 2026-11-19
plan_base_commit: de2a9f34618af304e127047ec8890f5b9b314ca1
related: [plans/plan-guard-trusted-write-roots.md]
---

# Plan - Issue #1352 - Anchor the campaign main clone

Track: **Standard** (trust-boundary change in the PreToolUse hooks, `security_review_required`).
Base: `origin/main` de2a9f34 (includes #1349). **Implementation starts after #1347 PR 1 merges**:
both edit `templates/hooks/pretooluse/utils/hook-event-log.js`. Files this plan needs, so the
overlap can be checked: `utils/hook-event-log.js` (core), `utils/sibling-plugin-guard.js`, one new
spec, doc sentences. `validate-file-changes.js` and `bash-write-target-guard.js` need **no edit**
(they reach every changed function through `campaignStateRoot(cwd)` and
`trustedWriteRoots(cwd, input, ...)`, whose signatures stay as they are).

## Objective

`mainCloneRoot(cwd)` derives the main clone from git metadata a worker can write (its worktree's
`.git` pointer file, a planted `.git` in a subdirectory, a real nested repo). The result then feeds
trust decisions: `<clone>/.blackhole/config.json`'s `scratchpad_dir` becomes a trusted write root
(`readScratchpadDir`), `<clone>/.blackhole` becomes a trusted state dir (`campaignStateRoot`), and an
absent config makes the sibling-plugin guard stand down. A worker that controls the clone controls
all three. #1349 closed variant A (clone inside the worker's own worktree) with a throw in
`mainCloneRoot`; B, C and D remain.

Fix, the same idea #1349 applied to the settings route: **the campaign config, state dir and
config scratchpad are read only from a main clone anchored to a source the worker cannot write**.

### Reproduction on `de2a9f34` (run in memory, fixture in a temp dir inside the worktree, deleted)

Real hooks, agent_type `implementer`, `CLAUDE_PROJECT_DIR` set to the real main clone `M` and also
unset, forged config `{"scratchpad_dir": "<M>"}`, target `M/pwn.txt` (an untracked file in the real
main clone):

| cwd | Write | Bash `echo x > M/pwn.txt` |
|---|---|---|
| legit worktree of M | DENY `outside-assigned-worktree` | DENY `bash-outside-assigned-worktree` |
| B: worktree whose admin dir is in forged clone F (F in the scratchpad) | **ALLOW** | **ALLOW** |
| C: `W/sub` is a worktree of forged F (planted `.git`) | **ALLOW** | **ALLOW** |
| D: `W/nested`, a real nested repo carrying the config | **ALLOW** | **ALLOW** |

The same results with and without `CLAUDE_PROJECT_DIR`. The forged `scratchpad_dir` admits the real
main clone, a sibling campaign worktree directory, or another repo's worktrees.

## Design

### Facts read from `de2a9f34`

- `mainCloneRoot` (`hook-event-log.js:156`) = `dirname(git rev-parse --git-common-dir)`; the only
  guard is the variant-A containment throw (`:168-171`).
- Config-route consumers, all fed by that value: `readScratchpadDir(mainClone)` at `:301`, called
  from `allWorktreeRoots` (`:465`), `readCwdDerivedAssignedRoot` (`:592`) and `trustedWriteRoots`
  (`:942`); `campaignStateRoot` (`:759`); `hasNoCampaignConfig(mainClone)` via
  `sibling-plugin-guard.js:71-91` and the rotation gate in `recordEvent` (`:690`); and the audit-trail
  sink `recordEvent` (`:650`, writes `<clone>/.blackhole/hook-events`, so a forged clone also
  **redirects the worker's own deny records** away from Triage).
- #1349's anchor: `isHarnessProjectDir(project, cwd, writableRoots)` (`:890`) accepts
  `CLAUDE_PROJECT_DIR` only when it is an absolute existing directory, not a `.git` pointer file
  (not a linked worktree), not inside a writable root, and not strictly inside the nearest repo of
  cwd. The installed hook wrapper already requires `$CLAUDE_PROJECT_DIR/.claude/hooks/<script>`
  (`claude-native-settings.ts:81`), so the variable is set for every installed hook call.
- Data-structure orientation: `readScratchpadDir` takes a clone **path** and returns a directory
  path or `null`; `trustedWriteRoots` returns `string[]` of realpaths consumed by
  `isTrustedExtraPath(candidate, roots)` (`validate-file-changes.js:192`,
  `bash-write-target-guard.js:1686`). `mainClones` in `trustedWriteRoots` is used only for the
  *overlap protection* (`overlapsProtectedPaths`), where over-protecting with a forged clone is
  harmless, so it keeps the git-derived value.

### New helper `anchoredMainClone(cwd)` (`hook-event-log.js`, exported)

Returns the realpath of the campaign main clone, or `null`. `null` means "no trusted campaign
context": every consumer below narrows, never widens.

1. `project = process.env.CLAUDE_PROJECT_DIR`; require `isHarnessProjectDir(project, cwd,
   [process.env.BLACKHOLE_SCRATCHPAD_DIR])`. The writable-roots argument deliberately excludes
   anything read from a config file (circular) and the assigned root (derived from the config);
   the "strictly inside the nearest repo of cwd" and "`.git` is a pointer file" legs of
   `isHarnessProjectDir` already cover a project dir inside the worker's worktree.
2. `anchor = mainCloneRoot(project)` (a project dir that is a subdirectory of the clone also works);
   `mine = mainCloneRoot(cwd)`. Any throw or `null` returns `null`.
3. Return `resolveExistingAncestor(anchor)` iff it equals `resolveExistingAncestor(mine)`; else
   `null`. The git metadata in cwd is only *confirmed* against the anchor, never trusted alone.
4. Memoised per `(cwd, CLAUDE_PROJECT_DIR)` for the process (a hook call is one short process, and
   the helper is called from about six sites).

### Consumers switched to the anchor

| Site | Today | After |
|---|---|---|
| `allWorktreeRoots`, `readCwdDerivedAssignedRoot`, `trustedWriteRoots` scratchpad leg | `readScratchpadDir(mainCloneRoot(cwd))` | `readScratchpadDir(anchoredMainClone(cwd))`, `null` input yields `null` (the `trustedWriteRoots` `mainClone` option is still used for overlap protection only) |
| `campaignStateRoot(cwd)` | state dir of the git-derived clone | state dir of the anchored clone; `null` unanchored |
| `recordEvent` sink and rotation gate | git-derived clone | anchored clone when available (the deny record of a forging worker lands where Triage polls); unanchored keeps today's best-effort git-derived sink, but **rotation runs only when anchored** |
| `shouldDeferToMercure` (condition 4 and the `projectPath` candidate filter) | git-derived clone | anchored clone; `null` means do not defer (stay active, the guard's own fail-closed doctrine) |
| `campaignWorktreeRoot` (#1349) `campaignStateRoot(dir)` gate | existence of the entry's clone config | unchanged in effect: the entry comes from a source the worker cannot write and already needs the back-link check; it mints no trust from the config's *content*. Documented, not changed |

Unchanged on purpose: `worktreeRoot`, the `isUnderRoot(root, mainClone)` filter and back-link
admission of worktrees in `allWorktreeRoots` (a forged clone can only admit roots under itself or
worktrees whose own `.git` it cannot rewrite), and `git-main-clone-guard.js`.

### Behaviour change to state loudly

Without a valid `CLAUDE_PROJECT_DIR` (non-harness use, or a project dir that is itself a linked
worktree), the config scratchpad, the state-dir trust and the sibling defer are closed. The payload
`scratchpad_dir`, `BLACKHOLE_SCRATCHPAD_DIR` and the user settings route keep working. A session
whose cwd is in repo B's worktree with `CLAUDE_PROJECT_DIR` naming repo A no longer reads B's
config either (narrower; cross-repo writes via declared `additionalDirectories` are unaffected).

## Decision Record

- **Context**: git metadata in a worker-writable tree decides which directory's `config.json`
  becomes trust input.
- **Alternatives**:
  - (a) Structural validation of the git-derived clone (back-link, `.git` is a directory, not under
    the scratchpad). Rejected: a forged clone can fake every structural fact, and B needs the
    scratchpad location, which is not always known.
  - (b) Orchestrator-set env var naming the main clone. Rejected: env does not reach natively
    dispatched workers (the existing Pattern C finding quoted in `readCwdDerivedAssignedRoot`).
  - (c) **Harness project dir as anchor, git metadata only confirmed against it** (chosen).
    Reuses #1349's `isHarnessProjectDir`; the harness sets the variable, a worker cannot.
  - (d) Install-time constant baked into the generated hook wrapper. Stronger on a moved clone but
    a second source of truth and a build/installer change; kept as the fallback if Task 0 shows
    `CLAUDE_PROJECT_DIR` unusable for workers.
- **Harder alternative named**: the OS-level sandbox (#1357, owner decision 21): read-only
  `.blackhole` and no write outside the worktree enforced by the kernel, so no path-trust parsing
  is needed at all. Rejected for this PR: it is a separate evaluation with platform support limits,
  and until it lands the hook anchor is the only enforcement on the config route.
- **Rationale**: the cost is a closed config route when the anchor is absent; the benefit is one
  small auditable predicate and no trust derived from a file the worker writes.
- **Confidence**: Medium-High; the open unknown is the worker's real `CLAUDE_PROJECT_DIR` (Task 0).

## Threat Model (STRIDE; `security_review_required: true`)

| Threat | Description | Severity | Mitigation | Status |
|---|---|---|---|---|
| Spoofing | Worker forges `.git` metadata (B, C, D) so a clone it controls poses as the campaign main clone | Critical | Clone must equal the anchor derived from `CLAUDE_PROJECT_DIR`; cases A-D DENY in Write and Bash | Mitigated |
| Tampering | Forged `config.json` `scratchpad_dir` grants a write root over the real main clone or sibling worktrees; forged state dir | Critical | Config route reads only the anchored clone; unanchored yields no scratchpad and no state root | Mitigated |
| Repudiation | Forged clone redirects deny records away from the Triage-polled `hook-events` dir | High | `recordEvent` sink prefers the anchored clone; test asserts the record lands there | Mitigated |
| Information Disclosure | Reads were never contained; unchanged | Low | none | Accepted Risk |
| Denial of Service | Extra `git rev-parse` calls per hook | Low | Memoised per process; two git calls total | Mitigated |
| Elevation of Privilege | Worker makes `CLAUDE_PROJECT_DIR` point at a clone it controls | High | Not settable by a worker's tool call (harness env); `isHarnessProjectDir` rejects a pointer-file or in-worktree project dir; a worker able to write the real main clone by unguarded means is the #1357 sandbox's job | Accepted Risk (residual) |

## Touch-Paths

- `templates/hooks/pretooluse/utils/hook-event-log.js` (add and export `anchoredMainClone`; switch
  the consumers in the table; update the `mainCloneRoot`, `readScratchpadDir`, `campaignStateRoot`
  docstrings)
- `templates/hooks/pretooluse/utils/sibling-plugin-guard.js` (condition 4 and candidate filter)
- `templates/hooks/pretooluse/README.md` (anchor rule, the loud behaviour change)
- `src/references/hook-schemas.md` (the sentences describing main-clone and `scratchpad_dir`
  resolution), `src/references/config-template.md` (`scratchpad_dir` row: read from the anchored
  clone only)
- `scripts/hooks-anchored-main-clone.test.ts` (new)
- Existing specs whose fixtures rely on a config route without `CLAUDE_PROJECT_DIR` get that
  variable set to the fixture's main clone through the existing `claudeProjectDir` parameter of
  `runPreToolUseHook` (`scripts/lib/test-fixtures.ts`): `scripts/hooks-state-dir-trust.test.ts`,
  `scripts/hooks-trusted-write-roots.test.ts` (config leg), `scripts/hooks-validate-file.test.ts`,
  `scripts/hooks-validate-bash.test.ts`, `scripts/hooks-sibling-plugin-health.test.ts`,
  `scripts/lib/test-fixtures.ts`
- Plus all generated dist trees per `scripts/lib/build/targets.ts` (regenerated by `bun run build`,
  never hand-edited). `package.json` version bump per `V-PLUGIN-01` (a `templates/hooks/**` change)
  unless the owner waives it as for #1296.

## Documentation Impact

The hook README, `hook-schemas.md` and the `config-template.md` row above. No new doc files;
`documentation/INDEX.md` is not regenerated by this plan.

## Critical Files

- `templates/hooks/pretooluse/utils/hook-event-log.js`
- `templates/hooks/pretooluse/utils/sibling-plugin-guard.js`
- `templates/hooks/pretooluse/validate-file-changes.js`
- `templates/hooks/pretooluse/utils/bash-write-target-guard.js`

## Codebase Conventions

CommonJS hook modules, `'use strict'`; reuse `isHarnessProjectDir`, `mainCloneRoot`,
`resolveExistingAncestor`, `isUnderRoot`, `readScratchpadDir` (V-INT-02: no second validity
predicate). Tests are `bun test` files that spawn the real hook with a JSON payload
(`hooks-trusted-write-roots.test.ts` `spawnHook`/`withWorld` shape); Write and Bash verdicts are
asserted equal through one table. One canonical rationale comment on `anchoredMainClone`, callers
cite it by name (no issue numbers in source comments).

## Task Breakdown (test first; CI verifies, only the one focused spec runs locally via `with-test-lock`)

0. **Probe, no code.** Print `CLAUDE_PROJECT_DIR`, cwd and the assigned worktree for a PreToolUse
   call made by a native `Agent`-dispatched worker (worktree isolation and a scratchpad worktree)
   and by a main-clone session. **AC**: the PR body quotes the three observed
   `CLAUDE_PROJECT_DIR` values; if a worker's value is its own worktree, stop (see Stop Conditions).
1. **Failing tests first**, `scripts/hooks-anchored-main-clone.test.ts`, every case run through
   Write and Bash with one verdict table. **AC**: the file is red on `de2a9f34`'s hooks for the
   DENY cases and green on the head; cases:
   - Must-DENY (each with `CLAUDE_PROJECT_DIR` = real main and unset), forged config
     `scratchpad_dir` = real main, target an untracked file in the real main clone and, separately,
     a sibling campaign worktree: A (clone inside the worktree), B (clone and admin dir in the
     scratchpad), C (planted `W/sub/.git`, cwd `W/sub`), D (cwd in a real nested repo carrying the
     config).
   - Must-DENY: `CLAUDE_PROJECT_DIR` naming a linked worktree, a path inside the worker's worktree,
     a forged nested repo, a relative or missing path (anchor rejected, config route closed).
   - Must-ALLOW (unchanged): worker in `<main>/.claude/worktrees/wt-N` and worker in a scratchpad
     worktree, project = main: config `scratchpad_dir` and `.blackhole/plans/x.md` writes; a
     main-clone session; project dir a subdirectory of the main clone; cross-repo declared worktree
     via HOME settings (the #1349 cases); `BLACKHOLE_SCRATCHPAD_DIR` and payload `scratchpad_dir`
     with no project dir; a submodule cwd inside a worker worktree (same verdict as on `de2a9f34`).
   - Pinned narrowing: cwd in repo B's worktree with project = A denies B's config scratchpad.
   - Audit trail: under B with a valid anchor, the deny record is in the real main clone's
     `.blackhole/hook-events`, none in F's.
   - Sibling guard: forged clone without config and a healthy mercure fixture does not defer.
2. **Implement `anchoredMainClone`** and switch `readScratchpadDir` callers and
   `campaignStateRoot`. **AC**: the A-D, project-dir and legit-layout cases above green; grep shows
   no `readScratchpadDir(` call fed by raw `mainCloneRoot(` output.
3. **Switch `recordEvent` and `sibling-plugin-guard.js`.** **AC**: audit-trail and sibling cases
   green; rotation test shows no sweep when unanchored.
4. **Repair existing fixtures** by setting `claudeProjectDir`. **AC**: the existing specs listed in
   Touch-Paths pass unchanged in assertions (only fixture env differs); the diff of those files
   contains no changed `expect`.
5. **Docs and build.** **AC**: `bun run build` output committed with no hand edits; README,
   `hook-schemas.md` and `config-template.md` state the anchor rule and the no-anchor narrowing;
   PR body states the `V-PLUGIN-01` outcome and the stale-cache consequence.
6. **Head-vs-main differential.** **AC**: the PR body records the new spec's verdict table twice,
   run once against `templates/hooks/pretooluse` of `origin/main` (checked out to a separate
   directory and passed through a `HOOKS_DIR` override the spec reads) and once against the head:
   B, C, D are ALLOW on main and DENY on head; every legit-layout row is identical on both.

## Execution Strategy & Stop Conditions

- If Task 0 shows a worker's `CLAUDE_PROJECT_DIR` is its own worktree or unset, then stop and
  return to the owner: the anchor alternative (d) (install-time constant) replaces (c).
- If any existing campaign-protocol path (worker writing `.blackhole/plans` or `staged`) is denied
  by a legit-layout test, then halt and revert the consumer switch for that site.
- If a legit-layout row differs between main and head other than the pinned B-repo narrowing, then
  revert the change and halt for review.
- If an existing spec needs a changed `expect` (not just fixture env) to pass, then halt: the change
  has widened scope.
- If the diff needs an edit in `validate-file-changes.js` or `bash-write-target-guard.js`, then stop
  and justify it in the PR body before continuing.

## Sprint Contract

Each task's AC above is the definition of done; additionally CI green on the pushed head (job name
and status quoted as evidence). No full suite locally.

## Quality Gate Results

- touch_paths_declared: PASS
- schema_baseline: PASS (no schema change)
- ac_mapping: PASS (every task carries an AC)
- critical_files_exist: PASS (all four exist on `de2a9f34`; the new spec is listed under Touch-Paths only)
- mitigation_concrete: PASS (each stop condition is "if X then stop/halt/revert")
- ADVISORY: `plan-quality-gate.ts` was not run here (read-only planning on a recovering workstation); the implementer runs it.
