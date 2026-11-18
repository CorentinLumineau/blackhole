---
type: analysis
summary: "Evidence pass for issue #1267 peer campaign detection: conventions the change must follow (pure lib + thin CLI, injected clock and git, writeJsonAtomic, lane-note hold via applyLane), the four consumers it touches, and the architecture constraint it adds"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
related:
  - documentation/decisions/ADR-057-peer-campaign-detection-registry.md
---

# Analysis: issue #1267, peer campaign detection

Read-only pass at `origin/main` 4c0b6699. Planner-authored; no investigator ran.

## Convention catalog

| Concern | Convention | Evidence |
|---|---|---|
| Script shape | A pure `scripts/lib/<name>.ts` core and a thin `scripts/<name>.ts` CLI (ADR-003) | `scripts/lib/forge-sync.ts` + `scripts/forge-sync.ts`; `scripts/lib/lane.ts` |
| Clock | The current time is a parameter, never `Date.now()` inside lib code | `lane.ts` `isClaimStale({ now })`; `SyncInput.now` |
| Argv | `parseFlags`/`requireFlag` from `scripts/lib/argv-flags.ts` | `scripts/design-aggregate.ts:6` |
| JSON writes | `.tmp` plus rename through `writeJsonAtomic` | `scripts/lib/campaign-status/record.ts:120` |
| JSON reads | `readJsonFile` from `scripts/lib/fs.ts` | `sleep-hold.ts:4` |
| Process/OS calls | Behind an injected deps object, so unit tests never touch the real system | `sleep-hold.ts` `HoldDeps` |
| Ready-set holds | One note family written and cleared only by forge-sync: `applyLane` + `LANE_NOTE` | `forge-sync.ts:43-51`, `:133-138` |
| Leases | 40-minute grant lease, 20-minute heartbeat | `multitask-mode.md` § Grant lease |
| Tests | `bun:test`, colocated `*.test.ts`, run through `with-test-lock` | `scripts/lib/lane.test.ts` |

## Architecture coherence

- **Lane identity is per account (ADR-054 C4).** `openPrIndex` (`forge-sync.ts:69-92`) links every same-lane PR as own, and `claim.ts:54` answers `ALREADY-OWN`. Neither can tell two sessions of one account apart. A session-level discriminator is needed, and it must not widen the lane vocabulary.
- **Cross-cutting constraint, Trigger B score 3/3.** It spans the launch gate, the orchestrator dispatch and forge-sync. Ignoring it duplicates PRs and corrupts single-slot resources. It also forecloses silent solo starts.
- **State location.** The registry sits outside `.blackhole/` by necessity: per-worktree `.blackhole/` dirs are not shared. Like `.blackhole/.tmp/`, it is local and never carried on the state branch.

## Performance baselines

None measurable. Detection reads at most a handful of small JSON files per turn.
