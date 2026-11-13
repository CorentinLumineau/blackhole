import * as fs from 'fs';
import * as path from 'path';
import { SCOPE_LABELS } from './record.ts';
import { campaignName } from './report.ts';
import { STALE_AFTER_HOURS } from './staleness.ts';
import type { ScopeKind, StatusReport } from './types.ts';

/** The datasets of the Claude "Data" dashboard, one `<id>.json` file each (`status-page.md` § Claude Code). */
export const STATUS_DATASET_IDS = [
  'overview',
  'moves',
  'blockers',
  'board',
  'streams',
  'scope',
  'config',
  'decisions',
  'links',
] as const;

export type StatusDatasetId = (typeof STATUS_DATASET_IDS)[number];
export type StatusDataRow = Record<string, string | number | boolean | null>;
export type StatusDatasets = Record<StatusDatasetId, StatusDataRow[]>;

const SCOPE_ORDER = Object.keys(SCOPE_LABELS) as ScopeKind[];

function overviewRow(r: StatusReport): StatusDataRow {
  return {
    title: campaignName(r),
    headline: r.headline.text,
    headline_source: r.headline.source,
    state_kind: r.state.kind,
    last_activity_at: r.state.last_activity_at,
    stale_after_hours: STALE_AFTER_HOURS,
    generated_at: r.generated_at,
    forge_checked: r.forge_checked,
    ...r.stage_counts,
  };
}

function scopeRows(r: StatusReport): StatusDataRow[] {
  return [...r.scope_record.entries]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => SCOPE_ORDER.indexOf(a.e.kind) - SCOPE_ORDER.indexOf(b.e.kind) || a.i - b.i)
    .map(({ e }) => ({
      kind: SCOPE_LABELS[e.kind],
      text: e.refs?.length && !e.refs.every((n) => e.text.includes(`#${n}`)) ? `${e.text} (${e.refs.map((n) => `#${n}`).join(', ')})` : e.text,
      reason: e.reason ?? null,
      date: e.set_at,
    }));
}

/** Every dataset, derived from the one `StatusReport` that `--json` prints; nothing is recomputed. */
export function buildStatusData(r: StatusReport): StatusDatasets {
  return {
    overview: [overviewRow(r)],
    moves: r.moves.map((m) => ({ text: m.text, url: m.url, ref: m.ref })),
    blockers: r.blockers.map((b) => ({ text: b.text, tone: b.tone, source: b.source })),
    board: r.board.map((c) => ({ stage: c.stage, ref: c.ref, kind: c.kind, title: c.title, status: c.status, tone: c.tone, url: c.url, stream: c.stream })),
    streams: r.streams.map((s) => ({ ...s })),
    scope: scopeRows(r),
    config: r.config_rows.map((c) => ({ ...c })),
    decisions: r.decisions.map((d) => ({ date: d.date, text: d.text })),
    links: r.links.map((l) => ({ ...l })),
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
