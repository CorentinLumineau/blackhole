// § facts — machine-checkable ground truth, declared exactly once (ADR-007 T3/R1′). Direct
// consumers: scripts/checks/{ground-truth,vocabulary,content-gates,playbook,codex-build,
// claude-dist,gemini-build,agent-dir-citations}.check.ts, scripts/{verify,doctor,install-verify}.ts,
// scripts/lib/check-common.ts, and verify.* / build / tree-shape tests. verify.ts's
// facts-conformance check (V-GROUND-01) compares an independent filesystem/doc scan against
// these declarations — never restate any of these as an inline literal at a consumption site,
// and never collapse the scan and the declaration onto one derivation path (the critics'
// binding rejection of single-source generation, ADR-007 Rejected Alternatives).

export const RULES_LIST = ['blackhole-protocol.md', 'blackhole-state.md', 'blackhole-vcodes.md', 'doc-governance.md'];

/** The 8 agent files — bare names (no prefix) since the Blackhole rename (#64). */
export const AGENT_NAMES = ['coordinator', 'orchestrator', 'planner', 'implementer', 'reviewer', 'router', 'investigator', 'hunter'] as const;
export const AGENT_MD_FILES = new Set(AGENT_NAMES.map((n) => `${n}.md`));
export const AGENT_YAML_FILES = new Set(AGENT_NAMES.map((n) => `${n}.yaml`));

/** Exact phase strings used in `queue.json` `issues.*.phase` (V-PHASE-01). */
export const PHASE_NAMES = ['handle', 'plan', 'implement', 'review', 'done'] as const;

/** The `src/references/phase-*.md` roster — the 5 five-phase-lifecycle playbooks (note the
 *  terminal `done` phase loops back via `phase-loop.md`, it has no dedicated `phase-done.md`
 *  file) plus `phase-stop.md`, the campaign control-surface `stop` mode playbook (issue #478) —
 *  not a lifecycle phase, but it shares the `phase-*.md` filename prefix and directory, so
 *  `V-GROUND-01`'s independent filesystem scan requires it declared here too (V-PHASE-01/V-GROUND-01). */
export const PHASE_PLAYBOOK_FILES = ['phase-handle.md', 'phase-plan.md', 'phase-implement.md', 'phase-review.md', 'phase-loop.md', 'phase-stop.md'];

/** References every phase playbook assumes exist under `src/references/` (V-GROUND-01). */
export const REQUIRED_REFERENCES = ['review-core.md', 'worker-schemas.md', 'checkpoint-protocol.md'];

/** Row count of `src/references/blackhole-vcodes.md`'s `| V-...` table (V-GROUND-01). */
export const VCODE_TABLE_ROW_COUNT = 67;

// § facts — value vocabularies (issue #320, ADR-007 R1′ extension). Closed sets of enum-shaped
// strings that agent prose restates verbatim at many consumption sites, declared once here and
// checked by V-VOCAB-01's independent scan-vs-declaration comparison (never generated from the
// scan — same two-separately-fallible-derivations discipline as V-GROUND-01 above).

/** `queue.json` `issues.<n>.status` (V-VOCAB-01) — canonical enum per `queue-dag.md`'s field-rules
 *  table. Scanned narrowly (lines mentioning both `phase` and `status:`) to avoid colliding with
 *  the differently-shaped worker-JSON `status` vocabulary that shares the same field name. */
export const QUEUE_STATUSES = ['blocked', 'ready', 'in-flight', 'merged', 'closed'];

/** `queue.json` `issues.<n>.notes`' closed kebab-token gate-value subset (V-VOCAB-01) — the class
 *  of value that caused ADR-012 Finding 3b (`awaiting-design-approval` restated in one file,
 *  omitted from two others' enums). `notes` also carries open, parameterized free text (e.g.
 *  `overlap with #N`) that is out of scope for a closed-set check by design. */
export const QUEUE_NOTES = [
  'awaiting-user-clarification',
  'awaiting-plan-approval',
  'awaiting-design-approval',
  'awaiting-investigation',
  'awaiting-recovery-approval',
  'awaiting-ruling-recheck',
  'clarify waived — narrow technical',
];

/** `kaizen.kinds` (V-VOCAB-01) — hunt territory kinds, canonical default per `config-template.md`. */
export const HUNT_KINDS = ['quickwins', 'best-practices', 'coverage', 'refactor', 'bug', 'retrospective', 'parity', 'ux-coherence', 'docs'];

/** Platform build targets (V-VOCAB-01) — see `PLATFORM_TARGETS` above `type Target`; also the
 *  declared side of the scripts/**\/*.ts scan for any stray re-hardcoded copy of this array. */
export const PLATFORM_TARGETS = ['cursor', 'claude', 'skills', 'gemini', 'codex'] as const;

export type Target = (typeof PLATFORM_TARGETS)[number];

// NOTE: an ADR-status vocabulary (`ADR_STATUSES`) was declared here in the original version of
// this PR and removed in fix round 1 — issue #324 (PR #338) already owns ADR-status
// conformance with a purpose-built, more rigorous check (`adr-status.check.ts`, cross-validating
// frontmatter, INDEX row, and the in-body `## Status` section against the designed
// `accepted | superseded | deprecated` enum). Keeping both would have been a V-INT-03 "third
// variant of a solved concern" — see `scripts/checks/vocabulary.check.ts`'s header comment.

// § facts — content-gate budgets (issue #323, ADR-007 T6/R3′ extension). Generalizes
// V-CONTENTGATE-01 from a single hardcoded file (orchestrator.md, new-sections-only) to a
// declared `{file/glob -> {maxSectionLoc, maxFileLoc}}` map — closing the same instance-vs-class
// gap #320 closed for value vocabularies. A key with a trailing `*` (e.g.
// `scripts/checks/*.check.ts`) is a glob class: every file in that directory matching the
// suffix after the `*` is covered automatically, so a future domain file needs zero map edits.
// Each budget is seeded at *current measured value (at issue #323's landing commit) × 1.2*,
// rounded up — the gate ratchets from today's shape rather than blocking on day one. Do not
// hand-edit these numbers to make a failing check pass — split the file/section, or accept that
// growing past the seeded ceiling is the violation being reported. Agent-file rows measured at
// #323 implementation time (base: blackhole/issue-327, post-#322 split, post-#320 vocabularies);
// `scripts/checks/*.check.ts` row re-measured at #336 (post build.check.ts domain split);
// `src/references/hook-schemas.md` row added at #473 (new file split out of worker-schemas.md —
// worker-schemas.md's own row is left unchanged, never raised, per that issue):
//
// | File / class                       | Metric              | Measured | × 1.2 seed |
// |-------------------------------------|---------------------|---------:|-----------:|
// | src/agents/orchestrator.md           | max `##` section LOC | 15       | 18         |
// | src/agents/orchestrator.md           | total file LOC       | 153      | 185        |
// | src/agents/planner.md                | max `##` section LOC | 291      | 350        |
// | src/agents/planner.md                | total file LOC       | 593      | 712        |
// | src/references/worker-schemas.md     | max `##` section LOC | 149      | 179        |
// | src/references/worker-schemas.md     | total file LOC       | 937 (#492)| 950 (#492)|
// | src/references/hook-schemas.md       | max `##` section LOC | 84       | 101        |
// | src/references/hook-schemas.md       | total file LOC       | 139      | 167        |
// | scripts/checks/*.check.ts            | max `check*()` fn LOC | 56      | 68         |
// | scripts/checks/*.check.ts            | max single file LOC   | 181     | 218        |
// | scripts/lib/build/*.ts               | max single file LOC   | 239     | 287        |
//
export type ContentGateBudget = { maxSectionLoc: number; maxFileLoc: number };

export const CONTENT_GATE_BUDGETS: Record<string, ContentGateBudget> = {
  'src/agents/orchestrator.md': { maxSectionLoc: 18, maxFileLoc: 185 },
  'src/agents/planner.md': { maxSectionLoc: 350, maxFileLoc: 712 },
  'src/references/worker-schemas.md': { maxSectionLoc: 179, maxFileLoc: 950 },
  'src/references/hook-schemas.md': { maxSectionLoc: 101, maxFileLoc: 167 },
  'scripts/checks/*.check.ts': { maxSectionLoc: 68, maxFileLoc: 218 },
  'scripts/lib/build/*.ts': { maxSectionLoc: 68, maxFileLoc: 287 },
};

// V-CONTENTGATE-02 (issue #545) — advisory companion to V-CONTENTGATE-01's hard gate. The hard
// gate is binary: a file/section passes right up to its ceiling and fails one line past it, so
// three files have now landed exactly at their ceiling in this campaign, each forcing an
// unplanned, same-PR extraction on whoever happened to file the next change. This ratio, applied
// to both `maxSectionLoc` and `maxFileLoc`, warns (never blocks — `ok: true` always, same
// established shape as `queue-coherence.check.ts`, issue #570) once a target crosses 85% of its
// budget, surfacing exhaustion several PRs before the hard gate blocks instead of only at the
// exact moment it does. Does not raise, lower, or otherwise touch any `CONTENT_GATE_BUDGETS`
// value (AC #3) — this is a second, read-only threshold over the same measurements.
//
// 0.85 is derived from real single-PR growth, not hand-picked: scoped `git log --numstat` history
// (issue #545 Claims Verified row 11) over the files nearest their ceiling found the largest
// *normal* (non-initial-creation, non-large-refactor) single-commit net LOC addition was +69
// lines to worker-schemas.md (7.3% of its 950-LOC budget), +30 lines to playbook.check.ts (13.8%
// of the 218-LOC glob-class budget), and +27 lines to planner.md's tightest section (7.7% of its
// 350-LOC budget). 15% remaining headroom covers all three with margin.
//
// Alternatives considered and rejected: (1) raise the ceilings — forbidden outright by AC #3; (2)
// reserve headroom automatically when a file lands at/near its ceiling — disproportionate
// complexity for a problem that three unplanned-but-beneficial extractions already show is
// tolerable once surfaced early (V-PARETO-01/V-KISS-01); (3) accept the binary gate as intended
// — rejected because, measured at this decision's base commit, four real files sit within 5% of
// their ceiling, meaning exhaustion is already the common case, not a rare edge.
export const CONTENT_GATE_WARN_RATIO = 0.85;

/**
 * Total check count across every `scripts/checks/*.check.ts` domain file (ADR-007 T5/R2′:
 * `verify.ts` is a thin runner that glob-discovers these files — there is no central registry).
 * Bump this alongside any change to a domain file's `runChecks()` array — either adding a new
 * `scripts/checks/{domain}.check.ts` file (new domain, its own `runChecks()` contributing its
 * count), or adding/removing an individual check inside an existing domain's `runChecks()`
 * array. `verify.ts` warns (does not fail) on a mismatch, so this is the sole place the
 * expectation is declared — never restate it as a literal at any consumption site.
 */
export const EXPECTED_CHECK_COUNT = 61;

/**
 * Doc-tree health thresholds (issue #462, ADR-021 D6 Scope 1) — declared exactly once here per
 * this file's SSOT convention above, consumed by `scripts/checks/doc-health.check.ts`
 * (V-DOCHEALTH-03) and cited by name — never restated as an inline numeric literal — in
 * `src/references/doc-governance.md`'s `## Doc-Tree Health Signal` section prose.
 * `verify.doc-health.test.ts` independently parses that compiled prose's stated numbers and
 * diffs them against this export, the same "declared once, independently verified" discipline
 * `V-GROUND-01` uses above.
 */
export type DocHealthThresholds = {
  singleDocLineCeiling: number;
  rootIndexRowCeiling: number;
  treeSizeAdvisory: number;
  deprecationWindowDays: number;
};

export const DOC_HEALTH_THRESHOLDS: DocHealthThresholds = {
  singleDocLineCeiling: 400,
  rootIndexRowCeiling: 200,
  treeSizeAdvisory: 500,
  deprecationWindowDays: 90,
};
