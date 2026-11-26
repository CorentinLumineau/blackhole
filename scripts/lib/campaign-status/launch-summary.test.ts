import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { applyOverrides, DEFAULT_CATCHUP, floorBudget, readPacing } from '../catchup.ts';
import type { RateLimits } from '../rate-limit-cache.ts';
import { DEFAULT_USAGE_BUDGET } from '../usage-budget.ts';
import type { UsageReport } from '../usage-source.ts';
import { buildBudgetPanel, NOT_PROBED } from './budget.ts';
import {
  budgetRow,
  type CatchupInput,
  buildLaunchSummary,
  gateCards,
  LAUNCH_ROW_KEYS,
  MAX_CONSEQUENCE_CHARS,
  renderLaunchSummary,
  usageCapsPatch,
  type LaunchRow,
} from './launch-summary.ts';
import { buildStatusReport } from './report.ts';
import type { StatusPageInput } from './status-page-row.ts';
import { loadCampaignState } from './state.ts';
import type { DetectedPeer, DetectResult } from '../peer-campaigns.ts';
import type { BudgetPanel, ForgeCounts, PrSignal } from './types.ts';

const panel = (config: Record<string, unknown>, limits: RateLimits | null, now = NOW): BudgetPanel =>
  limits ? buildBudgetPanel({ limits, reason: null, ageSeconds: 0, now, config }) : { ...NOT_PROBED, reason: 'no --usage given' };

const FIXTURES = path.resolve(import.meta.dir, '../../../fixtures/campaign-status');
const EXPECTED = path.join(FIXTURES, 'full', 'launch-summary.expected.md');
const NOW_ISO = '2026-11-13T09:30:00.000Z';
const NOW = Date.parse(NOW_ISO) / 1000;
const HOUR = 3600;
const URL = 'https://claude.ai/code/artifact/abc';

const online = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'full/forge.online.json'), 'utf-8')) as {
  forge: ForgeCounts;
  pr_signals: Record<string, PrSignal>;
};

// The fixture campaign plus a sample config: usage pacing on, docs governance on.
const state = loadCampaignState(path.join(FIXTURES, 'full'));
const SAMPLE_CONFIG = {
  ...state.config,
  docs_governance: { enabled: true },
  usage_budget: { enabled: true, max_workers: 3 },
} as Record<string, unknown>;
const USAGE: RateLimits = {
  five_hour: { used_percentage: 40, resets_at: NOW + 4 * HOUR },
  seven_day: { used_percentage: 50, resets_at: NOW + 72 * HOUR },
};
const report = buildStatusReport({
  ...state,
  config: SAMPLE_CONFIG,
  forge: online.forge,
  prSignals: online.pr_signals,
  paceLine: null,
  hostNotes: [],
  generatedAt: NOW_ISO,
  pluginVersion: '9.9.9',
});
const PAGE: StatusPageInput = {
  enabled: true,
  publishExpected: true,
  artifact: { url: URL, kind: 'data', template_version: 4, last_probe: { at: '2026-11-13T09:25:00.000Z', ok: true, url: URL } },
  templateVersion: 4,
  nowIso: NOW_ISO,
};
const fullRows = (): LaunchRow[] =>
  buildLaunchSummary({ report, config: SAMPLE_CONFIG, budget: panel(SAMPLE_CONFIG, USAGE), statusPage: PAGE, queue: state.queue });

describe('the launch summary of the full fixture', () => {
  const rows = fullRows();

  test('renders the committed expected markdown', () => {
    expect(renderLaunchSummary(rows)).toBe(fs.readFileSync(EXPECTED, 'utf-8'));
  });

  test('warnings render as blockquote lines between the heading and the table, in order', () => {
    const plain = renderLaunchSummary(rows).split('\n');
    const one = renderLaunchSummary(rows, ['W1']).split('\n');
    expect(one.slice(0, 4)).toEqual(['## Launch summary', '', '> W1', '']);
    expect(one.slice(4)).toEqual(plain.slice(2));
    expect(renderLaunchSummary(rows, ['W1', 'W2']).split('\n').slice(0, 5)).toEqual(['## Launch summary', '', '> W1', '> W2', '']);
  });

  test('with a target, the heading names owner/repo and the absolute campaign directory; the table is unchanged', () => {
    const rows = fullRows();
    const target = { repo: 'acme/widgets', campaignDir: '/srv/widgets/.blackhole', source: 'config' as const };
    const lines = renderLaunchSummary(rows, ['W1'], target).split('\n');
    expect(lines.slice(0, 3)).toEqual(['## Launch summary — acme/widgets · /srv/widgets/.blackhole', '', '> W1']);
    expect(lines.slice(1)).toEqual(renderLaunchSummary(rows, ['W1']).split('\n').slice(1));
  });

  test('exactly 15 rows, in fixed order', () => {
    expect(rows.map((r) => r.key)).toEqual([
      'scope', 'order', 'roadmap', 'merge', 'pacing', 'ci_capacity', 'budget', 'status_page', 'kaizen_staging',
      'autonomy', 'resource_policy', 'wave_scheduling', 'peers', 'decisions', 'other_config',
    ]);
    expect([...LAUNCH_ROW_KEYS]).toEqual(rows.map((r) => r.key));
  });

  test('every consequence is non-empty and at most 140 chars', () => {
    expect(MAX_CONSEQUENCE_CHARS).toBe(140);
    for (const row of rows) {
      expect(row.consequence.length).toBeGreaterThan(0);
      expect(row.consequence.length).toBeLessThanOrEqual(140);
    }
  });

  test('the Scope counts are the report counts and forge counts', () => {
    const scope = rows[0];
    const q = report.counts.queue;
    expect(scope.value).toContain(`${q.ready} ready`);
    expect(scope.value).toContain(`${q.blocked} blocked`);
    expect(scope.value).toContain(`${q.in_flight} in flight`);
    expect(scope.value).toContain(`${report.forge.openIssues} open issues`);
    expect(scope.value).toContain(`${report.forge.openPrs} open PRs`);
  });

  test('a forge that was not read says so instead of claiming zero', () => {
    const offline = { ...report, forge: { openIssues: 0, openPrs: 0, ok: false, error: 'skipped' } };
    const scope = buildLaunchSummary({ report: offline, config: SAMPLE_CONFIG, budget: panel(SAMPLE_CONFIG, null), statusPage: PAGE })[0];
    expect(scope.value).toContain('forge not read');
    expect(scope.value).not.toContain('0 open PRs');
  });
});

describe('the Budget row', () => {
  const on = (extra: Record<string, unknown> = {}) => ({ parallel_max: 3, usage_budget: { enabled: true, max_workers: 4, ...extra } });
  const usage = (five: number, week: number): RateLimits => ({
    five_hour: { used_percentage: five, resets_at: NOW + 2 * HOUR },
    seven_day: { used_percentage: week, resets_at: NOW + 48 * HOUR },
  });
  const cases: Array<{ name: string; config: Record<string, unknown>; usage: RateLimits | null; value: string[]; consequence: RegExp }> = [
    { name: 'pacing off', config: { parallel_max: 3 }, usage: usage(40, 50), value: ['pacing off', '3 workers (parallel_max)'], consequence: /pacing is off/ },
    { name: 'GO', config: on(), usage: usage(10, 20), value: ['GO', 'workers allowed'], consequence: /starts? now/ },
    { name: 'NO-SPAWN', config: on(), usage: usage(86, 20), value: ['NO-SPAWN', '0 workers allowed'], consequence: /No new worker/ },
    { name: 'STOP-WORKERS (reset time shown)', config: on(), usage: usage(91, 20), value: ['STOP-WORKERS', '0 workers allowed'], consequence: /Fri 13 Nov 11:30 UTC/ },
    { name: 'NO-NEW-STARTS', config: on(), usage: usage(10, 79), value: ['NO-NEW-STARTS'], consequence: /No new chain/ },
    { name: 'STOP-CAMPAIGN', config: on(), usage: usage(10, 81), value: ['STOP-CAMPAIGN'], consequence: /drains and stops/ },
    { name: 'usage null: not probed, parallel_max', config: on(), usage: null, value: ['not probed', '3 workers (parallel_max)'], consequence: /usage not probed.*up to 3 workers \(parallel_max\)/ },
    { name: 'invalid usage_budget: unavailable, never a throw', config: { parallel_max: 3, usage_budget: { enabled: 'yes' } }, usage: usage(10, 20), value: ['unavailable', '3 workers (parallel_max)'], consequence: /invalid/ },
  ];
  for (const c of cases) {
    test(c.name, () => {
      const row = budgetRow(panel(c.config, c.usage), c.config);
      for (const part of c.value) expect(row.value).toContain(part);
      // The four stop thresholds are always carried.
      expect(row.value).toContain('stops 5h 85/90%');
      expect(row.value).toContain('weekly 78/80%');
      if (c.usage) {
        expect(row.value).toContain(`5h ${c.usage.five_hour?.used_percentage}%`);
        expect(row.value).toContain(`weekly ${c.usage.seven_day?.used_percentage}%`);
      }
      expect(row.consequence).toMatch(c.consequence);
      expect(row.consequence.length).toBeLessThanOrEqual(MAX_CONSEQUENCE_CHARS);
    });
  }

  test('a weekly-only plan drops the 5-hour stop from the GO line and the row', () => {
    const weeklyOnly = panel(on(), { seven_day: { used_percentage: 20, resets_at: NOW + 48 * HOUR } });
    expect(weeklyOnly.windows).toEqual(['seven_day']);
    const row = budgetRow(weeklyOnly, on());
    expect(row.value).toStartWith('GO · weekly 20%');
    expect(row.value).toContain('stops weekly 78/80%');
    expect(row.value).not.toContain('5h');
    expect(row.consequence).toMatch(/starts? now; the campaign stops at weekly 80%\.$/);
    expect(row.consequence).not.toContain('spawning stops at 5h');
    // With both windows the 5-hour stop stays on the line.
    expect(budgetRow(panel(on(), usage(10, 20)), on()).consequence).toContain('spawning stops at 5h 85%');
  });

  test('a configured weekly-only plan reads weekly-only before any reading, and keeps the not-probed reason', () => {
    const config = on({ windows: ['seven_day'] });
    const row = budgetRow({ ...NOT_PROBED, reason: 'cursor: no readable usage source' }, config);
    expect(row.value).toContain('not probed: cursor: no readable usage source');
    expect(row.value).toContain('stops weekly 78/80%');
    expect(row.value).not.toContain('5h');
  });

  test('PACE-WAIT names the wait for the weekly target', () => {
    const config = on({ weekly: { target_at_reset: 50 } });
    const b = panel(config, { five_hour: { used_percentage: 10, resets_at: NOW + HOUR }, seven_day: { used_percentage: 20, resets_at: NOW + 160 * HOUR } });
    expect(b.verdict).toBe('PACE-WAIT');
    const row = budgetRow(b, config);
    expect(row.value).toContain('target 50% at weekly reset');
    expect(row.consequence).toBe('The campaign waits until a worker fits the pace that lands on the weekly target at the reset.');
  });

  test('a flat weekly reading says there is no weekly trend yet', () => {
    const row = budgetRow(panel(on(), usage(10, 0)), on());
    expect(row.value).toContain('no weekly trend yet');
    expect(row.value).not.toContain('forecast ');
  });

  test('a weekly window gives a forecast; without one the row says so', () => {
    // 50% used with 3.5 of 7 days left: 0.6%/h, the 80% stop about 50h out.
    const week = { used_percentage: 50, resets_at: NOW + 84 * HOUR };
    const withForecast = budgetRow(panel(on(), { five_hour: { used_percentage: 10, resets_at: NOW + HOUR }, seven_day: week }), on());
    expect(withForecast.value).toContain('forecast 0.6%/h, weekly stop Sun 15 Nov 11:54 UTC');
    const noWeek = budgetRow(panel(on(), { five_hour: { used_percentage: 10, resets_at: NOW + HOUR } }), on());
    expect(noWeek.value).toContain('no forecast yet');
  });
});

describe('the Budget row without a usage limit', () => {
  const usage: RateLimits = { five_hour: { used_percentage: 10, resets_at: NOW + 2 * HOUR }, seven_day: { used_percentage: 20, resets_at: NOW + 48 * HOUR } };
  const budgetCard = (config: Record<string, unknown>, limits: RateLimits | null) => {
    const row = budgetRow(panel(config, limits), config);
    const q = gateCards([row], { printOnly: false })[0].questions[0];
    return { row, q };
  };
  const limitless = [
    { name: 'pacing off', config: { parallel_max: 3 }, limits: usage, reason: /pacing is off/ },
    { name: 'invalid usage_budget', config: { parallel_max: 3, usage_budget: { enabled: 'yes' } }, limits: usage, reason: /usage_budget is invalid/ },
    { name: 'enabled but not probed', config: { parallel_max: 3, usage_budget: { enabled: true } }, limits: null, reason: /usage not probed/ },
  ];
  for (const c of limitless) {
    test(`${c.name}: the consequence opens with "No usage limit:" and keeps the reason and worker count`, () => {
      const { row, q } = budgetCard(c.config, c.limits);
      expect(row.consequence).toStartWith('No usage limit:');
      expect(row.consequence).toMatch(c.reason);
      expect(row.consequence).toMatch(/up to 3 workers \(parallel_max\)/);
      expect(row.consequence.length).toBeLessThanOrEqual(MAX_CONSEQUENCE_CHARS);
      expect(q.question).toStartWith('Budget: No usage limit:');
    });
    test(`${c.name}: Set usage caps comes first and Run with no limit is a labelled choice, never Accept`, () => {
      const { q } = budgetCard(c.config, c.limits);
      expect(q.options.map((o) => o.label)).toEqual(['Set usage caps', 'Run with no limit']);
      for (const o of q.options) expect(o.description.length).toBeGreaterThan(0);
    });
  }
  test('a probed reading with no current window enforces nothing and reads as no limit', () => {
    const config = { parallel_max: 3, usage_budget: { enabled: true } };
    const b = panel(config, {});
    expect(b.verdict).toBe('unavailable');
    const { row, q } = budgetCard(config, {});
    expect(row.consequence).toStartWith('No usage limit: no current usage window');
    expect(row.consequence).toMatch(/up to 3 workers \(parallel_max\)/);
    expect(q.options.map((o) => o.label)).toEqual(['Set usage caps', 'Run with no limit']);
  });
  test('Run with no limit says it leaves usage_budget as it is, true in all three states', () => {
    const { q } = budgetCard({ parallel_max: 3 }, usage);
    expect(q.options[1].description).toContain('as it is');
    expect(q.options[1].description).not.toContain('pacing off');
  });
  test('pacing off keeps the "whatever the usage" clause', () => {
    expect(budgetCard({ parallel_max: 3 }, usage).row.consequence).toContain('whatever the usage');
  });
  test('a limit that is enforced stays Accept / Adjust', () => {
    const config = { parallel_max: 3, usage_budget: { enabled: true } };
    for (const l of [usage, { ...usage, five_hour: { used_percentage: 86, resets_at: NOW + 2 * HOUR } }, { ...usage, five_hour: { used_percentage: 91, resets_at: NOW + 2 * HOUR } }]) {
      const { row, q } = budgetCard(config, l);
      expect(row.consequence).not.toContain('No usage limit');
      expect(q.options.map((o) => o.label)).toEqual(['Accept', 'Adjust']);
    }
  });
  test('the Adjust text names the usage caps', () => {
    const q = gateCards([budgetRow(panel({ parallel_max: 3, usage_budget: { enabled: true } }, usage), { parallel_max: 3, usage_budget: { enabled: true } })], { printOnly: false })[0].questions[0];
    expect(q.options[1].description).toContain('usage caps');
  });
  test('catchup Budget is never "No usage limit"', () => {
    const row = budgetRow({ ...NOT_PROBED }, { parallel_max: 3 }, DEFAULT_USAGE_BUDGET);
    expect(row.consequence).not.toContain('No usage limit');
    expect(row.options).toBeUndefined();
  });
});

describe('usageCapsPatch', () => {
  test("the owner's example: 50% on 5h windows, 80% at reset", () => {
    expect(usageCapsPatch({ enabled: true, stopWorkersAt: 50, targetAtReset: 80 }, {})).toEqual({
      enabled: true,
      five_hour: { no_spawn_at: 45, stop_workers_at: 50 },
      weekly: { target_at_reset: 80 },
    });
  });
  test('merges over existing keys and never drops rates or coordination', () => {
    const current = { max_workers: 2, rates: { worker_pct_per_hour: 9 }, coordination: { role: 'solo', peer_floor: 2 }, five_hour: { custom: 1 }, weekly: { no_new_starts_at: 70 } };
    const out = usageCapsPatch({ enabled: true, stopWorkersAt: 60, targetAtReset: 70 }, current);
    expect(out.max_workers).toBe(2);
    expect(out.rates).toEqual({ worker_pct_per_hour: 9 });
    expect(out.coordination).toEqual({ role: 'solo', peer_floor: 2 });
    expect(out.five_hour).toEqual({ custom: 1, no_spawn_at: 55, stop_workers_at: 60 });
    expect(out.weekly).toEqual({ no_new_starts_at: 70, target_at_reset: 70 });
  });
  test('target none writes target_at_reset null; an absent stop line leaves five_hour alone', () => {
    expect(usageCapsPatch({ enabled: true, stopWorkersAt: null, targetAtReset: null }, {})).toEqual({ enabled: true, weekly: { target_at_reset: null } });
  });
  test('enabled false is written without touching thresholds', () => {
    expect(usageCapsPatch({ enabled: false, stopWorkersAt: null, targetAtReset: undefined }, { five_hour: { no_spawn_at: 40, stop_workers_at: 50 } })).toEqual({ enabled: false, five_hour: { no_spawn_at: 40, stop_workers_at: 50 } });
  });
  test('rejects a stop line the resolver cannot derive a no-spawn line from', () => {
    expect(() => usageCapsPatch({ enabled: true, stopWorkersAt: 5, targetAtReset: null }, {})).toThrow(/stop_workers_at/);
    expect(() => usageCapsPatch({ enabled: true, stopWorkersAt: 101, targetAtReset: null }, {})).toThrow(/stop_workers_at/);
  });
  test('names the pre-existing key that makes the merged block invalid', () => {
    expect(() => usageCapsPatch({ enabled: true, stopWorkersAt: 50, targetAtReset: null }, { max_workers: 0 })).toThrow(/max_workers/);
    expect(() => usageCapsPatch({ enabled: true, stopWorkersAt: null, targetAtReset: 90 }, { weekly: { stop_campaign_at: 80 } })).toThrow(/stop_campaign_at/);
  });
  test('rejects a target outside (0, 100]', () => {
    expect(() => usageCapsPatch({ enabled: true, stopWorkersAt: null, targetAtReset: 0 }, {})).toThrow(/target_at_reset/);
    expect(() => usageCapsPatch({ enabled: true, stopWorkersAt: null, targetAtReset: 101 }, {})).toThrow(/target_at_reset/);
  });
});

describe('gateCards', () => {
  const rows = fullRows();
  const cards = gateCards(rows, { printOnly: false });

  test('at most 4 questions per card, so a full gate yields 2 cards', () => {
    expect(cards).toHaveLength(2);
    for (const card of cards) expect(card.questions.length).toBeLessThanOrEqual(4);
    expect(cards.flatMap((c) => c.questions).map((q) => q.row)).toEqual(['scope', 'merge', 'budget', 'status_page', 'kaizen_staging']);
  });

  test('print-only mode yields no card', () => {
    expect(gateCards(rows, { printOnly: true })).toEqual([]);
  });

  test('display-only rows yield no question', () => {
    const asked = cards.flatMap((c) => c.questions).map((q) => q.row);
    for (const row of rows.filter((r) => !r.adjustable)) expect(asked).not.toContain(row.key);
    expect(asked).not.toContain('order');
    expect(asked).not.toContain('roadmap');
    expect(asked).not.toContain('ci_capacity');
    expect(asked).not.toContain('peers');
    expect(asked).not.toContain('decisions');
  });

  test('every option carries a description (R-003)', () => {
    for (const q of cards.flatMap((c) => c.questions)) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      for (const o of q.options) expect(o.description.length).toBeGreaterThan(0);
    }
  });

  test('every option previews the full summary, so a covering dialog hides nothing', () => {
    const table = renderLaunchSummary(rows);
    for (const q of cards.flatMap((c) => c.questions)) {
      for (const o of q.options) {
        expect(o.preview).toBe(table);
        for (const r of rows) expect(o.preview).toContain(`| ${r.label} |`);
      }
    }
  });

  test('merge_mode unset drops the Accept option (R-002)', () => {
    const config = { ...SAMPLE_CONFIG, merge_mode: undefined };
    const unset = buildLaunchSummary({ report, config, budget: panel(config, USAGE), statusPage: PAGE });
    const merge = gateCards(unset, { printOnly: false }).flatMap((c) => c.questions).find((q) => q.row === 'merge');
    expect(merge?.options.map((o) => o.label)).toEqual(['Immediate', 'Gated batch', 'Leave open']);
    const set = cards.flatMap((c) => c.questions).find((q) => q.row === 'merge');
    expect(set?.options.map((o) => o.label)).toEqual(['Accept', 'Adjust']);
  });
});

describe('buildBudgetPanel is the one budget builder under campaign-status/', () => {
  const dir = import.meta.dir;
  // A name in a comment is not a call.
  const stripComments = (text: string): string => text.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const sources = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ file: f, text: stripComments(fs.readFileSync(path.join(dir, f), 'utf-8')) }));
  // The top-level declaration each call sits in: the nearest one starting at column 0 above it.
  const enclosing = (text: string, index: number): string => {
    const names = [...text.slice(0, index).matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=)/gm)];
    const last = names.at(-1);
    return last ? (last[1] ?? last[2]) : '<top level>';
  };
  const callers = (fn: string): string[] =>
    sources.flatMap(({ file, text }) => [...text.matchAll(new RegExp(`\\b${fn}\\s*\\(`, 'g'))].map((m) => `${file}:${enclosing(text, m.index as number)}`));

  test('workersAllowed and forecastWeekly are each called once, from the panel builder', () => {
    expect(callers('workersAllowed')).toEqual(['budget.ts:verdictFor']);
    expect(callers('forecastWeekly')).toEqual(['budget.ts:buildBudgetPanel']);
  });

  test('no second function builds a BudgetPanel', () => {
    const builders = sources.flatMap(({ file, text }) => [...text.matchAll(/function\s+(\w+)\s*\((?:(?!function\b)[^])*?\)\s*:\s*BudgetPanel\s*\{/g)].map((m) => `${file}:${m[1]}`));
    expect(builders.sort()).toEqual(['budget.ts:buildBudgetPanel', 'budget.ts:givenBudgetPanel', 'budget.ts:readBudgetPanel']);
  });
});

describe('the catchup launch summary', () => {
  const EXPECTED_CATCHUP = path.join(FIXTURES, 'full', 'launch-summary.catchup.expected.md');
  const fileReport = (): UsageReport => {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'full/usage.catchup.json'), 'utf-8')) as { plan: UsageReport['plan']; windows: UsageReport['windows'] };
    return { plan: raw.plan, windows: raw.windows, extra_usage: null, source: 'usage-file', provider: 'usage-file', read_at: NOW, reason: null };
  };
  const input = (over: { report?: UsageReport; overrides?: Parameters<typeof applyOverrides>[1] } = {}): Extract<CatchupInput, { preset: unknown }> => {
    const preset = applyOverrides(DEFAULT_CATCHUP, over.overrides ?? {});
    const pacing = readPacing(over.report ?? fileReport(), preset, NOW);
    const floorPct = over.overrides?.floor_pct ?? pacing.floor_pct;
    return { preset, floorPct, pacing, budget: floorBudget(DEFAULT_USAGE_BUDGET, preset, floorPct ?? 100) };
  };
  // The same reading as `usage.catchup.json`, so the Budget row agrees with the Pacing row.
  const CATCHUP_LIMITS: RateLimits = { five_hour: USAGE.five_hour, seven_day: { used_percentage: 30, resets_at: NOW + 72 * HOUR } };
  const rowsFor = (catchup: CatchupInput, limits: RateLimits | null = CATCHUP_LIMITS): LaunchRow[] => {
    const budget = 'budget' in catchup ? catchup.budget : undefined;
    const b = limits ? buildBudgetPanel({ limits, reason: null, ageSeconds: 0, now: NOW, config: SAMPLE_CONFIG, budget }) : { ...NOT_PROBED, reason: 'no usage' };
    return buildLaunchSummary({ report, config: SAMPLE_CONFIG, budget: b, statusPage: PAGE, catchup, queue: state.queue });
  };
  const rows = rowsFor(input());
  const pacingOf = (r: LaunchRow[]) => r.find((x) => x.key === 'pacing') as LaunchRow;

  test('the run summary is untouched: still the committed run fixture', () => {
    expect(renderLaunchSummary(fullRows())).toBe(fs.readFileSync(EXPECTED, 'utf-8'));
  });

  test('15 rows in LAUNCH_ROW_KEYS order, the same keys as a run', () => {
    expect(rows.map((r) => r.key)).toEqual([...LAUNCH_ROW_KEYS]);
    expect(rows.map((r) => r.key)).toEqual(fullRows().map((r) => r.key));
  });

  test('Pacing shows the floor and the shortfall, Budget the 5h caps; equals the committed fixture', () => {
    expect(pacingOf(rows).value).toContain('floor 45.71% (96 h / 168 h x 80%)');
    expect(pacingOf(rows).value).toContain('shortfall 15.71%');
    expect(pacingOf(rows).value).toContain('lane unset');
    expect(rows.find((r) => r.key === 'budget')?.value).toContain('5h 75/80');
    expect(renderLaunchSummary(rows)).toBe(fs.readFileSync(EXPECTED_CATCHUP, 'utf-8'));
  });

  test('every catchup consequence is non-empty and at most 140 chars', () => {
    const none: UsageReport = { ...fileReport(), source: 'none', windows: [], reason: 'cache missing' };
    const fiveOnly: UsageReport = { ...fileReport(), windows: fileReport().windows.filter((w) => w.name === 'five_hour') };
    const over: UsageReport = { ...fileReport(), windows: [{ name: 'seven_day', used_pct: 90, resets_at: NOW + 72 * HOUR }] };
    const all = [
      rows,
      rowsFor(input({ report: none }), null),
      rowsFor(input({ report: fiveOnly }), { five_hour: USAGE.five_hour }),
      rowsFor(input({ report: over }), { seven_day: { used_percentage: 90, resets_at: NOW + 72 * HOUR } }),
      rowsFor({ invalid: 'catchup.lane must be null or a name' }),
    ];
    for (const r of all) for (const row of r) {
      expect(row.consequence.length).toBeGreaterThan(0);
      expect(row.consequence.length).toBeLessThanOrEqual(MAX_CONSEQUENCE_CHARS);
    }
    expect(pacingOf(all[3]).consequence).toContain('at or above the floor');
    expect(pacingOf(all[4]).consequence).toContain('invalid');
  });

  test('gate cards: Pacing is adjustable, Order, Roadmap, CI capacity, Peers and Decisions are not, 4 per card; print-only asks nothing', () => {
    const cards = gateCards(rows, { printOnly: false });
    const asked = cards.flatMap((c) => c.questions).map((q) => q.row);
    expect(asked).toEqual(['scope', 'merge', 'pacing', 'budget', 'status_page', 'kaizen_staging']);
    for (const c of cards) expect(c.questions.length).toBeLessThanOrEqual(4);
    expect(gateCards(rows, { printOnly: true })).toEqual([]);
  });

  test('overrides: floor 80 and 5h caps 70/80 show on the rows and leave the preset alone', () => {
    const before = structuredClone(DEFAULT_CATCHUP);
    const r = rowsFor(input({ overrides: { floor_pct: 80, no_spawn_at: 70 } }));
    expect(pacingOf(r).value).toContain('floor 80%');
    expect(pacingOf(r).value).toContain('5h caps 70/80');
    expect(r.find((x) => x.key === 'budget')?.value).toContain('weekly 80%');
    expect(DEFAULT_CATCHUP).toEqual(before);
  });

  test('unreadable usage: Pacing and Budget both say fail-closed', () => {
    const none: UsageReport = { ...fileReport(), source: 'none', windows: [], reason: 'cache missing' };
    const r = rowsFor(input({ report: none }), null);
    expect(pacingOf(r).consequence).toContain('fail-closed');
    expect(r.find((x) => x.key === 'budget')?.consequence).toContain('the catchup skips');
  });
});

describe('Peers row with peer detection', () => {
  const peer = (over: Partial<DetectedPeer> = {}): DetectedPeer => ({
    session: 'a1b2c3d4-0000-4000-8000-000000000001',
    worktree: '/repo/.claude/worktrees/other',
    host: 'box',
    host_session: null,
    role: 'solo',
    manager_session: null,
    turn: 12,
    heartbeat_at: NOW_ISO,
    heartbeat_age_minutes: 5,
    claims: [1240],
    names_me: false,
    coordinated: false,
    ...over,
  });
  const rowFor = (peers: DetectResult | undefined, config = SAMPLE_CONFIG) =>
    buildLaunchSummary({ report, config, budget: panel(config, USAGE), statusPage: PAGE, peers }).find((r) => r.key === 'peers') as LaunchRow;
  const askedPeers = (row: LaunchRow) =>
    gateCards([row], { printOnly: false }).flatMap((c) => c.questions).find((q) => q.row === 'peers');

  test('no detection keeps the configured role text', () => {
    expect(rowFor(undefined).value).toBe('solo');
    expect(rowFor(undefined).adjustable).toBe(false);
  });

  test('a clean detection states its reach, never a bare solo', () => {
    const row = rowFor({ verdict: 'solo', reach: 'clone', unreadable: 0, unreadable_files: [], peers: [] });
    expect(row.value).toBe('solo (no live peer in this clone)');
    expect(row.adjustable).toBe(false);
  });

  test('a live peer names its worktree, turn and heartbeat age, and the gate asks', () => {
    const row = rowFor({ verdict: 'peers', reach: 'clone', unreadable: 0, unreadable_files: [], peers: [peer()] });
    expect(row.value).toBe('1 live peer in this clone: other (turn 12, heartbeat 5m ago)');
    expect(row.consequence).toContain('never starts as solo');
    expect(row.consequence.length).toBeLessThanOrEqual(MAX_CONSEQUENCE_CHARS);
    expect(askedPeers(row)?.options.map((o) => o.label)).toEqual(['Stop', 'Take over after drain']);
  });

  test('join as peer is offered only when a live peer has a host_session', () => {
    const row = rowFor({ verdict: 'peers', reach: 'clone', unreadable: 0, unreadable_files: [], peers: [peer({ host_session: 'session_x' })] });
    const options = askedPeers(row)?.options ?? [];
    expect(options.map((o) => o.label)).toEqual(['Stop', 'Join as peer', 'Take over after drain']);
    expect(options[1].description).toContain('session_x');
    for (const o of options) expect(o.description.length).toBeGreaterThan(0);
  });

  test('print-only mode still asks nothing', () => {
    const row = rowFor({ verdict: 'peers', reach: 'clone', unreadable: 0, unreadable_files: [], peers: [peer()] });
    expect(gateCards([row], { printOnly: true })).toEqual([]);
  });

  test('a peer that names this solo session as its manager is coordinated: no question, act as manager', () => {
    const row = rowFor({ verdict: 'peers', reach: 'clone', unreadable: 0, unreadable_files: [], peers: [peer({ role: 'peer', names_me: true, coordinated: true })] });
    expect(row.adjustable).toBe(false);
    expect(row.value).toBe('manager of 1 live peer in this clone: other');
    expect(row.consequence).toContain('grants worker slots');
  });

  test('the manager this peer joined is coordinated: no question', () => {
    const config = { ...SAMPLE_CONFIG, usage_budget: { enabled: true, coordination: { role: 'peer', manager_session: 'session_x' } } };
    const row = rowFor({ verdict: 'peers', reach: 'clone', unreadable: 0, unreadable_files: [], peers: [peer({ host_session: 'session_x', role: 'manager', coordinated: true })] }, config);
    expect(row.adjustable).toBe(false);
    expect(row.value).toBe('peer of session_x');
  });
  test('join targets the manager, not the first peer listed', () => {
    const solo = peer({ session: 'a0000000-0000-4000-8000-000000000001', host_session: 'session_solo' });
    const mgr = peer({ session: 'c0000000-0000-4000-8000-000000000003', worktree: '/repo/wt-mgr', role: 'manager', host_session: 'session_mgr' });
    const options = askedPeers(rowFor({ verdict: 'peers', reach: 'clone', unreadable: 0, unreadable_files: [], peers: [solo, mgr] }))?.options ?? [];
    expect(options.find((o) => o.label === 'Join as peer')?.description).toContain('session_mgr');
  });

  test('unreadable records fail closed: unknown, and the gate asks stop or take over', () => {
    const row = rowFor({ verdict: 'unknown', reach: 'clone', unreadable: 2, unreadable_files: ['a.json', 'b.json'], peers: [] });
    expect(row.value).toBe('unknown (2 unreadable: a.json, b.json)');
    expect(row.consequence.length).toBeLessThanOrEqual(MAX_CONSEQUENCE_CHARS);
    expect(askedPeers(row)?.options.map((o) => o.label)).toEqual(['Stop', 'Take over after drain']);
  });

  test('unreadable records beside a live peer are named after it', () => {
    const row = rowFor({ verdict: 'peers', reach: 'clone', unreadable: 1, unreadable_files: ['x.json'], peers: [peer()] });
    expect(row.value).toBe('1 live peer in this clone: other (turn 12, heartbeat 5m ago); 1 unreadable: x.json');
  });

  test('unreadable records with only coordinated peers still ask', () => {
    const row = rowFor({ verdict: 'peers', reach: 'clone', unreadable: 1, unreadable_files: ['x.json'], peers: [peer({ role: 'peer', names_me: true, coordinated: true })] });
    expect(row.adjustable).toBe(true);
    expect(row.value).toBe('unknown (1 unreadable: x.json)');
  });
  test('a manager with a coordinated peer is never offered to join itself when a newcomer arrives', () => {
    const config = { ...SAMPLE_CONFIG, usage_budget: { enabled: true, coordination: { role: 'manager' } } };
    const mine = peer({ session: 'b0000000-0000-4000-8000-000000000002', role: 'peer', host_session: 'session_sub', manager_session: 'session_me', names_me: true, coordinated: true });
    const newcomer = peer({ session: 'd0000000-0000-4000-8000-000000000004', worktree: '/repo/wt-new' });
    const row = rowFor({ verdict: 'peers', reach: 'clone', unreadable: 0, unreadable_files: [], peers: [mine, newcomer] }, config);
    expect(askedPeers(row)?.options.map((o) => o.label)).toEqual(['Stop', 'Take over after drain']);
    expect(row.value).toBe('1 live peer in this clone: wt-new (turn 12, heartbeat 5m ago)');
  });

  test('no Join while a live peer runs as peer of this session: joining would orphan its slot requests', () => {
    const mine = peer({ session: 'b0000000-0000-4000-8000-000000000002', role: 'peer', host_session: 'session_sub', manager_session: 'session_me', names_me: true, coordinated: true });
    const newcomer = peer({ session: 'd0000000-0000-4000-8000-000000000004', worktree: '/repo/wt-new', host_session: 'session_new' });
    const row = rowFor({ verdict: 'peers', reach: 'clone', unreadable: 0, unreadable_files: [], peers: [mine, newcomer] });
    expect(askedPeers(row)?.options.map((o) => o.label)).toEqual(['Stop', 'Take over after drain']);
  });

  test('no Join when no open peer can be joined, even if a coordinated one could', () => {
    const joined = peer({ session: 'c0000000-0000-4000-8000-000000000003', role: 'manager', host_session: 'session_mgr', coordinated: true });
    const open = peer({ session: 'd0000000-0000-4000-8000-000000000004', worktree: '/repo/wt-new' });
    const row = rowFor({ verdict: 'peers', reach: 'clone', unreadable: 0, unreadable_files: [], peers: [joined, open] });
    expect(askedPeers(row)?.options.map((o) => o.label)).toEqual(['Stop', 'Take over after drain']);
  });

  test('more than three unreadable files are named three and counted', () => {
    const files = ['a.json', 'b.json', 'c.json', 'd.json'];
    const row = rowFor({ verdict: 'unknown', reach: 'clone', unreadable: 4, unreadable_files: files, peers: [] });
    expect(row.value).toBe('unknown (4 unreadable: a.json, b.json, c.json, …)');
  });
});
