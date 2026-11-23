import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';
import { validateStateWrite } from './lib/state-write-guard.ts';
import { LEGACY_PHASE_MAP, LEGACY_STATUS_MAP, migrateQueueEntries, runQueueMigration } from './queue-migrate.ts';

// Fixture-driven coverage for the legacy queue status/phase mapping and the one-shot file
// protocol, isolated from any live `.blackhole/queue.json` via makeTempDir.

describe('migrateQueueEntries', () => {
  test('legacy "done" with a PR becomes merged, without one closed; both move to phase done', () => {
    const { issues, changes } = migrateQueueEntries({
      '1': { status: 'done', phase: 'loop', pr: 40 },
      '2': { status: 'done', phase: 'implement', pr: null },
      '3': { status: 'done' },
    });
    expect(issues['1']).toMatchObject({ status: 'merged', phase: 'done', pr: 40 });
    expect(issues['2']).toMatchObject({ status: 'closed', phase: 'done' });
    expect(issues['3']).toMatchObject({ status: 'closed', phase: 'done' });
    expect([...new Set(changes.map((c) => c.issue))]).toEqual(['1', '2', '3']);
  });

  test('legacy "in-review" becomes in-flight in phase review', () => {
    const { issues } = migrateQueueEntries({ '5': { status: 'in-review', phase: 'implement', pr: 9 } });
    expect(issues['5']).toMatchObject({ status: 'in-flight', phase: 'review', pr: 9 });
  });

  test('legacy "excluded" becomes blocked with a note, never ready and never dropped', () => {
    const { issues } = migrateQueueEntries({
      '999': { status: 'excluded' },
      '1000': { status: 'excluded', notes: 'owner said skip' },
    });
    expect(issues['999']).toMatchObject({ status: 'blocked', notes: 'legacy-status:excluded' });
    expect(issues['1000']).toMatchObject({ status: 'blocked', notes: 'legacy-status:excluded; owner said skip' });
  });

  test('legacy phase "loop" becomes done on a non-legacy status', () => {
    const { issues, changes } = migrateQueueEntries({ '7': { status: 'merged', phase: 'loop' } });
    expect(issues['7']).toMatchObject({ status: 'merged', phase: 'done' });
    expect(changes).toEqual([{ issue: '7', field: 'phase', from: 'loop', to: 'done' }]);
  });

  test('documented entries and entries without status/phase are untouched and not counted', () => {
    const input = { '1': { status: 'ready', phase: 'handle', title: 't' }, '2': {} };
    const { issues, changes } = migrateQueueEntries(input);
    expect(issues).toEqual(input);
    expect(changes).toEqual([]);
  });

  test('an unrecognized value throws naming the entry, rather than guessing', () => {
    expect(() => migrateQueueEntries({ '42': { status: 'parked' } })).toThrow(/#42.*"parked"/);
    expect(() => migrateQueueEntries({ '43': { status: 'ready', phase: 'qa' } })).toThrow(/#43.*"qa"/);
  });

  test('every mapped value passes the state-write guard', () => {
    const dir = makeTempDir('queue-migrate-guard');
    try {
      const entries: Record<string, unknown> = {};
      let n = 1;
      for (const status of Object.keys(LEGACY_STATUS_MAP)) entries[String(n++)] = { status, phase: 'implement', pr: 1 };
      for (const phase of Object.keys(LEGACY_PHASE_MAP)) entries[String(n++)] = { status: 'ready', phase };
      const tmpPath = path.join(dir, 'queue.json.tmp');
      fs.writeFileSync(tmpPath, JSON.stringify({ issues: migrateQueueEntries(entries).issues }));
      expect(validateStateWrite({ tmpPath, livePath: null, entityKey: 'issues' })).toEqual({ ok: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runQueueMigration', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  const fixture = () => {
    const dir = makeTempDir('queue-migrate-run');
    dirs.push(dir);
    const queue = {
      refreshed_at: '2026-11-20T00:00:00.000Z',
      user_queue_order: [1, 2],
      issues: { '1': { status: 'done', phase: 'loop', pr: 3 }, '2': { status: 'excluded', phase: 'handle' } },
    };
    fs.writeFileSync(path.join(dir, 'queue.json'), `${JSON.stringify(queue, null, 2)}\n`);
    return { dir, queue };
  };

  test('dry run (the default) reports the changes and writes nothing', () => {
    const { dir } = fixture();
    const before = fs.readFileSync(path.join(dir, 'queue.json'), 'utf8');
    const result = runQueueMigration(dir, { now: '2026-11-23T00:00:00.000Z' });
    expect(result.applied).toBe(false);
    expect(result.changes.length).toBe(3);
    expect(fs.readFileSync(path.join(dir, 'queue.json'), 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(dir, 'archive'))).toBe(false);
  });

  test('--apply snapshots to archive/, installs through the guard, keeps every entry and other keys', () => {
    const { dir } = fixture();
    const result = runQueueMigration(dir, { apply: true, now: '2026-11-23T00:00:00.000Z' });
    expect(result.applied).toBe(true);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'queue.json'), 'utf8'));
    expect(Object.keys(written.issues)).toEqual(['1', '2']);
    expect(written.issues['1']).toMatchObject({ status: 'merged', phase: 'done' });
    expect(written.issues['2']).toMatchObject({ status: 'blocked', phase: 'handle' });
    expect(written.user_queue_order).toEqual([1, 2]);
    expect(written.refreshed_at).toBe('2026-11-23T00:00:00.000Z');
    expect(fs.readdirSync(path.join(dir, 'archive')).some((f) => f.startsWith('queue-'))).toBe(true);
  });

  test('a clean queue is a no-op even with --apply', () => {
    const dir = makeTempDir('queue-migrate-clean');
    dirs.push(dir);
    const raw = `${JSON.stringify({ issues: { '1': { status: 'ready', phase: 'handle' } } }, null, 2)}\n`;
    fs.writeFileSync(path.join(dir, 'queue.json'), raw);
    const result = runQueueMigration(dir, { apply: true });
    expect(result).toMatchObject({ applied: false, changes: [] });
    expect(fs.readFileSync(path.join(dir, 'queue.json'), 'utf8')).toBe(raw);
  });
});
