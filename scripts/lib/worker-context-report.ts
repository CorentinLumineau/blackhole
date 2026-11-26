import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile, walkFilesAbs } from './fs.ts';
import { median } from './review-noise-report.ts';

/** Anthropic's default prompt-cache TTL: a worker started within it of the previous worker's last turn reads a warm cache. */
export const WARM_TTL_MS = 5 * 60_000;

/** The file the report is recorded in, inside the campaign directory; `campaign-status.ts` reads it. */
export const WORKER_CONTEXT_FILE = 'worker-context.json';

export type WorkerRow = { role: string; issue: number | null; first_turn_tokens: number; started_ms: number; ended_ms: number };

export type WorkerContextRecord = WorkerContextReport & { recorded_at: string };

export type WorkerContextReport = {
  /** Transcripts read. */
  workers: number;
  /** Workers with no `<role>-<issue>` in their file name, `.meta.json` name or description; counted, never joined to an issue by guessing. */
  unattributed: number;
  median_first_turn_tokens: number | null;
  roles: Record<string, { spawns: number; median_first_turn_tokens: number | null }>;
  /** Merged issues that have at least one attributed worker. */
  merged_prs: number;
  /** Attributed workers on those issues, divided by `merged_prs`; null when no merged issue has a worker. */
  spawns_per_merged_pr: number | null;
  /** Same-role spawns beyond the first on an issue; `warm` started within `WARM_TTL_MS` of the previous worker's last turn. */
  respawns: { total: number; warm: number; cold: number };
};

// A subagent transcript is `agent-a<name>-<16 hex>.jsonl` when the spawn was named, else `agent-a<17 hex>.jsonl`.
const NAMED = /^agent-a(.+)-[0-9a-f]{16}\.jsonl$/;
const ROLE_ISSUE = /^(.+)-(\d+)$/;
// The harness records a spawn's `name` and `description` in `.meta.json` even though it names the file by hash.
const NAME_ISSUE = /-(\d+)(?![0-9])/;
const DESCRIPTION_ISSUE = /\bissue\s+#?(\d+)/i;

/** The `.meta.json` fields that identify a worker; each is null when absent. */
export type WorkerMeta = { agentType: string | null; name: string | null; description: string | null };

const NO_META: WorkerMeta = { agentType: null, name: null, description: null };

const issueOf = (m: RegExpExecArray | null): number | null => (m ? Number(m[1]) : null);

/**
 * Role and issue of a worker. Sources in order: the `<role>-<issue>` file name, the spawn `name` in `.meta.json`
 * (first `-<digits>` segment is the issue), the `description` ("... issue N ..."). The role is the `agentType`'s
 * when the meta has one. A bare PR number in a description is never read as an issue. Null when nothing names a role.
 */
export const roleAndIssue = (fileName: string, meta: WorkerMeta = NO_META): { role: string; issue: number | null } | null => {
  const fileRole = NAMED.exec(fileName)?.[1];
  if (fileRole) {
    const m = ROLE_ISSUE.exec(fileRole);
    return m ? { role: m[1], issue: Number(m[2]) } : { role: fileRole, issue: null };
  }
  const typeRole = meta.agentType?.split(':').pop() || null;
  const role = typeRole ?? meta.name?.split('-')[0] ?? null;
  if (!role) return null;
  return { role, issue: issueOf(NAME_ISSUE.exec(meta.name ?? '')) ?? issueOf(DESCRIPTION_ISSUE.exec(meta.description ?? '')) };
};

/** One transcript to one row: the first assistant turn's `cache_creation_input_tokens` and the first and last timestamps. Null when it has no such turn or no role. */
export const parseWorkerRow = (fileName: string, meta: WorkerMeta, text: string): WorkerRow | null => {
  const who = roleAndIssue(fileName, meta);
  if (!who) return null;
  let first: number | null = null;
  let started = Number.POSITIVE_INFINITY;
  let ended = Number.NEGATIVE_INFINITY;
  for (const raw of text.split('\n')) {
    let entry: { type?: string; timestamp?: string; message?: { usage?: { cache_creation_input_tokens?: unknown } } };
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    const at = Date.parse(entry?.timestamp ?? '');
    if (!Number.isNaN(at)) {
      started = Math.min(started, at);
      ended = Math.max(ended, at);
    }
    const tokens = entry?.type === 'assistant' ? entry.message?.usage?.cache_creation_input_tokens : undefined;
    if (first === null && typeof tokens === 'number') first = tokens;
  }
  return first === null || !Number.isFinite(started) ? null : { ...who, first_turn_tokens: first, started_ms: started, ended_ms: ended };
};

const medianOf = (values: number[]): number | null => median([...values].sort((a, b) => a - b));

/** Workers of one issue in start order; a respawn is a worker whose role already ran on the issue. */
const respawnGaps = (workers: WorkerRow[]): number[] => {
  const ordered = [...workers].sort((a, b) => a.started_ms - b.started_ms);
  const seen = new Set<string>();
  const gaps: number[] = [];
  ordered.forEach((w, i) => {
    if (seen.has(w.role)) gaps.push(w.started_ms - ordered[i - 1].ended_ms);
    seen.add(w.role);
  });
  return gaps;
};

export const buildWorkerContextReport = (rows: WorkerRow[], mergedIssues: number[]): WorkerContextReport => {
  const byRole = new Map<string, number[]>();
  const byIssue = new Map<number, WorkerRow[]>();
  for (const r of rows) {
    byRole.set(r.role, [...(byRole.get(r.role) ?? []), r.first_turn_tokens]);
    if (r.issue !== null) byIssue.set(r.issue, [...(byIssue.get(r.issue) ?? []), r]);
  }
  const merged = mergedIssues.filter((n) => byIssue.has(n));
  const gaps = [...byIssue.values()].flatMap(respawnGaps);
  const warm = gaps.filter((g) => g <= WARM_TTL_MS).length;
  return {
    workers: rows.length,
    unattributed: rows.filter((r) => r.issue === null).length,
    median_first_turn_tokens: medianOf(rows.map((r) => r.first_turn_tokens)),
    roles: Object.fromEntries([...byRole].map(([role, t]) => [role, { spawns: t.length, median_first_turn_tokens: medianOf(t) }])),
    merged_prs: merged.length,
    spawns_per_merged_pr: merged.length ? merged.reduce((n, i) => n + byIssue.get(i)!.length, 0) / merged.length : null,
    respawns: { total: gaps.length, warm, cold: gaps.length - warm },
  };
};

const metaOf = (transcript: string): WorkerMeta => {
  const file = transcript.replace(/\.jsonl$/, '.meta.json');
  try {
    const m = readJsonFile(file, file) as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
    return { agentType: str(m.agentType), name: str(m.name), description: str(m.description) };
  } catch {
    return NO_META;
  }
};

/** Every `subagents/**\/agent-*.jsonl` under `dir` last written at or after `sinceMs`, as rows. Unreadable or unusable files are skipped. */
export const collectWorkerRows = (dir: string, sinceMs: number = Number.NEGATIVE_INFINITY): WorkerRow[] =>
  walkFilesAbs(dir)
    .filter((f) => /agent-a.+\.jsonl$/.test(path.basename(f)) && f.split(path.sep).includes('subagents'))
    .flatMap((f) => {
      try {
        if (fs.statSync(f).mtimeMs < sinceMs) return [];
        const row = parseWorkerRow(path.basename(f), metaOf(f), fs.readFileSync(f, 'utf8'));
        return row && row.started_ms >= sinceMs ? [row] : [];
      } catch {
        return [];
      }
    });

const isRecord = (v: unknown): v is WorkerContextRecord => {
  const r = v as Partial<WorkerContextRecord> | null;
  return typeof r === 'object' && r !== null && typeof r.recorded_at === 'string' && typeof r.workers === 'number' && typeof r.respawns?.total === 'number';
};

/** The recorded report, or null when the file is absent, unreadable or not a report. */
export const readWorkerContext = (campaignDir: string): WorkerContextRecord | null => {
  try {
    const file = path.join(campaignDir, WORKER_CONTEXT_FILE);
    const parsed = readJsonFile(file, file);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
