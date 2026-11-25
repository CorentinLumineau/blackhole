---
section: 2. Standard Track
track: standard
---
### 2. Standard Track
*   **Objective**: Issue summary and constraints.
*   **Touch-Paths**: Specific files allowed to change — same generated-dist-tree citation
    convention as Quick Track's Touch-Paths bullet above, not a new heuristic shape (`V-INT-03`).
    Set `package_root` when the Touch-Paths are package-relative, as on Quick Track.
*   **Documentation Impact (when `docs_governance.enabled`)**: Companion/consumer docs the
    Touch-Paths affect (runbook: `artifact-contract.md` + `ops-touch-paths.ts` when ops paths apply), or `None — <justification>`. Omit this bullet's output section entirely
    when `docs_governance.enabled` is absent or `false` (see Plan Output File Template below).
    When this section names a new file under `documentation/` (rather than an update to an
    existing one), note whether search-before-write was considered — confirm no existing doc
    already covers the concern — per `doc-governance.md`, gated by
    `docs_governance.write_governance`.
*   **Critical Files**: Highly sensitive **pre-existing** touchpoint files (e.g. database client, auth config) requiring extra care. Step 8's `critical_files_exist` check Globs every path listed here and blocks on a miss — a file the plan is about to *create* never belongs here; list it under Touch-Paths instead, where no existence check applies.
*   **Codebase Conventions**: Existing patterns to follow (e.g. Drizzle query style, tailwind version).
    When `plans/issue-N-analysis.md` exists (produced by `investigator`'s `analyze` sub-mode),
    use its conventions catalog as the source for this section's rows instead of independently
    re-discovering them, and fold its performance-baseline findings into risk framing — mirrors
    how mercure's `x-plan` consumes `x-analyze`'s Convention Catalog / Performance Baselines
    output. This is read-only consumption of an existing artifact: it does not add a new planner
    track or `##` heading (Accretion Guard compliance — investigator gained a 3rd sub-mode for
    this route, planner gains zero new tracks). When no analysis note exists, fall back to
    independent codebase discovery, unchanged from current behavior.
*   **Database/API Schema Changes**: Detailed schema baselines (`V-API-01`).
*   **Bugfix classification**: When `route.task_type` is `bugfix`, or (no `route` object) the
    issue is self-evidently a bug fix — route-first, content-fallback, same pattern as Quick
    Track's own bullet and Design Track subsection 1 (`V-INT-03`) — stamp `task_type: bugfix` in
    the frontmatter (Plan Output File Template below), activating `implementer.md`'s Bugfix Gate.
*   **Threat Model (`## Threat Model`, conditional)**: Trigger — the issue's resolved
    `route.security_review_required` (post confidence-gate, the same value `review-core.md` §
    Security-mode review already consumes) is `true`; when no `route` object exists (today's
    queue), fall back to a content scan of the Touch-Paths for an auth/credentials/session/
    token/injection-surface/network-boundary touchpoint — same route-first, content-fallback
    pattern already used by Quick Track's Bugfix classification (see above) and Design Track
    subsection 1 (see above), not a new heuristic shape (`V-INT-03`). When triggered, emit a
    6-row STRIDE table (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of
    Service, Elevation of Privilege), each row: threat description, severity
    (`Critical`\|`High`\|`Medium`\|`Low`, mercure's four-tier vocabulary — this is the only place
    blackhole authors that vocabulary; the V-code severities in `blackhole-vcodes.md` stay
    two-tier), mitigation status (`Mitigated`\|`Accepted Risk`\|`Open`). When not triggered, omit
    the section entirely — no `## Threat Model` heading, no placeholder — same
    conditional-omission discipline as the Documentation Impact bullet above.
*   **UI Interpretation Gate (`## UI Interpretation Gate`, conditional, ADR-017)**: Trigger —
    the issue's resolved `route.ui` (post confidence-gate, read from the router's
    already-computed flag, no re-derivation) is `true` **and** the issue's size label is not
    `size:xs` — same trigger and mechanics as Quick Track's UI Interpretation Gate bullet above,
    not a new heuristic shape (`V-INT-03`). When triggered, emit an ASCII/HTML mockup plus a
    three-part `### Owner said` / `### I interpreted` / `### Open ambiguities` block
    (`### Owner said` quotes the owner's own words from the issue verbatim, never paraphrased;
    same `clarify-gates.md` § Gate Content Contract (R-003) UI interpretation gate class as
    Quick Track's bullet above),
    return `status: blocked`, `failing_checks: ["ui_pending_approval"]`, and stamp `ui_gate:
    pending` in the plan's frontmatter (see Plan Output File Template below). `size:xs` at
    `route.ui: true` is the sole exemption; every other size, or an unset/null size, is gated
    (cautious default). When not triggered, omit the section entirely — no `## UI Interpretation
    Gate` heading, no placeholder — same conditional-omission discipline as Threat Model above.
*   **Performance Budget (`## Performance Budget`, conditional)**: Trigger —
    `plans/issue-N-analysis.md` exists (produced by `investigator`'s `analyze` sub-mode) **and**
    its Performance Baselines subsection is non-empty (not the "omit entirely when no measurable
    baseline exists" case). When triggered, emit a table of budgeted components: component/
    surface, baseline metric + value, threshold (the point past which a regression is a
    `V-PERF-02` finding), source citation (carried over from the analysis note). This promotes
    the existing investigator→planner data flow ("fold its performance-baseline findings into
    risk framing", Codebase Conventions bullet above) into a first-class, reviewer-auditable
    section instead of leaving it as unstructured prose — it does not add a second investigator
    consumption path (`V-DRY-01`: same data, new presentation). When not triggered, omit the
    section entirely, same discipline as Threat Model above.
*   **Dependency Blast-Radius (`## Dependency Blast-Radius`, conditional)**: Trigger —
    reuse Design Track subsection 6's grep-based consumer scan (`planner.md` §4.6,
    "Refactoring Impact Analysis"): for every interface the plan's Touch-Paths change
    (function signature, JSON contract field, config key, file-path convention), grep the
    codebase for call-sites/consumers — same direct tool scan, same
    BREAKING/DEPRECATION/TRANSPARENT classification, not a restated grep procedure or an
    LLM estimate (`V-INT-02`/`V-DRY-01`: one scan method, two emission sites). When the scan
    finds **3 or more** affected consumers, emit a table with the same columns as subsection
    6 (consumer file:line, classification, one-line note), plus a `verification` column:
    `executed: <command> → <result>` or `reasoned: <why>`. A plan-time `executed:` row is a
    baseline run of the affected consumers on the plan base (their tests, a typecheck, a
    build), through `with-test-lock`; the post-change proof `V-INT-05` requires is the
    implementer's (`gates/13-verification-evidence-gate.md` § Blast-radius closure). Below 3 affected
    consumers, omit the section entirely — no `## Dependency Blast-Radius` heading, no
    placeholder — same conditional-omission discipline as Threat Model and Performance Budget
    above.
*   **Execution Strategy & Stop Conditions**: Scoped risk-mitigation rules (e.g. "if schema generated migration lacks column X, abort").
*   **Sprint Contract**: Restates, in one place, the per-task acceptance criteria already
    attached to each `## Task Breakdown` item (`— **AC**: <condition>`, see Plan Output File
    Template below) — not a substitute for them. The blanket "all tests and linters pass"
    phrasing remains valid only as the definition of done for tasks with no narrower AC.
