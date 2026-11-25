import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ForgeAdapter, ForgeIssue } from './lib/forge-adapter/types.ts';
import { runApply, runDetect } from './pareto-score.ts';

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

describe('pareto-score', () => {
  test('detect lists the unscored ready issues', async () => {
    const r = await runDetect(dir, { adapter: forge([issue(3), issue(4, 'Pareto: gain=8 effort=4 priority=56')]).adapter });
    expect(r.map((x) => x.number)).toEqual([3]);
  });

  test('apply writes the forge and the queue, and a re-run changes nothing further', async () => {
    const scores = path.join(dir, 'scores.json');
    fs.writeFileSync(scores, JSON.stringify([{ number: 3, gain: 7, effort: 5, rationale: 'r' }]));
    const first = forge([issue(3)]);
    expect(await runApply(dir, scores, { adapter: first.adapter })).toEqual([{ number: 3, result: 'scored' }]);
    expect(first.edits).toHaveLength(1);
    expect(queueOnDisk().issues['3'].pareto).toEqual({ gain: 7, effort: 5, priority: 42 });
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

describe('prose coverage', () => {
  test.each(['src/references/forge-sync.md', 'src/references/phase-loop.md'])('%s cites scripts/pareto-score.ts', (rel) => {
    expect(fs.readFileSync(path.join(import.meta.dir, '..', rel), 'utf8')).toContain('scripts/pareto-score.ts');
  });
});
