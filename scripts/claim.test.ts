import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runClaim, UsageError } from './claim.ts';
import type { ForgeAdapter } from './lib/forge-adapter/types.ts';

let dir: string;
const writeConfig = (extra: Record<string, unknown> = {}): void => fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ repo: 'o/r', forge: 'github', ...extra }));
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const fakeAdapter = (verdict: Record<string, unknown> = { verdict: 'CLAIMED' }) => {
  const calls: unknown[][] = [];
  const adapter = {
    claim: async (...args: unknown[]) => (calls.push(['claim', ...args]), verdict),
    release: async (...args: unknown[]) => (calls.push(['release', ...args]), { verdict: 'RELEASED' }),
    viewerLogin: async () => 'me',
  } as unknown as ForgeAdapter;
  return { adapter, calls };
};
const args = (...extra: string[]) => ['--campaign-dir', dir, ...extra];

describe('runClaim', () => {
  test('no lane prints SKIP and never calls the forge', async () => {
    writeConfig();
    const f = fakeAdapter();
    expect(await runClaim(args('--claim', '12'), { adapter: f.adapter })).toEqual({ verdict: 'SKIP', reason: 'no lane configured' });
    expect(f.calls).toEqual([]);
  });

  test('claim with the configured lane calls claim and prints the verdict', async () => {
    writeConfig({ catchup: { lane: 'acct-a', claim_lease_hours: 6 } });
    const f = fakeAdapter();
    expect(await runClaim(args('--claim', '12', '--now', '5'), { adapter: f.adapter })).toEqual({ verdict: 'CLAIMED', issue: 12, lane: 'acct-a', user: 'me' });
    expect(f.calls).toEqual([['claim', 12, 'acct-a', 'me', { leaseHours: 6, now: 5 }]]);
  });

  test('HELD prints held_by', async () => {
    writeConfig({ catchup: { lane: 'acct-a' } });
    const f = fakeAdapter({ verdict: 'HELD', held_by: 'acct-b' });
    expect(await runClaim(args('--claim', '12'), { adapter: f.adapter })).toMatchObject({ verdict: 'HELD', held_by: 'acct-b' });
  });

  test('--lane beats the config and --user skips viewerLogin', async () => {
    writeConfig({ catchup: { lane: 'acct-a' } });
    const f = fakeAdapter();
    await runClaim(args('--claim', '12', '--lane', 'acct-z', '--user', 'them'), { adapter: f.adapter });
    expect(f.calls[0].slice(0, 4)).toEqual(['claim', 12, 'acct-z', 'them']);
  });

  test('release calls release', async () => {
    writeConfig({ catchup: { lane: 'acct-a' } });
    const f = fakeAdapter();
    expect(await runClaim(args('--release', '12'), { adapter: f.adapter })).toEqual({ verdict: 'RELEASED', issue: 12, lane: 'acct-a' });
    expect(f.calls).toEqual([['release', 12, 'acct-a']]);
  });

  test.each([
    [[]],
    [['--claim', '1', '--release', '2']],
    [['--claim', 'abc']],
    [['--claim', '1', '--nope', 'x']],
    [['--claim', '1', '--lane', 'Bad Lane']],
  ])('bad usage %p is a UsageError', async (extra) => {
    writeConfig({ catchup: { lane: 'acct-a' } });
    await expect(runClaim(args(...extra), { adapter: fakeAdapter().adapter })).rejects.toBeInstanceOf(UsageError);
  });

  test('a forge failure propagates as a plain error', async () => {
    writeConfig({ catchup: { lane: 'acct-a' } });
    const adapter = { viewerLogin: async () => 'me', claim: async () => { throw new Error('boom'); } } as unknown as ForgeAdapter;
    const err = await runClaim(args('--claim', '1'), { adapter }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UsageError);
  });
});

describe('claim CLI exit codes', () => {
  const run = (...argv: string[]) => spawnSync('bun', ['run', path.join(import.meta.dirname, 'claim.ts'), ...argv], { encoding: 'utf8' });

  test('bad usage exits 2, a skipped claim exits 0 with one JSON line', () => {
    writeConfig();
    expect(run('--campaign-dir', dir).status).toBe(2);
    const ok = run('--campaign-dir', dir, '--claim', '3');
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout)).toEqual({ verdict: 'SKIP', reason: 'no lane configured' });
  });

  test('a forge failure exits 1 with the message on stderr', () => {
    writeConfig({ repo: undefined, catchup: { lane: 'acct-a' } });
    const r = run('--campaign-dir', dir, '--claim', '3');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no "repo"');
  });
});
