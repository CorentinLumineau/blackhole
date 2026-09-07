// content-gate-facts.ts — CONTENT_GATE_* config, split out of facts.ts (issue #952). This block
// was extracted because it is a self-contained sub-concern with exactly 2 consumers repo-wide
// (scripts/checks/content-gates.check.ts, scripts/verify.content-gates.test.ts), rather than a
// declaration every facts.ts consumer needs — see facts.ts's own note where this block used to
// live, and ADR-007's `## Post-acceptance amendments` for the full disposition.

// § facts — content-gate budgets, v3 (ADR-007 T6/R3′ extension). V-CONTENTGATE-01 measures two
// things per target: the largest section (boundary unit per `CONTENT_GATE_BOUNDARY_UNITS` below)
// and the whole file. Keys are **glob classes only** — one ceiling per class, never a per-file
// row. A per-file map let every file negotiate its own number, which is how a size gate turns
// into a ratchet; a file that does not fit its class is not handed a bigger class ceiling, it is
// recorded in `CONTENT_GATE_GRANDFATHERED` below against the ADR whose completion retires it.
//
// Class ceilings are seeded at *largest measured non-grandfathered value in the class × 1.2*,
// rounded up — the same seeding convention the pre-v3 per-file rows used, applied to the class:
//
// | Glob class                | Metric      | Measured (largest non-grandfathered) | × 1.2 seed  |
// |---------------------------|-------------|-------------------------------------:|------------:|
// | src/agents/*.md           | section LOC | 155 (coordinator.md)                 | 186         |
// | src/agents/*.md           | file LOC    | 269 (router.md)                      | 323         |
// | src/references/*.md       | section LOC | 222 (forge-sync.md)                  | 267         |
// | src/references/*.md       | file LOC    | 505 (merge-gate.md)                  | 606         |
// | src/references/hunt/*.md  | section LOC |  60 (backlog.md)                     |  72         |
// | src/references/hunt/*.md  | file LOC    | 156 (ci.md)                          | 188         |
// | scripts/checks/*.check.ts | section LOC |  56                                  |  68 (kept)  |
// | scripts/checks/*.check.ts | file LOC    | 181                                  | 218 (kept)  |
// | scripts/lib/build/*.ts    | file LOC    | 239                                  | 287 (kept)  |
//
// Targets are measured as the compiled tree sees them — after `check-utils.ts`'s `read` expands
// include markers — so an agent shell is measured with its modules inlined, not shrunk to nothing
// behind the seam. Pre-v3 per-file rows dissolved into their class ceiling on this cutover; do
// not hand-edit any of these numbers to make a failing check pass — split the file or the section.
export type ContentGateBudget = { maxSectionLoc: number; maxFileLoc: number };

export const CONTENT_GATE_BUDGETS: Record<string, ContentGateBudget> = {
  'src/agents/*.md': { maxSectionLoc: 186, maxFileLoc: 323 },
  'src/references/*.md': { maxSectionLoc: 267, maxFileLoc: 606 },
  'src/references/hunt/*.md': { maxSectionLoc: 72, maxFileLoc: 188 },
  'scripts/checks/*.check.ts': { maxSectionLoc: 68, maxFileLoc: 218 },
  'scripts/lib/build/*.ts': { maxSectionLoc: 68, maxFileLoc: 287 },
};

// Per-file section-boundary unit. A markdown target's section is a `##` heading by default; a
// file declared here is measured with `###` as the unit instead, where a section ends at the
// next `##` *or* `###`. Declared per file rather than per class because the unit is an authoring
// property of one document: `reviewer.md`'s audits and `planner.md`'s tracks are `###` items
// under a single `##` umbrella, so a `##` measurement reports one 800-line "section" naming
// nothing an author can act on. `scripts/checks/*.check.ts` keeps its check-function boundary,
// which is not a heading unit and is therefore not expressible here.
export const CONTENT_GATE_BOUNDARY_UNITS: Record<string, '###'> = {
  'src/agents/reviewer.md': '###',
  'src/agents/planner.md': '###',
};

// § facts — content-gate grandfather allowlist (V-CONTENTGATE-03). Every file measuring above its
// glob class's ceiling when v3 landed, each against the ADR whose completion retires the entry.
// This list is the only legal way to exceed a class ceiling: raising a class ceiling to absorb
// one oversized file is exactly what v3 exists to stop, and `content-gates.check.ts`'s exception
// audit warns when an entry's ceiling has stopped exceeding its class — the shape such a raise
// leaves behind — or cites an ADR with no `documentation/decisions/INDEX.md` row.
//
// A `ceiling` is the file's pre-v3 declared ceiling where it had one, carried over verbatim and
// never raised, and *measured × 1.2* where it had none — the same seeding convention the class
// table above uses.
export type ContentGateGrandfather = { file: string; ceiling: ContentGateBudget; sunset_adr: string };

export const CONTENT_GATE_GRANDFATHERED: ContentGateGrandfather[] = [
  // Both shells had their pre-v3 rows retired under the include seam: their growth unit is "one
  // more module", tracked by `REVIEWER_AUDIT_MODULE_COUNT` / `IMPLEMENTER_GATE_MODULE_COUNT`
  // above. The entries retire when that module-count fact fully replaces LOC for these two.
  { file: 'src/agents/reviewer.md', ceiling: { maxSectionLoc: 89, maxFileLoc: 1076 }, sunset_adr: 'ADR-034' },
  { file: 'src/agents/implementer.md', ceiling: { maxSectionLoc: 105, maxFileLoc: 827 }, sunset_adr: 'ADR-034' },
  // Pre-v3 per-file ceilings, carried over verbatim.
  { file: 'src/agents/planner.md', ceiling: { maxSectionLoc: 380, maxFileLoc: 712 }, sunset_adr: 'ADR-007' },
  { file: 'src/references/worker-schemas.md', ceiling: { maxSectionLoc: 210, maxFileLoc: 819 }, sunset_adr: 'ADR-007' },
];

// V-CONTENTGATE-02 (issue #545) — advisory companion to V-CONTENTGATE-01's hard gate, which is
// binary: a target passes right up to its ceiling and fails one line past it, forcing an
// unplanned same-PR extraction on whoever files the next change. Applied to both `maxSectionLoc`
// and `maxFileLoc`, this ratio warns (never blocks — `ok: true` always, the same shape as
// `queue-coherence.check.ts`) once a target crosses 85% of its budget, surfacing exhaustion
// several PRs early. It is read-only over the same measurements: it raises no ceiling.
//
// 0.85 is derived from real single-PR growth, not hand-picked: scoped `git log --numstat` history
// over the files nearest their ceiling found the largest *normal* (non-initial-creation,
// non-large-refactor) single-commit net addition was +69 lines to worker-schemas.md (7.3% of its
// then-950-LOC budget), +30 to playbook.check.ts (13.8% of the 218-LOC glob-class budget), and
// +27 to planner.md's tightest section (7.7% of its then-350-LOC budget) — 15% remaining headroom
// covers all three with margin. Rejected alternatives: raising the ceilings (forbidden by that
// issue's AC); auto-reserving headroom when a file lands near its ceiling (disproportionate,
// V-PARETO-01/V-KISS-01); and keeping the gate purely binary (four files then sat within 5% of
// their ceiling, so exhaustion was already the common case rather than a rare edge).
export const CONTENT_GATE_WARN_RATIO = 0.85;
