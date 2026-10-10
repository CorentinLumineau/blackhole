import * as fs from 'fs';
import * as path from 'path';
import { evaluateDocTreeHealth } from './checks/doc-health.check.ts';
import { root } from './checks/check-utils.ts';
import { parseDecisionLogIds } from './decision-log-append.ts';
import { readJsonFile } from './lib/fs.ts';

// Issue #499 (ADR-021 D6 residual) — the always-on-channel half of the Scope-1 doc-tree health
// signal. `doc-health.check.ts` (PR #494 / issue #462) delivered detection; nothing read it
// anywhere (verified: `grep -rln "doc-health\|doc_debt\|DOC_HEALTH" src/references/*.md
// src/agents/*.md` on ac80755 returns only doc-governance.md itself). This script closes that
// gap by writing `.blackhole/doc-health.json` every orchestrator turn (see blackhole-state.md
// § Doc-Health Signal), reusing `evaluateDocTreeHealth` (V-INT-02) rather than re-deriving the
// four-threshold aggregation.

export type DocHealthSignal = {
  version: 1;
  refreshed_at: string;
  doc_debt: 'yes' | 'no';
  detail: string | null;
  decision_log_silent_prs: number;
};

type QueueJsonShape = { issues?: Record<string, { status?: string; pr?: number | null }> };

// Issue #717 (R-12) — advisory count of merged PRs whose decisions never reached
// decision-log.md's Records table, additive to doc_debt/detail (Execution Strategy item 3: this
// must never change their derivation). Existence-gated no-op on either file missing, matching
// evaluateIndexDangling/evaluateOrphanFiles' idiom — a decision log predates most campaigns and
// a missing queue.json is a valid state outside the campaign runtime, not a hard error.
export const computeDecisionLogSilentPrs = (decisionLogPath: string, queueJsonPath: string): number => {
  if (!fs.existsSync(decisionLogPath) || !fs.existsSync(queueJsonPath)) return 0;
  const loggedIds = parseDecisionLogIds(fs.readFileSync(decisionLogPath, 'utf-8'));
  const queue = readJsonFile(queueJsonPath, queueJsonPath) as QueueJsonShape;
  let silent = 0;
  for (const issue of Object.values(queue.issues ?? {})) {
    if (issue.status === 'merged' && typeof issue.pr === 'number' && !loggedIds.has(issue.pr)) silent++;
  }
  return silent;
};

export const computeDocHealthSignal = (
  docsDir: string,
  now: Date = new Date(),
  queueJsonPath = '',
): DocHealthSignal => {
  const result = evaluateDocTreeHealth(docsDir);
  const decisionLogPath = path.join(docsDir, 'reference/decision-log.md');
  return {
    version: 1,
    refreshed_at: now.toISOString(),
    doc_debt: result.detail ? 'yes' : 'no',
    detail: result.detail ?? null,
    decision_log_silent_prs: computeDecisionLogSilentPrs(decisionLogPath, queueJsonPath),
  };
};

// Same lightweight tmp+rename idiom as campaign-resume-signal.ts:writeResumeRequestAtomic —
// deliberately not the heavier state-write-guard.ts, since this file is fully recomputed from
// source every turn and never read as authoritative campaign state (blackhole-state.md §
// Write protocol scopes that guard to queue.json/findings-ledger.json only).
export const writeDocHealthSignalAtomic = (campaignDir: string, signal: DocHealthSignal): void => {
  fs.mkdirSync(campaignDir, { recursive: true });
  const target = path.join(campaignDir, 'doc-health.json');
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(signal, null, 2)}\n`);
  fs.renameSync(tmp, target);
};

function main(): void {
  const docsDir = path.join(root, 'documentation');
  const campaignDir = path.join(root, '.blackhole');
  const queueJsonPath = path.join(campaignDir, 'queue.json');
  const signal = computeDocHealthSignal(docsDir, new Date(), queueJsonPath);
  writeDocHealthSignalAtomic(campaignDir, signal);
  console.log(
    `doc_debt=${signal.doc_debt}${signal.detail ? ` detail=${signal.detail}` : ''} decision_log_silent_prs=${signal.decision_log_silent_prs}`,
  );
}

if (import.meta.main) {
  main();
}
