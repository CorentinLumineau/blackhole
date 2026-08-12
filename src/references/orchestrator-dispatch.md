## Branch Tracking Sweep (issue #516)

Runs at the same cadence as the turn-start worktree/branch hygiene step already documented in
`orchestrator.md` § Git & Worktree Hygiene (`git worktree prune` / `git fetch --prune`) — this
section adds the sweep that step did not previously run, closing the gap the 2026-08-10 turn-4
wave incident exposed: campaign branches left tracking `origin/main` instead of their own remote
branch, one bare `git push` away from a direct push to a protected branch
(`V-BRANCH-01`/`V-BRANCH-02`). Confirmed root cause (reproduced independently): `git worktree
add -b <branch> origin/main` sets that upstream by default on every branch it creates — a
foreign-worktree `git push -u` (the original 2026-08-10 incident write-up) is a real but
*separate*, compounding failure mode, not the primary one. `phase-implement.md` § "Git
operations must not depend on inherited cwd" now passes `--no-track` at creation, which prevents
the mis-tracking outright for every branch created after that change lands. This sweep remains
the safety net — for branches created before the fix, and for any path that reaches `git
worktree add` without the `--no-track` flag.

Before spawning any wave of workers, sweep every local `blackhole/issue-*` branch for upstream
corruption:

```bash
git for-each-ref --format='%(refname:short)|%(upstream:short)' refs/heads/blackhole/ \
  | awk -F'|' '$2 == "origin/main" || $2 == "origin/master" {print $1}'
```

Any branch name printed by this sweep tracks a protected branch instead of its own remote
branch — dispatch MUST NOT proceed for that issue until it is repaired:

1. If `origin/<branch>` already exists (the worker already pushed once under the corrupted
   tracking): `git branch --set-upstream-to=origin/<branch> <branch>` repairs the pointer
   without touching history.
2. If `origin/<branch>` does not exist yet: the next push must use the explicit-refspec form
   (`git -C <path> push origin <branch>:<branch>`, never `-u`) per `implementer.md` §
   Explicit Git Targeting Gate — this both creates the correct remote branch and avoids
   repeating the corruption. This is a two-pass self-heal, not a one-shot fix: this sweep pass
   only stops the corruption from getting worse (the wrong upstream is still set locally); the
   actual `--set-upstream-to` repair from case 1 above lands on the *next* sweep, once
   `origin/<branch>` exists. Correct given the sweep runs every wave, but worth stating
   explicitly rather than leaving the reader to infer it.
3. Log the repair in `findings-ledger.json` (`kind: bug`) — no existing V-code cleanly names
   "branch upstream tracking corrupted"; `orchestrator.md`'s existing `V-BRANCH-04` citation sits
   next to `git worktree prune`/`git fetch --prune` with no formal definition in
   `blackhole-vcodes.md`, so this section does not assume it covers this case. Flag for a
   dedicated code rather than silently reusing an undefined one.

This sweep is the check that the protection against pushing to `main` does not rest solely on
`push.default=simple` (issue #516 AC) — a corrupted branch is caught here even if every other
mandate in this issue is somehow bypassed.

## Brainstorm dispatch precedence (ADR-010 D3)

Referenced from § Route-derived dispatch step 2.5 above (identical shape to the `docs_impact`
config-gate precedent in that same section) — separately budgeted per `V-CONTENTGATE-01`.

When `autonomy.brainstorm_routing` is true (`config-template.md`),
compare `route.confidence.brainstorm` against `.blackhole/config.json`
`router_confidence_thresholds.brainstorm` (default 70); below threshold, resolve to
`needs_brainstorm`'s cautious default (`true`) instead of the computed value. If the resolved
value is `true`: spawn `planner` with an explicit `track: brainstorm` directive; dispatch stops
here — `plan_mode`/`needs_design` are not evaluated for this issue (`queue-dag.md`'s voiding
rule). If `false`, or the config gate is off, continue to step 3 of § Route-derived dispatch
unchanged (zero-regression).



## Brainstorm terminal handling (ADR-010 D3)

Fixed ordering — do not reorder these steps; closing the issue or filing children before the
artifact PR merges breaks the audit trail (see the milestone plan's Threat Model, Repudiation
row).

On `planner` returning `status: ready, track: brainstorm`:

1. Spawn `implementer` with `execution_mode: docs-only`, Touch-Paths restricted to
   `documentation/brainstorms/{slug}.md`, Objective "commit the working draft from
   `.blackhole/plans/issue-N-brainstorm.md` into the durable artifact path, open a PR" —
   reusing the existing docs-only 5-Field Delegation Contract shape unchanged (no new fields).
2. Reviewer audits the PR per the **existing** docs-only branch of § Review pipeline below
   (unchanged — no new reviewer logic).
3. Wait for the artifact PR to reach `status: merged` (existing `merge-gate.md` path,
   unchanged).
4. Only after step 3: file the `children[]` from the planner's return through the **existing**
   `{{AGENT_DIR}}/skills/blackhole/references/phase-loop.md` § Continuous Discovery of
   Improvements path — one Priority computation and one `gh issue create` per child clearing
   the `>= 30` gate; children below the gate are logged `archived` in the ledger, never filed
   (identical rule, not a new one).
5. Close the original brainstorm issue: `queue.json` status transition `* → closed`
   (`queue-dag.md` § Status transitions, existing enum, no new status value) with `notes:
   "satisfied-by-children:<n1>,<n2>,..."` (extends the existing free-text `notes` convention)
   and an issue-closing comment referencing the merged artifact PR number and every filed child
   issue number (audit trail, mirrors the #152/#916 close-as-satisfied precedent).

On `planner` returning `status: blocked, track: brainstorm`: do **not** run terminal handling —
set `notes: awaiting-user-clarification` and surface `blocking_question` via the existing HITL
Blocker Gate mechanism (§ Human-in-the-Loop (HITL) & Blocker Gating below), unchanged.



## Escalation dispatch (implementer → investigator)

**Trigger condition**: `implementer` returns `status: blocked` with `escalation_trigger` set
(`failed_attempts` or `touch_paths_overrun` — `worker-schemas.md` § `escalation_trigger`). Do
**not** re-spawn `implementer` and do not treat this as a generic worker error — route to
root-cause investigation instead:

1. **`queue.json` mutation** (Bash/`jq`, atomic `.tmp` + `mv` write per `blackhole-state.md` §
   Write protocol): set `phase: implement`, `status: blocked`,
   `notes: "awaiting-investigation"` for the issue.
2. **Direct `investigator` spawn**, `sub_mode: investigate`, using the same spawn contract as
   `phase-handle.md` § Investigator agent. Declare the 5-Field Delegation Contract exactly like
   every other worker spawn:
   1. **Objective**: root-cause evidence gathering for the specific `escalation_trigger` value
      `implementer` returned.
   2. **Output format**: note at `plans/issue-N-investigation.md`. The orchestrator also passes
      `.blackhole/staged/<issue>/` as an absolute repo-root path per `blackhole-state.md` §
      Staging (ADR-021 D1) — not restated here.
   3. **Scope boundaries**: read-only — no code edits.
   4. **Tool guidance**: none — inherits `investigator`'s own tool policy.
   5. **Stop condition**: `status: complete` with the note on disk.
3. **Resume rule**: `investigator`'s note landing on disk is already the documented
   `investigation-landed` trigger (`router.md` § Re-route checkpoints) — re-spawn `router` per
   that existing, unmodified contract, then resume dispatch via § Route-derived dispatch above
   using the refreshed `route`. Once the re-route resolves, clear
   `notes: "awaiting-investigation"` and transition `status: blocked → ready` (existing
   transition, `queue-dag.md` § Status transitions — "user gate cleared" generalizes to
   "investigation gate cleared").

See `worker-schemas.md` § `escalation_trigger` for the field this section consumes.


## Investigator Escalation Dispatch (investigate sub-mode, issue #454)

**Trigger condition**: `investigator` (`sub_mode: investigate`) returns `status: "blocked"`
with `escalation_trigger: "hypotheses_exhausted"` set (`worker-schemas.md` §
`escalation_trigger` — Investigator subsection; `investigator.md` § `investigate` sub-mode's
Escalation subsection). Reuses the field `implementer.md` § Bugfix Gate already emits rather
than a parallel mechanism (`V-INT-03`).

The investigator never tracks its own escalation history — it reports hypothesis-set
exhaustion identically on every spawn (§ Escalation dispatch above's discovering-vs-deciding
SRP boundary applies here too). Bounding the escalation is entirely this dispatch's job,
tracked in `queue.json` `notes` — no new schema field, reusing the existing free-form `notes`
convention exactly as `checkpoint-protocol.md` § Blocked-Iteration Counter already does for
its own escalation marker.

1. **Bound check** (`blackhole-state.md` § Write protocol, atomic `.tmp` + `mv` read before
   the mutation): read the issue's `queue.json` `notes`.
   - **Absent `investigator-escalated`** → this is the issue's first hypothesis-exhaustion
     report. Go to step 2.
   - **Already contains `investigator-escalated`** → a second exhaustion has reached this
     dispatch path. Go to step 3 (block) instead of escalating again — do not apply a second
     tier bump even though `escalation_trigger` is set on this return; the bound is on
     *escalation count*, not on whether the field happens to be present.
2. **First escalation**: apply `model-routing.md` § Escalation rule — bump `investigator`'s
   tier one step from its § Task-tier matrix base (`economy → standard`) for the next spawn,
   same issue and role. In the same atomic write, set `notes: "investigator-escalated"`.
   Re-spawn `investigator`, `sub_mode: investigate`, using the same spawn contract as
   `phase-handle.md` § Investigator agent, at the bumped tier. This dispatch path stops here
   for this turn — resume rule mirrors § Escalation dispatch above's step 3 (the re-spawned
   investigator's note landing on disk is the `investigation-landed` re-route checkpoint
   trigger; unchanged, not restated).

   Note the deliberate divergence from `model-routing.md`'s own generic cap ("Cap at
   premium"): that rule permits a role to be bumped repeatedly up the full tier ladder across
   separate blocked returns. This dispatch path caps investigator's hypothesis-exhaustion
   escalation at exactly one bump, by design (issue #454 AC) — a second exhaustion is treated
   as evidence the issue needs a human, not a costlier model. The divergence is stated here
   explicitly rather than left implicit (ADR-012 R6 — never silent).
3. **Second exhaustion (blocking)**: set `status: "blocked"`, `notes:
   "investigation-inconclusive"` (atomic write) and route through the existing HITL Blocker
   Gate (`orchestrator.md` § Human-in-the-Loop (HITL) & Blocker Gating, "Blocker Gates" —
   unchanged, no new gate mechanism) so the coordinator surfaces it via `AskQuestion` with the
   investigator's note (both hypothesis sets and why each was refuted) as context.

See `worker-schemas.md` § `escalation_trigger` (Investigator subsection) for the field this
section consumes and `model-routing.md` § Escalation rule for the tier-bump mechanism this
section applies with the narrower cap above.


## Implementer assigned-write-root env (issue #620)

**Scope:** every `implementer` spawn only — not `planner`, `reviewer`, `orchestrator`, or
`coordinator`. The orchestrator and coordinator sessions must **not** set this variable; they
legitimately Write/Edit the main clone (especially `.blackhole/` campaign state).

**Contract:** at implementer spawn, export the issue worktree's absolute path before any
Write/Edit tool call in that session:

```bash
export BLACKHOLE_ASSIGNED_WORKTREE='<absolute wt-<N> path>'
```

The 5-Field Delegation Contract's Tool Guidance must list this `export` as the **first** shell
command in the session (same POSIX inheritance model as other `BLACKHOLE_*` hook env overrides
from #604). `validate-file-changes.js` reads it via `readAssignedWorktreeRoot(cwd)` in
`hook-event-log.js`: when set and the path is a registered member of `allWorktreeRoots(cwd)`,
containment narrows to `[assignedRoot]` only — writes to the main clone or a sibling worktree
are denied (`outside-assigned-worktree`, block tier). When unset, empty, or not a registered
family worktree: **fail open** to today's `allWorktreeRoots` behaviour (stderr notice, no deny).


## CI Failure Diagnosis Dispatch

**Trigger condition**: `phase-loop.md` § Merge protocol step 2 sub-bullet 4 — CI remains red
after the transient 2-retry cap (`merge-gate.md` § CI-wait poller Reclassification path reaches
Permanent).

**Dispatch**: orchestrator-inline, **not** a worker spawn — run
`bun run scripts/ci-diagnosis.ts --pr <n>` foreground, then apply `ci-diagnosis.md` § Fix-loop
routing (ledger `V-CI-01` append, `queue.json` → `phase: implement`, `review_iteration += 1`,
STOP merge steps 3–5). Full classification taxonomy, environment repair rerun, and implementer
spawn framing: `ci-diagnosis.md`.


## Design Autonomy Dispatch (ADR-010 D4)

Amends § Route-derived dispatch step 4 (`needs_design: true`) — this section owns only the
gated-verdict dispatch contract; it does not restate the confidence-gate/split/plan-mode
precedence chain above it.

When the returned `planner` worker JSON carries `track: "design"` and `status: "ready"` — only
possible when `planner.md` §4.8's gate produced it via `scripts/design-aggregate.ts`'s verdict
— the orchestrator treats this exactly like any other `status: "ready"` plan and proceeds
toward implement/PR dispatch without an `AskQuestion` gate (`phase-plan.md` § Plan approval
gate, autonomy-gate row).

The orchestrator applies only the worker JSON's `status` field as returned — it never
re-derives or second-guesses the verdict itself: this dispatch branch has no code path that
inspects design-note *content*, only the JSON `status` field, so there is no way planner prose
alone (independent of the script) could route an issue past the human gate.

When `status: "blocked"` — the config gate off/absent, or `design-aggregate.ts` itself
returned `blocked` — dispatch is unchanged from today: the design artifact routes to the
unconditional `AskQuestion` gate.

Resume-after-human-approval dispatch (`resume_context: design_approved`) is a distinct
contract — see § Design-Approval Resume Dispatch below.


## Design-Approval Resume Dispatch (ADR-012 E2.3)

Trigger: the coordinator resumes the orchestrator (`interrupt: false`) after clearing
`status: blocked` / `notes: awaiting-design-approval` on a `track: design` issue — the
resumption path T1 repairs (`coordinator.md` § Resolving Blockers).

Action: re-spawn `planner` with an explicit `resume_context: design_approved` directive —
never a generic re-spawn, which would re-run the whole Design Track (including two fresh
blind-critic invocations) and discard the artifact the human actually reviewed.

Directive provenance: `resume_context: design_approved` is set by the orchestrator **only**
in direct response to the coordinator's resume signal, itself downstream of the human's
parsed approval. The orchestrator never infers this directive from design-note content — it
is a pass-through of the human verdict, following the same explicit-directive-only
convention ADR-004 established for `track: design` / `track: brainstorm`.

The planner's third `## Gate` branch (`planner.md` §4.8) promotes the on-disk design
artifact verbatim on this directive; this section owns only the spawn-side dispatch
contract, not the promotion logic itself.


## Kaizen hunt dispatch

ADR-006's proactive counterpart to § Continuous Discovery above (which triages *reactive*
discoveries reported by workers/reviewers). Hunt waves are dispatched by three triggers: the
`hunt [kind]` SKILL mode (manual, any time), the on-empty check (`phase-loop.md` §
Campaign complete), and the every-n-loops interleave (`phase-loop.md` § Next batch step 0).
All three call into the same protocol — the entire spawn/dedup/gate/file/cap/watermark
mechanics and all four stop conditions are specified **once**, in
`{{AGENT_DIR}}/skills/blackhole/references/phase-loop.md` § Kaizen hunt dispatch — this
section does not duplicate that content; it owns only the `hunter` spawn contract.

**5-Field Delegation Contract for the `hunter` spawn:**

1.  **Objective**: The `kind` to scan (one of `kaizen.kinds`) and the territory band
    directive — the unscanned bands for that kind, derived from
    `hunt_state.kinds.<kind>.bands_done` — set as an explicit spawn-context directive, never
    self-selected by `hunter` (mirrors the `investigator` sub-mode dispatch precedent, §
    Investigator agent in `phase-handle.md`).
2.  **Output Format**: `hunter`'s JSON contract (`worker-schemas.md` § Hunter — pointer only,
    not restated here): `status`, `kind`, `wave`, `territory`, `findings[]`.
3.  **Scope Boundaries**: Read-only — no `queue.json`/ledger mutation, no issue filing.
    `hunter`'s own agent definition (`hunter.md`) already declares this; this contract line
    only restates the boundary at spawn time, per every other worker spawn's convention.
4.  **Tool Guidance**: None beyond `hunter`'s existing tool policy
    (`disallowedTools: [Write, Edit, Delete]`, same blanket restriction as every other
    coordinate/evidence-only agent in this file).
5.  **Stop Condition**: `status: complete` with `findings[]` populated (or empty array if
    nothing found), exactly one wave per spawn — `hunter` never loops internally across
    waves, even when `territory.exhausted` comes out `false`.

Model tier: `standard` (§ Worker spawn model above; `model-routing.md`'s `hunter` row is the
SSOT for the rationale).

Filing/dedup/watermark mechanics (V-PARETO-02 gate + bug severity floor, ledger idempotency
dedup, `[Kaizen]` issue filing via `filing.md`'s template, `max_issues_per_wave` cap,
`hunt_state` watermark write, and all four stop conditions — territory exhausted, `max_waves`,
3 dry waves, gated-batch mid-flight no-op): see `phase-loop.md` § Kaizen hunt dispatch (single
source, not duplicated here).

## Spawn-Time Touch-Paths Amendment (issue #603)

Closes the gap where an orchestrator-authorized Touch-Paths change lives only in the ephemeral
spawn prompt: the reviewer audits the diff against the durable plan artifact
(`.blackhole/plans/issue-N.md`), which never learned about it, and correctly reports `V-SCOPE-02`
against a change the orchestrator itself authorized (concrete instance: PR #602 / issue #573).

**Trigger**: the orchestrator is about to authorize, in a worker's spawn prompt, a Touch-Paths
change that diverges from the plan's declared `## Touch-Paths` section — either widening it
(a path added beyond the list) or narrowing it (a path removed from the list).

**Procedure**: before spawning, append a dated `## Scope Amendments` entry to
`.blackhole/plans/issue-N.md` — create the section on first use — via the same atomic `.tmp` +
`mv` write already governing that file (`blackhole-state.md` § Write protocol). Exact entry
format, the `widen`/`narrow` vocabulary, and a worked example: `plan-template.md` § Scope
Amendments (not restated here — `V-DRY-01`).

**The spawn prompt alone is never sufficient authorization.** An unamended spawn-time Touch-Paths
change is exactly the case `V-SCOPE-02` is meant to catch, and correctly does — the amendment
above is what closes the gap, not a reason to treat the spawn prompt as self-authorizing.
