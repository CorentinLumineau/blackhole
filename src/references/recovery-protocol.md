# Recovery Protocol — Mixed-Issue Worktrees & Stashes

Binding recovery procedure for polluted git worktrees and mixed-issue stashes that violate one-PR-per-issue (`V-BRANCH-02`). Complements `checkpoint-protocol.md` (queue/checkpoint layer) with a decision tree for dirty worktrees holding changes from multiple issues.

See also: `phase-implement.md` (worktree naming), `queue-dag.md` (wave scheduling after split), `queue-dag.md` (`route` object schema), `findings-ledger.md` (`routing_decisions` audit trail), `documentation/decisions/ADR-004-adaptive-phase-routing.md` (source ADR for §8 and the interrupted state in §6(d)), `orchestrator.md` § Error Classification (Transient / Permanent / Partial-Corruption — sole taxonomy, not restated here).

§4's decision tree below operationalizes the **Partial/Corruption** path specifically for dirty worktrees and mixed-issue stashes — it does not redefine the taxonomy.

---

## §1 Problem

Campaign workers operate in isolated worktrees (`<scratchpad>/wt-<issue>` on branch `blackhole/issue-<issue>`). When a session crashes, compacts, or an implementer edits outside touch-path scope, a single worktree may accumulate uncommitted changes or commits spanning **multiple** issues. That violates `V-BRANCH-02` (one issue per branch/worktree) and `V-SCOPE-02` (touch-path boundaries).

Recovery must restore the **one-issue-per-worktree** invariant before any `implementer` is (re)spawned.

---

## §2 Detection

Run at orchestrator turn start and during compaction recovery (after reading checkpoint):

```bash
git worktree list
git -C <scratchpad>/wt-<issue> status --porcelain
git -C <scratchpad>/wt-<issue> stash list
```

**Dirty** when:

- `git status --porcelain` is non-empty for the worktree, **or**
- stash entries reference the worktree path or carry recovery tags (`recovery-issue-<N>`, `recovery-abort-wt-<issue>`, `recovery-plan-missing-<N>`).

---

## §3 Map uncommitted files to issues

Before choosing abort vs split vs cherry-pick, build a file→issue map:

1. Collect dirty paths from `git status --porcelain` (and `git diff --name-only` for unstaged).
2. For each in-flight issue `#N` in `queue.json`, load:
   - `.blackhole/plans/issue-N.md` → `## Touch-Paths`
   - `queue.json` → `issues.*.touch_paths`
3. Match each dirty file against globs (simple prefix/glob match). Prefer plan `## Touch-Paths` when present (more specific than queue globs).
4. Build map: `{ issue: [files...] }` plus `unmapped: [files...]`.
5. If `unmapped` is non-empty → default **abort or coordinator gate** — do **not** spawn implementer until resolved.

When ambiguous overlaps occur (one file matches multiple issues), escalate to coordinator (§7).

---

## §4 Decision tree: abort vs split vs cherry-pick

| Situation | Action |
|-----------|--------|
| All dirty files map to **one** issue `#N` and worktree is `wt-N` | **Resume** — clean staging if needed, re-spawn implementer |
| Dirty files map to **multiple** issues, changes are **uncommitted** only | **Split** — per-issue partial stash or `git add -p` by touch_paths; park non-target files in stash tagged `recovery-issue-<N>`; one issue at a time |
| Dirty files map to multiple issues but include **commits** on wrong branch | **Cherry-pick** — identify commits per issue (`git log --oneline`), cherry-pick onto correct `blackhole/issue-N` branches in correct worktrees |
| Unmappable files, corrupted state, or wrong base branch | **Abort** — `git stash push -u -m "recovery-abort-wt-<issue> <ISO8601>"` or discard if user approves; `git worktree remove --force`; reset queue issue to `ready` / re-plan |
| Worktree branch PR already merged | **Stale cleanup** — see Example (c); no cherry-pick |

Enforcement gates: `V-BRANCH-02`, `V-WORKTREE-01`, `V-SCOPE-02`.

---

## §5 Orchestrator checklist before re-spawning implementer

After crash or compaction recovery, **complete this checklist** before spawning `implementer`:

1. Complete `checkpoint-protocol.md` compaction steps (read checkpoint, forge sync, validate JSON).
1b. Run §9 artifact-vs-queue drift scan for every `status: in-flight` issue; heal stale
    worker state before any worker spawn (router, planner, implementer, reviewer). Use
    `scripts/recovery-drift.ts` helpers (`detectArtifactDrift`).
2. Run `git worktree prune` + `git fetch --prune` (`V-WORKTREE-01`).
2b. For every in-flight issue with a `route` object present in `queue.json`, run §8
    Route staleness check before any dispatch decision (planner, investigator, or
    implementer) for that issue. Skip when `route` is absent.
3. For each in-flight implement issue: run §2 detection.
4. If dirty: execute §3 map + §4 decision tree — **do not spawn** until worktree matches single-issue scope.
5. Confirm plan artifact exists at `{repo_root}/.blackhole/plans/issue-N.md` and planner returned `status: ready`. **Track-agnostic**: a `skip`-track rationale record (4-line Objective / Touch-Paths / Why-no-plan / Rollback, ADR-004 — `skip` track ships in issue #94) at this same path satisfies this check identically to a Quick or Standard plan — the check is existence-only (`V-PLAN-01`), it has never inspected `track`, and must not start now.
5b. Confirm no interrupted research/investigation state exists (§6 Example (d)) — if
    `route.needs_research` or `route.needs_investigation` is true and the evidence
    artifact is absent, respawn `investigator` (#96) before proceeding to plan or
    implement dispatch.
6. Confirm `queue.json`: `phase: implement`, `status: in-flight` or `ready` as appropriate.
7. Log recovery action in `campaign-checkpoint.md` Notes (e.g. `Recovery: split stash wt-11 → #11 + #13`).
8. Only then spawn `implementer` with `<PLAN_CONTEXT>`.

---

## §6 Examples

### (a) Plan missing

Queue shows `#N` with `phase: implement` but `.blackhole/plans/issue-N.md` is absent.

This is file-*absence*, not track-mismatch — a `skip`, `quick`, or `standard` artifact at that path all count as present (see §5 step 5).

**Action:** Do **not** spawn implementer. Set `phase: plan`, `status: ready`; spawn `planner`. If worktree has dirty files, stash with `recovery-plan-missing-N` or abort worktree per §4.

### (b) Mixed-issue stash

`wt-11` is dirty with files mapping to #11, #13, and #10 touch_paths.

**Action — Split:**

```bash
git stash push -m "recovery-11" -- <paths-for-11>
# repeat per issue
```

Pop stash in the correct `wt-<issue>`; spawn implementers one wave at a time, respecting touch_paths conflicts (`queue-dag.md`).

### (c) Stale worktree after PR merge

`gh pr view` shows PR for `blackhole/issue-11` merged; `wt-11` still exists.

**Action — Abort/cleanup:**

```bash
git worktree remove <scratchpad>/wt-11
```

Prune branch; set queue `#11` `phase: done`. Do **not** cherry-pick unless unmerged commits remain on branch (then cherry-pick to new branch only if issue still open).

### (d) Research/investigation artifact missing

Queue shows `#N` with `route.needs_research` or `route.needs_investigation` true,
`computed_at_phase`/`phase` indicating the evidence-gathering step is in progress
(`phase: handle`, `status: in-flight`), but no corresponding artifact
(`issue-N-research.md` or `issue-N-investigation.md`) exists on disk.

**Action:** Mirrors (a) Plan missing. Do **not** proceed to plan-mode dispatch.
Respawn `investigator` (issue #96) for the missing sub-mode (`research` or
`investigate`) — the interrupted evidence-gathering step must complete before the
downstream flags it feeds (`needs_design`, `plan_mode`, `security_review_required`,
per `documentation/decisions/ADR-004-adaptive-phase-routing.md` "Re-route checkpoints") can be trusted. If the worktree/stash state
is also dirty, resolve per §4 first. As with (a), this is a doc-only rule ready for
when the `investigator` agent lands — no dispatch code acts on it yet.

---

## §7 Coordinator escalation

When abort vs split is non-obvious or data-loss risk exists:

1. Set `status: blocked`, `notes: awaiting-recovery-approval` in `queue.json`.
2. Delegate to `coordinator` with the file map table from §3.
3. Do not spawn implementer until coordinator clears the gate.

---

## §8 Route staleness check (ADR-004)

Applies only when the `queue.json` issue entry has a `route` object present
(`src/references/queue-dag.md` `### \`route\` object`). Absent `route` = pre-ADR-004
behavior — skip this section entirely, no staleness check applies.

**Rule** (ADR-004 "Recovery protocol (extended)"): on every resume — crash recovery,
compaction recovery, or a fresh orchestrator turn picking up an issue with an existing
`route` — before dispatching *any* worker (planner, investigator, or implementer) for
that issue, verify the route is not stale:

1. Recompute the current issue body hash (title + body, same hash function the router
   uses at classification time — router ships in issue #95).
2. Compare to `route.body_hash`.
3. Check whether a research or investigation artifact for this issue
   (`issue-N-research.md` / `issue-N-investigation.md`, investigator ships in issue #96)
   exists on disk with a revision/timestamp that postdates `route.revision`'s last bump.
4. **Stale** when either (2) mismatches or (3) is true. Route is **not** stale merely
   because time has passed — only a body change or a newer artifact invalidates it.

**On stale**: do not dispatch. Force a re-route (router agent, issue #95) before
resuming the chain — never act on flags computed against evidence that no longer
matches reality. This is a hard rule, not best-effort, mirroring the ADR's own
three synchronous re-route checkpoints (`documentation/decisions/ADR-004-adaptive-phase-routing.md` "Re-route checkpoints" table)
but applied defensively on the recovery/resume path specifically, because recovery is
asynchronous and the queue can sit blocked for days — unlike the synchronous
checkpoints, staleness here cannot be assumed away by "no checkpoint fired yet".

**Non-goal for this issue**: no orchestrator/agent logic reads or writes `route` yet,
and the router/investigator agents that would act on a stale-route signal do not exist
yet (issues #93, #95, #96). This section documents the recovery-side rule so it is
ready the moment those land — it is not a behavior claim about the current codebase.

---

## §9 Artifact-vs-queue drift

Background workers (router, planner, implementer) finish and persist deliverables, but
the orchestrator never triages — queue rows remain `status: in-flight` with stale
notes/checkpoint worker rows while artifacts already exist (primary cause: Cursor Multitask
idle stall per #151, deferred finding F-00013).

### §9.1 Problem

| Symptom | Queue state | Artifact on disk |
|---------|-------------|------------------|
| Router finished, orchestrator stalled | `phase: handle`, `status: in-flight`, notes reference router/WAVE 0 | `issues.N.route` with `body_hash` |
| Planner finished, orchestrator stalled | `phase: plan`, `status: in-flight` | `.blackhole/plans/issue-N.md` exists |
| Implementer finished, orchestrator stalled | `phase: implement`, `status: in-flight` | `issues.N.pr` set; forge PR open |

### §9.2 Detection

Run at orchestrator turn start, compaction recovery, and session resume — for every
`status: in-flight` issue, **before** spawning workers:

| Worker | Artifact present | Drift signal (queue and/or checkpoint) |
|--------|------------------|----------------------------------------|
| `router` | `issues.N.route` object with `body_hash` | `phase: handle` + notes/checkpoint still reference router/WAVE 0 in-flight |
| `planner` | `.blackhole/plans/issue-N.md` exists | `phase: plan` + `status: in-flight` (no `pr`) |
| `implementer` | `issues.N.pr` set and `gh pr view` shows open PR | `phase: implement` + `status: in-flight` |

Pure detection helper: `scripts/recovery-drift.ts` → `detectArtifactDrift(issueId, issue, context)`.
Context carries `{ planExists, routeStale, prOpen, checkpointWorkers, notes }`.

When `routeStale` is true (§8), router drift heal is suppressed — staleness forces re-route
instead of advancing on a stale `route`.

### §9.3 Heal actions

Idempotent — safe on second resume:

1. Clear stale `notes` (e.g. `"router initial pass (WAVE 0)"`) and remove completed worker
   rows from `campaign-checkpoint.md` `## In-flight workers`.
2. Transition queue per normal dispatch rules:
   - **Router done** + route not stale (§8): `phase: plan`, `status: ready` (or `blocked` if
     `route.needs_clarification`); do **not** re-spawn `router`.
   - **Planner done**: `phase: implement`, `status: ready` when plan artifact exists and
     planner JSON was `status: ready`.
   - **Implementer done** (open PR): `phase: review`, `status: ready` (or `in-flight` if
     reviewer already spawned — match `phase-review.md`).
3. Log heal in checkpoint Notes: `Recovery: artifact-drift #N <worker> → <next-phase>`.

### §9.4 Idempotency

After heal, drift signals must be absent. A second turn-start pass must **not** spawn
duplicate router/planner/implementer for the same `body_hash`/plan revision. Explicit guard:
skip spawn when artifact + target phase already satisfied (`heal.skipSpawn` from
`detectArtifactDrift`).

### §9.5 Non-goal

Does not fix #151 root cause (coordinator/orchestrator wake); complements #152 docs and
optional #154 prevention.
