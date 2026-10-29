import * as fs from 'fs';
import * as path from 'path';
import type { PaceGateVerdict } from './pace-gate.ts';
import type { ResourceGateVerdict } from './resource-gate.ts';

// Per-spawn-round telemetry (.blackhole/pace-log.jsonl, blackhole-state.md § Paths): one JSON line
// per round holding both gate verdicts, the planned batch and the effective concurrency. Newest
// MAX_LINES lines are kept; the file is diagnostic only, never read back to decide anything.

export const MAX_LINES = 200;

export type PaceRecord = {
  at: string;
  planned: number;
  pace: PaceGateVerdict;
  resource: ResourceGateVerdict | null;
  effective: number;
  rate_limit_stop: boolean;
  reasons: string[];
};

export const buildPaceRecord = (
  now: number,
  planned: number,
  pace: PaceGateVerdict,
  resource: ResourceGateVerdict | null,
): PaceRecord => ({
  at: new Date(now * 1000).toISOString(),
  planned,
  pace,
  resource,
  effective: resource ? Math.min(pace.concurrency, resource.batch_size) : pace.concurrency,
  // A rate-limit stop must never be read as a task failure: this flag is what the next turn and the dashboard see.
  rate_limit_stop: pace.verdict === 'STOP-NEW',
  reasons: [...pace.reasons, ...(resource?.reasons ?? [])],
});

const PACE_VERDICTS = ['STOP-NEW', 'THROTTLE', 'HOLD', 'SCALE-UP', 'unavailable'];
const RESOURCE_VERDICTS = ['go', 'degrade', 'defer', 'unavailable'];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isReasons = (v: unknown): boolean => Array.isArray(v) && v.every((r) => typeof r === 'string');
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const isPaceVerdict = (v: unknown): v is PaceGateVerdict =>
  isObject(v) && PACE_VERDICTS.includes(v.verdict as string) && isCount(v.concurrency) && isReasons(v.reasons);
export const isResourceVerdict = (v: unknown): v is ResourceGateVerdict =>
  isObject(v) && RESOURCE_VERDICTS.includes(v.verdict as string) && isCount(v.batch_size) && isReasons(v.reasons);

const isRecord = (v: unknown): v is PaceRecord => isObject(v) && isObject(v.pace) && typeof v.pace.verdict === 'string' && isCount(v.effective);

const parseLines = (raw: string): PaceRecord[] => {
  const out: PaceRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) out.push(parsed);
    } catch {
      // A torn or foreign line is dropped on the next rewrite.
    }
  }
  return out;
};

const readRecords = (logPath: string): PaceRecord[] => {
  try {
    return parseLines(fs.readFileSync(logPath, 'utf-8'));
  } catch {
    return [];
  }
};

export const appendPaceLog = (logPath: string, record: PaceRecord, maxLines = MAX_LINES): void => {
  const kept = [...readRecords(logPath), record].slice(-maxLines);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(`${logPath}.tmp`, kept.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.renameSync(`${logPath}.tmp`, logPath);
};

export const readLatestPaceRecord = (logPath: string): PaceRecord | null => readRecords(logPath).at(-1) ?? null;

export const formatPaceLine = (r: PaceRecord): string => {
  const resource = r.resource ? `, resource ${r.resource.verdict}` : '';
  const why = r.reasons[0] ? ` (${r.reasons[0]})` : '';
  return `Pace: ${r.pace.verdict}${resource}, planned ${r.planned}, effective ${r.effective}${why} @ ${r.at}`;
};
