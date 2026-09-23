import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { PRETOOLUSE_HOOKS_DIR } from './lib/test-fixtures.ts';

// Unit contract for templates/hooks/pretooluse/utils/tier-dispatch.js — the single tier dispatch
// validate-bash-command.js's main() routes every guard verdict through. The real evaluators never
// return a tier outside their call site's allowedTiers, so the end-to-end suite
// (hooks-validate-bash.test.ts) cannot observe whether that ceiling is enforced; stub verdicts
// and spy recorders drive it directly here.

const tierDispatch = () => require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'tier-dispatch.js'));

type RecordedEvent = { hook: string; tool: string; pattern_id: string; reason: string; detail: string };

const withSpyDispatch = () => {
  const calls: { block: RecordedEvent[]; warn: RecordedEvent[] } = { block: [], warn: [] };
  const { createTierDispatch } = tierDispatch();
  const handleTieredResult = createTierDispatch('test-hook', {
    block: (event: RecordedEvent) => calls.block.push(event),
    warn: (event: RecordedEvent) => calls.warn.push(event),
  });
  return { calls, handleTieredResult };
};

const verdict = (tier: string) => ({ tier, pattern_id: `stub-${tier}`, reason: `stub ${tier} reason` });
const context = (allowedTiers: string[]) => ({ tool: 'Bash', command: 'echo stub', allowedTiers });

describe('tier-dispatch.js — allowedTiers ceiling', () => {
  test('BLOCK_ONLY receiving a warn verdict returns false and records nothing', () => {
    const { BLOCK_ONLY } = tierDispatch();
    const { calls, handleTieredResult } = withSpyDispatch();
    expect(handleTieredResult(verdict('warn'), context(BLOCK_ONLY))).toBe(false);
    expect(calls).toEqual({ block: [], warn: [] });
  });

  test('WARN_ONLY receiving a block verdict returns false and records nothing', () => {
    const { WARN_ONLY } = tierDispatch();
    const { calls, handleTieredResult } = withSpyDispatch();
    expect(handleTieredResult(verdict('block'), context(WARN_ONLY))).toBe(false);
    expect(calls).toEqual({ block: [], warn: [] });
  });

  test('an allow verdict falls through at every declared ceiling', () => {
    const { BLOCK_ONLY, WARN_ONLY, BLOCK_OR_WARN } = tierDispatch();
    const { calls, handleTieredResult } = withSpyDispatch();
    for (const allowedTiers of [BLOCK_ONLY, WARN_ONLY, BLOCK_OR_WARN]) {
      expect(handleTieredResult(verdict('allow'), context(allowedTiers))).toBe(false);
    }
    expect(calls).toEqual({ block: [], warn: [] });
  });

  test('a null verdict falls through', () => {
    const { BLOCK_OR_WARN } = tierDispatch();
    const { calls, handleTieredResult } = withSpyDispatch();
    expect(handleTieredResult(null, context(BLOCK_OR_WARN))).toBe(false);
    expect(calls).toEqual({ block: [], warn: [] });
  });

  test('an in-limit block verdict records once through the block recorder with the full event', () => {
    const { BLOCK_ONLY } = tierDispatch();
    const { calls, handleTieredResult } = withSpyDispatch();
    expect(handleTieredResult(verdict('block'), context(BLOCK_ONLY))).toBe(true);
    expect(calls.warn).toEqual([]);
    expect(calls.block).toEqual([
      { hook: 'test-hook', tool: 'Bash', pattern_id: 'stub-block', reason: 'stub block reason', detail: 'echo stub' },
    ]);
  });

  test('an in-limit warn verdict records once through the warn recorder with the full event', () => {
    const { WARN_ONLY } = tierDispatch();
    const { calls, handleTieredResult } = withSpyDispatch();
    expect(handleTieredResult(verdict('warn'), context(WARN_ONLY))).toBe(true);
    expect(calls.block).toEqual([]);
    expect(calls.warn).toEqual([
      { hook: 'test-hook', tool: 'Bash', pattern_id: 'stub-warn', reason: 'stub warn reason', detail: 'echo stub' },
    ]);
  });

  test('BLOCK_OR_WARN routes each tier to its own recorder', () => {
    const { BLOCK_OR_WARN } = tierDispatch();
    const { calls, handleTieredResult } = withSpyDispatch();
    expect(handleTieredResult(verdict('block'), context(BLOCK_OR_WARN))).toBe(true);
    expect(handleTieredResult(verdict('warn'), context(BLOCK_OR_WARN))).toBe(true);
    expect(calls.block.map((e) => e.pattern_id)).toEqual(['stub-block']);
    expect(calls.warn.map((e) => e.pattern_id)).toEqual(['stub-warn']);
  });
});
