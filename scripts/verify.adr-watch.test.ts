import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';
import { ADR_WATCH_ITEMS, type AdrWatchItem, type AdrWatchMetric } from './lib/build/facts.ts';
import { checkAdrWatch, findAdrWatchViolations, measureAdrWatchItem, runChecks } from './checks/adr-watch.check.ts';

// Issue #710 — adr-watch.check.ts: machine-checkable home for ADR-007's rejected-alternatives
// revisit trigger and ADR-021 A3's Stop-condition density warning, so both stop tripping
// silently. Advisory (WARN, `ok: true` always) — same shape as V-CONTENTGATE-02/V-QUEUE-0N.

const KNOWN_METRICS: AdrWatchMetric[] = ['file_loc', 'section_loc', 'section_count'];

describe('ADR_WATCH_ITEMS shape', () => {
  test('every row has adr/file/metric/threshold/note, metric in the declared enum', () => {
    expect(ADR_WATCH_ITEMS.length).toBeGreaterThan(0);
    for (const item of ADR_WATCH_ITEMS) {
      expect(typeof item.adr).toBe('string');
      expect(item.adr.length).toBeGreaterThan(0);
      expect(typeof item.file).toBe('string');
      expect(item.file.length).toBeGreaterThan(0);
      expect(KNOWN_METRICS).toContain(item.metric);
      expect(typeof item.threshold).toBe('number');
      expect(item.threshold).toBeGreaterThan(0);
      expect(typeof item.note).toBe('string');
      expect(item.note.length).toBeGreaterThan(0);
    }
  });
});

describe('measureAdrWatchItem (pure, in-memory)', () => {
  test('file_loc measures the whole content line count', () => {
    const item: AdrWatchItem = { adr: 'ADR-TEST', file: 'x.md', metric: 'file_loc', threshold: 700, note: 'n' };
    const content = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    expect(measureAdrWatchItem(item, content)).toBe(10);
  });

  test('section_loc measures the worst-offending ## section', () => {
    const item: AdrWatchItem = { adr: 'ADR-TEST', file: 'x.md', metric: 'section_loc', threshold: 80, note: 'n' };
    const content = ['## Short', 'a', 'b', '## Long', ...Array.from({ length: 20 }, (_, i) => `l${i}`)].join('\n');
    // "## Long" section spans from its own header line to EOF: 1 header + 20 body lines = 21.
    expect(measureAdrWatchItem(item, content)).toBe(21);
  });

  test('section_loc with no ## headers at all measures 0 (nothing to report)', () => {
    const item: AdrWatchItem = { adr: 'ADR-TEST', file: 'x.md', metric: 'section_loc', threshold: 80, note: 'n' };
    expect(measureAdrWatchItem(item, 'no headers here\njust prose')).toBe(0);
  });

  test('section_count is declared for schema completeness but is not yet measured — returns null', () => {
    const item: AdrWatchItem = { adr: 'ADR-TEST', file: 'x.md', metric: 'section_count', threshold: 5, note: 'n' };
    expect(measureAdrWatchItem(item, '## A\n## B\n## C')).toBeNull();
  });
});

describe('findAdrWatchViolations (reads from disk — temp-dir fixture)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a file below its file_loc threshold produces no violation', () => {
    const dir = makeTempDir('adr-watch-');
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'below.md'), Array.from({ length: 5 }, (_, i) => `l${i}`).join('\n'));
    const items: AdrWatchItem[] = [{ adr: 'ADR-TEST', file: 'below.md', metric: 'file_loc', threshold: 10, note: 'n' }];
    expect(findAdrWatchViolations(items, dir)).toEqual([]);
  });

  test('a file above its file_loc threshold produces a violation naming the ADR and the measured value', () => {
    const dir = makeTempDir('adr-watch-');
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'above.md'), Array.from({ length: 15 }, (_, i) => `l${i}`).join('\n'));
    const items: AdrWatchItem[] = [{ adr: 'ADR-TEST', file: 'above.md', metric: 'file_loc', threshold: 10, note: 'watch me' }];
    const warnings = findAdrWatchViolations(items, dir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ADR-TEST');
    expect(warnings[0]).toContain('above.md');
    expect(warnings[0]).toContain('15');
    expect(warnings[0]).toContain('watch me');
  });

  test('a file below its section_loc threshold produces no violation', () => {
    const dir = makeTempDir('adr-watch-');
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'below.md'), ['## Section', 'a', 'b'].join('\n'));
    const items: AdrWatchItem[] = [{ adr: 'ADR-TEST', file: 'below.md', metric: 'section_loc', threshold: 10, note: 'n' }];
    expect(findAdrWatchViolations(items, dir)).toEqual([]);
  });

  test('a file above its section_loc threshold produces a violation naming the ADR and the measured value', () => {
    const dir = makeTempDir('adr-watch-');
    tempDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, 'above.md'),
      ['## Section', ...Array.from({ length: 15 }, (_, i) => `l${i}`)].join('\n'),
    );
    const items: AdrWatchItem[] = [{ adr: 'ADR-TEST', file: 'above.md', metric: 'section_loc', threshold: 10, note: 'watch me' }];
    const warnings = findAdrWatchViolations(items, dir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ADR-TEST');
    expect(warnings[0]).toContain('16');
    expect(warnings[0]).toContain('watch me');
  });

  test('a declared item whose target file does not exist is SKIPped — never crashes', () => {
    const dir = makeTempDir('adr-watch-');
    tempDirs.push(dir);
    const items: AdrWatchItem[] = [{ adr: 'ADR-TEST', file: 'missing.md', metric: 'file_loc', threshold: 10, note: 'n' }];
    expect(findAdrWatchViolations(items, dir)).toEqual([]);
  });
});

describe('checkAdrWatch / runChecks (advisory shape — ok: true always)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('clean fixture: single V-WATCH-01 result, ok: true, no detail', () => {
    const dir = makeTempDir('adr-watch-');
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'clean.md'), 'a\nb\nc');
    const items: AdrWatchItem[] = [{ adr: 'ADR-TEST', file: 'clean.md', metric: 'file_loc', threshold: 10, note: 'n' }];
    expect(checkAdrWatch(items, dir)).toEqual([{ id: 'V-WATCH-01', ok: true }]);
  });

  test('violating fixture: single V-WATCH-01 result, still ok: true (advisory), with detail', () => {
    const dir = makeTempDir('adr-watch-');
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'over.md'), Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n'));
    const items: AdrWatchItem[] = [{ adr: 'ADR-TEST', file: 'over.md', metric: 'file_loc', threshold: 10, note: 'n' }];
    const results = checkAdrWatch(items, dir);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-WATCH-01');
    expect(results[0].ok).toBe(true);
    expect(results[0].detail).toBeDefined();
  });

  test('runChecks() against the live declared ADR_WATCH_ITEMS returns a single ok:true V-WATCH-01 result', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-WATCH-01');
    expect(results[0].ok).toBe(true);
  });
});
