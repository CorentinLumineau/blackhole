---
type: plan
summary: "Plan for letting an orchestrator-class caller write the campaign state dirs of its own and declared main clones from a linked-worktree cwd, with workers, config.json, hook-events and settings files still denied"
status: current
review_trigger: "on ADR acceptance"
created: 2026-11-26
last_updated: 2026-11-26
related:
  - documentation/decisions/ADR-064-orchestrator-scoped-campaign-state-write-trust.md
---

# Plan - Issue #1370

## Objective
A Pattern C orchestrator (main chat with no `agent_type`, or `agent_type` `orchestrator`/`coordinator`) whose cwd is a linked worktree must be able to make single-file campaign-state writes into the `.blackhole/` of every main clone in its campaign scope (its own clone, and clones named in `permissions.additionalDirectories`), without relying on the variable-target parser gap and without widening what workers (`implementer`, `reviewer`, `planner`, `router`, `investigator`, `hunter`, any other `agent_type`) may write. "Bootstrap refuses up front" is rejected as the primary fix: the Claude desktop session cannot change its own folder, so a refusal makes the mode unusable. It stays only as the remedy text for a caller the grant does not cover.

Root cause to confirm first (V-FIX-01): `trustedWriteRoots` (`templates/hooks/pretooluse/utils/hook-event-log.js`) admits only linked worktrees of other repos, never another repo's main-clone `.blackhole/`; `campaignStateRoot` reads only the anchored main clone, and README "Campaign state dir trust" says a cwd in a repo other than the project dir's clone grants nothing. The own-clone case should already fall back to `mainCloneRoot(cwd)`; Task 2 pins by failing tests which of three scenarios actually deny, so the fix targets observed behaviour.

This plan was itself blocked by the bug: the planner (cwd in a monorepo worktree) was denied `[bash-outside-assigned-worktree]` and `[outside-assigned-worktree]` writing `.blackhole/plans/issue-1370.md`, so this file lives in the session scratchpad and must be installed by the orchestrator.

## Touch-Paths
- `templates/hooks/pretooluse/utils/hook-event-log.js`
- `templates/hooks/pretooluse/utils/campaign-scope.js`
- `templates/hooks/pretooluse/validate-file-changes.js`
- `templates/hooks/pretooluse/utils/bash-write-target-guard.js`
- `templates/hooks/pretooluse/README.md`
- `src/references/hook-schemas.md`
- `src/references/orchestrator-dispatch.md`
- `scripts/hooks-orchestrator-state-trust.test.ts` (new)
- `scripts/hooks-trusted-write-roots.test.ts`
- `package.json` (version bump, V-PLUGIN-01: the diff touches `templates/hooks/**`)
- plus all generated dist trees per `scripts/lib/build/targets.ts`

## Documentation Impact
- `templates/hooks/pretooluse/README.md` sections "Campaign state dir trust" and "Trusted write roots": orchestrator-scoped state roots, caller predicate, unchanged protected set.
- `src/references/hook-schemas.md`, `src/references/orchestrator-dispatch.md`: remedy text for a denied orchestrator caller.
- New ADR-064 (staged, carried by the implementer) plus its `documentation/decisions/INDEX.md` row: records the orchestrator-only grant. It amends the trust allow-list inside ADR-047's scope model and reverses no accepted decision; the README stays the allow-list SSOT. Search-before-write: no existing `documentation/` doc covers an orchestrator-only grant.

## Critical Files
- `templates/hooks/pretooluse/utils/hook-event-log.js`
- `templates/hooks/pretooluse/utils/bash-write-target-guard.js`
- `templates/hooks/pretooluse/validate-file-changes.js`
- `templates/hooks/pretooluse/utils/campaign-scope.js`

## Codebase Conventions
- One resolver, two guards: `trustedWriteRoots` is the single place that names extra roots, called by both the Write/Edit hook and the Bash guard (V-INT-02/V-DRY-01). The new grant is one function in `hook-event-log.js` called from both.
- Reuse the state-dir allow-list: `isStateDirTrustedPath` (protects `config.json`, `hook-events/`, `archive/hook-events-*`, root, `archive/`; no `..`; realpath inside root; plain leaf) and the two Bash shapes in `utils/state-dir-write-shape.js` (redirect/`tee`; single-file `cp`/`mv`/`install`, `mv` source itself trusted). `isTrustedShapedWrite` already takes a path predicate, so a new root needs a predicate, not a new shape.
- Caller discrimination reuses `bareAgentType` / `CAMPAIGN_AGENT_TYPES` in `campaign-scope.js`; payload field `agent_type` is set by Claude Code only inside a subagent.
- Settings sources reuse `considerDeclared`, `isHarnessProjectDir`, `MAX_EXTRA_ROOT_CANDIDATES`; nothing derived from git metadata a worker can write.
- Tests follow `scripts/hooks-state-dir-trust.test.ts` and `scripts/hooks-anchored-main-clone.test.ts`.

## Database/API Schema Changes
None. No JSON contract, config key, queue or ledger field changes (V-API-01 n/a). Deny `pattern_id`s are unchanged; only the allow decision widens for one caller class.

## Design (decision record)
- Context: orchestrator in a worktree is denied state writes to main-clone `.blackhole/`; workers must stay contained.
- Alternatives: (A) refuse bootstrap from a worktree cwd (unusable on desktop, and fails mid-run today); (B) trust every campaign-scoped caller's cross-repo state dirs (widens every worker to every repo's queue/ledger, rejected); (C) trust only a caller with `agent_type` absent or `orchestrator`/`coordinator`, same allow-list and protected set (chosen); (D) leave as is and write state only through scripts (rejected: makes the variable-target WARN gap the only path, the issue's complaint).
- Choice: C. Roots granted: the own clone's state dir (anchored, else fallback), plus `stateRootOf` of each main clone that is a `permissions.additionalDirectories` entry (or whose `.blackhole` or a child of it is), read only from the user settings file and the harness project dir's settings, capped at `MAX_EXTRA_ROOT_CANDIDATES`.
- Rationale: smallest grant that removes the parser-gap incentive; a worker is unaffected because its `agent_type` is set.
- Confidence: Medium. Depends on the main session payload carrying no `agent_type` and on spawned workers (including workflow-spawned) carrying one.
- Out of scope: `main-clone-restore` (`git restore -- .blackhole/queue.json`, `git-main-clone-guard.js`) and orchestrator Edit of `config.json`, which stays protected for every caller. Owner ruling 2026-11-26 (design approved): `.blackhole/config.json` edits and `git restore` of tracked state stay out of scope for every caller; the implementer files a follow-up issue and cites it in the PR body.

## Threat Model
| STRIDE | Threat | Severity | Mitigation status |
|---|---|---|---|
| Spoofing | A worker presents no `agent_type` to gain the grant, or plants a clone or `.git` pointer to mint a state root | High | Mitigated: `agent_type` is set by the harness in every subagent; roots come only from the user settings file and a project dir a worker cannot write, never from worktree git metadata; a forged clone disagreeing with the anchor grants nothing. Tests: `implementer`, unknown type and planted `.git` all denied |
| Tampering | Orchestrator-class caller rewrites `config.json`, `hook-events/`, settings files, or swaps a link | High | Mitigated: same `isStateDirTrustedPath` and shape allow-list; `bash-settings-roots-write` runs first; symlink and hard-link leaves refused |
| Repudiation | Cross-repo state writes leave no trace | Low | Accepted Risk: allowed writes record nothing today (same as the own-clone grant); deny records remain the audit trail |
| Information Disclosure | None: write guard only | Low | Mitigated: no read path changes |
| Denial of Service | Many `additionalDirectories` entries stall the hook | Low | Mitigated: reuse the 16-entry cap and cheap-checks-before-git ordering |
| Elevation of Privilege | A subagent of an unlisted type (e.g. `general-purpose`) inherits orchestrator rights; or the grant reaches a repo with no campaign | High | Mitigated: grant requires `agent_type` absent or exactly `orchestrator`/`coordinator`; root requires `.blackhole/config.json` and a non-broad realpath; a clone absent from the owner's settings gets nothing |

## Execution Strategy & Stop Conditions
- Run no suite locally (CI-first, memory under 3500 MB): only `scripts/hooks-orchestrator-state-trust.test.ts` and the touched hook test files, one at a time through `with-test-lock`.
- If the focused tests show any worker payload (non-empty `agent_type`, or `BLACKHOLE_ASSIGNED_WORKTREE` set) receiving the grant, then halt and revert the change to `hook-event-log.js`.
- If the real Pattern C main-session payload carries a non-empty `agent_type`, then abort this design and return the plan for revision.
- If the fix would need the grant to include `config.json` or `hook-events/`, then stop and return the plan to the owner.
- If `bun run build` changes files outside the declared dist trees, then stop and report instead of hand-editing generated files.

## Task Breakdown
- [ ] **TDD Baseline Verification**: run `hooks-state-dir-trust`, `hooks-trusted-write-roots`, `hooks-anchored-main-clone` scoped through `with-test-lock`. — **AC**: pass/fail counts quoted in the completion evidence.
- [ ] **Write failing tests** in `scripts/hooks-orchestrator-state-trust.test.ts` for S1 cwd = own linked worktree with project dir = that worktree; S2 cwd = own worktree with project dir = main clone; S3 cwd = another repo's campaign worktree with its main clone in `additionalDirectories`. Each runs `mv <tmp> <main>/.blackhole/queue.json` and a Write of `plans/issue-1.md` for a no-`agent_type` payload and an `orchestrator` payload. — **AC**: tests exist and the scenarios the live bug affects fail with `bash-outside-assigned-worktree` / `outside-assigned-worktree` before the fix; the failing set is recorded in the PR body.
- [ ] **Negative tests** in the same file: `agent_type` `implementer`, `reviewer`, `planner`, `general-purpose`; `BLACKHOLE_ASSIGNED_WORKTREE` set; `config.json`; `hook-events/`; a directory destination; a symlink leaf; a planted `.git` pointer; a main clone not in settings; a settings file target. — **AC**: every case is denied with its named `pattern_id` before and after the fix.
- [ ] **Implement `orchestratorStateRoots(cwd, input, ctx)`** in `hook-event-log.js` and `isOrchestratorCaller` in `campaign-scope.js`; export both. — **AC**: returns `[]` for any worker or unknown `agent_type` and for a missing or forged anchor, asserted in `hooks-trusted-write-roots.test.ts`.
- [ ] **Wire both guards** (`validate-file-changes.js`, `bash-write-target-guard.js`) to accept a path trusted under any orchestrator state root through the existing allow-list, adding no shape. — **AC**: the failing-test scenarios pass, negative tests still pass, and `git diff` shows no change to `ALLOWED_FLAGS` or `FILE_WRITE` handling.
- [ ] **Docs**: update README, `hook-schemas.md`, and the remedy text in `orchestrator-dispatch.md`. — **AC**: `grep -n "orchestrator" templates/hooks/pretooluse/README.md` shows the caller predicate and the unchanged protected set; generated trees match `src/` after `bun run build` (verified on CI).
- [ ] **Version bump** `package.json` (V-PLUGIN-01) and rebuild. — **AC**: CI `verify` green on the pushed head, job name and status quoted.
- [ ] **File follow-up issue** for `main-clone-restore` and orchestrator `config.json` writes (owner ruled them out of scope 2026-11-26). — **AC**: PR body cites the new issue number.
- [ ] **Verify Integrity**: lint/typecheck changed files locally, full suite on CI only. — **AC**: CI result for the pushed head quoted.

## Sprint Contract
- Orchestrator-class callers can do single-file state writes (Write/Edit of non-protected files, redirect/`tee`, single-file `cp`/`mv`/`install`) into the state dir of their own clone and declared campaign clones from a linked-worktree cwd.
- No worker `agent_type` gains any write it lacked; `config.json`, `hook-events/` and settings files are denied for every caller.
- Every task meets its AC; touched files stay inside Touch-Paths (V-SCOPE-02).

## Quality Gate Results
| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS (no schema change) |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |
| `ac_sweep_conflict` | PASS |
| `ac_sweep_scope` | PASS |
| `touch_paths_ssot_gap` | PASS |
| `ac_facts_literal_bump` | PASS |
