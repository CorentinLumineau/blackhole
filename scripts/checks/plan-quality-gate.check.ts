import * as fs from 'fs';
import * as path from 'path';
import { root, read, type CheckResult } from './check-utils.ts';
import { findMissingGateMarkers } from '../lib/check-common.ts';

// Issue #459 — plan quality gate parity (mercure `x-plan`'s 8-check gate; blackhole already
// enforces 2 as blocking: `ac_mapping`, Codebase Conventions). Adds the two mechanical checks
// named in the issue: critical-file existence (a Glob call) and vague-mitigation concreteness
// (a stated word list). The planner agent performs both itself at plan time — it holds the
// Glob/Read tools this module does not — so this file's role is (a) give the two checks a
// deterministic, fixture-testable reference form and (b) ground planner.md's Step 8 prose
// against silent drift, same split as design-track.check.ts's template check vs. its
// marker-grounding check (V-INT-01: reuses that established pattern, no new shape).

// Critical Files bullets often mix a real path with inline V-code citations or command names in
// backticks (e.g. "`src/lib/db.ts` — requires `V-SEC-03` review and `npm audit`") — only the
// first token is a path. A token counts as path-shaped when it has no whitespace AND either
// contains a `/` or ends in a file extension; a bare identifier or a multi-word command is not.
const looksLikeFilePath = (token: string): boolean =>
  !/\s/.test(token) && (token.includes('/') || /\.[A-Za-z0-9]+$/.test(token));

// Extracts backtick-quoted paths from a markdown bullet list — the convention Touch-Paths and
// Critical Files both already use in plan output.
export const extractBacktickPaths = (sectionContent: string): string[] =>
  [...sectionContent.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter(looksLikeFilePath);

// Pure — `exists` is injected so fixtures never touch the real filesystem (a fixture plan naming
// a nonexistent file is flagged without needing one to actually be absent from disk); defaults
// to a real repo-root-relative existence check for production use.
export const findMissingCriticalFiles = (
  criticalFilesSection: string,
  exists: (filePath: string) => boolean = (p) => fs.existsSync(path.join(root, p))
): string[] => extractBacktickPaths(criticalFilesSection).filter((p) => !exists(p));

// mercure's own vague-mitigation vocabulary ("monitor", "be careful", "watch for") — the
// "stated word list" the issue requires, so the planner checks a fixed list rather than an
// ad hoc judgment call each time.
export const PLAN_QUALITY_GATE_VAGUE_WORDS = [
  'monitor',
  'watch for',
  'keep an eye on',
  'be careful',
  'check periodically',
];

// A bullet naming a vague-word phrase is non-actionable UNLESS it also carries a testable stop
// condition — a conditional trigger (if/when/once/unless) paired with a stop verb
// (abort/halt/stop/block/revert), both present *anywhere* in the bullet. This is a structural
// test, not a fixed-width proximity window: a long qualifying clause between the trigger and the
// verb ("if depth exceeds threshold sustained for five consecutive intervals ..., abort") is
// still a concrete stop condition, so no window-width constant would be the right knob to tune.
const CONDITION_TRIGGER_PATTERN = /\b(if|when|once|unless)\b/i;
const STOP_VERB_PATTERN = /\b(abort|halt|stop|block|revert)\b/i;

const hasConcreteStopCondition = (line: string): boolean =>
  CONDITION_TRIGGER_PATTERN.test(line) && STOP_VERB_PATTERN.test(line);

export const findVagueMitigations = (
  mitigationSection: string,
  wordList: string[] = PLAN_QUALITY_GATE_VAGUE_WORDS
): string[] =>
  mitigationSection
    .split('\n')
    .filter((line) => /^\s*[-*]/.test(line))
    .filter((line) => {
      const lower = line.toLowerCase();
      return wordList.some((w) => lower.includes(w)) && !hasConcreteStopCondition(line);
    });

// Issue #575 — plan-time AC-satisfiability heuristics (advisory-only, no CheckResult/runChecks entry).
export const splitTaskBreakdownBullets = (section: string): Array<{ label: string; text: string }> => {
  const starts = [...section.matchAll(/^\d+\.\s+\*\*(.+?)\*\*/gm)];
  return starts.map((m, i) => ({ label: m[1], text: section.slice(m.index!, starts[i + 1]?.index ?? section.length) }));
};
export const extractQuotedBranches = (line: string): string[] => {
  const quoted = line.match(/"([^"]+)"/);
  return quoted ? quoted[1].split('\\|') : [];
};
const SWEEP_ZERO_PATTERN = /zero (remaining )?matches/i;
const RETAIN_PATTERN = /\bretain\b/i;
const EXEMPTION_PATTERN = /\b(except|excluding|exempt)\b|no exemptions/i;
// Live #481 instance (issue #575); advisory only — Design Decision § 2, plans/issue-575.md.
export const findSweepRetainConflicts = (section: string): Array<{ sweepTask: string; retainTask: string; token: string }> => {
  const tasks = splitTaskBreakdownBullets(section);
  const conflicts: Array<{ sweepTask: string; retainTask: string; token: string }> = [];
  for (const sweep of tasks) {
    if (!SWEEP_ZERO_PATTERN.test(sweep.text)) continue;
    const cmd = sweep.text.match(/`[^`]*"[^"]+"[^`]*`/);
    if (!cmd) continue;
    const branches = extractQuotedBranches(cmd[0]);
    for (const retain of tasks) {
      if (retain === sweep || !RETAIN_PATTERN.test(retain.text)) continue;
      const token = branches.find((b) => retain.text.includes(b));
      if (token) conflicts.push({ sweepTask: sweep.label, retainTask: retain.label, token });
    }
  }
  return conflicts;
};
export const findUnscopedSweepACs = (section: string): string[] => // V-INT-02: reuses extractBacktickPaths
  splitTaskBreakdownBullets(section)
    .filter((t) => SWEEP_ZERO_PATTERN.test(t.text))
    .filter((t) => !(extractBacktickPaths(t.text).length && EXEMPTION_PATTERN.test(t.text)))
    .map((t) => t.label);

// Grounding check (regression guard, same shape as design-track.check.ts's V-DESIGN-02):
// planner.md Step 8 and worker-schemas.md's Plan quality gate checks list must both still name
// the two new failing_checks values — a silent prose drop would leave this mechanical parity
// documented nowhere a reviewer can audit.
export const PLAN_QUALITY_GATE_REQUIRED_MARKERS = ['critical_files_exist', 'mitigation_concrete', 'ac_sweep_conflict', 'ac_sweep_scope'];

// Heading spelling drift guard (issue #519 gap 3): plan-template.md's actual Standard Track
// heading is "Execution Strategy & Stop Conditions" — it is literally what the planner writes
// into every generated plan file, making it the canonical spelling. planner.md's prose
// previously cited a drifted "Execution Strategy (Stop Conditions)" parenthetical instead; a
// hand-typed citation like that can drift again silently. Originally folded into V-PLANGATE-01
// to avoid touching a locked facts.ts (issue #519); split into its own V-PLANGATE-02 CheckResult
// once facts.ts unlocked (issue #534) — see checkExecutionStrategyHeadingGrounding below for why.
export const EXECUTION_STRATEGY_HEADING = 'Execution Strategy & Stop Conditions';
const STALE_EXECUTION_STRATEGY_SPELLINGS = ['Execution Strategy (Stop Conditions)'];

export const findExecutionStrategyHeadingDrift = (content: string): string[] =>
  STALE_EXECUTION_STRATEGY_SPELLINGS.filter((stale) => content.includes(stale));

// Issue #533 — Standard Track bugfix-classification symmetry: reviewer.md §15's V-FIX-01 BLOCK
// branch reads the plan frontmatter's `task_type: bugfix` field regardless of track, but only
// Quick Track's own "Bugfix classification" bullet ever stamped it — a Standard Track bugfix
// plan (the multi-file/logic case where root-cause correctness carries the highest risk) never
// got the chance to carry the field, so the BLOCK could never fire there. Section-scoped
// extraction, not a whole-file `findMissingGateMarkers` call: Quick Track already carries this
// bullet's exact wording, so a whole-file check would report "present" even if Standard Track's
// own copy silently regressed. Originally folded into V-PLANGATE-01 alongside the heading-drift
// guard above (issue #533, same facts.ts-lock rationale); split into its own V-PLANGATE-03
// CheckResult once facts.ts unlocked (issue #534) — see checkStandardTrackBugfixGrounding below.
const STANDARD_TRACK_START_MARKER = '### 2. Standard Track';
const STANDARD_TRACK_END_MARKER = '### 3. Skip Track';

export const extractStandardTrackSection = (content: string): string => {
  const start = content.indexOf(STANDARD_TRACK_START_MARKER);
  const end = content.indexOf(STANDARD_TRACK_END_MARKER);
  if (start === -1 || end === -1 || end <= start) return '';
  return content.slice(start, end);
};

export const STANDARD_TRACK_BUGFIX_REQUIRED_MARKERS = [
  'Bugfix classification',
  'stamp `task_type: bugfix`',
];

// V-PLANGATE-01 (issue #459): mercure-parity marker grounding — the two mechanical Plan Quality
// Gate checks (`critical_files_exist`, `mitigation_concrete`) must stay documented in both
// planner.md (where the planner performs them) and worker-schemas.md (where their
// `failing_checks` values are contracted). Same shape as design-track.check.ts's V-DESIGN-02:
// one concern, grounded across two files that must agree — not split further (V-KISS-01).
export const checkPlanQualityGateGrounding = (): CheckResult => {
  const plannerContent = read('src/agents/planner.md');
  const schemaContent = read('src/references/worker-schemas.md');

  const errors = [
    ...findMissingGateMarkers(plannerContent, PLAN_QUALITY_GATE_REQUIRED_MARKERS).map(
      (m) => `planner.md missing "${m}"`
    ),
    ...findMissingGateMarkers(schemaContent, PLAN_QUALITY_GATE_REQUIRED_MARKERS).map(
      (m) => `worker-schemas.md missing "${m}"`
    ),
  ];

  if (errors.length) return { id: 'V-PLANGATE-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-PLANGATE-01', ok: true };
};

// V-PLANGATE-02 (issue #519 gap 3, split out by #534): planner.md's prose citation of the
// Standard Track heading must stay the canonical spelling — see the heading-drift guard comment
// above for why this is a distinct regression class from V-PLANGATE-01's marker presence check
// (a spelling drift, not a missing marker).
export const checkExecutionStrategyHeadingGrounding = (): CheckResult => {
  const plannerContent = read('src/agents/planner.md');
  const drift = findExecutionStrategyHeadingDrift(plannerContent);

  if (drift.length) {
    return {
      id: 'V-PLANGATE-02',
      ok: false,
      detail: drift
        .map((stale) => `planner.md uses stale heading spelling "${stale}" (canonical: "${EXECUTION_STRATEGY_HEADING}")`)
        .join('; '),
    };
  }
  return { id: 'V-PLANGATE-02', ok: true };
};

// V-PLANGATE-03 (issue #533, split out by #534): planner.md's Standard Track section must carry
// the bugfix-classification stamp — see the section-scoped-extraction comment above for why this
// is a distinct regression class from V-PLANGATE-01/02 (a track-symmetry gap, not a marker
// presence or spelling concern).
export const checkStandardTrackBugfixGrounding = (): CheckResult => {
  const plannerContent = read('src/agents/planner.md');
  const standardTrackSection = extractStandardTrackSection(plannerContent);
  const missing = findMissingGateMarkers(standardTrackSection, STANDARD_TRACK_BUGFIX_REQUIRED_MARKERS);

  if (missing.length) {
    return {
      id: 'V-PLANGATE-03',
      ok: false,
      detail: missing
        .map((m) => `planner.md Standard Track section missing "${m}" (V-FIX-01 BLOCK cannot fire on Standard-track bugfixes without this stamp)`)
        .join('; '),
    };
  }
  return { id: 'V-PLANGATE-03', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [
  checkPlanQualityGateGrounding(),
  checkExecutionStrategyHeadingGrounding(),
  checkStandardTrackBugfixGrounding(),
];
