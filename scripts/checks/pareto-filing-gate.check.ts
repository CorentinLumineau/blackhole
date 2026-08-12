import * as fs from 'fs';
import * as path from 'path';
import { root, read, type CheckResult } from './check-utils.ts';
import { parseVcodeTableRows, walkMdFilesAbs } from '../lib/check-common.ts';

// Issue #586 — pareto-filing-gate.check.ts: mechanical audit that V-PARETO-02 is WARN (discovery
// label + formula SSOT) and V-PARETO-03 is BLOCK (filing gate), and that gate prose cites
// V-PARETO-03 — not V-PARETO-02 — for Priority >= 30 (ADR-022).

const STALE_GATE_PATTERN = /V-PARETO-02`.*(?:>=\s*30|Priority\s*=)/;
const PHASE_LOOP_GATE_PATTERN = /Apply `V-PARETO-03`.*Priority = Gain \* \(11 - Effort\) >= 30/;

export const findVcodeRow = (
  rows: { code: string; severity: string; site: string; rule?: string }[],
  code: string,
) => rows.find((r) => r.code === code);

export const parseVcodeRules = (vcodesContent: string): Map<string, string> => {
  const rules = new Map<string, string>();
  for (const line of vcodesContent.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 6) continue;
    const rowCode = cells[1];
    if (!rowCode.startsWith('V-')) continue;
    rules.set(rowCode, cells[2]);
  }
  return rules;
};

export const scanStaleGateCites = (files: string[]): string[] => {
  const hits: string[] = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    if (STALE_GATE_PATTERN.test(content)) {
      hits.push(path.relative(root, file));
    }
  }
  return hits;
};

const checkPareto02WarnSeverity = (rows: ReturnType<typeof parseVcodeTableRows>): CheckResult => {
  const row = findVcodeRow(rows, 'V-PARETO-02');
  if (!row) return { id: 'V-PARETOGATE-01', ok: false, detail: 'V-PARETO-02 row missing from SSOT table' };
  return row.severity === 'WARN'
    ? { id: 'V-PARETOGATE-01', ok: true }
    : { id: 'V-PARETOGATE-01', ok: false, detail: `V-PARETO-02 SSOT severity is ${row.severity}, expected WARN` };
};

const checkPareto03BlockGate = (
  rows: ReturnType<typeof parseVcodeTableRows>,
  rules: Map<string, string>,
): CheckResult => {
  const row = findVcodeRow(rows, 'V-PARETO-03');
  if (!row) return { id: 'V-PARETOGATE-02', ok: false, detail: 'V-PARETO-03 row missing from SSOT table' };
  const rule = rules.get('V-PARETO-03') ?? '';
  const hasGate = row.severity === 'BLOCK' && />=\s*30/.test(rule) && /Priority/.test(rule);
  return hasGate
    ? { id: 'V-PARETOGATE-02', ok: true }
    : {
        id: 'V-PARETOGATE-02',
        ok: false,
        detail: 'V-PARETO-03 must be BLOCK with Priority >= 30 filing-gate description',
      };
};

const checkPhaseLoopGateCite = (phaseLoopContent: string): CheckResult =>
  PHASE_LOOP_GATE_PATTERN.test(phaseLoopContent)
    ? { id: 'V-PARETOGATE-03', ok: true }
    : {
        id: 'V-PARETOGATE-03',
        ok: false,
        detail: 'phase-loop.md kaizen gate step must cite V-PARETO-03 for Priority >= 30',
      };

const checkNoStaleGateCites = (files: string[]): CheckResult => {
  const hits = scanStaleGateCites(files);
  return hits.length
    ? { id: 'V-PARETOGATE-04', ok: false, detail: `stale V-PARETO-02 filing-gate cites: ${hits.join(', ')}` }
    : { id: 'V-PARETOGATE-04', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => {
  const vcodesContent = read('src/references/blackhole-vcodes.md');
  const rows = parseVcodeTableRows(vcodesContent);
  const rules = parseVcodeRules(vcodesContent);
  const srcFiles = [
    ...walkMdFilesAbs(path.join(root, 'src/agents')),
    ...walkMdFilesAbs(path.join(root, 'src/references')),
  ];
  return [
    checkPareto02WarnSeverity(rows),
    checkPareto03BlockGate(rows, rules),
    checkPhaseLoopGateCite(read('src/references/phase-loop.md')),
    checkNoStaleGateCites(srcFiles),
  ];
};
