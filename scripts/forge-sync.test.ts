import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectStatusReport } from './campaign-status.ts';
import { runForgeSync, summaryLine } from './forge-sync.ts';
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
const read = (name: string): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(campaign(), name), 'utf8'));

describe('forge-sync from a fresh checkout (only config.json)', () => {
  const forge = () =>
    fakeForge({
      issues: [issue(1, { title: 'Add export' }), issue(2, { title: 'Fix login', body: 'Blocked by #1' })],
      prs: { all: [prRow(10, { body: 'Closes #1' })], open: [prRow(10, { body: 'Closes #1' })] },
      views: { 10: prRow(10, { body: 'Closes #1' }) },
      checks: { 10: [] },
    });

  test('writes queue.json and an empty ledger, with the forge issues and the linked PR', async () => {
    const result = await runForgeSync(campaign(), { adapter: forge(), now: NOW });
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
    const again = await runForgeSync(campaign(), { adapter: forge(), now: '2026-11-17T13:00:00.000Z' });
    expect(again.added).toEqual([]);
    expect(Object.keys(read('queue.json').issues as object)).toEqual(['1', '2']);
    expect(read('findings-ledger.json')).toEqual({ next_id: 2, findings: [{ id: 'F-00001' }] });
  });

  test('a live entry closed on the forge is read from the closed list', async () => {
    await runForgeSync(campaign(), { adapter: forge(), now: NOW });
    const closing = fakeForge({ issues: [issue(1, { state: 'CLOSED' }), issue(2)], prs: { all: [prRow(10, { state: 'MERGED', mergedAt: NOW, body: 'Closes #1' })] } });
    const r = await runForgeSync(campaign(), { adapter: closing, now: NOW });
    expect(closing.calls.filter((c) => c === 'issueList')).toHaveLength(2);
    expect(r.closed).toEqual([1]);
    expect((read('queue.json').issues as Record<string, unknown>)['1']).toMatchObject({ status: 'merged', phase: 'done', pr: 10 });
  });

  test('a failed forge read writes nothing', async () => {
    await expect(runForgeSync(campaign(), { adapter: fakeForge({ issues: [issue(1)] }), now: NOW })).rejects.toThrow(/prList/);
    expect(fs.existsSync(path.join(campaign(), 'queue.json'))).toBe(false);
    expect(fs.existsSync(path.join(campaign(), 'findings-ledger.json'))).toBe(false);
  });

  test('dry run returns the queue without writing it', async () => {
    const r = await runForgeSync(campaign(), { adapter: forge(), now: NOW, dryRun: true });
    expect(Object.keys(r.queue.issues)).toEqual(['1', '2']);
    expect(fs.existsSync(path.join(campaign(), 'queue.json'))).toBe(false);
  });

  test('no config.json is refused', async () => {
    fs.rmSync(path.join(campaign(), 'config.json'));
    await expect(runForgeSync(campaign(), { adapter: forge(), now: NOW })).rejects.toThrow(/No .*config\.json/);
  });

  test('the summary line names the scope and the changes', async () => {
    const r = await runForgeSync(campaign(), { adapter: forge(), now: NOW, dryRun: true });
    expect(summaryLine(r, { milestone: 'v1' })).toBe('Forge sync (scope: milestone v1): 2 in queue, +2 new (#1, #2), 0 closed, 1 PR linked (#1)');
  });
});
