import * as fs from 'fs';
import * as path from 'path';
import { findMissingGateMarkers } from './agents.check.ts';

// ADR-007 T5/R2' — single-writer.check.ts: matches verify.single-writer.test.ts.
//
// findMissingGateMarkers is defined once in agents.check.ts (its own V-GATE-01 check needs it
// too) and re-exported here so this domain's paired test file (verify.single-writer.test.ts) can
// import it from its own domain's check file rather than reaching across into agents.check.ts —
// one definition, ADR-007 R6/V-INT-02 (no local reimplementation of an equivalently-shaped
// filter function).
export { findMissingGateMarkers };

const root = path.resolve(import.meta.dirname, '..', '..');

export type CheckResult = { id: string; ok: boolean; detail?: string };

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

// V-WRITE-01: single-writer-orchestrator invariant (issue #224) — router.md must no longer
// instruct direct writes to queue.json/findings-ledger.json, and orchestrator.md's Triage
// section must explicitly state serial, one-worker-at-a-time mutation application plus
// routing_decisions row construction.
export const ROUTER_NO_DIRECT_WRITE_REQUIRED_MARKERS = [
  'the router never writes `queue.json` or `findings-ledger.json` directly',
  'returning `route{}`, `trigger`, and `local_analyze`',
  'the orchestrator is the sole writer',
];

export const ORCHESTRATOR_SERIAL_TRIAGE_REQUIRED_MARKERS = [
  'serially, one completed worker at a time',
  'construct the full `routing_decisions` row from its returned JSON',
  'single-writer-orchestrator invariant',
];

const checkSingleWriterInvariant = (): CheckResult => {
  const routerMissing = findMissingGateMarkers(read('src/agents/router.md'), ROUTER_NO_DIRECT_WRITE_REQUIRED_MARKERS);
  const orchestratorMissing = findMissingGateMarkers(
    read('src/agents/orchestrator.md'),
    ORCHESTRATOR_SERIAL_TRIAGE_REQUIRED_MARKERS,
  );

  const errors = [
    ...routerMissing.map((m) => `router.md missing "${m}"`),
    ...orchestratorMissing.map((m) => `orchestrator.md missing "${m}"`),
  ];

  if (errors.length) return { id: 'V-WRITE-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-WRITE-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkSingleWriterInvariant()];
