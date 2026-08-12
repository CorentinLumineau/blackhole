import { read, root, type CheckResult } from './check-utils.ts';
import {
  REFORMULATION_FIELD_ASSUMED,
  REFORMULATION_FIELD_IF_WRONG,
  REFORMULATION_FIELD_UNDERSTOOD,
} from '../lib/reformulation-surface.ts';
import * as fs from 'fs';
import * as path from 'path';

// Issue #456 — V-REFORM-01: confidence-gate proceed-path reformulation surface is documented,
// validated, and wired for orchestrator posting.

export const checkReformulationSurface = (): CheckResult => {
  const missing: string[] = [];

  const workerSchemas = read('src/references/worker-schemas.md');
  for (const field of [
    REFORMULATION_FIELD_UNDERSTOOD,
    REFORMULATION_FIELD_ASSUMED,
    REFORMULATION_FIELD_IF_WRONG,
  ]) {
    if (!workerSchemas.includes(`reformulation.${field}`)) {
      missing.push(`worker-schemas.md: missing reformulation.${field}`);
    }
  }

  const plannerValidator = read('scripts/lib/worker-json/validators/planner.ts');
  if (!plannerValidator.includes('validateReformulation') || !plannerValidator.includes('reformulation')) {
    missing.push('planner.ts: missing validateReformulation wiring');
  }

  const phasePlan = read('src/references/phase-plan.md');
  if (!phasePlan.includes('gh issue comment') || !phasePlan.includes('reformulation')) {
    missing.push('phase-plan.md: missing gh issue comment posting for reformulation');
  }

  const fixturePath = path.join(root, 'fixtures/worker-json/planner-ready.json');
  const data = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as Record<string, unknown>;
  const reformulation = data.reformulation;
  if (!reformulation || typeof reformulation !== 'object') {
    missing.push('planner-ready.json: missing reformulation object');
  } else {
    const obj = reformulation as Record<string, unknown>;
    for (const field of [REFORMULATION_FIELD_UNDERSTOOD, REFORMULATION_FIELD_ASSUMED, REFORMULATION_FIELD_IF_WRONG]) {
      if (typeof obj[field] !== 'string' || obj[field] === '') {
        missing.push(`planner-ready.json: reformulation.${field} must be a non-empty string`);
      }
    }
  }

  return missing.length
    ? { id: 'V-REFORM-01', ok: false, detail: missing.join('; ') }
    : { id: 'V-REFORM-01', ok: true };
};

export const runChecks = (): CheckResult[] => [checkReformulationSurface()];
