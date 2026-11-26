import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { cleanupDirEntries, makeTempDir } from './lib/fs.ts';

const script = path.join(import.meta.dir, 'roadmap.ts');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    cleanupDirEntries(d);
    fs.rmdirSync(d);
  }
});

function repo(config: object | null): string {
  const root = makeTempDir('roadmap-cli');
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.blackhole'));
  fs.writeFileSync(path.join(root, '.blackhole/queue.json'), JSON.stringify({ issues: { '1': { title: 'Only', status: 'ready', pareto: { gain: 5, effort: 5, priority: 30 } } } }));
  if (config) fs.writeFileSync(path.join(root, '.blackhole/config.json'), JSON.stringify(config));
  return root;
}
const run = (root: string, ...args: string[]) => Bun.spawnSync(['bun', 'run', script, '--repo-root', root, '--date', '2026-11-26', ...args]);

describe('roadmap.ts', () => {
  test('writes the configured file, then reports it unchanged', () => {
    const root = repo({ roadmap: { enabled: true, path: 'documentation/plans/roadmap.md' } });
    expect(JSON.parse(run(root).stdout.toString())).toEqual({ status: 'written', path: 'documentation/plans/roadmap.md', index: 'none' });
    expect(fs.readFileSync(path.join(root, 'documentation/plans/roadmap.md'), 'utf-8')).toContain('| 1 | #1 Only |');
    expect(JSON.parse(run(root).stdout.toString()).status).toBe('unchanged');
  });

  test('a config without roadmap.path is a no-op that creates nothing', () => {
    const root = repo({ docs_governance: { enabled: true } });
    expect(JSON.parse(run(root).stdout.toString())).toEqual({ status: 'skipped', reason: 'no-path' });
    expect(fs.existsSync(path.join(root, 'documentation'))).toBe(false);
  });

  test('a path outside the repo exits 1 and writes nothing', () => {
    const root = repo({ roadmap: { enabled: true, path: '../escape.md' } });
    const result = run(root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('roadmap.path');
  });

  test('an unknown flag exits 2', () => {
    expect(run(repo(null), '--nope').exitCode).toBe(2);
  });
});
