import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ForgeAdapter, ForgeIssue } from './lib/forge-adapter/types.ts';
import { runApply, runDetect, runVerify } from './pareto-score.ts';

const issue = (number: number, body = ''): ForgeIssue => ({ number, title: `Issue ${number}`, body, labels: [], milestone: null, state: 'OPEN' });
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pareto-score-'));
  fs.writeFileSync(path.join(dir, 'queue.json'), JSON.stringify({ issues: { '3': { status: 'ready' }, '4': { status: 'ready' } } }));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const forge = (issues: ForgeIssue[]) => {
  const edits: Array<[number, unknown]> = [];
  const adapter = {
    issueList: async () => issues,
    issueEdit: async (n: number, p: unknown) => void edits.push([n, p]),
    labelAdd: async () => undefined,
    labelRemove: async () => undefined,
  } as unknown as ForgeAdapter;
  return { adapter, edits };
};
const queueOnDisk = () => JSON.parse(fs.readFileSync(path.join(dir, 'queue.json'), 'utf8'));

describe('pareto-score verify', () => {
  const ready = (n: number, body: string, labels: string[]): ForgeIssue => ({ ...issue(n, body), labels: labels.map((name) => ({ name })) }) as ForgeIssue;
  test('lists open ready issues with a missing line or wrong bucket label, ignoring non-ready ones', async () => {
    const issues = [
      ready(3, 'Pareto: gain=8 effort=3 priority=64', ['ready', 'pareto:P2']),
      ready(4, 'no line', ['ready']),
      ready(5, 'Pareto: gain=8 effort=3 priority=64', ['ready', 'pareto:P3']),
      ready(6, 'no line', ['bug']),
    ];
    expect(await runVerify(dir, { adapter: forge(issues).adapter })).toEqual([
      { number: 4, reason: 'missing or invalid `Pareto:` body line' },
      { number: 5, reason: 'missing bucket label pareto:P2 for priority 64' },
    ]);
  });
});

describe('pareto-score', () => {
  test('detect lists the unscored ready issues, and a scored one whose time was never recorded', async () => {
    const r = await runDetect(dir, { adapter: forge([issue(3), issue(4, 'Pareto: gain=8 effort=4 priority=56')]).adapter });
    expect(r.map((x) => [x.number, x.rescore?.reason])).toEqual([[3, undefined], [4, 'unrecorded']]);
  });

  test('detect lists a scored issue edited after scored_at or older than the configured max age', async () => {
    const line = 'x\n\nPareto: gain=8 effort=4 priority=56';
    const p = { gain: 8, effort: 4, priority: 56, scored_at: '2026-11-20T00:00:00.000Z' };
    fs.writeFileSync(path.join(dir, 'queue.json'), JSON.stringify({ issues: { '3': { status: 'ready', pareto: p }, '4': { status: 'ready', pareto: p } } }));
    const issues = [{ ...issue(3, line), updatedAt: '2026-11-21T00:00:00Z' }, issue(4, line)];
    const now = new Date('2026-11-22T00:00:00Z');
    expect((await runDetect(dir, { adapter: forge(issues).adapter, now })).map((x) => [x.number, x.rescore?.reason])).toEqual([[3, 'edited']]);
    expect((await runDetect(dir, { adapter: forge(issues).adapter, now, maxAgeDays: 1 })).map((x) => [x.number, x.rescore?.reason])).toEqual([[3, 'edited'], [4, 'aged']]);
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ pareto_max_age_days: 1 }));
    expect((await runDetect(dir, { adapter: forge(issues).adapter, now })).map((x) => x.number)).toEqual([3, 4]);
  });

  test('apply re-scores a stale issue and stores scored_at and rationale in the queue', async () => {
    const scores = path.join(dir, 'scores.json');
    fs.writeFileSync(scores, JSON.stringify([{ number: 4, gain: 3, effort: 2, rationale: 'cheaper now' }]));
    fs.writeFileSync(path.join(dir, 'queue.json'), JSON.stringify({ issues: { '4': { status: 'ready', pareto: { gain: 8, effort: 4, priority: 56 } } } }));
    const f = forge([issue(4, 'x\n\nPareto: gain=8 effort=4 priority=56')]);
    expect(await runApply(dir, scores, { adapter: f.adapter, now: new Date('2026-11-26T12:00:00Z') })).toEqual([{ number: 4, result: 'rescored' }]);
    expect(queueOnDisk().issues['4'].pareto).toEqual({ gain: 3, effort: 2, priority: 27, scored_at: '2026-11-26T12:00:00.000Z', rationale: 'cheaper now' });
  });

  test('apply writes the forge and the queue, and a re-run changes nothing further', async () => {
    const scores = path.join(dir, 'scores.json');
    fs.writeFileSync(scores, JSON.stringify([{ number: 3, gain: 7, effort: 5, rationale: 'r' }]));
    const first = forge([issue(3)]);
    expect(await runApply(dir, scores, { adapter: first.adapter })).toEqual([{ number: 3, result: 'scored' }]);
    expect(first.edits).toHaveLength(1);
    expect(queueOnDisk().issues['3'].pareto).toMatchObject({ gain: 7, effort: 5, priority: 42, rationale: 'r' });
    const again = forge([issue(3, (first.edits[0]![1] as { body: string }).body)]);
    expect(await runApply(dir, scores, { adapter: again.adapter })).toEqual([{ number: 3, result: 'already-scored' }]);
    expect(again.edits).toEqual([]);
  });

  test('apply refuses a malformed scores file before any forge call', async () => {
    const scores = path.join(dir, 'scores.json');
    fs.writeFileSync(scores, JSON.stringify([{ number: 3, gain: 0, effort: 5, rationale: 'r' }]));
    const f = forge([issue(3)]);
    await expect(runApply(dir, scores, { adapter: f.adapter })).rejects.toThrow();
    expect(f.edits).toEqual([]);
  });

  test('exits 2 with usage for an unknown subcommand or a missing --scores-file', () => {
    const run = (...a: string[]) => Bun.spawnSync(['bun', path.join(import.meta.dir, 'pareto-score.ts'), ...a], { stderr: 'pipe', stdout: 'pipe' });
    for (const args of [['nope'], ['apply']]) {
      const r = run(...args);
      expect(r.exitCode).toBe(2);
      expect(r.stderr.toString()).toContain('Usage:');
    }
  });
});

describe('pareto-score duplicate scores', () => {
  test('apply exits 2 naming the duplicate issue, before any forge call', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pareto-score-dup-'));
    try {
      const scores = path.join(d, 'scores.json');
      const row = { number: 3, gain: 7, effort: 5, rationale: 'r' };
      fs.writeFileSync(scores, JSON.stringify([row, row]));
      const r = Bun.spawnSync(['bun', path.join(import.meta.dir, 'pareto-score.ts'), 'apply', '--campaign-dir', d, '--scores-file', scores], { stderr: 'pipe', stdout: 'pipe' });
      expect(r.exitCode).toBe(2);
      expect(r.stderr.toString()).toContain('duplicate score entries for issue #3');
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('prose coverage', () => {
  test.each(['src/references/forge-sync.md', 'src/references/phase-loop.md'])('%s cites scripts/pareto-score.ts', (rel) => {
    expect(fs.readFileSync(path.join(import.meta.dir, '..', rel), 'utf8')).toContain('scripts/pareto-score.ts');
  });
});
