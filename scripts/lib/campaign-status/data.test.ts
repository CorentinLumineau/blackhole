import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildStatusData, STATUS_DATASET_IDS, writeStatusData } from './data.ts';
import { parseStatusArgs } from './cli.ts';
import { buildStatusReport } from './report.ts';
import { STALE_AFTER_HOURS } from './staleness.ts';
import type { QueueJson, StatusReport } from './types.ts';

const QUEUE: QueueJson = {
  refreshed_at: '2026-11-11T11:00:00.000Z',
  issues: {
    '1': { title: 'gate', status: 'blocked', phase: 'plan', notes: 'awaiting-plan-approval' },
    '2': { title: 'motion', status: 'in-flight', phase: 'implement' },
    '3': { title: 'review me', status: 'in-flight', phase: 'review', pr: 9 },
    '4': { title: 'delivered', status: 'in-flight', phase: 'review', pr: 10, notes: 'delivered-at-LGTM (leave-open) — awaiting human merge' },
    '5': { title: 'dep a', status: 'blocked', phase: 'handle', depends_on: [2] },
    '6': { title: 'dep b', status: 'blocked', phase: 'handle', depends_on: [2] },
    '7': { title: 'dep c', status: 'blocked', phase: 'handle', depends_on: [2] },
    '8': { title: 'dep d', status: 'blocked', phase: 'handle', depends_on: [2] },
    '9': { title: 'next', status: 'ready', phase: 'handle' },
    '10': { title: 'old', status: 'merged', phase: 'done', pr: 5 },
  },
};

function report(): StatusReport {
  return buildStatusReport({
    config: { repo: 'acme/widgets', scope_milestone: 'v1.0' },
    queue: QUEUE,
    ledger: { findings: [{ id: 'F-1', vcode: 'V-SEC-04', severity: 'BLOCK', status: 'open', summary: 'leak', issue_ref: 3 }] },
    checkpoint: { orchestrator_turn_id: 7, refreshed_at: '2026-11-11T10:00:00.000Z' },
    checkpointBody: '---\norchestrator_turn_id: 7\n---\n\n## Notes\n\nMerged #2\n\n## In-flight workers\n\n- worker for #2\n',
    forge: { openIssues: 3, openPrs: 1, ok: true },
    paceLine: 'pace: GO (session 12%)',
    hostNotes: ['⚠ Plugin cache drift: layer 2'],
    generatedAt: '2026-11-11T12:00:00.000Z',
  });
}

describe('buildStatusData — one source with --json', () => {
  const r = report();
  const data = buildStatusData(r);

  test('summary is one row whose counts and state equal the report', () => {
    expect(data.summary).toHaveLength(1);
    const s = data.summary[0];
    expect(s).toMatchObject({
      turn: 7,
      state_kind: r.state.kind,
      state_reason: r.state.reason,
      last_activity_at: r.state.last_activity_at,
      next_action: r.state.next_action,
      generated_at: r.generated_at,
      finished: r.counts.queue.done,
      open: r.counts.queue.active,
      in_flight: r.counts.queue.in_flight,
      blocked: r.counts.queue.blocked,
      ready: r.counts.queue.ready,
      forge_open_issues: 3,
      forge_open_prs: 1,
      findings_open: r.counts.ledger.open,
    });
  });

  test('stale_after_hours is the one STALE_AFTER_HOURS constant', () => {
    expect(data.summary[0].stale_after_hours).toBe(STALE_AFTER_HOURS);
  });

  test('in_progress lists in-flight and in-review work, not the PR already delivered', () => {
    expect(data.in_progress.map((x) => x.issue)).toEqual([2, 3]);
    expect(data.in_progress.map((x) => x.stage)).toEqual(['in flight', 'in review']);
  });

  test('waiting_on_you carries the delivered PR with its link, then owner gates', () => {
    const [pr, gate] = data.waiting_on_you;
    expect(pr).toMatchObject({ issue: 4, kind: 'ready to merge', pr: 10, pr_url: r.ready_to_merge[0].pr_url });
    expect(String(pr.pr_url)).toMatch(/^https:\/\//);
    expect(gate).toMatchObject({ issue: 1, kind: 'owner gate', pr_url: null });
  });

  test('waiting_else has one row per reason class and the item rows add up to its counts', () => {
    expect(data.waiting_else.map((c) => c.kind)).toEqual(r.blocked_classes.map((c) => c.class));
    const dep = data.waiting_else.find((c) => c.kind === 'dependency');
    expect(dep).toMatchObject({ count: 4, attention: false, first_issues: '#5, #6, #7', more_count: 1 });
    for (const c of data.waiting_else) {
      expect(data.waiting_else_items.filter((i) => i.class === c.kind)).toHaveLength(Number(c.count));
    }
  });

  test('up_next, recently_done and notes come from the same report', () => {
    expect(data.up_next).toEqual([{ issue: 9, title: 'next' }]);
    expect(data.recently_done).toEqual([{ issue: 10, title: 'old', pr: 5 }]);
    const lines = data.notes.map((n) => `${n.kind}:${n.text}`);
    expect(lines).toContain('note:Merged #2');
    expect(lines).toContain('worker:worker for #2');
    expect(lines).toContain('host:pace: GO (session 12%)');
    expect(lines).toContain('host:⚠ Plugin cache drift: layer 2');
    expect(lines.some((l) => l.startsWith('finding:') && l.includes('V-SEC-04'))).toBe(true);
  });

  test('every dataset is an array of flat objects', () => {
    for (const id of STATUS_DATASET_IDS) {
      expect(Array.isArray(data[id])).toBe(true);
      for (const row of data[id]) {
        for (const v of Object.values(row)) expect(['string', 'number', 'boolean'].includes(typeof v) || v === null).toBe(true);
      }
    }
  });
});

describe('writeStatusData', () => {
  test('writes one <id>.json per dataset, parseable and equal to the built rows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-data-'));
    try {
      const r = report();
      const files = writeStatusData(dir, r);
      expect(files.map((f) => path.basename(f)).sort()).toEqual(STATUS_DATASET_IDS.map((id) => `${id}.json`).sort());
      const built = buildStatusData(r);
      for (const id of STATUS_DATASET_IDS) {
        expect(JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'))).toEqual(built[id]);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseStatusArgs --data', () => {
  test('--data selects the data mode and resolves the directory', () => {
    const args = parseStatusArgs(['--data', '/abs/out', '--no-gh']);
    expect(args).toMatchObject({ mode: 'data', dataDir: '/abs/out', skipGh: true });
  });

  test('--data is mutually exclusive with --json and --html', () => {
    expect(() => parseStatusArgs(['--data', 'd', '--json'])).toThrow(/only one of/);
    expect(() => parseStatusArgs(['--data', 'd', '--html'])).toThrow(/only one of/);
  });

  test('--out still requires --html', () => {
    expect(() => parseStatusArgs(['--data', 'd', '--out', 'x'])).toThrow(/--out requires --html/);
  });
});
