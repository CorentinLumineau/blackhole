---
type: adr
status: accepted
created: 2026-07-26
last_updated: 2026-07-26
review_trigger: "on protocol change"
related:
  - documentation/decisions/ADR-005-pr-merge-gate-dependency-ordering.md
  - documentation/decisions/ADR-006-kaizen-hunt.md
  - src/agents/coordinator.md
  - src/references/claude-code-native.md
  - src/SKILL.md
---

# ADR-015: Routine-Resume Campaign Config Confirmation Gate

Accepted on implementation, 2026-07-26, per this repo's ADR lifecycle convention (ADR-007:
"flips to Accepted when implemented"): the gate is implemented and verify-green on
`feat/campaign-config-confirmation-gate`, pending merge to `main`.

Amends ADR-005 § Campaign Launch Configuration Gate and ADR-006 § "Campaign launch form" by
adding a fourth trigger surface to the same gate. The 6-step form's content, ordering, defaults,
and validation logic are unchanged.

## Context

ADR-005 introduced the Campaign launch configuration gate: a 6-step `AskQuestion` form (scope,
merge mode, dependency ordering, parallelism, kaizen, persist) that runs at campaign start.
ADR-006 extended it with the kaizen block and `merge_mode: leave-open`. The gate fires on three
conditions — first bootstrap, post-"Campaign complete" restart, and explicit mid-campaign
reconfigure — and is skipped on **routine resume**, honoring `config-template.md`'s "do not
overwrite existing runtime config without user confirmation".

That carve-out was correct about *not overwriting*, but it made routine resume **silent**. A
returning user typing `/blackhole run` gets no view of the config about to drive the campaign —
scope, merge mode, parallelism, kaizen state — and no lightweight way to change it short of
knowing that the words "reconfigure scope" trigger the full form via Chat Feedback Intake item 5.
A campaign that starts against a stale `scope_milestone` or an unintended `merge_mode:
gated-batch` is expensive to discover after workers are already in flight.

The gap was worse on Pattern C (`claude-code-native.md`), where the main chat *is* the
orchestrator and no coordinator agent exists. Nothing in that document mentioned the gate at all,
so on the harness where Pattern C is the default path, the gate had no documented owner.

## Decision

**A fourth trigger surface on the existing gate — not a new gate.**

When `.blackhole/config.json` exists, none of the three existing conditions hold, and the mode
being entered is `run`, the coordinator (Pattern B) or foreground orchestrator (Pattern C) prints
the current config via `renderConfigSummary` and asks: **"Proceed with this config (default)"** |
**"Reconfigure"**. Proceed continues to spawn/resume with steps 1-6 still skipped — now an
explicit user-confirmed skip. Reconfigure falls through to the unmodified 6-step form from step 1.

Three scope decisions:

1. **`run` mode only.** `status`, `handle #N`, `plan #N`, `implement #N`, `review #N`,
   `hunt [kind]`, and `campaign-audit` load config with no confirm step. Gating a read-only
   `status` check behind a question would be friction with no decision attached to it.
2. **Lightweight, not the full form.** One question with a pre-rendered summary and a Proceed
   default. Re-running all 6 questions on every resume was rejected: it converts a per-campaign
   cost into a per-resume one and trains users to answer by reflex.
3. **Summary is opt-in, not folded into the dashboard.** `renderConfigSummary` is a separate
   exported helper rather than an addition to `formatDashboard()`, because the dashboard renders
   on every `bun run status` and every orchestrator turn; the config summary belongs at launch
   confirmation only (and permanently widening an already-dense dashboard invites V-UX-01).
   It is reachable from the prompt layer as `bun run status config-summary` — a subcommand on
   `campaign-status.ts`'s existing entry point, dispatching on `argv[2]` exactly as
   `forge-scope.ts` already does for `list-args`/`create-args`. An exported-but-uninvokable
   helper would have left the gate undocumentable in shell terms and pushed the coordinator
   toward hand-formatting its own summary (V-INT-02).

**Documented at all three entry paths, enforced by a check.** The gate is stated in
`coordinator.md` (Pattern B), `claude-code-native.md` (Pattern C), and `SKILL.md` Phase 0
(Pattern A). Because each path can reach `run` mode without traversing the others, prose alone
would let any one of them silently drift out of sync. `V-CONFGATE-01`
(`scripts/checks/config-gate.check.ts`) asserts required marker text in all three files, reusing
`findMissingGateMarkers` from `core.check.ts` — the same mechanism as `V-GATE-01`. Pattern C's
section points at `coordinator.md` as SSOT rather than restating the form (V-DRY-01).

## Consequences

**Cost.** One extra interaction per `run`-mode routine resume. Mitigated by the single-question
shape with a Proceed default — not the 6-question form.

**Benefit.** The config driving a campaign is visible at the moment it starts mattering, and
changing it no longer requires knowing an undocumented phrase. The silent-skip branch becomes an
explicit, auditable user decision.

**Enforcement.** `V-CONFGATE-01` makes a dropped or drifted entry-path statement a `bun run
verify` failure rather than a latent bypass. Check count 27 → 28
(`EXPECTED_CHECK_COUNT`, `scripts/build.ts`).

**Unchanged.** The 6-step form, its defaults, its gated-batch+unscoped validation warning, the
`bun run doctor` preflight, and every non-`run` mode's bootstrap path.

## Alternatives Considered

| Alternative | Rejected because |
|---|---|
| Re-run the full 6-step form on every resume | Converts a per-campaign cost into a per-resume one; trains reflex answers, which defeats the confirmation's purpose |
| Print the config with no question (visibility only) | A printed summary scrolls past above the first worker spawn; without a decision point there is no off-ramp, which is the actual gap |
| Fold the summary permanently into `formatDashboard()` | The dashboard renders every orchestrator turn; 8 extra config lines per turn is information overload (V-UX-01) for a launch-time concern |
| Document the gate in `coordinator.md` only | Pattern C has no coordinator and is the default on Claude Code — the path most likely to run the campaign would be the one path with no gate |
| Gate every mode, not just `run` | Adds a question to read-only `status` checks with no decision attached |
