import { readJsonl, writeJsonlCapped } from './fs.ts';
import { MAX_LINES } from './pace-log.ts';
import type { WeeklyReading } from './usage-budget.ts';

// Weekly usage readings over time (.blackhole/usage-history.jsonl, blackhole-state.md § Paths):
// usage-probe.ts appends each normalized reading, one per `observed_at`, newest MAX_LINES kept,
// the same cap as pace-log.jsonl. The status page reads it for the pace verdict
// (usage-budget.ts `weeklyPace`). Local only, never on the state branch.

export const USAGE_HISTORY_FILE = 'usage-history.jsonl';

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isReading = (v: unknown): v is WeeklyReading =>
  typeof v === 'object' && v !== null && isCount((v as WeeklyReading).observed_at) && isCount((v as WeeklyReading).used_percentage) && isCount((v as WeeklyReading).resets_at);

/** The readings in file order (oldest first); a missing file is no history. */
export const readUsageHistory = (filePath: string): WeeklyReading[] => readJsonl(filePath, isReading);

/** Adds `reading`, replacing any earlier one with the same `observed_at`, sorted by time. */
export const appendUsageReading = (filePath: string, reading: WeeklyReading): void => {
  const kept = readUsageHistory(filePath).filter((r) => r.observed_at !== reading.observed_at);
  writeJsonlCapped(filePath, [...kept, reading].sort((a, b) => a.observed_at - b.observed_at), MAX_LINES);
};
