import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseStatusArgs } from './cli.ts';
import { formatDashboard } from './dashboard.ts';
import { buildStatusReport } from './report.ts';
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
      active_workers: ['- reviewer on #298 PR 42 (spawned turn 12)'],
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
    const q = text.match(/\*\*Queue:\*\* (\d+) active · (\d+) done · (\d+) in-flight · (\d+) blocked · (\d+) ready/);
    const l = text.match(/\*\*Ledger:\*\* (\d+) open \(BLOCK (\d+) · WARN (\d+) · NOTE (\d+)\) · (\d+) deferred/);
    if (!q || !l) throw new Error(`dashboard count lines not found:\n${text}`);
    const [active, done, in_flight, blocked, ready] = q.slice(1).map(Number);
    const [open, block, warn, note, deferred] = l.slice(1).map(Number);
    return { queue: { active, done, in_flight, blocked, ready }, ledger: { open, block, warn, note, deferred } };
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
    const statuses = ['ready', 'blocked', 'in-flight', 'merged', 'closed'];
    const issues: QueueJson['issues'] = {};
    for (let i = 1; i <= 40; i++) issues[String(i)] = { title: `t${i}`, status: statuses[i % 5], phase: 'plan' };
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
