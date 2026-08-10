import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './fs.ts';
import { validateStateWrite } from './state-write-guard.ts';

// Issue #489 regression: `jq empty <file>` exits 0 on a zero-byte file — it detects malformed
// JSON, not absent JSON. A heredoc-authored `jq` program that failed to compile left a 0-byte
// `.tmp` file (shell redirects truncate before the command runs); `jq empty` passed it, and the
// campaign's entire `queue.json` (98 issue entries) was atomically installed over with an empty
// file. `validateStateWrite` is the replacement guard: it rejects empty/structurally-degenerate
// output and refuses any write whose top-level entity count regresses versus the file it would
// replace, unless the caller explicitly declares the shrink.

describe('validateStateWrite', () => {
  test('rejects a zero-byte temp file — the exact incident jq empty cannot catch', () => {
    const dir = makeTempDir('state-guard-empty');
    try {
      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, '');

      const result = validateStateWrite({ tmpPath, livePath: null, entityKey: 'issues' });

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/empty|0 byte/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects malformed JSON (the one case jq empty does catch)', () => {
    const dir = makeTempDir('state-guard-malformed');
    try {
      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, '{ not valid json');

      const result = validateStateWrite({ tmpPath, livePath: null, entityKey: 'issues' });

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/JSON/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects a structurally-degenerate object missing the required entity key', () => {
    const dir = makeTempDir('state-guard-missing-key');
    try {
      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify({ refreshed_at: '2026-08-10T00:00:00.000Z' }));

      const result = validateStateWrite({ tmpPath, livePath: null, entityKey: 'issues' });

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/issues/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('accepts a valid first write with no prior live file to compare against', () => {
    const dir = makeTempDir('state-guard-first-write');
    try {
      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify({ issues: { '1': {} }, refreshed_at: '2026-08-10T00:00:00.000Z' }));

      const result = validateStateWrite({ tmpPath, livePath: null, entityKey: 'issues' });

      expect(result.ok).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects a 98-to-0 collapse against a live file (the incident\'s exact shape)', () => {
    const dir = makeTempDir('state-guard-collapse');
    try {
      const livePath = path.join(dir, 'queue.json');
      const entries: Record<string, unknown> = {};
      for (let i = 1; i <= 98; i++) entries[String(i)] = {};
      fs.writeFileSync(livePath, JSON.stringify({ issues: entries, refreshed_at: '2026-08-10T00:00:00.000Z' }));

      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify({ issues: {}, refreshed_at: '2026-08-10T00:05:00.000Z' }));

      const result = validateStateWrite({ tmpPath, livePath, entityKey: 'issues' });

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/collapse|zero/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects a 98-to-3 collapse against a live file — smaller regressions fail closed too', () => {
    const dir = makeTempDir('state-guard-partial-collapse');
    try {
      const livePath = path.join(dir, 'queue.json');
      const liveEntries: Record<string, unknown> = {};
      for (let i = 1; i <= 98; i++) liveEntries[String(i)] = {};
      fs.writeFileSync(livePath, JSON.stringify({ issues: liveEntries, refreshed_at: '2026-08-10T00:00:00.000Z' }));

      const tmpEntries: Record<string, unknown> = { '1': {}, '2': {}, '3': {} };
      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify({ issues: tmpEntries, refreshed_at: '2026-08-10T00:05:00.000Z' }));

      const result = validateStateWrite({ tmpPath, livePath, entityKey: 'issues' });

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/regress/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('accepts a non-regressing write (count grows) against a live file', () => {
    const dir = makeTempDir('state-guard-grow');
    try {
      const livePath = path.join(dir, 'queue.json');
      fs.writeFileSync(livePath, JSON.stringify({ issues: { '1': {} }, refreshed_at: '2026-08-10T00:00:00.000Z' }));

      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify({ issues: { '1': {}, '2': {} }, refreshed_at: '2026-08-10T00:05:00.000Z' }));

      const result = validateStateWrite({ tmpPath, livePath, entityKey: 'issues' });

      expect(result.ok).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('allows an explicitly declared shrink (e.g. an issue removed) via the escape hatch', () => {
    const dir = makeTempDir('state-guard-declared-shrink');
    try {
      const livePath = path.join(dir, 'queue.json');
      fs.writeFileSync(
        livePath,
        JSON.stringify({ issues: { '1': {}, '2': {}, '3': {} }, refreshed_at: '2026-08-10T00:00:00.000Z' })
      );

      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify({ issues: { '1': {}, '2': {} }, refreshed_at: '2026-08-10T00:05:00.000Z' }));

      const result = validateStateWrite({ tmpPath, livePath, entityKey: 'issues', allowShrink: true });

      expect(result.ok).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('still rejects a full collapse to zero even with the escape hatch declared — a declared shrink is not a declared wipe', () => {
    const dir = makeTempDir('state-guard-declared-wipe');
    try {
      const livePath = path.join(dir, 'queue.json');
      const liveEntries: Record<string, unknown> = {};
      for (let i = 1; i <= 98; i++) liveEntries[String(i)] = {};
      fs.writeFileSync(livePath, JSON.stringify({ issues: liveEntries, refreshed_at: '2026-08-10T00:00:00.000Z' }));

      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify({ issues: {}, refreshed_at: '2026-08-10T00:05:00.000Z' }));

      const result = validateStateWrite({ tmpPath, livePath, entityKey: 'issues', allowShrink: true });

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/zero|empty/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('treats a missing live file as a first write, not as a 0-entity baseline', () => {
    const dir = makeTempDir('state-guard-no-live');
    try {
      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify({ issues: { '1': {} }, refreshed_at: '2026-08-10T00:00:00.000Z' }));

      const result = validateStateWrite({
        tmpPath,
        livePath: path.join(dir, 'does-not-exist.json'),
        entityKey: 'issues',
      });

      expect(result.ok).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
