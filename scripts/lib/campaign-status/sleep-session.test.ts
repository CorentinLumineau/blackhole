import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runRecord } from '../../campaign-record.ts';
import { NOT_PROBED } from './budget.ts';
import { sleepRow } from './launch-summary.ts';
import { buildWakeReport, CI_CHECK_IN_MINUTES, planWakeUps, readSleepSession, sleepOff, sleepOn } from './sleep-session.ts';
import type { BudgetPanel, QueueIssue } from './types.ts';

// Sleep mode around the choke point: the toggle, re-armed wake-ups as data, the wake-up report, and the
// sleep flag in the launch summary and run-context.json.

const dirs: string[] = [];
function campaign(config: Record<string, unknown>, queue?: Record<string, QueueIssue>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-sleep2-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  if (queue) fs.writeFileSync(path.join(dir, 'queue.json'), JSON.stringify({ issues: queue }));
  return dir;
}
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const readConfig = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'));

const NOW = new Date('2026-11-17T02:00:00.000Z');
const NOW_ISO = NOW.toISOString();
const NOW_S = NOW.getTime() / 1000;

/**
 * A campaign whose usage reading is fixed: a Claude host recorded in run-context.json and a
 * rate-limit cache dated NOW (5-hour 92% resetting 04:00, weekly 61% resetting 20 Nov 09:00).
 */
function probedCampaign(config: Record<string, unknown>, queue?: Record<string, QueueIssue>, schedule = 'turn'): string {
  const dir = campaign({}, queue);
  const cache = path.join(dir, 'rate-limits.json');
  fs.writeFileSync(cache, JSON.stringify({ rate_limits: {
    five_hour: { used_percentage: 92, resets_at: NOW_S + 2 * 3600 },
    seven_day: { used_percentage: 61, resets_at: Date.parse('2026-11-20T09:00:00.000Z') / 1000 },
  } }));
  fs.utimesSync(cache, NOW, NOW);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ ...config, resource_policy: { pace: { cache_path: cache } } }));
  fs.writeFileSync(path.join(dir, 'run-context.json'), JSON.stringify({ context: { host: { value: 'claude' } }, route: { schedule } }));
  return dir;
}
const panel = (over: Partial<BudgetPanel>): BudgetPanel => ({ ...NOT_PROBED, ...over });
const PROBED = panel({
  probed: true, reason: null, age_seconds: 0, verdict: 'NO-SPAWN', verdict_reasons: [], workers_allowed: 0,
  five_hour_pct: 92, five_hour_resets_at: '2026-11-17T04:00:00.000Z', weekly_pct: 61, resets_at: '2026-11-20T09:00:00.000Z',
});
const QUEUE: Record<string, QueueIssue> = {
  '1': { status: 'merged', pr: 11 },
  '2': { status: 'merged', pr: 12 },
  '3': { status: 'in-flight', phase: 'review', pr: 13 },
  '4': { status: 'in-flight', phase: 'review', pr: 14, stacked_on: 3, stacked_on_pr: 13 },
  '5': { status: 'ready' },
};

describe('sleepOn / sleepOff', () => {
  test('on records since and the baseline; off drops both', () => {
    const on = sleepOn({ merge_mode: 'immediate', sleep_mode: { enabled: false } }, NOW_ISO, { done: [1], weekly_pct: 40 });
    expect(on).toEqual({ merge_mode: 'immediate', sleep_mode: { enabled: true, since: NOW_ISO, baseline: { done: [1], weekly_pct: 40 } } });
    expect(sleepOff(on)).toEqual({ merge_mode: 'immediate', sleep_mode: { enabled: false } });
  });

  test('readSleepSession keeps only a parseable since and a well-formed baseline', () => {
    const good = { done: [1, 2], weekly_pct: 40 };
    expect(readSleepSession({ sleep_mode: { enabled: true, since: NOW_ISO, baseline: good } })).toEqual({ since: NOW_ISO, baseline: good });
    expect(readSleepSession({ sleep_mode: { enabled: true, since: 'yesterday', baseline: good } }).since).toBeNull();
    expect(readSleepSession({ sleep_mode: { enabled: true, since: 42 } }).since).toBeNull();
    expect(readSleepSession({ sleep_mode: { baseline: { done: [1.5], weekly_pct: 40 } } }).baseline).toBeNull();
    expect(readSleepSession({ sleep_mode: { baseline: { done: 'all', weekly_pct: 40 } } as never }).baseline).toBeNull();
    expect(readSleepSession({ sleep_mode: { baseline: { done: [1], weekly_pct: '40' } } as never }).baseline).toBeNull();
    expect(readSleepSession({ sleep_mode: { baseline: { done: null, weekly_pct: null } } }).baseline).toEqual({ done: null, weekly_pct: null });
    expect(readSleepSession({})).toEqual({ since: null, baseline: null });
  });

  test('switching on while already asleep keeps the first since and baseline', () => {
    const first = sleepOn({}, NOW_ISO, { done: [1], weekly_pct: 40 });
    expect(sleepOn(first, '2026-11-17T05:00:00.000Z', { done: [1, 2], weekly_pct: 70 })).toEqual(first);
  });
});

describe('campaign-record sleep --on | --off', () => {
  test('--on snapshots the done issues and the weekly %, --off turns it off, ask follows the flag', () => {
    const dir = probedCampaign({ merge_mode: 'leave-open' }, QUEUE);
    const flags = ['--campaign-dir', dir];
    expect(runRecord(['sleep', '--on', ...flags], NOW)).toBe('Sleep mode on since Tue 17 Nov 02:00 UTC: owner questions are parked (0 waiting).');
    const block = readConfig(dir).sleep_mode;
    expect(block.enabled).toBe(true);
    expect(block.since).toBe(NOW_ISO);
    expect(block.baseline).toEqual({ done: [1, 2], weekly_pct: 61 });
    expect(runRecord(['ask', ...flags], NOW)).toBe('park');
    expect(runRecord(['sleep', '--off', ...flags], NOW)).toBe('Sleep mode off: 0 parked decisions wait for `campaign-record.ts wake`.');
    expect(readConfig(dir).sleep_mode).toEqual({ enabled: false });
    expect(runRecord(['ask', ...flags], NOW)).toBe('ask');
  });

  test('--on with no queue.json records the done baseline as not measured', () => {
    const dir = campaign({});
    runRecord(['sleep', '--on', '--campaign-dir', dir], NOW);
    expect(readConfig(dir).sleep_mode.baseline.done).toBeNull();
  });

  test('sleep needs exactly one of --on and --off', () => {
    const dir = campaign({});
    expect(() => runRecord(['sleep', '--campaign-dir', dir], NOW)).toThrow('sleep takes --on or --off');
    expect(() => runRecord(['sleep', '--on', '--off', '--campaign-dir', dir], NOW)).toThrow('sleep takes --on or --off');
  });

  test('wake prints the report ahead of the batch and turns sleep mode off', () => {
    const dir = campaign({ sleep_mode: { enabled: true, since: NOW_ISO, baseline: { done: [1], weekly_pct: null } } }, QUEUE);
    const out = JSON.parse(runRecord(['wake', '--campaign-dir', dir], NOW));
    expect(Object.keys(out)[0]).toBe('report');
    expect(out.report).toContain('Work done: 1 issue finished — #2');
    expect(out.total).toBe(0);
    expect(readConfig(dir).sleep_mode).toEqual({ enabled: false });
  });

  test('rearm prints the wake-ups and the schedule from run-context.json', () => {
    const dir = probedCampaign({}, QUEUE, 'routine');
    const out = JSON.parse(runRecord(['rearm', '--campaign-dir', dir], NOW));
    expect(out).toEqual({
      schedule: 'routine',
      wake_ups: [
        { at: '2026-11-17T02:20:00.000Z', reasons: ['ci-check-in'], refs: [3, 4], wake_peers: false },
        { at: '2026-11-17T04:00:00.000Z', reasons: ['five-hour-reset'], refs: [], wake_peers: false },
        { at: '2026-11-20T09:00:00.000Z', reasons: ['weekly-reset'], refs: [], wake_peers: false },
      ],
    });
  });

  test('rearm wakes peers on a reset only when config makes this session the manager', () => {
    const manager = probedCampaign({ usage_budget: { enabled: true, coordination: { role: 'manager' } } }, QUEUE);
    const peers = (dir: string) => JSON.parse(runRecord(['rearm', '--campaign-dir', dir], NOW)).wake_ups.map((w: { wake_peers: boolean }) => w.wake_peers);
    expect(peers(manager)).toEqual([false, true, true]);
    const invalid = probedCampaign({ usage_budget: { enabled: true, coordination: { role: 'boss' } } }, QUEUE);
    expect(peers(invalid)).toEqual([false, false, false]);
  });
});

describe('planWakeUps', () => {
  test('arms each future reset and one CI check-in, soonest first', () => {
    const plan = planWakeUps({ budget: PROBED, issues: QUEUE, role: 'solo', nowIso: NOW_ISO });
    expect(plan).toEqual([
      { at: '2026-11-17T02:20:00.000Z', reasons: ['ci-check-in'], refs: [3, 4], wake_peers: false },
      { at: '2026-11-17T04:00:00.000Z', reasons: ['five-hour-reset'], refs: [], wake_peers: false },
      { at: '2026-11-20T09:00:00.000Z', reasons: ['weekly-reset'], refs: [], wake_peers: false },
    ]);
    expect(CI_CHECK_IN_MINUTES).toBe(20);
  });

  test('a manager wakes its peers on a reset, never on a CI check-in', () => {
    const plan = planWakeUps({ budget: PROBED, issues: QUEUE, role: 'manager', nowIso: NOW_ISO });
    expect(plan.map((w) => w.wake_peers)).toEqual([false, true, true]);
  });

  test('an in-flight issue with no PR yet gets no CI check-in', () => {
    const issues: Record<string, QueueIssue> = { '7': { status: 'in-flight', phase: 'implement', pr: null }, '8': { status: 'in-flight', phase: 'implement' } };
    expect(planWakeUps({ budget: NOT_PROBED, issues, role: 'solo', nowIso: NOW_ISO })).toEqual([]);
    const mixed = { ...issues, '3': QUEUE['3'] };
    expect(planWakeUps({ budget: NOT_PROBED, issues: mixed, role: 'solo', nowIso: NOW_ISO })[0].refs).toEqual([3]);
  });

  test('a reset already past, an unprobed budget and no PR in flight arm nothing', () => {
    const past = panel({ ...PROBED, five_hour_resets_at: '2026-11-17T01:00:00.000Z', resets_at: null });
    expect(planWakeUps({ budget: past, issues: { '5': { status: 'ready' } }, role: 'solo', nowIso: NOW_ISO })).toEqual([]);
    expect(planWakeUps({ budget: NOT_PROBED, issues: {}, role: 'solo', nowIso: NOW_ISO })).toEqual([]);
  });

  test('two reasons at the same minute are one wake-up', () => {
    const same = panel({ ...PROBED, five_hour_resets_at: '2026-11-17T02:20:30.000Z', resets_at: null });
    const plan = planWakeUps({ budget: same, issues: QUEUE, role: 'manager', nowIso: NOW_ISO });
    expect(plan).toEqual([{ at: '2026-11-17T02:20:00.000Z', reasons: ['ci-check-in', 'five-hour-reset'], refs: [3, 4], wake_peers: true }]);
  });
});

describe('buildWakeReport', () => {
  const report = (over: Partial<Parameters<typeof buildWakeReport>[0]> = {}) =>
    buildWakeReport({ since: NOW_ISO, baseline: { done: [1], weekly_pct: 40 }, issues: QUEUE, budget: PROBED, pending: 3, ...over });

  test('work done, open PRs in merge order, budget used, then the decisions', () => {
    expect(report()).toBe(
      [
        '## While you were away',
        '',
        '- Asleep since Tue 17 Nov 02:00 UTC.',
        '- Work done: 1 issue finished — #2.',
        '- Open PRs in merge order: 1. #3 (PR #13) — none; 2. #4 (PR #14) — waits on #3 (stacked on) (cross-repo dependencies not read).',
        '- Budget used: weekly 61% (+21 points while away), 5-hour 92%.',
        '- Decisions waiting for you: 3, asked next.',
        '',
      ].join('\n'),
    );
  });

  test('a missing baseline, queue or reading is said, never guessed', () => {
    const text = report({ since: null, baseline: null, issues: null, budget: { ...NOT_PROBED, reason: 'no cache' }, pending: 0 });
    expect(text).toContain('- Asleep since: not recorded.');
    expect(text).toContain('- Work done: not measured — no sleep baseline was recorded.');
    expect(text).toContain('- Open PRs in merge order: queue.json not read.');
    expect(text).toContain('- Budget used: usage not probed — no cache.');
    expect(text).toContain('- Decisions waiting for you: none.');
  });

  test('a trunk-red base fix is ordered first, as on the dashboard', () => {
    const issues: Record<string, QueueIssue> = {
      '3': { status: 'blocked', phase: 'review', pr: 13, notes: 'waiting-on-trunk-fix #9' },
      '9': { status: 'in-flight', phase: 'review', pr: 19 },
    };
    expect(report({ issues })).toContain('- Open PRs in merge order: 1. #9 (PR #19) — none — CI fix, merge first;');
  });

  test('a baseline taken without a queue says work done was not measured', () => {
    expect(report({ baseline: { done: null, weekly_pct: null } })).toContain('- Work done: not measured — queue.json was absent when sleep mode went on.');
  });

  test('no open PR and no finished issue read as none', () => {
    const text = report({ issues: { '1': { status: 'merged', pr: 11 } } });
    expect(text).toContain('- Work done: none.');
    expect(text).toContain('- Open PRs in merge order: none.');
  });
});

describe('the sleep flag outside config.json', () => {
  test('the launch summary Sleep row is display-only and says what parks', () => {
    const off = sleepRow({});
    expect(off).toMatchObject({ key: 'sleep', label: 'Sleep mode', value: 'off', adjustable: false });
    const on = sleepRow({ sleep_mode: { enabled: true, since: NOW_ISO } });
    expect(on.value).toBe('on since Tue 17 Nov 02:00 UTC');
    expect(on.consequence).toBe('No question is asked: each is parked for the wake-up round, and this gate only prints.');
  });

  test('run-context.json carries sleep_mode with its since, and the run says so', () => {
    const dir = campaign({ sleep_mode: { enabled: true, since: NOW_ISO } });
    const proc = Bun.spawnSync(
      ['bun', 'run', path.resolve(import.meta.dir, '../../run-context.ts'), '--tools', 'agent,background-agents,ask-user-question,github-mcp', '--host', 'claude', '--surface', 'local', '--campaign-dir', dir],
      { env: { ...process.env, GH_TOKEN: '' } },
    );
    expect(proc.stdout.toString()).toContain('sleep mode on: owner questions are parked (sleep-mode.md)');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'run-context.json'), 'utf-8')).sleep_mode).toEqual({ enabled: true, since: NOW_ISO });
  });
});
