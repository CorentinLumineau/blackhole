import { describe, expect, test } from 'bun:test';
import { UsageFileError, ccdRowsToWindows, normalizeUsagePayload } from './usage-normalize.ts';

const NOW = 1_800_000_000;
const HOUR = 3600;
const normalized = {
  plan: 'max',
  extra_usage: { enabled: true, currency: 'USD' },
  read_at: NOW - 5,
  windows: [
    { name: 'five_hour', used_pct: 40, resets_at: NOW + 2 * HOUR },
    { name: 'seven_day', used_pct: 30, resets_at: NOW + 90 * HOUR },
    { name: 'seven_day_opus', used_pct: 12.5, resets_at: NOW + 90 * HOUR },
  ],
};

describe('normalizeUsagePayload', () => {
  test('a normalized payload keeps plan, windows, extra_usage and read_at', () => {
    expect(normalizeUsagePayload(normalized)).toEqual({
      plan: 'max',
      windows: normalized.windows,
      extra_usage: { enabled: true, currency: 'USD' },
      read_at: NOW - 5,
    });
  });

  test('a desktop-shaped payload converts utilization (0-1) and an ISO resetsAt', () => {
    const iso = new Date((NOW + 90 * HOUR) * 1000).toISOString();
    const r = normalizeUsagePayload({ plan: 'Claude Pro', seven_day: { utilization: 0.09, resetsAt: iso }, extra_usage: { is_enabled: false } });
    expect(r.windows).toEqual([{ name: 'seven_day', used_pct: 9, resets_at: NOW + 90 * HOUR }]);
    expect(r.plan).toBe('pro');
    expect(r.extra_usage).toEqual({ enabled: false, currency: null });
    expect(r.read_at).toBeNull();
  });

  test('a RateLimits-shaped payload (used_percentage) equals the normalized equivalent', () => {
    const r = normalizeUsagePayload({ five_hour: { used_percentage: 40, resets_at: NOW + 2 * HOUR }, seven_day: { used_percentage: 30, resets_at: NOW + 90 * HOUR } });
    expect(r.windows).toEqual(normalized.windows.slice(0, 2));
    expect(r.plan).toBe('unknown');
    expect(r.extra_usage).toBeNull();
  });

  test('a weekly-only payload has no five-hour leg', () => {
    const r = normalizeUsagePayload({ windows: [normalized.windows[1]] });
    expect(r.windows.map((w) => w.name)).toEqual(['seven_day']);
  });

  test('plan none with no window is valid', () => {
    expect(normalizeUsagePayload({ plan: 'none', windows: [] })).toMatchObject({ plan: 'none', windows: [] });
  });

  test('plan maps by substring, anything else is unknown', () => {
    const plan = (p: unknown) => normalizeUsagePayload({ plan: p, windows: [normalized.windows[1]] }).plan;
    expect(plan('MAX 5x')).toBe('max');
    expect(plan('team')).toBe('unknown');
    expect(plan(7)).toBe('unknown');
  });

  test('ignores unknown keys', () => {
    const r = normalizeUsagePayload({ model: { id: 'x' }, windows: [normalized.windows[1]] });
    expect(r.windows).toHaveLength(1);
  });

  test.each([
    ['duplicate name', { windows: [normalized.windows[1], normalized.windows[1]] }],
    ['used_pct above 100', { windows: [{ name: 'seven_day', used_pct: 101, resets_at: NOW + HOUR }] }],
    ['utilization above 1', { seven_day: { utilization: 1.5, resets_at: NOW + HOUR } }],
    ['non-finite reset', { windows: [{ name: 'seven_day', used_pct: 5, resets_at: Number.NaN }] }],
    ['bad ISO reset', { seven_day: { utilization: 0.1, resetsAt: 'not a date' } }],
    ['bad window name', { windows: [{ name: 'monthly', used_pct: 5, resets_at: NOW + HOUR }] }],
    ['no window, plan not none', { plan: 'max', windows: [] }],
    ['not an object', 'text'],
    ['bad read_at', { read_at: 'x', windows: [normalized.windows[1]] }],
  ])('throws UsageFileError on %s', (_label, payload) => {
    expect(() => normalizeUsagePayload(payload)).toThrow(UsageFileError);
  });
});

const ccdPayload = (windows: unknown[] = [
  { label: '5-hour limit', percentUsed: 19, resetsAt: NOW + 2 * HOUR },
  { label: 'Weekly \u00b7 all models', percentUsed: 27, resetsAt: NOW + 90 * HOUR },
  { label: 'Weekly \u00b7 Fable', percentUsed: 60, resetsAt: NOW + 90 * HOUR },
]) => ({ plan: { status: 'ok', plan: 'Max', windows, extraUsage: { enabled: false } } });

describe('desktop get_usage payload', () => {
  test('yields plan max, the two mapped windows and extra usage', () => {
    expect(normalizeUsagePayload(ccdPayload())).toEqual({
      plan: 'max',
      windows: [
        { name: 'five_hour', used_pct: 19, resets_at: NOW + 2 * HOUR },
        { name: 'seven_day', used_pct: 27, resets_at: NOW + 90 * HOUR },
      ],
      extra_usage: { enabled: false, currency: null },
      read_at: null,
    });
  });

  test('an ISO resetsAt equals the same epoch', () => {
    const iso = new Date((NOW + HOUR) * 1000).toISOString();
    expect(ccdRowsToWindows([{ label: '5-hour limit', percentUsed: 5, resetsAt: iso }])).toEqual([{ name: 'five_hour', used_pct: 5, resets_at: NOW + HOUR }]);
  });

  test.each([
    ['percentUsed 101', [{ label: '5-hour limit', percentUsed: 101, resetsAt: NOW }], /five_hour percentUsed/],
    ['unparseable resetsAt', [{ label: 'Weekly \u00b7 all models', percentUsed: 5, resetsAt: 'soon' }], /seven_day resetsAt/],
  ])('%s throws UsageFileError naming the row', (_l, rows, re) => {
    expect(() => normalizeUsagePayload(ccdPayload(rows))).toThrow(UsageFileError);
    expect(() => normalizeUsagePayload(ccdPayload(rows))).toThrow(re);
  });

  test.each([
    ['a windows array', { windows: [{ name: 'five_hour', used_pct: 5, resets_at: NOW + HOUR }] }],
    ['a top-level five_hour key', { five_hour: { used_pct: 5, resets_at: NOW + HOUR } }],
    ['a rate_limits object', { rate_limits: { five_hour: { used_pct: 5, resets_at: NOW + HOUR } } }],
  ])('a desktop payload mixed with %s throws instead of picking one source', (_l, extra) => {
    const mixed = { ...ccdPayload(), ...extra };
    expect(() => normalizeUsagePayload(mixed)).toThrow(UsageFileError);
    expect(() => normalizeUsagePayload(mixed)).toThrow(/mixes the desktop get_usage shape/);
  });

  test('a desktop payload with an unrelated top-level key such as read_at stays valid', () => {
    expect(normalizeUsagePayload({ ...ccdPayload(), read_at: NOW - 5 }).read_at).toBe(NOW - 5);
  });
});
