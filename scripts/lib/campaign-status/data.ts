import * as fs from 'fs';
import * as path from 'path';
import { classPreview } from './blocked-classes.ts';
import { elseClasses, inProgressItems, ownerDetail, readyToMergeDetail } from './report.ts';
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
  return inProgressItems(r).map((i) => ({
    issue: i.issue,
    title: i.title,
    stage: r.in_review.includes(i) ? 'in review' : 'in flight',
    phase: i.phase,
    pr: i.pr,
    next_step: i.next_step,
  }));
}

function waitingOnYouRows(r: StatusReport): StatusDataRow[] {
  return [
    ...r.ready_to_merge.map((i) => ({
      issue: i.issue,
      title: i.title,
      kind: i.held_for === undefined ? 'ready to merge' : 'needs your decision',
      pr: i.pr,
      pr_url: i.pr_url,
      detail: readyToMergeDetail(i),
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
    waiting_else: elseClasses(r).map((c) => {
      const preview = classPreview(c.issues, c.count);
      return {
        kind: c.class,
        label: c.label,
        count: c.count,
        attention: c.attention,
        first_issues: preview.first.map(issueRef).join(', '),
        more_count: preview.more,
      };
    }),
    waiting_else_items: elseClasses(r).flatMap((c) =>
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
