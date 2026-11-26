import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import type { QueueJson } from '../campaign-status/types.ts';
import { cleanupDirEntries, makeTempDir } from '../fs.ts';
import { resolveRoadmapTarget, syncRoadmap } from './sync.ts';

const dirs: string[] = [];
const root = () => {
  const d = makeTempDir('roadmap-sync');
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) {
    cleanupDirEntries(d);
    fs.rmdirSync(d);
  }
});

const p = (gain: number, effort: number) => ({ gain, effort, priority: gain * (11 - effort) });
const queue = (): QueueJson => ({
  issues: {
    '1': { title: 'First', status: 'ready', pareto: p(9, 1) },
    '2': { title: 'Second', status: 'ready', pareto: p(5, 5) },
  },
});
const on = { docs_governance: { enabled: true }, roadmap: { path: 'documentation/plans/roadmap.md' } };

describe('resolveRoadmapTarget', () => {
  test('no roadmap.path is a no-op, even with docs governance on', () => {
    expect(resolveRoadmapTarget({ docs_governance: { enabled: true } }, '/r')).toEqual({ skip: 'no-path' });
    expect(resolveRoadmapTarget(undefined, '/r')).toEqual({ skip: 'no-path' });
    expect(resolveRoadmapTarget({ roadmap: { enabled: true } }, '/r')).toEqual({ skip: 'no-path' });
  });

  test('enabled defaults to docs_governance.enabled, and an explicit boolean wins', () => {
    const path_ = { path: 'documentation/plans/roadmap.md' };
    expect(resolveRoadmapTarget({ roadmap: path_ }, '/r')).toEqual({ skip: 'disabled' });
    expect(resolveRoadmapTarget({ docs_governance: { enabled: false }, roadmap: path_ }, '/r')).toEqual({ skip: 'disabled' });
    expect(resolveRoadmapTarget({ docs_governance: { enabled: true }, roadmap: { ...path_, enabled: false } }, '/r')).toEqual({ skip: 'disabled' });
    expect(resolveRoadmapTarget({ roadmap: { ...path_, enabled: true } }, '/r')).toEqual({ target: '/r/documentation/plans/roadmap.md' });
    expect(resolveRoadmapTarget({ docs_governance: { enabled: true }, roadmap: path_ }, '/r')).toEqual({ target: '/r/documentation/plans/roadmap.md' });
  });

  test('a wrong type throws with the key path', () => {
    expect(() => resolveRoadmapTarget({ roadmap: { path: 3 as unknown as string } }, '/r')).toThrow('roadmap.path');
    expect(() => resolveRoadmapTarget({ roadmap: { enabled: 'yes' as unknown as boolean, path: 'a.md' } }, '/r')).toThrow('roadmap.enabled');
  });

  test('a path that leaves the repo, is absolute, or is not markdown is refused', () => {
    const cfg = (pathValue: string) => ({ ...on, roadmap: { path: pathValue } });
    for (const bad of ['../roadmap.md', 'documentation/../../x.md', '..\\x.md', '/etc/roadmap.md', 'C:\\roadmap.md', '.', './', 'documentation/roadmap.txt', '']) {
      expect(() => resolveRoadmapTarget(cfg(bad), '/r')).toThrow('roadmap.path');
    }
  });
});

describe('syncRoadmap', () => {
  const run = (r: string, q: QueueJson, date: string, config: Parameters<typeof syncRoadmap>[0]['config'] = on) =>
    syncRoadmap({ queue: q, config, repoRoot: r, date });

  test('writes the roadmap with lifecycle frontmatter where the config says', () => {
    const r = root();
    const result = run(r, queue(), '2026-11-26');
    expect(result).toEqual({ status: 'written', path: 'documentation/plans/roadmap.md', index: 'none' });
    const text = fs.readFileSync(path.join(r, 'documentation/plans/roadmap.md'), 'utf-8');
    expect(text).toStartWith('---\ntype: reference\n');
    expect(text).toContain('status: current\n');
    expect(text).toContain('created: 2026-11-26\nlast_updated: 2026-11-26\n');
    expect(text).toContain('| 1 | #1 First |');
  });

  test('an unchanged ranking leaves the file untouched, even on another day', () => {
    const r = root();
    run(r, queue(), '2026-11-26');
    const file = path.join(r, 'documentation/plans/roadmap.md');
    const before = fs.readFileSync(file, 'utf-8');
    fs.utimesSync(file, new Date(1_000_000), new Date(1_000_000));
    expect(run(r, queue(), '2026-12-01')).toEqual({ status: 'unchanged', path: 'documentation/plans/roadmap.md', index: 'none' });
    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
    expect(fs.statSync(file).mtimeMs).toBe(1_000_000);
  });

  test('a changed ranking rewrites the body, keeps created and moves last_updated', () => {
    const r = root();
    run(r, queue(), '2026-11-26');
    const reranked = queue();
    reranked.issues!['2'].pareto = p(10, 1);
    expect(run(r, reranked, '2026-12-01').status).toBe('written');
    const text = fs.readFileSync(path.join(r, 'documentation/plans/roadmap.md'), 'utf-8');
    expect(text).toContain('created: 2026-11-26\nlast_updated: 2026-12-01\n');
    expect(text.indexOf('#2 Second')).toBeLessThan(text.indexOf('#1 First'));
  });

  test('a path that is refused writes nothing', () => {
    const r = root();
    expect(() => run(r, queue(), '2026-11-26', { ...on, roadmap: { path: '../outside.md' } })).toThrow('roadmap.path');
    expect(fs.existsSync(path.join(path.dirname(r), 'outside.md'))).toBe(false);
    expect(fs.readdirSync(r)).toEqual([]);
  });

  describe('documentation index', () => {
    const indexPath = (r: string) => path.join(r, 'documentation/INDEX.md');
    const seed = (r: string, rows: string[] = []) => {
      fs.mkdirSync(path.join(r, 'documentation'), { recursive: true });
      fs.writeFileSync(
        indexPath(r),
        ['# Documentation Index', '', '| path | summary | type | status | review_trigger |', '|------|---------|------|--------|----------------|', ...rows, ''].join('\n'),
      );
    };
    const roadmapRow = '| plans/roadmap.md | Ranked roadmap of every open issue, regenerated from the campaign scores | reference | current | on file change |';

    test('adds its row, sorted, when the repo has a blackhole-shaped documentation/INDEX.md', () => {
      const r = root();
      seed(r, ['| a.md | A | reference | current | x |', '| z.md | Z | reference | current | x |']);
      expect(run(r, queue(), '2026-11-26')).toMatchObject({ status: 'written', index: 'added' });
      const rows = fs.readFileSync(indexPath(r), 'utf-8').split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| path'));
      expect(rows).toEqual(['| a.md | A | reference | current | x |', roadmapRow, '| z.md | Z | reference | current | x |']);
    });

    test('a second run with an unchanged ranking leaves the index byte-identical', () => {
      const r = root();
      seed(r);
      run(r, queue(), '2026-11-26');
      const before = fs.readFileSync(indexPath(r), 'utf-8');
      expect(run(r, queue(), '2026-12-01')).toMatchObject({ status: 'unchanged', index: 'present' });
      expect(fs.readFileSync(indexPath(r), 'utf-8')).toBe(before);
    });

    test('an unchanged roadmap still gets its row when the index lost it', () => {
      const r = root();
      run(r, queue(), '2026-11-26');
      seed(r);
      expect(run(r, queue(), '2026-11-26')).toMatchObject({ status: 'unchanged', index: 'added' });
      expect(fs.readFileSync(indexPath(r), 'utf-8')).toContain(roadmapRow);
    });

    test('no documentation/INDEX.md: none is created', () => {
      const r = root();
      expect(run(r, queue(), '2026-11-26')).toMatchObject({ status: 'written', index: 'none' });
      expect(fs.existsSync(indexPath(r))).toBe(false);
    });

    test('a roadmap outside documentation/ is not indexed', () => {
      const r = root();
      seed(r);
      const before = fs.readFileSync(indexPath(r), 'utf-8');
      expect(run(r, queue(), '2026-11-26', { ...on, roadmap: { path: 'ROADMAP.md' } })).toMatchObject({ status: 'written', index: 'none' });
      expect(fs.readFileSync(indexPath(r), 'utf-8')).toBe(before);
    });

    test('a consumer-owned index shape is left alone', () => {
      const r = root();
      fs.mkdirSync(path.join(r, 'documentation'), { recursive: true });
      const foreign = '# Docs\n\n| Title | Link |\n|---|---|\n| Roadmap | [r](plans/roadmap.md) |\n';
      fs.writeFileSync(indexPath(r), foreign);
      expect(run(r, queue(), '2026-11-26')).toMatchObject({ status: 'written', index: 'skipped' });
      expect(fs.readFileSync(indexPath(r), 'utf-8')).toBe(foreign);
    });
  });

  test('absent path or a disabled switch writes nothing', () => {
    const r = root();
    expect(run(r, queue(), '2026-11-26', { docs_governance: { enabled: true } })).toEqual({ status: 'skipped', reason: 'no-path' });
    expect(run(r, queue(), '2026-11-26', { ...on, roadmap: { ...on.roadmap, enabled: false } })).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(fs.readdirSync(r)).toEqual([]);
  });
});
