import { describe, expect, test } from 'bun:test';
import type { ForgeAdapter, PrUpdateBranchResult } from './lib/forge-adapter/types.ts';
import { exitCodeFor, runPrUpdateBranch } from './pr-update-branch.ts';

const stub = (result: PrUpdateBranchResult) => {
  const calls: Array<[number, string]> = [];
  const adapter = {
    prUpdateBranch: async (n: number, sha: string) => {
      calls.push([n, sha]);
      return result;
    },
  } as unknown as ForgeAdapter;
  return { adapter, calls };
};

describe('exitCodeFor', () => {
  test('0 for UPDATED, 3 for UNSUPPORTED, 1 for every other verdict', () => {
    expect(exitCodeFor('UPDATED')).toBe(0);
    expect(exitCodeFor('UNSUPPORTED')).toBe(3);
    expect(exitCodeFor('CONFLICT')).toBe(1);
    expect(exitCodeFor('STALE-HEAD')).toBe(1);
    expect(exitCodeFor('FAILED')).toBe(1);
  });
});

describe('runPrUpdateBranch', () => {
  test('passes the PR number and expected head sha to the injected adapter and prints the result JSON', async () => {
    const { adapter, calls } = stub({ verdict: 'UPDATED' });
    const out: string[] = [];
    const code = await runPrUpdateBranch(['--repo-slug', 'o/r', '--pr', '7', '--expected-head-sha', 'deadbeef'], {
      adapterFor: () => adapter,
      print: (line) => out.push(line),
    });
    expect(code).toBe(0);
    expect(calls).toEqual([[7, 'deadbeef']]);
    expect(JSON.parse(out[0])).toEqual({ verdict: 'UPDATED' });
  });

  test('exit code follows the verdict', async () => {
    for (const [verdict, expected] of [['CONFLICT', 1], ['STALE-HEAD', 1], ['FAILED', 1], ['UNSUPPORTED', 3]] as const) {
      const { adapter } = stub({ verdict, detail: 'x' });
      const code = await runPrUpdateBranch(['--repo-slug', 'o/r', '--pr', '7', '--expected-head-sha', 'abc'], { adapterFor: () => adapter, print: () => {} });
      expect(code).toBe(expected);
    }
  });

  test('a missing --expected-head-sha, a non-numeric --pr, or an unknown flag exits 2 without calling the forge', async () => {
    const { adapter, calls } = stub({ verdict: 'UPDATED' });
    const deps = { adapterFor: () => adapter, print: () => {}, printErr: () => {} };
    expect(await runPrUpdateBranch(['--repo-slug', 'o/r', '--pr', '7'], deps)).toBe(2);
    expect(await runPrUpdateBranch(['--repo-slug', 'o/r', '--pr', 'abc', '--expected-head-sha', 'abc'], deps)).toBe(2);
    expect(await runPrUpdateBranch(['--repo-slug', 'o/r', '--pr', '7', '--expected-head-sha', 'abc', '--force'], deps)).toBe(2);
    expect(calls).toEqual([]);
  });

  test('an adapter that throws is reported as FAILED, exit 1', async () => {
    const adapter = {
      prUpdateBranch: async () => {
        throw new Error('boom');
      },
    } as unknown as ForgeAdapter;
    const out: string[] = [];
    const code = await runPrUpdateBranch(['--repo-slug', 'o/r', '--pr', '7', '--expected-head-sha', 'abc'], { adapterFor: () => adapter, print: (l) => out.push(l) });
    expect(code).toBe(1);
    expect(JSON.parse(out[0])).toEqual({ verdict: 'FAILED', detail: 'boom' });
  });
});
