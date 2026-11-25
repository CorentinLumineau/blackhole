import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import { issueCreateWithPareto, rescoreIssue } from './pareto-filing.ts';
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

describe('issueCreateWithPareto', () => {
  test('appends the line and swaps pareto labels for the bucket label', async () => {
    const { adapter, calls } = fake();
    await issueCreateWithPareto(adapter, { title: 't', body: 'b', labels: ['ready', 'pareto:P4'] }, { gain: 7, effort: 5 });
    expect(calls).toEqual([['issueCreate', { title: 't', body: 'b\n\nPareto: gain=7 effort=5 priority=42', labels: ['ready', 'pareto:P3'] }]]);
  });
});

describe('rescoreIssue', () => {
  test('edits the body and swaps the label', async () => {
    const { adapter, calls } = fake();
    await rescoreIssue(adapter, issue(['ready', 'pareto:P3']), { gain: 8, effort: 4 });
    expect(calls).toEqual([
      ['issueEdit', 4, { body: 'x\n\nPareto: gain=8 effort=4 priority=56' }],
      ['labelRemove', { type: 'issue', number: 4 }, ['pareto:P3']],
      ['labelAdd', { type: 'issue', number: 4 }, ['pareto:P2']],
    ]);
  });
  test('makes no adapter call when already correct', async () => {
    const { adapter, calls } = fake();
    await rescoreIssue(adapter, issue(['pareto:P2'], 'x\n\nPareto: gain=8 effort=4 priority=56'), { gain: 8, effort: 4 });
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
