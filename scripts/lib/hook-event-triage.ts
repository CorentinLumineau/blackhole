import * as fs from 'fs';
import * as path from 'path';

/** Minimal queue issue shape for worktree → issue_ref resolution during Triage 1b. */
export type QueueIssueForTriage = {
  status?: string;
  worktree?: string | null;
};

export type LedgerFinding = {
  id: string;
  vcode: string;
  severity: 'BLOCK' | 'WARN' | 'NOTE';
  phase: string;
  issue_ref: number | null;
  pr_ref: number | null;
  file: string;
  line: number;
  summary: string;
  status: string;
  deferred_to_issue: number | null;
  created_at: string;
  resolved_at: string | null;
};

export type FindingsLedger = {
  refreshed_at: string;
  next_id: number;
  findings: LedgerFinding[];
};

type HookEvent = {
  tier?: string;
  reason?: string;
  worktree?: string | null;
  pattern_id?: string;
  hook?: string;
};

const TIER_VCODE: Record<string, { vcode: string; severity: 'BLOCK' | 'WARN' }> = {
  block: { vcode: 'V-HOOK-01', severity: 'BLOCK' },
  warn: { vcode: 'V-HOOK-02', severity: 'WARN' },
  error: { vcode: 'V-HOOK-03', severity: 'BLOCK' },
};

const findingDedupKey = (finding: Pick<LedgerFinding, 'vcode' | 'file' | 'line' | 'issue_ref'>): string =>
  `${finding.vcode}\0${finding.file}\0${finding.line}\0${finding.issue_ref ?? ''}`;

const isDedupCandidate = (status: string): boolean => status === 'open' || status === 'deferred';

const resolveWorktreePath = (worktree: string): string => {
  try {
    return fs.realpathSync(path.resolve(worktree));
  } catch {
    return path.resolve(worktree);
  }
};

/** Match a hook event's `worktree` against in-flight queue entries (orchestrator-runtime.md § Triage 1b). */
export const resolveIssueRefFromWorktree = (
  worktree: string | null | undefined,
  queueIssues: Record<string, QueueIssueForTriage>,
): number | null => {
  if (worktree == null || worktree === '') return null;
  const eventRoot = resolveWorktreePath(worktree);
  for (const [issueNum, issue] of Object.entries(queueIssues)) {
    if (issue.status !== 'in-flight' || issue.worktree == null || issue.worktree === '') continue;
    if (resolveWorktreePath(issue.worktree) === eventRoot) return Number(issueNum);
  }
  return null;
};

const formatFindingId = (nextId: number): string => `F-${String(nextId).padStart(5, '0')}`;

/**
 * Glob `.blackhole/hook-events/*.json`, map tiers to V-HOOK-0N findings, dedup-append to the
 * ledger, and delete each consumed file — mechanical implementation of orchestrator-runtime.md
 * § Triage step 1b.
 */
export const ingestHookEvents = ({
  repoRoot,
  queueIssues,
  ledger,
}: {
  repoRoot: string;
  queueIssues: Record<string, QueueIssueForTriage>;
  ledger: FindingsLedger;
}): { ingested: number; ledger: FindingsLedger } => {
  const eventsDir = path.join(repoRoot, '.blackhole', 'hook-events');
  if (!fs.existsSync(eventsDir)) return { ingested: 0, ledger };

  const eventFiles = fs.readdirSync(eventsDir).filter((f) => f.endsWith('.json'));
  if (eventFiles.length === 0) return { ingested: 0, ledger };

  const existingKeys = new Set(
    ledger.findings
      .filter((f) => isDedupCandidate(f.status))
      .map((f) => findingDedupKey(f)),
  );

  let nextId = ledger.next_id;
  const newFindings: LedgerFinding[] = [];
  let ingested = 0;

  for (const filename of eventFiles) {
    const filePath = path.join(eventsDir, filename);
    let event: HookEvent;
    try {
      event = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HookEvent;
    } catch {
      continue;
    }

    const tier = event.tier ?? '';
    const mapping = TIER_VCODE[tier];
    if (!mapping) continue;

    const issueRef = resolveIssueRefFromWorktree(event.worktree, queueIssues);
    const relFile = `.blackhole/hook-events/${filename}`;
    const candidate: LedgerFinding = {
      id: '',
      vcode: mapping.vcode,
      severity: mapping.severity,
      phase: 'implement',
      issue_ref: issueRef,
      pr_ref: null,
      file: relFile,
      line: 0,
      summary: event.reason ?? `${event.hook ?? 'hook'}: ${event.pattern_id ?? tier}`,
      status: 'open',
      deferred_to_issue: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
    };

    const key = findingDedupKey(candidate);
    if (!existingKeys.has(key)) {
      candidate.id = formatFindingId(nextId);
      nextId += 1;
      newFindings.push(candidate);
      existingKeys.add(key);
    }

    fs.unlinkSync(filePath);
    ingested += 1;
  }

  if (newFindings.length === 0 && ingested === 0) return { ingested: 0, ledger };

  return {
    ingested,
    ledger: {
      ...ledger,
      refreshed_at: new Date().toISOString(),
      next_id: nextId,
      findings: [...ledger.findings, ...newFindings],
    },
  };
};
