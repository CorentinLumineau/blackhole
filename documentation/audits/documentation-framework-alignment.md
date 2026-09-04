---
type: analysis
summary: "Documentation-framework alignment audit that identified the gaps this issue closes"
skill: x-analyze
status: draft
review_trigger: "on mercure release"
created: 2026-08-06
last_updated: 2026-08-11
target: "blackhole alignment with mercure's documentation/ framework and enforcement model"
related:
  - documentation/audits/mercure-parity-matrix.md
  - documentation/audits/mercure-parity-surface.md
  - documentation/audits/autonomous-workflow-parity.md
  - documentation/audits/mercure-sync.md
  - documentation/decisions/ADR-010-autonomous-thinking-routes.md
  - documentation/decisions/ADR-012-shared-artifact-substrate.md
  - documentation/decisions/ADR-013-mercure-parity-program.md
---

# Documentation-Framework Alignment — blackhole vs mercure

> **Disposition (2026-08-06)** — this audit is closed out. Owner ruling **R-001**
> (`documentation/reference/product-principles.md`) established mercure's `documentation/`
> integration as a **floor, not a target**. Findings routed to:
>
> | Finding | Outcome |
> |---|---|
> | §3.1 root cause, §3 unwired promotion | ADR-021 D1/D2/D4 → issue #443 |
> | §2 parity-matrix category error, §1 plan/review absence | ADR-021 D3 (amended to unconditional under R-001) |
> | §4 doc-governance ownership, §5 staleness defect, §6 self-conformance | ADR-021 D6 → issue #442 (**prerequisite** for D3) |
> | §4 / §10.4 V-code collisions and downgrades | issue #441 |
> | §10.3 unenforced V-codes | issue #438 |
> | §10.2 review depth | issue #439 |
> | §10.1 merge posture | issue #440 |

Deep audit of one question: when blackhole autonomously implements a backlog issue, does it
leave behind the same durable record, under the same governance, that a human running
`/git-implement-issue` through mercure's APEX chain would leave?

## Scope note — what this audit does NOT re-derive

Blackhole already runs a systematic parity program (ADR-013). `mercure-parity-matrix.md`
tracks **85 rows** (PM-001..PM-085) covering V-code enforcement, plan sections, implement-time
gates, and agent-fleet parity in more depth than a fresh sweep would produce. This audit
deliberately does **not** restate PM-001..PM-053 (the checklist / gate / plan-section domains).
Its value-add is confined to four things the existing program does not currently surface:

1. A category error in the matrix's own `artifact` rows (§2).
2. The unwired promotion mechanism behind the durable-artifact contract (§3).
3. Doc-governance obligations that exist in mercure with no blackhole owner (§4) — and the
   observable defect that absence has already produced (§5).
4. Five V-codes the table declares but nothing audits, one of them at BLOCK severity (§10.3).

**§10 is out of the documentation frame** and records higher-severity findings from the V-code
and implement-path sweeps — the autonomy/merge boundary, review depth, and enforcement gaps.
Read §10 first if you are triaging by severity rather than by topic.

## 1. Executive verdict

Alignment is **strong in declaration, weak in wiring.** Blackhole's rules describe a
consumer-repo documentation practice closely matching mercure's. The mechanism that would
execute it assumes a PR branch exists at thinking time, and none does (§3.1) — so of the five
record classes below, only owner rulings actually land.

| Record class | Human `/git-implement-issue` (mercure) | blackhole campaign | Verdict |
|---|---|---|---|
| Architectural decision (ADR) | `documentation/decisions/ADR-NNN-*.md` + INDEX row, committed | Same path and shape declared, but the write is **not executable at plan time** — see §3.1 | **DECLARED, UNWIRED** |
| Owner ruling | `documentation/reference/product-principles.md`, committed | Same file, plus a monotonic `rulings_revision` watermark per issue | **PARITY (blackhole stronger)** |
| Analysis / investigation note | `documentation/audits/`, `documentation/investigations/`, committed | Target path *declared* in `artifact-contract.md`; promotion mechanism **undefined** | **DECLARED, UNWIRED** |
| Implementation plan | `documentation/plans/plan-*.md`, committed | `.blackhole/plans/issue-N.md` — **gitignored**, no promotion route exists | **ABSENT** |
| Review findings | `documentation/reviews/*.md` readiness report, committed | `findings-ledger.json` — **gitignored**, no markdown artifact at all | **ABSENT** |

Owner rulings land because their write path targets a file at repo root with no PR-branch
assumption. Every other class inherits the same §3.1 root cause.

The campaign is a faithful *enforcer* of mercure's rules. It is not yet a faithful *recorder* of
its own reasoning, plans, or reviews — and the single structural reason is narrower, and more
fixable, than the five-row table above suggests.

## 2. Finding A — the parity matrix's `artifact` rows measure the wrong thing (HIGH)

`mercure-parity-matrix.md` rows PM-054..PM-066 are labelled `kind: artifact` and check
mercure's `documentation/` folder taxonomy. Every one of them resolves against **blackhole's
own repository tree**, not against what the campaign writes into a consumer repo:

- PM-056 — mechanism `documentation/plans/`; blackhole column reads `documentation/plans/`;
  status **covered** (`mercure-parity-matrix.md:96`).
- PM-060 — mechanism `documentation/reviews/`; blackhole column reads `documentation/reviews/`;
  status **covered** (`mercure-parity-matrix.md:100`).
- PM-054 makes the framing explicit: blackhole column reads
  "`documentation/audits/` (**this file's own folder**)" (`mercure-parity-matrix.md:94`).

Folder existence in blackhole's repo is not campaign write-capability into a consumer repo.
The actual campaign→consumer write contract is `src/references/artifact-contract.md`, whose
route table has exactly four rows — analyze, brainstorm, design, investigate
(`artifact-contract.md:11-16`). **There is no plan row and no review row.**

Consequence: the two largest persistence gaps in the system are recorded as `covered` by the
program built to find them. They are invisible to the parity sweep by construction.

PM-055 shows the same conflation inverted: `documentation/investigations/` is marked `gap`
because the folder is missing from blackhole's own tree — while `artifact-contract.md:16`
already names it as a consumer-repo write target. One sense of "artifact parity" is being
scored, the other is not being scored at all.

**Remedy shape**: split `kind: artifact` into `artifact-own-repo` and `artifact-campaign-write`,
and re-score PM-054..PM-066 against `artifact-contract.md` rather than against `ls documentation/`.

## 3. Finding B — the durable-artifact promotion mechanism is declared but unwired (HIGH)

`artifact-contract.md:18-26` states the delivery mechanism: the investigator or planner writes
the note at thinking time, and "**the implementer carries the note into the PR branch when the
route reaches implement**". Merge = approval.

That carry step does not exist in the implementer's contract. `phase-implement.md:33-40` is the
5-Field Delegation Contract the orchestrator sends every implementation worker; its five fields
are Objective, Output format, Scope boundaries, Tool guidance, Stop condition. **None
references an analysis, investigation, or research note.** The Stop condition
(`phase-implement.md:39`) enumerates PR opened, lint/tests green, branch pushed, and
companion-doc updates — not note promotion.

Blackhole's own docs concede this. `investigator.md:77-79`:

> Promotion target: the analysis note is promoted to `documentation/audits/analysis-issue-N.md`
> per `artifact-contract.md` (Milestone 1 deliverable — **the promotion mechanism itself is not
> re-defined here**); missing promotion is `V-AUTO-02`.

`V-AUTO-02` is a **WARN**, not a BLOCK (`blackhole-vcodes.md`). So a campaign that never
promotes a single analysis note produces a warning, not a stop. The notes themselves are written
to `plans/issue-N-analysis.md` (`investigator.md:83-86`) — i.e. under `.blackhole/`, which
`.gitignore` excludes wholesale.

### 3.1 Correction — the design route is unwired too (HIGH)

An earlier draft of this audit credited the design route with full parity, on the reasoning that
the planner writes the ADR directly (`planner.md:273-333`) rather than relying on the carry step.
That is wrong, and the reason matters for the remedy.

`planner.md:288-291` instructed the planner to "promote this design note into
`documentation/decisions/ADR-{NNN}-{slug}.md` plus the `documentation/decisions/INDEX.md` row
... **commit the ADR inside the issue's own PR** — no orchestrator file write, no draft/final
flip, merge was the approval."

But the planner runs in **Phase 2**, and Phase 2 has no worktree, no branch, and no PR:

- `phase-plan.md:17` — the plan artifact's asserted location is
  `{repo_root}/.blackhole/plans/issue-N.md`. Repo root, not a worktree.
- `phase-plan.md` contains no `git worktree add`, no branch creation, and no PR creation step.
- `phase-implement.md:10` — `git worktree add <scratchpad>/wt-<issue> -b blackhole/issue-<issue>`
  is a **Phase 3** checklist item.
- `phase-implement.md:26-28` states it explicitly: "Implementers run in isolated worktrees
  (`wt-<issue>`); the plan file is **not** in the worktree working directory," and the
  orchestrator must therefore pass an absolute repo-root path.

A planner writing `documentation/decisions/ADR-NNN-*.md` at Phase 2 writes into the repo root's
working tree — which is on the target branch, not on any issue branch. There is no PR to commit
it into, and no carry-step to move it into one later.

So all four declared routes share one root cause: **the artifact contract assumes a PR branch
exists at thinking time, and it does not.** The fix is therefore singular rather than four-fold —
either thinking-time artifacts are staged and carried by the implementer (who does have the
worktree), or the worktree is created earlier, at plan time.

This also means `V-ADA-02`'s INDEX-currency audit (`reviewer.md:132`) has, in the autonomous
path, no autonomously-produced ADR to audit.

**Not claimed**: that any specific ADR in this repo is affected. The 20 ADRs under
`documentation/decisions/` are consistent with human authorship via mercure's `x-design`, and
the working tree was clean at audit time — no stray uncommitted artifacts were observed. The
finding is structural: the declared path cannot execute as written.

## 4. Finding C — doc-governance obligations with no blackhole owner (HIGH)

`src/references/doc-governance.md` ports mercure's rule closely on four obligations and drops
three:

| Mercure obligation | In blackhole rule? | Evidence |
|---|---|---|
| Canonical-path naming (no date stamp, ADR exception) | Yes | `doc-governance.md:20-24` |
| Search-before-write mandate | Yes | `doc-governance.md:14-18` |
| Lifecycle frontmatter schema | Partial — YAML block copied, but mercure's per-field Required table is dropped; only `type`/`status` stated required | `doc-governance.md:26-43` |
| Supersede-on-overwrite | Partial — core rule present; mercure's "both docs stay in INDEX until curated" follow-through has no owner | `doc-governance.md:45-50` |
| **INDEX.md maintenance** (upsert-on-write, row format, ownership) | **No** — appears only as a *search target* (`doc-governance.md:17`), never as an obligation | — |
| **Doc-tree health signal** (400-line ceiling, 200-row INDEX ceiling, 500-file advisory, 90-day deprecation window) | **No** — absent entirely | — |
| Agent responsibilities (who executes GOV-01..04) | **No** — no blackhole agent is assigned INDEX upkeep or the health signal | — |
| ADR status enum + 3-surface enforcement | blackhole-only addition | `doc-governance.md:52-74`, `scripts/checks/adr-status.check.ts` |
| Repo-convention precedence (schema detection) | blackhole-only addition — correct, since blackhole writes into *other* repos | `doc-governance.md:76-99` |

### V-code ID collisions (MEDIUM, but corrosive)

Two mercure V-code IDs are reused in `blackhole-vcodes.md` for **different rules**:

| ID | mercure meaning | blackhole meaning |
|---|---|---|
| `V-DOC-04` | Doc-tree structural staleness — INDEX row pointing at a moved file, unresolved supersession chain (HIGH) | Bundled as `V-DOC-02/04`: "Public-API and design docs updates in the same PR" (BLOCK) — `blackhole-vcodes.md:41` |
| `V-DOC-05` | Rationale duplicated across definition / interface / call site / test (MEDIUM) | "Documentation prose asserts a factual or arithmetic claim contradicted by repo-checkable evidence" (WARN) — `blackhole-vcodes.md:42` |

A reviewer citing `V-DOC-04` is ambiguous about which rule fired. More importantly, because
blackhole's `V-DOC-04` slot is occupied by the API-docs rule, **mercure's structural-staleness
rule has no blackhole code at all** — which is precisely the rule §5 below shows was needed.

## 5. Finding D — the missing health signal has already produced a defect (HIGH, confirmed)

`mercure-parity-matrix.md` carries `last_updated: 2026-07-26` and marks seven rows
`in-flight(#NNN)`. As of 2026-08-06, **all seven referenced issues are closed**:

```
#306 CLOSED — Add V-TEST-09 coverage-regression gate to implementer.md (PM-028)
#308 CLOSED — Port mercure V-PAT circular-dependency and singleton-abuse checks
#309 CLOSED — Extend Verification Evidence Gate to per-AC completion checks
#310 CLOSED — Add Dependency Blast-Radius check to Standard Track plans (V-SCOPE-03)
#311 CLOSED — Add plan-time Quick-track threat escalation checkpoint
#345 CLOSED — Forge content must never activate or widen autonomous scope
#346 CLOSED — AskQuestion payload contract
```

The matrix's flagship parity artifact asserts work is in flight that shipped up to eleven days
ago. This is blackhole's own `V-DOC-05` (prose contradicted by repo-checkable evidence) firing
on blackhole's own audit tree — and nothing detected it, because:

- the matrix names `prj-mercure-sync` as "the sole future writer" (`mercure-parity-matrix.md:19-21`),
- that skill is a **manually invoked project skill** (`.claude/skills/prj-mercure-sync/`), not a
  step in the campaign loop, and
- no health signal or review trigger fires on staleness (Finding C).

The stated recovery path — "a self-audit or reviewer finding a stale row files an issue" —
depends on a self-audit that nothing schedules.

## 6. Self-conformance of blackhole's own `documentation/` tree

| Check | Result |
|---|---|
| `.md` files under `documentation/` | 54 |
| Root `documentation/INDEX.md` | **Missing** |
| `documentation/decisions/INDEX.md` vs ADR files | 20 rows / 20 ADRs — **in sync** |
| ADRs missing required `type:` frontmatter | **8 of 20** — ADR-001, 002, 003, 004, 005, 006, 010, 014 |
| Date-stamped filenames | 0 — clean |
| Files exceeding mercure's 400-line ceiling | 6 (worst: `plans/plan-adr-007-drift-proof-toolchain-reseating.md`, 443) |
| Canonical folders missing | `investigations/`, `assessments/`, `runbooks/` |

The 8 missing `type:` fields are a direct `V-DOC-GOV-02` condition under blackhole's *own*
stated schema (`doc-governance.md:42-43`), unflagged.

### The rule does not apply to blackhole's own repo

`.blackhole/config.json` has **no `docs_governance` block**. Per the contract note at
`config-template.md:78-84`, an absent block means every dependent feature "MUST be a no-op and
current behavior is preserved exactly". So blackhole's doc-governance rule is **inert for
blackhole's own campaign on itself**.

Note the internal tension: `config-template.md:49` documents `docs_governance.enabled` as
defaulting to `true`, while the contract note treats an *absent block* as fully inert. Those two
statements are reconcilable only if "default true" is read as applying solely when the block is
present. That is ambiguous enough to be worth an explicit sentence.

Whatever conformance the tree does show (INDEX sync, no date stamps) appears to come from
mercure's globally-loaded rules being followed by habit — not from blackhole's own rule firing.

## 7. Human-gate parity

| Mercure gate | blackhole equivalent | Verdict | Evidence |
|---|---|---|---|
| Destructive / credentials action — never bypassable | `never_bypass: ["destructive","credentials","epic-go-no-go"]`, checked before any confidence math | **PARITY** | `confidence-gates.md:71-90` |
| Owner-ruling capture, same session | `## Ruling:` append with verbatim quote, interpretation, status, `R-NNN`, revision bump | **PARITY** | `clarify-gates.md:82-97` |
| Structured question format | `AskQuestion` payload contract: Decision / Evidence / Options, each self-contained | **PARITY (stricter — async reader has no scrollback)** | `clarify-gates.md:29-53` |
| `interview` zero-doubt loop (ask until 100% confidence) | Confidence kernel; proceeds autonomously at/above threshold (default 80), posting an issue comment instead of asking | **WEAKER** | `confidence-gates.md:57-69` |
| Plan→Implement approval, unconditional | Waits **only if** `notes: awaiting-plan-approval` is already set | **WEAKER** | `orchestrator.md:115` |
| x-design Gates 1–3, unconditional human co-creation | Bypassed entirely when `autonomy.design_autonomy: true` and `design-aggregate.ts` returns `ready` | **WEAKER (config-dependent)** | `planner.md:209-214,273-293` |
| Design Challenge Protocol / Validation Circuit Breaker — challenge the *user's own* proposals, 3-strike counter | Blind critics score the **agent's own generated options**; nothing audits repeated acceptance of the issue author's direction | **ABSENT** | `planner.md:228-253`; no circuit-breaker construct found |

The weaker rows are deliberate design (`mercure-parity-surface.md` §3 records "synchronous
AskUserQuestion gates — rejected by design" for an async campaign). The **absent** row is not
recorded as a deliberate choice anywhere and is the one worth a decision.

## 8. Recommendations (Pareto-ranked)

`Priority = Gain × (11 − Effort)`, floor 30.

| # | Action | Gain | Effort | Priority |
|---|---|---|---|---|
| 1 | Resolve the §3.1 root cause — thinking-time artifacts have no PR branch to land in. Either stage-and-carry via the implementer, or create the worktree at plan time. Covers all four declared routes including design, and raises `V-AUTO-02` to BLOCK | 8 | 4 | **56** |
| 2 | Re-score PM-054..PM-066 against `artifact-contract.md`, splitting `artifact-own-repo` from `artifact-campaign-write` | 6 | 2 | **54** |
| 3 | Add plan + review rows to `artifact-contract.md` — promote the plan and a reviewer readiness report into the issue's PR | 7 | 5 | **42** |
| 4 | Resolve the `V-DOC-04` / `V-DOC-05` ID collisions; mint a distinct code for doc-tree structural staleness | 5 | 2 | **45** |
| 5 | Adopt the doc-tree health signal + INDEX.md maintenance obligation, and name an owning agent | 6 | 4 | **42** |

Deferred below the floor: backfill `type:` on the 8 ADRs (mechanical, fold into #5); create
`investigations/`, `assessments/`, `runbooks/` (they should be created on first write, not
pre-seeded).

## 9. Housekeeping observations

- `documentation/audits/autonomous-workflow-parity.md` is `status: draft`, created 2026-07-15,
  and its G1–G11 have largely shipped via ADR-010/012/013. It is a candidate for
  `status: deprecated` with `supersedes` pointing here. Not edited by this audit.
- `documentation/architecture.md:75` states `bun run build --gemini` is required for the
  Antigravity target; `blackhole-protocol.md:95` states `--gemini` is a deprecated no-op and the
  target builds by default. One of the two is wrong — blackhole's own `V-DOC-05`.

## 10. Findings outside the documentation frame (from the V-code and implement-path sweeps)

Both domain sweeps returned after §1–§9 were drafted. They surfaced issues of higher severity
than anything above. They are **out of this audit's documentation frame** but must not be lost.

### 10.1 Autonomy posture — the merge boundary (CRITICAL, by design)

`merge_mode` defaults to `immediate` and is **absent** from this repo's `.blackhole/config.json`,
so it is active here. In `immediate` and `gated-batch` modes the orchestrator runs
`gh pr merge --squash` as soon as `mergeEligible()` and CI-green are mechanically true
(`phase-loop.md:20-79`, `merge-gate.md:39-63`). Code reaches `main` having never been seen by a
human. `leave-open` is the only human-merge path and is not the default.

This is a deliberate product decision, not a defect — but it is the largest blast-radius
divergence from the human `/git-implement-issue` path, where every merge step is an
`AskUserQuestion` gate (`git-pr` `mode-merge.md:33-82`). It deserves an explicit, recorded
owner decision rather than inheritance from a config default.

Related human gates that exist in mercure and have no blackhole counterpart: routing/track
classification is never surfaced (`phase-handle.md:12`), no PR title/description approval
(`phase-implement.md:15-16`), no post-review sign-off (`phase-review.md:21`).

### 10.2 Review depth (HIGH)

mercure's `x-review` fans out up to 7 specialized parallel agents and cross-correlates via
`x-synthesizer`, promoting severity on multi-agent agreement (`swarm-core.md:7-58`). Blackhole
spawns **exactly one** reviewer per PR with self-applied confidence filtering only
(`phase-review.md:9`, `review-core.md:1-15`). There is no independent adversarial re-check —
which is what `V-SEC-07` (adversarial re-verification) nominally promises.

### 10.3 Declared-but-unenforced V-codes (HIGH)

Five codes appear in `blackhole-vcodes.md` with no auditing site anywhere in `src/agents/` or
`src/references/`:

| Code | Declared | Reality |
|---|---|---|
| `V-FIX-01` | **BLOCK** — root cause documented, never symptom | Zero citations outside the table. The nearest check is `V-DECISION-01`, WARN, repo-local, explicitly "not yet in blackhole-vcodes.md" (`reviewer.md:249`). The promised BLOCK gate does not exist |
| `V-SOLID-03` | BLOCK (bundled `V-SOLID-01/03`) | `reviewer.md:61-63` names SRP only; no LSP/substitutability check |
| `V-DRY-03` | WARN (bundled `V-DRY-02/03`) | Only appears as implementer guidance (`implementer.md:57`); reviewer checklist enumerates V-DRY-01 and V-DRY-04 only |
| `V-SEC-10` | WARN | Zero citations outside `blackhole-vcodes.md:35` |
| `V-CONFIG-01` | WARN | Zero citations outside `blackhole-vcodes.md:53` |

A V-code table that promises BLOCK-severity enforcement it does not deliver is worse than an
honest gap — every agent prompt restating the table asserts a guarantee that is not there.

### 10.4 A third V-code collision, and two silent downgrades (MEDIUM)

Beyond the `V-DOC-04` / `V-DOC-05` collisions in §4:

- **`V-PARETO-02`** — mercure: "gold-plating, polish without user value" (MEDIUM). blackhole:
  repurposed entirely for the `Priority = Gain × (11 − Effort) ≥ 30` issue-gating formula
  (BLOCK). mercure's gold-plating check has no blackhole home at all.
- **`V-ADA-01`** (ARCHITECTURE.md absent) — mercure HIGH, blackhole WARN. Autonomous planning
  can proceed with no architecture baseline.
- **`V-DOC-GOV-01`** (duplicate-concern doc) — mercure HIGH, blackhole WARN. This is precisely
  the doc-tree bloat failure mode ADR-068 exists to prevent, and it is downgraded in the system
  that writes docs unattended.

### 10.5 Systemic: no escalation lane

mercure's HIGH tier means "fix OR escalate to user with justification". Blackhole's reviewer
Iron Law (`reviewer.md` §0) forbids downgrading a BLOCK finding without cited evidence the
violation does not exist — there is no escalation path. Defensible for an unattended campaign
with no human to escalate to, but it converts every mercure HIGH into an unconditional hard
gate. Stricter in aggregate; no judgment lane for edge cases.

### 10.6 Where blackhole is stronger

Not all divergence is deficit. `V-RULE-01` is a functional superset of mercure's V-ADA-09.
`V-SEC-08/09/10`, `V-MERGE-01/02`, `V-HUNT-01/02`, `V-AUTO-01/02`, `V-VIS-01/02` are genuine
autonomy-specific innovations with no mercure equivalent — mercure's human-in-the-loop model
does not need them.

## Could not verify

- Nothing outstanding. All five domain sweeps returned; §10 folds in the two that landed late.
- One methodological caveat, self-reported by the V-code sweep: single-string greps over the
  V-code table produce false positives for codes enforced structurally but never cited by label
  (`V-AUTO-01` is enforced via `design-aggregate.ts` + `planner.md:211-324` yet has no literal
  citation). The §10.3 table was re-checked against both literal and bundled-slash forms, but a
  "primary enforcement site" column on `blackhole-vcodes.md` would make this class of audit
  decidable rather than inferential.
