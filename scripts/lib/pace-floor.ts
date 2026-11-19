// Pace floor (ADR-054 C1): the share of the weekly allowance a campaign should have spent by now,
// growing linearly over all 168 hours of the week [resetsAt - 7d, resetsAt] up to
// `weeklyTargetPct` at the reset. Weekends count like weekdays. Pure: no I/O, no clock reads, no
// local imports; every instant is epoch seconds.

export const DEFAULT_WEEKLY_TARGET_PCT = 80;
export const WEEK_HOURS = 168;

export type PaceFloorInput = {
  now: number;
  resetsAt: number;
  usedPct: number;
  weeklyTargetPct?: number;
};
export type PaceFloor = { floor_pct: number; elapsed_h: number; target_pct: number; shortfall_pct: number };

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const computePaceFloor = (input: PaceFloorInput): PaceFloor => {
  const { now, resetsAt, usedPct, weeklyTargetPct = DEFAULT_WEEKLY_TARGET_PCT } = input;
  if (!Number.isFinite(now)) throw new Error('now must be a finite epoch seconds value');
  if (!Number.isFinite(resetsAt)) throw new Error('resetsAt must be a finite epoch seconds value');
  if (!(usedPct >= 0 && usedPct <= 100)) throw new Error('usedPct must be a number 0-100');
  if (!(weeklyTargetPct > 0 && weeklyTargetPct <= 100)) throw new Error('weeklyTargetPct must be a number in (0, 100]');

  const weekStart = resetsAt - WEEK_HOURS * 3600;
  const elapsedH = Math.min(WEEK_HOURS, Math.max(0, (now - weekStart) / 3600));
  const floorPct = round2((weeklyTargetPct * elapsedH) / WEEK_HOURS);
  return { floor_pct: floorPct, elapsed_h: round2(elapsedH), target_pct: weeklyTargetPct, shortfall_pct: Math.max(0, round2(floorPct - usedPct)) };
};
