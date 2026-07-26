---
type: review
status: current
review_trigger: "on ADR-011 change"
created: 2026-07-26
last_updated: 2026-07-26
related:
  - documentation/decisions/ADR-011-routine-resume-confirmation-gate.md
  - documentation/plans/plan-campaign-config-confirmation-gate.md
---

# Review: `feat/campaign-config-confirmation-gate` (d426cc7)

**Verdict: CHANGES REQUESTED** — 1 HIGH, 5 WARN, 3 INFO. Quality gates all pass; the blocking
issue is a functional gap, not a gate failure.

Diff: `main@2c00702...d426cc7`, 34 files (22 generated build outputs excluded from review).

## Quality gates — all green (re-run independently at review time)

| Gate | Result |
|---|---|
| `bun test` | 436 pass, 0 fail, 24 files |
| `bun run build` | exit 0 |
| `bun run verify` | 28/28, exit 0, incl. `✓ V-CONFGATE-01` |
| Working tree | clean (0 dirty files) |

## Findings

| # | file:line | V-code | Severity | Finding |
|---|---|---|---|---|
| 1 | `scripts/campaign-status.ts:495-521` | V-INT-04 | **HIGH** | **The documented gate is not executable.** `coordinator.md` instructs the agent to "Print the current campaign config using `renderConfigSummary` (`scripts/campaign-status.ts`)", but `main()` only ever prints `formatDashboard`, and `bun run status` maps to that. `renderConfigSummary` is exported and unit-tested but has **no CLI entry point** — an agent working through Bash cannot invoke it without ad-hoc `bun -e` eval, or hand-rolling the summary (which would itself be V-INT-02). |
| 2 | `src/references/phase-loop.md:164-171` | V-DOC-04 | WARN | **Fourth entry path not covered.** The post-"Campaign complete" restart is the SSOT text consulted at that transition and names **"the coordinator"** as the actor that re-fires the gate — an actor that does not exist under Pattern C (`claude-code-native.md:22-23`: "no coordinator, no background orchestrator agent"). `phase-loop.md` contains **zero** mentions of Pattern C or "foreground orchestrator" (verified by grep). The new `claude-code-native.md` § Bootstrap gate ownership arguably covers it via "every `run`-mode campaign start", but that reassignment is never cross-referenced at the point of use. |
| 3 | `documentation/plans/plan-campaign-config-confirmation-gate.md:44-96` | V-DOC-04 | WARN | **Plan and progress file contradict each other in the same diff.** The plan's § Baseline and task T0 assert a `26/27` baseline caused by ADR-010's mercure ADR-103 citation, and mandate an `EXTERNAL_ADR_REFS` fix as in-scope. ADR-010 does not exist on this branch (forked from `main@2c00702`), and `core.check.ts:455-458` here allowlists only `'026'`/`'082'`. `.claude/progress.md:15-18` states the corrected account ("that failure never existed on `main`"). The plan was never amended after the split decision. |
| 4 | `documentation/decisions/ADR-011-...md:3` | — | WARN | `status: Accepted` carries no provenance sentence. Siblings narrate it: ADR-007 ("flips to Accepted when implemented"), ADR-009 ("Accepted at the campaign design-gate sign-off… implemented by issue #262"). ADR-008 stays `Proposed` while unimplemented. This branch is not merged, so under ADR-007's own stated rule the status timing is ambiguous. |
| 5 | `scripts/verify.config-gate.test.ts` (whole file) | V-TEST-01 | WARN | **No test exercises `runChecks()`.** Every test asserts `findMissingGateMarkers` against hand-written fixtures in the same file. Nothing covers the check's own wiring: a wrong file path in `read()`, or a wrong returned `id`, would pass the entire suite. Only `bun run verify` would catch it — the unit suite is blind to it. |
| 6 | `scripts/verify.config-gate.test.ts:86-96` | V-TEST-05 | WARN | The 4th test asserts only `markers.length > 0` — a tautology over three module-level constants. It prevents nothing except someone emptying an array wholesale. |
| 7 | `src/agents/coordinator.md:65-67` | V-INT-01 | INFO | "the mode being entered is `run`" is asserted twice but never defined; both mentions point at "SKILL.md Phase 0 step 1" (the gate-mechanics step, a circular self-reference) rather than `SKILL.md` § Modes, which actually defines the trigger keywords. |
| 8 | `src/agents/coordinator.md:53-67` vs `:153` | — | INFO | Gate → `bun run doctor` → spawn ordering is correct only by document position. Neither Proceed nor Reconfigure bullet mentions the doctor preflight; "continue straight to spawn/resume" could be read as skipping it. |
| 9 | `src/agents/coordinator.md:218-222` | — | INFO | Crash-handoff respawn ("spawn a new orchestrator instance using the HANDOFF template") is a 4th respawn trigger not enumerated in § Bootstrap preflight. The gate's "before spawning or resuming" wording is broad enough to arguably apply, though the safer reading — do not re-ask config during mid-campaign crash recovery — is probably the intended one. Worth one clarifying clause. |

## Verified clean

- **V-INT-02 (no reimplementation)**: `findMissingGateMarkers` imported from `core.check.ts:199`, not recreated. `readScope` reused. `config-gate.check.ts` matches the `runChecks(): CheckResult[]` domain shape of `companion-docs.check.ts` / `single-writer.check.ts` with zero structural drift.
- **V-DRY-01 (scope label)**: `formatScopeLabel` is now the sole definition of the `milestone **x**` / `labels …` / `all open issues` wording; `formatDashboard` correctly calls it. Grep across `scripts/` confirms no second copy.
- **V-CONFIG-01 (field names + defaults)**: all 10 fields read by `renderConfigSummary` match `config-template.md` exactly, including defaults — `merge_mode: immediate`, `parallel_max: 4`, `kaizen.enabled: false`, `docs_governance.enabled: true` (correctly inverted vs kaizen), `incident_mode.enabled: false`, `worker_model_policy: cost-optimized`, `auto_sync: true`, `adaptive_routing: true`.
- **No double-fire risk**: the gate's trigger is conjunctive with the carve-out ("When steps 1-6 are skipped per the carve-out above **and** the mode being entered is `run`"), and the carve-out is defined as the exact negation of conditions 1-3. Structurally cannot fire on the same pass as the full form.
- **Cross-file consistency**: option labels stated verbatim only in `coordinator.md` (SSOT); the other two paraphrase without claiming exact wording. No conflicting defaults.
- **V-DRY-01 on prose**: `claude-code-native.md` and `SKILL.md` both point at `coordinator.md` as SSOT without restating the 6-step form.
- **V-ADA-02**: ADR-011 row present in `documentation/decisions/INDEX.md`, correct sort position.
- **Branch coverage**: `formatScopeLabel`'s three-way branch (milestone / labels / neither) fully covered by the new tests.

## Recommended remediation order

1. **Finding 1 (HIGH)** — add a `config-summary` subcommand to `campaign-status.ts`'s `main()`, mirroring `forge-scope.ts`'s established `process.argv[2]` dispatch (`list-args` / `create-args`), and reference that exact invocation string in `coordinator.md`. Without this the feature does not work as documented.
2. **Finding 2** — add one clause to `phase-loop.md` § Campaign complete naming the Pattern C actor, or a pointer to `claude-code-native.md` § Bootstrap gate ownership.
3. **Findings 3, 4** — amend the plan's § Baseline/T0 as N/A for this branch; add a provenance sentence to ADR-011's status.
4. **Findings 5, 6** — add a `runChecks()` test asserting the returned `id` and real-file behavior; replace the `length > 0` tautology.
5. **Findings 7-9** — prose precision, optional.
