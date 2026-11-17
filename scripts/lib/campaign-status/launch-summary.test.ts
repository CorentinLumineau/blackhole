import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import type { RateLimits } from '../rate-limit-cache.ts';
import { buildBudgetPanel, NOT_PROBED } from './budget.ts';
import {
  budgetRow,
  buildLaunchSummary,
  gateCards,
  LAUNCH_ROW_KEYS,
  MAX_CONSEQUENCE_CHARS,
  renderLaunchSummary,
  type LaunchRow,
} from './launch-summary.ts';
import { buildStatusReport } from './report.ts';
import type { StatusPageInput } from './status-page-row.ts';
import { loadCampaignState } from './state.ts';
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
  buildLaunchSummary({ report, config: SAMPLE_CONFIG, budget: panel(SAMPLE_CONFIG, USAGE), statusPage: PAGE });

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

  test('exactly eight rows, in fixed order', () => {
    expect(rows.map((r) => r.key)).toEqual(['scope', 'order', 'merge', 'budget', 'status_page', 'kaizen_staging', 'peers', 'sleep']);
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
    { name: 'usage null: not probed, parallel_max', config: on(), usage: null, value: ['not probed', '3 workers (parallel_max)'], consequence: /parallel_max \(3\)/ },
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
    expect(asked).not.toContain('peers');
    expect(asked).not.toContain('sleep');
  });

  test('every option carries a description (R-003)', () => {
    for (const q of cards.flatMap((c) => c.questions)) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      for (const o of q.options) expect(o.description.length).toBeGreaterThan(0);
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
