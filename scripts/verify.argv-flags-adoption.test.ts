import { describe, expect, test } from 'bun:test';
import { hasArgvFlagsImport, runChecks } from './checks/argv-flags-adoption.check.ts';

describe('hasArgvFlagsImport', () => {
  test('detects a single-name import of parseFlags', () => {
    expect(hasArgvFlagsImport('scripts/lib/argv-flags.test.ts')).toBe(true);
  });

  test('returns false for a file with no argv-flags import at all', () => {
    expect(hasArgvFlagsImport('scripts/lib/argv-flags.ts')).toBe(false);
  });

  test('returns false for the deliberately non-migrated seed', () => {
    expect(hasArgvFlagsImport('scripts/stack-repair.ts')).toBe(false);
  });
});

describe('argv-flags-adoption runChecks() against the real src/ tree', () => {
  test('returns exactly one V-ARGV-01 result', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-ARGV-01');
  });

  test('passes against the current tree — all 15 target scripts import the shared primitive', () => {
    const [result] = runChecks();
    // On failure, surface which files still lack the import rather than a bare `false`.
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });
});
