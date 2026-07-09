# Merge Gate — Eligibility, Cycle Detection, Drift Reconciliation

Owns the entire merge-eligibility algorithm (ADR-005): whether an LGTM'd issue's PR
may actually be merged this turn. No merge mechanics live here — HEAD/CI/build
checks and the `gh pr merge` call itself stay in `phase-loop.md` § Merge protocol;
this doc is consulted from that section's own **step 0** as a single delegated
precondition (`mergeEligible(issue)` — `false` stops the protocol before step 1),
never inlined and never satisfied merely by citation from a different heading.

Consumes `queue.json`'s `merge_hold` / `merge_after` fields (see `queue-dag.md`
Field rules) and `config.json`'s `merge_mode` field (see `config-template.md`).
Reuses `scripts/forge-scope.ts` (`readScope`, `issueMatchesScope`) for gated-batch
scope — does not reimplement it (V-INT-02).

## 1. `mergeEligible(issue) -> bool`

```
function mergeEligible(issue, queue, config):
    # Condition 1 — explicit hold
    if issue.merge_hold == true:
        return false

    # Condition 2 — unresolved merge-order predecessors
    for dep_number in issue.merge_after:
        dep = queue.issues[dep_number]
        if dep.status not in ["merged", "closed"]:
            return false

    # Condition 3 — gated-batch sibling wait (only when merge_mode: gated-batch)
    if config.merge_mode == "gated-batch":
        scope = readScope(config)                       # scripts/forge-scope.ts
        siblings = [i for i in queue.issues.values()
                    if issueMatchesScope(asForgeIssue(i), scope)
                    and i.status not in ["closed", "merged"]]  # mirrors Condition 2's rule
        if not all(isLgtm(s) for s in siblings):
            return false

    return true
```

Evaluate the three conditions **in this order** and **short-circuit** on the first
`false` — cheap local reads first (`merge_hold`, then `merge_after` against
already-synced `queue.json` state), the scope-wide gated-batch scan last (only
needed when the field-level checks already pass). Evaluation order does not
change the result: any single failing condition makes the issue ineligible
regardless of which one is checked first (see Edge Cases § Hold + unresolved
`merge_after` below).

`isLgtm(issue)` is `review-core.md` § LGTM definition, unchanged — gated-batch
does not define a second notion of "reviewed".

### Condition 1 — `merge_hold`

Pure boolean read. `true` unconditionally blocks the merge regardless of LGTM
status, `merge_after`, or `merge_mode`. This is the direct "flag to not merge"
mechanism the ADR exists to add.

### Condition 2 — `merge_after` resolution

Each entry in `issue.merge_after` is an issue number. It is **satisfied** when
that issue's `queue.json` `status` is `merged` **or** `closed` — the identical
`merged OR closed` rule `depends_on` already uses (`queue-dag.md` Step 2, rule 2).
Closed-not-merged (wontfix/duplicate) still counts as resolved; this is the fix
for the predecessor-closed deadlock class. All entries must resolve; an empty
`merge_after` array (the default, `[]`) is vacuously satisfied — matches
`depends_on`'s empty-array semantics exactly.

### Condition 3 — gated-batch sibling wait

Only evaluated when `config.json.merge_mode == "gated-batch"` (default
`"immediate"` skips this condition entirely — the loop above never enters the
`if` body, so immediate-mode campaigns pay zero extra cost). "Siblings" means
every `queue.json` issue matching the campaign's configured scope
(`scope_milestone` / `scope_labels`) **and** not already `closed` or `merged`,
computed via `readScope(config)` + `issueMatchesScope(issue, scope)` from
`scripts/forge-scope.ts` — the same scope mechanism `forge-sync.md` already
uses for issue ingest/completion counting. Do not build a second
scope-matching mechanism; call this exported function directly.

**Closed-sibling exclusion**: an in-scope issue closed as wontfix/duplicate
never had a PR and can never satisfy `isLgtm()` (`review-core.md` requires an
actual completed reviewer run). Without exclusion, one ordinary closed issue
would permanently deadlock `all(isLgtm(...))` for the **entire** scope — the
identical deadlock class Condition 2's `merged OR closed` rule already fixes
for `merge_after`, extended here to the sibling set. `merged` siblings are
excluded for the same reason (already done, nothing further to wait for).

**Data shape note**: `issueMatchesScope` expects a forge-shaped issue —
`{ milestone?: { title }, labels?: { name }[] }` — not `queue.json`'s native
shape. `asForgeIssue(queueIssue)` is the trivial adapter:
`{ milestone: queueIssue.milestone ? { title: queueIssue.milestone } : undefined,
labels: queueIssue.labels.map(name => ({ name })) }`, reading the `milestone`/
`labels` fields `forge-sync.md` § 5 now syncs onto every `queue.json` issue every
turn (`queue-dag.md` Field rules). This is a shape adapter only — it does not
duplicate `issueMatchesScope`'s matching logic, and it deliberately reads the
turn-cached queue fields rather than making a live `gh issue view` call per
sibling, so Condition 3 stays a pure in-memory check over already-synced state.

The condition is satisfied only when **every** in-scope issue satisfies
`isLgtm()`. A scope of exactly one in-scope issue makes this vacuously true
(nothing else to wait for) — gated-batch degrades to immediate-mode behavior
for a single-issue scope.

**Scope is re-evaluated every orchestrator turn**, not frozen when the batch
wait begins — the same design already used for wave computation
(`queue-dag.md` Step 4). An issue entering or leaving scope mid-wait (label
added/removed, milestone reassigned) is picked up naturally on the next
`mergeEligible` evaluation; there is no separate "batch snapshot" state to keep
in sync. This is documented explicitly here per ADR-005's Key Assumptions
"Oversimplified" marker — treat it as the intended design, not an omission.

## 2. Cross-graph cycle detection

Run at the forge-sync boundary, every orchestrator turn (fail-fast — never
discovered only when a merge is attempted). Build one directed graph from the
**union** of two edge sets read from `queue.json`:

- `depends_on` edges (issue → each entry in its `depends_on`)
- `merge_after` edges (issue → each entry in its `merge_after`)

Detect cycles with the same topological-sort technique `queue-dag.md` Step 4
already uses for wave computation (Kahn's algorithm or DFS with a recursion
stack) — do not add a second cycle-detection implementation; the two graphs
share detection logic even though `depends_on` and `merge_after` remain
distinct fields with distinct semantics (implementation-start gate vs.
merge-time gate).

On detecting a cycle involving issues `A` and `B` (self-referential — `A`
listing itself — is a degenerate 1-node cycle of the same class):

1. Set `status: blocked` on **both** `A` and `B` (all issues on the cycle, for
   cycles longer than 2).
2. Set each one's `notes` to `merge-order cycle with #N` (`N` = the other
   issue's number; for cycles >2 nodes, name the next node in the cycle).
3. Surface via the existing `AskQuestion` user gate (`coordinator.md` /
   `orchestrator.md`'s existing interactive-gate convention) — never silently
   deadlock or auto-resolve a cycle.

This step is consulted (by pointer) from `forge-sync.md`'s sync sequence — the
algorithm lives here once; `forge-sync.md` does not duplicate it inline.

## 3. Forge-drift reconciliation

Also run during forge-sync, every turn. For every issue where `merge_hold ==
true` **or** `merge_after` has at least one unresolved entry (Condition 1 or
Condition 2 above would currently return `false`), check whether its PR was
merged anyway, outside blackhole's control:

```
gh pr view <pr_number> --json state,mergedAt
```

If `state == "MERGED"` (`mergedAt` non-null) despite the hold/unresolved
predecessor, that is **drift**: the merge already happened and cannot be
undone. Reconcile `queue.json` to match forge reality (`status: merged`,
`phase: done` — same as any other externally-observed merge, per
`forge-sync.md` § Reconcile existing queue entries), then attribute and log
using the `merged_by` field (`queue-dag.md` Field rules — set **only** by
`phase-loop.md` § Merge protocol step 4, in the same atomic write as
`status: merged`; deliberately **not** `status: in-flight`, which reflects
concurrent worker activity unrelated to who actually called `gh pr merge` and
is ambiguous in both directions — it is set for any active review/implement
work, not merge attempts specifically, and it flips to `merged` in the same
turn a real internal violation would occur):

- **`merged_by == "blackhole"`** (the marker was set — blackhole's own
  orchestrator executed step 4 despite step 0 saying stop, proving step 0 was
  bypassed or buggy): log **`V-MERGE-01` (BLOCK)** — a genuine internal
  process violation, blocks the campaign turn until acknowledged (per
  `blackhole-vcodes.md`'s BLOCK severity contract: fix or escalate to the
  user with justification).
- **`merged_by` absent** (blackhole never executed step 4 for this issue —
  it was structurally impossible for blackhole to do so while step 0 holds,
  so the merge came from outside): log **`V-MERGE-02` (WARN)** — an external
  actor (human via the forge UI, a different tool) merged the PR outside
  blackhole's control.

Both cases are audit-only: the ledger row records what happened, it does not
and cannot reverse the merge. This single detection point (§3) is the sole
trigger for both `V-MERGE-01` and `V-MERGE-02` — they are not two separate
checks, only two attributions of the same drift observation.

## 4. Gated-batch merge execution — one PR at a time

Once Condition 3 (§1) has been satisfied for all in-scope issues (every
sibling reached LGTM), the batch does **not** merge as a single atomic
multi-PR operation. Compute the merge order and execute sequentially:

1. Take the in-scope, now-all-LGTM issue set.
2. Topologically sort it on `merge_after` edges (same technique as § 2's
   cycle-detection graph, minus cycles since § 2 already guarantees none
   remain unresolved at this point).
3. For each issue in that order: re-check `mergeEligible(issue)` (a `merge_after`
   entry may resolve mid-batch as earlier PRs merge), then run the normal
   `phase-loop.md` § Merge protocol (`gh pr merge --squash`) for that one PR,
   then persist `queue.json` (`status: merged`, `refreshed_at` bump) **before**
   moving to the next issue in the order.

Persisting after each individual merge — rather than issuing every `gh pr
merge` call as one batch — is what turns a mid-batch failure into a resumable
state: the next orchestrator turn picks up `mergeEligible()` evaluation
exactly where it left off (predecessors already merged stay resolved), with
no rollback logic required for the PRs that already landed.

## Edge cases

| Scenario | Resolution |
|----------|------------|
| `merge_after: []` (default) | Condition 2 vacuously satisfied — matches `depends_on`'s empty-array semantics |
| `merge_after` entry has `status: closed` (not `merged`) | Satisfied — same `merged OR closed` rule as `depends_on` |
| Self-referential or mutual cycle (`A merge_after [B]`, `B merge_after [A]`), including cross-graph via `depends_on` | § 2 cycle detector flags both, sets `status: blocked` on each with note `merge-order cycle with #N`, surfaced via `AskQuestion` — never a silent deadlock |
| Gated-batch, exactly one in-scope issue | Condition 3's `all(...)` over a one-element set is vacuously true — identical behavior to immediate mode |
| Gated-batch, an in-scope sibling closed as wontfix/duplicate (never had a PR) | Excluded from Condition 3's sibling set (`closed`/`merged` excluded, mirroring Condition 2's rule) — does not permanently deadlock the whole scope's merges |
| `merge_hold: true` **and** an unresolved `merge_after` entry simultaneously | Either condition alone is sufficient to block; §1 short-circuits on Condition 1, so Condition 2 is never even evaluated — but the result is the same either way (see §1's ordering note) |
| PR merged externally while `merge_hold: true` (or `merge_after` unresolved), no `merged_by` marker | § 3 detects via `gh pr view --json state,mergedAt` on the next forge-sync; `merged_by` absent → logs `V-MERGE-02` WARN (external bypass) — audit only, the merge cannot be undone |
| PR merged while ineligible AND `merged_by: blackhole` marker present | § 3 detects the same way; `merged_by` present proves blackhole's own step 0 was bypassed; logs `V-MERGE-01` BLOCK instead of `V-MERGE-02` |

## Consulted by

- `phase-loop.md` § Merge protocol, **step 0** — hard `mergeEligible(issue)` stop-gate before step 1, not merely a checklist reference one heading away.
- `phase-loop.md` § Merge protocol's **trigger** paragraph — when `merge_mode: gated-batch`, invokes **§ 4** (this doc) instead of applying steps 0-5 issue-by-issue; § 4 internally calls back into steps 0-5 per issue.
- `forge-sync.md` — cycle detection (§ 2) and drift reconciliation (§ 3), run every turn at the sync boundary.
- `orchestrator.md` Phase 5 — pointer reference only, no inline logic.

None of these three files duplicate the algorithm above inline — they cite this
doc by pointer (`` Per `merge-gate.md` § N `` style, matching the existing
`orchestrator.md`/`queue-dag.md` citation convention) and call `mergeEligible()`
as a black box.
<!-- GENERATED by scripts/build.ts from src/references/merge-gate.md — do not hand-edit -->
