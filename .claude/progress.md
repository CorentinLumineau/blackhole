## Current Status

**ADR-011 (routine-resume campaign config confirmation gate)** — implemented on branch
`feat/campaign-config-confirmation-gate` (based on `main` @ `2c00702`).

`/blackhole run` no longer starts silently on routine resume: the coordinator (Pattern B) or
foreground orchestrator (Pattern C) prints the current config via `renderConfigSummary` and asks
Proceed / Reconfigure before spawning workers. Reconfigure falls through to the unmodified ADR-005
6-step form. `run` mode only. Documented at all three entry paths (`coordinator.md`,
`claude-code-native.md`, `SKILL.md` Phase 0) and enforced by the new `V-CONFGATE-01` check so a
dropped statement fails CI instead of silently reopening the bypass.

Plan: `documentation/plans/plan-campaign-config-confirmation-gate.md`.

**Related, separate branch**: `docs/adr-010-story-driven-conformance` carries commit `2c5e0ba`
(allowlist mercure ADR-103 in `EXTERNAL_ADR_REFS`), which greens the `V-LINK-01` failure that
ADR-010's own commit `8a99644` introduced. That failure never existed on `main`; the fix lives on
the branch that caused it, not here.

## Completed Tasks

Git history is authoritative — `git log --oneline -10`. This file records only in-flight state
and cross-session context that history does not carry.

## Failed Approaches

- ADR-007 § Rejected Alternatives (binding): generation-in-place, central registry,
  orchestrator/worker-schemas splits, mtime cache.
- Naming the new verify check `V-CONFIG-01` — that ID is already taken in `blackhole-vcodes.md`
  (config key naming, WARN). Verify-check IDs are a separate namespace from the campaign V-code
  table; the check is `V-CONFGATE-01` and adds no `blackhole-vcodes.md` row.
- Folding the config summary into `formatDashboard()` — it renders on every orchestrator turn;
  the summary belongs at launch confirmation only (ADR-011 § Alternatives).

## Next Steps

1. `/x-review` the branch, then PR `feat/campaign-config-confirmation-gate` → `main`.
2. Separately, PR `docs/adr-010-story-driven-conformance` (now verify-green with `2c5e0ba`).
3. Consider a release once both land.

## Known Limitations

- `V-CONFGATE-01` asserts marker *text* is present, not that the gate is actually executed at
  runtime — the usual limit of prompt-file conformance checks.
- `worker-schemas.md` split still deferred (watch: >700 LOC or role contract >80 LOC).
