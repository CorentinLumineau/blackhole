import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './fs.ts';
import { validateStateWrite } from './state-write-guard.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const scriptPath = path.join(root, 'scripts/lib/state-write-guard.ts');

async function runStateWriteGuardCli(args: string[]) {
  const proc = Bun.spawn({
    cmd: ['bun', 'run', scriptPath, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: root,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

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

// Issue #543 — `validateStateWrite` had zero call sites outside its own test and no CLI
// entrypoint, so `blackhole-state.md` § Write protocol could only cite a function name, not a
// runnable command. These tests pin the CLI wrapper's exit-code contract so a caller can branch
// on refusal (1) vs malformed usage (2) vs a passing validation (0).
describe('state-write-guard CLI', () => {
  test('exits 2 with a Usage message on malformed arguments (missing --entity-key)', async () => {
    const dir = makeTempDir('state-guard-cli-malformed-args');
    try {
      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify({ issues: { '1': {} } }));

      const result = await runStateWriteGuardCli(['--tmp', tmpPath]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/Usage/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('exits 1 and prints the refusal reason to stderr on a regressing write', async () => {
    const dir = makeTempDir('state-guard-cli-refusal');
    try {
      const livePath = path.join(dir, 'queue.json');
      const liveEntries: Record<string, unknown> = {};
      for (let i = 1; i <= 98; i++) liveEntries[String(i)] = {};
      fs.writeFileSync(livePath, JSON.stringify({ issues: liveEntries }));

      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify({ issues: {} }));

      const result = await runStateWriteGuardCli([
        '--tmp', tmpPath,
        '--live', livePath,
        '--entity-key', 'issues',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/collapse|zero/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('exits 0 on a passing validation with no live file to compare against', async () => {
    const dir = makeTempDir('state-guard-cli-accept');
    try {
      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify({ issues: { '1': {} } }));

      const result = await runStateWriteGuardCli(['--tmp', tmpPath, '--entity-key', 'issues']);

      expect(result.exitCode).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--allow-shrink threads through to the guard, accepting a declared shrink', async () => {
    const dir = makeTempDir('state-guard-cli-allow-shrink');
    try {
      const livePath = path.join(dir, 'queue.json');
      fs.writeFileSync(livePath, JSON.stringify({ issues: { '1': {}, '2': {}, '3': {} } }));

      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify({ issues: { '1': {}, '2': {} } }));

      const withoutFlag = await runStateWriteGuardCli([
        '--tmp', tmpPath,
        '--live', livePath,
        '--entity-key', 'issues',
      ]);
      expect(withoutFlag.exitCode).toBe(1);

      const withFlag = await runStateWriteGuardCli([
        '--tmp', tmpPath,
        '--live', livePath,
        '--entity-key', 'issues',
        '--allow-shrink',
      ]);
      expect(withFlag.exitCode).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
