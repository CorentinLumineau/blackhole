# Review Core — Shared Review Infrastructure

Canonical definitions for review delegation, aggregation, iteration budgets, and gating. Referenced by `phase-review.md` and `reviewer`.

## Review pipeline

```
reviewer (raw findings JSON)
        ↓
scripts/review-aggregate.ts (deterministic dedup, Pareto rank)
        ↓
orchestrator (ledger append, phase routing)
```

The orchestrator calls `scripts/review-aggregate.ts` after reviewer completion — no LLM aggregation subagent.

## Severity → action mapping

| Severity | Action | Merge allowed? |
|----------|--------|----------------|
| `BLOCK` | Must fix before merge; re-run review after fix | No |
| `WARN` | Fix in PR, or defer (file issue + `deferred_to_issue`) | Yes, if addressed or deferred |
| `NOTE` | Optional fix; ledger row optional | Yes |

Never merge on a direct commit to main (`V-BRANCH-02`) or if force-pushing occurred (`V-BRANCH-01`).
Never merge on errored review — empty findings from a failed agent is not LGTM.

## LGTM definition

LGTM requires **all** of:

1. `reviewer` returned `status: "complete"` (not `error`)
2. `scripts/review-aggregate.ts` returned `lgtm: true` and `blockers_count === 0`
3. No unresolved BLOCK rows in ledger for this issue/PR
4. When the Security-mode review gate resolved `true` for this PR, the merge-gate validator (`V-SEC-08`) passes — no unresolved `BLOCK` security finding without a populated attack-scenario field. Not applicable when the gate resolved `false` or `route` was absent.
5. When the Security-mode review gate resolved `true` for this PR, any `verification_legs[]` entry with `mode: "reasoned"` has been surfaced to the merge decision (`V-SEC-12`) — visible, not blocking. Not applicable when the gate resolved `false` or `route` was absent.

## Pareto scoring

For discovery findings (`V-PARETO-02`):

$$\text{Priority} = \text{Gain} \times (11 - \text{Effort})$$

| Priority | Orchestrator action |
|----------|---------------------|
| ≥ 30 | File GitHub issue (`gh issue create` + `$(bun scripts/forge-scope.ts create-args)`); set `deferred_to_issue` |
| < 30 | Archive in ledger; do not file issue |

Aligns with `phase-loop.md` continuous discovery protocol.

## Confidence-based filtering & consolidation

Findings carry an optional `confidence` (0-100; distinct from `route.confidence`) that gates
their surfacing before dedup:

| Band | Behavior |
|------|----------|
| `> 80` (or `confidence` absent) | Reported normally, severity unchanged |
| `50–80` | Reported with an explicit caveat in `summary`; **never** `BLOCK` — downgraded to `WARN` |
| `< 50` | Suppressed entirely — dropped before dedup, never `BLOCK`/high-severity |

`reviewer.md` § Confidence-Based Finding Filtering & Consolidation documents the *behavioral policy* the LLM reviewer self-applies (score +
suppress + caveat); `scripts/review-aggregate.ts`'s exported `applyConfidenceGate` is the
deterministic backstop that mechanically re-enforces the same band boundaries even if the
reviewer mis-scores — it runs after the prior/new finding merge and before `dedupeFindings`, so
previously-ledgered rows are re-validated identically to fresh ones (idempotent no-op if a row
already satisfies the gate). Both must agree on the exact band boundaries (`<50` / `50–80` /
`>80`) — do not let them drift apart.

Same-root-cause consolidation: when one underlying defect repeats at N locations, the reviewer
emits a single finding with a `locations: [{ file, line }, ...]` array instead of N separate
finding objects. Dedup (below) continues to key on the finding's primary `file`/`line` only —
`locations[]` is additive context, not a new dedup axis.

Coordination note (AC4, non-blocking): once ADR-006 #199 lands a `confidence` field in hunter
wave hunt findings, this same band logic applies to that pipeline too. No behavior change is
required by this issue — cross-reference only.

## Dedup key

Before ledger append, deduplicate on `(vcode, file, line, issue_ref)` per `findings-ledger.md`.

`review-aggregate.ts` performs exact-key dedup with severity merge (`BLOCK` > `WARN` > `NOTE`/`INFO`); orchestrator performs the same key check at write time.

**Recheck exclusion (issue #485)**: a same-key collision is **not** merged when the prior
finding's ledger `id` appears in the reviewer's `recheck[]` with `verdict: fixed` — that prior
finding is excluded from the collision set entirely before the exact-key dedup above runs, so a
new finding sharing its key is always a fresh row, never a silent merge that discards its
summary. This closes the failure mode where a genuinely distinct regression at the same
`file:line` as an already-fixed prior finding had its description dropped in favor of the stale,
already-fixed text.

## Review iteration budget

Tracked on queue entry as `review_iteration` (integer, default 0).

| Iteration | Action |
|-----------|--------|
| 1–3 | BLOCK → spawn implementer fix → re-review (automatic) |
| 4+ | Escalate to user via coordinator (`AskQuestion`) |
| Hard ceiling: 5 | Stop auto-fix; require human triage |

Increment `review_iteration` after each aggregate run that returns `changes_requested`.

Reset `review_iteration` to 0 when PR merges or issue returns to plan phase.

CI-genuine failures diagnosed per `ci-diagnosis.md` (after transient retries are
exhausted) consume the same `review_iteration` counter and escalation table above — not a
separate CI-fix budget.

## Security-mode review (ADR-004 step 8)

1. **Trigger**: read `route.security_review_required` from the issue's `queue.json` entry
   at review-phase spawn time. `route` absent → not applicable, unconditional
   current-checklist-only review (`queue-dag.md` "void route" convention).
2. **Confidence gate**: mirrors `orchestrator-delegation.md` § Route-derived dispatch's exact
   precedence — before consulting the flag, compare `route.confidence.security` against
   `.blackhole/config.json` `router_confidence_thresholds.security` (default 70); below
   threshold, treat as `true` (cautious default, matches `orchestrator-delegation.md`'s own stated
   note verbatim).
3. **Mechanism**: single `reviewer` spawn — when the gate resolves `true`, the Reviewer
   prompt requirements (below) gain an additional block: a diff-scoped attack-signature
   scan citing `src/references/security-attack-signatures.md` by repo-relative path.
   Apply only patterns whose matching constructs appear on changed lines in the PR diff —
   do not restate signature rows inline in the prompt.
4. **Exploitability gate (`V-SEC-06`)**: cross-reference only — see
   `blackhole-vcodes.md`'s existing row. Every security finding must carry a concrete
   attack scenario (who/what/result); findings without one are downgraded to
   `NOTE`/INFO-equivalent, never `BLOCK`.
5. **Adversarial re-verification (`V-SEC-07`)**: the primary spawn's prompt still
   instructs a self-adversarial first pass per finding before inclusion (attempt to
   disprove the exploit path; default to reject — omit or downgrade — if not
   demonstrable). This alone does not satisfy `V-SEC-07`'s literal wording ("each
   security finding **independently** re-checked") — a reviewer grading its own
   homework is not independent re-verification. § Independent security verification
   below is the structural mechanism that closes that gap; this step's self-check is a
   cheap first filter that runs regardless, not a substitute for it.
6. **Merge-gate validator (`V-SEC-08`)**: before merge on a security-mode PR, the
   orchestrator confirms every `V-SEC-06`/`V-SEC-07`-tagged finding in the reviewer's
   output carries a populated attack-scenario field — documented manual gate, mirroring
   `V-GIT-01`'s own script-free treatment exactly.
7. **Reasoned-verification surfacing (`V-SEC-12`)**: before merge on a security-mode PR, the
   orchestrator surfaces (never blocks on) any `verification_legs[]` entry with
   `mode: "reasoned"` at the merge decision point — documented manual gate, same script-free
   treatment as `V-GIT-01`/`V-SEC-08`. This never authorizes bypassing `with-test-lock`; it
   only makes an existing reasoned-verification disclosure visible where it was previously
   buried in free prose.

## Independent security verification (`V-SEC-07`, issue #439)

Structural mechanism that makes `V-SEC-07`'s "independently re-checked" promise literally
true, rather than the primary spawn's own self-adversarial check (§ Security-mode review
step 5) grading its own homework. Scoped narrowly — see ADR-003, unchanged: this is a
second call of the existing `reviewer` component, not a new agent role or a reinstated
LLM aggregation hop.

1. **Trigger**: same gate as § Security-mode review step 1/2 (`route.security_review_required`
   resolved `true`, including the confidence-gate cautious default) — no new detection
   logic. When the trigger does not fire, no verification spawn runs; the pipeline is
   unchanged from before this section existed.
2. **Scope**: fires only when the primary spawn's returned `findings[]` includes at least
   one `V-SEC-*`-vcode entry. Zero `V-SEC-*` findings from the primary pass → no
   verification spawn (nothing to independently re-check).
3. **Id-stamping (orchestrator step, before spawn)**: the primary's `findings[]` do not yet
   carry a ledger `id` at review time (ledger `F-NNNNN` ids are assigned at append, after
   aggregation) — the recheck mechanism's own ids only exist because `recheck[]` matches
   against *prior*, already-ledgered findings. Here there is no prior ledger row yet, so
   the orchestrator stamps each `V-SEC-*` finding in the primary's output with a
   review-pass-scoped temporary `id` (e.g. `V1`, `V2`, ... — any stable, unique string;
   the exact scheme does not matter as long as it is unique within this pass) before
   including that finding in the verification spawn's prompt. These temporary ids exist
   only to let the verification spawn's `verification[]` entries reference back to the
   findings they judge — they are discarded once the eventual ledger append assigns
   permanent `F-NNNNN` ids, and never collide with those (disjoint namespaces, one
   review-pass-scoped and throwaway, one ledger-scoped and durable).
4. **Mechanism**: after the primary `reviewer` spawn returns and step 2's scope check
   passes, spawn a **second, independent `reviewer` instance** — same agent identity, no
   new role (`V-INT-02`). Its prompt carries only the stamped `V-SEC-*` findings
   (`{finding_id, vcode, severity, file, line, summary}` — not the full diff, not the
   primary's reasoning trace, not the rest of the primary's `findings[]`) plus an
   instruction to attempt to disprove each one (reproduce or refute the attack scenario).
   Process independence — a separate context window, seeing only the narrowed finding
   list — is what "independently re-checked" means here, not organizational independence
   (a different agent identity, which would cost the same without a clearer benefit).
5. **Model tier**: `standard` (sonnet) — explicitly **not** the `premium` tier
   `model-routing.md`'s `route.security_review_required: true` bump row gives the primary
   security-mode `reviewer` spawn. That bump row governs the primary spawn (an
   open-ended exploitability audit over the full diff); the verification spawn
   documented here is a distinct, second dispatch this section governs directly, not a
   second instance of the generic route-derived `reviewer` bump. Disproving a short,
   already-scoped list of named findings is narrower and more mechanical than the
   primary's audit, so cheapest-capable discipline argues for `standard` here — a
   deliberate divergence, not an oversight, and the authoritative statement of this
   spawn's tier (`model-routing.md` is unaffected — it continues to describe only the
   primary spawn's tier resolution).
6. **Output**: the verification spawn returns the same `ReviewerInput`-shaped envelope
   every `reviewer` dispatch does, with `findings: []` in the ordinary case (it is not
   running a full audit) and a `verification[]` array — one entry per stamped finding it
   was given — `{finding_id, verdict: "confirmed" | "refuted", evidence}`
   (`worker-schemas.md` § Reviewer). This is a **sibling** field to `recheck[]`, not a
   repurposing of it — `recheck[]` already has a fixed meaning tied to fix-verification
   (§ Recheck mode above) and stays untouched by this mechanism. In the rare case the
   verification spawn's own narrow scan surfaces a genuinely new finding of its own
   (not one of the stamped findings it was asked to judge), it reports that via the
   ordinary `findings[]` array — merged into aggregation the same way any other
   already-known finding is, via `--prior-file` (§ Aggregate invocation below), so no new
   aggregation code is needed for that rare case (`dedupeFindings`'s existing
   severity-max merge already composes across chained `priorFindings` inputs).
7. **Aggregation**: the orchestrator passes the verification spawn's `verification[]`
   array to `scripts/review-aggregate.ts` via `--verification-file` (§ Aggregate
   invocation below). `aggregateReview`'s exported `applyVerificationDowngrades` runs
   before `applyConfidenceGate`/`dedupeFindings`: a `refuted` verdict downgrades its
   matching `BLOCK` finding to `WARN` (never lower, and never applied to a non-`BLOCK`
   finding); a `confirmed` verdict, or a `finding_id` with no match among the primary's
   stamped findings, is a no-op. This mirrors — in mechanism only, not effect — how
   `resolveRecheckExclusions` already special-cases a named `finding_id` before the
   general dedup path: recheck *excludes* a prior finding entirely (because "fixed" means
   the code no longer has the defect), verification *downgrades* rather than excludes
   (because "could not independently reproduce" is weaker evidence than "confirmed fixed
   by a later commit" — the finding stays visible as a paper trail instead of vanishing).
8. **What this does not do**: it does not run on non-security-mode PRs, does not touch
   Standard/Design-track PRs without a security finding, does not reinstate a
   synthesizer, and does not supersede ADR-003 — see that ADR's own Revisit condition,
   unchanged by this section (§ Revisit condition below).

## Skip-PR compensating control (ADR-004 step 8)

1. **Trigger**: `route.plan_mode === 'skip'` (from `queue.json`; `route` absent → not
   applicable, unconditional full audit unchanged).
2. **Rule**: plan-conformance auditing (`V-API-01` API/schema drift, `V-SCOPE-02`
   touch-paths-vs-plan, `V-SCOPE-03` blast-radius-vs-plan) is scoped to
   `route.plan_mode ∈ {quick, full}` — a skip PR's 4-line rationale record has no contract
   section to diff against.
3. **Compensating check**: for `plan_mode: skip` PRs, reviewer instead independently
   verifies the diff touches no public API/schema surface (no exported function
   signature, DB schema, config key, or route/response-shape change).
4. **Unchanged path**: `plan_mode ∈ {quick, full}` (and absent `route`) → plan-conformance
   audit runs exactly as today, no behavior change.

## Recheck mode

Standing fast-path primitive for narrow fix rounds — a targeted response to a small set of
already-named prior findings, not a fresh implementation.

1. **Trigger**: fix round with `review_iteration >= 1` on the issue's `queue.json` entry, the
   PR's changed files are a subset of the original plan's Touch-Paths (no new touch-paths added
   since the prior review pass), and no new `BLOCK`-severity finding surface has appeared since
   that prior pass.
2. **Input**: the prior findings list carried into the reviewer prompt — each entry is
   `{finding_id, summary}` sourced from the open/`BLOCK`/`WARN` ledger rows for this issue/PR
   (`finding_id` is the existing `F-NNNNN` ledger `id`, `findings-ledger.md` — no new id
   scheme).
3. **Mechanism**: the reviewer verifies each named finding is concretely fixed by inspecting
   only the fix commits (commits added since the prior review pass, not the full PR diff), and
   scans those same fix commits — and only those commits — for newly introduced regressions.
   Recheck mode **never re-litigates** code outside the fix commits that was already approved in
   the prior full-review pass.
4. **Composition note**: any new regression `findings` entry produced during a recheck still
   passes through `## Confidence-based filtering & consolidation` (above) before being reported —
   recheck mode does not create a confidence-gate bypass.
5. **Output**: the reviewer returns the `recheck` array (`worker-schemas.md` § Reviewer) instead
   of a full re-audit of the whole diff; any newly discovered regression in the fix commits is
   still reported via the existing `findings` array with a normal V-code/severity, so the
   existing severity → action mapping and LGTM gate apply unchanged.
6. **LGTM interaction**: recheck mode's LGTM condition is unchanged from the definition above —
   it still requires all `recheck` entries `verdict: fixed` AND zero unresolved `BLOCK` rows in
   `findings`, not a separate weaker gate. `review-aggregate.ts` now excludes a
   `recheck`-resolved prior finding (§ Dedup key, issue #485) from `blockers_count` before this
   condition is evaluated — this is *why* "zero unresolved BLOCK rows in `findings`" is met once
   every named finding is genuinely fixed, not despite it. When a `recheck[]` `finding_id` cannot
   be linked to any prior finding's ledger `id`, the linkage failure is surfaced in
   `unresolved_recheck` (`worker-schemas.md` § Review aggregate) and `lgtm` is forced `false` —
   never a silent pass.
7. **Independent spec-drift check (GAP-2 remedy, every recheck pass)**: in addition to the
   fix-commit-scoped verification above, the reviewer performs one lightweight, full-diff
   comparison of the PR's current cumulative state against the plan's Objective + Task
   Breakdown — the same comparison `reviewer.md` § 5-Field Contract & Plan Compliance's Objective Fulfillment check performs on a
   fresh full review. This is **not** a re-run of the full core audit checklist, and **not** a
   re-litigation of already-approved code quality/style findings outside the fix commits (rule 3
   above is unchanged — this is a distinct axis: requirement satisfaction, not code quality).
   Any requirement the cumulative diff no longer satisfies — including one a fix commit
   inadvertently broke while resolving a *different* named finding — is reported as a normal
   `findings` entry (no new V-code; reuses the uncoded Objective Fulfillment convention when no
   more specific code applies), subject to the existing severity → action mapping and LGTM gate.
   This is the one place in recheck mode that reads the whole diff, but only for spec/requirement
   satisfaction — never for quality/style re-litigation.

## Reviewer prompt requirements

Every `reviewer` delegation MUST include a dispatch mode (`full` / `security-mode` /
`recheck` / `verification`) and output format per `worker-schemas.md` reviewer contract. The
remaining inputs are dispatch-mode-dependent, not universal — `reviewer.md` § Recheck-Mode Compliance (Recheck) and
§ Independent Security Verification Mode (Verification) narrow the checklist and diff scope by design; this table is their
citation target, not a restatement each mode must independently reconcile against.

| Mode | PR diff scope | Touch-Paths + schema baseline | Full V-code checklist (`.cursor/rules/blackhole-vcodes.mdc`, every audit module) | Findings input | Attack-signature scan |
|------|----------------|-------------------------------|------------------------------------------------------|------------------|-------------------------|
| Full (ordinary dispatch) | Whole PR diff | Yes | Yes | — | — |
| Security-mode (§ Security-mode review, `route.security_review_required` resolved `true`) | Whole PR diff | Yes | Yes | — | Yes — diff-scoped, `src/references/security-attack-signatures.md` (cite by path; do not restate patterns inline) |
| Recheck (§ Recheck mode, `reviewer.md` § Recheck-Mode Compliance) | Fix commits only, plus one full-diff Objective Fulfillment comparison (GAP-2 remedy) | Yes | No — scoped to fix commits' changed lines; the core audit checklist is not re-run against the whole diff | Prior findings `{finding_id, summary}[]` | — |
| Verification (§ Independent security verification, `reviewer.md` § Independent Security Verification Mode) | Never the full PR diff | — | No — no audit module is run | Stamped findings `{finding_id, vcode, severity, file, line, summary}[]` | — |

Full and security-mode differ only in the attack-signature-scan column — security-mode is the
primary full-audit dispatch with that one addition, not a fifth independent mode.

## Aggregate invocation

After `reviewer` completes, the orchestrator runs:

```bash
bun run scripts/review-aggregate.ts \
  --reviewer-file <path> \
  --issue-ref <N> \
  [--pr-ref <P>] \
  [--prior-file <ledger-rows.json>] \
  [--verification-file <verification-entries.json>]
```

`--prior-file` rows must include each finding's ledger `id` (issue #485) — without it, a
`recheck[]` `verdict: fixed` entry naming that finding cannot resolve, and it surfaces in
`unresolved_recheck` (fail-loud) instead of silently applying the § Dedup key recheck exclusion.

`--pr-ref`, when passed, is stamped as `pr_ref` (number) onto every finding lacking its own
`pr_ref` (issue #754) — previously accepted by the CLI but silently dropped before reaching the
script's output. Omitted, or a finding that already carries its own `pr_ref`, resolves to
`pr_ref: null` per that finding, never `undefined`.

`--verification-file` (issue #439, § Independent security verification above) is a plain JSON
array of `{finding_id, verdict, evidence}` — the verification spawn's own `verification[]`
output, not a ledger row shape. Present only when the security-mode verification spawn ran;
absent for every other review pass, with no behavior change (`applyVerificationDowngrades` is a
no-op on an empty/absent array).

Output schema: `worker-schemas.md` § Review aggregate.

## Docs-only PRs

Orchestrator may perform direct review for docs-only PRs, but must still run `review-aggregate.ts` on findings before ledger append.

When the orchestrator performs this direct review (bypassing a `reviewer` spawn), it must apply `reviewer.md` § Docs-Only Execution Mode Compliance (Docs-Only Execution Mode Compliance)'s checks itself before running `review-aggregate.ts` — severity `BLOCK` on any check failure. See `reviewer.md` § Docs-Only Execution Mode Compliance for the check definitions; not restated here.

## Suggestion Proportionality Gate

`reviewer.md` § Suggestion Proportionality Gate defines a pre-finalize self-check the reviewer applies to its own draft
findings — before returning `status: complete` — catching gold-plating (speculative
abstractions, disproportionate remediation complexity) and out-of-diff drift in the reviewer's
own suggestions. Unlike confidence-filtering (above), there is no deterministic script backstop
for this gate — the reviewer is solely responsible for self-applying it. Findings removed solely
for citing out-of-diff code are re-tagged `V-PARETO-02` and reuse the existing
`pareto_candidates` rerouting mechanism defined in § Pareto scoring above, rather than being
dropped.

## Revisit condition

Re-introduce a dedicated aggregation agent only if blackhole adopts parallel multi-reviewer swarms (2+ independent reviewers per PR). See ADR-003.
<!-- GENERATED by scripts/build.ts from src/references/review-core.md — do not hand-edit -->
