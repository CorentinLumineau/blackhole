import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyClaimLabels } from './lib/claim-release.ts';
import { claimExitCode, runClaimLabels, UsageError } from './claim-labels.ts';
import type { ForgeAdapter } from './lib/forge-adapter/types.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-labels-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (config: Record<string, unknown>): void =>
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ repo: 'o/r', forge: 'github', ...config }));

const fake = (failOn: number[] = []) => {
  const calls: unknown[][] = [];
  const adapter = {
    labelAdd: async (e: { number: number }, l: unknown) => {
      if (failOn.includes(e.number)) throw new Error(`forge down for ${e.number}`);
      calls.push(['labelAdd', e, l]);
    },
  } as unknown as ForgeAdapter;
  return { adapter, calls };
};

describe('runClaimLabels', () => {
  test('claim_labels set: one labelAdd on the issue and the claim is reported', async () => {
    write({ claim_labels: ['in-progress:claude'] });
    const f = fake();
    const report = await runClaimLabels(['--issue', '10', '--campaign-dir', dir], { adapter: f.adapter });
    expect(report).toEqual({ claimed: [{ issue: 10, label: 'in-progress:claude' }], failed: [] });
    expect(f.calls).toEqual([['labelAdd', { type: 'issue', number: 10 }, ['in-progress:claude']]]);
  });

  test('no claim_labels: no adapter call and empty sets', async () => {
    write({});
    const f = fake();
    expect(await runClaimLabels(['--issue', '10', '--campaign-dir', dir], { adapter: f.adapter })).toEqual({ claimed: [], failed: [] });
    expect(f.calls).toEqual([]);
  });

  test('a forge error fails open: it lands in failed and the call returns', async () => {
    write({ claim_labels: ['in-progress:claude'] });
    const f = fake([10]);
    const report = await runClaimLabels(['--issue', '10', '--campaign-dir', dir], { adapter: f.adapter });
    expect(report).toEqual({ claimed: [], failed: [{ issue: 10, label: 'in-progress:claude', error: 'forge down for 10' }] });
  });

  test.each([[['--campaign-dir', '.']], [['--issue', 'abc']], [['--issue', '0']], [['--issue', '5', '--nope', 'x']], [['--issue']]])(
    'bad usage %p is a UsageError',
    async (argv) => {
      write({ claim_labels: ['a'] });
      await expect(runClaimLabels(argv, { adapter: fake().adapter })).rejects.toBeInstanceOf(UsageError);
    },
  );

  test('a malformed claim_labels throws with the key name', async () => {
    write({ claim_labels: 'in-progress:claude' });
    await expect(runClaimLabels(['--issue', '10', '--campaign-dir', dir], { adapter: fake().adapter })).rejects.toThrow('claim_labels');
  });

  test('exit code is 1 when any claim failed, 0 otherwise', () => {
    expect(claimExitCode({ claimed: [], failed: [{ issue: 1, label: 'l', error: 'e' }] })).toBe(1);
    expect(claimExitCode({ claimed: [{ issue: 1, label: 'l' }], failed: [] })).toBe(0);
  });
});

describe('applyClaimLabels', () => {
  test('one failing label does not stop the next', async () => {
    const calls: string[] = [];
    const adapter = {
      labelAdd: async (_e: unknown, l: string[]) => {
        if (l[0] === 'a') throw new Error('nope');
        calls.push(l[0]);
      },
    };
    expect(await applyClaimLabels(adapter, 7, ['a', 'b'])).toEqual({ claimed: [{ issue: 7, label: 'b' }], failed: [{ issue: 7, label: 'a', error: 'nope' }] });
    expect(calls).toEqual(['b']);
  });
});
