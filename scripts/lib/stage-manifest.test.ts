import { describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { withTempDir } from './test-fixtures.ts';
import { appendManifestEntry } from './stage-manifest.ts';

const entry = (over: Record<string, unknown> = {}) => ({
  route: 'plan',
  sub_mode: null,
  produced_by: 'planner',
  declared_at: '2026-11-26T10:00:00.000Z',
  staged_path: '.blackhole/staged/7/plan-x.md',
  target_path: 'documentation/plans/plan-x.md',
  target_kind: 'new_file',
  ...over,
});

const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));

describe('appendManifestEntry', () => {
  test('absent manifest: creates {issue, updated_at, entries:[entry]}', () => {
    withTempDir('stage-manifest', (dir) => {
      const p = path.join(dir, 'staged', '7', 'manifest.json');
      appendManifestEntry(p, 7, entry());
      const m = read(p);
      expect(m.issue).toBe(7);
      expect(typeof m.updated_at).toBe('string');
      expect(m.entries).toEqual([entry()]);
      expect(fs.existsSync(`${p}.tmp`)).toBe(false);
    });
  });

  test('existing manifest: appends, bumps updated_at, keeps prior entries byte-for-byte', () => {
    withTempDir('stage-manifest', (dir) => {
      const p = path.join(dir, 'manifest.json');
      const first = entry({ route: 'design', staged_path: 'a', target_path: 'documentation/a.md' });
      fs.writeFileSync(p, JSON.stringify({ issue: 7, updated_at: '2000-01-01T00:00:00.000Z', entries: [first] }));
      appendManifestEntry(p, 7, entry());
      const m = read(p);
      expect(m.entries).toEqual([first, entry()]);
      expect(m.updated_at).not.toBe('2000-01-01T00:00:00.000Z');
      expect(m.issue).toBe(7);
    });
  });

  test('refused entry leaves the live manifest bytes unchanged and no .tmp behind', () => {
    withTempDir('stage-manifest', (dir) => {
      const p = path.join(dir, 'manifest.json');
      const live = JSON.stringify({ issue: 7, updated_at: 'x', entries: [entry()] });
      fs.writeFileSync(p, live);
      expect(() => appendManifestEntry(p, 7, entry({ target_kind: 'bogus' }))).toThrow(/target_kind/);
      expect(fs.readFileSync(p, 'utf-8')).toBe(live);
      expect(fs.existsSync(`${p}.tmp`)).toBe(false);
    });
  });

  test('entry missing a required field is refused and nothing is created', () => {
    withTempDir('stage-manifest', (dir) => {
      const p = path.join(dir, 'manifest.json');
      const bad = entry();
      delete (bad as Record<string, unknown>).target_path;
      expect(() => appendManifestEntry(p, 7, bad)).toThrow(/target_path/);
      expect(fs.existsSync(p)).toBe(false);
      expect(fs.existsSync(`${p}.tmp`)).toBe(false);
    });
  });

  test('existing zero-byte manifest is refused naming the path, never overwritten', () => {
    withTempDir('stage-manifest', (dir) => {
      const p = path.join(dir, 'manifest.json');
      fs.writeFileSync(p, '');
      expect(() => appendManifestEntry(p, 7, entry())).toThrow(p);
      expect(fs.statSync(p).size).toBe(0);
    });
  });

  test('existing unparseable manifest is refused naming the path, never overwritten', () => {
    withTempDir('stage-manifest', (dir) => {
      const p = path.join(dir, 'manifest.json');
      fs.writeFileSync(p, '{ not json');
      expect(() => appendManifestEntry(p, 7, entry())).toThrow(p);
      expect(fs.readFileSync(p, 'utf-8')).toBe('{ not json');
    });
  });

  test('manifest issue mismatch is refused', () => {
    withTempDir('stage-manifest', (dir) => {
      const p = path.join(dir, 'manifest.json');
      fs.writeFileSync(p, JSON.stringify({ issue: 8, updated_at: 'x', entries: [] }));
      expect(() => appendManifestEntry(p, 7, entry())).toThrow(/issue/);
    });
  });

  test('write failure after validation leaves live manifest bytes unchanged and no .tmp behind', () => {
    withTempDir('stage-manifest', (dir) => {
      const p = path.join(dir, 'manifest.json');
      const live = JSON.stringify({ issue: 7, updated_at: 'x', entries: [entry()] });
      fs.writeFileSync(p, live);
      // The rename step fails after the candidate was validated and written to .tmp; a direct
      // writeFileSync onto the manifest would have already replaced the live bytes.
      const rename = spyOn(fs, 'renameSync').mockImplementation(() => {
        throw new Error('rename failed');
      });
      try {
        expect(() => appendManifestEntry(p, 7, entry({ staged_path: 'b', target_path: 'documentation/b.md' }))).toThrow('rename failed');
      } finally {
        rename.mockRestore();
      }
      expect(fs.readFileSync(p, 'utf-8')).toBe(live);
      expect(fs.existsSync(`${p}.tmp`)).toBe(false);
    });
  });
});
