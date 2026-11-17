import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectStatusReport } from './campaign-status.ts';
import { runForgeSync, summaryLine, type ForgeSyncOutcome } from './forge-sync.ts';
import type { SyncResult } from './lib/forge-sync.ts';
import { fakeForge, prRow } from './lib/campaign-status/forge-fake.ts';
import type { ForgeIssue } from './lib/forge-adapter/types.ts';

const NOW = '2026-11-17T12:00:00.000Z';
const issue = (number: number, extra: Partial<ForgeIssue> = {}): ForgeIssue => ({ number, title: `Issue ${number}`, body: '', labels: [], milestone: null, state: 'OPEN', ...extra });

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sync-'));
  fs.mkdirSync(path.join(dir, '.blackhole'));
  fs.writeFileSync(path.join(dir, '.blackhole', 'config.json'), JSON.stringify({ repo: 'acme/widgets', forge: 'gitea', merge_mode: 'leave-open' }));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const campaign = (): string => path.join(dir, '.blackhole');
const synced = (r: ForgeSyncOutcome): SyncResult => {
  if ('skipped' in r) throw new Error(`skipped: ${r.skipped}`);
  return r;
};
const read = (name: string): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(campaign(), name), 'utf8'));

describe('forge-sync from a fresh checkout (only config.json)', () => {
  const forge = () =>
    fakeForge({
      issues: [issue(1, { title: 'Add export' }), issue(2, { title: 'Fix login', body: 'Blocked by #1' })],
      prs: { all: [prRow(10, { headRefName: 'blackhole/issue-1-export', body: 'Closes #1' })], open: [prRow(10, { headRefName: 'blackhole/issue-1-export', body: 'Closes #1' })] },
      views: { 10: prRow(10, { headRefName: 'blackhole/issue-1-export', body: 'Closes #1' }) },
      checks: { 10: [] },
    });

  test('writes queue.json and an empty ledger, with the forge issues and the linked PR', async () => {
    const result = synced(await runForgeSync(campaign(), { adapter: forge(), now: NOW }));
    expect(result.added).toEqual([1, 2]);
    const queue = read('queue.json') as { refreshed_at: string; issues: Record<string, { status: string; pr: number | null; depends_on: number[] }> };
    expect(queue.refreshed_at).toBe(NOW);
    expect(queue.issues['1']).toMatchObject({ status: 'ready', pr: 10 });
    expect(queue.issues['2']).toMatchObject({ status: 'ready', depends_on: [1] });
    expect(read('findings-ledger.json')).toEqual({ refreshed_at: NOW, next_id: 1, findings: [] });
  });

  test('the status page then renders those issues', async () => {
    const adapter = forge();
    await runForgeSync(campaign(), { adapter, now: NOW });
    const { report } = await collectStatusReport(campaign(), false, NOW, adapter);
    expect(report.forge.ok).toBe(true);
    expect(report.board.map((c) => c.issue).filter((n) => n !== null).sort()).toEqual([1, 2]);
    expect(report.stage_counts.total).toBe(2);
  });

  test('a second run keeps the entries, ingests nothing new and leaves the ledger alone', async () => {
    await runForgeSync(campaign(), { adapter: forge(), now: NOW });
    fs.writeFileSync(path.join(campaign(), 'findings-ledger.json'), JSON.stringify({ next_id: 2, findings: [{ id: 'F-00001' }] }));
    const again = synced(await runForgeSync(campaign(), { adapter: forge(), now: '2026-11-17T13:00:00.000Z' }));
    expect(again.added).toEqual([]);
    expect(Object.keys(read('queue.json').issues as object)).toEqual(['1', '2']);
    expect(read('findings-ledger.json')).toEqual({ next_id: 2, findings: [{ id: 'F-00001' }] });
  });

  test('a live entry closed on the forge is read from the closed list', async () => {
    await runForgeSync(campaign(), { adapter: forge(), now: NOW });
    // No merged PR names #1: only the closed-issue list can tell the sync it is done.
    const closing = fakeForge({ issues: [issue(1, { state: 'CLOSED' }), issue(2)], prs: { all: [] } });
    const r = synced(await runForgeSync(campaign(), { adapter: closing, now: NOW }));
    expect(closing.calls.filter((c) => c === 'issueList')).toHaveLength(2);
    expect(r.closed).toEqual([1]);
    expect((read('queue.json').issues as Record<string, unknown>)['1']).toMatchObject({ status: 'closed', phase: 'done' });
  });

  test('a failed forge read writes nothing', async () => {
    await expect(runForgeSync(campaign(), { adapter: fakeForge({ issues: [issue(1)] }), now: NOW })).rejects.toThrow(/prList/);
    expect(fs.existsSync(path.join(campaign(), 'queue.json'))).toBe(false);
    expect(fs.existsSync(path.join(campaign(), 'findings-ledger.json'))).toBe(false);
  });

  test('dry run returns the queue without writing it', async () => {
    const r = synced(await runForgeSync(campaign(), { adapter: forge(), now: NOW, dryRun: true }));
    expect(Object.keys(r.queue.issues)).toEqual(['1', '2']);
    expect(fs.existsSync(path.join(campaign(), 'queue.json'))).toBe(false);
  });

  test('no config.json is refused', async () => {
    fs.rmSync(path.join(campaign(), 'config.json'));
    await expect(runForgeSync(campaign(), { adapter: forge(), now: NOW })).rejects.toThrow(/No .*config\.json/);
  });

  test('the summary line names the scope and the changes', async () => {
    const r = synced(await runForgeSync(campaign(), { adapter: forge(), now: NOW, dryRun: true }));
    expect(summaryLine(r, { milestone: 'v1' })).toBe('Forge sync (scope: milestone v1): 2 in queue, +2 new (#1, #2), 0 closed, 1 PR linked (#1)');
  });

  test('writes go through the state write guard: the live queue is snapshotted into archive/', async () => {
    await runForgeSync(campaign(), { adapter: forge(), now: NOW });
    await runForgeSync(campaign(), { adapter: forge(), now: NOW });
    const archived = fs.readdirSync(path.join(campaign(), 'archive')).filter((f) => f.startsWith('queue-'));
    expect(archived.length).toBeGreaterThanOrEqual(1);
  });

  test('the guard refuses a candidate a raw write would install, and the live queue is left as it was', async () => {
    // syncQueue never removes an entry, so a collapse to zero cannot be produced here; an entry with an
    // undocumented status is the refusal the guard adds over a plain write.
    const live = JSON.stringify({ issues: { '1': { title: 'x', status: 'parked-by-hand', phase: 'handle' } } });
    fs.writeFileSync(path.join(campaign(), 'queue.json'), live);
    await expect(runForgeSync(campaign(), { adapter: forge(), now: NOW })).rejects.toThrow(/Refused to write .*queue\.json.*parked-by-hand/);
    expect(fs.readFileSync(path.join(campaign(), 'queue.json'), 'utf8')).toBe(live);
  });

  test('a queue write made while the forge was being read is kept', async () => {
    const base = forge();
    const adapter = Object.assign(Object.create(base), {
      async prList(filter: { state?: 'open' | 'closed' | 'all'; limit?: number }) {
        fs.writeFileSync(path.join(campaign(), 'queue.json'), JSON.stringify({ issues: { '99': { title: 'orchestrator wrote me', status: 'in-flight', phase: 'implement' } } }));
        return base.prList(filter);
      },
    });
    synced(await runForgeSync(campaign(), { adapter, now: NOW }));
    const issues = read('queue.json').issues as Record<string, { status: string }>;
    expect(Object.keys(issues).sort()).toEqual(['1', '2', '99']);
    expect(issues['99'].status).toBe('in-flight');
  });

  test('auto_sync false reads nothing and writes nothing', async () => {
    fs.writeFileSync(path.join(campaign(), 'config.json'), JSON.stringify({ repo: 'acme/widgets', auto_sync: false }));
    const adapter = forge();
    expect(await runForgeSync(campaign(), { adapter, now: NOW })).toEqual({ skipped: expect.stringContaining('auto_sync is false') });
    expect(adapter.calls).toEqual([]);
    expect(fs.existsSync(path.join(campaign(), 'queue.json'))).toBe(false);
  });

  test('the new ledger is written through the guard too (no stray .tmp left)', async () => {
    await runForgeSync(campaign(), { adapter: forge(), now: NOW });
    expect(fs.readdirSync(campaign()).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
