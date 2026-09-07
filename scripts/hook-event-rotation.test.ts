import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { PRETOOLUSE_HOOKS_DIR, withTempDir } from './lib/test-fixtures.ts';

// Direct-import unit test for templates/hooks/pretooluse/utils/hook-event-rotation.js — a
// shipped CommonJS module, loaded the same way scripts/hooks-sibling-plugin-health.test.ts
// already loads its sibling utils modules, rather than through a full hook subprocess (V-INT-01).
const hookEventRotation = () => require(path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'hook-event-rotation.js'));

const DAY_MS = 24 * 60 * 60 * 1000;

const writeEvent = (eventsDir: string, name: string, ageMs: number, nowMs: number): string => {
  fs.mkdirSync(eventsDir, { recursive: true });
  const filePath = path.join(eventsDir, name);
  fs.writeFileSync(filePath, '{}', 'utf-8');
  const mtimeSeconds = (nowMs - ageMs) / 1000;
  fs.utimesSync(filePath, mtimeSeconds, mtimeSeconds);
  return filePath;
};

describe('hook-event-rotation.js — rotateHookEvents', () => {
  test('a file older than the retention window is archived, not left at its original path', () => {
    withTempDir('hook-rotation-', (repo) => {
      const { rotateHookEvents, DEFAULT_RETENTION_DAYS } = hookEventRotation();
      const eventsDir = path.join(repo, '.blackhole', 'hook-events');
      const nowMs = Date.now();
      const stalePath = writeEvent(eventsDir, 'stale.json', (DEFAULT_RETENTION_DAYS + 1) * DAY_MS, nowMs);

      rotateHookEvents(eventsDir, { now: () => nowMs });

      expect(fs.existsSync(stalePath)).toBe(false);
      const archiveRoot = path.join(repo, '.blackhole', 'archive');
      const archived = fs.readdirSync(archiveRoot);
      expect(archived).toHaveLength(1);
      const archivedFiles = fs.readdirSync(path.join(archiveRoot, archived[0]));
      expect(archivedFiles).toEqual(['stale.json']);
    });
  });

  test('a file newer than the retention window is left in place', () => {
    withTempDir('hook-rotation-', (repo) => {
      const { rotateHookEvents, DEFAULT_RETENTION_DAYS } = hookEventRotation();
      const eventsDir = path.join(repo, '.blackhole', 'hook-events');
      const nowMs = Date.now();
      const freshPath = writeEvent(eventsDir, 'fresh.json', (DEFAULT_RETENTION_DAYS - 1) * DAY_MS, nowMs);

      rotateHookEvents(eventsDir, { now: () => nowMs });

      expect(fs.existsSync(freshPath)).toBe(true);
      expect(fs.existsSync(path.join(repo, '.blackhole', 'archive'))).toBe(false);
    });
  });

  test('calling rotateHookEvents twice in quick succession only sweeps once — the sentinel gates the second call', () => {
    withTempDir('hook-rotation-', (repo) => {
      const { rotateHookEvents, DEFAULT_RETENTION_DAYS } = hookEventRotation();
      const eventsDir = path.join(repo, '.blackhole', 'hook-events');
      const nowMs = Date.now();

      let readdirCalls = 0;
      const countingReaddirSync: typeof fs.readdirSync = (...args: Parameters<typeof fs.readdirSync>) => {
        readdirCalls += 1;
        // @ts-expect-error — passthrough spy, args match the real overload used by the module.
        return fs.readdirSync(...args);
      };

      writeEvent(eventsDir, 'first.json', (DEFAULT_RETENTION_DAYS + 1) * DAY_MS, nowMs);
      rotateHookEvents(eventsDir, { now: () => nowMs, readdirSync: countingReaddirSync });
      expect(readdirCalls).toBe(1);

      // Seeded AFTER the first sweep, so if the sentinel failed to gate the second call this
      // file would be archived too.
      const secondStale = writeEvent(eventsDir, 'second.json', (DEFAULT_RETENTION_DAYS + 1) * DAY_MS, nowMs);
      rotateHookEvents(eventsDir, { now: () => nowMs, readdirSync: countingReaddirSync });

      expect(readdirCalls).toBe(1);
      expect(fs.existsSync(secondStale)).toBe(true);
    });
  });

  test('BLACKHOLE_HOOK_EVENT_RETENTION_DAYS narrows the cutoff — a file just inside vs. just outside the configured window', () => {
    withTempDir('hook-rotation-', (repo) => {
      const { rotateHookEvents } = hookEventRotation();
      const eventsDir = path.join(repo, '.blackhole', 'hook-events');
      const nowMs = Date.now();
      const prevEnv = process.env.BLACKHOLE_HOOK_EVENT_RETENTION_DAYS;
      process.env.BLACKHOLE_HOOK_EVENT_RETENTION_DAYS = '2';
      try {
        const inside = writeEvent(eventsDir, 'inside.json', 1 * DAY_MS, nowMs);
        const outside = writeEvent(eventsDir, 'outside.json', 3 * DAY_MS, nowMs);

        rotateHookEvents(eventsDir, { now: () => nowMs });

        expect(fs.existsSync(inside)).toBe(true);
        expect(fs.existsSync(outside)).toBe(false);
      } finally {
        if (prevEnv === undefined) delete process.env.BLACKHOLE_HOOK_EVENT_RETENTION_DAYS;
        else process.env.BLACKHOLE_HOOK_EVENT_RETENTION_DAYS = prevEnv;
      }
    });
  });

  test('an invalid retention env value falls back to the 14-day default rather than throwing', () => {
    const { parseRetentionDays, DEFAULT_RETENTION_DAYS } = hookEventRotation();
    expect(DEFAULT_RETENTION_DAYS).toBe(14);
    for (const invalid of [undefined, 'not-a-number', '0', '-3', '2.5', '']) {
      expect(parseRetentionDays(invalid)).toBe(DEFAULT_RETENTION_DAYS);
    }
    expect(parseRetentionDays('7')).toBe(7);
  });

  test('the sentinel is persisted only after the sweep completes — an archive-dir creation failure leaves it unwritten', () => {
    withTempDir('hook-rotation-', (repo) => {
      const { rotateHookEvents, DEFAULT_RETENTION_DAYS, SENTINEL_BASENAME } = hookEventRotation();
      const eventsDir = path.join(repo, '.blackhole', 'hook-events');
      const nowMs = Date.now();
      writeEvent(eventsDir, 'stale.json', (DEFAULT_RETENTION_DAYS + 1) * DAY_MS, nowMs);
      const sentinelPath = path.join(path.dirname(eventsDir), SENTINEL_BASENAME);

      const throwingMkdirSync = () => {
        throw new Error('injected: cannot create archive dir');
      };

      expect(() => rotateHookEvents(eventsDir, { now: () => nowMs, mkdirSync: throwingMkdirSync })).toThrow(
        'injected: cannot create archive dir',
      );
      expect(fs.existsSync(sentinelPath)).toBe(false);

      // A retry with the real fs calls now succeeds and does persist the sentinel — proving the
      // failure above did not leave the mechanism permanently wedged.
      rotateHookEvents(eventsDir, { now: () => nowMs });
      expect(fs.existsSync(sentinelPath)).toBe(true);
    });
  });

  test("a per-file rename failure is skipped, never aborting the rest of the sweep", () => {
    withTempDir('hook-rotation-', (repo) => {
      const { rotateHookEvents, DEFAULT_RETENTION_DAYS, SENTINEL_BASENAME } = hookEventRotation();
      const eventsDir = path.join(repo, '.blackhole', 'hook-events');
      const nowMs = Date.now();
      const firstPath = writeEvent(eventsDir, 'a-first.json', (DEFAULT_RETENTION_DAYS + 1) * DAY_MS, nowMs);
      const secondPath = writeEvent(eventsDir, 'b-second.json', (DEFAULT_RETENTION_DAYS + 1) * DAY_MS, nowMs);

      // Directory-scan order across the two stale files is not guaranteed, so the failure is
      // injected by call count (the FIRST rename attempt, whichever file it is for) rather than
      // by filename — the assertion below only depends on "exactly one archived, one left
      // behind, sweep still completed," never on which of the two that was.
      let renameCalls = 0;
      const flakyRenameSync: typeof fs.renameSync = (...args: Parameters<typeof fs.renameSync>) => {
        renameCalls += 1;
        if (renameCalls === 1) throw new Error('injected: rename race lost to a concurrent Triage run');
        // @ts-expect-error — passthrough spy, args match the real overload used by the module.
        return fs.renameSync(...args);
      };

      rotateHookEvents(eventsDir, { now: () => nowMs, renameSync: flakyRenameSync });

      expect(renameCalls).toBe(2);
      const stillPresent = [firstPath, secondPath].filter((p) => fs.existsSync(p));
      expect(stillPresent).toHaveLength(1);
      const sentinelPath = path.join(path.dirname(eventsDir), SENTINEL_BASENAME);
      expect(fs.existsSync(sentinelPath)).toBe(true);
    });
  });

  test("the sentinel file's own path resolves outside eventsDir", () => {
    withTempDir('hook-rotation-', (repo) => {
      const { rotateHookEvents, SENTINEL_BASENAME } = hookEventRotation();
      const eventsDir = path.join(repo, '.blackhole', 'hook-events');
      const nowMs = Date.now();
      fs.mkdirSync(eventsDir, { recursive: true });

      rotateHookEvents(eventsDir, { now: () => nowMs });

      const sentinelPath = path.join(path.dirname(eventsDir), SENTINEL_BASENAME);
      expect(path.dirname(sentinelPath)).not.toBe(eventsDir);
      expect(fs.existsSync(sentinelPath)).toBe(true);
      // readHookEvents-style consumers do an unfiltered readdirSync of eventsDir itself — the
      // sentinel must never show up in that listing.
      expect(fs.readdirSync(eventsDir)).not.toContain(SENTINEL_BASENAME);
    });
  });
});
