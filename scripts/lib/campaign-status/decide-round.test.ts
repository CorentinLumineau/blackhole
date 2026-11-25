import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runRecord } from '../../campaign-record.ts';
import { NOT_PROBED } from './budget.ts';
import { decisionsRow } from './launch-summary.ts';
import { HOLD_FILE, LEGACY_SLEEP_HOLD_FILE, type HoldDeps } from './keep-awake.ts';
import { buildDecideReport, CI_CHECK_IN_MINUTES, DECIDE_BASELINE_FILE, legacySleepBaseline, parseDecideBaseline, planWakeUps } from './decide-round.ts';
import type { BudgetPanel, QueueIssue } from './types.ts';

// The decide round's report against the last-decide baseline, the keep-awake reconcile, re-armed
// wake-ups as data, and how a retired sleep_mode block is ignored with a warning.

const dirs: string[] = [];
function campaign(config: Record<string, unknown>, queue?: Record<string, QueueIssue>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-decide-'));
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
  fs.writeFileSync(path.join(dir, 'run-context.json'), JSON.stringify({ context: { host: { value: 'claude' } }, route: { schedule, state_store: 'local' } }));
  return dir;
}

/** A macOS host with caffeinate whose process calls are recorded, never made. */
function fakeMac() {
  const running = new Set<number>();
  const calls: string[] = [];
  const deps: HoldDeps = {
    platform: 'darwin',
    onPath: (bin) => bin === 'caffeinate',
    spawnDetached: (command) => {
      calls.push(`spawn ${command.join(' ')}`);
      running.add(700);
      return 700;
    },
    identify: (pid) => (running.has(pid) ? { state: 'running', identity: `lstart caffeinate -i #${pid}` } : { state: 'gone' }),
    kill: (pid) => {
      calls.push(`kill ${pid}`);
      running.delete(pid);
    },
    wait: () => {},
  };
  return { deps, calls };
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

const baselineOf = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, DECIDE_BASELINE_FILE), 'utf-8'));

describe('parseDecideBaseline / legacySleepBaseline', () => {
  test('keeps only a parseable at and a well-formed baseline', () => {
    const good = { at: NOW_ISO, done: [1, 2], weekly_pct: 40 };
    expect(parseDecideBaseline(good)).toEqual(good);
    expect(parseDecideBaseline({ ...good, at: 'yesterday' })).toBeNull();
    expect(parseDecideBaseline({ ...good, done: [1.5] })).toBeNull();
    expect(parseDecideBaseline({ ...good, weekly_pct: '40' })).toBeNull();
    expect(parseDecideBaseline({ at: NOW_ISO, done: null, weekly_pct: null })).toEqual({ at: NOW_ISO, done: null, weekly_pct: null });
    expect(parseDecideBaseline(null)).toBeNull();
  });

  test('a retired sleep baseline is read once as the first decide baseline', () => {
    expect(legacySleepBaseline({ sleep_mode: { enabled: true, since: NOW_ISO, baseline: { done: [1], weekly_pct: 40 } } })).toEqual({
      at: NOW_ISO, done: [1], weekly_pct: 40,
    });
    expect(legacySleepBaseline({ sleep_mode: { enabled: false } })).toBeNull();
    expect(legacySleepBaseline({})).toBeNull();
  });

  test('a retired sleep baseline without weekly_pct still counts its done issues', () => {
    expect(legacySleepBaseline({ sleep_mode: { enabled: true, since: '2026-11-18T16:15:56Z', baseline: { done: [942, 971] } } })).toEqual({
      at: '2026-11-18T16:15:56Z', done: [942, 971], weekly_pct: null,
    });
  });
});

describe('campaign-record decide', () => {
  test('a first round reports nothing measured, then records the baseline the next round reads', () => {
    const dir = probedCampaign({ merge_mode: 'leave-open' }, QUEUE);
    const first = JSON.parse(runRecord(['decide', '--campaign-dir', dir], NOW));
    expect(first.report).toContain('- Last round: none recorded.');
    expect(first.report).toContain('- Issues finished: not measured — no earlier decide round.');
    expect(baselineOf(dir)).toEqual({ at: NOW_ISO, done: [1, 2], weekly_pct: 61 });
  });

  test('a later round reports the issues finished and the weekly points used since the last one', () => {
    const dir = probedCampaign({ merge_mode: 'leave-open' }, QUEUE);
    fs.writeFileSync(path.join(dir, DECIDE_BASELINE_FILE), JSON.stringify({ at: '2026-11-16T20:00:00.000Z', done: [1], weekly_pct: 40 }));
    const out = JSON.parse(runRecord(['decide', '--campaign-dir', dir], NOW));
    expect(out.report).toContain('- Last round: Mon 16 Nov 20:00 UTC.');
    expect(out.report).toContain('- Issues finished: 1 issue finished — #2.');
    expect(out.report).toContain('- Weekly points used: weekly 61% (+21 points since the last round), 5-hour 92%.');
  });

  test('a second decide straight after the first reports none finished since it', () => {
    const dir = probedCampaign({ merge_mode: 'leave-open' }, QUEUE);
    runRecord(['decide', '--campaign-dir', dir], NOW);
    const again = JSON.parse(runRecord(['decide', '--campaign-dir', dir], NOW));
    expect(again.report).toContain('- Last round: Tue 17 Nov 02:00 UTC.');
    expect(again.report).toContain('- Issues finished: none.');
    expect(again.report).toContain('(+0 points since the last round)');
  });

  test('never touches config.json; a campaign away at the upgrade gets its away report from the retired baseline', () => {
    const dir = campaign({ sleep_mode: { enabled: true, since: NOW_ISO, baseline: { done: [1], weekly_pct: null } } }, QUEUE);
    const before = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    const out = JSON.parse(runRecord(['decide', '--campaign-dir', dir], NOW));
    expect(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8')).toBe(before);
    expect(out.report).toContain('- Issues finished: 1 issue finished — #2.');
    expect(out.warning).toBe('config.json sleep_mode is retired and ignored (ADR-059 amendment): remove it; an unattended start passes --unattended');
    expect(Object.keys(out)).toEqual(['report', 'warning', 'total', 'blocked_items', 'cards']);
  });

  test('a retired sleep baseline with only done reports the issues finished since it', () => {
    const dir = campaign({ sleep_mode: { enabled: true, since: '2026-11-16T20:00:00Z', baseline: { done: [1] } } }, QUEUE);
    const out = JSON.parse(runRecord(['decide', '--campaign-dir', dir], NOW));
    expect(out.report).toContain('- Last round: Mon 16 Nov 20:00 UTC.');
    expect(out.report).toContain('- Issues finished: 1 issue finished — #2.');
  });

  test('a malformed baseline file is not measured, never a crash, and is replaced', () => {
    const dir = campaign({}, QUEUE);
    fs.writeFileSync(path.join(dir, DECIDE_BASELINE_FILE), '{not json');
    const out = JSON.parse(runRecord(['decide', '--campaign-dir', dir], NOW));
    expect(out.report).toContain('- Last round: none recorded.');
    expect(baselineOf(dir).at).toBe(NOW_ISO);
  });
});

describe('campaign-record retired sleep / wake', () => {
  test('both fail with a line naming what replaces them, and write nothing', () => {
    const dir = campaign({ merge_mode: 'leave-open' });
    const before = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    expect(() => runRecord(['sleep', '--on', '--campaign-dir', dir], NOW)).toThrow('`sleep` was retired');
    expect(() => runRecord(['wake', '--campaign-dir', dir], NOW)).toThrow('`wake` was retired');
    expect(() => runRecord(['wake', '--campaign-dir', dir], NOW)).toThrow('/blackhole decide');
    expect(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8')).toBe(before);
  });

  test('ask follows decisions.mode alone, whatever a retired sleep_mode block says', () => {
    expect(runRecord(['ask', '--campaign-dir', campaign({ decisions: { mode: 'ask' }, sleep_mode: { enabled: true } })], NOW)).toBe('ask');
    expect(runRecord(['ask', '--campaign-dir', campaign({ sleep_mode: { enabled: false } })], NOW)).toBe('park');
  });
});

describe('campaign-record keep-awake', () => {
  test('a worker in flight takes the hold, a drain with no wake releases it', () => {
    const dir = probedCampaign({}, QUEUE);
    const mac = fakeMac();
    expect(runRecord(['keep-awake', '--workers', '2', '--campaign-dir', dir], NOW, mac.deps)).toBe(
      'Keep-awake: held by caffeinate (pid 700) until the campaign drains or stops.',
    );
    expect(fs.existsSync(path.join(dir, HOLD_FILE))).toBe(true);
    expect(runRecord(['keep-awake', '--workers', '0', '--wake-armed', '--campaign-dir', dir], NOW, mac.deps)).toBe(
      'Keep-awake: already held by caffeinate (pid 700).',
    );
    expect(runRecord(['keep-awake', '--workers', '0', '--campaign-dir', dir], NOW, mac.deps)).toBe('Keep-awake: released caffeinate (pid 700).');
    expect(mac.calls).toEqual(['spawn caffeinate -i', 'kill 700']);
  });

  test('releases a hold retired sleep mode took, so an upgrade orphans no inhibitor', () => {
    const dir = probedCampaign({}, QUEUE);
    fs.mkdirSync(path.join(dir, '.tmp'));
    fs.writeFileSync(path.join(dir, LEGACY_SLEEP_HOLD_FILE), JSON.stringify({ pid: 700, tool: 'caffeinate', started_at: NOW_ISO, identity: 'lstart caffeinate -i #700' }));
    const mac = fakeMac();
    mac.deps.identify = (pid) => (pid === 700 ? { state: 'running', identity: 'lstart caffeinate -i #700' } : { state: 'gone' });
    expect(runRecord(['keep-awake', '--workers', '0', '--campaign-dir', dir], NOW, mac.deps)).toBe('Keep-awake: released caffeinate (pid 700).');
    expect(mac.calls).toEqual(['kill 700']);
  });

  test('an ephemeral host takes no hold, and --workers is required and numeric', () => {
    const dir = campaign({});
    fs.writeFileSync(path.join(dir, 'run-context.json'), JSON.stringify({ route: { state_store: 'branch' } }));
    const mac = fakeMac();
    expect(runRecord(['keep-awake', '--workers', '1', '--campaign-dir', dir], NOW, mac.deps)).toBe(
      'Keep-awake: not held — ephemeral host (state_store: branch), nothing to inhibit.',
    );
    expect(mac.calls).toEqual([]);
    expect(() => runRecord(['keep-awake', '--campaign-dir', dir], NOW, mac.deps)).toThrow('--workers');
    expect(() => runRecord(['keep-awake', '--workers', 'two', '--campaign-dir', dir], NOW, mac.deps)).toThrow('--workers');
  });
});

describe('campaign-record rearm', () => {
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

  test('a cross-repo in-flight key never reaches the CI check-in refs as NaN (#1499)', () => {
    const issues: Record<string, QueueIssue> = { ...QUEUE, 'blackhole#7': { status: 'in-flight', phase: 'review', pr: 77 } };
    const plan = planWakeUps({ budget: NOT_PROBED, issues, role: 'solo', nowIso: NOW_ISO });
    expect(plan).toHaveLength(1);
    expect(plan[0].refs).toEqual([3, 4]);
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

describe('buildDecideReport', () => {
  const report = (over: Partial<Parameters<typeof buildDecideReport>[0]> = {}) =>
    buildDecideReport({ baseline: { at: NOW_ISO, done: [1], weekly_pct: 40 }, issues: QUEUE, budget: PROBED, pending: 3, ...over });

  test('issues finished, open PRs in merge order, weekly points used, then the decisions', () => {
    expect(report()).toBe(
      [
        '## Since the last decide round',
        '',
        '- Last round: Tue 17 Nov 02:00 UTC.',
        '- Issues finished: 1 issue finished — #2.',
        '- Open PRs in merge order: 1. #3 (PR #13) — none; 2. #4 (PR #14) — waits on #3 (stacked on) (cross-repo dependencies not read).',
        '- Weekly points used: weekly 61% (+21 points since the last round), 5-hour 92%.',
        '- Decisions waiting for you: 3, asked next.',
        '',
      ].join('\n'),
    );
  });

  test('a missing baseline, queue or reading is said, never guessed', () => {
    const text = report({ baseline: null, issues: null, budget: { ...NOT_PROBED, reason: 'no cache' }, pending: 0 });
    expect(text).toContain('- Last round: none recorded.');
    expect(text).toContain('- Issues finished: not measured — no earlier decide round.');
    expect(text).toContain('- Open PRs in merge order: queue.json not read.');
    expect(text).toContain('- Weekly points used: usage not probed — no cache.');
    expect(text).toContain('- Decisions waiting for you: none.');
  });

  test('a trunk-red base fix is ordered first, as on the dashboard', () => {
    const issues: Record<string, QueueIssue> = {
      '3': { status: 'blocked', phase: 'review', pr: 13, notes: 'waiting-on-trunk-fix #9' },
      '9': { status: 'in-flight', phase: 'review', pr: 19 },
    };
    expect(report({ issues })).toContain('- Open PRs in merge order: 1. #9 (PR #19) — none — CI fix, merge first;');
  });

  test('a baseline taken without a queue says issues finished were not measured', () => {
    expect(report({ baseline: { at: NOW_ISO, done: null, weekly_pct: null } })).toContain(
      '- Issues finished: not measured — queue.json was absent at the last round.',
    );
  });

  test('no open PR and no finished issue read as none', () => {
    const text = report({ issues: { '1': { status: 'merged', pr: 11 } } });
    expect(text).toContain('- Issues finished: none.');
    expect(text).toContain('- Open PRs in merge order: none.');
  });
});

describe('a retired sleep_mode block outside campaign-record', () => {
  test('the launch summary Decisions row names the mode and the wait, and warns on a retired sleep_mode block', () => {
    const park = decisionsRow({}, 0);
    expect(park).toMatchObject({ key: 'decisions', label: 'Decisions', value: 'park (default) · none waiting', adjustable: false });
    expect(decisionsRow({}, 3).value).toBe('park (default) · 3 waiting — run /blackhole decide');
    expect(decisionsRow({ decisions: { mode: 'ask' } }, 0).value).toBe('ask · none waiting');
    expect(decisionsRow({ decisions: { mode: 'later' } }, 0).value).toBe('park (invalid decisions.mode "later") · none waiting');
    expect(decisionsRow({}, null).value).toBe('park (default) · parked decisions unreadable');
    const legacy = decisionsRow({ sleep_mode: { enabled: true, since: NOW_ISO } }, 1);
    expect(legacy.value).toBe('park (default) · 1 waiting — run /blackhole decide · retired sleep_mode ignored');
    expect(legacy.consequence).toBe(
      'config.json sleep_mode is retired and ignored (ADR-059 amendment): remove it; an unattended start passes --unattended.',
    );
  });

  test('run-context.json carries no sleep_mode, and the run warns that the block is ignored', () => {
    const dir = campaign({ sleep_mode: { enabled: true, since: NOW_ISO } });
    const proc = Bun.spawnSync(
      ['bun', 'run', path.resolve(import.meta.dir, '../../run-context.ts'), '--tools', 'agent,background-agents,ask-user-question,github-mcp', '--host', 'claude', '--surface', 'local', '--campaign-dir', dir],
      { env: { ...process.env, GH_TOKEN: '' } },
    );
    expect(proc.stdout.toString()).toContain('  warn: config.json sleep_mode is retired and ignored (ADR-059 amendment)');
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'run-context.json'), 'utf-8'));
    expect(record.sleep_mode).toBeUndefined();
    expect(record.keep_awake).toEqual({ held: false, reason: 'no hold recorded' });
  });
});
