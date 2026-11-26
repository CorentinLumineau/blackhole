---
section: 4. Design Track
track: design
---
### 4. Design Track

Entered **only** on an explicit `track: design` spawn directive — never self-selected from issue
content (Step 2). Codebase analysis depth (Step 3) matches the **Standard** track — the
alternatives, trade-off matrix, component decomposition, refactoring-impact consumer discovery,
and assumption audit below must be grounded in the actual code, not assertion; there is no
"light" shortcut for the design track. Produces a **single** consolidated artifact at
`plans/issue-N-design.md`. Returns `status: blocked` unconditionally — "no confidence bypass",
human always decides — **except** the one gated path §4.8 defines (ADR-010 D4): when
`autonomy.design_autonomy` is `true` AND `scripts/design-aggregate.ts`
independently computes `status: "ready"` from the primary matrix plus both blind critics' JSON.
The planner never self-certifies this path — it is only ever reachable through the script's own
verdict; see §4.8.

The artifact consolidates 8 ordered subsections:

1.  **Requirements Framing**: Derive from the issue body plus the router's classification
    rationale when the `queue.json` issue entry carries a `route` object (`route.task_type`, any
    router notes). No live gate here — `needs_clarification` already resolved ambiguity upstream
    before `needs_design` could fire (ADR-004 flow: Clarify → RE-ROUTE → Design). When no `route`
    object exists (today's queue — router dispatch not yet wired in), frame requirements from
    the issue body alone, unchanged from current behavior.
2.  **Options + Trade-off Matrix**: 2-3 real alternatives, at full Standard-track analysis depth.
    Each option gets one row in a trade-off matrix; columns are chosen per-decision from
    {Complexity, Maintainability, Risk, Effort, Reversibility, Consistency-with-existing-pattern}
    — pick 3-5 relevant columns, do not force all six for every decision (`V-KISS-02`).
    **ADR citation check (issue #775)**: before citing an ADR's precedent as decisive evidence
    for an option, read its `## Post-acceptance amendments` section, if present, and either
    quote the amendment or drop the citation (closes the #719 stale-citation failure). Record
    each citation as `{adr, option, amendment_acknowledged}` for the `design-aggregate.ts`
    invocation input (subsection 3/§4.8).
3.  **Adversarial Evaluation (via multiplicity, no 8th agent — blind critics, ADR-010 D4)**:
    After drafting Options + Trade-off Matrix + a provisional Chosen, spawn **2 additional
    parallel `Agent` tool calls** with `subagent_type: planner` — the 2-invocation multiplicity
    cap, the critique-only mode, and the no-write/no-recursion constraints below are unchanged
    from the pre-ADR-010 contract:
    - **What each invocation receives**: the Options list from subsection 2 **with the primary's
      provisional Chosen field stripped** before spawn — the critics are blind to which option
      the primary favors — plus the fixed rubric columns and weights for this decision's type
      (`design-rubric.md`).
    - **What each invocation returns**: the `worker-schemas.md` § Design Track Critic JSON
      schema — `per_option_scores` (every option scored 1-5 against the fixed rubric columns)
      plus `findings` (each tagged `discriminating` or `domain-inherent`, with a severity) —
      **not** free-text critique. Invocation A and B remain independent scorers; there is no
      assigned "attack primary" / "steelman rejected" split under blind scoring — both critics
      score every option against the same fixed rubric, independently. **ADR citation check
      applies here too, independently (issue #775)**: critics score independently and cannot
      rely on the primary planner having done it — a `findings[].note` citing an ADR must first
      read that ADR's `## Post-acceptance amendments` section and either acknowledge the
      amendment or drop the citation. Each critic returns `adr_citations[]` alongside
      `per_option_scores`/`findings`, same `{adr, option, amendment_acknowledged}` shape as the
      primary's (`worker-schemas.md` § Design Track Critic).
    Both invocations run in **critique-only mode**, verbatim as before: they MUST NOT write any
    file (no `plans/issue-N-design*.md` of their own) and MUST NOT spawn further `planner`
    invocations (recursion guard — multiplicity is capped at 2, not open-ended). They return
    their JSON in their final response only. The primary planner reads both critic JSONs and
    synthesizes them into this subsection as prose (for human readability in the artifact) — this
    synthesis text is **display-only**; it is never the verdict source. The primary also computes
    its own weighted matrix (same fixed rubric, `design-rubric.md`'s weighted-total formula) and
    passes its matrix plus the raw critic JSONs plus the Refactoring Impact rows (subsection 6)
    to `scripts/design-aggregate.ts` (Task 2, §4.8 below) as the deciding input. This reuses the
    existing `planner` agent via multiplicity — it does not introduce a new agent identity (see
    Accretion Guard below).
4.  **Component Decomposition**: Responsibilities list plus a Mermaid diagram, but **only** when
    the design is genuinely multi-component — i.e. it introduces or changes a boundary between
    two or more distinct responsibilities/files/services. Skip this subsection entirely (state
    "N/A — single-component design" and move on) for trivial designs, e.g. a single-file,
    single-responsibility change with no new boundary.
5.  **Design Principles Validation**: Self-scored checklist, one row per applicable axis (SRP,
    OCP/DIP where relevant, DRY, KISS, YAGNI, an applicable Pattern check), each scored with the
    same `✓ / ~ / ◐ / ✗` vocabulary as the Assumption Audit below (reuse, don't reinvent —
    `V-INT-01`), one-sentence justification per row.
6.  **Refactoring Impact Analysis**: For every interface the design changes (function signature,
    JSON contract field, config key, file-path convention), grep the codebase for all
    call-sites/consumers — direct tool scan, no agent spawn. Classify each consumer:
    **BREAKING** (call site fails or behaves incorrectly unless updated), **DEPRECATION** (still
    works, should migrate), or **TRANSPARENT** (no observable change). Table columns: consumer
    file:line, classification, one-line note. Highest-value addition for unsupervised merges.
7.  **Assumption Audit**: Key assumptions underpinning the Chosen option, each marked `✓`
    Validated / `~` Contestable / `◐` Blind spot / `✗` Incorrect, with a one-line note per
    assumption.
8.  **Gate (ADR-010 D4 — config-gated, otherwise unchanged)**: Staged ADR bodies must follow
    `src/references/adr-template.md`'s `designTrack` shape (`ADR_SHAPES` in `facts.ts`; `##` missing = blocked). The design note MUST include a
    `### What the owner needs to decide (R-003 executive summary)` block satisfying
    `clarify-gates.md` § Gate Content Contract's four elements (`.blackhole/plans/issue-496-design.md`
    § 8 is a worked example), regardless of the `status` outcome below. When
    `.blackhole/config.json` `autonomy.design_autonomy` is `true`, invoke
    `scripts/design-aggregate.ts` with the primary's weighted matrix (subsection 2/3), both
    critics' raw JSON (subsection 3), the Refactoring Impact Analysis rows (subsection 6), and
    `primary.adr_citations` plus each critic's `adr_citations` (subsection 2/3) as the input's
    ADR-citation gate data. The planner reads the script's returned `status`.
    **The planner MUST NOT substitute its own judgment** for it — the script is the sole source
    of the verdict, never the planner's own read of the artifact's substance — skipping the invocation is a `V-AUTO-01` BLOCK finding:
    - `status: "ready"` (from `design-aggregate.ts`) → before writing, run
      `bash scripts/detect-doc-schema.sh` (repo-convention-precedence detection, ADR-012 E1) against
      both target artifacts: `index` mode on `documentation/decisions/INDEX.md`, `frontmatter`
      mode on an existing sibling ADR file if one exists. Render the new ADR's frontmatter and its
      `documentation/decisions/INDEX.md` row in the detected schema per
      `doc-governance.md` § Repo Convention Precedence's three-outcome contract; on
      `schema=ambiguous` for either artifact, render in blackhole's own schema and include a
      `V-INT-01` WARN finding (citing the offending `file:line`) in the same worker JSON return.
      Then, when `docs_governance.enabled` and `docs_governance.write_governance` both resolve
      present and `true` (absent or `false` on either ⇒ skip staging entirely — write nothing,
      append no manifest entry), stage the rendered ADR body at
      `.blackhole/staged/<issue>/ADR-{NNN}-{slug}.md` and the INDEX row fragment at
      `.blackhole/staged/<issue>/decisions-index-row.md`, via Bash heredoc + atomic `mv` (full-destination-path `.tmp` naming — `blackhole-state.md` § Staging, issue #911), at the
      absolute repo-root staging directory the orchestrator passes at spawn time
      (`blackhole-state.md` § Staging (ADR-021 D1)). Append both entries (one call each) via
      `bun run --cwd <abs repo-root> scripts/stage-manifest.ts append --manifest <abs repo-root>/.blackhole/staged/<issue>/manifest.json --issue <N> --entry-json '<entry json>'` (atomic `.tmp` + rename, never a shell redirect; exit 1 means refused, fix and re-run). **Manifest write is
      mandatory, not narration** (issue #782): rendering the artifacts without this append — or
      narrating the staging without executing it — does not satisfy ADR-021 D3 and leaves
      `V-AUTO-02` unable to detect the gap; confirm both entries exist on disk before returning
      `status: "ready"`. This is staging, not a commit inside the
      issue's own PR — no branch exists yet at Phase 2 (ADR-021 D1); the implementer's carry-step
      (`implementer.md` § Carry Staged Artifacts, ADR-021 D2) is what later copies the staged
      files into `documentation/` and commits them. No orchestrator file write, no draft/final
      flip.
      Return `status: "ready"` in the worker JSON with `track: "design"` — the `ready`/`blocked`
      worker-JSON contract shape itself is unchanged; `V-INT-01` rides in the existing `findings`
      array, no new required field.

      **Cross-Cutting Heuristic (ADR-012 E3, Trigger A)**: apply this 3-question test to the
      ADR's Decision section, using the same staging mechanism as the ADR + INDEX row above (no
      direct `ARCHITECTURE.md` write — no branch exists yet at Phase 2, ADR-021 D1). The three questions (Breadth, Enforcement stakes, Foreclosure) are worded once, in
      `planner.md` Step 4 — reuse them as written. Score ≥2/3 YES → stage the bullet `- {constraint, one sentence, imperative} (ADR-{NNN})` at
      `.blackhole/staged/<issue>/architecture-active-constraint.md` (full-destination-path `.tmp` naming — `blackhole-state.md` § Staging, issue #911) and append a manifest entry
      (`target_path: "ARCHITECTURE.md"`, `target_kind: "append_row"` — `blackhole-state.md` §
      Staging) alongside the ADR/INDEX entries. The `(ADR-{NNN})` suffix is mandatory — the
      primary pollution mitigation, giving a future pruner a citation to check. Score ≤1/3 → do
      not append; the constraint stays local to the ADR's Decision text. The `status:
      "ready"`/`"blocked"` worker-JSON contract shape is unchanged — no new required field.
    - `status: "blocked"` (from `design-aggregate.ts`), **or** the config gate is off or the
      `autonomy` block is absent → return `status: "blocked"` exactly as today: unconditional,
      no confidence bypass, the same code path the block has always used. The full analytical
      substance above (Options + trade-off matrix, adversarial evaluation, component
      decomposition, design principles validation, refactoring impact analysis, assumption
      audit) does not itself create a `ready` exception for an "obviously correct" design —
      only `design-aggregate.ts`'s own computed verdict can.
    - `resume_context: design_approved` (ADR-012 E2.3 — from an explicit orchestrator spawn
      directive; **never** self-selected, **never** inferred by re-invoking
      `design-aggregate.ts` or by re-reading the design note's substance) → promote the
      on-disk `.blackhole/plans/issue-N-design.md` **verbatim**: no re-analysis, no
      re-invocation of `design-aggregate.ts`, no blind-critic re-spawn. **ADR staleness guard
      (`V-ADR-07`, issue #775)** — first step of this branch, before promotion, since this is the
      one moment a stale citation could reach a PR without any scoring pass re-checking it:
      extract every `ADR-\d+` reference from the on-disk design note's body (same regex idiom
      `adr-supersession.check.ts`'s phrase-scan leg uses), and for each, run
      `git -C <main-clone> diff --name-only <plan_base_commit>..HEAD --
      documentation/decisions/ADR-{N}-*.md` — the same `git diff --name-only` idiom as
      `implementer.md`'s Plan Drift Check, substituting the cited-ADR path for a Touch-Path
      glob. A drifted ADR appends a `V-ADR-07` WARN finding to `findings[]` naming it and
      recommending re-validation — **advisory only**: it never blocks promotion and never
      re-invokes `design-aggregate.ts` or a blind-critic re-spawn. Then run
      `bash scripts/detect-doc-schema.sh` exactly as the `ready` branch above (same
      repo-convention-precedence detection, ADR-012 E1) and render
      `documentation/decisions/ADR-{NNN}-{slug}.md` plus the matching
      `documentation/decisions/INDEX.md` row in the detected schema. When `docs_governance.enabled`
      and `docs_governance.write_governance` both resolve present and `true` (absent or `false` on
      either ⇒ skip staging entirely — write nothing, append no manifest entry), stage both at
      `.blackhole/staged/<issue>/ADR-{NNN}-{slug}.md` and
      `.blackhole/staged/<issue>/decisions-index-row.md` via the same Bash heredoc + atomic `mv` (full-destination-path `.tmp` naming — `blackhole-state.md` § Staging, issue #911)
      write and manifest append as the `ready` branch above. **Manifest write is mandatory, not
      narration** (issue #782): promoting the design note verbatim does not satisfy ADR-021 D3 on
      its own — this append must still execute in this same spawn, and its absence leaves
      `V-AUTO-02` unable to detect the gap. No orchestrator file write
      (orchestrator is `disallowedTools: [Write, Edit, Delete]`), no draft/final flip. This is
      staging, not a commit inside the issue's own PR — no branch exists yet at Phase 2 (ADR-021
      D1); the implementer's carry-step (`implementer.md` § Carry Staged Artifacts, ADR-021 D2)
      commits the staged files once the PR branch exists. Return `status: "ready"`,
      `track: "design"` in the worker JSON —
      identical shape to the `ready` branch above, so no downstream consumer needs a new case.
