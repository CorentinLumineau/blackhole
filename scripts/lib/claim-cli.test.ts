import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { claimAdapter, runClaimCli, UsageError } from './claim-cli.ts';
import type { ForgeAdapter } from './forge-adapter/types.ts';

describe('claimAdapter', () => {
  test.each(['read', 'written'] as const)('throws naming the config path when there is no repo (%s)', (verb) => {
    expect(() => claimAdapter('/c', {}, '/c/config.json', verb)).toThrow(`/c/config.json has no "repo": the forge cannot be ${verb}.`);
  });

  test('returns the override without reading the config', () => {
    const override = {} as ForgeAdapter;
    expect(claimAdapter('/c', {}, '/c/config.json', 'read', override)).toBe(override);
  });
});

describe('runClaimCli', () => {
  let exit: ReturnType<typeof spyOn>;
  let err: ReturnType<typeof spyOn>;
  beforeEach(() => {
    exit = spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    err = spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    exit.mockRestore();
    err.mockRestore();
  });

  test('a UsageError prints the message and usage and exits 2', async () => {
    await runClaimCli('tool', 'usage: tool', async () => {
      throw new UsageError('bad flag');
    });
    expect(exit).toHaveBeenCalledWith(2);
    expect(err).toHaveBeenCalledWith('tool: bad flag\nusage: tool');
  });

  test('any other error prints the message only and exits 1', async () => {
    await runClaimCli('tool', 'usage: tool', async () => {
      throw new Error('boom');
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(err).toHaveBeenCalledWith('tool: boom');
  });

  test('a clean body exits nothing', async () => {
    await runClaimCli('tool', 'usage: tool', async () => {});
    expect(exit).not.toHaveBeenCalled();
  });
});
