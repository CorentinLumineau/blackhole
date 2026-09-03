import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';

// Issue #809 — deferred-reconciliation.check.ts: `findings-ledger.json`'s `deferred → resolved`
// transition was documented as "optional cleanup" and nothing ever reconciled a `deferred`
// finding whose `deferred_to_issue` target closed — the ledger's never-drop invariant was
// enforced at filing time (§ Write protocol step 5) but not at closure time. This surfaces the
// gap mechanically. Advisory (WARN) — `ok: true` always, same established shape as
// V-WATCH-01 (`adr-watch.check.ts`): this reports "these need reconciling", never blocks a merge
// on it. Reads only `.blackhole/findings-ledger.json` + `.blackhole/queue.json` (both already
// forge-synced every turn, `forge-sync.md` § Native auto-sync) — no live `gh` call in this
// recurring check, matching every other `scripts/checks/*.check.ts`'s no-network convention.

export type LedgerFinding = {
  id: string;
  vcode: string;
  status: string;
  deferred_to_issue: number | null;
  reconciled_at?: string | null;
  file?: string;
};

export type QueueIssues = Record<string, { status?: string }>;

const CLOSED_STATUSES = new Set(['merged', 'closed']);

// Reports one description string per `deferred` row whose `deferred_to_issue` target resolves
// to a closed (`merged`/`closed`) `queue.json` status, or is absent from `queueIssues` entirely
// (the "untracked" category — e.g. #624, a target that was never ingested into queue.json), and
// has no `reconciled_at` set yet. A row already carrying `reconciled_at` was reconciled by a
// prior triage/check pass and is never re-flagged — recorded, not re-inferred (AC1).
export const findUnreconciledDeferrals = (findings: LedgerFinding[], queueIssues: QueueIssues): string[] => {
  const warnings: string[] = [];
  for (const finding of findings) {
    if (finding.status !== 'deferred') continue;
    if (finding.reconciled_at) continue;
    const target = finding.deferred_to_issue;
    if (target == null) continue;

    const queueEntry = queueIssues[String(target)];
    if (queueEntry === undefined) {
      warnings.push(`${finding.id} (${finding.vcode}) deferred to #${target} — target untracked (absent from queue.json)`);
      continue;
    }
    if (queueEntry.status !== undefined && CLOSED_STATUSES.has(queueEntry.status)) {
      warnings.push(
        `${finding.id} (${finding.vcode}) deferred to #${target} — target closed (status: ${queueEntry.status}), unreconciled`,
      );
    }
  }
  return warnings;
};

// Exported (rather than only the default-path `runChecks` entrypoint below) so tests can point
// it at a temp-dir fixture without touching the live repo tree — same pattern as
// `checkAdrWatch`/`checkQueueCoherence`. File-absent-SKIP on either input: a PR worktree/CI run
// never has `.blackhole/` (gitignored, main-clone-only) — same discipline as
// `queue-coherence.check.ts`/`parity-matrix.check.ts`.
export const checkDeferredReconciliation = (ledgerFile: string, queueFile: string): CheckResult[] => {
  if (!fs.existsSync(ledgerFile) || !fs.existsSync(queueFile)) {
    return [{ id: 'V-DEFER-01', ok: true }];
  }

  const ledger: { findings?: LedgerFinding[] } = JSON.parse(fs.readFileSync(ledgerFile, 'utf-8'));
  const queue: { issues?: QueueIssues } = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));

  const warnings = findUnreconciledDeferrals(ledger.findings ?? [], queue.issues ?? {});
  return [{ id: 'V-DEFER-01', ok: true, ...(warnings.length ? { detail: warnings.join('; ') } : {}) }];
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects beyond reading the repo tree, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] =>
  checkDeferredReconciliation(
    path.join(root, '.blackhole', 'findings-ledger.json'),
    path.join(root, '.blackhole', 'queue.json'),
  );
