import { readJsonl, writeJsonlCapped } from './fs.ts';
import type { PaceGateVerdict } from './pace-gate.ts';
import type { ResourceGateVerdict } from './resource-gate.ts';
import type { UsageVerdict, UsageVerdictName } from './usage-budget.ts';

// Per-spawn-round telemetry (.blackhole/pace-log.jsonl, blackhole-state.md § Paths): one JSON line
// per round holding the gate verdicts, the planned batch and the effective concurrency. Newest
// MAX_LINES lines are kept; the file is diagnostic only, except that the turn-start resume step
// reads the latest line's `rate_limit_stop` to treat the previous turn as a pause. `usage` is
// optional: records written before the usage leg have none and still parse.

export const MAX_LINES = 200;

/** The usage-budget CLI's stdout (`scripts/usage-budget.ts`): the verdict plus the usage it judged. */
export type UsageGateOutput = UsageVerdict & { five_hour_pct?: number | null; weekly_pct?: number | null };

export type UsageRecord = {
  verdict: UsageVerdictName;
  workers: number;
  five_hour_pct: number | null;
  weekly_pct: number | null;
  wake_at: number | null;
};

export type PaceRecord = {
  at: string;
  planned: number;
  pace: PaceGateVerdict;
  resource: ResourceGateVerdict | null;
  usage?: UsageRecord | null;
  effective: number;
  rate_limit_stop: boolean;
  reasons: string[];
};

// Usage verdicts that pause the round (spawn nothing, drain, resume later). NO-NEW-STARTS limits
// which issues may start, not how many workers run, and `unavailable` fails open: neither cuts.
const USAGE_PAUSES: UsageVerdictName[] = ['NO-SPAWN', 'STOP-WORKERS', 'PACE-WAIT', 'STOP-CAMPAIGN'];
const USAGE_CUTS: UsageVerdictName[] = ['GO', ...USAGE_PAUSES];

export const buildPaceRecord = (
  now: number,
  planned: number,
  pace: PaceGateVerdict,
  resource: ResourceGateVerdict | null,
  usage: UsageGateOutput | null = null,
): PaceRecord => {
  const counts = [pace.concurrency];
  if (resource) counts.push(resource.batch_size);
  if (usage && USAGE_CUTS.includes(usage.verdict)) counts.push(usage.workers);
  return {
    at: new Date(now * 1000).toISOString(),
    planned,
    pace,
    resource,
    usage: usage
      ? { verdict: usage.verdict, workers: usage.workers, five_hour_pct: usage.five_hour_pct ?? null, weekly_pct: usage.weekly_pct ?? null, wake_at: usage.wake_at }
      : null,
    effective: Math.min(...counts),
    // A rate-limit stop must never be read as a task failure: this flag is what the next turn and the dashboard see.
    rate_limit_stop: pace.verdict === 'STOP-NEW' || (usage !== null && USAGE_PAUSES.includes(usage.verdict)),
    reasons: [...pace.reasons, ...(resource?.reasons ?? []), ...(usage?.reasons ?? [])],
  };
};

const PACE_VERDICTS = ['STOP-NEW', 'THROTTLE', 'HOLD', 'SCALE-UP', 'unavailable'];
const RESOURCE_VERDICTS = ['go', 'degrade', 'defer', 'unavailable'];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isReasons = (v: unknown): boolean => Array.isArray(v) && v.every((r) => typeof r === 'string');
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPctOrNull = (v: unknown): boolean => v === undefined || v === null || isCount(v);
const USAGE_VERDICTS: UsageVerdictName[] = ['GO', 'unavailable', 'NO-NEW-STARTS', ...USAGE_PAUSES];

export const isPaceVerdict = (v: unknown): v is PaceGateVerdict =>
  isObject(v) && PACE_VERDICTS.includes(v.verdict as string) && isCount(v.concurrency) && isReasons(v.reasons);
export const isResourceVerdict = (v: unknown): v is ResourceGateVerdict =>
  isObject(v) && RESOURCE_VERDICTS.includes(v.verdict as string) && isCount(v.batch_size) && isReasons(v.reasons);

export const isUsageRecordVerdict = (v: unknown): v is UsageGateOutput =>
  isObject(v) &&
  USAGE_VERDICTS.includes(v.verdict as UsageVerdictName) &&
  isCount(v.workers) &&
  isReasons(v.reasons) &&
  (v.wake_at === null || isCount(v.wake_at)) &&
  isPctOrNull(v.five_hour_pct) &&
  isPctOrNull(v.weekly_pct);

const isRecord = (v: unknown): v is PaceRecord => isObject(v) && isObject(v.pace) && typeof v.pace.verdict === 'string' && isCount(v.effective);

const readRecords = (logPath: string): PaceRecord[] => readJsonl(logPath, isRecord);

export const appendPaceLog = (logPath: string, record: PaceRecord, maxLines = MAX_LINES): void =>
  writeJsonlCapped(logPath, [...readRecords(logPath), record], maxLines);

export const readLatestPaceRecord = (logPath: string): PaceRecord | null => readRecords(logPath).at(-1) ?? null;

export const formatPaceLine = (r: PaceRecord): string => {
  const resource = r.resource ? `, resource ${r.resource.verdict}` : '';
  const usage = r.usage ? `, usage ${r.usage.verdict}${r.usage.wake_at ? ` until ${new Date(r.usage.wake_at * 1000).toISOString()}` : ''}` : '';
  const why = r.reasons[0] ? ` (${r.reasons[0]})` : '';
  return `Pace: ${r.pace.verdict}${resource}${usage}, planned ${r.planned}, effective ${r.effective}${why} @ ${r.at}`;
};
