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

  // Regression coverage: neither the hand-rolled `parseCliArgs` loop this guards against nor
  // any of its scripts/** siblings checks whether the token immediately following a flag is
  // itself another flag. `--entity-key --live <path>` silently binds `entityKey = '--live'`,
  // then resumes scanning past `<path>` without ever recognizing it as `--live`'s value — so
  // `--live` and its path are dropped entirely and the resulting error names the wrong flag.
  // Before the fix: entityKey mis-binds to the string '--live', the entity-count lookup then
  // fails on the wrong key, exit 1, stderr says `"--live" key` is missing.
  // After adopting scripts/lib/argv-flags.ts's parseFlags: a flag immediately followed by
  // another flag name binds boolean `true` instead of swallowing the next flag's name, so
  // `--entity-key` is left with no string value at all, and the CLI takes its ordinary
  // missing-required-flag path (exit 2, Usage message) rather than proceeding with a corrupted
  // key.
  test('BUG #902: --entity-key immediately followed by --live must not swallow --live as its value', async () => {
    const dir = makeTempDir('state-guard-cli-mispairing');
    try {
      const livePath = path.join(dir, 'queue.json');
      fs.writeFileSync(livePath, JSON.stringify({ issues: { '1': {} } }));

      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify({ issues: { '1': {}, '2': {} } }));

      const result = await runStateWriteGuardCli([
        '--tmp', tmpPath,
        '--entity-key', '--live', livePath,
      ]);

      // Correct behavior: `--entity-key` got no string value (its would-be value was itself a
      // flag), so the CLI must fail on the ordinary missing-required-flag path — never on a
      // downstream lookup against the wrongly-bound key `--live`.
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/Usage/);
      expect(result.stderr).not.toMatch(/"--live" key/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Both documented call sites, exercised through every fail-closed case in
// `blackhole-state.md` § Write protocol: `queue.json` keys its entities by issue number under an
// object (`issues`), while `findings-ledger.json` holds them in an array (`findings`).
// `countEntities` branches on that shape, so each refusal must hold for both.
type EntityShape = {
  entityKey: 'issues' | 'findings';
  file: string;
  build: (n: number) => Record<string, unknown>;
};

const ENTITY_SHAPES: EntityShape[] = [
  {
    entityKey: 'issues',
    file: 'queue.json',
    build: (n) => ({ issues: Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), {}])) }),
  },
  {
    entityKey: 'findings',
    file: 'findings-ledger.json',
    build: (n) => ({ next_id: n + 1, findings: Array.from({ length: n }, (_, i) => ({ id: `F-${i + 1}` })) }),
  },
];

describe.each(ENTITY_SHAPES)('validateStateWrite — $entityKey ($file)', ({ entityKey, file, build }) => {
  function withFiles(tmpContent: string, liveContent: string | null, fn: (tmpPath: string, livePath: string) => void) {
    const dir = makeTempDir(`state-guard-${entityKey}`);
    try {
      const livePath = path.join(dir, file);
      const tmpPath = `${livePath}.tmp`;
      fs.writeFileSync(tmpPath, tmpContent);
      if (liveContent !== null) fs.writeFileSync(livePath, liveContent);
      fn(tmpPath, livePath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test('refuses a 0-byte tmp file even when a healthy live file exists', () => {
    withFiles('', JSON.stringify(build(5)), (tmpPath, livePath) => {
      const result = validateStateWrite({ tmpPath, livePath, entityKey, allowShrink: true });
      expect(result).toEqual({ ok: false, reason: expect.stringMatching(/empty \(0 bytes\)/) });
    });
  });

  test('refuses malformed JSON', () => {
    withFiles(`{ "${entityKey}": [`, JSON.stringify(build(5)), (tmpPath, livePath) => {
      const result = validateStateWrite({ tmpPath, livePath, entityKey });
      expect(result).toEqual({ ok: false, reason: expect.stringMatching(/^malformed JSON/) });
    });
  });

  test('refuses a tmp file whose entity key is absent', () => {
    withFiles(JSON.stringify({ refreshed_at: '2026-09-23T00:00:00.000Z' }), null, (tmpPath, livePath) => {
      const result = validateStateWrite({ tmpPath, livePath, entityKey });
      expect(result).toEqual({ ok: false, reason: expect.stringContaining(`"${entityKey}" key`) });
    });
  });

  test('refuses a tmp file whose entity key holds a scalar instead of an object/array', () => {
    withFiles(JSON.stringify({ [entityKey]: 5 }), null, (tmpPath, livePath) => {
      const result = validateStateWrite({ tmpPath, livePath, entityKey });
      expect(result).toEqual({ ok: false, reason: expect.stringContaining(`"${entityKey}" key`) });
    });
  });

  test('refuses a shrink (5 → 4) without allowShrink', () => {
    withFiles(JSON.stringify(build(4)), JSON.stringify(build(5)), (tmpPath, livePath) => {
      const result = validateStateWrite({ tmpPath, livePath, entityKey });
      expect(result).toEqual({ ok: false, reason: expect.stringContaining(`${entityKey} count would regress from 5 to 4`) });
    });
  });

  test('permits the same shrink (5 → 4) with allowShrink', () => {
    withFiles(JSON.stringify(build(4)), JSON.stringify(build(5)), (tmpPath, livePath) => {
      expect(validateStateWrite({ tmpPath, livePath, entityKey, allowShrink: true })).toEqual({ ok: true });
    });
  });

  test('permits an equal-count rewrite without allowShrink', () => {
    withFiles(JSON.stringify(build(5)), JSON.stringify(build(5)), (tmpPath, livePath) => {
      expect(validateStateWrite({ tmpPath, livePath, entityKey })).toEqual({ ok: true });
    });
  });

  test('refuses a collapse to zero (5 → 0) even with allowShrink — a declared shrink is not a declared wipe', () => {
    withFiles(JSON.stringify(build(0)), JSON.stringify(build(5)), (tmpPath, livePath) => {
      const result = validateStateWrite({ tmpPath, livePath, entityKey, allowShrink: true });
      expect(result).toEqual({
        ok: false,
        reason: `${entityKey} count would collapse to zero (was 5) — refusing even with allowShrink`,
      });
    });
  });

  test('refuses a collapse to zero from a single entity (1 → 0) with allowShrink', () => {
    withFiles(JSON.stringify(build(0)), JSON.stringify(build(1)), (tmpPath, livePath) => {
      const result = validateStateWrite({ tmpPath, livePath, entityKey, allowShrink: true });
      expect(result).toEqual({ ok: false, reason: expect.stringContaining('collapse to zero (was 1)') });
    });
  });

  test('permits 0 → 0 — an already-empty live file has nothing to collapse', () => {
    withFiles(JSON.stringify(build(0)), JSON.stringify(build(0)), (tmpPath, livePath) => {
      expect(validateStateWrite({ tmpPath, livePath, entityKey })).toEqual({ ok: true });
    });
  });

  test('permits a write when the live file lacks the entity key — no baseline to regress against', () => {
    withFiles(JSON.stringify(build(1)), JSON.stringify({ refreshed_at: '2026-09-23T00:00:00.000Z' }), (tmpPath, livePath) => {
      expect(validateStateWrite({ tmpPath, livePath, entityKey })).toEqual({ ok: true });
    });
  });
});

describe.each(ENTITY_SHAPES)('state-write-guard CLI — $entityKey ($file)', ({ entityKey, file, build }) => {
  test('exit-code contract: 0 on pass, 1 on each refusal, 2 on malformed usage', async () => {
    const dir = makeTempDir(`state-guard-cli-${entityKey}`);
    try {
      const livePath = path.join(dir, file);
      const tmpPath = `${livePath}.tmp`;
      fs.writeFileSync(livePath, JSON.stringify(build(3)));
      const run = (content: string, ...extra: string[]) => {
        fs.writeFileSync(tmpPath, content);
        return runStateWriteGuardCli(['--tmp', tmpPath, '--live', livePath, '--entity-key', entityKey, ...extra]);
      };

      expect((await run(JSON.stringify(build(4)))).exitCode).toBe(0);
      expect((await run(JSON.stringify(build(2)), '--allow-shrink')).exitCode).toBe(0);

      const empty = await run('');
      expect(empty.exitCode).toBe(1);
      expect(empty.stderr).toMatch(/0 bytes/);

      const malformed = await run('{');
      expect(malformed.exitCode).toBe(1);
      expect(malformed.stderr).toMatch(/malformed JSON/);

      const noKey = await run('{}');
      expect(noKey.exitCode).toBe(1);
      expect(noKey.stderr).toContain(`"${entityKey}" key`);

      const shrink = await run(JSON.stringify(build(2)));
      expect(shrink.exitCode).toBe(1);
      expect(shrink.stderr).toMatch(/regress from 3 to 2/);

      const wipe = await run(JSON.stringify(build(0)), '--allow-shrink');
      expect(wipe.exitCode).toBe(1);
      expect(wipe.stderr).toMatch(/collapse to zero \(was 3\)/);

      const usage = await runStateWriteGuardCli(['--entity-key', entityKey]);
      expect(usage.exitCode).toBe(2);
      expect(usage.stderr).toMatch(/Usage/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
