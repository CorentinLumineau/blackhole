import * as fs from 'fs';
import * as path from 'path';
import { findMissingGateMarkers } from './core.check.ts';

// ADR-007 T5/R2' — design-track.check.ts: matches verify.design-track.test.ts.

const root = path.resolve(import.meta.dirname, '..', '..');

export type CheckResult = { id: string; ok: boolean; detail?: string };

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

// V-DESIGN-01: Design Track template in planner.md declares all 8 required section headings
export const DESIGN_TRACK_REQUIRED_HEADINGS = [
  '## Requirements Framing',
  '## Options + Trade-off Matrix',
  '## Adversarial Evaluation',
  '## Component Decomposition',
  '## Design Principles Validation',
  '## Refactoring Impact Analysis',
  '## Assumption Audit',
  '## Gate',
];

export const findMissingDesignTrackHeadings = (
  content: string,
  required: string[] = DESIGN_TRACK_REQUIRED_HEADINGS,
): string[] => required.filter((heading) => !content.includes(heading));

const checkDesignTrackTemplate = (): CheckResult => {
  const content = read('src/agents/planner.md');
  const missing = findMissingDesignTrackHeadings(content);
  if (missing.length) {
    return { id: 'V-DESIGN-01', ok: false, detail: `planner.md missing Design Track headings: ${missing.join(', ')}` };
  }
  return { id: 'V-DESIGN-01', ok: true };
};

// V-DESIGN-02 (ADR-010 M2): the gated-verdict markers Task 5/6 wrote into planner.md §4.8 and
// orchestrator.md's Route-derived dispatch must stay present — if a future edit strips them,
// §4.8 could silently revert to always-blocked (harmless) or, worse, drift toward a path where
// the planner substitutes its own judgment for scripts/design-aggregate.ts's verdict. Sibling
// check to V-DESIGN-01 above, same file, same non-formal grounding namespace (V-DESIGN-01/02 are
// not rows in blackhole-vcodes.md's severity table — that table's V-AUTO-01/02 rows are the
// formal severity classification this check enforces at the grounding layer).
export const PLANNER_DESIGN_GATE_REQUIRED_MARKERS = [
  'design-aggregate.ts',
  'MUST NOT substitute its own judgment',
];

export const ORCHESTRATOR_DESIGN_GATE_REQUIRED_MARKERS = [
  "applies only the worker JSON's `status` field",
];

const checkDesignAutonomyGateGrounding = (): CheckResult => {
  const plannerContent = read('src/agents/planner.md');
  const orchestratorContent = read('src/agents/orchestrator.md');

  const plannerMissing = findMissingGateMarkers(plannerContent, PLANNER_DESIGN_GATE_REQUIRED_MARKERS);
  const orchestratorMissing = findMissingGateMarkers(
    orchestratorContent,
    ORCHESTRATOR_DESIGN_GATE_REQUIRED_MARKERS,
  );

  const errors = [
    ...plannerMissing.map((m) => `planner.md missing "${m}"`),
    ...orchestratorMissing.map((m) => `orchestrator.md missing "${m}"`),
  ];

  if (errors.length) return { id: 'V-DESIGN-02', ok: false, detail: errors.join('; ') };
  return { id: 'V-DESIGN-02', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see core.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkDesignTrackTemplate(), checkDesignAutonomyGateGrounding()];
