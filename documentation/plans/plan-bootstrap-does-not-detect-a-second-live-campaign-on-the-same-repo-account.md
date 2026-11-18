---
type: plan
summary: "Plan for issue 1267: per-session heartbeat registry in the git common dir (peer-campaigns lib + CLI), launch-gate peer detection asking stop / join as peer / take over and parking under sleep mode, forge-sync another session: hold so a live peer's claims leave the ready set, Peers row stating reach"
status: current
review_trigger: "on file change"
created: 2026-11-18
last_updated: 2026-11-18
related:
  - documentation/decisions/ADR-057-peer-campaign-detection-registry.md
---

# Plan - Issue #1267

## Objective

Bootstrap must detect a live peer campaign on the same clone before the launch gate's questions. The gate then offers stop / join as `peer` / take over after the other drains, and never starts silently as `solo`. The ready set must exclude issues claimed by another live session. Design: ADR-057 (provisional number), Option B, a heartbeat registry in the git common dir (`.blackhole/plans/issue-1267-design.md`).

Pareto: Gain 8 × (11 − Effort 6) = **40**, at least 30.

Rulings: `rulings_checked_at: 7`, `ruling_conflicts: []`. Under sleep or print-only mode the gate parks the question and refuses to start, which is R-002's no-silent-default posture. R-005 is untouched: the change adds no stacking toggle.

## Touch-Paths

- `scripts/lib/peer-campaigns.ts` (new), `scripts/lib/peer-campaigns.test.ts` (new)
- `scripts/peer-campaigns.ts` (new CLI), `scripts/peer-campaigns.test.ts` (new)
- `scripts/lib/forge-sync.ts`, `scripts/lib/forge-sync.test.ts`
- `scripts/forge-sync.ts` (read the registry and pass `peerClaims`)
- `scripts/lib/campaign-status/launch-summary.ts`, `scripts/lib/campaign-status/launch-summary.test.ts`
- `scripts/campaign-status.ts` (pass detection into `buildLaunchSummary`)
- `scripts/lib/campaign-status/blocked-classes.ts`, `scripts/lib/campaign-status/blocked-classes.test.ts`
- `fixtures/**`: only if an existing forge-sync or launch-summary fixture needs the new optional field. None is expected.
- `src/references/launch-gate.md`, `src/references/multitask-mode.md`, `src/references/orchestrator-runtime.md`, `src/references/phase-stop.md`, `src/references/queue-dag.md`, `src/references/forge-sync.md`, `src/references/coordinator-dashboard.md`, `src/references/blackhole-state.md`
- plus all generated dist trees per `scripts/lib/build/targets.ts`
- Carried from `.blackhole/staged/1267/`:
  - `documentation/decisions/ADR-057-peer-campaign-detection-registry.md` (number re-checked at carry)
  - `documentation/decisions/INDEX.md` (`append_row`)
  - `ARCHITECTURE.md` (`append_row`)
  - `documentation/plans/plan-bootstrap-does-not-detect-a-second-live-campaign-on-the-same-repo-account.md`
  - `documentation/audits/analysis-issue-1267.md`
  - `documentation/investigations/bootstrap-does-not-detect-a-second-live-campaign-on-the-same-repo-account.md`
  - `documentation/INDEX.md` (regenerated)

Not touched: `src/agents/coordinator.md`. The bootstrap order is owned by `launch-gate.md`, and #1268 edits `coordinator.md`. No V-code row, so `blackhole-vcodes.md` and `facts.ts` stay untouched.

## Documentation Impact

- `launch-gate.md`:
  - bootstrap order gains a "peer detection" step
  - § Questions gains the peer question
  - § Print-only mode parks it and refuses to start
- `multitask-mode.md`:
  - new § Peer campaign registry
  - the "second orchestrator" rule now points to it
  - a `solo` session that a live peer names as `manager_session` acts as manager
- `orchestrator-runtime.md` § Session resume: heartbeat at turn start, each spawn round and triage.
- `phase-stop.md`: `release`.
- `queue-dag.md` Step 2, condition 6.
- `forge-sync.md`: the `another session:` bullet.
- `coordinator-dashboard.md`: Peers row values.
- `blackhole-state.md` Paths: the registry location (outside `.blackhole/`, local, never on the state branch).

New documentation files: ADR-057, the plan, the analysis and the investigation. Search-before-write: `grep -ril "peer campaign\|second live" documentation/` finds no existing doc for this concern.

## Critical Files

- `scripts/lib/forge-sync.ts`: queue ownership. A wrong hold or link misassigns PRs.
- `scripts/lib/campaign-status/launch-summary.ts`: the Peers row the owner reads before every start.
- `src/references/launch-gate.md`: the gate's question set and print-only rules.

## Codebase Conventions

| Concern | Follow | Evidence |
|---|---|---|
| Shape | Pure lib with injected clock, git resolver and fs; thin CLI (ADR-003) | `scripts/lib/lane.ts`, `scripts/forge-sync.ts` |
| Argv | `parseFlags`/`requireFlag` | `scripts/lib/argv-flags.ts` |
| Writes | `writeJsonAtomic` (tmp + rename) | `scripts/lib/campaign-status/record.ts:120` |
| Reads | `readJsonFile`. A torn or invalid record reads as absent, never throws | `scripts/lib/fs.ts` |
| Holds | Extend `LANE_NOTE` and reuse `applyLane`; never add a second hold path | `scripts/lib/forge-sync.ts:43-51`, `:133-138` |
| Lease | 40 min, the same value as `multitask-mode.md` § Grant lease. One exported constant in `peer-campaigns.ts` | `multitask-mode.md` |
| Invocation | Name the CLI in prose the way #1268 settles (script by path) | `.blackhole/plans/issue-1268.md` |
| Comments | No issue numbers in source comments (V-DOC-06) | rules |

## Database/API Schema Changes

1. **New registry record** at `$(git rev-parse --git-common-dir)/blackhole/campaigns/<session>.json`:

   ```json
   {"version":1,"session":"<uuid>","worktree":"<abs toplevel>","host":"<hostname>","host_session":"<id|null>","role":"solo|manager|peer","manager_session":"<id|null>","turn":157,"started_at":"ISO","heartbeat_at":"ISO","claims":[1240,1241]}
   ```

   `claims` lists every non-done queue entry that is `in-flight` or carries `pr != null`. A blocker can clear `in-flight` while the PR stays open, and that entry must stay claimed.

   The local self token lives at `.blackhole/.tmp/campaign-session.json` (`{"session":"<uuid>"}`).

2. **CLI** `scripts/peer-campaigns.ts`:
   - `heartbeat --campaign-dir <d> --turn <n> [--host-session <id>]`
   - `detect --campaign-dir <d>` prints JSON `{"verdict":"solo"|"peers","reach":"clone","peers":[{session,worktree,host,host_session,role,manager_session,turn,heartbeat_at,claims,names_me}]}`. It always exits 0; exit 1 only on an unreadable git common dir.
   - `release --campaign-dir <d>`

3. **Changed interfaces**:
   - `SyncInput.peerClaims?: Record<string, string>`, mapping issue number to peer session id. forge-sync builds the `another session: <session>` note text itself
   - `LaunchSummaryInput.peers?: DetectResult`
   - New note prefix `another session:` (`ANOTHER_SESSION` export)

## Threat Model

`security_review_required` is false. The spoofing check was requested, so the full table follows.

| STRIDE | Threat | Severity | Status |
|---|---|---|---|
| Spoofing | A forged registry record holds issues or forces the peer question | Low | Accepted Risk: it needs local write to `.git/`, the same trust as `queue.json`. The effect is fail-safe (hold or ask), never a grant |
| Tampering | A torn or garbage record crashes detection | Low | Mitigated: invalid records are skipped (AC on `parseRecord`), and writes are atomic |
| Repudiation | Not knowing which session held an issue | Low | Mitigated: the note names the session id, and the record names the worktree and turn |
| Information Disclosure | The record exposes the worktree path or host | Low | Accepted Risk: local file, never pushed |
| Denial of Service | A crashed session's stale record holds claims | Medium | Mitigated: the 40-minute lease expires, and "take over after drain" waits for it |
| Elevation of Privilege | A peer record grants slots or merge rights | Low | Mitigated: a record only ever removes issues from the ready set or triggers a question |

## Dependency Blast-Radius

| Consumer | Classification | Note | Verification |
|---|---|---|---|
| `scripts/forge-sync.ts:76` | TRANSPARENT | Optional `peerClaims` | reasoned: the field is optional and absent means today's code path |
| `scripts/lib/forge-sync.ts:192` | TRANSPARENT | The own-PR link skips lane-noted entries; `LANE_NOTE` gains `another session:` | reasoned: `!isLaneNote(next.notes)` already guards the link |
| `scripts/campaign-status.ts:320` | TRANSPARENT | Optional `peers` | reasoned: an optional input |
| `scripts/lib/campaign-status/blocked-classes.ts:61` | TRANSPARENT | `another session:` joins `another_lane` | reasoned: additive classification |

The implementer runs the post-change proof (V-INT-05). It runs the four consumers' own tests through `with-test-lock`, one file at a time, and quotes the result as `executed:` lines.

## Execution Strategy & Stop Conditions

- Stack on #1268. Both edit `launch-gate.md`, `multitask-mode.md`, `orchestrator-runtime.md`, `forge-sync.md`, `coordinator-dashboard.md` and `blackhole-state.md`. Also stack on #1303 if it is still open when `queue-dag.md` is edited. If `scripts/stack-check.ts` reports an overlap with no stack, then halt the dispatch and stack first.
- If `git rev-parse --git-common-dir` fails in a test fixture, then stop and inject the resolver, never shell out from lib code.
- If the new note makes any existing `forge-sync.test.ts` case change its expected `status` or `pr`, then abort that edit and revert to the previous `LANE_NOTE`. A legacy queue must sync identically.
- If ADR-057 is taken at carry time, then renumber to the next free number and update the INDEX row, the ARCHITECTURE bullet suffix and every reference before commit. If two ADR files share a number (V-ADR-05), then stop.

## Task Breakdown

- [ ] **TDD baseline**: run only the touched test files through `with-test-lock`. — **AC**: `forge-sync.test.ts`, `launch-summary.test.ts` and `blocked-classes.test.ts` are green on the base, with counts quoted. The full suite is left to CI.
- [ ] **T1 Registry lib (red first)**: `scripts/lib/peer-campaigns.ts`, with `PEER_LEASE_MINUTES = 40`, `parseRecord`, `livePeers(records, self, nowMs)` and `peerClaims(peers)` (issue to session id). — **AC**: tests prove each of the following:
  - a record with a heartbeat 39 min old is live, and one 41 min old is not
  - the self session is excluded
  - a record with the same `worktree` and `host` but another session is excluded as superseded self
  - a torn or invalid JSON record is skipped, not thrown
  - `peerClaims` maps each live peer claim to its session id
  - each test fails before the implementation
- [ ] **T2 CLI**: `scripts/peer-campaigns.ts` with `heartbeat`, `detect` and `release`. Git common dir and fs are injected for tests. — **AC**: an integration test against a temp git repo with two worktrees shows:
  - `heartbeat` in worktree 1 then `detect` in worktree 2 prints `"verdict":"peers"`, naming worktree 1 and its claims. These are its queue's `in-flight` entries plus a `blocked` entry carrying `pr`, which is claimed
  - after `release` in worktree 1, `detect` prints `"verdict":"solo"` and `"reach":"clone"`
  - a second `heartbeat` from the same worktree rewrites one file and does not add a second
- [ ] **T3 Ready-set exclusion**: `syncQueue` takes `peerClaims`. A `ready` entry it names is set to `blocked` with `notes: "another session: <s>"`. It goes back to `ready` when the claim is gone. The own-PR link at `forge-sync.ts:192` skips it. `scripts/forge-sync.ts` feeds `peerClaims` from `detect`. — **AC**: `forge-sync.test.ts` covers the following, and every pre-existing case is unchanged:
  - hold: a peer-claimed ready entry with an own-branch open PR stays `blocked`, `pr` is still null and it is not in `linked`
  - release: with no claim the entry is back to `ready`
  - precedence: a foreign-lane label note wins over the peer note
  - an `in-flight` entry is never touched
  - a peer-claimed entry that is `blocked` with an open own-branch PR is not linked (the post-blocker adoption case)
- [ ] **T4 Blocked class**: `classifyBlocked` maps an `another session:` note to `another_lane`. — **AC**: a `blocked-classes.test.ts` case asserts `'another_lane'` for that note.
- [ ] **T5 Peers row**: `buildLaunchSummary` accepts `peers`. With live peers the row value names the count and each peer's worktree basename, turn and heartbeat age, and the consequence says the gate will ask. With none, the value is `solo (no live peer in this clone)`. — **AC**: `launch-summary.test.ts` asserts both strings. `bun run status --summary` in a worktree with a live peer record shows the peer, quoted as runtime proof.
- [ ] **T6 Gate and protocol prose**:
  - `launch-gate.md`: bootstrap step "run `heartbeat`, then `detect`"; `release` when the gate refuses to start; § Questions gains the three options (join only when the peer has `host_session`); § Print-only parks it and refuses to start.
  - `orchestrator-runtime.md`: heartbeat at turn start, at each wake (20 minutes or less), at each spawn round and at triage.
  - `phase-stop.md`: `release`.
  - `queue-dag.md`: Step 2 condition 6.
  - `forge-sync.md`: the bullet.
  - `multitask-mode.md`: the registry section, plus "a solo session named as `manager_session` by a live peer acts as manager".
  - `coordinator-dashboard.md` and `blackhole-state.md`.
  - **AC**: `grep -n "peer-campaigns" src/references/launch-gate.md src/references/orchestrator-runtime.md src/references/phase-stop.md` returns at least 3 lines. `grep -n "another session" src/references/queue-dag.md src/references/forge-sync.md` returns at least 2. `bun run build` regenerates the dist trees, and `bun run verify` passes in CI.
- [ ] **T6b Join and take-over wiring**:
  - **Join**: the gate's "join as peer" answer goes through the launch gate's existing Adjust path. It writes `usage_budget.coordination.role: peer` and `manager_session: <peer host_session>` to config, and is offered only when the peer's `host_session` is non-null. `host_session` is recorded only on a host listed with a transport in `claude-code-native.md` § Cross-session budget transport. Everywhere else the gate offers two options, stop and take over.
  - **Take over**: the session leaves the orchestrator unspawned and re-runs `detect` on the next resume. It starts once no live peer remains (the record is released or the lease has expired).
  - **Manager side**: in `multitask-mode.md`, a `solo` session whose `detect` lists a live peer naming it as `manager_session` acts as manager.
  - **AC**: `launch-gate.md` § Questions lists the join option with the `host_session` condition, and the two-option fallback. `multitask-mode.md` carries the solo-to-manager sentence (`grep -n "manager_session" src/references/multitask-mode.md` shows the new line). A `peer-campaigns.test.ts` case shows `detect` reporting `names_me: true` for a peer whose `manager_session` equals this session's `host_session`.
- [ ] **T7 Carry**: carry `.blackhole/staged/1267/` per the manifest. — **AC**: `scripts/route-artifacts.ts --phase pr` exits 0 on the PR, and the ADR number is unique (V-ADR-05 clean).

## Test Strategy

- Unit tests on the pure lib (lease edges, self and superseded-self, torn reads).
- A focused integration test of the CLI on a temp repo with `git worktree add`, which proves the shared common dir.
- Extended forge-sync, launch-summary and blocked-classes specs.
- Locally: one spec at a time through `with-test-lock`. The full suite runs in CI (`ci-first-verification.md`).

## Sprint Contract

The task ACs above. Done when every T1-T7 AC holds and CI is green on the PR head.

## Diff Estimate and Split

About 900 lines (lib 180, lib tests 250, CLI 90 + 80, forge-sync 30 + 60, summary/class 40 + 55, prose 80). Optional split along the boundary, with PR 2 stacked on PR 1:

- **PR 1**: T1, T2, T5 and the gate prose (detection).
- **PR 2**: T3, T4, `queue-dag.md` and `forge-sync.md` (ready-set exclusion).

## Quality Gate Results

| Check | Result |
|---|---|
| `touch_paths_declared` | PASS |
| `schema_baseline` | PASS |
| `ac_mapping` | PASS |
| `critical_files_exist` | PASS |
| `mitigation_concrete` | PASS |
| `ac_sweep_conflict` | PASS |
| `ac_sweep_scope` | PASS |
| `touch_paths_ssot_gap` | PASS |
| `ac_facts_literal_bump` | PASS |

