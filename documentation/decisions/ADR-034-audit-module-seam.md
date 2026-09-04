---
type: adr
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
