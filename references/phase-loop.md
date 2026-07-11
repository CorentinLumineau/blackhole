# Phase 5 — Loop

## Checklist

```
- [ ] Auto forge sync (native — no user prompt)
- [ ] BLOCK/WARN unresolved? → phase implement (same issue)
- [ ] LGTM AND mergeEligible(issue)? → merge PR (runbook quality gates)
- [ ] queue.json: status merged, phase done
- [ ] Resolve/defer ledger entries for this issue/PR
- [ ] forge-sync.md protocol
- [ ] Compute ready set (queue-dag.md)
- [ ] Persist queue.json → findings-ledger.json → campaign-checkpoint.md when in-flight work exists (checkpoint-protocol.md)
- [ ] Spawn parallel batch (up to parallel_max) — one turn, end turn
- [ ] Open issues + open PRs both zero? → campaign complete
```

## Merge protocol

**Trigger, per `config.json.merge_mode`** (checklist line "LGTM AND
`mergeEligible(issue)`? → merge PR"):
- `"immediate"` (default): apply steps 0-5 below to each LGTM'd issue
  individually, as encountered.
- `"gated-batch"`: do **not** apply steps 0-5 issue-by-issue as encountered.
  Instead, once `merge-gate.md` § 1 Condition 3 is satisfied for the whole
  in-scope set (every sibling LGTM'd), run `merge-gate.md` § 4's sequential
  batch procedure — it internally invokes steps 0-5 below, once per issue, in
  topological `merge_after` order, persisting `queue.json` after each. Do not
  duplicate § 4's ordering/persistence logic here; this section owns only the
  per-PR merge mechanics § 4 calls into.
- `"leave-open"` (ADR-006): do **not** apply steps 0-5 to these issues at
  all — no `mergeEligible(issue)` call, no `gh pr merge` (see `merge-gate.md`'s
  bypass note). Once `review-core.md`'s `isLgtm(issue)` is true, treat the
  issue as delivered for campaign-complete purposes only: annotate
  `queue.json`'s `notes` field (not `status`/`phase`) — e.g.
  `"delivered-at-LGTM (leave-open) — awaiting human merge"` — and leave the PR
  open. The actual external merge is picked up later by the normal
  forge-sync externally-observed-merge reconciliation path (unchanged,
  generic — no new logic needed here beyond citing it; see `merge-gate.md` §
  3).

0. Evaluate `merge-gate.md` § 1 `mergeEligible(issue)`. If `false`, **STOP** —
   do not proceed to step 1 for this issue (leave it `in-flight`; re-evaluated
   next turn). This step is binding wherever this section is cited or
   delegated — never skip it to reach step 1 directly.
1. `gh pr view <n> --json headRefOid` equals local HEAD
2. CI-wait: a detached background poll, never a foreground agent sleep. `gh pr
   checks <n>` must reach green (except Vercel preview — expected fail), but
   the orchestrator does not block the turn on it synchronously
   (`V-PARETO-01` — no LLM turn sleeping >10 min in a foreground poll loop).
   Spawn the check as a background-executed command per harness — Bash
   `run_in_background: true` + notification (Claude Code), background `Task`
   + `Await` on the task id (Cursor), or the equivalent detached-poll
   primitive on other harnesses — and use the same **Background worker
   barrier** idiom already documented in `orchestrator.md` (§ Background
   worker barrier) to resume steps 3-5 once the CI-green signal lands,
   instead of ending the turn and chat-polling. Poll interval/cap are
   specified in `merge-gate.md` § 0 (this section owns only the mechanics
   below, not the contract numbers).
   1. **`cancelled` conclusion with no real error**: if `gh pr checks <n>`
      (or `get_failing_step_logs`/`gh run view --log-failed`) shows a run
      concluding `cancelled` with no corresponding failing-step error, run
      `gh run rerun <run-id>` once (`&&`-chained per this file's existing gh
      convention) and resume the poll.
   2. **"Base branch was modified"**: if `gh pr checks <n>` /
      `mergeStateStatus` reports the PR's base was modified mid-watch,
      re-fetch `target_branch` and retry the check once.
   3. **2-retry cap**: if either rule's single retry does not resolve to a
      clean green/red CI result, reclassify per `orchestrator.md` § Error
      Classification (Transient → Permanent path) — do not restate that
      table here.
3. Run the project's build command in main clone (if applicable)
4. `gh pr merge --squash` (use `&&` only, never `;`) — immediately after this
   command succeeds, in the **same** atomic `queue.json` write that sets
   `status: merged`, also set `merged_by: blackhole` on the issue (ADR-005 —
   see `merge-gate.md` § 3 for why: this is the sole signal `V-MERGE-01`/
   `V-MERGE-02` attribution relies on; `status: in-flight` alone does not
   indicate blackhole itself performed the merge and must not be used for
   attribution).
5. Post-merge: migration apply if schema PR; deploy verify per runbook

## Ledger cleanup on merge

For issue N, PR P:

- Reset `review_iteration` to 0 on merge
- `fixed-in-pr` → `resolved`, `resolved_at` set
- `open` BLOCK on merged files → file new issue or `resolved` if obsolete
- `deferred` → keep until deferred issue merges
- Under `merge_mode: leave-open`, `fixed-in-pr` rows stay `fixed-in-pr` (not
  `resolved`) until the later forge-sync observes the real external merge —
  do not resolve them prematurely at LGTM time.

## Next batch

0. **Every-n-loops kaizen interleave** (ADR-006, gated by `kaizen.enabled` — no-op when the
   `kaizen` block is absent or `kaizen.enabled: false`, per `config-template.md`'s contract
   note): when `kaizen.trigger == "every-n-loops"`, increment `hunt_state.loop_counter` (new,
   additive top-level integer field under `hunt_state`, sibling to `kinds`) as part of this
   turn's normal `hunt_state` read-modify-write. If `loop_counter % kaizen.loop_interval == 0`,
   dispatch **one** hunt wave — round-robin kind selection per the "Round-robin kind selection"
   convention (cycle `kaizen.kinds` in array order; among kinds where
   `hunt_state.kinds.<kind>.exhausted != true`, pick the lowest `waves` count, ties broken by
   array order) — following the full wave protocol in § Kaizen hunt dispatch below, **before**
   building the ready set in step 2. Hunted issues never displace human-authored ones beyond
   their own computed Priority rank in step 2's descending sort — this step only decides
   *whether a wave fires this turn*, not queue ordering.
1. Run forge sync
2. Build ready set per `queue-dag.md` and **sort in descending order** of their Pareto Priority score.
3. For each selected issue, set `in-flight`, spawn worker at correct phase:
   - New issues start at **handle** or **plan** if handle complete
   - Returned-from-review start at **implement**

## Continuous Discovery of Improvements (Backlog Growth)
 
- The orchestrator triages all discoveries logged in the findings ledger.
- For every codebase improvement suggestion:
  1. Calculate the Priority score: $\text{Priority} = \text{Gain} \times (11 - \text{Effort})$.
  2. If $\text{Priority} \ge 30$:
     - If not yet filed, execute `gh issue create --title "[Discovery] <Name>" --body "..." $(bun scripts/forge-scope.ts create-args)` (explain context, gain, effort, and priority score).
     - Map the ledger's `deferred_to_issue` field to the new issue ID.
     - The next auto-sync step reconciles the new issue into `queue.json` as a new campaign backlog item.
  3. If $\text{Priority} < 30$:
     - Set status in findings ledger to `archived` (marked as low-value). Do not file a GitHub issue to keep the backlog clean and noise-free.
 
## Campaign complete
 
```
gh issue list --state open $(bun scripts/forge-scope.ts list-args) → []
gh pr list --state open → [] (excluding LGTM'd `leave-open` PRs, which count as delivered)
queue.json: no in-flight entries
```

When the block above is all-empty (the pre-existing `leave-open`-aware check, unchanged and
extended, not replaced), do **not** immediately declare campaign complete — first evaluate the
on-empty kaizen check (ADR-006):

```
if kaizen.enabled AND territory not exhausted (some kind in kaizen.kinds has
   hunt_state.kinds.<kind>.exhausted != true) AND that candidate kind's
   hunt_state.kinds.<kind>.waves < kaizen.max_waves:
    dispatch one hunt wave (§ Kaizen hunt dispatch below, round-robin kind selection)
    re-run forge auto-sync
    continue the loop (do not report campaign complete this turn)
else:
    campaign complete — proceed below
```

`kaizen.trigger` gates whether this on-empty check ever fires at all: it only applies when
`kaizen.trigger == "on-empty"` (default) or `kaizen.trigger == "manual"` is not the deciding
factor here — `manual` only ever dispatches via the `hunt [kind]` SKILL mode, never
automatically on-empty or every-n-loops. When `kaizen.trigger == "every-n-loops"`, this
on-empty check still applies as a secondary path (both triggers may fire hunt waves; they are
not mutually exclusive) — this preserves ADR-006's stated behavior that the campaign should
not report "complete" while kaizen has unexhausted territory left to hunt, independent of
which trigger mode is configured. When `kaizen` is absent or `kaizen.enabled: false`, this
whole check is skipped and campaign-complete behavior is byte-for-byte identical to
pre-ADR-006 (config-template.md's contract note).
 
Report to user: SHIPPED summary, LEDGER OPEN count, any deferred issues filed.
Then ask, via the coordinator's `AskQuestion` convention: "Start a new
campaign?"

- **Yes** — the coordinator re-fires the Campaign Launch Configuration Gate
  (`coordinator.md` § Bootstrap preflight, ADR-005) before its next
  orchestrator spawn, so the user reconfigures scope and `merge_mode` for the
  new campaign.
- **No** — the session ends normally; no further prompting.

## Kaizen hunt dispatch

Per ADR-006 § Orchestrator hunt dispatch. This subsection is the single specification for
every automatic hunt-wave trigger (§ Next batch step 0 "every-n-loops", § Campaign complete
above "on-empty") and the manual `hunt [kind]` SKILL mode (`SKILL.md` Modes table) — all three
call into the same 5-step wave protocol and the same four stop conditions below; none of them
duplicates this logic inline.

**Gated-batch mid-flight no-op (evaluate first, before any of the 5 steps):** if
`config.merge_mode == "gated-batch"` and `merge-gate.md` § 4's sequential batch procedure has
started but not finished for the current LGTM-all batch — derived via the existing
`readScope`/`issueMatchesScope` scope match (`merge-gate.md` § 1 Condition 3, `scripts/
forge-scope.ts`; never a second scope-matching implementation, `V-INT-02`): at least one
in-scope issue is already `status: merged` while at least one sibling in scope is still
`status: ready`/`in-flight` — skip this turn's hunt wave entirely. Do not consume a `waves`
increment, do not mark a dry wave, do not touch `hunt_state` at all. Re-evaluate next turn.

### 5-step wave protocol

1. **Spawn.** Spawn `hunter` with the round-robin-selected `kind` and its territory directive
   (unscanned bands, derived from `hunt_state.kinds.<kind>.bands_done`) — 5-Field Delegation
   Contract per `orchestrator.md` § Kaizen hunt dispatch.
2. **Dedup.** Against the ledger idempotency key `(vcode, file, line, issue_ref)` **and** open
   forge issues (title/`file:line` match) — a `CONFIRMED` finding matching an existing ledger
   row or an already-open `[Kaizen]` issue for the same `file:line` is dropped before gating,
   never re-filed.
3. **Gate + file.** Apply `V-PARETO-02` (`Priority = Gain * (11 - Effort) >= 30`) plus the bug
   severity floor: a `kind: bug` finding with `severity: BLOCK` or `severity: HIGH` always
   files regardless of computed Priority (severity-term reconciliation — the hunter's shipped
   `worker-schemas.md` contract has no `CRITICAL` tier; `severity: BLOCK` stands in for the
   ADR's "CRITICAL", per the plan's Codebase Conventions "Severity-term reconciliation"
   note). Findings that clear the gate are filed via the **existing** `gh issue create
   --title "..." --body "..." $(bun scripts/forge-scope.ts create-args)` path (the same
   mechanism § Continuous Discovery of Improvements already uses — never a second filing code
   path, `V-INT-02`) with:
   - Title: `[Kaizen] <summary>`
   - Body: `src/references/hunt/filing.md` template verbatim
   - Size label: effort 1–2 → `size:xs`; effort 3 → `size:s`; effort 4–6 → `size:m`;
     effort 7–8 → `size:l`; effort 9–10 **or** multi-file blast radius (any effort) →
     `size:xl` (Codebase Conventions "Size-label mid-band fill" note). If the `size:l`/
     `size:xl` label does not exist on the forge, degrade to `size:m` with a wave-note flag
     rather than dropping the filing step (never-drop-findings, `blackhole-protocol.md`).
   - The ledger row's `deferred_to_issue` is set to the new issue number on filing; `vcode`
     is written `V-HUNT-<KIND-UPPERCASE>` (e.g. `V-HUNT-QUICKWINS`, `V-HUNT-BUG` — distinct
     from the process codes `V-HUNT-01`/`V-HUNT-02`); `issue_ref` stays `null` (no "issue
     being worked" the way reactive discoveries have one).
   - Findings **below** the gate (Priority < 30 and not a bug-severity-floor override) are
     set `status: archived` in the ledger — never filed, per the identical below-floor rule
     § Continuous Discovery of Improvements already applies.
4. **Cap.** File at most `kaizen.max_issues_per_wave` issues this wave. Excess `CONFIRMED`,
   above-floor findings stay `status: open` in the ledger — never dropped, never
   silently archived — to be filed in a future wave once the cap resets.
5. **Watermark.** Update `hunt_state.kinds.<kind>` atomically in the same write: merge this
   wave's `territory.bands_scanned` into `bands_done`, increment `waves`, set
   `last_wave_at` to now. Same atomic write protocol as every other `hunt_state`/ledger
   mutation (`blackhole-state.md` § Write protocol): `jq empty` validate, `.tmp` + `mv`,
   bump `refreshed_at`.
   - **Dry-wave counter.** `hunt_state.kinds.<kind>.dry_waves` (new, additive per-kind
     integer field): increment when this completed wave filed zero issues (step 3
     produced nothing above the gate); reset to `0` on any wave that files `>= 1` issue.
     When `dry_waves` reaches `3`, force `hunt_state.kinds.<kind>.exhausted = true` in
     this same atomic write.

### Stop conditions

- **Territory exhausted** — every kind in `kaizen.kinds` has
  `hunt_state.kinds.<kind>.exhausted == true` (via the hunter's own `territory.exhausted`
  signal merging into `bands_done`, via `max_waves`, or via 3 dry waves below): no further
  automatic hunt waves dispatch; the on-empty check in § Campaign complete falls through to
  campaign-complete.
- **`max_waves` reached (per-kind)** — `hunt_state.kinds.<kind>.waves >= kaizen.max_waves`
  forces that kind `exhausted: true`; other, non-exhausted kinds remain eligible for
  round-robin selection.
- **3 consecutive dry waves (per-kind)** — see step 5's dry-wave counter above; forces that
  kind `exhausted: true` in the same atomic write as the third dry wave.
- **Gated-batch mid-flight no-op** — see above; a per-turn skip, not a per-kind exhaustion —
  no counters are consumed and no wave is counted dry.
<!-- GENERATED by scripts/build.ts from src/references/phase-loop.md — do not hand-edit -->
