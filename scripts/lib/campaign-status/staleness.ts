/** Hours without a state write after which the campaign is reported stale. The one threshold every
 * staleness check reads; the status page banner uses it. */
export const STALE_AFTER_HOURS = 2;

const HOUR_MS = 3_600_000;

/** The newest valid ISO timestamp among the campaign's state writes, or null when none parses. */
export function newestStateWrite(...timestamps: Array<string | null | undefined>): string | null {
  let best: { iso: string; ms: number } | null = null;
  for (const iso of timestamps) {
    const ms = iso ? Date.parse(iso) : NaN;
    if (!Number.isNaN(ms) && (best === null || ms > best.ms)) best = { iso: iso as string, ms };
  }
  return best?.iso ?? null;
}

/** Hours between the last state write and `nowIso`, to one decimal; null when either is missing. */
export function stateAgeHours(lastIso: string | null, nowIso: string): number | null {
  const last = lastIso ? Date.parse(lastIso) : NaN;
  const now = Date.parse(nowIso);
  if (Number.isNaN(last) || Number.isNaN(now)) return null;
  return Math.round(Math.max(0, now - last) / HOUR_MS * 10) / 10;
}

/** An unknown age is stale: a state file that never recorded a write must not look live. */
export const isStateStale = (ageHours: number | null): boolean => ageHours === null || ageHours > STALE_AFTER_HOURS;
