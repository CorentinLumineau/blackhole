// § facts — machine-checkable ground truth, declared exactly once (ADR-007 T3/R1′). Direct
// consumers: scripts/checks/{ground-truth,vocabulary,playbook,codex-build,
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
export const VCODE_TABLE_ROW_COUNT = 122;

/** Vendored mercure V-code snapshot staleness window in days (V-MPARITY-02, issue #869). */
export const MERCURE_VCODE_SNAPSHOT_STALE_DAYS = 90;

// § facts — build-input-only directories (ADR-034, issue #719). A declared-fact / independent-
// scan pair, the same shape VCODE_TABLE_ROW_COUNT/CONTENT_GATE_BUDGETS/DOC_HEALTH_THRESHOLDS
// already use: each entry names a directory under `src/` (path relative to `srcDir`, e.g.
// `references/<module-set>`) whose `.md` files are build inputs consumed only via a
// `{{INCLUDE:<dir>/*}}` marker (scripts/lib/build/content.ts `expandIncludes`) — never mirrored
// into a compiled output tree. `compileFolder` skips any file under a declared entry;
// `scripts/checks/build-input-dirs.check.ts` (V-INCLUDE-01) independently scans the 9
// `src/references/**`-shaped compiled reference trees to verify none of them leaked a declared
// entry, and separately verifies every `{{INCLUDE:<dir>/*}}` marker in `src/agents/**`/
// `src/references/**` names a directory declared here — neither side is derived from the other
// (ADR-007's binding rejection of single-source derivation for a drift check). `hunt/` is
// deliberately NOT an entry here, since `hunt/` modules are fetched at runtime and must still
// ship (ADR-034 Decision point 3).
export const BUILD_INPUT_ONLY_DIRS: string[] = ['references/gates', 'references/audits'];

// § facts — declared {{INCLUDE:<dir>/*}} marker sites (ADR-039, issue #882), repo-root-relative
// POSIX paths. Sibling registry to BUILD_INPUT_ONLY_DIRS on an adjacent axis: that one names
// where a marker's *target* directory may live; this names where a marker may *appear*.
// `expandIncludes` (content.ts) expands only when `srcPath` resolves to an entry here — every
// other file, including a doc comment illustrating the syntax with a real dir name, comes back
// unchanged. `build-input-dirs.check.ts`'s V-INCLUDE-02 independently scans `src/**` for a live
// marker outside a declared site, and for a declared site missing its marker — neither side
// derived from the other. The two entries are the only agent shells composing from modules today.
export const INCLUDE_MARKER_SITES: string[] = ['src/agents/reviewer.md', 'src/agents/implementer.md'];

/**
 * `.md` module count of `src/references/gates/` — the implementer's gate modules, inlined into
 * `src/agents/implementer.md` by its `references/gates` INCLUDE marker (real name safe to quote:
 * ADR-039's declared-site gate means `read()` never expands outside `INCLUDE_MARKER_SITES`, and this file isn't one). Replaces the former `CONTENT_GATE_BUDGETS` row: once the gates live in
 * one module each, a LOC ceiling measures nothing an author can act on, whereas the module count
 * is the shape a reviewer checks. Declared side of a V-GROUND-01 pair; scan side is an
 * independent `listFiles` of the directory, never derived from this constant.
 */
export const IMPLEMENTER_GATE_MODULE_COUNT = 15;

/**
 * Number of reviewer audit modules under `src/references/audits/` (V-AUDIT-01). Declared side of
 * a declared-fact / independent-scan pair, the same shape `VCODE_TABLE_ROW_COUNT` uses: the
 * scanned side is `scripts/checks/audit-modules.check.ts` listing the directory. Replaces the
 * former `CONTENT_GATE_BUDGETS['src/agents/reviewer.md']` row — after the ADR-034 seam the
 * reviewer's growth unit is "one more module", not "N more lines in one section", so the fact
 * that has to be consciously bumped when an audit is added is a module count, not a LOC ceiling.
 */
export const REVIEWER_AUDIT_MODULE_COUNT = 32;

// § facts — ADR revisit watch items (issue #710). A declared-fact / independent-scan pair, the
// same shape `VCODE_TABLE_ROW_COUNT`/`CONTENT_GATE_BUDGETS`/`DOC_HEALTH_THRESHOLDS` already use:
// each row names a threshold an accepted ADR promised to revisit at, checked independently by
// `scripts/checks/adr-watch.check.ts` (V-WATCH-01) against the live file — never derived from
// that same scan. Gives ADR-007's rejected-alternatives revisit trigger ("revisit
// `worker-schemas.md` at >700 LOC or any role section >80 LOC") and ADR-021 A3's Stop-condition
// density warning a machine-checkable home instead of tripping silently. Advisory only (`ok:
// true` always) — see the check module for why this must never block.
export type AdrWatchMetric = 'file_loc' | 'section_loc' | 'section_count';

export type AdrWatchItem = {
  adr: string;
  file: string;
  metric: AdrWatchMetric;
  threshold: number;
  note: string;
};

export const ADR_WATCH_ITEMS: AdrWatchItem[] = [
  {
    adr: 'ADR-007',
    file: 'src/references/worker-schemas.md',
    metric: 'file_loc',
    threshold: 700,
    note: "Rejected-alternatives revisit trigger; reports the ADR-007 threshold independently of CONTENT_GATE_BUDGETS' own ratcheted ceiling (#492), so the original number stays visible even after the budget was raised.",
  },
  {
    adr: 'ADR-007',
    file: 'src/references/implementer-schemas.md',
    metric: 'section_loc',
    threshold: 80,
    note: 'Any single ## role-contract section over 80 LOC — the per-role half of the same rejected-alternatives trigger. Re-pointed from worker-schemas.md to this file (issue #802) after the Implementer section moved here; the threshold itself is untouched by where the role contract lives.',
  },
  {
    adr: 'ADR-021',
    file: 'src/references/phase-implement.md',
    metric: 'section_loc',
    threshold: 59,
    note: '(A3, Stop-condition density) measures the whole file\'s largest `##` section, not any one section by name — recalibrated (issue #802) to 59 = ceil(49 × 1.2), the same seeding convention CONTENT_GATE_BUDGETS uses, against the file\'s observed 12-49 LOC section-size range.',
  },
];

// § facts — value vocabularies (issue #320, ADR-007 R1′ extension). Closed sets of enum-shaped
// strings that agent prose restates verbatim at many consumption sites, declared once here and
// checked by V-VOCAB-01's independent scan-vs-declaration comparison (never generated from the
// scan — same two-separately-fallible-derivations discipline as V-GROUND-01 above).

/** `queue.json` `issues.<n>.status` (V-VOCAB-01) — canonical enum per `queue-dag.md`'s field-rules
 *  table. Scanned narrowly (lines mentioning both `phase` and `status:`) to avoid colliding with the differently-shaped worker-JSON `status` vocabulary that shares the same field name. */
export const QUEUE_STATUSES = ['blocked', 'ready', 'in-flight', 'merged', 'closed'];

/** `queue.json` `issues.<n>.notes`' closed kebab-token gate-value subset (V-VOCAB-01) — the class
 *  of value that caused ADR-012 Finding 3b (`awaiting-design-approval` restated in one file, omitted from two others' enums). `notes` also carries open, parameterized free text (e.g.
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
export const HUNT_KINDS = ['quickwins', 'best-practices', 'coverage', 'refactor', 'bug', 'retrospective', 'parity', 'ux-coherence', 'docs', 'backlog', 'ci', 'deps', 'perf'];

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

// § facts — content-gate budgets moved to content-gate-facts.ts (issue #952); see that file.

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

/**
 * ADR heading shapes (issue #711) — declared exactly once here per this file's SSOT convention,
 * consumed by `scripts/checks/design-track.check.ts` (`designTrack`, re-exported unchanged as
 * `DESIGN_TRACK_REQUIRED_HEADINGS`) and `scripts/checks/adr-shape.check.ts` (both shapes, for its
 * advisory heading-conformance scan over `documentation/decisions/ADR-*.md`). `classic` is
 * `src/references/adr-template.md`'s 5-heading narrative-decision skeleton; `designTrack` is
 * `planner.md` §4.8's 8-heading plan-track-gated design-note skeleton. Never restate either list
 * as an inline literal at a consumption site.
 */
export type AdrShapes = { classic: string[]; designTrack: string[] };

export const ADR_SHAPES: AdrShapes = {
  classic: ['## Status', '## Context', '## Decision', '## Alternatives Considered', '## Consequences'],
  designTrack: [
    '## Requirements Framing',
    '## Options + Trade-off Matrix',
    '## Adversarial Evaluation',
    '## Component Decomposition',
    '## Design Principles Validation',
    '## Refactoring Impact Analysis',
    '## Assumption Audit',
    '## Gate',
  ],
};
