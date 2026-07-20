---
type: plan
status: current
milestone: M6
wave: 4
depends_on: [M1, M2]
milestone_status: pending
initiative: mercure-parity-program
track: quick
plan_base_commit: 79d2b708b942b0be7ba04f69aea8bb684c7c3c1c
review_trigger: "on milestone completion"
created: 2026-07-20
last_updated: 2026-07-20
related:
  - documentation/decisions/ADR-013-mercure-parity-program.md
  - documentation/audits/mercure-parity-surface.md
  - documentation/audits/mercure-parity-matrix.md
  - documentation/audits/mercure-sync.md
  - .claude/skills/prj-mercure-sync/SKILL.md
---

# Plan — M6: First Matrix-Driven Backlog Sweep

> **Milestone M6** · Wave 4 · Depends on: M1, M2 · Status: pending · Track: quick
>
> Operational milestone, not a code milestone. It proves the M1 (Lens v2 + dual-mode
> `prj-mercure-sync`) and M2 (seeded `mercure-parity-matrix.md`) machinery actually works by
> running it once, for real, against the highest-priority unswept row. The deliverable is
> updated matrix rows, filed issues, and a run-log entry — no `src/` changes are expected.

## Objective

Execute the first `prj-mercure-sync` v2 **backlog-mode** run (ADR-013 D3): take the top-Pareto
`gap`/unswept row(s) in `documentation/audits/mercure-parity-matrix.md` — expected to be the row
covering **x-security-audit exploitability-methodology depth vs blackhole's V-SEC-06..10**
(`mercure-parity-surface.md` GAP-6, per the SDB's "mercure-sync.md's own next-pick"), deep-compare
it against the pinned mercure 9.6.1 plugin cache (including the vendored cloudflare
exploitability methodology mercure carries at `mercure-plugin/vendor/security-audit/`),
classify it through Lens v2 (D2), update the matrix row(s) accordingly, file gated adoption
issues (respecting caps, `V-HUNT-01` verify-before-file, and dedup), append a run-log entry to
`documentation/audits/mercure-sync.md`, and thereby validate the whole v2 workflow end-to-end —
schema, lens, single-writer discipline, and filing gate all exercised together on one real row.

## Entry Gate (must verify true before T1 starts)

| # | Condition | Verification method |
|---|---|---|
| 1 | M1 merged — `prj-mercure-sync/SKILL.md` carries Lens v2 (tiered defaults) and the dual-mode (release/backlog) workflow, old REJECT-biased lens removed | `grep -n "Backlog mode" .claude/skills/prj-mercure-sync/SKILL.md` and `grep -n "Tier"` both match; `milestone-1.md` task checkboxes `[x]` |
| 2 | M1's additive verify check is live (row-id uniqueness, status-enum validity, `in-flight`-requires-ref, `gap`-requires-priority) | New check present under `scripts/checks/*.check.ts`; `EXPECTED_CHECK_COUNT` bumped in `build.ts` per the codebase's own check-registration convention |
| 3 | M2 merged — `documentation/audits/mercure-parity-matrix.md` exists, seeded with ~70 `PM-NNN` rows from `mercure-parity-surface.md`, ADR-011/012 ground marked `in-flight(ref)` | `test -f documentation/audits/mercure-parity-matrix.md`; row count and id-uniqueness pass the M1 verify check |
| 4 | `mercure-sync.md`'s old coverage table is marked deprecated (superseded by the matrix), not deleted | Coverage table section carries a deprecation note pointing at the matrix, per D1 |
| 5 | The row this milestone targets is discoverable and currently `gap` or unswept with the highest `priority` among such rows | Read the matrix; if a different row now scores higher than the GAP-6 row, that row is the actual target — the matrix, not this plan's memo of GAP-6, is the source of truth (ADR-013 D1 single-writer rule) |

If row 5 disagrees with the GAP-6 expectation, proceed with whatever the matrix actually shows —
do not force GAP-6 to keep the plan's own prediction true.

## Touch-Paths

- `documentation/audits/mercure-parity-matrix.md` — row status/priority/`verified` mutations for
  the swept row(s) only, applied by `prj-mercure-sync` as sole writer (no other row touched)
- `documentation/audits/mercure-sync.md` — one appended backlog-mode run-log entry
- GitHub issues via `gh issue create` — capped by `mercure_sync.max_issues_per_run` /
  `min_priority` (`.blackhole/config.json`, absent block = current defaults)
- No `src/` changes expected; no `queue.json` / `findings-ledger.json` writes (skill runs outside
  the orchestrator's turn — filed issues surface through native forge sync on the campaign's next
  turn, per `prj-mercure-sync/SKILL.md` step 8)

## Documentation Impact

- Matrix row(s): `status` transition (`gap`/unswept → `adapted`/`covered`/`in-flight(ref)`/
  `N/A(reason)`, whichever the lens verdict supports), `priority` recomputed if still `gap`,
  `verified` date + mercure version bumped.
- `mercure-sync.md` run log: one narrative entry — row(s) swept, verdict, issues filed — matching
  the doc's existing entry format; no watermark bump (backlog mode is not release-triggered, see
  ADR-013 D3).
- No `ARCHITECTURE.md` or `DESIGN.md` impact — this is data/process only, not a code or UI change.
- No new ADR is produced, so `documentation/decisions/INDEX.md` is untouched (V-ADA-02 N/A).

## Codebase Conventions

| Touchpoint | Convention | Source |
|---|---|---|
| Matrix row mutation | `prj-mercure-sync` is the **sole writer** of `mercure-parity-matrix.md`; regression transitions (`covered → gap`) are legal, `in-flight` rows must carry a ref | ADR-013 D1 |
| Pareto scoring | `V-PARETO-02`: `Priority = Gain × (11 − Effort)`, both 1–10 — no second formula, same one `prj-mercure-sync` and kaizen hunt already share | `blackhole-vcodes.md`; ADR-006 |
| Verify-before-file | Every filed issue is independently re-verified against the current mercure source and current `src/` before filing — mirrors `V-HUNT-01` | `prj-mercure-sync/SKILL.md` step 8 |
| Filing cap/dedup | Cap at `mercure_sync.max_issues_per_run` (default 5), floor `min_priority` (default 30); dedup against open `[Upstream]` issues and matrix `in-flight` refs; excess above-floor items stay recorded, never dropped | `prj-mercure-sync/SKILL.md` Contract table + step 8 |
| Single-writer / no queue-ledger writes | Skill never writes `queue.json` or `findings-ledger.json` directly | `blackhole-state.md` § Single-writer invariant |

## Task Steps

- [ ] **T1 — Verify the Entry Gate**
  - Confirm all 5 Entry Gate rows above hold. Do not proceed to T2 if any row fails —
    escalate to the user with which row failed instead of guessing at M1/M2 state.
  - **AC**: Entry Gate table re-run with observed (not assumed) results for each of the 5 rows,
    all passing.

- [ ] **T2 — Identify the actual target row**
  - Read `mercure-parity-matrix.md`; compute the top-`priority` `gap`/unswept row(s).
  - **AC**: Target row id(s) recorded, with a one-line note confirming whether it matches the
    expected GAP-6 (x-security-audit exploitability-methodology vs V-SEC-06..10) row or diverges
    (and why, if so).

- [ ] **T3 — Deep-compare against the pinned mercure plugin cache**
  - Read the mercure 9.6.1 plugin cache's `x-security-audit` skill and its vendored
    `mercure-plugin/vendor/security-audit/` cloudflare methodology (V-SEC-06 exploitability gate,
    V-SEC-07 adversarial re-verification). Read blackhole's current equivalent surface:
    `src/references/blackhole-vcodes.md` (V-SEC-01..10 rows), `src/references/hunt/bug.md`, and
    any existing security-audit-shaped hunt/review machinery.
  - **AC**: A short comparison note (mechanism-by-mechanism, citing `file:line` on both sides)
    exists in the run's working notes, ready to feed T4's lens classification and T5's row update.

- [ ] **T4 — Classify via Lens v2**
  - Apply the tiered lens (ADR-013 D2): this row is an enforcement/quality mechanism, so the
    default posture is **ADOPT** unless deep-compare shows it structurally cannot work
    autonomously (burden of proof on rejecting, not adopting).
  - **AC**: Verdict recorded (ADOPT / ADAPT / REJECT / N/A) with a one-line rationale citing the
    specific tier principle satisfied or violated, per D2.

- [ ] **T5 — Update the matrix row(s)**
  - Apply the T4 verdict as a row-status transition (never prose-only, per D1) plus `priority`
    recompute (if still `gap`) and `verified` date/version bump. `prj-mercure-sync` remains sole
    writer; only the target row(s) from T2 are touched.
  - **AC**: `git diff documentation/audits/mercure-parity-matrix.md` shows only the target row(s)
    changed; the M1 verify check (row-id uniqueness, enum validity, `in-flight`-requires-ref,
    `gap`-requires-priority) passes on the updated file.

- [ ] **T6 — File gated adoption issues**
  - For each ADOPT/ADAPT item from T4 scoring `Priority >= mercure_sync.min_priority` (default
    30): re-verify (mirrors `V-HUNT-01`), dedup against open `[Upstream]` issues and matrix
    `in-flight` refs, then `gh issue create --repo CorentinLumineau/blackhole` with the
    title/body format `prj-mercure-sync/SKILL.md` step 8 specifies (Summary / mercure source
    citation / Gain·Effort·Priority footer / adoption approach). Cap at
    `mercure_sync.max_issues_per_run`.
  - **AC**: Every filed issue links back to the matrix row id in its body; issue count for this
    run is `<= max_issues_per_run`; zero issues filed for REJECT/N/A-classified items; any
    above-floor items left unfiled by the cap are recorded in the matrix/run-log for the next run
    (never silently dropped).

- [ ] **T7 — Append the run-log entry**
  - Update `documentation/audits/mercure-sync.md` in place (search-before-write; this is the
    canonical run-log file, never a dated variant): row(s) swept, T4 verdict, T6 outcome
    (issue links or "none filed, below floor / REJECT").
  - **AC**: `mercure-sync.md`'s Outcome table carries a new row for each issue filed in T6, and
    the run-log narrative section gains one dated entry for this backlog-mode run.

- [ ] **T8 — End-to-end validation**
  - Confirm: (a) the M1 verify check is green post-mutation, (b) `.blackhole/queue.json` and
    `.blackhole/findings-ledger.json` are untouched by this run (grep their mtimes / git status),
    (c) no file outside the Touch-Paths list changed.
  - **AC**: All three checks pass; this is the milestone's proof that the v2 workflow — schema,
    lens, single-writer discipline, filing gate — works end-to-end on a real row, not just in
    the abstract.

## Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | GAP-6 no longer the top-Pareto row by the time M6 runs (matrix seeded independently in M2) | Low | T2 defers to the live matrix, not this plan's memo of GAP-6 (Entry Gate row 5) |
| R2 | T4 classifies the row REJECT/N/A, producing zero adoptions — could read as milestone failure | Low | A REJECT/N/A verdict is a valid, documented outcome (Lens v2 requires burden-of-proof rationale either way); the milestone's success criterion is the workflow running end-to-end (T8), not a specific verdict |
| R3 | Filing runs past the cap or below the floor, silently dropping findings | Medium | T6 AC explicitly requires above-floor overflow to stay recorded, never dropped (mirrors kaizen hunt `V-HUNT-02`) |
| R4 | M1/M2 not actually merged when this milestone is picked up (parallel planning, not parallel merging) | Medium | T1 Entry Gate is a hard blocking precondition; escalate rather than proceed on assumed state |

Rollback, if T5/T6 land something wrong: the matrix row edit and run-log entry are both plain
git-tracked markdown with single-writer discipline — revert the specific commit. Any
already-filed GitHub issue is closed with a comment noting the mis-classification; issues are
never silently deleted.

## Execution Assignments

| Task | Agent | Model | Notes |
|---|---|---|---|
| T1 — Entry Gate verification | `blackhole:orchestrator` | sonnet | Read-only checks against merge history, `SKILL.md`, and the matrix file; escalates to human if any row fails |
| T2 — Target row identification | `blackhole:investigator` (analyze sub-mode) | sonnet | Read-only matrix scan; no mutation |
| T3 — Deep-compare | `blackhole:investigator` (research sub-mode) | sonnet | Reads pinned mercure plugin cache + vendored security-audit methodology + blackhole's V-SEC surface; produces comparison notes only |
| T4 — Lens v2 classification | `blackhole:investigator` (analyze sub-mode) | sonnet | Applies ADR-013 D2 tiers to T3's findings; read-only verdict, no file writes |
| T5 — Matrix row update | `blackhole:implementer` | sonnet | Sole-writer mutation to `mercure-parity-matrix.md`; runs the M1 verify check before finishing |
| T6 — File gated issues | `blackhole:implementer` | sonnet | `gh issue create` calls per the capped/verified/deduped protocol; no `queue.json`/ledger writes |
| T7 — Run-log entry | `mercure:x-doc-writer` | sonnet | Updates `mercure-sync.md` in place per its existing section format |
| T8 — End-to-end validation | `blackhole:reviewer` | sonnet | Verifies check status, file-touch scope, and queue/ledger non-interference; blocks completion if any check fails |

## Acceptance Criteria (milestone-level)

1. Entry Gate (T1) verified true, evidence recorded — not assumed.
2. Exactly one backlog-mode sweep executed against the actual top-Pareto `gap`/unswept row(s)
   (T2–T5), with the matrix updated as a status transition, not prose-only.
3. Zero issues filed for REJECT/N/A-classified items; all filed issues within cap, above floor,
   deduped, and linked to their matrix row id (T6).
4. `mercure-sync.md` run-log carries exactly one new dated entry plus matching Outcome rows (T7).
5. Post-run validation (T8) confirms the M1 verify check is green, `queue.json`/
   `findings-ledger.json` untouched, and no file outside Touch-Paths changed.
6. `git diff` for this milestone's PR touches only: `mercure-parity-matrix.md` (target row(s)),
   `mercure-sync.md` (run-log entry) — no `src/` files.
