import { readScope } from '../../forge-scope.ts';
import { prWebUrl } from '../forge-detection.ts';
import { checkpointSection, computeQueueHealth, sortOpenFindings } from './dashboard.ts';
import { computeStatusAlerts, isStateStale, newestStateWrite, stateAgeHours, statusPageEnabled } from './staleness.ts';
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
  ReadyToMergeItem,
  StatusItem,
  StatusReport,
  StatusState,
} from './types.ts';

export type StatusReportInput = {
  config: ConfigSummaryInput & { repo?: string; forge?: string };
  queue: QueueJson;
  ledger: LedgerJson;
  checkpoint: CheckpointMeta;
  checkpointBody?: string;
  forge: ForgeCounts;
  paceLine: string | null;
  hostNotes: string[];
  generatedAt: string;
  /** Forge host from the origin remote; only Gitea needs it. Absent ⇒ GitHub links. */
  forgeWeb?: { forge: string; host: string | null };
  /** Whether `.blackhole/status-artifact.json` exists, and whether this host publishes one. Absent ⇒ no never-published alert. */
  publish?: { artifactPublished: boolean; publishExpected: boolean };
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
  const token = (notes.split(/\s/)[0] ?? '').replace(/:$/, '');
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

// leave-open delivery marker, phase-loop.md § Merge protocol: written only after isLgtm, no conflict
// and CI green, on a PR that stays open for the owner. Offline by design — no forge call here.
const DELIVERED_PREFIX = 'delivered-at-LGTM';

function readyToMerge(
  issues: Record<string, QueueIssue>,
  repo: string | undefined,
  forge: string,
  host: string | null,
): ReadyToMergeItem[] {
  const items: ReadyToMergeItem[] = [];
  for (const [key, issue] of Object.entries(issues)) {
    if (issue.status !== 'in-flight' || issue.pr == null) continue;
    if (!(issue.notes ?? '').trim().startsWith(DELIVERED_PREFIX)) continue;
    const prUrl = prWebUrl(forge, host, repo ?? '', issue.pr);
    if (prUrl) items.push({ ...toItem({ num: Number(key), issue }), pr_url: prUrl });
  }
  return items.sort((a, b) => a.issue - b.issue);
}

// A checkpoint writes an empty section as a bare marker; that is no worker.
const EMPTY_MARKER = /^(none|\(none\)|-|n\/a)$/i;

// The one place a checkpoint's `## In-flight workers` lines become worker names.
function workerLines(body: string | undefined): string[] {
  return sectionLines(body, 'In-flight workers')
    .map((l) => l.replace(/^[-*]\s+/, '').trim())
    .filter((l) => l !== '' && !EMPTY_MARKER.test(l));
}

/** What the owner has to do for an owner item: its note without the gate token, else the generic next step. */
export function ownerDetail(item: StatusItem): string {
  const note = (item.notes ?? '').replace(/^\s*(awaiting-[\w-]+|blocked-escalated):?\s*/, '').trim();
  return note || item.next_step;
}

const sectionLines = (body: string | undefined, heading: string): string[] =>
  (checkpointSection(body, heading) ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const RECENTLY_DONE_CAP = 5;
const SELF_DRIVING = 'Nothing — the campaign is running on its own.';

type StateInput = {
  generatedAt: string;
  checkpointRefreshedAt: string | null;
  queueRefreshedAt: string | null;
  activeWorkers: string[];
  working: StatusItem[];
  waitingOnOwner: StatusItem[];
  readyToMerge: ReadyToMergeItem[];
  readyCount: number;
  activeCount: number;
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function computeState(i: StateInput): StatusState {
  const lastActivity = newestStateWrite(i.checkpointRefreshedAt, i.queueRefreshedAt);
  const ageHours = stateAgeHours(lastActivity, i.generatedAt);
  const nextAction = i.waitingOnOwner[0]
    ? `${ownerDetail(i.waitingOnOwner[0])} (#${i.waitingOnOwner[0].issue})`
    : i.readyToMerge[0]
      ? `Review and merge PR #${i.readyToMerge[0].pr} (#${i.readyToMerge[0].issue})`
      : SELF_DRIVING;

  let underlying: StatusState['underlying'];
  let reason: string;
  if (i.activeCount === 0) {
    underlying = 'done';
    reason = 'no active issue';
  } else if (i.activeWorkers.length > 0) {
    underlying = 'running';
    reason = `${plural(i.activeWorkers.length, 'worker', 'workers')} active`;
  } else if (i.working.length > 0) {
    underlying = 'running';
    reason = `${plural(i.working.length, 'issue', 'issues')} in flight`;
  } else if (i.waitingOnOwner.length > 0 || i.readyToMerge.length > 0) {
    underlying = 'waiting_on_you';
    reason = `${i.waitingOnOwner.length + i.readyToMerge.length} waiting on you`;
  } else {
    underlying = 'idle';
    reason = i.readyCount > 0 ? 'nothing in flight, work is ready to start' : 'nothing runnable';
  }

  const stale = isStateStale(ageHours);
  return {
    kind: stale ? 'stale' : underlying,
    underlying,
    reason: stale
      ? ageHours === null
        ? 'state has no write time, so what follows may be out of date'
        : `state last written ${ageHours}h ago, so what follows may be out of date`
      : reason,
    last_activity_at: lastActivity,
    stale_hours: ageHours,
    next_action: nextAction,
  };
}

// Newest first by PR number, then issue number: queue entries carry no merge timestamp.
function recentlyDone(done: IssueRow[]): StatusItem[] {
  return [...done]
    .sort((a, b) => (b.issue.pr ?? 0) - (a.issue.pr ?? 0) || b.num - a.num)
    .slice(0, RECENTLY_DONE_CAP)
    .map((r) => toItem(r));
}

/** Builds the `bun run status --json` report from already-loaded state. Pure: no I/O. */
export function buildStatusReport(input: StatusReportInput): StatusReport {
  const { config, queue, ledger, checkpoint, checkpointBody, forge } = input;
  const issues = queue.issues ?? {};
  const findings = ledger.findings ?? [];
  const { inFlight, blocked, ready, done } = groupIssuesByPhase(issues);
  const counts = computeStatusCounts(issues, findings);
  const scope = readScope(config);
  const blockedGroups = groupBlocked(blocked, issues);
  const forgeKind = input.forgeWeb?.forge ?? config.forge ?? 'github';
  const forgeHost = input.forgeWeb?.host ?? null;
  const readyItems = readyToMerge(issues, config.repo, forgeKind, forgeHost);
  const deliveredIssues = new Set(readyItems.map((r) => r.issue));
  const working = inFlight.filter((r) => !deliveredIssues.has(r.num)).map((r) => toItem(r));
  const waitingOnOwner = blockedGroups
    .filter((g) => g.owner)
    .flatMap((g) => g.issues)
    .map((item) => ({
      ...item,
      pr_url: item.pr != null ? prWebUrl(forgeKind, forgeHost, config.repo ?? '', item.pr) || null : null,
    }));

  return {
    schema_version: 1,
    generated_at: input.generatedAt,
    campaign: {
      repo: config.repo ?? null,
      scope: { milestone: scope.milestone ?? null, labels: scope.labels ?? [] },
      started_at: queue.campaign_started_at ?? null,
      queue_refreshed_at: queue.refreshed_at ?? null,
    },
    state: computeState({
      generatedAt: input.generatedAt,
      checkpointRefreshedAt: checkpoint.refreshed_at ?? null,
      queueRefreshedAt: queue.refreshed_at ?? null,
      activeWorkers: workerLines(checkpointBody),
      working,
      waitingOnOwner,
      readyToMerge: readyItems,
      readyCount: ready.length,
      activeCount: counts.queue.active,
    }),
    alerts: computeStatusAlerts({
      checkpointRefreshedAt: checkpoint.refreshed_at,
      queueRefreshedAt: queue.refreshed_at,
      nowIso: input.generatedAt,
      statusPageEnabled: statusPageEnabled(config),
      artifactPublished: input.publish?.artifactPublished ?? false,
      publishExpected: input.publish?.publishExpected ?? false,
    }),
    checkpoint: {
      turn: checkpoint.orchestrator_turn_id ?? null,
      refreshed_at: checkpoint.refreshed_at ?? null,
      last_completed_phase: checkpoint.last_completed_phase ?? null,
      notes: sectionLines(checkpointBody, 'Notes'),
      active_workers: workerLines(checkpointBody),
    },
    forge,
    counts,
    queue_health: computeQueueHealth({
      forgeOk: forge.ok,
      blockedCount: counts.queue.blocked,
      inFlightCount: counts.queue.in_flight,
    }),
    ready_to_merge: readyItems,
    waiting_on_owner: waitingOnOwner,
    in_flight: inFlight.filter((r) => r.issue.phase !== 'review').map((r) => toItem(r)),
    in_review: inFlight.filter((r) => r.issue.phase === 'review').map((r) => toItem(r)),
    blocked: blockedGroups,
    ready: ready.map((r) => toItem(r)),
    recently_done: recentlyDone(done),
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
