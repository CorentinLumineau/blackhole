---
type: plan
summary: "Standard-track plan for issue #907 -- readAssignedWorktreeRoot gains a cwd-derived containment tier closing the Pattern C gap; design-aggregate.ts blocked on dominance only, owner-ruled per ADR-045"
status: current
review_trigger: "on ADR-045 acceptance"
created: 2026-09-06
last_updated: 2026-09-07
related: [decisions/ADR-045-cwd-derived-worker-write-containment.md, decisions/ADR-029-bash-write-target-worktree-containment.md, decisions/ADR-043-main-clone-git-mutation-guard.md]
---


# Plan: issue #907 — cwd-derived worker write containment (Pattern C channel closure)

## Objective

`readAssignedWorktreeRoot` currently narrows Write/Edit/Bash write-target containment to a single
assigned worktree only when `BLACKHOLE_ASSIGNED_WORKTREE` is set — an env var that never reaches a
worker dispatched via the native `Agent`/`Workflow` tool under Pattern C (`claude-code-native.md`),
confirmed by a zero-occurrence `pattern_id: outside-assigned-worktree` event corpus and by this
session's own live environment. Add a new, additive cwd-derived resolution tier: when the env var
is unset/invalid and the PreToolUse payload's `cwd` resolves inside a linked (non-main) worktree,
that worktree becomes the sole assigned root — no declaration needed. Correct
`orchestrator-dispatch.md`'s export contract, which currently reads as binding and has never once
fired. Full design: `documentation/decisions/ADR-045-cwd-derived-worker-write-containment.md`
(staged this session at `.blackhole/staged/907/`), analysis at
`.blackhole/plans/issue-907-design.md`.

## Pareto gating

Gain 8 × (11 − Effort 4) = 56 ≥ 30 (`V-PARETO-03`). Gain is high — this is a live containment hole
with two recorded incidents (`F-00034`, and this issue's own newly-confirmed live near-miss on
`wt-903`). Effort is low-mid: the mechanism is one new branch reusing existing primitives
(`worktreeRoot`, `mainCloneRoot`, `isUnderRoot`), plus tests and two doc corrections; the design
work is already done this session.

## Touch-Paths

- `templates/hooks/pretooluse/utils/hook-event-log.js` — `readAssignedWorktreeRoot`'s new tier
- `scripts/hooks-validate-file.test.ts` — new cwd-derived-tier coverage
- `scripts/hooks-validate-bash.test.ts` — new cwd-derived-tier coverage (Bash write-target path)
- `package.json` (`version` — `V-PLUGIN-01`, same diff as the `templates/hooks/**` change)
- `src/references/orchestrator-dispatch.md` — correct the export contract (issue AC1) — plus all
  generated dist trees per `scripts/lib/build/targets.ts`
- `src/references/hook-schemas.md` — correct the `outside-assigned-worktree`/
  `bash-outside-assigned-worktree` prose to name the new derivation tier — plus all generated
  dist trees per `scripts/lib/build/targets.ts`
- `documentation/decisions/ADR-045-cwd-derived-worker-write-containment.md`,
  `documentation/decisions/INDEX.md` — carried from `.blackhole/staged/907/` by the implementer's
  carry-step (ADR-021 D2), not authored directly by implement
- `ARCHITECTURE.md` — `## Active Constraints` bullet carried from staging (ADR-012 E3 Trigger A)
- `documentation/plans/plan-hooks-blackhole-assigned-worktree-is-unreachable-under-pattern-c-worktree-contai.md`,
  `documentation/INDEX.md` — durable plan body update, carried from staging (ADR-021 D3)

## Documentation Impact

`docs_governance.enabled: true`.

- `src/references/orchestrator-dispatch.md` § Implementer assigned-write-root env — corrected
  in this diff (Task 1, issue AC1): state that `export` does not survive between subagent
  spawns/`Bash` calls and the native `Agent`/`Workflow` tool has no environment channel; describe
  the new cwd-derived tier as the actual reachable mechanism; keep the env-var leg documented as
  the Pattern-B/manual precedence tier, unchanged.
- `src/references/hook-schemas.md` `outside-assigned-worktree`/`bash-outside-assigned-worktree`
  prose (lines ~169, ~183) — extend to name the cwd-derived tier as a second path to the same
  `pattern_id` values (not a new `pattern_id`; the deny reason is the same, only the resolution
  source changes).
- **New file**: `documentation/decisions/ADR-045-cwd-derived-worker-write-containment.md`.
  Search-before-write performed: no existing ADR covers this specific channel decision.
  ADR-029 covers Bash write-target *containment semantics* (assuming a root is already known);
  ADR-043 covers the unrelated main-clone *git-command* guard; neither decides *how the assigned
  root is derived*. Number verified free against `origin/main` (`ls documentation/decisions/`,
  highest existing is `ADR-044`) and every `.blackhole/staged/*/manifest.json` at plan time.
- `documentation/decisions/INDEX.md` — append row (staged; carried by implementer).
- **Update in place**: `documentation/plans/plan-hooks-blackhole-assigned-worktree-is-unreachable-
  under-pattern-c-worktree-contai.md` already exists for this exact concern (from the prior
  design cycle) — search-before-write found it via `documentation/INDEX.md:89`. This diff
  replaces its content with the resolved plan (this file's durable form) rather than creating a
  new file, and corrects its now-stale "blocked verdict pending an owner ruling" summary. Its
  `documentation/INDEX.md` row is likewise updated in place, not duplicated — **caveat**: the
  carry-step's `append_row` primitive is documented as `appendIndexRowIfAbsent`
  (`blackhole-state.md` § Sync/INDEX row order), i.e. it may skip a row whose `path` already
  exists rather than refreshing its `summary` text; if so, a follow-up manual correction of that
  one row is needed post-merge (flagged here rather than silently assumed to work).
- `ARCHITECTURE.md` `## Active Constraints` — new bullet citing `(ADR-045)` (staged; carried by
  implementer; Cross-Cutting Heuristic Trigger A scored 3/3: Breadth — governs both the
  Write/Edit and Bash write-target guard subsystems; Enforcement stakes — a BLOCK-severity
  `pattern_id` (`outside-assigned-worktree`/`bash-outside-assigned-worktree`); Foreclosure — rules
  out any future containment mechanism keyed on caller-declared state).

## Critical Files

- `templates/hooks/pretooluse/utils/hook-event-log.js`
- `templates/hooks/pretooluse/validate-file-changes.js`
- `templates/hooks/pretooluse/utils/bash-write-target-guard.js`
- `package.json`

## Codebase Conventions

Analysis note `plans/issue-907-analysis.md` does not exist; conventions discovered directly plus
carried from the Design Track note (`.blackhole/plans/issue-907-design.md`).

| Concern | Established pattern | Where |
|---|---|---|
| Containment comparison | `isUnderRoot`/realpath-based, never a fresh path comparison (`V-INT-02`) | `hook-event-log.js` |
| Worktree/repo-identity resolution | `worktreeRoot(cwd)`, `mainCloneRoot(cwd)` — never re-derive via a fresh `git` shell-out pattern | `hook-event-log.js` |
| Degradation posture | Fail **open** on an unrecognized/absent declaration (stderr notice, fall back to a broader containment tier); fail **closed** only on an unreadable containment state | `readAssignedWorktreeRoot`, `allWorktreeRoots`, `failClosed` |
| cwd resolution precedence | `input.cwd \|\| process.cwd()` — the harness-supplied payload field, never the hook subprocess's own `process.cwd()` (#507) | `validate-file-changes.js:53`, `bash-write-target-guard.js` |
| Structural-identity-over-declared-state | Key containment/refusal decisions on repo/path identity resolved at hook time, never on a caller-declared env var (ADR-043, extended here as ADR-045) | `git-main-clone-guard.js`, this diff |
| Scratchpad-root inclusion | Always union validated scratchpad roots into any containment root set — never drop them when narrowing (#510/#729) | `allWorktreeRoots` |
| Hook test harness | `runPreToolUseHook(script, payload, cwd, hooksDir, eventDir, assignedWorktree)` spawns the real hook with a JSON payload on stdin; `cwd` and `assignedWorktree` are already distinct parameters | `scripts/lib/test-fixtures.ts:96-124` |
| Event record `pattern_id` reuse | A new resolution path to an existing refusal reuses the existing `pattern_id` (`outside-assigned-worktree`) rather than minting a new one, when the refusal reason is unchanged | `hook-schemas.md`'s `pattern_id` table |

## Threat Model

`route.security_review_required: true`. Six STRIDE rows.

| Category | Threat | Severity | Mitigation status |
|---|---|---|---|
| Spoofing | A worker forges its own assignment to widen its write scope | High | **Mitigated by design** — `cwd` is harness-supplied on the PreToolUse payload (same trust class as `tool_name`, per the existing `#507` precedent this diff cites, not asserts fresh), not a field the worker's own tool-call arguments set, unlike an env var it could `export` |
| Tampering | A worker rewrites the assignment source to widen its own scope | High | **Mitigated by design** — there is no assignment-source file to tamper with; the assigned root is derived structurally from `cwd`, not read from a writable declaration |
| Repudiation | A refusal happens but leaves no ingestible record | Medium | **Mitigated** — reuses the existing `denyAndRecord` path unchanged; `.blackhole/hook-events/` records the same `pattern_id`, ingested by Triage as before |
| Information Disclosure | The assignment source leaks worktree paths | Low | **Accepted risk**, unchanged from today — paths are already in `queue.json` and event records |
| Denial of Service | A wrong or stale derivation denies a worker's legitimate writes and stalls it unattended | High | **Mitigated** — the new tier only narrows when `cwd` resolves to a *linked, non-main* worktree; cwd resolving to the main clone (the orchestrator's/`planner`'s/`investigator`'s/`hunter`'s legitimate case) falls through unchanged to today's `allWorktreeRoots` behaviour — verified by Task 6's explicit regression test |
| Elevation of Privilege | A subagent obtains write access to a root it was never assigned | High | **Mitigated** for the Write/Edit and Bash write-target paths (this diff's scope) — closes the reported live incident class. **Not addressed**: main-clone role-sub-scoping (narrowing `planner`/`investigator` to only `.blackhole/plans/`+`.blackhole/staged/`) stays open, a disclosed, deliberate YAGNI boundary, not a regression |

## Dependency Blast-Radius

8 affected consumers found via `git grep -n "readAssignedWorktreeRoot\|BLACKHOLE_ASSIGNED_WORKTREE"` (≥3, section required). Full table with rationale: `.blackhole/plans/issue-907-design.md` § 6 / ADR-045 § Refactoring Impact Analysis.

| Consumer (file:line) | Classification | Note |
|---|---|---|
| `templates/hooks/pretooluse/validate-file-changes.js:110` | TRANSPARENT | Already branches opaquely on assigned-root present/absent |
| `templates/hooks/pretooluse/utils/bash-write-target-guard.js:293` | TRANSPARENT | Same opaque branch, reused unmodified |
| `scripts/hooks-validate-file.test.ts:700-760` | TRANSPARENT | Env-var-set assertions unaffected; new tier fires only when env var unset |
| `scripts/hooks-validate-bash.test.ts:2960-3160` | TRANSPARENT | Fail-open-parity test at `:3156` uses a cwd not inside a linked worktree fixture |
| `scripts/lib/test-fixtures.ts:96-124` | TRANSPARENT | `runPreToolUseHook` already threads `cwd` distinct from `assignedWorktree`; no signature change |
| `documentation/decisions/ADR-043-main-clone-git-mutation-guard.md` / `git-main-clone-guard.js` | TRANSPARENT | Confirmed zero call-site overlap by grep — keys on repo identity directly |
| `src/references/orchestrator-dispatch.md` | Corrected in this diff | Not an external consumer |
| `src/references/hook-schemas.md` | Corrected in this diff | Not an external consumer |

Zero BREAKING rows — no external, un-owned consumer's current passing assertion changes outcome.

## Execution Strategy & Stop Conditions

- **If the red-before-green test (Task 3) does not fail against `plan_base_commit`** (i.e. the
  main-clone write from a worktree-cwd worker is already denied without the fix), **abort** — the
  premise is wrong and the issue needs re-diagnosis, not this implementation.
- **If the new regression test asserting main-clone-cwd behavior is unchanged (Task 5) fails,
  revert the new tier** — a false narrowing that blocks the orchestrator's/`planner`'s/
  `investigator`'s/`hunter`'s own legitimate `.blackhole/` writes is worse than the bug this issue
  fixes.
- **If any change lands under `templates/hooks/**` without `package.json`'s `version` changing in
  the same diff, stop and add it** — `V-PLUGIN-01` is a BLOCK.
- **If `git grep -n "first shell command in the session" src/references/orchestrator-dispatch.md`
  still matches after Task 1, stop and rewrite the section** — the AC is a literal grep-to-zero
  check with no exemptions, scope `src/references/` only.
- **If `bun test` or `bun run verify` regresses on any file outside this plan's Touch-Paths,
  revert the offending edit** — scope discipline (`V-SCOPE-02`) over speed.

## Task Breakdown

1. **Red test first — cwd-derived containment gap** (TDD red). Add a test to
   `scripts/hooks-validate-file.test.ts` driving `runPreToolUseHook` with a payload whose `cwd` is
   a fixture linked (non-main) worktree and whose Write target resolves to the fixture main
   clone, with `BLACKHOLE_ASSIGNED_WORKTREE` unset. Assert the write is **denied**,
   `pattern_id: outside-assigned-worktree`. — **AC**: the test fails (write allowed) when run
   against `plan_base_commit` (`git stash` this task's own hook-file change and re-run, or check
   out `plan_base_commit` in a scratch clone); the failing output is captured verbatim for the PR
   body (`V-UNFALSIFIABLE-01`).
2. **Red test — Bash write-target parity**. Add the mirrored test to
   `scripts/hooks-validate-bash.test.ts`: same fixture shape, a write-shaped Bash command (e.g.
   `sed -i` or `>`) targeting the main clone from a worktree-cwd payload, env var unset. Assert
   `pattern_id: bash-outside-assigned-worktree`, block tier. — **AC**: fails against
   `plan_base_commit` the same way as Task 1; failing output captured.
3. **Implement the cwd-derived tier** (TDD green). In
   `templates/hooks/pretooluse/utils/hook-event-log.js`, extend `readAssignedWorktreeRoot(cwd)`
   with the new middle branch: when the env var is unset/invalid, call `worktreeRoot(cwd)`; if it
   resolves and is not `mainCloneRoot(cwd)`, return that worktree (unioned with the same validated
   scratchpad-root inclusion `allWorktreeRoots` performs) as the sole assigned root. Cite `#507`'s
   existing cwd-trust precedent in the new code's docstring (per Critic B's finding) rather than
   asserting it fresh. — **AC**: Tasks 1 and 2's tests now pass.
4. **Regression: scratchpad-root inclusion preserved**. Add a test asserting that when cwd is
   inside a linked worktree AND a valid `scratchpad_dir`/`BLACKHOLE_SCRATCHPAD_DIR` root is also
   configured, a write to that scratchpad root (outside the worktree itself) is still **allowed**
   under the new narrowed tier — not silently dropped. — **AC**: the test passes with the Task 3
   implementation, and fails if the scratchpad-root union is removed from the new branch.
5. **Regression: main-clone-cwd behavior unchanged** (Critic A's finding). Add a test asserting
   that when `cwd` resolves to the **main clone itself** (the orchestrator's/`planner`'s/
   `investigator`'s/`hunter`'s case), containment behavior is byte-identical to today's
   `allWorktreeRoots(cwd)` fallback — a write anywhere else in the family is still allowed. —
   **AC**: the test passes with the Task 3 implementation, and fails if the new branch is
   accidentally reached for a main-clone cwd.
6. **Correct `orchestrator-dispatch.md`'s export contract** (issue AC1, unconditional). Rewrite
   § Implementer assigned-write-root env: state that `export` does not survive between subagent
   spawns and the native `Agent`/`Workflow` tool has no environment channel to a spawned worker;
   describe the new cwd-derived tier as the actually-reachable mechanism under Pattern C; keep the
   env-var leg documented, scoped to Pattern B / manual use. — **AC**: `git grep -n "first shell
   command in the session" src/references/orchestrator-dispatch.md` returns zero matches. Scope:
   `src/references/` only; no exemptions.
7. **Correct `hook-schemas.md`'s `pattern_id` prose**. Extend the `outside-assigned-worktree`/
   `bash-outside-assigned-worktree` paragraphs to name both resolution paths (env-var tier,
   cwd-derived tier) to the same `pattern_id` values. — **AC**: both paragraphs name the
   cwd-derived tier; `bun run scripts/checks/hooks.check.ts` passes (pattern-data/doc-prose
   consistency, where applicable).
8. **Version bump** (`V-PLUGIN-01`). Bump `package.json` `version` in the same diff. State in the
   PR body that the fix ships inert until the owner runs `/plugin marketplace update` and
   reinstalls (ADR-030 deployment caveat). — **AC**: `git diff --name-only` includes
   `package.json` whenever it includes any `templates/hooks/**` path.
9. **Full verify**. Run `bun test` and `bun run verify` (through `flock`, resource-gated). —
   **AC**: both green; no new findings outside this plan's Touch-Paths.

## Sprint Contract

Each task above carries its own `— **AC**`. Where a task states no narrower criterion, the
definition of done is `bun test` and `bun run verify` green with no new findings.

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS — declared, generated dist trees cited via `scripts/lib/build/targets.ts` rather than hand-enumerated. |
| `schema_baseline` | PASS — no schema/config-key change; the diff reuses the existing `outside-assigned-worktree`/`bash-outside-assigned-worktree` `pattern_id` values, no new field. |
| `ac_mapping` | PASS (`bun run scripts/plan-quality-gate.ts`) — all 9 `## Task Breakdown` items carry a machine-verifiable `— **AC**`. |
| `critical_files_exist` | PASS (`bun run scripts/plan-quality-gate.ts`) — all four `## Critical Files` paths resolve on `plan_base_commit`. |
| `mitigation_concrete` | PASS (`bun run scripts/plan-quality-gate.ts`) — all five `## Execution Strategy & Stop Conditions` bullets pair a condition to an abort/revert/stop action. |
| `design_pending_approval` | **N/A** — `design-aggregate.ts` returned `blocked` (dominance-margin only, unanimous 3/3 winner, no disagreement, no breaking consumer); owner-ruled to proceed under `autonomy.design_autonomy: true`, same override pattern as ADR-029 (see ADR-045 § Gate). Not a live blocker for this plan's `status`. |

ADVISORY: `ac_sweep_scope` — Task 6's grep-to-zero AC states its scope path (`src/references/`)
and an explicit "no exemptions" clause; no finding.
ADVISORY: `touch_paths_ssot_gap` — `src/references/*.md` Touch-Paths cite
`scripts/lib/build/targets.ts` for the generated dist trees rather than hand-enumerating them; no
gap.

## References

- Design note: `.blackhole/plans/issue-907-design.md`
- Verdict: `.blackhole/plans/issue-907-design-aggregate-verdict.json`
- **ADR**: `documentation/decisions/ADR-045-cwd-derived-worker-write-containment.md` — chosen
  approach: cwd-derived single-worktree containment (Option B); rejected: accept-the-limitation
  (Option D), payload-identity keyed map (Option E, falsified by #915's own probe)
- `documentation/decisions/ADR-029-bash-write-target-worktree-containment.md`
- `documentation/decisions/ADR-043-main-clone-git-mutation-guard.md` — precedent for
  structural-identity-over-declared-state containment keys, and for the owner-ruled
  dominance-margin-only override pattern this plan reuses
- `documentation/decisions/ADR-030-plugin-cache-version-bump-gate.md`
- `documentation/decisions/ADR-035-unfalsifiable-control-checklist-item.md`
- Prior cycle's durable plan (updated in place by this diff):
  `documentation/plans/plan-hooks-blackhole-assigned-worktree-is-unreachable-under-pattern-c-worktree-contai.md`
