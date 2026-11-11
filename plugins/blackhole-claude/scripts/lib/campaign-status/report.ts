import { readScope } from '../../forge-scope.ts';
import { checkpointSection, computeQueueHealth, sortOpenFindings } from './dashboard.ts';
import { computeStatusCounts, DONE_STATUSES, groupIssuesByPhase } from './queue.ts';
import type {
  BlockedGroup,
  CheckpointMeta,
  ConfigSummaryInput,
  ForgeCounts,
  IssueRow,
  LedgerJson,
  QueueIssue,
  QueueJson,
  StatusItem,
  StatusReport,
} from './types.ts';

export type StatusReportInput = {
  config: ConfigSummaryInput & { repo?: string };
  queue: QueueJson;
  ledger: LedgerJson;
  checkpoint: CheckpointMeta;
  checkpointBody?: string;
  forge: ForgeCounts;
  paceLine: string | null;
  hostNotes: string[];
  generatedAt: string;
};

// Owner-clearable `awaiting-*` gates from queue-dag.md § Field rules (`notes`).
const OWNER_GATE_STEPS: Record<string, string> = {
  'awaiting-user-clarification': 'Owner: answer the clarification question',
  'awaiting-plan-approval': 'Owner: approve the plan',
  'awaiting-design-approval': 'Owner: approve the design',
  'awaiting-ruling-recheck': 'Owner: re-confirm the product ruling',
};
// Blocked-Iteration escalation note (checkpoint-protocol.md § Blocked-Iteration Counter).
const ESCALATED_PREFIX = 'blocked-escalated:';

type WaitReason = { waitsOn: string; owner: boolean };

function waitReason(issue: QueueIssue, issues: Record<string, QueueIssue>): WaitReason {
  const notes = (issue.notes ?? '').trim();
  const token = notes.split(/\s/)[0] ?? '';
  if (token.startsWith('awaiting-')) return { waitsOn: token, owner: true };
  if (notes.startsWith(ESCALATED_PREFIX)) return { waitsOn: 'blocked-escalated', owner: true };
  if (notes.startsWith('merge-conflict-semantic')) return { waitsOn: 'merge-conflict', owner: false };
  if (/overlap with #\d+/.test(notes)) return { waitsOn: 'overlap', owner: false };
  const unmet = (issue.depends_on ?? []).some((d) => {
    const dep = issues[String(d)];
    return dep != null && !DONE_STATUSES.includes(dep.status ?? '');
  });
  return { waitsOn: unmet ? 'dependency' : 'other', owner: false };
}

function blockedStep(issue: QueueIssue, reason: WaitReason): string {
  if (reason.waitsOn === 'blocked-escalated') return 'Owner: decide on the escalated blocker';
  if (reason.owner) return OWNER_GATE_STEPS[reason.waitsOn] ?? `Owner: clear ${reason.waitsOn}`;
  if (reason.waitsOn === 'dependency') return `Wait for #${(issue.depends_on ?? []).join(', #')}`;
  if (reason.waitsOn === 'merge-conflict') return 'Resolve the merge conflict';
  if (reason.waitsOn === 'overlap') return 'Wait for the overlapping issue to merge';
  return 'Unblock';
}

function activeStep(issue: QueueIssue): string {
  const pr = issue.pr != null ? `PR #${issue.pr}` : null;
  if (issue.status === 'ready') return 'Start when a worker slot frees';
  switch (issue.phase) {
    case 'handle':
      return 'Handle: route and clarify';
    case 'plan':
      return 'Plan: write the plan';
    case 'implement':
      return pr ? `Implement: update ${pr}` : 'Implement: open the PR';
    case 'review': {
      const iteration = issue.review_iteration ? ` (review iteration ${issue.review_iteration})` : '';
      return `Review${pr ? ` ${pr}` : ''}${iteration}`;
    }
    default:
      return issue.phase ?? '—';
  }
}

function toItem({ num, issue }: IssueRow, reason?: WaitReason): StatusItem {
  return {
    issue: num,
    title: issue.title ?? '',
    phase: issue.phase ?? null,
    status: issue.status ?? null,
    pr: issue.pr ?? null,
    notes: issue.notes ?? null,
    next_step: reason ? blockedStep(issue, reason) : activeStep(issue),
  };
}

function groupBlocked(blocked: IssueRow[], issues: Record<string, QueueIssue>): BlockedGroup[] {
  const groups = new Map<string, BlockedGroup>();
  for (const row of blocked) {
    const reason = waitReason(row.issue, issues);
    const group = groups.get(reason.waitsOn) ?? { waits_on: reason.waitsOn, owner: reason.owner, count: 0, issues: [] };
    group.issues.push(toItem(row, reason));
    group.count += 1;
    groups.set(reason.waitsOn, group);
  }
  // Owner groups first — they are what the owner can act on — then alphabetical, for stable output.
  return [...groups.values()].sort(
    (a, b) => Number(b.owner) - Number(a.owner) || a.waits_on.localeCompare(b.waits_on),
  );
}

const sectionLines = (body: string | undefined, heading: string): string[] =>
  (checkpointSection(body, heading) ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** Builds the `bun run status --json` report from already-loaded state. Pure: no I/O. */
export function buildStatusReport(input: StatusReportInput): StatusReport {
  const { config, queue, ledger, checkpoint, checkpointBody, forge } = input;
  const issues = queue.issues ?? {};
  const findings = ledger.findings ?? [];
  const { inFlight, blocked, ready } = groupIssuesByPhase(issues);
  const counts = computeStatusCounts(issues, findings);
  const scope = readScope(config);
  const blockedGroups = groupBlocked(blocked, issues);

  return {
    schema_version: 1,
    generated_at: input.generatedAt,
    campaign: {
      repo: config.repo ?? null,
      scope: { milestone: scope.milestone ?? null, labels: scope.labels ?? [] },
      started_at: queue.campaign_started_at ?? null,
      queue_refreshed_at: queue.refreshed_at ?? null,
    },
    checkpoint: {
      turn: checkpoint.orchestrator_turn_id ?? null,
      refreshed_at: checkpoint.refreshed_at ?? null,
      last_completed_phase: checkpoint.last_completed_phase ?? null,
      notes: sectionLines(checkpointBody, 'Notes'),
      active_workers: sectionLines(checkpointBody, 'In-flight workers'),
    },
    forge,
    counts,
    queue_health: computeQueueHealth({
      forgeOk: forge.ok,
      blockedCount: counts.queue.blocked,
      inFlightCount: counts.queue.in_flight,
    }),
    waiting_on_owner: blockedGroups.filter((g) => g.owner).flatMap((g) => g.issues),
    in_flight: inFlight.filter((r) => r.issue.phase !== 'review').map((r) => toItem(r)),
    in_review: inFlight.filter((r) => r.issue.phase === 'review').map((r) => toItem(r)),
    blocked: blockedGroups,
    ready: ready.map((r) => toItem(r)),
    ledger_open: sortOpenFindings(findings).map((f) => ({
      id: f.id ?? null,
      vcode: f.vcode ?? null,
      severity: f.severity ?? null,
      summary: f.summary ?? '',
      issue_ref: f.issue_ref ?? null,
    })),
    host: { pace: input.paceLine, notes: input.hostNotes },
  };
}
