// Shape adapters for a usage payload an agent or a host hands over as a file (usage.ts --usage).
// Pure: no I/O, no clock. Three shapes are accepted: the normalized one (a `windows` array) and the
// desktop `get_usage` / RateLimits one (top-level keys named like windows), and the raw desktop
// `get_usage` tool output (`plan.windows` rows labelled like the app's usage screen). A payload mixing
// that last shape with any top-level window form is rejected: no source is silently preferred.

export class UsageFileError extends Error {}

export type PlanName = 'pro' | 'max' | 'none' | 'unknown';
export type ReportWindow = { name: string; used_pct: number; resets_at: number };
export type ExtraUsage = { enabled: boolean; currency: string | null };
export type NormalizedUsage = { plan: PlanName; windows: ReportWindow[]; extra_usage: ExtraUsage | null; read_at: number | null };

// five-hour, weekly, per-model weekly (seven_day_opus, ...)
const WINDOW_NAME = /^(five_hour|seven_day(_[a-z0-9]+)*)$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const epochSeconds = (v: unknown, what: string): number => {
  const seconds = typeof v === 'string' ? Math.floor(Date.parse(v) / 1000) : v;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) throw new UsageFileError(`${what} must be epoch seconds > 0 or an ISO-8601 date`);
  return seconds;
};

const percent = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !(v >= 0 && v <= 100)) throw new UsageFileError(`${what} must be a number 0-100`);
  return v;
};

const mapPlan = (v: unknown): PlanName => {
  if (typeof v !== 'string') return 'unknown';
  const p = v.toLowerCase();
  return p.includes('max') ? 'max' : p.includes('pro') ? 'pro' : p.includes('none') ? 'none' : 'unknown';
};

const extraUsage = (v: unknown): ExtraUsage | null => {
  if (!isRecord(v)) return null;
  const enabled = v.enabled ?? v.is_enabled;
  if (typeof enabled !== 'boolean') return null;
  return { enabled, currency: typeof v.currency === 'string' ? v.currency : null };
};

/** A window value in the desktop shape: `used_pct | used_percentage` (0-100) or `utilization` (0-1). */
const desktopWindow = (name: string, v: unknown): ReportWindow => {
  if (!isRecord(v)) throw new UsageFileError(`${name} must be an object`);
  let used: number;
  if (v.utilization !== undefined) {
    if (typeof v.utilization !== 'number' || !(v.utilization >= 0 && v.utilization <= 1)) throw new UsageFileError(`${name}.utilization must be a number 0-1`);
    used = Math.round(v.utilization * 10000) / 100;
  } else {
    used = percent(v.used_pct ?? v.used_percentage, `${name}.used_pct`);
  }
  return { name, used_pct: used, resets_at: epochSeconds(v.resets_at ?? v.resetsAt, `${name}.resets_at`) };
};

const collectWindows = (payload: Record<string, unknown>): ReportWindow[] => {
  if (Array.isArray(payload.windows)) {
    return payload.windows.map((w, i) => {
      if (!isRecord(w) || typeof w.name !== 'string' || !WINDOW_NAME.test(w.name)) throw new UsageFileError(`windows[${i}].name must be five_hour, seven_day or seven_day_<model>`);
      return { name: w.name, used_pct: percent(w.used_pct, `windows[${i}].used_pct`), resets_at: epochSeconds(w.resets_at, `windows[${i}].resets_at`) };
    });
  }
  const source = isRecord(payload.rate_limits) ? payload.rate_limits : payload;
  return Object.keys(source).filter((k) => WINDOW_NAME.test(k)).map((k) => desktopWindow(k, source[k]));
};

const CCD_LABELS: Array<[RegExp, 'five_hour' | 'seven_day']> = [
  [/^5[- ]hour limit$/, 'five_hour'],
  [/^weekly all models$/, 'seven_day'],
];
const normalizeLabel = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Rows of the desktop `get_usage` `plan.windows`: only the 5-hour and weekly all-models rows map; others are ignored. */
export const ccdRowsToWindows = (rows: unknown[]): ReportWindow[] => {
  const windows: ReportWindow[] = [];
  for (const row of rows) {
    if (!isRecord(row) || typeof row.label !== 'string') continue;
    const label = normalizeLabel(row.label);
    const name = CCD_LABELS.find(([re]) => re.test(label))?.[1];
    if (!name) continue;
    const { percentUsed, resetsAt } = row;
    if (typeof percentUsed !== 'number' || !(percentUsed >= 0 && percentUsed <= 100)) throw new UsageFileError(`${name} percentUsed must be a number 0-100`);
    const resets = typeof resetsAt === 'string' ? Math.floor(Date.parse(resetsAt) / 1000) : resetsAt;
    if (typeof resets !== 'number' || !Number.isFinite(resets) || resets <= 0) throw new UsageFileError(`${name} resetsAt must be an ISO-8601 string or epoch seconds > 0`);
    windows.push({ name, used_pct: percentUsed, resets_at: resets });
  }
  return windows;
};

/** Throws UsageFileError (message without the file path; the caller prefixes it). */
export const normalizeUsagePayload = (payload: unknown): NormalizedUsage => {
  if (!isRecord(payload)) throw new UsageFileError('usage payload must be a JSON object');
  const ccd = isRecord(payload.plan) && Array.isArray(payload.plan.windows) ? payload.plan : null;
  if (ccd && (Array.isArray(payload.windows) || isRecord(payload.rate_limits) || Object.keys(payload).some((k) => WINDOW_NAME.test(k)))) {
    throw new UsageFileError('usage payload mixes the desktop get_usage shape with top-level windows');
  }
  const windows = ccd ? ccdRowsToWindows(ccd.windows as unknown[]) : collectWindows(payload);
  if (ccd && !windows.length) throw new UsageFileError('get_usage carries no 5-hour or weekly all-models window');
  const names = new Set(windows.map((w) => w.name));
  if (names.size !== windows.length) throw new UsageFileError('usage payload repeats a window name');
  const plan = mapPlan(ccd ? ccd.plan : payload.plan);
  if (!windows.length && plan !== 'none') throw new UsageFileError('usage payload carries no window and its plan is not none');
  const readAt = payload.read_at === undefined ? null : epochSeconds(payload.read_at, 'read_at');
  return { plan, windows, extra_usage: extraUsage(ccd ? ccd.extraUsage : payload.extra_usage), read_at: readAt };
};
