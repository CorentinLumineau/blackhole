---
type: adr
summary: "Run context routes a Claude Project thread with fan-out and a question channel to Pattern P: the thread session orchestrates, clarify gates are decision cards, the status checklist is the dashboard, the coordinator relay is the intake, CI waits on PR events with a pure ci-verdict.ts over the checks snapshot, and kaizen triggers and CI check-ins become routines when the session can create them"
status: accepted
review_trigger: "on a change to Claude Project thread tools (decision cards, status, PR subscriptions, routines)"
created: 2026-10-11
last_updated: 2026-10-11
related:
  - documentation/decisions/ADR-046-run-context-resolution.md
  - documentation/decisions/ADR-048-github-rest-forge-channel.md
  - documentation/decisions/ADR-049-branch-state-store.md
---

# ADR-050: Project-thread pattern (Pattern P)

## Status

Accepted — 2026-10-11 (phase 6 of the run-accuracy plan, approved by the owner).

## Context

A Claude Project thread is a different host from a terminal. Users read a thread, not the
session's output. They answer decision cards, and they see a status checklist. The thread wakes
on user messages, coordinator relays, PR events and routines, then ends its turn. Under ADR-046
such a thread resolved to Pattern C. Pattern C still asks through `AskUserQuestion`, prints the
dashboard to chat, and waits for CI with a 60-second background poll. None of those reach a
Project user, and the poll keeps a turn open that a PR event would wake for free.

## Decision

1. `routeRunContext` returns pattern `P` for host `claude`, surface `project-thread`, with
   fan-out and a question channel. It adds `schedule: routine | turn` to every route.
2. `project-thread-mode.md` binds Pattern P:
   - the thread session orchestrates and the coordinator relay is intake;
   - clarify gates are decision cards;
   - the status checklist is the dashboard;
   - `ci_wait: pr-events` replaces the poll with subscribe, end turn, verdict on wake;
   - `schedule: routine` turns a kaizen trigger and a CI safety-net check-in into routines.
3. `scripts/ci-verdict.ts` computes green/red/pending from any checks snapshot (REST, MCP,
   combined status, or adapter output), with Vercel previews excluded. It serves both the poll
   and the event path, so they cannot disagree.
4. Cursor keeps its Subscriptions and Automations mapping. Pattern P is Claude-only.

## Alternatives Considered

- **Keep Pattern C in threads and add thread notes.** Every gate and dashboard step would carry
  a host branch. One pattern with its own bindings is easier to follow and test.
- **Event-only CI wait with no check-in.** A lost event would stall the merge forever. The poll's
  20-minute cap exists for that reason, and the routine check-in keeps it.
- **Parse the PR event payload for the verdict.** The event is a wake signal whose shape the
  host owns. Re-reading checks through the forge channel gives the same input as the poll path.

## Consequences

- Campaigns in Project threads ask, report and wait through the thread's own tools.
- The merge gate's CI verdict is a script result, testable from recorded snapshots.
- `schedule` is a new route field, and every run-context fixture carries it.
