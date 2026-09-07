import { describe, expect, test } from 'bun:test';
import {
  parseDeclaredBlastRadiusCount,
  hasCheckUtilsImport,
  findCheckUtilsConsumers,
  buildBlastRadiusResult,
  runChecks,
} from './checks/check-utils-blast-radius.check.ts';
import { findRowCountMismatch } from './checks/ground-truth.check.ts';

// Issue #960 — closes the gap that let check-utils.ts's header "N direct consumers" literal
// drift stale six times (#410, #462, #498, #570, #882, #945), each time caught only by a human
// noticing during an unrelated PR. V-BLASTRADIUS-01 makes the drift mechanically detectable:
// the declared header count is compared against a live git-tracked-file import scan on every
// `bun run verify`.

describe('parseDeclaredBlastRadiusCount', () => {
  test('extracts the declared N from a "Dependency blast-radius (N direct consumers..." fixture', () => {
    const fixture = '// Dependency blast-radius (75 direct consumers, issue #882 re-measurement)';
    expect(parseDeclaredBlastRadiusCount(fixture)).toBe(75);
  });

  test('returns null when no count is present', () => {
    expect(parseDeclaredBlastRadiusCount('// no blast-radius comment here at all')).toBeNull();
  });
});

describe('hasCheckUtilsImport', () => {
  test('true for a fixture string containing a relative check-utils import', () => {
    expect(hasCheckUtilsImport("import { root, read } from './check-utils.ts';")).toBe(true);
  });

  test('true for a check-utils import at any relative depth', () => {
    expect(hasCheckUtilsImport("import { root } from '../checks/check-utils.ts';")).toBe(true);
  });

  test('false for an unrelated import', () => {
    expect(hasCheckUtilsImport("import { readFileSync } from 'fs';")).toBe(false);
  });
});

describe('findCheckUtilsConsumers', () => {
  test('filters a fixture file-list to only files whose injected readFn content matches', () => {
    const files = ['scripts/checks/a.check.ts', 'scripts/checks/b.check.ts', 'scripts/lib/c.ts'];
    const contents: Record<string, string> = {
      'scripts/checks/a.check.ts': "import { root } from './check-utils.ts';",
      'scripts/checks/b.check.ts': "import { readFileSync } from 'fs';",
      'scripts/lib/c.ts': "import { read } from './checks/check-utils.ts';",
    };
    const readFn = (rel: string) => contents[rel];

    expect(findCheckUtilsConsumers(files, readFn)).toEqual(['scripts/checks/a.check.ts', 'scripts/lib/c.ts']);
  });
});

// V-UNFALSIFIABLE-01 (a): a control that can never fail cannot make drift "impossible", it can
// only note it. This demonstrates the exact comparison checkCheckUtilsBlastRadius() performs
// (findRowCountMismatch, reused from ground-truth.check.ts — V-INT-02) is reachable on a
// mismatch and produces a real signal, not an always-ok:true no-op.
describe('findRowCountMismatch reachability (V-UNFALSIFIABLE-01 red-before-green demonstration)', () => {
  test('returns a non-null string on a deliberately mismatched declared/actual pair', () => {
    const result = findRowCountMismatch('check-utils.ts header consumer count', 999, 3);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
  });

  test('returns null when declared and actual agree', () => {
    expect(findRowCountMismatch('label', 5, 5)).toBeNull();
  });
});

// V-UNFALSIFIABLE-01 (c): the check must fail LOUDLY on absent input — never silently pass when
// check-utils.ts's header carries no declared count, and never silently pass when the live scan
// turns up zero consumer files. buildBlastRadiusResult isolates the pure decision logic from the
// real read()/listTrackedFiles() I/O, so both absent-input paths are testable without mutating
// the real check-utils.ts header.
describe('buildBlastRadiusResult (V-UNFALSIFIABLE-01 c — fails loudly on absent input)', () => {
  test('declared === null (header has no parseable count) returns ok:false with a concrete detail', () => {
    const result = buildBlastRadiusResult(null, 42);
    expect(result.ok).toBe(false);
    expect(result.id).toBe('V-BLASTRADIUS-01');
    expect(typeof result.detail).toBe('string');
    expect(result.detail).toContain('missing');
  });

  test('a live scan that finds zero consumer files against a non-zero declared count returns ok:false', () => {
    const result = buildBlastRadiusResult(42, 0);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('declared 42');
    expect(result.detail).toContain('found 0');
  });

  test('declared and actual agreeing returns ok:true with no detail', () => {
    const result = buildBlastRadiusResult(42, 42);
    expect(result.ok).toBe(true);
    expect(result.detail).toBeUndefined();
  });

  test('declared and actual disagreeing (non-zero) returns ok:false', () => {
    const result = buildBlastRadiusResult(42, 43);
    expect(result.ok).toBe(false);
  });
});

// Live-repo sanity: once check-utils.ts's header literal is corrected (Task 6), this is the
// check's own self-verification that the live repo passes its own new gate.
describe('runChecks (live repo)', () => {
  test('the live repo currently passes its own V-BLASTRADIUS-01 gate', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-BLASTRADIUS-01');
    expect(results[0].ok).toBe(true);
  });
});
