import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import type { RateLimits } from '../pace-gate.ts';
import { buildBudgetView } from './budget.ts';
import {
  budgetRow,
  buildLaunchSummary,
  gateCards,
  LAUNCH_ROW_KEYS,
  MAX_CONSEQUENCE_CHARS,
  renderLaunchSummary,
  statusPageRow,
  type LaunchRow,
  type StatusPageInput,
} from './launch-summary.ts';
import { buildStatusReport } from './report.ts';
import { loadCampaignState } from './state.ts';
import type { ForgeCounts, PrSignal } from './types.ts';

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
  buildLaunchSummary({ report, config: SAMPLE_CONFIG, budget: buildBudgetView({ config: SAMPLE_CONFIG, usage: USAGE, now: NOW }), statusPage: PAGE });

describe('the launch summary of the full fixture', () => {
  const rows = fullRows();

  test('renders the committed expected markdown', () => {
    expect(renderLaunchSummary(rows)).toBe(fs.readFileSync(EXPECTED, 'utf-8'));
  });

  test('exactly seven rows, in fixed order', () => {
    expect(rows.map((r) => r.key)).toEqual(['scope', 'order', 'merge', 'budget', 'status_page', 'kaizen_staging', 'peers']);
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
    const scope = buildLaunchSummary({ report: offline, config: SAMPLE_CONFIG, budget: buildBudgetView({ config: SAMPLE_CONFIG, usage: null, now: NOW }), statusPage: PAGE })[0];
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
  const cases: Array<{ name: string; config: Record<string, unknown>; usage: RateLimits | null; verdict: string; value: string[]; consequence: RegExp }> = [
    { name: 'pacing off', config: { parallel_max: 3 }, usage: usage(40, 50), verdict: 'off', value: ['pacing off', '3 workers'], consequence: /pacing is off/ },
    { name: 'GO', config: on(), usage: usage(10, 20), verdict: 'GO', value: ['GO', 'workers allowed'], consequence: /starts? now/ },
    { name: 'NO-SPAWN', config: on(), usage: usage(86, 20), verdict: 'NO-SPAWN', value: ['NO-SPAWN', '0 workers allowed'], consequence: /No new worker/ },
    { name: 'STOP-WORKERS', config: on(), usage: usage(91, 20), verdict: 'STOP-WORKERS', value: ['STOP-WORKERS', '0 workers allowed'], consequence: /2026-11-13 11:30Z/ },
    { name: 'NO-NEW-STARTS', config: on(), usage: usage(10, 79), verdict: 'NO-NEW-STARTS', value: ['NO-NEW-STARTS'], consequence: /No new chain/ },
    { name: 'STOP-CAMPAIGN', config: on(), usage: usage(10, 81), verdict: 'STOP-CAMPAIGN', value: ['STOP-CAMPAIGN'], consequence: /drains and stops/ },
    { name: 'usage null', config: on(), usage: null, verdict: 'unavailable', value: ['not probed', '3 workers'], consequence: /parallel_max \(3\)/ },
  ];
  for (const c of cases) {
    test(c.name, () => {
      const view = buildBudgetView({ config: c.config, usage: c.usage, now: NOW });
      expect(view.verdict).toBe(c.verdict);
      const row = budgetRow(view);
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

  test('a forecast with two or more samples names when the weekly stop is reached; without, it says none', () => {
    const samples = [
      { at: NOW - 2 * HOUR, used_percentage: 18 },
      { at: NOW, used_percentage: 20 },
    ];
    const withForecast = budgetRow(buildBudgetView({ config: on(), usage: usage(10, 20), now: NOW, samples }));
    expect(withForecast.value).toContain('forecast 1%/h, weekly stop 2026-11-15 21:30Z');
    const oneSample = budgetRow(buildBudgetView({ config: on(), usage: usage(10, 20), now: NOW, samples: samples.slice(1) }));
    expect(oneSample.value).toContain('no forecast yet');
  });
});

describe('the Status page row', () => {
  const at = (minutesAgo: number) => new Date(Date.parse(NOW_ISO) - minutesAgo * 60_000).toISOString();
  const page = (over: Partial<StatusPageInput>): StatusPageInput => ({ ...PAGE, ...over });

  test('disabled', () => {
    const row = statusPageRow(page({ enabled: false }));
    expect(row.value).toBe('off (status_page.enabled is false)');
    expect(row.consequence).toBe('No page is published; follow the run with bun run status.');
    expect(row.probe_needed).toBeUndefined();
  });

  test('the host publishes none', () => {
    const row = statusPageRow(page({ publishExpected: false }));
    expect(row.value).toBe('none on this host');
    expect(row.consequence).toBe('This host has no artifact tool; follow the run with bun run status.');
    expect(row.adjustable).toBe(false);
  });

  test('never published', () => {
    const row = statusPageRow(page({ artifact: null }));
    expect(row.value).toBe('never published');
    expect(row.consequence).toBe('A new page is published before the first spawn.');
    expect(row.probe_needed).toBeUndefined();
  });

  test('probe ok and fresh (under 10 min)', () => {
    const row = statusPageRow(page({ artifact: { url: URL, template_version: 4, last_probe: { at: at(9), ok: true, url: URL } } }));
    expect(row.value).toBe(`${URL} · reachable (probed 9 min ago) · template v4`);
    expect(row.consequence).toBe('The stored page opens from this account and is refreshed at every checkpoint.');
    expect(row.options?.map((o) => o.label)).toEqual(['Accept', 'Reuse another', 'Publish new']);
    expect(row.probe_needed).toBeUndefined();
  });

  test('probe failed: offers reuse-another or publish-new', () => {
    const row = statusPageRow(page({ artifact: { url: URL, template_version: 4, last_probe: { at: at(2), ok: false, url: URL, reason: 'not found' } } }));
    expect(row.value).toBe(`${URL} · NOT reachable: not found · template v4`);
    expect(row.consequence).toBe('The stored page does not open from this account: reuse another artifact or publish a new one.');
    expect(row.options?.map((o) => o.label)).toEqual(['Reuse another', 'Publish new']);
  });

  test('not probed: carries probe_needed.url (no probe, an old probe, or a probe of another URL)', () => {
    for (const last_probe of [undefined, { at: at(11), ok: true, url: URL }, { at: at(1), ok: true, url: 'https://claude.ai/code/artifact/other' }]) {
      const row = statusPageRow(page({ artifact: { url: URL, template_version: 4, last_probe } }));
      expect(row.value).toBe(`${URL} · not probed · template v4`);
      expect(row.probe_needed).toEqual({ url: URL });
      expect(row.consequence).toBe('Probe the stored page (ArtifactData list of datasets) and re-run the summary before the first spawn.');
    }
  });

  test("stale template: adds 'refresh template'", () => {
    const row = statusPageRow(page({ artifact: { url: URL, template_version: 3, last_probe: { at: at(1), ok: true, url: URL } } }));
    expect(row.value).toBe(`${URL} · reachable (probed 1 min ago) · template v3, refresh template to v4`);
    expect(row.options?.map((o) => o.label)).toEqual(['Accept', 'Reuse another', 'Publish new', 'Refresh template']);
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
  });

  test('every option carries a description (R-003)', () => {
    for (const q of cards.flatMap((c) => c.questions)) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      for (const o of q.options) expect(o.description.length).toBeGreaterThan(0);
    }
  });

  test('merge_mode unset drops the Accept option (R-002)', () => {
    const config = { ...SAMPLE_CONFIG, merge_mode: undefined };
    const unset = buildLaunchSummary({ report, config, budget: buildBudgetView({ config, usage: USAGE, now: NOW }), statusPage: PAGE });
    const merge = gateCards(unset, { printOnly: false }).flatMap((c) => c.questions).find((q) => q.row === 'merge');
    expect(merge?.options.map((o) => o.label)).toEqual(['Immediate', 'Gated batch', 'Leave open']);
    const set = cards.flatMap((c) => c.questions).find((q) => q.row === 'merge');
    expect(set?.options.map((o) => o.label)).toEqual(['Accept', 'Adjust']);
  });
});

describe('buildBudgetView is the one caller of the pacing gate under campaign-status/', () => {
  test('source scan', () => {
    const dir = import.meta.dir;
    const callers = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => /\b(workersAllowed|forecastWeekly)\s*\(/.test(fs.readFileSync(path.join(dir, f), 'utf-8')));
    expect(callers).toEqual(['budget.ts']);
  });
});
