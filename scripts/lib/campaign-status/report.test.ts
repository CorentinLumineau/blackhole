import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseStatusArgs } from './cli.ts';
import { formatDashboard } from './dashboard.ts';
import { buildStatusData } from './data.ts';
import { renderStatusHtml } from './html.ts';
import { buildStatusReport, classifyBlocked, inProgressItems, READY_TO_MERGE_DETAIL, readyToMergeDetail } from './report.ts';
import { loadCampaignState } from './state.ts';
import type { ForgeCounts, QueueJson } from './types.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const FORGE_OK: ForgeCounts = { openIssues: 4, openPrs: 2, ok: true };
const GENERATED_AT = '2026-11-11T12:00:00.000Z';

const CHECKPOINT = [
  '---',
  'refreshed_at: 2026-07-05T00:00:00.000Z',
  'orchestrator_turn_id: 12',
  'last_completed_phase: review',
  '---',
  '',
  '# Campaign Checkpoint',
  '',
  '## In-flight workers',
  '',
  '- reviewer on #298 PR 42 (spawned turn 12)',
  '',
  '## Notes',
  '',
  'Awaiting implement fix for V-KISS-03 on #298.',
  '',
].join('\n');

// A campaign directory built from the shipped fixtures, so the test reads them through
// loadCampaignState exactly as `bun run status` does.
const tmpDirs: string[] = [];
function fixtureCampaign(withCheckpoint = true): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-status-'));
  tmpDirs.push(dir);
  fs.copyFileSync(path.join(REPO_ROOT, 'fixtures/config.example.json'), path.join(dir, 'config.json'));
  fs.copyFileSync(path.join(REPO_ROOT, 'fixtures/queue.example.json'), path.join(dir, 'queue.json'));
  fs.copyFileSync(path.join(REPO_ROOT, 'fixtures/findings-ledger.example.json'), path.join(dir, 'findings-ledger.json'));
  if (withCheckpoint) fs.writeFileSync(path.join(dir, 'campaign-checkpoint.md'), CHECKPOINT);
  return dir;
}
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function reportFor(dir: string, forge: ForgeCounts = FORGE_OK) {
  const state = loadCampaignState(dir);
  return buildStatusReport({ ...state, forge, paceLine: null, hostNotes: [], generatedAt: GENERATED_AT });
}

describe('buildStatusReport — JSON shape against the fixtures', () => {
  const report = reportFor(fixtureCampaign());

  test('campaign header and checkpoint', () => {
    expect(report.schema_version).toBe(1);
    expect(report.generated_at).toBe(GENERATED_AT);
    expect(report.campaign).toEqual({
      repo: 'owner/repo-name',
      scope: { milestone: 'v0.4.0', labels: ['blackhole/backlog'] },
      started_at: '2026-07-04T10:00:00.000Z',
      queue_refreshed_at: '2026-07-05T00:00:00.000Z',
    });
    expect(report.checkpoint).toEqual({
      turn: 12,
      refreshed_at: '2026-07-05T00:00:00.000Z',
      last_completed_phase: 'review',
      notes: ['Awaiting implement fix for V-KISS-03 on #298.'],
      active_workers: ['reviewer on #298 PR 42 (spawned turn 12)'],
    });
  });

  test('counts by status', () => {
    expect(report.counts).toEqual({
      queue: {
        active: 2,
        done: 1,
        in_flight: 1,
        blocked: 1,
        ready: 0,
        unclassified: 0,
        by_status: { 'in-flight': 1, blocked: 1, merged: 1 },
      },
      ledger: { open: 2, block: 1, warn: 1, note: 0, deferred: 1 },
    });
    expect(report.queue_health).toBe('healthy');
  });

  test('in-review item carries its PR and next step', () => {
    expect(report.in_flight).toEqual([]);
    expect(report.in_review).toEqual([
      {
        issue: 298,
        title: 'Cashflow v3 epic',
        phase: 'review',
        status: 'in-flight',
        pr: 42,
        notes: null,
        next_step: 'Review PR #42 (review iteration 1)',
      },
    ]);
  });

  test('blocked items grouped by what they wait on', () => {
    expect(report.blocked).toHaveLength(1);
    expect(report.blocked[0]).toMatchObject({ waits_on: 'overlap', owner: false, count: 1 });
    expect(report.blocked[0].issues.map((i) => i.issue)).toEqual([301]);
    expect(report.waiting_on_owner).toEqual([]);
  });

  test('ready set and open ledger in dashboard order', () => {
    expect(report.ready).toEqual([]);
    expect(report.ledger_open.map((f) => f.id)).toEqual(['F-00001', 'F-00003']);
    expect(report.ledger_open[0]).toEqual({
      id: 'F-00001',
      vcode: 'V-DRY-01',
      severity: 'BLOCK',
      summary: 'Duplicated money formatting logic',
      issue_ref: 298,
    });
  });

  test('host line and forge pass through', () => {
    expect(report.forge).toEqual(FORGE_OK);
    expect(report.host).toEqual({ pace: null, notes: [] });
  });

  test('round-trips through JSON unchanged', () => {
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  test('no checkpoint file ⇒ null turn and empty event lists', () => {
    const bare = reportFor(fixtureCampaign(false));
    expect(bare.checkpoint).toEqual({
      turn: null,
      refreshed_at: null,
      last_completed_phase: null,
      notes: [],
      active_workers: [],
    });
  });
});

describe('buildStatusReport — wait-reason grouping', () => {
  const queue: QueueJson = {
    issues: {
      '10': { title: 'gate', status: 'blocked', phase: 'plan', notes: 'awaiting-plan-approval' },
      '11': { title: 'gate 2', status: 'blocked', phase: 'plan', notes: 'awaiting-plan-approval' },
      '12': { title: 'esc', status: 'blocked', phase: 'implement', notes: 'blocked-escalated:Permanent:flaky' },
      '13': { title: 'dep', status: 'blocked', phase: 'handle', depends_on: [14] },
      '14': { title: 'parent', status: 'in-flight', phase: 'implement', pr: 7 },
      '15': { title: 'conflict', status: 'blocked', phase: 'review', notes: 'merge-conflict-semantic:a.ts' },
      '16': { title: 'odd', status: 'blocked', phase: 'handle', notes: 'something else' },
      '17': { title: 'next', status: 'ready', phase: 'handle' },
    },
  };
  const report = buildStatusReport({
    config: {},
    queue,
    ledger: { findings: [] },
    checkpoint: {},
    checkpointBody: '',
    forge: FORGE_OK,
    paceLine: 'pace: GO',
    hostNotes: ['drift line'],
    generatedAt: GENERATED_AT,
  });

  test('groups and counts', () => {
    const summary = report.blocked.map((g) => [g.waits_on, g.owner, g.count, g.issues.map((i) => i.issue)]);
    expect(summary).toEqual([
      ['awaiting-plan-approval', true, 2, [10, 11]],
      ['blocked-escalated', true, 1, [12]],
      ['dependency', false, 1, [13]],
      ['merge-conflict', false, 1, [15]],
      ['other', false, 1, [16]],
    ]);
  });

  test('owner-cleared items are surfaced as waiting on the owner', () => {
    expect(report.waiting_on_owner.map((i) => i.issue)).toEqual([10, 11, 12]);
    expect(report.waiting_on_owner[0].next_step).toBe('Owner: approve the plan');
  });

  test('in-flight next step names the PR; ready set and host lines', () => {
    expect(report.in_flight.map((i) => [i.issue, i.next_step])).toEqual([[14, 'Implement: update PR #7']]);
    expect(report.ready.map((i) => i.issue)).toEqual([17]);
    expect(report.host).toEqual({ pace: 'pace: GO', notes: ['drift line'] });
  });
});

describe('text dashboard and JSON report the same counts', () => {
  function dashboardCounts(text: string) {
    const q = text.match(/\*\*Queue:\*\* (\d+) active · (\d+) done · (\d+) in-flight · (\d+) blocked · (\d+) ready(?: · (\d+) unclassified)?/);
    const l = text.match(/\*\*Ledger:\*\* (\d+) open \(BLOCK (\d+) · WARN (\d+) · NOTE (\d+)\) · (\d+) deferred/);
    if (!q || !l) throw new Error(`dashboard count lines not found:\n${text}`);
    const [active, done, in_flight, blocked, ready, unclassified] = q.slice(1).map((n) => Number(n ?? 0));
    const [open, block, warn, note, deferred] = l.slice(1).map(Number);
    return { queue: { active, done, in_flight, blocked, ready, unclassified }, ledger: { open, block, warn, note, deferred } };
  }

  test('fixture campaign', () => {
    const dir = fixtureCampaign();
    const state = loadCampaignState(dir);
    const text = formatDashboard({ ...state, forge: FORGE_OK });
    const report = reportFor(dir);
    const { by_status: _ignored, ...queueCounts } = report.counts.queue;
    expect(dashboardCounts(text)).toEqual({ queue: queueCounts, ledger: report.counts.ledger });
  });

  test('synthetic 40-issue campaign with mixed statuses and severities', () => {
    const statuses = ['ready', 'blocked', 'in-flight', 'merged', 'closed', 'in-review'];
    const issues: QueueJson['issues'] = {};
    for (let i = 1; i <= 40; i++) issues[String(i)] = { title: `t${i}`, status: statuses[i % 6], phase: 'plan' };
    const severities = ['BLOCK', 'WARN', 'NOTE', 'INFO'];
    const findings = Array.from({ length: 23 }, (_, i) => ({
      id: `F-${i}`,
      vcode: 'V-X',
      severity: severities[i % 4],
      status: i % 3 === 0 ? 'deferred' : 'open',
    }));
    const input = { config: {}, queue: { issues }, ledger: { findings }, checkpoint: {}, checkpointBody: '' };
    const text = formatDashboard({ ...input, forge: FORGE_OK });
    const report = buildStatusReport({ ...input, forge: FORGE_OK, paceLine: null, hostNotes: [], generatedAt: GENERATED_AT });
    const { by_status: _ignored, ...queueCounts } = report.counts.queue;
    expect(dashboardCounts(text)).toEqual({ queue: queueCounts, ledger: report.counts.ledger });
  });
});

describe('parseStatusArgs — report modes', () => {
  test('--json selects the json mode', () => {
    expect(parseStatusArgs(['--json']).mode).toBe('json');
  });

  test('--html defaults its output path to null (resolved under the campaign dir)', () => {
    const args = parseStatusArgs(['--html', '--no-gh']);
    expect(args).toMatchObject({ mode: 'html', skipGh: true, outPath: null });
  });

  test('--out resolves against the working directory', () => {
    expect(parseStatusArgs(['--html', '--out', 'page.html']).outPath).toBe(path.join(process.cwd(), 'page.html'));
    expect(parseStatusArgs(['--html', '--out', '/abs/page.html']).outPath).toBe('/abs/page.html');
  });

  test('--json and --html together is an error, not a silent pick', () => {
    expect(() => parseStatusArgs(['--json', '--html'])).toThrow(/either --json or --html/);
  });

  test('--out without --html is an error', () => {
    expect(() => parseStatusArgs(['--out', 'x.html'])).toThrow(/--out requires --html/);
  });
});

describe('buildStatusReport — ready_to_merge', () => {
  const queue: QueueJson = {
    issues: {
      '1': { title: 'delivered', status: 'in-flight', phase: 'review', pr: 11, notes: 'delivered-at-LGTM (leave-open) — awaiting human merge' },
      '2': { title: 'still reviewing', status: 'in-flight', phase: 'review', pr: 12, notes: null },
      '3': { title: 'delivered, no pr', status: 'in-flight', phase: 'review', notes: 'delivered-at-LGTM (leave-open)' },
      '4': { title: 'merged already', status: 'merged', phase: 'done', pr: 13, notes: 'delivered-at-LGTM (leave-open)' },
    },
  };
  const build = (config: Record<string, unknown>, forgeWeb?: { forge: string; host: string | null }) =>
    buildStatusReport({
      config: { repo: 'acme/widgets', ...config },
      queue,
      ledger: {},
      checkpoint: {},
      forge: FORGE_OK,
      paceLine: null,
      hostNotes: [],
      generatedAt: GENERATED_AT,
      forgeWeb,
    });

  test('only an open PR delivered at LGTM is ready; the URL is the GitHub PR page', () => {
    const r = build({});
    expect(r.ready_to_merge.map((i) => i.issue)).toEqual([1]);
    expect(r.ready_to_merge[0].pr_url).toBe('https://github.com/acme/widgets/pull/11');
    expect(r.ready_to_merge[0].pr).toBe(11);
  });

  test('Gitea uses the origin host and /pulls/', () => {
    const r = build({ forge: 'gitea' }, { forge: 'gitea', host: 'git.example.org' });
    expect(r.ready_to_merge[0].pr_url).toBe('https://git.example.org/acme/widgets/pulls/11');
  });

  test('a forge whose PR URL cannot be built yields no ready item rather than a bad link', () => {
    expect(build({ forge: 'gitea' }, { forge: 'gitea', host: null }).ready_to_merge).toEqual([]);
    expect(build({}, { forge: 'gitlab', host: 'gitlab.com' }).ready_to_merge).toEqual([]);
  });

  test('a repo that is not owner/name yields no link', () => {
    expect(build({ repo: 'x"><script>' }).ready_to_merge).toEqual([]);
  });
});

describe('buildStatusReport — state banner and recently_done', () => {
  const NOW = '2026-11-12T12:00:00.000Z';
  const build = (queue: QueueJson, over: Partial<Parameters<typeof buildStatusReport>[0]> = {}) =>
    buildStatusReport({
      config: { repo: 'acme/widgets' },
      queue: { refreshed_at: '2026-11-12T11:50:00.000Z', ...queue },
      ledger: {},
      checkpoint: { orchestrator_turn_id: 3, refreshed_at: '2026-11-12T11:56:00.000Z' },
      checkpointBody: '',
      forge: FORGE_OK,
      paceLine: null,
      hostNotes: [],
      generatedAt: NOW,
      ...over,
    });

  test('RUNNING when the checkpoint names an active worker', () => {
    const r = build(
      { issues: { '1': { title: 'a', status: 'in-flight', phase: 'implement' } } },
      { checkpointBody: '## In-flight workers\n\n- implementer on #1\n- reviewer on #2\n' },
    );
    expect(r.state.kind).toBe('running');
    expect(r.state.reason).toBe('2 workers active');
    expect(r.state.last_activity_at).toBe('2026-11-12T11:56:00.000Z');
    expect(r.state.next_action).toBe('Nothing — the campaign is running on its own.');
  });

  test('RUNNING when an issue is in flight with a fresh checkpoint and no worker lines', () => {
    const r = build({ issues: { '1': { title: 'a', status: 'in-flight', phase: 'plan' } } });
    expect(r.state.kind).toBe('running');
    expect(r.state.reason).toBe('1 issue in flight');
  });

  test('WAITING ON YOU when nothing runs and the owner has an item; next action is its next step', () => {
    const r = build({
      issues: { '5': { title: 'gate', status: 'blocked', phase: 'plan', notes: 'awaiting-plan-approval' } },
    });
    expect(r.state.kind).toBe('waiting_on_you');
    expect(r.state.next_action).toBe('Owner: approve the plan (#5)');
  });

  test('a PR delivered at LGTM counts as waiting on you, not as work in flight', () => {
    const r = build({
      issues: { '7': { title: 'x', status: 'in-flight', phase: 'review', pr: 21, notes: 'delivered-at-LGTM' } },
    });
    expect(r.state.kind).toBe('waiting_on_you');
    expect(r.state.next_action).toBe('Review and merge PR #21 (#7)');
  });

  test('IDLE when only the ready set is non-empty', () => {
    const r = build({ issues: { '2': { title: 'n', status: 'ready', phase: 'handle' } } });
    expect(r.state.kind).toBe('idle');
  });

  test('DONE when no issue is active', () => {
    const r = build({ issues: { '2': { title: 'n', status: 'merged', phase: 'review', pr: 3 } } });
    expect(r.state.kind).toBe('done');
  });

  test('STALE wins over RUNNING when the newest state write is older than the threshold', () => {
    const r = build(
      { refreshed_at: '2026-11-11T19:00:00.000Z', issues: { '1': { title: 'a', status: 'in-flight', phase: 'implement' } } },
      { checkpoint: { orchestrator_turn_id: 3, refreshed_at: '2026-11-11T18:00:00.000Z' } },
    );
    expect(r.state.kind).toBe('stale');
    expect(r.state.underlying).toBe('running');
    expect(r.state.last_activity_at).toBe('2026-11-11T19:00:00.000Z');
    expect(r.state.stale_hours).toBe(17);
    expect(r.state.reason).toContain('17h ago');
  });

  test('the newest of checkpoint and queue timestamps decides staleness', () => {
    const r = build(
      { refreshed_at: '2026-11-12T11:30:00.000Z', issues: { '1': { title: 'a', status: 'in-flight', phase: 'plan' } } },
      { checkpoint: { orchestrator_turn_id: 3, refreshed_at: '2026-11-10T00:00:00.000Z' } },
    );
    expect(r.state.kind).toBe('running');
  });

  test('no timestamp at all is STALE, never live', () => {
    const r = build({ refreshed_at: undefined, issues: {} }, { checkpoint: {} });
    expect(r.state.kind).toBe('stale');
    expect(r.state.last_activity_at).toBeNull();
  });

  test('recently_done lists merged/closed items, highest PR then issue number first, capped at 5', () => {
    const issues: QueueJson['issues'] = {};
    for (let i = 1; i <= 7; i++) issues[String(i)] = { title: `t${i}`, status: 'merged', pr: 100 + i };
    issues['8'] = { title: 'closed-no-pr', status: 'closed' };
    const r = build({ issues });
    expect(r.recently_done.map((i) => i.issue)).toEqual([7, 6, 5, 4, 3]);
  });

  test.each(['none', '- none', '(none)', '-', 'N/A', '  None  '])(
    'the empty marker %p under In-flight workers is not a worker',
    (marker) => {
      const r = build(
        { issues: { '1': { title: 'a', status: 'ready', phase: 'handle' } } },
        { checkpointBody: `## In-flight workers\n\n${marker}\n` },
      );
      expect(r.checkpoint.active_workers).toEqual([]);
      expect(r.state.kind).toBe('idle');
    },
  );

  test('worker lines lose their list bullet in checkpoint.active_workers and still count', () => {
    const r = build(
      { issues: { '1': { title: 'a', status: 'in-flight', phase: 'plan' } } },
      { checkpointBody: '## In-flight workers\n\n- implementer on #1\n* reviewer on #2\n' },
    );
    expect(r.checkpoint.active_workers).toEqual(['implementer on #1', 'reviewer on #2']);
    expect(r.state.reason).toBe('2 workers active');
  });

  const OWNER_NOTE = 'PR #4872 (MCP-8 write path) needs your approving review; standing auth does not cover it';
  const REAL_OWNER_ITEM: QueueJson = {
    issues: { '4206': { title: 'MCP-8', status: 'blocked', phase: 'review', pr: 4872, notes: `awaiting-owner-review: ${OWNER_NOTE}` } },
  };

  test('next_action for an owner item built from its note, without the gate token or its colon', () => {
    const r = build(REAL_OWNER_ITEM);
    expect(r.state.next_action).toBe(`${OWNER_NOTE} (#4206)`);
    expect(r.waiting_on_owner[0].next_step).not.toContain('awaiting-owner-review:');
  });

  test('the owner gate token is grouped without its trailing colon', () => {
    expect(build(REAL_OWNER_ITEM).blocked[0].waits_on).toBe('awaiting-owner-review');
  });

  test('an owner item with only the bare gate token falls back to its next step', () => {
    const r = build({ issues: { '5': { title: 'g', status: 'blocked', phase: 'plan', notes: 'awaiting-plan-approval' } } });
    expect(r.state.next_action).toBe('Owner: approve the plan (#5)');
  });

  test('waiting_on_owner items carry a pr_url when they have a PR', () => {
    const r = build({
      issues: { '5': { title: 'g', status: 'blocked', phase: 'review', pr: 9, notes: 'awaiting-user-clarification' } },
    });
    expect(r.waiting_on_owner[0].pr_url).toBe('https://github.com/acme/widgets/pull/9');
  });
});

describe('buildStatusReport — blocked reason classes', () => {
  const cursor = { status: 'blocked', phase: 'handle', labels: ['in-progress:cursor', 'agent:cursor'] };
  const queue: QueueJson = {
    issues: {
      '1': { ...cursor, title: 'cursor a', notes: 'cursor lane: not ours, skipped' },
      '2': { title: 'cursor b', status: 'blocked', labels: ['agent:cursor'], notes: 'agent:cursor + needs-owner' },
      '3': { title: 'ours', status: 'blocked', labels: ['agent:claude'], notes: 'taken: cursor draft PR is open' },
      '4': { title: 'track', status: 'blocked', notes: 'ingested; tracking issue, stays open' },
      '5': { title: 'seq', status: 'blocked', notes: 'owner: phases run in sequence. P13 returns to the owner' },
      '6': { title: 'upstream', status: 'blocked', notes: 'upstream: waits for a release' },
      '7': { title: 'dep', status: 'blocked', depends_on: [8] },
      '8': { title: 'parent', status: 'in-flight', phase: 'implement' },
      '9': { title: 'odd', status: 'blocked', notes: 'needs vendor answer' },
      '10': { title: 'gate', status: 'blocked', notes: 'awaiting-plan-approval' },
      '11': { title: 'foreign tracking', status: 'blocked', labels: ['in-progress:cursor'], notes: 'tracking issue, stays open' },
    },
  };
  const report = buildStatusReport({
    config: {},
    queue,
    ledger: { findings: [] },
    checkpoint: {},
    checkpointBody: '',
    forge: FORGE_OK,
    paceLine: null,
    hostNotes: [],
    generatedAt: GENERATED_AT,
  });

  test('every blocked non-owner item lands in exactly one class, in a fixed order', () => {
    expect(report.blocked_classes.map((c) => [c.class, c.count, c.issues.map((i) => i.issue)])).toEqual([
      ['tracking_issue', 1, [4]],
      ['dependency', 2, [6, 7]],
      ['sequenced_phase', 1, [5]],
      ['other', 2, [3, 9]],
      ['another_lane', 3, [1, 2, 11]],
    ]);
  });

  test('counts sum to the blocked non-owner total and owner gates are excluded', () => {
    const total = report.blocked.filter((g) => !g.owner).reduce((n, g) => n + g.count, 0);
    expect(report.blocked_classes.reduce((n, c) => n + c.count, 0)).toBe(total);
    expect(report.blocked_classes.flatMap((c) => c.issues.map((i) => i.issue))).not.toContain(10);
  });

  test('a foreign lane label beats the note, and the campaign own lanes (claude, blackhole) are not foreign', () => {
    const lane = report.blocked_classes.find((c) => c.class === 'another_lane');
    expect(lane?.issues.map((i) => i.issue)).toContain(11);
    expect(lane?.issues.map((i) => i.issue)).not.toContain(3);
  });

  test('the existing blocked groups are unchanged and schema_version stays 1', () => {
    expect(report.schema_version).toBe(1);
    expect(report.blocked.map((g) => g.waits_on)).toContain('awaiting-plan-approval');
  });
});

describe('classifyBlocked — precedence and the owner-addressed note', () => {
  const classify = (notes: string, extra: Partial<QueueJson['issues'][string]> = {}) =>
    classifyBlocked({ status: 'blocked', notes, ...extra }, {});

  test('tracking issue beats in sequence', () => {
    expect(classify('tracking issue, phases run in sequence')).toBe('tracking_issue');
  });
  test('in sequence beats upstream', () => {
    expect(classify('phases run in sequence, waits on upstream release')).toBe('sequenced_phase');
  });
  test('a mid-note "still depends on X" with no depends_on is a dependency', () => {
    expect(classify('blocked: still depends on the zod release')).toBe('dependency');
  });
  test('matching is case-insensitive', () => {
    expect(classify('Tracking Issue, stays open')).toBe('tracking_issue');
  });
  test('a foreign lane label beats every note', () => {
    expect(classify('tracking issue', { labels: ['agent:cursor'] })).toBe('another_lane');
  });
  test('merge conflict and overlap keep their own class and label', () => {
    expect(classify('merge-conflict-semantic:a.ts')).toBe('merge_conflict');
    expect(classify('overlap with #12')).toBe('overlap');
  });

  test('a class holding a note that addresses the owner is flagged for attention; a lane class never is', () => {
    const q: QueueJson = {
      issues: {
        '1': { title: 'a', status: 'blocked', notes: 'owner: pick a vendor' },
        '2': { title: 'b', status: 'blocked', notes: 'waits, needs-owner call' },
        '3': { title: 'c', status: 'blocked', notes: 'quiet wait' },
        '4': { title: 'd', status: 'blocked', labels: ['agent:cursor'], notes: 'needs-owner — not Claude lane' },
      },
    };
    const r = buildStatusReport({
      config: {}, queue: q, ledger: { findings: [] }, checkpoint: {}, checkpointBody: '',
      forge: FORGE_OK, paceLine: null, hostNotes: [], generatedAt: GENERATED_AT,
    });
    expect(r.blocked_classes.map((c) => [c.class, c.attention])).toEqual([
      ['other', true],
      ['another_lane', false],
    ]);
  });
});

describe('buildStatusReport — a PR held for the owner (needs-chef)', () => {
  const queue: QueueJson = {
    issues: {
      '1': { title: 'held for the owner', status: 'in-flight', phase: 'review', pr: 21, notes: 'needs-chef: workflows, security' },
      '2': { title: 'delivered', status: 'in-flight', phase: 'review', pr: 22, notes: 'delivered-at-LGTM (leave-open)' },
      '3': { title: 'still reviewing', status: 'in-flight', phase: 'review', pr: 23, notes: null },
      '4': { title: 'held, no pr', status: 'in-flight', phase: 'review', notes: 'needs-chef: security' },
      '5': { title: 'held, bare marker', status: 'in-flight', phase: 'review', pr: 25, notes: 'needs-chef' },
      '6': { title: 'mentions it mid-note', status: 'in-flight', phase: 'review', pr: 26, notes: 'turn 9: was needs-chef: security' },
    },
  };
  const r = buildStatusReport({
    config: { repo: 'acme/widgets' },
    queue,
    ledger: {},
    checkpoint: {},
    forge: FORGE_OK,
    paceLine: null,
    hostNotes: [],
    generatedAt: GENERATED_AT,
  });

  test('a needs-chef PR waits on the owner, with the categories it is held for', () => {
    expect(r.ready_to_merge.map((i) => i.issue)).toEqual([1, 2, 5]);
    expect(r.ready_to_merge[0]).toMatchObject({ pr: 21, held_for: 'workflows, security', pr_url: 'https://github.com/acme/widgets/pull/21' });
    expect(r.ready_to_merge[1].held_for).toBeUndefined();
    expect(r.ready_to_merge[2].held_for).toBe('');
  });

  test('the marker counts only at the start of the note, and only with a PR', () => {
    expect(r.ready_to_merge.some((i) => i.issue === 4 || i.issue === 6)).toBe(false);
  });

  test('a held PR is not shown as work in progress', () => {
    expect(inProgressItems(r).map((i) => i.issue)).toEqual([3, 4, 6]);
  });

  test('the detail line says why it is held; a delivered PR keeps its own line', () => {
    expect(readyToMergeDetail(r.ready_to_merge[0])).toBe('Held for your decision (workflows, security) — review and merge');
    expect(readyToMergeDetail(r.ready_to_merge[1])).toBe(READY_TO_MERGE_DETAIL);
    expect(readyToMergeDetail(r.ready_to_merge[2])).toBe('Held for your decision — review and merge');
  });

  test('the dashboard dataset lists it under waiting on you with its own kind', () => {
    const rows = buildStatusData(r).waiting_on_you;
    expect(rows[0]).toMatchObject({ issue: 1, kind: 'needs your decision', pr: 21, detail: 'Held for your decision (workflows, security) — review and merge' });
    expect(rows[1]).toMatchObject({ issue: 2, kind: 'ready to merge', detail: READY_TO_MERGE_DETAIL });
  });

  test('with nothing else running, the campaign state is waiting on you', () => {
    const only = buildStatusReport({
      config: { repo: 'acme/widgets' },
      queue: { issues: { '1': queue.issues!['1'] } },
      ledger: {},
      checkpoint: { refreshed_at: GENERATED_AT },
      forge: FORGE_OK,
      paceLine: null,
      hostNotes: [],
      generatedAt: GENERATED_AT,
    });
    expect(only.state.underlying).toBe('waiting_on_you');
    expect(only.state.next_action).toBe('Review and merge PR #21 (#1)');
  });
});

describe('buildStatusReport — entries no section claims, and PRs no entry names', () => {
  const queue: QueueJson = {
    issues: {
      '1': { title: 'written with an undocumented status', status: 'in-review', phase: 'review', pr: 31 },
      '2': { title: 'no status at all', phase: 'plan' },
      '3': { title: 'tracked', status: 'in-flight', phase: 'implement', pr: 32 },
      '4': { title: 'done', status: 'merged', phase: 'done', pr: 30 },
    },
  };
  const build = (forge: ForgeCounts) =>
    buildStatusReport({
      config: { repo: 'acme/widgets' }, queue, ledger: {}, checkpoint: {}, forge, paceLine: null, hostNotes: [], generatedAt: GENERATED_AT,
    });
  const online = build({
    openIssues: 3,
    openPrs: 4,
    openPrList: [
      { number: 40, title: 'chore: bump a dependency' },
      { number: 31, title: 'undocumented status PR' },
      { number: 32, title: 'tracked PR' },
      { number: 35, title: 'fix: trunk build' },
    ],
    ok: true,
  });

  test('an active entry with an unknown or missing status is counted and listed, not dropped', () => {
    expect(online.counts.queue.active).toBe(3);
    expect(online.counts.queue.unclassified).toBe(2);
    expect(online.unclassified.map((i) => i.issue)).toEqual([1, 2]);
    expect(online.unclassified[0].next_step).toBe('Fix the queue entry: status "in-review" is not one of blocked, ready, in-flight, merged, closed');
    expect(online.unclassified[1].next_step).toContain('status is missing');
    const sectioned = [...online.in_flight, ...online.in_review, ...online.ready, ...online.blocked.flatMap((g) => g.issues)];
    expect(sectioned.map((i) => i.issue)).toEqual([3]);
  });

  test('open PRs that no queue entry names are listed, lowest number first', () => {
    expect(online.untracked_prs).toEqual([
      { pr: 35, title: 'fix: trunk build' },
      { pr: 40, title: 'chore: bump a dependency' },
    ]);
  });

  test('offline (no PR list) the untracked list is null, never a clean empty', () => {
    expect(build({ openIssues: 0, openPrs: 0, ok: false, error: 'skipped' }).untracked_prs).toBeNull();
    expect(build(FORGE_OK).untracked_prs).toBeNull();
  });

  test('both reach the dashboard data, the text dashboard and the HTML page', () => {
    const data = buildStatusData(online);
    expect(data.waiting_else.map((c) => [c.kind, c.count])).toEqual([
      ['unclassified', 2],
      ['untracked_pr', 2],
    ]);
    expect(data.waiting_else_items.filter((i) => i.class === 'untracked_pr').map((i) => i.pr)).toEqual([35, 40]);
    const text = formatDashboard({ checkpoint: {}, queue, ledger: {}, forge: FORGE_OK });
    expect(text).toContain('2 unclassified');
    expect(text).toContain('### Unclassified');
    expect(text).toContain('#1');
    const html = renderStatusHtml(online);
    expect(html).toContain('Unknown queue status');
    expect(html).toContain('Open PR with no queue entry');
    expect(html).toContain('fix: trunk build');
  });
});
