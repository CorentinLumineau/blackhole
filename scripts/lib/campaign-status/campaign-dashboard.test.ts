import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectStatusReport } from '../../campaign-status.ts';
import { formatDashboard } from './dashboard.ts';
import { buildStatusData } from './data.ts';
import { fakeForge, prRow } from './forge-fake.ts';
import { renderStatusHtml } from './html.ts';
import { buildStatusReport } from './report.ts';
import { loadCampaignState } from './state.ts';
import type { ForgeCounts, PrSignal, StatusReport } from './types.ts';

// The two shipped fixture campaigns: one with every record written (scope, decisions, headline,
// blockers, streams, links), one with none of them, so every fallback shows.
const FIXTURES = path.resolve(import.meta.dir, '../../../fixtures/campaign-status');
const GENERATED_AT = '2026-11-13T09:30:00.000Z';
const OFFLINE: ForgeCounts = { openIssues: 0, openPrs: 0, ok: false, error: 'skipped' };
const online = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'full/forge.online.json'), 'utf-8')) as {
  forge: ForgeCounts;
  pr_signals: Record<string, PrSignal>;
};

function reportOf(name: 'full' | 'empty', mode: 'online' | 'offline'): StatusReport {
  const state = loadCampaignState(path.join(FIXTURES, name));
  return buildStatusReport({
    ...state,
    forge: mode === 'online' ? online.forge : OFFLINE,
    prSignals: mode === 'online' ? online.pr_signals : null,
    paceLine: null,
    hostNotes: [],
    generatedAt: GENERATED_AT,
    pluginVersion: '9.9.9',
  });
}

describe('a campaign with every record written, forge reachable', () => {
  const r = reportOf('full', 'online');

  test('the board stage of each item comes from the queue, the scope and the PR signal', () => {
    const stageOf = Object.fromEntries(r.board.map((c) => [c.ref, `${c.stage}:${c.status}`]));
    expect(stageOf).toMatchObject({
      201: 'done:',
      102: 'done:',
      203: 'ready:LGTM, CI green: merge',
      204: 'ready:LGTM, CI green: held for you (workflows)',
      250: 'ready:LGTM, CI green: merge',
      205: 'review:changes requested',
      107: 'active:implementing, no PR yet',
      206: 'blocked:conflict with its base',
      213: 'blocked:CI failing: unit tests',
      109: 'blocked:waits for #107',
      112: 'blocked:blocked upstream',
      108: 'you:Owner: approve the plan',
      110: 'todo:',
      111: 'parked:parked: owned by another team',
    });
    expect(r.forge_checked).toBe(true);
    expect(r.stage_counts).toEqual({ done: 2, in_review: 5, on_you: 4, blocked: 4, parked: 1, not_started: 2, total: 14 });
  });

  test('your move: PRs delivered at LGTM or held first, then the owner gate, then other ready PRs', () => {
    expect(r.moves.map((m) => m.ref)).toEqual([204, 203, 108, 250]);
    expect(r.moves[0].text).toBe('Decide on #204: LGTM, CI green: held for you (workflows)');
    expect(r.moves[1]).toEqual({ text: 'Merge #203: Retry failed charges', url: 'https://github.com/acme/widgets/pull/203', ref: 203 });
  });

  test('headline and blockers are the ones the orchestrator wrote in the checkpoint', () => {
    expect(r.headline).toEqual({ text: 'Payments is nearly done; two PRs wait for your merge.', source: 'checkpoint' });
    expect(r.blockers.map((b) => b.text)).toEqual(['#206 conflicts with main after the cache refactor', 'Vendor SDK 4.0 is not released yet']);
    expect(r.blockers.every((b) => b.source === 'checkpoint')).toBe(true);
  });

  test('scope, decisions, streams, links and config come from state, not a hand-kept file', () => {
    expect(r.scope_record.recorded).toBe(true);
    expect(r.scope_record.entries.map((e) => e.kind)).toEqual(['in', 'in', 'parked', 'deferred', 'blocked_upstream', 'out']);
    expect(r.decisions.map((d) => d.date)).toEqual(['2026-11-12', '2026-11-11', '2026-11-10']);
    expect(r.streams.map((s) => s.stream)).toEqual(['Dependencies', 'Docs', 'Payments', 'Platform']);
    expect(r.streams.find((s) => s.stream === 'Payments')).toEqual({ stream: 'Payments', done: 0, in_review: 3, left: 1, next: '#204 LGTM, CI green: held for you (workflows)' });
    expect(r.links).toEqual([
      { label: 'Open PRs', url: 'https://github.com/acme/widgets/pulls' },
      { label: 'Issues', url: 'https://github.com/acme/widgets/issues' },
      { label: 'CI runs', url: 'https://github.com/acme/widgets/actions' },
      { label: 'Release plan', url: 'https://example.com/plan' },
    ]);
    expect(Object.fromEntries(r.config_rows.map((c) => [c.key, c.value]))).toEqual({
      'Merge mode': 'leave-open',
      Autonomy: 'full',
      Concurrency: '3 workers',
      Verification: 'LGTM, CI green and no conflict before a merge; visual evidence at 1440 px',
      'Issue filter': 'milestone v2.0',
      Kaizen: 'off',
      Plugin: 'blackhole 9.9.9',
    });
  });

  test('the data rows carry the same counts as the report (one source)', () => {
    const data = buildStatusData(r);
    expect(data.overview[0]).toMatchObject({ ...r.stage_counts, headline: r.headline.text, title: 'acme/widgets', forge_checked: true });
    expect(data.board).toHaveLength(r.board.length);
    expect(data.scope.map((s) => s.kind)).toEqual(['In', 'In', 'Parked', 'Deferred', 'Blocked upstream', 'Out']);
    expect(data.scope[2]).toEqual({ kind: 'Parked', text: 'Theme editor (#111)', reason: 'owned by another team', date: '2026-11-12' });
  });
});

describe('the same campaign offline (--no-gh)', () => {
  const r = reportOf('full', 'offline');

  test('no PR is placed from a guess: PR cards say CI was not checked', () => {
    expect(r.forge_checked).toBe(false);
    const pr = r.board.filter((c) => c.kind === 'pr' && c.stage !== 'done');
    expect(pr.length).toBeGreaterThan(0);
    for (const c of pr) expect(c.status).toContain('not checked');
    expect(r.board.some((c) => c.ref === 250)).toBe(false);
    expect(r.stage_counts).toEqual({ done: 2, in_review: 6, on_you: 3, blocked: 2, parked: 1, not_started: 2, total: 13 });
  });
});

describe('a campaign with nothing recorded', () => {
  const r = reportOf('empty', 'offline');

  test('scope is "not recorded", decisions empty, headline and blockers generated from the counts', () => {
    expect(r.scope_record).toEqual({ recorded: false, entries: [] });
    expect(r.decisions).toEqual([]);
    expect(r.headline).toEqual({ text: '1 of 3 done; 1 blocked, most by dependency / upstream, 1 not started.', source: 'generated' });
    expect(r.blockers).toEqual([
      { text: 'Dependency / upstream: 1 item', tone: '', source: 'generated' },
      { text: 'Forge not checked: review verdicts, CI and conflicts are not shown', tone: 'warn', source: 'generated' },
    ]);
    expect(r.streams).toEqual([{ stream: 'All work', done: 1, in_review: 0, left: 2, next: '#2 waits for #1' }]);
  });

  test('every dataset the page reads is present, empty ones as empty arrays', () => {
    const data = buildStatusData(r);
    expect(data.scope).toEqual([]);
    expect(data.decisions).toEqual([]);
    expect(data.moves).toEqual([]);
    expect(data.overview[0].headline_source).toBe('generated');
  });
});

describe('--json, --html and the text dashboard show the same facts', () => {
  for (const [name, mode] of [['full', 'online'], ['empty', 'offline']] as const) {
    test(`${name} campaign, ${mode}`, () => {
      const r = reportOf(name, mode);
      const state = loadCampaignState(path.join(FIXTURES, name));
      const text = formatDashboard({ ...state, forge: r.forge, view: r });
      const html = renderStatusHtml(r);
      const c = r.stage_counts;
      const board = `${c.done} done · ${c.in_review} in review · ${c.on_you} on you · ${c.blocked} blocked · ${c.parked} parked · ${c.not_started} not started`;
      expect(text).toContain(board);
      expect(html).toContain(board);
      expect(JSON.parse(JSON.stringify(r)).stage_counts).toEqual(c);
      const escaped = (s: string) => s.replace(/'/g, '&#39;');
      for (const facts of [r.headline.text, ...r.decisions.map((d) => d.text), ...r.scope_record.entries.map((e) => e.text)]) {
        expect(text).toContain(facts);
        expect(html).toContain(escaped(facts));
      }
      if (!r.scope_record.recorded) {
        expect(text).toContain('Scope not recorded');
        expect(html).toContain('Scope not recorded');
      }
      expect(html.indexOf('<h2>Scope')).toBeLessThan(html.indexOf('<h2>In progress'));
    });
  }
});

describe('collectStatusReport — the forge path', () => {
  let spy: ReturnType<typeof spyOn<typeof childProcess, 'spawnSync'>> | undefined;
  const tmp: string[] = [];
  afterEach(() => spy?.mockRestore());
  afterAll(() => {
    for (const d of tmp) fs.rmSync(d, { recursive: true, force: true });
  });
  const copy = (name: string, forge?: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-dash-'));
    tmp.push(dir);
    const campaign = path.join(dir, '.blackhole');
    fs.cpSync(path.join(FIXTURES, name), campaign, { recursive: true });
    if (forge) {
      const file = path.join(campaign, 'config.json');
      fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf-8')), forge }));
    }
    return campaign;
  };
  const ghCalls = () => (spy?.mock.calls ?? []).filter((c) => c[0] === 'gh');

  test('--no-gh makes no forge call at all', async () => {
    spy = spyOn(childProcess, 'spawnSync');
    const { report } = await collectStatusReport(copy('full'), true, GENERATED_AT);
    expect(ghCalls()).toHaveLength(0);
    expect(report.forge_checked).toBe(false);
  });

  test('on GitHub, each open PR is read for its verdict, CI and mergeability', async () => {
    const rest = (stdout: unknown) => ({ status: 0, stdout: JSON.stringify(stdout), stderr: '' }) as childProcess.SpawnSyncReturns<string>;
    const original = childProcess.spawnSync;
    spy = spyOn(childProcess, 'spawnSync').mockImplementation(((cmd: string, args: string[], opts: unknown) => {
      if (cmd !== 'gh') return original(cmd, args, opts as childProcess.SpawnSyncOptions);
      const endpoint = String(args[3]);
      if (endpoint.includes('/issues?')) return rest([]);
      if (/\/pulls\?/.test(endpoint)) return rest([{ number: 206, title: 'Cache the price table', body: null, head: { ref: 'b', sha: 'abc' }, state: 'open', merged_at: null }]);
      if (endpoint.endsWith('/pulls/206')) return rest({ number: 206, title: 'Cache the price table', body: null, mergeable: false, head: { ref: 'b', sha: 'abc' }, state: 'open', merged_at: null, labels: [{ name: 'ai-review:LGTM' }] });
      if (endpoint.includes('/check-runs')) return rest({ check_runs: [{ name: 'test', status: 'completed', conclusion: 'success' }] });
      if (endpoint.endsWith('/status')) return rest({ statuses: [] });
      return { status: 1, stdout: '', stderr: `unexpected ${endpoint}` } as childProcess.SpawnSyncReturns<string>;
    }) as typeof childProcess.spawnSync);
    const { report } = await collectStatusReport(copy('full'), false, GENERATED_AT);
    expect(report.forge_checked).toBe(true);
    expect(report.board.find((c) => c.ref === 206)).toMatchObject({ stage: 'blocked', status: 'conflict with its base', tone: 'bad' });
    // 203/204/205/213 are not open on this mocked forge, so they were never read.
    expect([...new Set(ghCalls().filter((c) => /\/pulls\/\d+$/.test(String(c[1]?.[3]))).map((c) => c[1]?.[3]))]).toEqual(['repos/acme/widgets/pulls/206']);
  });

  // The Gitea acceptance case: PR signals, merged-PR counting and drift all come through the adapter.
  describe('on Gitea, through the forge adapter', () => {
    const merged = (n: number, at: string) => prRow(n, { title: `feat(x): merged ${n}`, state: 'MERGED', mergedAt: at });
    const forge = () =>
      fakeForge({
        forge: 'gitea',
        issues: [],
        prs: {
          open: [prRow(203, { title: 'feat(payments): retry failed charges' }), prRow(206, { title: 'Cache the price table' }), prRow(250, { title: 'chore(deps): bump the date library' })],
          all: [merged(205, '2026-11-12T08:00:00Z'), merged(300, '2026-11-11T09:00:00Z'), merged(301, '2026-11-01T09:00:00Z')],
        },
        views: {
          203: prRow(203, { labels: ['ai-review:LGTM'], mergeable: true }),
          206: prRow(206, { labels: [], mergeable: false }),
          250: prRow(250, { labels: ['ai-review:NEEDS_CHANGES'], mergeable: true }),
        },
        checks: {
          203: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
          206: [{ name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }],
          250: [{ name: 'build', status: 'IN_PROGRESS', conclusion: null }],
        },
      });

    test('PR cards carry review, CI and mergeability, and the page does not say "not checked"', async () => {
      spy = spyOn(childProcess, 'spawnSync');
      const { report } = await collectStatusReport(copy('full', 'gitea'), false, GENERATED_AT, forge());
      expect(report.forge_checked).toBe(true);
      expect(ghCalls()).toHaveLength(0);
      const card = (ref: number) => report.board.find((c) => c.ref === ref);
      expect(card(203)).toMatchObject({ stage: 'ready', status: 'LGTM, CI green: merge' });
      expect(card(206)).toMatchObject({ stage: 'blocked', status: 'conflict with its base' });
      expect(card(250)).toMatchObject({ stage: 'review', status: 'changes requested' });
      expect(report.board.filter((c) => c.kind === 'pr' && c.stage !== 'done').every((c) => !c.status.includes('not checked') || [204, 213].includes(c.ref))).toBe(true);
    });

    test('a merged campaign PR with no queue entry is done, in its stream, and one merged before the start is not', async () => {
      const { report } = await collectStatusReport(copy('full', 'gitea'), false, GENERATED_AT, forge());
      expect(report.board.find((c) => c.ref === 300)).toMatchObject({ stage: 'done', kind: 'pr', issue: null, title: 'Merged 300', stream: 'Platform' });
      expect(report.board.some((c) => c.ref === 301)).toBe(false);
      const platform = report.streams.find((s) => s.stream === 'Platform')!;
      expect(platform.done).toBe(report.board.filter((c) => c.stream === 'Platform' && c.stage === 'done').length);
      expect(platform.done).toBeGreaterThanOrEqual(2);
    });

    test('a queue entry the forge contradicts renders as merged and is listed as drift', async () => {
      const { report } = await collectStatusReport(copy('full', 'gitea'), false, GENERATED_AT, forge());
      expect(report.board.find((c) => c.ref === 205)).toMatchObject({ stage: 'done', status: 'merged on the forge; queue said in-flight' });
      expect(report.drift).toEqual([{ issue: 105, pr: 205, title: 'Refund screen shows the fee', queue: 'in-flight', forge: 'merged' }]);
      expect(report.blockers.some((b) => b.tone === 'warn' && b.text.includes('#205'))).toBe(true);
      expect(report.in_review.some((i) => i.issue === 105)).toBe(false);
    });

    test('a merged-list read that fails leaves the rest of the forge data in place and claims no drift', async () => {
      const broken = fakeForge({ forge: 'gitea', issues: [], prs: { open: [prRow(203)] }, views: { 203: prRow(203, { mergeable: true }) }, checks: { 203: [] } });
      const { report } = await collectStatusReport(copy('full', 'gitea'), false, GENERATED_AT, broken);
      expect(report.forge_checked).toBe(true);
      expect(report.drift).toEqual([]);
      expect(report.board.find((c) => c.ref === 205)).toMatchObject({ stage: 'review' });
    });
  });
});
