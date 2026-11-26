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
    for (const bad of ['../roadmap.md', 'documentation/../../x.md', '/etc/roadmap.md', 'documentation/roadmap.txt', '']) {
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
    expect(result).toEqual({ status: 'written', path: 'documentation/plans/roadmap.md' });
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
    expect(run(r, queue(), '2026-12-01')).toEqual({ status: 'unchanged', path: 'documentation/plans/roadmap.md' });
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

  test('absent path or a disabled switch writes nothing', () => {
    const r = root();
    expect(run(r, queue(), '2026-11-26', { docs_governance: { enabled: true } })).toEqual({ status: 'skipped', reason: 'no-path' });
    expect(run(r, queue(), '2026-11-26', { ...on, roadmap: { ...on.roadmap, enabled: false } })).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(fs.readdirSync(r)).toEqual([]);
  });
});
