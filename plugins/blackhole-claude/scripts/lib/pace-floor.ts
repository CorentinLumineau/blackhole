// Pace floor (ADR-054 C1): the share of the weekly allowance a campaign should have spent by now if it
// spent 17.5 points per weekday. Pure: no I/O, no clock reads, no local imports; every instant is
// epoch seconds and the local calendar comes from `utcOffsetMinutes` (the caller passes the offset
// in force at `now`).
//
// Credit schedule over the week [resetsAt - 7d, resetsAt], weekdays Monday to Friday in local time:
// the reset weekday at the week start weighs 0.5 and lands at its day end (clamped into the week),
// every other weekday inside the week weighs 1 at its day end, the closing half of the reset
// weekday weighs 0.5 and lands at `resetsAt`, weekend days weigh 0.

export const DEFAULT_PCT_PER_WEEKDAY = 17.5;
export const DEFAULT_DAY_END_HOUR = 18;

export type PaceFloorInput = {
  now: number;
  resetsAt: number;
  usedPct: number;
  pctPerWeekday?: number;
  dayEndHour?: number;
  utcOffsetMinutes?: number;
};
export type PaceFloor = { floor_pct: number; credits: number; shortfall_pct: number };

const DAY = 86400;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export const computePaceFloor = (input: PaceFloorInput): PaceFloor => {
  const { now, resetsAt, usedPct, pctPerWeekday = DEFAULT_PCT_PER_WEEKDAY, dayEndHour = DEFAULT_DAY_END_HOUR, utcOffsetMinutes = 0 } = input;
  if (!Number.isFinite(now)) throw new Error('now must be a finite epoch seconds value');
  if (!Number.isFinite(resetsAt)) throw new Error('resetsAt must be a finite epoch seconds value');
  if (!(usedPct >= 0 && usedPct <= 100)) throw new Error('usedPct must be a number 0-100');
  if (!(pctPerWeekday > 0 && pctPerWeekday <= 100)) throw new Error('pctPerWeekday must be a number in (0, 100]');
  if (!Number.isInteger(dayEndHour) || dayEndHour < 1 || dayEndHour > 24) throw new Error('dayEndHour must be an integer 1-24');
  if (!Number.isFinite(utcOffsetMinutes)) throw new Error('utcOffsetMinutes must be a finite number');

  const offset = utcOffsetMinutes * 60;
  const weekStart = resetsAt - 7 * DAY;
  const resetDay = Math.floor((resetsAt + offset) / DAY);
  let credits = 0;
  for (let day = resetDay - 7; day <= resetDay; day++) {
    const weekday = (day + 4) % 7; // epoch day 0 is a Thursday; 0 is Sunday
    if (weekday < 1 || weekday > 5) continue;
    const dayEnd = day * DAY - offset + dayEndHour * 3600;
    if (day === resetDay) {
      if (resetsAt <= now) credits += 0.5;
    } else if (day === resetDay - 7) {
      if (Math.max(dayEnd, weekStart) <= now) credits += 0.5;
    } else if (dayEnd <= now) {
      credits += 1;
    }
  }
  const floorPct = Math.min(100, round2(credits * pctPerWeekday));
  return { floor_pct: floorPct, credits, shortfall_pct: Math.max(0, round2(floorPct - usedPct)) };
};
