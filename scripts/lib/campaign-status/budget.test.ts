import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { budgetRows, buildBudgetPanel, NOT_PROBED, readBudgetPanel } from './budget.ts';
import { formatDashboard } from './dashboard.ts';
import { buildStatusData } from './data.ts';
import { fixtureReport } from './data-fixture.ts';
import { renderStatusHtml } from './html.ts';

const NOW = 1_800_000_000; // 2027-01-15T08:00:00Z
const HOUR = 3600;
const WEEK = 7 * 24 * HOUR;
const enabled = (weekly: Record<string, unknown> = {}) => ({ parallel_max: 4, usage_budget: { enabled: true, weekly } });
const lines = (panel: ReturnType<typeof buildBudgetPanel>): string[] => budgetRows(panel).map((r) => `${r.key}: ${r.value}`);

describe('buildBudgetPanel', () => {
  it('weekly only (no five_hour window): no 5-hour row, weekly %, reset, workers and a forecast', () => {
    // Half the week gone at 40%: 40/84 = 0.476 %/h, so 78% lands 79.8h out (before the reset, 84h out) and 80% after it.
    const limits = { seven_day: { used_percentage: 40, resets_at: NOW + WEEK / 2 } };
    const panel = buildBudgetPanel({ limits, reason: null, ageSeconds: 120, now: NOW, config: enabled() });
    expect(panel.probed).toBe(true);
    expect(panel.five_hour_pct).toBeNull();
    expect(panel.weekly_pct).toBe(40);
    expect(panel.resets_at).toBe(new Date((NOW + WEEK / 2) * 1000).toISOString());
    // No target, no five_hour window: the weekly lines gate and max_workers caps the round.
    expect(panel.verdict).toBe('GO');
    expect(panel.workers_allowed).toBe(4);
    expect(panel.windows).toEqual(['seven_day']);
    expect(panel.forecast?.pct_per_hour).toBeCloseTo(40 / 84, 6);
    expect(panel.forecast?.reaches.map((r) => [r.pct, r.at !== null])).toEqual([[78, true], [80, false]]);
    const text = lines(panel);
    expect(text.some((l) => l.startsWith('5-hour'))).toBe(false);
    expect(text).toContain('Weekly: 40% · resets Mon 18 Jan 20:00 UTC');
    expect(text).toContain('Forecast: weekly 80% not reached before the reset (0.48%/h)');
    expect(text.find((l) => l.startsWith('Forecast'))).toMatch(/^Forecast: weekly 78% reached around \w{3} \d{2} \w{3} \d{2}:\d{2} UTC \(0\.48%\/h\)$/);
    expect(text).toContain('Usage reading: 2 min old');
    expect(text).toContain('Usage windows: weekly (rate-limit-cache)');
  });

  it('weekly target: the weekly leg sizes the round and both lines collapse to one forecast row', () => {
    const limits = { seven_day: { used_percentage: 20, resets_at: NOW + 72 * HOUR } };
    const panel = buildBudgetPanel({ limits, reason: null, ageSeconds: 5, now: NOW, config: enabled({ target_at_reset: 90 }) });
    // (90-20)/72 = 0.972 %/h; (0.972-0.1)/0.15 = 5.8 -> 5, clamped to max_workers 4.
    expect(panel.verdict).toBe('GO');
    expect(panel.workers_allowed).toBe(4);
    // 20% over 96h is 0.21%/h: 90% is not reached before the reset; both lines equal the target, so one row.
    expect(panel.forecast?.reaches).toEqual([{ pct: 90, at: null }]);
    expect(lines(panel)).toContain('Workers allowed: 4 (GO: 5 workers fit the weekly pace to 90% at reset)');
    expect(lines(panel).find((l) => l.startsWith('Forecast'))).toBe('Forecast: weekly 90% not reached before the reset (0.21%/h)');
  });

  it('both windows: the 5-hour row is shown with its reset', () => {
    const limits = { five_hour: { used_percentage: 30, resets_at: NOW + 2 * HOUR }, seven_day: { used_percentage: 10, resets_at: NOW + 100 * HOUR } };
    const panel = buildBudgetPanel({ limits, reason: null, ageSeconds: 0, now: NOW, config: enabled() });
    expect(panel.five_hour_pct).toBe(30);
    expect(lines(panel)).toContain('5-hour: 30% · resets Fri 15 Jan 10:00 UTC');
    expect(lines(panel)).toContain('Usage windows: 5-hour, weekly (rate-limit-cache)');
    expect(panel.verdict).toBe('GO');
  });

  it('usage_budget disabled: the reading shows, the verdict is what the CLI returns', () => {
    const limits = { seven_day: { used_percentage: 10, resets_at: NOW + 100 * HOUR } };
    const panel = buildBudgetPanel({ limits, reason: null, ageSeconds: 0, now: NOW, config: { parallel_max: 3 } });
    expect(panel).toMatchObject({ probed: true, weekly_pct: 10, verdict: 'unavailable', workers_allowed: 3, verdict_reasons: ['usage_budget disabled'] });
  });

  it('an invalid usage_budget block does not crash the page', () => {
    const limits = { seven_day: { used_percentage: 10, resets_at: NOW + 100 * HOUR } };
    const panel = buildBudgetPanel({ limits, reason: null, ageSeconds: 0, now: NOW, config: { usage_budget: { enabled: 'yes' } } });
    expect(panel.verdict).toBe('unavailable');
    expect(panel.verdict_reasons[0]).toMatch(/^usage_budget config invalid: usage_budget\.enabled must be a boolean/);
  });

  it('no usage record: "usage not probed" with the reason, every number null', () => {
    const panel = buildBudgetPanel({ limits: null, reason: 'no rate-limit cache at /x', ageSeconds: null, now: NOW, config: enabled() });
    expect(panel).toEqual({ ...NOT_PROBED, reason: 'no rate-limit cache at /x' });
    expect(lines(panel)).toEqual(['Usage: usage not probed — no rate-limit cache at /x']);
  });
});

describe('readBudgetPanel', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-panel-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads the rate-limit cache the config names, with its age', () => {
    const cache = path.join(dir, 'rate-limits.json');
    fs.writeFileSync(cache, JSON.stringify({ rate_limits: { seven_day: { used_percentage: 21, resets_at: NOW + 50 * HOUR } } }));
    fs.utimesSync(cache, NOW - 90, NOW - 90);
    const panel = readBudgetPanel({ resource_policy: { pace: { cache_path: cache } } }, 'claude', NOW);
    expect(panel).toMatchObject({ probed: true, weekly_pct: 21, five_hour_pct: null, age_seconds: 90 });
  });

  it('no cache file: not probed', () => {
    const cache = path.join(dir, 'missing.json');
    const panel = readBudgetPanel({ resource_policy: { pace: { cache_path: cache } } }, 'claude', NOW);
    expect(panel.probed).toBe(false);
    expect(panel.reason).toBe(`no rate-limit cache at ${cache}`);
  });

  it('cursor: not probed, with the reason no usage source is readable there', () => {
    const cache = path.join(dir, 'rate-limits.json');
    fs.writeFileSync(cache, JSON.stringify({ rate_limits: { seven_day: { used_percentage: 21, resets_at: NOW + 50 * HOUR } } }));
    fs.utimesSync(cache, NOW, NOW);
    const panel = readBudgetPanel({ resource_policy: { pace: { cache_path: cache } } }, 'cursor', NOW);
    expect(panel.probed).toBe(false);
    expect(panel.reason).toContain('cursor: no readable usage source');
  });
});

describe('the weekly target', () => {
  it('a configured target_at_reset is a row after the weekly one, probed or not', () => {
    const config = enabled({ target_at_reset: 70 });
    const limits = { seven_day: { used_percentage: 40, resets_at: NOW + WEEK / 2 } };
    const probed = buildBudgetPanel({ limits, reason: null, ageSeconds: 0, now: NOW, config });
    expect(probed.target_at_reset).toBe(70);
    const text = lines(probed);
    expect(text.indexOf('Weekly target: 70% at the weekly reset')).toBe(text.findIndex((l) => l.startsWith('Weekly:')) + 1);
    const unprobed = buildBudgetPanel({ limits: null, reason: 'no cache', ageSeconds: null, now: NOW, config });
    expect(lines(unprobed)).toEqual(['Usage: usage not probed — no cache', 'Weekly target: 70% at the weekly reset']);
  });

  it('no target, or an invalid usage_budget, shows no target row', () => {
    for (const config of [enabled(), { usage_budget: { weekly: { target_at_reset: 'high' } } }]) {
      const panel = buildBudgetPanel({ limits: null, reason: null, ageSeconds: null, now: NOW, config });
      expect(panel.target_at_reset).toBeNull();
      expect(lines(panel).some((l) => l.startsWith('Weekly target'))).toBe(false);
    }
  });
});

describe('the budget panel on every surface', () => {
  const probed = buildBudgetPanel({
    limits: { seven_day: { used_percentage: 40, resets_at: NOW + WEEK / 2 } },
    reason: null,
    ageSeconds: 60,
    now: NOW,
    config: enabled(),
  });

  it('a report built without a usage record says "usage not probed"', () => {
    const report = fixtureReport();
    expect(report.budget).toEqual(NOT_PROBED);
    expect(renderStatusHtml(report)).toContain('usage not probed');
    expect(buildStatusData(report).budget).toEqual([{ key: 'Usage', value: `usage not probed — ${NOT_PROBED.reason}` }]);
  });

  it('text dashboard, --html and the data rows carry the same lines', () => {
    const report = { ...fixtureReport(), budget: probed };
    const text = formatDashboard({ checkpoint: {}, queue: { issues: {} }, ledger: {}, forge: { openIssues: 0, openPrs: 0, ok: true }, view: report });
    expect(text).toContain('### Usage budget');
    expect(text).toContain('- **Weekly:** 40% · resets Mon 18 Jan 20:00 UTC');
    expect(text).toMatch(/- \*\*Forecast:\*\* weekly 78% reached around /);
    const html = renderStatusHtml(report);
    expect(html).toContain('Usage budget');
    expect(html).toContain('Weekly: 40% · resets Mon 18 Jan 20:00 UTC');
    expect(buildStatusData(report).budget).toEqual(budgetRows(probed));
  });
});
