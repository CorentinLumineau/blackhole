---
type: plan
status: current
review_trigger: "on ADR acceptance or Bootstrap preflight change"
created: 2026-07-26
last_updated: 2026-07-26
related:
  [
    documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md,
    documentation/decisions/ADR-006-kaizen-hunt.md,
    src/agents/coordinator.md,
    src/references/claude-code-native.md,
    src/SKILL.md,
  ]
---

# Plan: Campaign Launch Config — Routine-Resume Confirmation Gate

## Objective

Extend the existing **Campaign launch configuration gate** (ADR-005 § Campaign Launch
Configuration Gate, ADR-006 § "Campaign launch form"; `src/agents/coordinator.md` § Bootstrap
preflight) so that a **routine resume in `run` mode** — i.e. `.blackhole/config.json` already
exists and none of the three existing full-form trigger conditions hold — no longer silently
skips straight to spawning workers. Instead it prints a readable summary of the current config and
asks the user, via `AskQuestion`, to **"Proceed with this config"** or **"Reconfigure."**
"Reconfigure" falls through into the existing 6-step form (steps 1-6, unchanged). This is a **4th
trigger surface** on the same gate, not a new gate and not a duplication of steps 1-6
(V-INT-02/V-INT-03) — the existing 6-step form's content, ordering, and validation logic are
untouched.

**Scope boundary (explicit, per user decision already captured):** the confirmation fires on
`run` mode only. `status`, `handle #N`, `plan #N`, `implement #N`, `review #N`, `hunt [kind]`, and
`campaign-audit` modes continue to bootstrap `.blackhole/config.json` (Phase 0 step 1) with **no**
confirm step, exactly as today.

**Why this matters:** today, the routine-resume carve-out (`coordinator.md:45-51`) is a **silent**
skip — a returning user gets no visibility into what config is about to drive a `run`, and no
lightweight off-ramp to change it without invoking the full 6-question form. The gap is worse on
Claude Code (Pattern C, the default harness here per `claude-code-native.md`), which has no
coordinator agent at all — nothing today states that the foreground orchestrator owns the gate
before its first fan-out.

## Baseline (measured 2026-07-26, before any task runs)

Fresh evidence — every acceptance criterion below is stated relative to this baseline, not to an
assumed-green tree:

| Command | Baseline result |
|---------|-----------------|
| `bun test` | `429 pass, 0 fail` across 23 files |
| `VERIFY_SKIP_BUILD=1 bun run verify` | **`26/27 checks passed`** — exits 1 |

**`V-LINK-01` already fails on `main`. Fixing it is IN SCOPE as T0** (explicit user decision,
2026-07-26 — overrides the default V-SCOPE-01 leave-it-alone posture, because a red baseline makes
every downstream acceptance criterion unverifiable).

Cause: `documentation/decisions/ADR-010-story-driven-conformance-adoption.md` cites **mercure's**
ADR-103 (8 inline mentions, lines 16-143) — a cross-plugin ADR living in the mercure repo, which
can never resolve to a local `documentation/decisions/ADR-103-*.md`. This is **not** a checker
limitation: `scripts/checks/core.check.ts:455` already provides the exact designed extension point,
`EXTERNAL_ADR_REFS`, whose comment reads "*also used in a few places to reference another repo's
ADR numbering (mercure) — those can never resolve to a local file and are not doc drift*". It
already allowlists `'026'` and `'082'` with per-entry scoping prose. ADR-010 simply landed without
adding its entry. The fix is therefore a one-line allowlist addition, not a doc edit and not new
machinery — and the correct fix is to the allowlist, never to ADR-010's prose (the references are
legitimate).

With T0 landed, baseline is `27/27` green and the post-implementation target is **`28/28`**.

## Task Breakdown

Tasks are TDD-ordered: each code change (T1-T4) starts with a failing test, then the minimal
implementation to turn it green. The three prompt-file edits (T5-T7) are then written specifically
to satisfy the already-written, already-failing `V-CONFGATE-01` check from T3 — this makes the
new check the executable acceptance test for the doc changes, closing the exact bypass-hole this
plan exists to fix (a marker-based check makes bypass structurally detectable, not just prose).

0. **T0 — Green the `V-LINK-01` baseline (allowlist ADR-103 as external)**
   Add one entry to `EXTERNAL_ADR_REFS` (`scripts/checks/core.check.ts:455-458`), matching the two
   existing entries' format exactly — number-as-string plus a trailing comment naming the citing
   file and quoting the scoping prose:
   ```ts
   '103', // ADR-010-story-driven-conformance-adoption.md: "mercure ADR-103" (Feedback-Driven Intent Layer)
   ```
   Then extend the existing `describe('findAdrCrossReferenceErrors')` suite in
   `scripts/verify.test.ts:223-282` with a regression test. That suite already injects a custom
   allowlist as the 2nd argument (`findAdrCrossReferenceErrors(dir, new Set(['099']))`,
   `verify.test.ts:271`) — reuse that injection style rather than adding new fixture machinery.
   Assert BOTH directions so the entry can't silently rot: an ADR citing `ADR-103` produces no
   error when `'103'` is allowlisted, and still produces one when it is not.
   Do **not** edit ADR-010's prose — its mercure references are legitimate (see § Baseline).
   **Acceptance criteria**: `VERIFY_SKIP_BUILD=1 bun run verify` → `27/27 checks passed`, exit 0
   (baseline green, was `26/27`); `bun test scripts/verify.test.ts` passes with the 2 new
   assertions; `grep -c "'103'" scripts/checks/core.check.ts` → `1`.
   **Depends on**: none. Run FIRST — every later task's verify assertion assumes a green baseline.

1. **T1 — (RED) Failing test for `renderConfigSummary`**
   Add a test block to `scripts/campaign-status.test.ts` asserting a new exported function
   `renderConfigSummary(config)` renders: the scope line (reusing the exact `scopeLabel` format
   already used by `formatDashboard` — assert byte-identical scope-line wording for the same input,
   as a regression guard against a second scope-formatting implementation, V-DRY-01), `merge_mode`
   (default `immediate` when absent), `parallel_max` (default `4`), `kaizen.enabled` (`enabled`/
   `disabled`, default `disabled`), `docs_governance.enabled` (default `enabled` — note the
   inverted default vs. `kaizen`, per `config-template.md:47`), `incident_mode.enabled` (default
   `disabled`), `worker_model_policy` (default `cost-optimized`), `auto_sync` (default `on`),
   `adaptive_routing` (default `on`). Cover both an "all-defaults" fixture (empty `{}` config) and
   a "fully-set" fixture.
   **Acceptance criteria**: `bun test scripts/campaign-status.test.ts` fails with "renderConfigSummary is not
   a function" (or equivalent) — confirms the test is live and red before T2.
   **Depends on**: none.

2. **T2 — (GREEN) Implement `renderConfigSummary`**
   In `scripts/campaign-status.ts`, add and export `renderConfigSummary(config)`. Reuse
   `readScope(config)` from `./forge-scope` for the scope line (do not hand-roll a second
   scope-label formatter — V-INT-02). Accept a narrow local config-subset type (mirroring the
   existing narrow `CampaignConfig` type pattern already used in `forge-scope.ts:14-18`, not a new
   monolithic config type). Do **not** wire this into `formatDashboard()` — it stays a separate,
   explicitly-invoked helper called only by the confirmation-gate call sites added in T4-T6, not
   auto-included in every `bun run status` dashboard render (Decision Record below).
   **Acceptance criteria**: `bun test scripts/campaign-status.test.ts` — all new + existing tests pass (no
   regression on `formatDashboard`'s existing scope-line tests).
   **Depends on**: T1.

   > **Decision Record** — Context: should the config summary always render inside the dashboard,
   > or only on demand from the new confirm gate? Easy path: fold it into `formatDashboard()`
   > unconditionally. Hard path: keep it a separate opt-in call. Choice: separate opt-in call.
   > Rationale: `formatDashboard()` is called on every `bun run status` (including automated
   > polling/monitoring contexts per `coordinator.md` § Campaign visibility) — always appending 8
   > extra config lines there is scope creep beyond this plan's objective (the objective is a
   > one-time confirm at launch, not a permanent dashboard change) and risks a V-UX-01 information-
   > overload finding on an already-dense dashboard. Confidence: High.

3. **T3 — (RED) Failing content-assertion check for the three entry points**
   Create `scripts/checks/config-gate.check.ts` (new file), following the exact shape of
   `scripts/checks/companion-docs.check.ts` and `scripts/checks/design-track.check.ts`: export
   three `REQUIRED_MARKERS` constants and a `runChecks()` returning one `CheckResult` with id
   `V-CONFGATE-01` (verify-check namespace — **not** a campaign V-code; see naming-collision note
   below). Import `findMissingGateMarkers` from `./core.check.ts` — do not reimplement an
   equivalent filter (`core.check.ts:199-200` is the one definition, ADR-007 R6/V-INT-02).
   Required markers (exact literal substrings the check greps for):
   ```ts
   export const COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS = [
     'Routine resume confirmation gate',
     'renderConfigSummary',
     'Proceed with this config',
     'run` mode only',
   ];
   export const CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS = [
     'owns the Campaign launch configuration gate',
     'routine resume confirmation gate',
   ];
   export const SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS = [
     'Campaign launch configuration gate',
     'routine resume confirmation gate',
     'mode only',
   ];
   ```
   Also add a companion unit test `scripts/verify.config-gate.test.ts` (new file, mirrors
   `scripts/verify.single-writer.test.ts`'s fixture-based test shape) with a "stale" fixture (missing
   markers → `findMissingGateMarkers` returns non-empty) and a "fixed" fixture (all markers present
   → returns `[]`). Then bump `EXPECTED_CHECK_COUNT` in `scripts/build.ts:288` from `27` to `28` in
   this same task (discipline requirement — `verify.ts` only WARNs on mismatch, so this is not
   caught by a failing test on its own; treat the bump as part of this task's acceptance criteria,
   not optional).
   **Acceptance criteria**: `bun test scripts/verify.config-gate.test.ts` passes (fixture-level red/green).
   `bun run verify` at this point reports `V-CONFGATE-01` **failing** against the real `src/agents/coordinator.md`,
   `src/references/claude-code-native.md`, and `src/SKILL.md` (expected — those files don't carry
   the markers yet; this is the intentional RED state T4-T6 turn GREEN) and no check-count WARN is
   emitted (28 checks discovered, matching the new `EXPECTED_CHECK_COUNT = 28`). Expect exactly
   `27/28` at this point — the intentionally-red `V-CONFGATE-01` as the ONLY failure (T0 has
   already greened `V-LINK-01`). Any second failure means this task broke something.
   **Depends on**: T0 (needs the green baseline to read its own RED signal unambiguously).

4. **T4 — (GREEN) `coordinator.md` § Bootstrap preflight — routine-resume confirmation gate**
   Edit `src/agents/coordinator.md`. The existing "Skip steps 1-6 only on routine resume" paragraph
   (`coordinator.md:45-51`) currently ends the story there — a silent skip. Add, immediately after
   that paragraph, a new labeled sub-section (exact heading text: `**Routine resume confirmation
   gate**`) stating: when `.blackhole/config.json` exists AND none of conditions 1-3 hold AND the
   mode being entered is `run`, before spawning/resuming the orchestrator, call
   `renderConfigSummary` (`scripts/campaign-status.ts` — reuse, per Codebase Conventions below) and
   print it, then use `AskQuestion` with options `"Proceed with this config (default)"` /
   `"Reconfigure"`. On "Proceed", continue straight to spawn/resume exactly as before (steps 1-6
   remain skipped — this is an explicit user-confirmed skip now, not a silent one). On
   "Reconfigure", run the full gate (steps 1-6 above) from step 1, then proceed to spawn/resume.
   Close with an explicit one-line scope statement containing the literal substring `` run` mode
   only `` — e.g. "This confirmation gate fires on `run` mode only — `status`, `handle #N`, `plan
   #N`, `implement #N`, `review #N`, `hunt [kind]`, and `campaign-audit` modes continue to
   bootstrap config with no confirm step, per `src/SKILL.md` Phase 0." Must contain, verbatim, all
   four `COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS` from T3.
   **Acceptance criteria**: `bun run verify` — `V-CONFGATE-01`'s coordinator-side sub-check (all 4 markers) passes.
   Manual re-read: the existing 3 numbered conditions (1-3) and their steps 1-6 body are
   byte-for-byte unchanged (diff-scoped addition only, V-SCOPE-01).
   **Depends on**: T3.

5. **T5 — (GREEN) `claude-code-native.md` — gate ownership statement**
   Edit `src/references/claude-code-native.md`. Add a new `## Bootstrap gate ownership` section
   (placement: after `## Foreground state ownership`, before `## Two-tier gate topology` — it is
   itself a foreground-ownership statement and belongs beside that section) stating that on Claude
   Code (Pattern C), the foreground orchestrator (main chat) owns the Campaign launch configuration
   gate — including the routine resume confirmation gate — for every `run`-mode turn, before its
   first fan-out; there is no coordinator to run it on this pattern, so the foreground session must
   execute `coordinator.md` § Bootstrap preflight (named explicitly as the SSOT for the gate steps
   and trigger conditions) prior to spawning any worker; this document does not restate those
   steps (V-DRY-01 — point at the SSOT, do not duplicate the 6-step form or the new sub-section
   here). Must contain, verbatim, both `CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS` from T3.
   **Acceptance criteria**: `bun run verify` — `V-CONFGATE-01`'s claude-code-native-side sub-check passes.
   **Depends on**: T3.

6. **T6 — (GREEN) `SKILL.md` Phase 0 step 1 — name and scope the gate**
   Edit `src/SKILL.md` Phase 0 step 1 (currently: `"**Config** — \`.blackhole/config.json\` (from
   \`config-template.md\` in this repo)"`, `SKILL.md:47`). Extend it (do not replace the existing
   sentence) to name the **Campaign launch configuration gate** (`coordinator.md` § Bootstrap
   preflight) and state explicitly that in `run` mode this step includes either the full 6-step
   form (first bootstrap / restart / explicit reconfigure) or the lightweight **routine resume
   confirmation gate** otherwise, and that this gate is `run`-mode only — the other 7 modes in the
   mode table (`SKILL.md:30-41`) load config with no confirm step. Must contain, verbatim, all
   three `SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS` from T3.
   **Acceptance criteria**: `bun run verify` — `V-CONFGATE-01`'s SKILL.md-side sub-check passes; full
   check now GREEN (0 missing markers across all three files, `bun run verify` shows `28/28 checks
   passed` including `✓ V-CONFGATE-01`, exit 0).
   **Depends on**: T3.

7. **T7 — ADR-011 + decisions INDEX row**
   Write `documentation/decisions/ADR-011-routine-resume-confirmation-gate.md` (next sequential
   ADR number after ADR-010) documenting: Context (silent routine-resume skip, no visibility, no
   Pattern-C gate-ownership statement), Decision (4th trigger surface on the existing gate — not a
   new gate; run-mode-only scope; lightweight Proceed/Reconfigure vs. re-running the full form),
   Consequences (one extra interaction per `run`-mode routine resume; mitigated by a
   `renderConfigSummary`-backed low-friction question with a "Proceed" default rather than the full
   6-question form). Explicitly note it **amends** ADR-005 § Campaign Launch Configuration Gate and
   ADR-006 § "Campaign launch form" (same amendment relationship ADR-006 already has to ADR-005).
   Add the corresponding row to `documentation/decisions/INDEX.md` (V-ADA-02) with `status:
   Accepted` (mirrors ADR-005/006/007/009's already-Accepted status — this is describing landed
   protocol, not a proposal awaiting review, once T4-T6 are merged) and `review_trigger: "on
   protocol change"` matching the existing ADR rows' convention.
   **Acceptance criteria**: `documentation/decisions/INDEX.md` has exactly 11 ADR rows (10 existing + 1 new);
   `grep -c "ADR-011" documentation/decisions/INDEX.md` returns `1`.
   **Depends on**: T4 (ADR must describe the final, landed gate wording — not a draft).

8. **T8 — Refresh `.claude/progress.md`**
   `.claude/progress.md` currently describes ADR-006 as "implemented, uncommitted" and cites stale
   counts (`bun test 275/275`, `bun run verify 19/19`) that predate ADR-007's verify decomposition
   (current: 27 checks pre-plan, 28 post-plan) and the v0.13.1 release / CI-runner work already on
   `main` (commits `2c00702`, `d4d978b`, `f865dcc`, `9333a0a`, `cc58cf9`). Rewrite `## Current
   Status` to reflect: this plan's branch and objective; `## Completed Tasks` to drop the
   now-merged ADR-006/ADR-007 entries (already captured in git history — Session Handoff Protocol
   says git log is authoritative, the progress file should not duplicate it) in favor of a pointer
   to `git log --oneline -10`; `## Next Steps` updated post-implementation. This is process hygiene,
   not a feature change — keep it terse.
   **Acceptance criteria**: `.claude/progress.md` no longer contains the string `"ADR-006 (routing
   visibility + reuse gate) — implemented, uncommitted"`; `## Current Status` references this
   plan's branch name.
   **Depends on**: T1-T7 (needs final landed state to describe accurately).

9. **T9 — Full verification pass**
   Run the project's standard verification battery and confirm every gate is green with fresh
   evidence (per Verification Evidence 5-step gate — IDENTIFY/RUN/READ/VERIFY/CLAIM).
   **Acceptance criteria**:
   - `bun test` — 0 failures, count strictly greater than the 429-test baseline (T1 and T3 each add
     tests); report the exact N/N from output.
   - `bun run build` — exits 0, clean (no drift warnings).
   - `bun run verify` — reports `28/28 checks passed`, exit 0, including `✓ V-CONFGATE-01` and
     `✓ V-LINK-01` (greened by T0), with no `Warning: expected N checks, ran M` line. Zero failures
     is the bar: unlike the pre-T0 baseline there is no longer any tolerated red check.
   - `grep -n "Routine resume confirmation gate" src/agents/coordinator.md` — 1 match.
   - `grep -n "owns the Campaign launch configuration gate" src/references/claude-code-native.md` — 1 match.
   - `grep -n "Campaign launch configuration gate" src/SKILL.md` — 1 match.
   **Depends on**: T1-T8.

## Critical Files

| File | Change Type | Why |
|------|-------------|-----|
| `scripts/checks/core.check.ts` | Modify | Add `'103'` to `EXTERNAL_ADR_REFS` to green the `V-LINK-01` baseline (T0) |
| `scripts/verify.test.ts` | Modify | Two-directional regression test for the ADR-103 allowlist entry (T0) |
| `src/agents/coordinator.md` | Modify | Add routine-resume confirmation gate to § Bootstrap preflight (T4) |
| `src/references/claude-code-native.md` | Modify | Add § Bootstrap gate ownership for Pattern C (T5) |
| `src/SKILL.md` | Modify | Name/scope the gate at Phase 0 step 1 (T6) |
| `scripts/campaign-status.ts` | Modify | Add `renderConfigSummary()` export (T2) |
| `scripts/campaign-status.test.ts` | Modify | Failing→passing tests for `renderConfigSummary` (T1/T2) |
| `scripts/checks/config-gate.check.ts` | New file | `V-CONFGATE-01` content-assertion check (T3) |
| `scripts/verify.config-gate.test.ts` | New file | Fixture-level unit test for the new check (T3) |
| `scripts/build.ts` | Modify | Bump `EXPECTED_CHECK_COUNT` 27 → 28 (T3) |
| `documentation/decisions/ADR-011-routine-resume-confirmation-gate.md` | New file | ADR amending ADR-005/ADR-006 gate trigger conditions (T7) |
| `documentation/decisions/INDEX.md` | Modify | New ADR-011 row (T7, V-ADA-02) |
| `.claude/progress.md` | Modify | Refresh stale ADR-006 status and check/test counts (T8) |

## Touch-Paths

Per `.claude/rules/blackhole-protocol.md` § Plan Touch-Paths & API Drift (V-SCOPE-02), the
implementation is restricted to exactly the files in the Critical Files table above (including
T0's `scripts/checks/core.check.ts` and `scripts/verify.test.ts` — in scope by explicit user
decision, see § Baseline), plus their
build outputs produced by `bun run build` (`.claude/agents/coordinator.md`,
`.claude/skills/blackhole/references/claude-code-native.md`, `.claude/skills/blackhole/SKILL.md`,
and the equivalent paths under `.agents/build/` and `codex-*` — generated, never hand-edited; see
`blackhole-protocol.md` § Campaign state vs. agent handoff dirs). No other `src/agents/*.md`,
`src/references/*.md`, or `scripts/*.ts` file is in scope. `documentation/plans/`
story-driven-conformance.md is explicitly out of scope (unrelated untracked file — leave alone).

## Codebase Conventions

| Touchpoint | Convention | Source | Required by |
|------------|------------|--------|-------------|
| Prompt-side user question | Use `AskQuestion` with a short option list, mirroring the existing gate's phrasing style (`"X (default)"` / alternative) — do not introduce a different question mechanism | `src/agents/coordinator.md:53-56` (step 1 example), `:67-71` (step 2 example) | V-INT-01..03 |
| Campaign config field names | Reuse existing named fields only (`merge_mode`, `parallel_max`, `kaizen`, `docs_governance`, `incident_mode`, `worker_model_policy`, `auto_sync`, `adaptive_routing`) — never invent new field names for the summary | `src/references/config-template.md:6-29` | V-INT-01..04, V-CONFIG-01 |
| Config writes | Atomic read-modify-write via `.tmp` + `mv`; bump `refreshed_at` on every mutation | `src/references/blackhole-state.md` § Write protocol | V-INT-01..03 |
| Verify-check module shape | `scripts/checks/{domain}.check.ts` exporting `runChecks(): CheckResult[]`, glob-discovered by `verify.ts` — no central registry file | `scripts/verify.ts:15-16`, `scripts/checks/companion-docs.check.ts:33`, `scripts/checks/design-track.check.ts:40` | V-INT-01..04 |
| Gate content-assertion helper | Reuse `findMissingGateMarkers` from `core.check.ts` — never reimplement an equivalent required-substring filter | `scripts/checks/core.check.ts:199-200` | V-INT-02 |
| Machine-checkable literal counters | Declare once in `scripts/build.ts` § facts (e.g. `EXPECTED_CHECK_COUNT`), never restated at the consumption site | `scripts/build.ts:277,288` | V-INT-01, ADR-007 R6 |
| Narrow per-file config types | Define a local narrow config-subset type per consumer file rather than one shared monolithic `CampaignConfig` type | `scripts/forge-scope.ts:14-18` | V-INT-01, V-KISS-01 |
| Dashboard/scope helpers | Reuse `readScope()`, `parseCheckpointFrontmatter`, `countLedgerByStatus` — do not reimplement scope-label or ledger-count formatting | `scripts/forge-scope.ts:22`, `scripts/campaign-status.ts` (existing helpers) | V-INT-02 |
| `src/` → build outputs | Edit `src/` only; regenerate `.claude/`, `.agents/build/`, `codex-*` via `bun run build`; never hand-edit build output | `CLAUDE.md`, `blackhole-protocol.md` § Campaign state vs. agent handoff dirs | V-INT-02 |
| Verify-check ID namespace | New verify-check IDs (`V-TOOLS-01`, `V-GATE-01`, `V-CONTENTGATE-01`, …) are a distinct namespace from the campaign V-code table in `blackhole-vcodes.md` — `V-CONFIG-01` is already taken there ("New config/env keys follow established naming, registered", WARN); the new check is named `V-CONFGATE-01` to avoid collision, and does **not** require a `blackhole-vcodes.md` row (it is a harness conformance check, not a reviewer finding class) | `src/references/blackhole-vcodes.md` (existing `V-CONFIG-01` row) | V-INT-03 |

## Threat Model

Not security-sensitive — explicitly assessed rather than silently skipped. This change adds a
local interactive confirmation prompt over an already-local, already-trusted config file
(`.blackhole/config.json`), read and written entirely within the existing atomic-write protocol.
It introduces no new network surface, no new credential or secret handling, no new authentication
or authorization logic, and no new externally-reachable input (the `AskQuestion` answer space is a
closed 2-option enum, not free-form user input feeding a parser). A full STRIDE table would be
manufactured content with no real threat surface to enumerate — omitted per that judgment.

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| New confirmation gate accidentally fires on a non-`run` mode (scope creep beyond the user-decided boundary) | MEDIUM | T4 and T6 must each contain the literal `` run` mode only `` scope statement (`COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS` / `SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS`); T9's grep assertions verify the exact strings landed; x-review's V-INT-04 check re-verifies the Codebase Conventions row is honored in the diff |
| One of the three entry-path edits (T4/T5/T6) is skipped, reverted, or drifts out of sync later, silently reopening the exact bypass hole this plan exists to close | MEDIUM | T3's `V-CONFGATE-01` verify check turns "the gate is documented at all three entry points" into a CI-visible pass/fail (`bun run verify` fails, not just a prose convention) — this is why T3 (the check) is written and made to fail *before* T4-T6 land, per the Task Breakdown's TDD-as-acceptance-test framing |
| `renderConfigSummary` reimplements the existing `formatDashboard` scope-label logic instead of reusing `readScope()`, creating two formatters that can drift apart (V-DRY-01) | MEDIUM | T1's test asserts the scope line is byte-identical to `formatDashboard`'s existing wording for the same input config — a second independent formatter fails this assertion |
| `EXPECTED_CHECK_COUNT` bump forgotten after adding the new check (verify.ts only WARNs, does not fail, on mismatch) | LOW | Bundled into T3's own acceptance criteria; re-verified independently by T9's `28/28` assertion |
| T0's `EXTERNAL_ADR_REFS` entry over-suppresses — a genuinely dead local `ADR-103-*.md` link would go unreported | LOW | The set is consumed at exactly one call site and keyed on the ADR *number*; blackhole's own ADRs are sequential and currently at 010, so a local ADR-103 cannot exist for ~93 more decisions. T0's two-directional test pins the behavior in both states, and the per-entry comment records the citing file so the allowlist stays auditable at a glance (matching the existing `'026'`/`'082'` convention) |
| ADR-011 (T7) is drafted against a stale description of the gate before T4's final wording lands | LOW | T7 explicitly depends on T4 and is scheduled in Execution Strategy Phase C, strictly after Phase B (T4/T5/T6) completes |

No item above reaches HIGH severity — the change is additive, gated to one existing carve-out
branch, and structurally enforced by a new verify check rather than relying on prose discipline
alone. Per `plan-quality-checklist.md` Check 7, a `## Stop Conditions` section is therefore
omitted (advisory, not required without a HIGH-risk item) — this is an explicit judgment, not a
silent skip.

## Dependency Blast-Radius

| Changed File | Downstream Consumers | Blast Radius |
|--------------|----------------------|---------------|
| `src/agents/coordinator.md` | Coordinator agent runtime (Pattern B); built into `.claude/agents/coordinator.md` and equivalent paths under `.agents/build/`, `codex-*` for every harness target | MEDIUM |
| `src/references/claude-code-native.md` | Every Claude Code session running Pattern C (default harness in this repo); cross-referenced from `SKILL.md` and `coordinator.md` | MEDIUM |
| `src/SKILL.md` | Phase 0 bootstrap for **all 8 modes** across all harness builds (Cursor, Claude Code, Gemini/Antigravity, Codex) | HIGH |
| `scripts/campaign-status.ts` | `bun run status`, `coordinator.md` § Campaign visibility (dashboard step 6), orchestrator dashboard calls | MEDIUM |
| `scripts/build.ts` (`EXPECTED_CHECK_COUNT`) | `scripts/verify.ts` mismatch-WARN comparison, CI verify step | LOW |
| `scripts/checks/core.check.ts` (`EXTERNAL_ADR_REFS`) | `V-LINK-01` only; the set is consumed at one call site (`findAdrCrossReferenceErrors`) and is additive — an added entry can only suppress a specific false positive, never mask a local dead link | LOW |
| `documentation/decisions/INDEX.md` | ADR governance audit (V-ADA-02), doc discovery tooling | LOW |

**Overall blast radius**: MEDIUM. The change touches the bootstrap path shared by every mode and
every harness build target, but is strictly additive and gated (a new confirm sub-flow inserted
into one already-narrow carve-out branch) — no existing condition, step, or default behavior in
the 6-step form is altered, and non-`run` modes are provably unaffected (T6's marker text states
the scope; T9's grep assertions verify it landed).

## Edge Cases & Boundary Conditions

| Boundary Type | Scenario | Acceptance Criterion |
|----------------|----------|----------------------|
| Mode misclassification | User's message is ambiguous between `run` and another mode (e.g. "run status") | The confirmation gate only fires once the mode has been resolved to `run` per the existing mode-table matching in `SKILL.md:30-41` — never fires speculatively before mode resolution |
| Double-confirmation | Condition 1-3 already triggers the full 6-step form (which itself ends in an explicit config write + dashboard print) | The new confirmation gate is scoped exclusively to the routine-resume carve-out branch (T4's literal placement, immediately after `coordinator.md:45-51`) — it must never also fire when conditions 1-3 already ran the full form in the same bootstrap |
| Reconfigure loop | User picks "Reconfigure" | Falls through to the existing step 1, running the complete unmodified 6-step form exactly as conditions 1-3 already do — no partial or abbreviated re-run |
| Repeated turns, same session | Pattern C foreground orchestrator resumes across multiple turns within one `run`-mode campaign | The confirmation gate fires once per bootstrap (i.e. once per fresh `run` invocation), not once per orchestrator turn within an already-running campaign — `coordinator.md` § Campaign visibility's existing per-turn dashboard print is unaffected and unrelated |
| Missing/corrupt config at gate time | `.blackhole/config.json` fails `jq empty` validation | Out of scope for this gate — Phase 0 step 4 "Validate" already handles this upstream; the confirmation gate assumes a structurally valid config was already loaded |

## Execution Strategy

**Pattern**: Mixed — T1/T2 and T3 run as two independent sequential chains in parallel (Phase A);
T4/T5/T6 depend on T3 and touch three different files with no cross-file dependency, so they run
in parallel (Phase B, ≤4 agents per `orchestration-strategy.md`); T7/T8/T9 are sequential
(Phase C) because each needs the prior phase's landed state.

| Agent | Task(s) | Model | Delegation Contract |
|-------|---------|-------|---------------------|
| x-tester | T1 | sonnet (full) | **Objective**: Write a failing test for `renderConfigSummary(config)` in `scripts/campaign-status.test.ts` covering default and fully-set config fixtures per T1's field list. **Output format**: Bun test file edit — new `describe`/`test` blocks. **Scope**: `scripts/campaign-status.test.ts` only. **Tool guidance**: Read `scripts/campaign-status.ts` and `scripts/forge-scope.ts` first to match existing test/fixture style. **Stop condition**: Test file added and confirmed to fail (`renderConfigSummary` undefined) via `bun test`. |
| General-purpose subagent | T2 | sonnet | **Objective**: Implement and export `renderConfigSummary(config)` in `scripts/campaign-status.ts` per T2's spec, reusing `readScope()`. **Output format**: Function + narrow local config type, exported. **Scope**: `scripts/campaign-status.ts` only — do not modify `formatDashboard()`. **Tool guidance**: Match existing render-helper style (`renderInFlightSection` etc.) for section formatting conventions. **Stop condition**: `bun test scripts/campaign-status.test.ts` passes fully (T1's tests green, no regressions). |
| x-tester | T3 | sonnet (full) | **Objective**: Create `scripts/checks/config-gate.check.ts` and `scripts/verify.config-gate.test.ts` per T3's spec — 3 required-marker constants, `V-CONFGATE-01` check reusing `findMissingGateMarkers`, and bump `EXPECTED_CHECK_COUNT` in `scripts/build.ts`. **Output format**: Two new files + one-line edit to `build.ts`. **Scope**: exactly those three files. **Tool guidance**: Mirror `scripts/checks/companion-docs.check.ts` and `scripts/verify.single-writer.test.ts` structure verbatim. **Stop condition**: `bun test scripts/verify.config-gate.test.ts` passes (fixture-level); `bun run verify` shows `V-CONFGATE-01` failing against real files (expected RED) with 28 checks discovered. |
| General-purpose subagent | T4 | sonnet | **Objective**: Add the routine-resume confirmation gate to `src/agents/coordinator.md` § Bootstrap preflight per T4's exact wording and marker requirements. **Output format**: Markdown addition, placed immediately after the existing "Skip steps 1-6 only on routine resume" paragraph. **Scope**: `src/agents/coordinator.md` only; do not alter the existing numbered conditions 1-3 or steps 1-6 body. **Tool guidance**: Diff-check against `coordinator.md:32-136` before/after to confirm zero unintended changes. **Stop condition**: All 4 `COORDINATOR_ROUTINE_RESUME_REQUIRED_MARKERS` present verbatim; `bun run verify`'s coordinator sub-check for `V-CONFGATE-01` passes. |
| General-purpose subagent | T5 | sonnet | **Objective**: Add `## Bootstrap gate ownership` to `src/references/claude-code-native.md` per T5's spec. **Output format**: New markdown section, placed after `## Foreground state ownership`. **Scope**: `src/references/claude-code-native.md` only. **Tool guidance**: Point at `coordinator.md` as SSOT — do not restate the 6-step form or the T4 addition. **Stop condition**: Both `CLAUDE_NATIVE_GATE_OWNERSHIP_REQUIRED_MARKERS` present verbatim; matching `V-CONFGATE-01` sub-check passes. |
| General-purpose subagent | T6 | sonnet | **Objective**: Extend `src/SKILL.md` Phase 0 step 1 per T6's spec. **Output format**: Extend the existing "Config" bullet — do not replace it. **Scope**: `src/SKILL.md` Phase 0 step 1 only. **Tool guidance**: Confirm the mode table (`SKILL.md:30-41`) is unchanged. **Stop condition**: All 3 `SKILL_PHASE0_GATE_LINK_REQUIRED_MARKERS` present verbatim; `bun run verify` reports 28/28 with `✓ V-CONFGATE-01`. |
| x-doc-writer | T7 | sonnet (full) | **Objective**: Write `documentation/decisions/ADR-011-routine-resume-confirmation-gate.md` and add its row to `documentation/decisions/INDEX.md` per T7's spec. **Output format**: New ADR file (Status/Context/Decision/Consequences) + one INDEX.md row. **Scope**: those two files only. **Tool guidance**: Match ADR-006's style as the most recent amendment-type ADR. **Stop condition**: `documentation/decisions/INDEX.md` has 11 ADR rows; `ADR-011` referenced exactly once. |
| x-doc-writer | T8 | sonnet (full) | **Objective**: Refresh `.claude/progress.md` per T8's spec — remove stale ADR-006 status, update counts, point to `git log` instead of restating history. **Output format**: Rewritten `## Current Status` / `## Completed Tasks` / `## Next Steps` sections. **Scope**: `.claude/progress.md` only. **Tool guidance**: Keep terse — this is process hygiene, not documentation prose. **Stop condition**: Stale ADR-006 "uncommitted" string removed; current branch/objective referenced. |
| x-tester | T9 | sonnet (full) | **Objective**: Run the full verification battery (`bun test`, `bun run build`, `bun run verify`, targeted greps) and report fresh evidence per T9's acceptance criteria. **Output format**: Pass/fail table with exact counts quoted from command output. **Scope**: read-only verification, no code changes (escalate to the relevant task's agent if a check fails). **Tool guidance**: Follow the Verification Evidence 5-step gate — do not claim completion without quoting fresh output. **Stop condition**: All bullets in T9's acceptance criteria confirmed with quoted output, or a specific failing check is reported for remediation. |

**Parallelization**: **Phase 0 — {T0} runs alone, first.** It is the only task touching
`scripts/checks/core.check.ts`, and every later verify assertion is stated against the green
baseline it produces; running it concurrently would make T3's intentional-RED signal ambiguous.
Phase A — {T1→T2} and {T3} run in parallel (2 agents, independent files). Phase B — {T4, T5, T6}
run in parallel (3 agents, independent files, all gated on T3 landing first). Phase C —
{T7 → T8 → T9} run sequentially (each needs the prior task's final state).

**T0 delegation** — x-tester (sonnet, full). **Objective**: add the `'103'` entry to
`EXTERNAL_ADR_REFS` and the two-directional regression test per T0's spec. **Output format**:
one-line allowlist addition + new assertions inside the existing
`describe('findAdrCrossReferenceErrors')` block. **Scope**: `scripts/checks/core.check.ts` and
`scripts/verify.test.ts` only — do not touch ADR-010's prose. **Tool guidance**: reuse the
allowlist-injection style already at `verify.test.ts:271`; match the existing entry comment format
at `core.check.ts:456-457`. **Stop condition**: `VERIFY_SKIP_BUILD=1 bun run verify` exits 0 at
`27/27`.

## Sprint Contract

### Machine-verifiable
- [ ] `bun test` → 0 failures, total > 429 (baseline)
- [ ] `bun run build` → exits 0, no drift warnings
- [ ] `bun run verify` → `28/28 checks passed`, exit 0, `✓ V-CONFGATE-01` and `✓ V-LINK-01`, no
      check-count WARN
- [ ] `grep -c "ADR-011" documentation/decisions/INDEX.md` → `1`
- [ ] `grep -q "Routine resume confirmation gate" src/agents/coordinator.md` → match
- [ ] `grep -q "owns the Campaign launch configuration gate" src/references/claude-code-native.md` → match
- [ ] `grep -q "Campaign launch configuration gate" src/SKILL.md` → match

### Human-verifiable
- [ ] The added `coordinator.md` sub-section reads naturally as a continuation of the existing §
      Bootstrap preflight — a fresh reader unfamiliar with this plan should not be able to tell it
      was added separately from the original 6-step form.
- [ ] The `renderConfigSummary` output is genuinely readable at a glance (not a raw JSON dump) —
      spot-check it against a real `.blackhole/config.json` from this repo.
