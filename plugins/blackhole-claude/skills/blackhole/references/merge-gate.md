# Merge Gate — Eligibility, Cycle Detection, Drift Reconciliation

Owns the entire merge-eligibility algorithm (ADR-005): whether an LGTM'd issue's PR
may actually be merged this turn. No merge mechanics live here — HEAD/CI/build
checks and the `gh pr merge` call itself stay in `phase-loop.md` § Merge protocol;
this doc is consulted from that section's own **step 0** as a single delegated
precondition (`mergeEligible(issue)` — `false` stops the protocol before step 1),
never inlined and never satisfied merely by citation from a different heading.

**`merge_mode: leave-open` bypass note** (ADR-006, narrowed by ADR-026 D5): for issues under
this mode, `mergeEligible(issue)` is never invoked at all, and the campaign never calls
`gh pr merge` — `phase-loop.md`'s Merge protocol trigger paragraph bypasses `mergeEligible()`'s
three **admin-scheduling** conditions (`merge_hold`, `merge_after`, gated-batch sibling wait) and
the terminal merge call for these issues. This is a **bypass**, not a new eligibility condition;
do not add a fourth numbered condition to `mergeEligible()` below for `leave-open`. It no longer
means Step 0.5/0.6/1 are skipped: those three steps are PR-quality signals (no conflict, pipeline
verdict, CI green) a human merge actor still benefits from, not admin scheduling, and now run for
`leave-open` PRs too as a merge-readiness dry run with no `gh pr merge` call at the end
(`phase-loop.md` § Merge protocol, `leave-open` branch).

Consumes `queue.json`'s `merge_hold` / `merge_after` fields (see `queue-dag.md`
Field rules) and `config.json`'s `merge_mode` field (see `config-template.md`).
Reuses `scripts/forge-scope.ts` (`readScope`, `issueMatchesScope`) for gated-batch
scope — does not reimplement it (V-INT-02).

## CI-wait poller contract

Specification only — no merge mechanics live here (this doc's own charter,
above): the poll/retry/rerun mechanics themselves are `phase-loop.md` § Merge
protocol step 2's, unchanged.

- **Interval**: poll `gh pr checks <n>` every 60s while the background CI-wait
  is outstanding.
- **Cap**: 20 minutes of total CI-wait per PR before the 2-retry/reclassify
  path in `phase-loop.md` step 2 takes over. Chosen to sit above the
  `V-PARETO-01` foreground->10 min threshold (this is a background wait, not a
  foreground one) and well under the 40-45 min foreground waits this issue's
  mining evidence flagged as excessive.
- **Reclassification**: governed entirely by `phase-loop.md` step 2's rules
  (`cancelled` → rerun once; "Base branch was modified" → re-fetch + retry
  once; 2-retry cap → `orchestrator-runtime.md` § Error Classification) — not
  restated here. After the 2-retry cap, still-red Permanent CI is diagnosed per
  `ci-diagnosis.md` (failing-step logs, environment/genuine classification,
  implementer fix-loop routing via `V-CI-01`).
- **Coverage**: the polled CI run's `verify` job includes `bun test` (`verify.yml`'s
  "Run test suite" step, issue #747) — C3 "CI green" already covers the full suite.

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

Only evaluated when `config.json.merge_mode == "gated-batch"` (`"immediate"`
skips this condition entirely — the loop above never enters the
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
   deadlock or auto-resolve a cycle. Conforms to `clarify-gates.md` § Gate Content Contract
   (R-003), merge escalation gate class: Why is that a merge-order cycle cannot resolve itself
   — picking an edge to break is the owner's call; Evidence is the cycle's issue numbers and
   their `merge_after`/`depends_on` edges (`coordinator.md`'s "Resolving Blockers" §
   merge-order-cycle bullet presents the same edges — cross-referenced there, not restated).

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

**`merge_mode: leave-open` carve-out** (ADR-006): for issues where
`config.json.merge_mode == "leave-open"`, an externally-observed merge (`gh
pr view --json state,mergedAt` showing `MERGED`) is **not** drift — it is the
designed completion path (a human merges the LGTM'd PR blackhole
intentionally left open). Do not log `V-MERGE-01` or `V-MERGE-02` for these
issues; reconcile `queue.json` to `status: merged`, `phase: done` via the
existing generic forge-sync reconciliation path (`forge-sync.md` § Reconcile
existing queue entries) with no V-code logged. This carve-out takes
precedence over the `merged_by`-attribution bullets above whenever
`merge_mode == "leave-open"` — those bullets classify drift only for
non-`leave-open` issues.

Both cases are audit-only: the ledger row records what happened, it does not
and cannot reverse the merge. This single detection point (§3) is the sole
trigger for both `V-MERGE-01` and `V-MERGE-02` — they are not two separate
checks, only two attributions of the same drift observation.

**Restack on observed human merge (ADR-026 D6):** when this section observes a `leave-open`
externally-observed merge (the carve-out branch above), rescan the campaign's other open PRs and
re-run Step 0.5's existing conflict preflight (`merge-conflict-protocol.md` § Trigger — Step 0.5)
against `main`'s new HEAD for each. A PR that would now conflict against the freshly-merged
`main` is restacked by spawning `implementer` in conflict-resolution mode
(`merge-conflict-protocol.md` § Worker delegation) — the identical mechanism Step 0.5 already
uses; no new resolution mechanism is added here. This closes the gap where a `leave-open` PR
merging externally could silently stack a conflict onto sibling PRs that no scheduled Step 0.5
run would discover until their own merge attempt.

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

## 5. Review artifact presence + content gate (ADR-021 D3, issue #445; content check issue #806)

When `docs_governance.enabled` and `docs_governance.write_governance` both resolve `true`, an
LGTM'd issue's PR must contain the promoted review artifact, and that artifact's content must
agree with the live findings ledger, before `mergeEligible(issue)` may proceed to
`phase-loop.md` step 4 (`gh pr merge`):

```
function reviewArtifactPresent(issue, pr_diff_paths, config):
    if config.docs_governance.enabled != true: return true
    if config.docs_governance.write_governance != true: return true
    expected = deriveReviewTargetPath(issue.title, issue.number)  # scripts/lib/concern-slug.ts
    return expected in pr_diff_paths
```

Presence alone is existence-only and does not catch a committed artifact whose content has
drifted from the ledger (wrong verdict, a dropped `### Deferred` section — PR #773's actual
failure mode). `mergeReadinessForReviewPromotion()`
(`scripts/lib/merge-gate/review-artifact.ts`) therefore also runs
`reviewArtifactContentMatchesLedger()` once presence has already passed: it re-renders the
expected markdown via `renderReviewMarkdown()` (`scripts/lib/promote-review-artifact.ts:112`), a
pure function of the findings ledger — an input the promoter does not control, unlike the
manifest-based check this replaced (`manifestHasReviewRoute` was removed outright, issue #806:
it verified an input the party being checked itself wrote). The committed file's own `created:`
frontmatter date is extracted and passed back in as the re-render's `today` override, so a
cross-midnight gap between promotion and verification never causes a spurious mismatch — the
only two things that can differ are actual content.

Mechanical check: `bun run --cwd <abs repo-root> scripts/check-review-artifact.ts --config <abs>
--issue <N> --title <title> --ledger <abs findings-ledger.json> --pr <P> --branch <branch> --head
<sha> --repo-root <abs repo-root> --diff-file <abs paths.txt>` — `--cwd` MUST equal `--repo-root`
(issue #798 — pins the entry file and every transitive relative import to the tree named by
`--repo-root`, closing the cwd-vs-repo-root module-resolution divergence rather than only
detecting it). Every path-shaped flag must be absolute (`path.isAbsolute()`), or the CLI exits
`2` with its usage message (issue #806 AC4; sidesteps the #798 cwd-relative-*argument*-resolution
hazard class rather than sequencing behind it). Failure (missing
file, or content mismatch against the ledger re-render) is a **hard stop** at merge step 2.5 —
same class as a missing plan manifest declaration at implement time (`implementer.md` § Carry
Staged Artifacts). Inert when either governance flag is `false`.

## 6. `pipelineVerdict(pr, queue) -> "lgtm" | "needs_changes" | "not_detected"` (ADR-026 D2)

Merge-readiness is independent of `merge_mode`; who merges is not (`merge_mode` names only the
merge **actor** — `phase-loop.md` § Merge protocol's trigger paragraph). This function is C1 of
the 3-criteria merge-ready gate (C1 pipeline verdict, C2 no conflict — Step 0.5, C3 CI green —
step 1); it is invoked from `phase-loop.md`'s Merge protocol as a new discrete **Step 0.6**,
between the existing Step 0.5 conflict preflight and step 1's CI-wait — mirroring the Step 0.5
precedent exactly (ADR-023 added a new discrete step for C2 rather than a 4th `mergeEligible()`
condition; C1 follows the same shape, never a fourth `mergeEligible()` condition).

```
function pipelineVerdict(pr, queue):
    if not queue.pipeline_detection.actionman_workclaude:
        return "not_detected"

    labels = getPrLabels(pr)                    # current PR labels, live read
    head_sha = pr.headRefOid                     # current HEAD, re-checked after every push

    if any(label matches "ai-review:LGTM" AND label.applied_at_sha == head_sha for label in labels):
        return "lgtm"
    if any(label matches "ai-review:(NEEDS_CHANGES|CRITICAL_ISSUES)" for label in labels):
        return "needs_changes"
    return "not_detected"   # pipeline installed but hasn't verdicted this HEAD yet
```

Checked against the PR's **current HEAD SHA** — a stale `LGTM` label from a prior SHA does not
count; the verdict is re-checked after every push. `not_detected` is also the result when the
pipeline is installed (`queue.pipeline_detection.actionman_workclaude: true`) but has not yet
posted any verdict on the current HEAD — the merge protocol treats this the same as "no pipeline"
for this turn (proceeds to Step 1) and re-checks next turn; it does not block indefinitely on a
bot that has not run yet.

### Fix-loop routing on `needs_changes`

When Step 0.6 returns `needs_changes`, the orchestrator routes exactly like `ci-diagnosis.md`'s
existing CI-genuine-failure path — the identical `review_iteration` counter and escalation table
(`review-core.md` § Review iteration budget), a third consumer of an existing mechanism, never a
parallel counter (`V-INT-02`/`V-DRY-01`):

1. **`queue.json`**: set `phase: implement`, `status: ready`, `review_iteration += 1` for the
   issue.
2. **STOP** merge protocol steps 1–5 for this turn — do not attempt `gh pr merge`.
3. **Spawn implementer** on the next scheduling pass with the pipeline's comment content as the
   Objective — apply the findings via the implementer's existing standard workflow (never a
   bot-invoking slash comment, see `implementer.md` § ActionMan/Workclaude Discipline).

| `review_iteration` | Action |
|---------------------|--------|
| 1–3 | Auto-fix via implementer → re-check `pipelineVerdict()` on the new HEAD |
| 4+ | Escalate to coordinator (`AskQuestion`) |
| Hard ceiling: 5 | Stop auto-fix; require human triage |

`lgtm` and `not_detected` both proceed to step 1 unchanged (two-criteria run when
`not_detected`).

## 7. Merge-base assertion — `baseRefMatches(pr, config)` + landing verification

Merge eligibility decides *whether* a PR may merge; until this section, nothing decided *what it
merges into*. A stacked PR — base a sibling feature branch — produced output indistinguishable
from a merge onto the campaign base, and `queue.json` then recorded a landing that never reached
`target_branch`. Stacking stays legitimate; the silence around it does not.

**Pre-merge assertion** (`phase-loop.md` § Merge protocol **Step 0.7**). Read the PR's
`baseRefName` and require it to equal `config.json`'s `target_branch`. A different base proceeds
only under an explicit stacked-merge opt-in **naming the branch being landed into**; an opt-in
naming any other branch, and an unreadable `baseRefName`, both refuse. Refusal is a hard **STOP**
for the turn, the same class as § 5's review-artifact stop — no V-code and no ledger row of its
own.

**Post-merge landing verification** (`phase-loop.md` § Merge protocol **step 4.6**). A
`git log <target_branch> --grep=#<PR>` miss is proof the merge did not land there, never evidence
of replication lag. The tolerance for lag is spent as a bounded retry budget inside the script,
and its exhaustion is terminal: the orchestrator is left no verdict meaning "tolerate the miss".

Mechanical check for both halves (ADR-003 — the judgment is above, the arithmetic is not here):

```
bun run --cwd <abs repo-root> scripts/merge-base-guard.ts --mode pre-merge --base-ref <baseRefName> --target-branch <target_branch> [--stacked-into <branch>]
bun run --cwd <abs repo-root> scripts/merge-base-guard.ts --mode post-merge --pr <N> --target-branch <target_branch> --repo-root <abs repo-root> [--attempts <N>] [--interval-ms <N>]
```

Exit `0` proceed, `1` refuse (reason on stderr), `2` malformed usage — the same exit-code
contract `state-write-guard.ts` already uses (`blackhole-state.md` § Write protocol). Retry
defaults are 3 attempts 20 s apart, each preceded by its own `git fetch origin <target_branch>`,
so a retry can actually change the answer. `scripts/lib/merge-gate/merge-base.ts` holds the
assertion, the subject match, and the loop.

**Recording where it landed.** `merged_into` (`queue-dag.md` Field rules) is written by step 4.6
once the landing is *verified*, not by step 4, which knows only that the merge was attempted.
`mergedIntoVerdict()` reports `base` / `other` / `unknown`; an absent value is `unknown`, never
inferred as the base ref, so neither a failed verification nor a row predating the field is
mistaken for a verified base-ref landing.

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
| `leave-open` PR merged externally after LGTM | Reconciled normally via forge-sync's generic externally-observed-merge path — no `V-MERGE-01`/`V-MERGE-02` logged (designed path, not drift; see § 3's `leave-open` carve-out) |
| Pipeline installed (`pipeline_detection.actionman_workclaude: true`) but has not yet verdicted the current HEAD SHA | `pipelineVerdict()` returns `not_detected` for this turn (§ 6) — proceeds to step 1 same as a genuinely undetected pipeline; re-checked next turn, never blocks indefinitely on a bot that has not run |
| `leave-open` PR under the merge-readiness dry run (§ Bypass note) | Step 0.5/0.6/1 (C2/C1/C3) all run; on all-green, `phase-loop.md`'s `mergeReady(issue)` (C1+C2+C3) gates the "delivered-at-LGTM" annotation together with `isLgtm(issue)` — no `gh pr merge` call regardless of outcome |
| PR base is a sibling feature branch, no stacked-merge opt-in | Step 0.7 refuses (§ 7) — hard STOP for the turn, naming both the PR's base and `target_branch`; re-evaluated next turn once the base is corrected or an opt-in is declared |
| PR base is a sibling feature branch, opt-in names that same branch | Step 0.7 proceeds (§ 7); step 4.6 verifies against that branch and records it in `merged_into`, so `merged` on this row is never read as a base-ref landing |
| Post-merge `git log <target_branch> --grep=#<PR>` finds nothing after the retry budget | Terminal (§ 7, step 4.6) — the merge did not land on the base ref; never reclassified as replication lag, `merged_into` stays absent, and the issue does not advance to `done` |
| `merged_into` absent on an older `merged` row | `mergedIntoVerdict()` reports `unknown`, not `base` — an unverified landing stays visibly unverified rather than being backfilled by assumption |

## Consulted by

- `phase-loop.md` § Merge protocol, **step 0** — hard `mergeEligible(issue)` stop-gate before step 1, not merely a checklist reference one heading away.
- `phase-loop.md` § Merge protocol's **trigger** paragraph — when `merge_mode: gated-batch`, invokes **§ 4** (this doc) instead of applying steps 0-5 issue-by-issue; § 4 internally calls back into steps 0-5 per issue.
- `phase-loop.md` § Merge protocol, **Step 0.6** — hard `pipelineVerdict(pr, queue)` (§ 6) check between Step 0.5 and step 1.
- `phase-loop.md` § Merge protocol, **Step 0.7** — hard pre-merge base assertion (§ 7) between Step 0.6 and step 1.
- `phase-loop.md` § Merge protocol, **step 4.6** — post-merge landing verification (§ 7) after step 4.5's fetch.
- `forge-sync.md` — cycle detection (§ 2), drift reconciliation (§ 3), and pipeline detection (§ 5.6, feeds § 6).
- `orchestrator.md` Phase 5 — pointer reference only, no inline logic.

None of these three files duplicate the algorithm above inline — they cite this
doc by pointer (`` Per `merge-gate.md` § N `` style, matching the existing
`orchestrator.md`/`queue-dag.md` citation convention) and call `mergeEligible()`
as a black box.
<!-- GENERATED by scripts/build.ts from src/references/merge-gate.md — do not hand-edit -->
