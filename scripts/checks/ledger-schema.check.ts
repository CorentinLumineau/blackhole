import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';

// V-LEDGER-01 (issue #754) — rejects a `.blackhole/findings-ledger.json` row whose `issue_ref`
// is not `number | null`, whose `pr_ref` is not `number | null`, or that still carries a legacy
// `pr` key — the backstop for every ledger-append path `review-aggregate.ts`'s writer fix
// (Task 1) doesn't reach: kaizen/hunt findings and freehand orchestrator appends. `BLOCK`, not
// `WARN` like `queue-coherence.check.ts` — this PR's own migration (Task 2) clears the live
// ledger to zero drifted rows, so there is no unfixable historical debt for a BLOCK verdict to
// wedge the campaign against (plan Design Decision 5).
//
// A row whose `pr_ref` key is entirely absent is not flagged — a distinct, undocumented shape
// from the three this issue's writer fix and migration target (kaizen/hunt and plan/handle-phase
// freehand appends that never went through the aggregator's stamping pipeline never had a PR to
// reference in the first place). Only a *present* value that is neither `number` nor `null` is
// drift.

type LedgerRow = {
  id?: unknown;
  issue_ref?: unknown;
  pr_ref?: unknown;
  pr?: unknown;
};

const isNumberOrNull = (value: unknown): boolean => typeof value === 'number' || value === null;

/**
 * Pure logic: one violation-description string per broken rule per row (a row can produce more
 * than one string if it violates more than one rule).
 */
export const findLedgerSchemaDrift = (findings: unknown[]): string[] => {
  const violations: string[] = [];

  for (const raw of findings) {
    const row = raw as LedgerRow;
    const id = String(row.id ?? '<no id>');

    if ('issue_ref' in row && !isNumberOrNull(row.issue_ref)) {
      violations.push(`${id}: issue_ref is ${JSON.stringify(row.issue_ref)} (expected number|null)`);
    }
    if ('pr_ref' in row && !isNumberOrNull(row.pr_ref)) {
      violations.push(`${id}: pr_ref is ${JSON.stringify(row.pr_ref)} (expected number|null)`);
    }
    if ('pr' in row) {
      violations.push(`${id}: carries legacy "pr" key instead of "pr_ref"`);
    }
  }

  return violations;
};

// I/O wrapper: file-absent-SKIP (`.blackhole/findings-ledger.json` missing → `{ ok: true }`),
// same discipline as `queue-coherence.check.ts` (Design Decision 5 — a PR's own worktree/CI run
// never has `.blackhole/`, which is gitignored and main-clone-only).
export const checkLedgerSchema = (ledgerFile: string): CheckResult => {
  if (!fs.existsSync(ledgerFile)) {
    return { id: 'V-LEDGER-01', ok: true };
  }

  const ledger: { findings?: unknown[] } = JSON.parse(fs.readFileSync(ledgerFile, 'utf-8'));
  const violations = findLedgerSchemaDrift(ledger.findings ?? []);

  if (violations.length > 0) {
    return { id: 'V-LEDGER-01', ok: false, detail: violations.join('; ') };
  }
  return { id: 'V-LEDGER-01', ok: true };
};

export const runChecks = (): CheckResult[] => [
  checkLedgerSchema(path.join(root, '.blackhole', 'findings-ledger.json')),
];
