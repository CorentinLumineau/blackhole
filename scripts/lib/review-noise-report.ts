import { OUTCOME_STATUSES } from './worker-json/constants.ts';

// "Fixed" is the union of these two statuses: the finding was addressed in code, whether or not
// the merge-time cleanup has already promoted it to `resolved`.
const FIXED_STATUSES = ['fixed-in-pr', 'resolved'] as const;
const [WRONG, INTENTIONAL, NOT_WORTH] = OUTCOME_STATUSES;
const WRONG_MIN_N = 5;
const WRONG_SHARE_PCT = 30;
const FIXED_MIN_COUNT = 5;

type NoiseRow = { vcode?: unknown; status?: unknown; created_at?: unknown; rounds_to_lgtm?: unknown };

export type VcodeNoise = {
  vcode: string;
  count: number;
  triaged: number;
  untriaged: number;
  fixed_pct: number;
  wrong_pct: number;
  intentional_pct: number;
  not_worth_pct: number;
  rounds_median: number | null;
  rounds_p95: number | null;
  flags: string[];
};
// Outcome percentages and flags use triaged rows only (fixed + the three outcome statuses);
// open and deferred rows are reported as `untriaged`, never diluting the shares.
export const DENOMINATOR = 'triaged rows (fixed-in-pr, resolved, wrong, intentional, not-worth)';
export type NoiseReport = { denominator: string; since_ms: number; vcodes: VcodeNoise[] };

const UNIT_MS: Record<string, number> = { h: 3600_000, d: 86400_000, w: 7 * 86400_000 };

export const parseSince = (raw: string): number => {
  const m = /^(\d+)([hdw])$/.exec(raw);
  if (!m) throw new Error(`invalid --since "${raw}" (expected e.g. 12h, 7d, 2w)`);
  return Number(m[1]) * UNIT_MS[m[2]];
};

const pct = (n: number, total: number): number => Math.round((n / total) * 1000) / 10;

// Nearest-rank percentile over an ascending-sorted list.
const percentile = (sorted: number[], p: number): number | null =>
  sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

const median = (sorted: number[]): number | null => {
  if (sorted.length === 0) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const buildNoiseReport = (rows: unknown[], opts: { now: number; sinceMs: number }): NoiseReport => {
  const cutoff = opts.now - opts.sinceMs;
  const groups = new Map<string, NoiseRow[]>();
  for (const raw of rows) {
    const row = raw as NoiseRow;
    if (typeof row.vcode !== 'string' || typeof row.created_at !== 'string') continue;
    const created = Date.parse(row.created_at);
    if (Number.isNaN(created) || created < cutoff) continue;
    groups.set(row.vcode, [...(groups.get(row.vcode) ?? []), row]);
  }
  const TRIAGED: readonly string[] = [...FIXED_STATUSES, ...OUTCOME_STATUSES];
  const share = (triaged: NoiseRow[], statuses: readonly string[]): number =>
    triaged.length === 0 ? 0 : pct(triaged.filter((r) => statuses.includes(r.status as string)).length, triaged.length);

  const vcodes = [...groups.entries()]
    .map(([vcode, list]): VcodeNoise => {
      const rounds = list
        .map((r) => r.rounds_to_lgtm)
        .filter((n): n is number => typeof n === 'number')
        .sort((a, b) => a - b);
      const triaged = list.filter((r) => TRIAGED.includes(r.status as string));
      const fixedCount = triaged.filter((r) => (FIXED_STATUSES as readonly string[]).includes(r.status as string)).length;
      const wrongPct = share(triaged, [WRONG]);
      const flags: string[] = [];
      if (triaged.length >= WRONG_MIN_N && wrongPct >= WRONG_SHARE_PCT) flags.push('tune or demote');
      if (fixedCount >= FIXED_MIN_COUNT) flags.push('encode as lint/CI');
      return {
        vcode,
        count: list.length,
        triaged: triaged.length,
        untriaged: list.length - triaged.length,
        fixed_pct: share(triaged, FIXED_STATUSES),
        wrong_pct: wrongPct,
        intentional_pct: share(triaged, [INTENTIONAL]),
        not_worth_pct: share(triaged, [NOT_WORTH]),
        rounds_median: median(rounds),
        rounds_p95: percentile(rounds, 95),
        flags,
      };
    })
    .sort((a, b) => b.count - a.count || a.vcode.localeCompare(b.vcode));
  return { denominator: DENOMINATOR, since_ms: opts.sinceMs, vcodes };
};

export const renderNoiseMarkdown = (report: NoiseReport): string => {
  if (report.vcodes.length === 0) return 'No findings in the window.\n';
  const cell = (n: number | null): string => (n === null ? '-' : String(n));
  const lines = [
    `Percentages are over ${report.denominator}; open/deferred rows are listed separately.`,
    '',
    '| V-code | n | triaged | open/deferred | fixed | wrong | intentional | not-worth | rounds p50 | rounds p95 | flag |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...report.vcodes.map(
      (v) =>
        `| ${v.vcode} | ${v.count} | ${v.triaged} | ${v.untriaged} | ${v.fixed_pct}% | ${v.wrong_pct}% | ${v.intentional_pct}% | ${v.not_worth_pct}% | ${cell(v.rounds_median)} | ${cell(v.rounds_p95)} | ${v.flags.join('; ')} |`,
    ),
  ];
  return `${lines.join('\n')}\n`;
};
