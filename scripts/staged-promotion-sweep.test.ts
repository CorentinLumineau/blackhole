import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { makeTempDir } from './lib/fs.ts';

const script = path.join(import.meta.dirname, 'staged-promotion-sweep.ts');

let repo: string;
let campaign: string;

const git = (...args: string[]) => spawnSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
const write = (rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), body);
};
const stage = (issue: number, manifest: unknown) => write(`.blackhole/staged/${issue}/manifest.json`, JSON.stringify(manifest));
const entry = (target: string, staged: string) => ({ staged_path: staged, target_path: target, target_kind: 'new_file' });
const sweep = (...extra: string[]) => {
  const r = spawnSync('bun', ['run', script, '--campaign-dir', campaign, '--repo-root', repo, '--ref', 'HEAD', ...extra], { encoding: 'utf8' });
  return { code: r.status, rows: r.status === 0 ? JSON.parse(r.stdout) : null, stderr: r.stderr };
};

beforeEach(() => {
  repo = makeTempDir('sweep-cli');
  campaign = path.join(repo, '.blackhole');
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  write('documentation/carried.md', 'x');
  git('add', 'documentation');
  git('commit', '-q', '-m', 'seed');
  write('.blackhole/queue.json', JSON.stringify({ issues: { '1': { status: 'merged' }, '2': { status: 'merged' }, '3': { status: 'merged' } } }));
  write('.blackhole/staged/2/leftover.md', 'staged body');
});

afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('staged-promotion-sweep CLI', () => {
  test('classifies a carried target, an unpromoted merged target and a bare-array manifest', () => {
    stage(1, { issue: 1, entries: [entry('documentation/carried.md', '.blackhole/staged/1/a.md')] });
    stage(2, { issue: 2, entries: [entry('documentation/absent.md', '.blackhole/staged/2/leftover.md')] });
    stage(3, [entry('documentation/x.md', '.blackhole/staged/3/x.md')]);
    const { code, rows } = sweep();
    expect(code).toBe(0);
    const byIssue = Object.fromEntries(rows.map((r: { issue: number; state: string }) => [r.issue, r.state]));
    expect(byIssue).toEqual({ 1: 'carried', 2: 'unpromoted_merged', 3: 'legacy_manifest_shape' });
  });

  test('--issue restricts the sweep to one staged directory', () => {
    stage(1, { issue: 1, entries: [entry('documentation/carried.md', '.blackhole/staged/1/a.md')] });
    stage(2, { issue: 2, entries: [entry('documentation/absent.md', '.blackhole/staged/2/leftover.md')] });
    const { rows } = sweep('--issue', '2');
    expect(rows.map((r: { issue: number }) => r.issue)).toEqual([2]);
  });

  test('--package-root admits a per-package documentation tree', () => {
    stage(2, { issue: 2, entries: [entry('services/b/documentation/d.md', '.blackhole/staged/2/leftover.md')] });
    expect(sweep().rows[0].state).toBe('target_outside_allowlist');
    expect(sweep('--package-root', 'services/b').rows[0].state).toBe('unpromoted_merged');
  });

  test('a malformed queue.json exits 1 naming the file; an absent one is treated as no queue', () => {
    write('.blackhole/queue.json', '{ not json');
    const bad = sweep();
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('queue.json');
    fs.rmSync(path.join(campaign, 'queue.json'));
    expect(sweep().code).toBe(0);
  });

  test('an unknown flag exits 2 with usage', () => {
    const { code, stderr } = sweep('--bogus', 'x');
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });

  test('a missing required flag exits 2', () => {
    const r = spawnSync('bun', ['run', script, '--repo-root', repo], { encoding: 'utf8' });
    expect(r.status).toBe(2);
  });

  // beforeEach leaves staged/2 without a manifest; readdir order is filesystem-dependent, so pin the issue.
  test('an append_row is carried only when the decisions INDEX already holds the staged row', () => {
    const header = '| path | summary | type | status | review_trigger |\n|------|---------|------|--------|----------------|\n';
    const rowA = '| ADR-001-a.md | A | adr | accepted | on ADR acceptance |';
    const rowB = '| ADR-002-b.md | B | adr | accepted | on ADR acceptance |';
    write('documentation/decisions/INDEX.md', `${header}${rowA}\n`);
    git('add', 'documentation');
    git('commit', '-q', '-m', 'index');
    write('.blackhole/staged/1/row.md', `${rowB}\n`);
    stage(1, { issue: 1, entries: [{ ...entry('documentation/decisions/INDEX.md', '.blackhole/staged/1/row.md'), target_kind: 'append_row' }] });
    expect(sweep('--issue', '1').rows[0].state).toBe('unpromoted_merged');
    write('documentation/decisions/INDEX.md', `${header}${rowA}\n${rowB}\n`);
    git('add', 'documentation');
    git('commit', '-q', '-m', 'index with row');
    expect(sweep('--issue', '1').rows[0].state).toBe('carried');
  });
});
