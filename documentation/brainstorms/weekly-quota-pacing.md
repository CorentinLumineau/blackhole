---
type: brainstorm
summary: "Requirements and priorities for spending the weekly plan quota up to a 17.5%-per-weekday pace floor with blackhole, under an 80% 5h cap and without colliding with other sessions or accounts"
status: current
review_trigger: "on ADR acceptance"
created: 2026-11-17
last_updated: 2026-11-17
related:
  - documentation/decisions/ADR-054-catchup-mode-quota-pacing.md
---

# Brainstorm: Weekly quota pacing and scheduled blackhole burn

## Problem Statement
The weekly plan quota (Max, resets Tuesday 11:00 local = 10:00Z) is wasted when interactive
usage stays below pace. Goal: at 6pm each weekday, read usage; if weekly usage is below the
pace floor, run a blackhole campaign on ssl-management to burn the shortfall. Never push a 5h
window past 80%. Never collide with other sessions, colleagues or accounts. v1 covers one
account; the 3 other subscriptions come later.

## Pace Model
Budget 17.5% per weekday (90% cap over 5 weekdays, 87.5% floor at reset). Tuesday counts as a
half day (reset at 11:00), so credits at 6pm are Tue 0.5, Wed 1.5, Thu 2.5, Fri 3.5, Mon 4.5,
5.0 at the reset. Floor = 17.5% x credit.

| 6pm gate | Floor |
|---|---|
| Tue | 8.75% |
| Wed | 26.25% |
| Thu | 43.75% |
| Fri | 61.25% |
| Mon | 78.75% |

Shortfall = floor - weekly%. Skip when shortfall <= 0.

## Capacity Model
Owner-observed: a full 5h window = 11-17% of the weekly quota. At the 80% 5h cap, one window
burns at most 8.8-13.6% of weekly.

| Need | Windows at 80% cap |
|---|---|
| One weekday of pace (17.5%) | 1.3-2.0 |
| Full week to 87.5% | 6.4-9.9 |
| 6pm to 9am overnight chain | 3 windows = 26-41% of weekly |
| Weekend (48h) | ~9 windows = 79-122% of weekly |

Consequence: a single 6pm run cannot cover a full day's shortfall. The gate re-fires at each 5h
window reset through the night, and the weekend is the largest catch-up buffer.

## Requirements

### Must Have
- [ ] F2 Pace gate: read `get_usage`, compare weekly% to the floor, skip and log when above
- [ ] F3 + F7 Stop at 5h >= 80% or when the shortfall is covered; re-read usage between tasks
- [ ] F1 Weekday gate fires at 6pm, then re-fires at each 5h window reset until 9am (about 3 windows), in the desktop app with a keep-awake request
- [ ] F4 + F5 Blackhole scoped to ssl-management; claim each issue before work, release on exit
- [ ] F6 Claim marking enforced in the mercure and blackhole plugins (assignee at minimum, owner label preferred)
- [ ] N1 Resource-frugal: with-test-lock, one test tree at a time, CI-first verification
- [ ] N2 Idempotent: a double fire or retry never doubles the burn
- [ ] N3 Fail-safe: skip the run when usage cannot be read

### Should Have
- [ ] Pre-reset sweep (Monday night to Tuesday 10am) topping up to the 87.5% floor
- [ ] F8 Run log: usage before and after, floor, issues touched, stop reason
- [ ] N4 Single parameter set (floor, caps, hour, repo) so the task clones per account
- [ ] Weekend catch-up: Friday-evening-to-Monday-morning windows burn toward the Monday floor (about 9 windows of capacity)

### Could Have
- [ ] Relax the 80% 5h cap during hours with no interactive work (night, weekend). Conflicts with the stated "never" rule: owner decision

### Won't Have (v1)
- Multi-account rollout (next: clone the task per signed-in account)
- Cloud routine (usage read and repo access unproven there)
- Dashboard (the F8 log covers most of the value)

## Scope Decision
Plugin improvements (mercure and blackhole) are allowed, delivered in pair with the scheduled
task. F6 (claim marking at plugin level) is therefore part of the same deliverable, not a
follow-up.

## Constraints
- Machine must be awake at 6pm
- `get_usage` reads only the signed-in account
- 80% 5h cap limits one window to 8.8-13.6% of weekly, so a day's shortfall always needs 2+ windows
- Interactive work during a burn competes for the same 5h window

## Success Metrics
- Weekly usage at reset: 87.5-90%
- Peak 5h usage during any burn: <= 80%
- Issue collisions: 0
- Every skip day logged with floor and actual usage

## Open Questions (for research)
1. Does the 11-17% window ratio vary by model (Opus vs Sonnet)? If Sonnet stretches a window further, burn runs should pin a cheaper model.
2. Which forge claim mechanism do mercure and blackhole already use (labels, assignee)? Where should it be enforced in each plugin?
3. Does a scheduled task fire while the app is idle or asleep, and does keep-awake cover it?
