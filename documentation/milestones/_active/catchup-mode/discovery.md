---
type: reference
summary: "Shared discovery block for the catchup-mode initiative: ADR-053 constraints, codebase conventions at the usage, config, CLI, forge adapter, mode and launch-gate touchpoints"
status: current
review_trigger: "on file change"
created: 2026-11-17
last_updated: 2026-11-17
related:
  - documentation/decisions/ADR-053-catchup-mode-quota-pacing.md
  - documentation/brainstorms/weekly-quota-pacing.md
---

# Catchup mode: Shared Discovery Block

## Upstream ADR Summary
- ADR-053: `catchup` is a dedicated mode; normal `run` semantics are unchanged.
- `usage-budget.ts --floor` is the only gate. It fails closed on unreadable usage, and the floor replaces `stop_campaign_at` for that invocation only. `config.json` is never mutated.
- The usage provider chain returns the full subscription picture: plan, only the windows the plan has (5h, weekly, per-model weekly), used % and reset per window, extra usage, source.
- `run` and `catchup` share the launch gate: full config summary, Accept/Adjust per section. `catchup` pre-fills the pacing preset (floor, 5h 75/80, lane). Scheduled runs use print-only mode.
- Claims: `in-progress:<lane>` + assignee under a lease. Ownership is decided by the lane label, not the `blackhole/` branch prefix.

## Upstream Audit Findings
(not available)

## Architecture Constraints
- ARCHITECTURE.md Active Constraints: none bind this scope directly. Hook, worktree and include constraints (ADR-039/040/043/044/045) are outside these touch-paths.
- Open issues touching scope: #1271 (stale project-scope plugin pins hide new gate features), #1272 (circular import `usage-source.ts` ↔ `pace-gate.ts`, to be fixed before M1 extends usage-source).

## Codebase Conventions
| Touchpoint | Pattern | Source |
|---|---|---|
| Config block | One `Field \| Required \| Description` row per leaf in `src/references/config-template.md` (V-CONFIG-02); status-page dataset declared (V-CONFIG-03) | config-template.md:33, :118-140; scripts/checks/config-registration.check.ts |
| CLI argv | `parseFlags`/`requireFlag` from `scripts/lib/argv-flags.ts`; add a new CLI to the V-ARGV-01 `TARGET_SCRIPTS` allowlist | argv-flags.ts:15-47; checks/argv-flags-adoption.check.ts:12-29 |
| CLI output | Machine verdicts as single-line `console.log(JSON.stringify(...))`, exit 0 on any verdict, 2 on bad usage | usage-budget.ts:110, pace-gate.ts:74 |
| Usage reading | `usageSourceFor(host, config).read(now)` → `{source, limits, windows, reason}`; `resolveHost`; `--usage` JSON override | scripts/lib/usage-source.ts:48, :80 |
| Forge labels | `ForgeAdapter.labelAdd`/`labelRemove` exist in all 3 adapters, no script caller yet; queue claim today is `status: in-flight` | forge-adapter/types.ts:133-150; github.ts:107, gitea.ts:395, gitlab.ts:254 |
| Mode registration | `\| Mode \| Trigger \| Who runs it \|` row in `src/SKILL.md` plus a `references/*.md` playbook | src/SKILL.md:35-49 |
| Launch gate | `buildLaunchSummary` → `LaunchRow` per `LAUNCH_ROW_KEYS`; `gateCards` builds Accept/Adjust from adjustable rows, none in print-only | scripts/lib/campaign-status/launch-summary.ts:208-230 |
| Tests | Pure-lib unit tests import the module; CLI tests `spawnSync('bun', ['run', cli])` against a temp config dir | scripts/usage-budget.test.ts; scripts/lib/usage-source.test.ts |

Edit `src/`, never the built `skills/` tree, then `bun run build`.

## Performance Baselines
(no prior audit baseline available)

## Failed Approaches (Do Not Repeat)
(none on record for this scope)
