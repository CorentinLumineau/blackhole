import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import { rescoreIssue } from './pareto-filing.ts';
import type { ForgeAdapter } from './types.ts';

function fake(failOn?: string) {
  const calls: Array<[string, ...unknown[]]> = [];
  const rec = (name: string) => async (...args: unknown[]) => {
    calls.push([name, ...args]);
    if (name === failOn) throw new Error(`${name} failed`);
    return { number: 9 };
  };
  const adapter = { issueCreate: rec('issueCreate'), issueEdit: rec('issueEdit'), labelAdd: rec('labelAdd'), labelRemove: rec('labelRemove') } as unknown as ForgeAdapter;
  return { adapter, calls };
}
const issue = (labels: string[], body = 'x') => ({ number: 4, body, labels: labels.map((name) => ({ name })) });

describe('rescoreIssue', () => {
  test('edits the body and swaps the label', async () => {
    const { adapter, calls } = fake();
    expect(await rescoreIssue(adapter, issue(['ready', 'pareto:P3']), { gain: 8, effort: 4 })).toBe(true);
    expect(calls).toEqual([
      ['issueEdit', 4, { body: 'x\n\nPareto: gain=8 effort=4 priority=56' }],
      ['labelRemove', { type: 'issue', number: 4 }, ['pareto:P3']],
      ['labelAdd', { type: 'issue', number: 4 }, ['pareto:P2']],
    ]);
  });
  test('makes no adapter call when already correct', async () => {
    const { adapter, calls } = fake();
    expect(await rescoreIssue(adapter, issue(['pareto:P2'], 'x\n\nPareto: gain=8 effort=4 priority=56'), { gain: 8, effort: 4 })).toBe(false);
    expect(calls).toEqual([]);
  });
  test('writes a new rationale even when the score is unchanged', async () => {
    const { adapter, calls } = fake();
    const body = 'x\n\nPareto: gain=8 effort=4 priority=56\n\nPareto rationale: old';
    expect(await rescoreIssue(adapter, issue(['pareto:P2'], body), { gain: 8, effort: 4, rationale: 'new' })).toBe(true);
    expect(calls).toEqual([['issueEdit', 4, { body: 'x\n\nPareto: gain=8 effort=4 priority=56\n\nPareto rationale: new' }]]);
  });
  test('makes no adapter call when score and rationale already match', async () => {
    const { adapter, calls } = fake();
    const body = 'x\n\nPareto: gain=8 effort=4 priority=56\n\nPareto rationale: same';
    expect(await rescoreIssue(adapter, issue(['pareto:P2'], body), { gain: 8, effort: 4, rationale: 'same' })).toBe(false);
    expect(calls).toEqual([]);
  });
  test('propagates an adapter error', async () => {
    const { adapter } = fake('labelAdd');
    await expect(rescoreIssue(adapter, issue([]), { gain: 8, effort: 4 })).rejects.toThrow('labelAdd failed');
  });
  test('the module has no process or per-forge coupling', () => {
    const src = fs.readFileSync(new URL('./pareto-filing.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/child_process|\bgh\b|gitea|gitlab/i);
  });
});
