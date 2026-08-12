import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { computeDocHealthSignal, writeDocHealthSignalAtomic, type DocHealthSignal } from './doc-health-signal.ts';
import { DOC_HEALTH_THRESHOLDS } from './lib/build/facts.ts';
import { makeTempDir } from './lib/fs.ts';

// Issue #499 (ADR-021 D6 residual) — doc-health-signal.ts is the always-on-channel half of the
// Scope-1 doc-tree health signal: it maps evaluateDocTreeHealth's CheckResult onto the
// doc_debt/detail JSON shape and writes it atomically. Reuses evaluateDocTreeHealth (V-INT-02)
// rather than re-deriving the aggregation, so this suite covers only what this file adds.

const withFixtureDir = (fn: (dir: string) => void): void => {
  const dir = makeTempDir('doc-health-signal');
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const write = (dir: string, relPath: string, content: string): void => {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

const FM = (fields: Record<string, string>): string =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n\n# Fixture\n`;

describe('computeDocHealthSignal', () => {
  test('a clean fixture tree yields doc_debt: no, detail: null', () => {
    withFixtureDir((dir) => {
      write(dir, 'audits/foo.md', FM({ type: 'audit', status: 'current' }));
      const signal = computeDocHealthSignal(dir, new Date('2026-08-11T00:00:00.000Z'));
      expect(signal).toEqual({
        version: 1,
        refreshed_at: '2026-08-11T00:00:00.000Z',
        doc_debt: 'no',
        detail: null,
      });
    });
  });

  test('a doc past the single-doc line ceiling yields doc_debt: yes with the offending path in detail', () => {
    withFixtureDir((dir) => {
      const lineCount = DOC_HEALTH_THRESHOLDS.singleDocLineCeiling + 5;
      const bigDoc = Array.from({ length: lineCount }, (_, i) => `line ${i}`).join('\n');
      write(dir, 'audits/big.md', bigDoc);
      const signal = computeDocHealthSignal(dir);
      expect(signal.doc_debt).toBe('yes');
      expect(signal.detail).toContain('audits/big.md');
    });
  });

  // Codebase Convention: existence-gated steps return a no-op result rather than throwing
  // (doc-health.check.ts's evaluateIndexDangling/evaluateOrphanFiles idiom). evaluateDocTreeHealth
  // already handles a missing docsDir via walkFilesAbs's "[] for a directory that does not
  // exist" contract — this test only confirms that behavior passes through this wrapper intact.
  test('a docs directory that does not exist yields doc_debt: no without throwing', () => {
    const missingDir = path.join(makeTempDir('doc-health-signal-missing'), 'documentation');
    expect(fs.existsSync(missingDir)).toBe(false);
    expect(() => computeDocHealthSignal(missingDir)).not.toThrow();
    expect(computeDocHealthSignal(missingDir).doc_debt).toBe('no');
  });
});

describe('writeDocHealthSignalAtomic', () => {
  test('writes a file whose parsed JSON round-trips the input signal exactly, leaving no .tmp file', () => {
    withFixtureDir((dir) => {
      const signal: DocHealthSignal = {
        version: 1,
        refreshed_at: '2026-08-11T00:00:00.000Z',
        doc_debt: 'no',
        detail: null,
      };
      writeDocHealthSignalAtomic(dir, signal);
      const target = path.join(dir, 'doc-health.json');
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.existsSync(`${target}.tmp`)).toBe(false);
      expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual(signal);
    });
  });

  test('a second call with a different doc_debt value overwrites the first — no stale merge', () => {
    withFixtureDir((dir) => {
      writeDocHealthSignalAtomic(dir, {
        version: 1,
        refreshed_at: '2026-08-11T00:00:00.000Z',
        doc_debt: 'yes',
        detail: 'audits/big.md over ceiling',
      });
      const second: DocHealthSignal = {
        version: 1,
        refreshed_at: '2026-08-11T00:05:00.000Z',
        doc_debt: 'no',
        detail: null,
      };
      writeDocHealthSignalAtomic(dir, second);
      const target = path.join(dir, 'doc-health.json');
      expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual(second);
      expect(fs.existsSync(`${target}.tmp`)).toBe(false);
    });
  });

  test('creates the campaign directory when absent (mkdirSync recursive)', () => {
    withFixtureDir((dir) => {
      const campaignDir = path.join(dir, '.blackhole');
      expect(fs.existsSync(campaignDir)).toBe(false);
      writeDocHealthSignalAtomic(campaignDir, {
        version: 1,
        refreshed_at: '2026-08-11T00:00:00.000Z',
        doc_debt: 'no',
        detail: null,
      });
      expect(fs.existsSync(path.join(campaignDir, 'doc-health.json'))).toBe(true);
    });
  });
});
