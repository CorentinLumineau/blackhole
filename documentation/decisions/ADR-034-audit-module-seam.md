---
type: adr
summary: "Audit-module seam — generic `{{INCLUDE:<dir>/*}}` primitive expanded in `processFile` before platform conditionals, one compiled file per agent on all 6 agent trees, module dirs declared build-input-only in `BUILD_INPUT_ONLY_DIRS` and two-sidedly checked absent from all 9 reference trees (`V-INCLUDE-01`), append-only module numbering, no mode-variant agent files, footer marker extended to enumerate all sources (`#720`'s byte-equivalence AC relaxed accordingly); many-authored→one-generated recorded as a new provenance shape adopted deliberately; owner ruling overrides a non-dominant `design-aggregate.ts` margin verdict (7.7%/27.1%/17.3% vs 30% threshold) per rubric-bias and build-vs-runtime-cost reasoning; runtime `hunt/`-style loading and per-target assembly rejected with blind-critic evidence (extends ADR-007)"
status: accepted
created: 2026-09-02
last_updated: 2026-09-02
review_trigger: "on protocol change"
related:
  - documentation/decisions/ADR-007-drift-proof-toolchain-reseating.md
  - documentation/plans/plan-retrospective-v0.21.0-remediation.md
---

# ADR-034: Audit-Module Seam — Generic `{{INCLUDE:<dir>/*}}` Build Primitive

## Status

Accepted — 2026-09-02, by owner ruling at the issue #719 design gate, `autonomy.mode: full`.

`scripts/design-aggregate.ts` returned `blocked` (reason `dominance`): all three blind scorers
independently ranked the do-nothing baseline (`status-quo-loc-gate`) first, but the margin over
the runner-up did not clear the 30% threshold under any scorer (7.7% / 27.1% / 17.3%). That
result is read here as a **margin rule, not a conclusion** — the panel produced a unanimous
preference with no scorer disagreement, and the arithmetic simply declined to certify it. Four
reasons for overruling the unanimous-but-non-dominant preference and approving Option A
(`include-marker`, footer retained):

1. **The rubric measured the wrong thing for a do-nothing option.** Under `architecture-choice`
   weights, Risk + Complexity + Reversibility total 65 of 100, and a baseline that builds nothing
   scores near the ceiling on all three by construction. Only Maintainability (25) could express
   the benefit of building anything. The design note itself disclosed this bias (§2) rather than
   hiding it — the arithmetic priced the cost of acting, not the value of the seam, and a
   dominance threshold tuned for comparing real alternatives is the wrong instrument for a matrix
   that includes a baseline guaranteed to win on structure.
2. **ADR-007 R3′ rejected a *runtime* split on a cost that does not apply here.** R3′ declined to
   split `orchestrator.md` because doing so would cost a finite-context agent 3–4 extra context
   fetches per turn — the `hunt/` precedent's winning condition was named explicitly as exclusive
   per-spawn consumption. This seam is build-time: the compiled `reviewer.md` stays exactly one
   file on every agent tree and costs zero extra fetches. The rubric had no column for that
   distinction; it is a rubric gap, not a finding against the seam.
3. **V-YAGNI-01 does not fire on this issue.** #720 (R-13b, reviewer migration) and #721 (R-14,
   implementer gates) are already filed and already blocked on this primitive. Landing a generic
   primitive whose consumers are filed and tracked is phased delivery, not a speculative feature —
   the § Design Principles Validation ◐ blind spot on YAGNI is mitigated by that filing, not left
   open.
4. **The footer stays, and the AC that would conflict with it is relaxed instead.** Option C
   (drop the extended footer marker) was considered and rejected: a compiled file that
   under-reports its real inputs is precisely the drift class ADR-007 exists to prevent, and
   dropping the footer to satisfy a downstream acceptance criterion would be optimizing the seam
   to fit a test rather than the other way around. Instead, **R-13b's (#720) byte-equivalence
   acceptance criterion is relaxed from "byte-identical to today's compiled output" to
   "byte-identical outside the `GENERATED` marker line"** — the footer line naming extra sources
   is the only permitted delta, and #720's planner inherits this relaxation from this ADR rather
   than re-litigating it.

The two corrections the design note made in-bounds carry forward unchanged: the identifier is
`ADR-034` (`ADR-028` is taken by #694), and `{{INCLUDE:<dir>/*}}` module directories are absent
from the 9 `src/references/**`-shaped reference trees while the compiled agent lands on exactly
6 agent trees — one file per agent, per tree.

## Context

`src/agents/reviewer.md` is 778 LOC. Its single `## Audit Checklist` section spans 697 lines and
carries 29 numbered audit subsections, growing by one per governance ADR. Its declared budget is
`maxSectionLoc: 804`, so it sits at 86.7% — past the 0.85 `CONTENT_GATE_WARN_RATIO` advisory —
with roughly 107 lines of headroom. Ground rule 4 of the v0.21.0 remediation plan forbids raising
a content-gate budget to make a PR pass, so the next governance ADR must extract something in the
same PR that adds an audit.

`scripts/lib/build/content.ts`'s `processFile` is today strictly one source file to one output
file, and already performs marker substitution (`{{AGENT_DIR}}`, `{{VCODES_PATH}}`) and
platform-conditional stripping across five platform targets. `src/references/hunt/` plus a
135-LOC `hunter.md` is this repo's module-per-concern precedent, but ADR-007 stated that
precedent's winning condition explicitly: **exclusive per-spawn consumption**. A single reviewer
spawn consults all 29 audits against one diff, which is the `orchestrator.md` shape ADR-007
declined to split, not the `hunter.md` shape.

## Decision

Add a generic `{{INCLUDE:<dir>/*}}` marker, expanded inside `processFile`, with five binding
properties:

1. **One expansion site, first in the pipeline.** Expansion runs as the first transformation in
   `processFile`, before `applyPlatformConditionals` and before the codex branch, so a module's
   own platform-conditional blocks resolve correctly and all five platform targets share exactly
   one code path. Modules are inlined in lexical filename order.
2. **One compiled file per agent.** The marker composes build inputs; it never produces an extra
   output. Every one of the six agent output trees receives exactly one file per agent, and the
   agent pays zero additional runtime context fetches.
3. **Module directories are build inputs only.** They are declared in `BUILD_INPUT_ONLY_DIRS`
   (`scripts/lib/build/facts.ts`), skipped by `compileFolder`, and checked absent from all nine
   compiled reference trees by `V-INCLUDE-01`. The check is two-sided: the declaration is
   authored in `facts.ts`, the actual set comes from an independent filesystem scan of the nine
   trees, and neither side is derived from the other. Mirroring them like `hunt/` is rejected —
   `hunt/` modules are fetched at runtime and must ship, whereas an inlined module would ship
   twice (once inside the compiled agent, once standalone) in every consumer-facing tree.
4. **No mode-variant agent files.** A per-mode agent file (`reviewer-security.md`) is forbidden:
   it collides with the `AGENT_NAMES` tree-shape counts and re-opens the mode-versus-agent
   question issue #439 settled in favour of modes.
5. **Append-only module numbering, citation by named section.** Module filenames carry a
   monotonically increasing `NN-` prefix that is never renumbered; cross-references cite the
   section by name, never by ordinal or absolute line number.

**Provenance.** Under this seam every `src/` file remains wholly authored and every compiled file
remains wholly generated, so ADR-007's rejected `generation-in-place` failure modes — clobbered
hand-edits, hybrid partly-authored files, an eroded "location implies editability" boundary — do
not occur. The source-to-output *mapping*, however, becomes many-authored to one-generated for
the first time in the markdown pipeline. This ADR records that as a **new provenance shape,
adopted deliberately**, not as an existing one restated. `scripts/lib/build/claude-native-settings.ts`
is explicitly **not** cited as precedent: it merges one structured key into an otherwise
untouched hand-authored file, a different shape, and both blind critics rejected the analogy.
The compiled footer marker is extended to enumerate every included source, so no compiled file
under-reports its inputs.

## Alternatives Considered

| Alternative | Rejected because |
|---|---|
| Runtime module loading, the `hunt/<kind>.md` pattern | ADR-007 named exclusive per-spawn consumption as that precedent's winning condition and declined to split `orchestrator.md` on exactly this ground. A reviewer spawn consults all 29 audits in one pass. Both blind critics returned a discriminating CRITICAL: it converts "the agent did not read module N" from impossible into a silent BLOCK-gate completeness regression. |
| Per-target assembly inside the target-compile functions | Both blind critics returned a discriminating CRITICAL: letting each target decide inline versus ship-alongside versus ignore reintroduces the per-target content divergence the single `processFile` path exists to eliminate, and no check comparable to `V-BUILD-01` would prove all targets assembled the same logical content. |
| Keeping the LOC gate and hand-extracting case by case | The strongest rejected option, and the one all three blind scorers ranked first on the fixed `architecture-choice` rubric. It has a direct ADR-007 R3′ precedent for this file shape. Rejected on the judgment that R3′'s reasoning was about *runtime* context fetches (3–4 per turn for a finite-context agent) and a build-time seam costs zero of those, leaving only the deferred-extraction cost that has already forced three unplanned same-PR extractions in this repo. This is the option the design panel's arithmetic favored; the owner ruling above overrides it for the four reasons in § Status. |
| Generating module content from a single derived source | ADR-007's binding rejection of single-source derivation for both sides of a drift check. `V-INCLUDE-01` keeps a declared side and an independently scanned side. |
| Dropping the extended footer marker (Option C) | Considered and rejected in the same ruling that approved the seam: under-reporting a generated file's real inputs is the drift class ADR-007 exists to prevent. R-13b's byte-equivalence criterion is relaxed instead (§ Status point 4) rather than trimming the footer to fit it. |

## Consequences

**Positive.** `reviewer.md`'s ceiling pressure ends structurally rather than being deferred; 29
audits become independently editable and independently reviewable; a new governance audit is a
new file rather than an edit to a 697-line section; R-13b, R-14 and R-15 of the remediation plan
unblock; the primitive is generic, so `implementer.md` and any future accreting agent get the
same seam with one `BUILD_INPUT_ONLY_DIRS` entry and zero build-code changes (OCP).

**Negative.** New machinery ships with zero production consumers until R-13b lands — mitigated,
not eliminated, by #720 and #721 already being filed and blocked on this primitive (§ Status
point 3). The compiled output contains a second copy of every module body; this is checked
duplication under `V-BUILD-01`'s dirty-diff assertion, the same guarded exception ADR-007 already
takes for the README and AGENTS roster tables. The extended footer marker is a real byte-level
delta, so **R-13b's (#720) "byte-equivalent to today's compiled output" acceptance criterion is
relaxed to "byte-identical outside the `GENERATED` marker line"** — this ADR is the binding
record of that relaxation; #720's planner inherits it and must not re-derive or re-litigate it. A
module directory that is added without a matching `BUILD_INPUT_ONLY_DIRS` entry ships as
duplicate content in nine trees until `V-INCLUDE-01` fails CI.

**Protocol surface.** One new BLOCK V-code (`V-INCLUDE-01`), one new check file, one
`src/references/blackhole-vcodes.md` row-count bump (verified from a live table count, not
hand-arithmetic — see the implementation plan's T5 for the current baseline).

## Post-acceptance amendments

- **2026-11-25, issue #1387 (on-demand modules for mechanically gated audits).** The seam above
  rejected runtime loading because it adds fetches to every turn. Measured at spawn, that cost is
  the smaller one: every reviewer spawn paid for all 33 modules (22,247 estimated tokens, bytes / 4)
  although 14 of them open with a clause that says "skip this section" (a config key, plan
  frontmatter or heading, a diff path, a queue field, or the spawn mode). This amendment allows a
  hybrid and reverses nothing: the build seam, `{{INCLUDE:<dir>/*}}`, `BUILD_INPUT_ONLY_DIRS` and
  the 19 inlined modules are unchanged.
  - **Rule.** A module may be on-demand only if its first detection or gate clause is mechanical.
    Judgment-triggered modules (for example `V-DOCSYNC-01`'s public-API surface, `V-PROOF-01`'s
    user-visible change) stay inlined, as do modules that apply to every diff.
  - **Where.** On-demand bodies live in `src/references/audit-modules/` and are mirrored into the
    reference trees like `hunt/` (not build-input-only). `src/agents/reviewer.md` keeps one `###`
    stub per module under `## On-demand audit modules`, with the module's own heading text, a
    one-line `Load when` trigger and a `Read` path, so `§ <Section>` citations still resolve.
  - **Fail-open.** One sentence in that section: when unsure whether a trigger holds, Read the
    module; a module whose trigger holds must be read before the final JSON.
  - **Checks.** `V-AUDIT-01` Legs A to C scan both directories and count each against its own
    constant (`REVIEWER_AUDIT_MODULE_COUNT`, `REVIEWER_ONDEMAND_AUDIT_MODULE_COUNT`); Leg D fails a
    module with no stub, a stub without its `Load when` line, its `Read` path or a V-code the module
    claims. Leg E fails a module with no predicate in `AUDIT_MODULE_TRIGGERS`
    (`scripts/lib/audit-module-triggers.ts`) and a predicate with no module. The generated-stub
    alternative stays deferred until a second consumer exists.
  - **Mechanical load check (V-PARETO-02).** Eleven of the 14 modules enforce `BLOCK` codes, so
    "keep every BLOCK module inlined" would have undone the split. Instead the reviewer return
    carries `loaded_modules[]` (module file names; `validateReviewer` rejects unknown names), and
    `review-aggregate.ts --audit-context-file <json>` re-evaluates each module's trigger from facts
    the orchestrator holds (diff paths, plan text, config, route, queue, dispatch kind) and exits 1
    naming any module whose trigger holds but is absent from `loaded_modules` (an absent list fails
    every triggered module). The check is fail-closed and wired: the orchestrator builds the
    context with `scripts/audit-context.ts` before every aggregate (`review-core.md` § Aggregate
    invocation), and the CLI exits non-zero when the flag is absent. The context builder takes the
    plan, config, queue and issue as required inputs and fails with a named error on a missing or
    unreadable file or an issue absent from the queue (a no-plan track declares the absence with
    `--no-plan-reason`). `--direct-review` (the orchestrator's own review, no reviewer spawned) is
    conditional, not an opt-out: it needs the same context and is accepted only when every changed
    path is in the docs-only doc-path set and no module trigger other than the docs-only one holds.
    The frontend-diff predicate for module 14 reads its path set from `scripts/detect-frontend.sh`
    (`scripts/lib/frontend-paths.ts`), so the keyword set has one home. The reviewer-facing
    `Load when` stubs stay the wording; the predicate table is the script-side copy. Leg E keeps the
    directories aligned and fails a stub that does not spell every path glob its predicate uses
    (`AUDIT_TRIGGER_GLOBS`). A stub and its predicate can still disagree in meaning beyond those
    globs; that residual is a review concern, not a gate.
  - **Module 24 stays inline.** The independent-security-verification procedure is read by a
    verification spawn whose envelope is never aggregated on its own, so a load check for it had no
    call site. Rather than add a second aggregate hop, it moved back to `src/references/audits/`
    (19 inlined, 14 on-demand).
  - **Direct review follows module 08's predicate.** `--direct-review` is accepted only when module
    08's own plan-first trigger holds (a plan declaring neither `execution_mode: docs-only` nor
    `task_type: docs` is not docs-only, whatever the extensions) as well as the path and
    other-trigger checks. `audit-context.ts` refuses `--no-plan-reason` when a plan artifact exists
    next to the queue file, records the reason in the context (echoed by the aggregate as
    `no_plan_reason`), fails on an empty diff, and resolves the route through `latestRoute`
    (latest ledger `routing_decisions` row, else the queue entry).
  - **Residual risk.** `loaded_modules[]` is a declaration by the reviewer. The gate proves a module
    was listed, not that it was read or applied: a reviewer can name a module without reading it. The
    check closes the silent-skip case, not the dishonest one; the reviewer's own findings and the
    recheck pass remain the only evidence the audit ran.
  - **Measured.** Compiled `agents/reviewer.md` 22,247 to 13,538 estimated tokens (54,152 B), about 8,709
    saved per reviewer spawn (`bun run scripts/worker-context-size.ts`). The saving remains
    because a normal backend diff in a repo without `docs_governance` triggers none of the 14.

## Worker V-code lookup

Every worker shell's `Binding rules:` line used to point at `blackhole-vcodes.md`, which a worker
read whole (37,283 B, about 9.3k estimated tokens per spawn). The six shells now carry one
identical line telling the worker to `grep -nF 'V-<FAMILY>-'` the table for each code it cites or
a gate names, and to read the whole table only when the task needs the full code set. The table
stays the single source: a family prefix matches the grouped rows (`V-SOLID-01/03`,
`V-KISS-01 / V-YAGNI-01`), and the row's Severity column is the only source of a finding's
severity, which `review-aggregate.ts` post-processes. `scripts/worker-vcode-lookup.test.ts` pins
the six lines as identical and runs the lookup against the table. Residual risk: a worker that
never looks a code up can miss a rule it would have read; the reviewer's V-code audit remains the
backstop.
