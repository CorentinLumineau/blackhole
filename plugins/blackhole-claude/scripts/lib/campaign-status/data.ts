import * as fs from 'fs';
import * as path from 'path';
import { ownerDetail } from './report.ts';
import { STALE_AFTER_HOURS } from './staleness.ts';
import type { StatusItem, StatusReport } from './types.ts';

/** The datasets of the Claude "Data" dashboard, one `<id>.json` file each (`status-page.md` § Claude Code). */
export const STATUS_DATASET_IDS = [
  'summary',
  'in_progress',
  'waiting_on_you',
  'waiting_else',
  'waiting_else_items',
  'up_next',
  'recently_done',
  'notes',
] as const;

export type StatusDatasetId = (typeof STATUS_DATASET_IDS)[number];
export type StatusDataRow = Record<string, string | number | boolean | null>;
export type StatusDatasets = Record<StatusDatasetId, StatusDataRow[]>;

/** Issues named on a class's one visible line; the full list is its items. */
const FIRST_ISSUES = 3;

const issueRef = (i: StatusItem): string => `#${i.issue}`;

function summaryRow(r: StatusReport): StatusDataRow {
  return {
    repo: r.campaign.repo,
    turn: r.checkpoint.turn,
    state_kind: r.state.kind,
    state_underlying: r.state.underlying,
    state_reason: r.state.reason,
    last_activity_at: r.state.last_activity_at,
    stale_after_hours: STALE_AFTER_HOURS,
    next_action: r.state.next_action,
    generated_at: r.generated_at,
    finished: r.counts.queue.done,
    open: r.counts.queue.active,
    in_flight: r.counts.queue.in_flight,
    blocked: r.counts.queue.blocked,
    ready: r.counts.queue.ready,
    forge_ok: r.forge.ok,
    forge_open_issues: r.forge.ok ? r.forge.openIssues : null,
    forge_open_prs: r.forge.ok ? r.forge.openPrs : null,
    queue_health: r.queue_health,
    findings_open: r.counts.ledger.open,
  };
}

function inProgressRows(r: StatusReport): StatusDataRow[] {
  const delivered = new Set(r.ready_to_merge.map((i) => i.issue));
  const row = (i: StatusItem, stage: string): StatusDataRow => ({
    issue: i.issue,
    title: i.title,
    stage,
    phase: i.phase,
    pr: i.pr,
    next_step: i.next_step,
  });
  return [
    ...r.in_flight.filter((i) => !delivered.has(i.issue)).map((i) => row(i, 'in flight')),
    ...r.in_review.filter((i) => !delivered.has(i.issue)).map((i) => row(i, 'in review')),
  ];
}

function waitingOnYouRows(r: StatusReport): StatusDataRow[] {
  return [
    ...r.ready_to_merge.map((i) => ({
      issue: i.issue,
      title: i.title,
      kind: 'ready to merge',
      pr: i.pr,
      pr_url: i.pr_url,
      detail: 'LGTM · CI green · no conflict — review and merge',
    })),
    ...r.waiting_on_owner.map((i) => ({
      issue: i.issue,
      title: i.title,
      kind: 'owner gate',
      pr: i.pr,
      pr_url: i.pr_url ?? null,
      detail: ownerDetail(i),
    })),
  ];
}

function notesRows(r: StatusReport): StatusDataRow[] {
  const { notes, active_workers } = r.checkpoint;
  const findings = r.ledger_open.map((f) =>
    [f.severity ?? '?', f.vcode ?? '', f.summary, f.issue_ref != null ? `#${f.issue_ref}` : ''].filter(Boolean).join(' '),
  );
  return [
    ...notes.map((text) => ({ kind: 'note', text })),
    ...active_workers.map((text) => ({ kind: 'worker', text })),
    ...[r.host.pace, ...r.host.notes].filter((t): t is string => !!t).map((text) => ({ kind: 'host', text })),
    ...findings.map((text) => ({ kind: 'finding', text })),
  ];
}

/** Every dataset, derived from the one `StatusReport` that `--json` prints; nothing is recomputed. */
export function buildStatusData(r: StatusReport): StatusDatasets {
  return {
    summary: [summaryRow(r)],
    in_progress: inProgressRows(r),
    waiting_on_you: waitingOnYouRows(r),
    waiting_else: r.blocked_classes.map((c) => ({
      kind: c.class,
      label: c.label,
      count: c.count,
      attention: c.attention,
      first_issues: c.issues.slice(0, FIRST_ISSUES).map(issueRef).join(', '),
      more_count: Math.max(0, c.count - FIRST_ISSUES),
    })),
    waiting_else_items: r.blocked_classes.flatMap((c) =>
      c.issues.map((i) => ({ class: c.class, issue: i.issue, title: i.title, pr: i.pr, detail: i.notes?.trim() || i.next_step })),
    ),
    up_next: r.ready.map((i) => ({ issue: i.issue, title: i.title })),
    recently_done: r.recently_done.map((i) => ({ issue: i.issue, title: i.title, pr: i.pr })),
    notes: notesRows(r),
  };
}

/** Writes `<dir>/<id>.json` for every dataset (atomic per file) and returns the paths. */
export function writeStatusData(dir: string, report: StatusReport): string[] {
  const data = buildStatusData(report);
  fs.mkdirSync(dir, { recursive: true });
  return STATUS_DATASET_IDS.map((id) => {
    const target = path.join(dir, `${id}.json`);
    fs.writeFileSync(`${target}.tmp`, `${JSON.stringify(data[id], null, 2)}\n`);
    fs.renameSync(`${target}.tmp`, target);
    return target;
  });
}
