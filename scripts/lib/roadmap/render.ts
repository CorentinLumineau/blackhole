import { waitReason } from '../campaign-status/blocked-classes.ts';
import { DONE_STATUSES, isSameRepoKey } from '../campaign-status/queue.ts';
import { ADDRESSES_OWNER } from '../campaign-status/report.ts';
import type { QueueIssue, QueueJson } from '../campaign-status/types.ts';
import { orderIssues, waveOf } from '../pareto-order.ts';

// The consumer roadmap: every open issue of `queue.json` in the order the run takes them, as a
// pure function of the queue. The order is `pareto-order.ts`'s (wave, stored priority, effort,
// oldest); this module groups and renders it and ranks nothing itself. No clock, no I/O: the same
// queue renders the same bytes, so a file that is rewritten only when the body changed stays quiet.

export type RoadmapRow = {
  issue: number;
  title: string;
  app: string;
  kind: string;
  gain: number | null;
  effort: number | null;
  priority: number | null;
  dependsOn: number[];
  why: string;
  /** Only the owner table fills it: what the issue waits for. */
  waitingFor: string;
};

export type RoadmapRanked = RoadmapRow & { rank: number };

export type RoadmapModel = {
  /** Every ranked row, in rank order. */
  rows: RoadmapRanked[];
  now: RoadmapRanked[];
  next: RoadmapRanked[];
  later: RoadmapRanked[];
  owner: RoadmapRow[];
  counts: Array<{ app: string; count: number }>;
};

/** Longest `Why` / `Waiting for` text a table cell carries. */
const CELL_MAX = 120;
const NONE = '-';

const labelValue = (issue: QueueIssue, prefix: string): string | null => {
  const hit = (issue.labels ?? []).find((l) => l.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
};

const oneLine = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > CELL_MAX ? `${flat.slice(0, CELL_MAX - 1).trimEnd()}…` : flat;
};

const rowOf = (n: number, issue: QueueIssue): RoadmapRow => ({
  issue: n,
  title: oneLine(issue.title ?? ''),
  app: labelValue(issue, 'app:') ?? NONE,
  kind: labelValue(issue, 'kind:') ?? issue.route?.task_type ?? NONE,
  gain: issue.pareto?.gain ?? null,
  effort: issue.pareto?.effort ?? null,
  priority: issue.pareto?.priority ?? null,
  dependsOn: [...(issue.depends_on ?? [])].sort((a, b) => a - b),
  why: oneLine(issue.pareto?.rationale ?? ''),
  waitingFor: '',
});

/** What an owner-only issue waits for, or null when the owner is not the one it waits on. */
function ownerWait(issue: QueueIssue, issues: Record<string, QueueIssue>): string | null {
  if (issue.status !== 'blocked') return null;
  const reason = waitReason(issue, issues);
  if (reason.owner) return reason.waitsOn;
  const notes = (issue.notes ?? '').trim();
  return ADDRESSES_OWNER.test(notes) ? oneLine(notes) : null;
}

export function buildRoadmap(queue: QueueJson | undefined): RoadmapModel {
  const issues = Object.fromEntries(Object.entries(queue?.issues ?? {}).filter(([key]) => isSameRepoKey(key)));
  const isOpen = (i: QueueIssue) => !DONE_STATUSES.includes(i.status ?? '');
  const open = orderIssues(issues, isOpen);
  const waits = new Map(open.map((n) => [n, ownerWait(issues[String(n)], issues)]));

  const owner: RoadmapRow[] = open
    .filter((n) => waits.get(n) !== null)
    .map((n) => ({ ...rowOf(n, issues[String(n)]), waitingFor: waits.get(n) ?? '' }));

  const { waves } = waveOf(issues);
  const pins = queue?.user_queue_order ?? [];
  const pinned = (n: number) => (pins.includes(n) ? pins.indexOf(n) : Number.POSITIVE_INFINITY);
  // `open` is already in wave, priority, effort, oldest order; a pin sorts first within its wave and ties keep that order.
  const ranked = open
    .filter((n) => waits.get(n) === null)
    .sort((a, b) => waves[a] - waves[b] || pinned(a) - pinned(b));

  const rows: RoadmapRanked[] = ranked.map((n, at) => ({ ...rowOf(n, issues[String(n)]), rank: at + 1 }));
  const distinctWaves = [...new Set(ranked.map((n) => waves[n]))];
  const horizon = (n: number): 'now' | 'next' | 'later' => {
    const at = distinctWaves.indexOf(waves[n]);
    return at === 0 ? 'now' : at === 1 ? 'next' : 'later';
  };

  const perApp = new Map<string, number>();
  for (const row of [...rows, ...owner]) perApp.set(row.app, (perApp.get(row.app) ?? 0) + 1);
  const counts = [...perApp.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) // byte order: the same on every machine
    .map(([app, count]) => ({ app, count }));

  return {
    rows,
    now: rows.filter((r) => horizon(r.issue) === 'now'),
    next: rows.filter((r) => horizon(r.issue) === 'next'),
    later: rows.filter((r) => horizon(r.issue) === 'later'),
    owner,
    counts,
  };
}

const cell = (text: string | number | null): string => (text === null || text === '' ? NONE : String(text).replace(/\|/g, '\\|'));

const table = (header: string[], body: string[][]): string =>
  [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...body.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

const section = (heading: string, content: string | null): string => `## ${heading}\n\n${content ?? 'None.'}\n`;

const issueCell = (r: RoadmapRow) => `#${r.issue}${r.title ? ` ${r.title}` : ''}`;
const deps = (r: RoadmapRow) => (r.dependsOn.length ? r.dependsOn.map((d) => `#${d}`).join(', ') : null);

const horizonTable = (rows: RoadmapRanked[]): string | null =>
  rows.length
    ? table(
        ['Rank', 'Issue', 'App', 'Kind', 'Gain', 'Effort', 'Priority', 'Depends on', 'Why'],
        rows.map((r) => [r.rank, issueCell(r), r.app, r.kind, r.gain, r.effort, r.priority ?? 'unscored', deps(r), r.why]),
      )
    : null;

/** The roadmap document's body: the part a changed ranking changes. Frontmatter is the writer's. */
export function renderRoadmapBody(model: RoadmapModel): string {
  const ownerTable = model.owner.length
    ? table(
        ['Issue', 'App', 'Kind', 'Gain', 'Effort', 'Priority', 'Waiting for'],
        model.owner.map((r) => [issueCell(r), r.app, r.kind, r.gain, r.effort, r.priority ?? 'unscored', r.waitingFor]),
      )
    : null;
  const countsTable = model.counts.length ? table(['App', 'Issues'], model.counts.map((c) => [c.app, c.count])) : null;
  return [
    '# Roadmap\n\nGenerated by `scripts/roadmap.ts` from the campaign queue: do not edit by hand. Order: dependency wave, owner pins, priority, effort, oldest.\n',
    section('Now', horizonTable(model.now)),
    section('Next', horizonTable(model.next)),
    section('Later', horizonTable(model.later)),
    section('Waiting on the owner', ownerTable),
    section('Open issues per app', countsTable),
  ].join('\n');
}
