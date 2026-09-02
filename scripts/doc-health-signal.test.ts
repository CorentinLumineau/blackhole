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
  test('a clean fixture tree yields doc_debt: no, detail: null, decision_log_silent_prs: 0', () => {
    withFixtureDir((dir) => {
      write(dir, 'audits/foo.md', FM({ type: 'audit', status: 'current' }));
      const signal = computeDocHealthSignal(dir, new Date('2026-08-11T00:00:00.000Z'));
      expect(signal).toEqual({
        version: 1,
        refreshed_at: '2026-08-11T00:00:00.000Z',
        doc_debt: 'no',
        detail: null,
        decision_log_silent_prs: 0,
      });
    });
  });

  // Issue #717 (R-12) — advisory signal for a decision-log that goes silent: merged PRs whose
  // decisions never landed. Missing queue.json is existence-gated (Codebase Convention), never
  // a discovered case's regression of doc_debt/detail (Execution Strategy item 3).
  test('decision_log_silent_prs counts merged queue.json PRs absent from decision-log.md', () => {
    withFixtureDir((dir) => {
      write(
        dir,
        'reference/decision-log.md',
        FM({ type: 'reference', status: 'current', last_updated: '2026-07-20' }) +
          '\n## Records\n\n| PR/Issue | Kind | Touch Paths | Decision | Why |\n|---|---|---|---|---|\n| 100 | approach | a.ts | did a thing | why |\n',
      );
      const queueJsonPath = path.join(dir, 'fixture-queue.json');
      fs.writeFileSync(
        queueJsonPath,
        JSON.stringify({
          issues: {
            '10': { status: 'merged', pr: 100 },
            '11': { status: 'merged', pr: 200 },
            '12': { status: 'ready', pr: null },
          },
        }),
      );
      const signal = computeDocHealthSignal(dir, new Date('2026-08-11T00:00:00.000Z'), queueJsonPath);
      expect(signal.decision_log_silent_prs).toBe(1);
      expect(signal.doc_debt).toBe('no');
      expect(signal.detail).toBe(null);
    });
  });

  test('a missing queue.json path yields decision_log_silent_prs: 0 without throwing (existence-gated no-op)', () => {
    withFixtureDir((dir) => {
      const missingQueueJsonPath = path.join(dir, 'does-not-exist.json');
      expect(() => computeDocHealthSignal(dir, new Date(), missingQueueJsonPath)).not.toThrow();
      expect(computeDocHealthSignal(dir, new Date(), missingQueueJsonPath).decision_log_silent_prs).toBe(0);
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
        decision_log_silent_prs: 0,
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
        decision_log_silent_prs: 0,
      });
      const second: DocHealthSignal = {
        version: 1,
        refreshed_at: '2026-08-11T00:05:00.000Z',
        doc_debt: 'no',
        detail: null,
        decision_log_silent_prs: 0,
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
        decision_log_silent_prs: 0,
      });
      expect(fs.existsSync(path.join(campaignDir, 'doc-health.json'))).toBe(true);
    });
  });
});
