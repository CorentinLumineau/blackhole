import * as fs from 'fs';
import * as path from 'path';

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

// ADR-007 T5/R2': domain entrypoint — see core.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkDesignTrackTemplate()];
