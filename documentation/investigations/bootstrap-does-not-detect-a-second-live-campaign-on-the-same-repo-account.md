---
type: analysis
summary: "Root cause of issue #1267: no bootstrap step reads another campaign session's existence, the Peers row renders only the configured coordination role, and the per-account lane makes forge-sync link a same-account peer's PR as its own and claim.ts answer ALREADY-OWN"
status: current
review_trigger: "on rule update"
created: 2026-11-18
last_updated: 2026-11-18
related:
  - documentation/decisions/ADR-057-peer-campaign-detection-registry.md
  - documentation/decisions/ADR-054-catchup-mode-quota-pacing.md
---

# Investigation: a second live campaign goes undetected (issue #1267)

## Symptom

Two `run` campaigns on the same repo and account ran concurrently, in two worktrees of one clone, with separate `.blackhole/` state. Session B's launch gate printed `Peers: solo` and `0 in flight`. Its ready set included issues session A had already claimed (`in-progress:claude`, fresh PRs).

## Hypotheses and verdicts

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | The Peers row reflects only config, never observed sessions | **Confirmed** | `scripts/lib/campaign-status/launch-summary.ts:230-238` reads `rowSettings(config).settings.coordination` only. The `solo` default prints `solo` |
| H2 | forge-sync cannot distinguish a peer of the same account | **Confirmed** | `forge-sync.ts:73-78`: with no lane, `isOwnLaneBranch`; with a lane, `lanes.includes(lane)`. Both are per account. The own PR is then linked into this queue (`:191-195`) |
| H3 | The dispatch claim refuses a peer's claim | **Rejected** | `claim.ts:54` returns `ALREADY-OWN` when the own-lane label and the same assignee are present |
| H4 | The "no second live orchestrator" rule is enforced | **Rejected** | `multitask-mode.md` lists it under "never", but only within one coordinator. There is no detector across sessions |
| H5 | The state branch would have revealed the peer | **Rejected** | `state-branch.md`: pushed only under `state_store: branch`, at turn end. The incident used local state. Two branch-store campaigns would also contend on the same `blackhole/state` branch (a rejected push), a separate symptom |

## Root cause

Campaign identity stops at the account and lane level. No artifact names the session, so nothing at bootstrap or sync can see a second session. Fix direction: ADR-057, a per-session heartbeat registry in the git common dir.

## Residuals

- Cross-clone and cross-machine peers are still undetected. The Peers row states reach `clone`.
- Two sessions can race one dispatch between syncs. The heartbeat at dispatch narrows this to seconds.
