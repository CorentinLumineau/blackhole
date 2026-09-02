import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';

// Issue #715 (R-10) — CLI argv-parsing/exit-code tests for scripts/carry-staged-artifacts.ts.
// Async Bun.spawn assertions can't use lib/test-fixtures.ts's synchronous withTempDir (its
// `finally` cleanup would race the still-pending subprocess) — same beforeEach/afterEach +
// makeTempDir/rmSync convention as scripts/validate-worker-json.test.ts's CLI suites.

const root = path.resolve(import.meta.dirname);
const scriptPath = path.join(root, 'carry-staged-artifacts.ts');

const run = (args: string[]) => Bun.spawn(['bun', 'run', scriptPath, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });

let dir: string;

beforeEach(() => {
  dir = makeTempDir('carry-cli');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('carry-staged-artifacts CLI — argv parsing', () => {
  test('missing --manifest exits 2 with usage on stderr', async () => {
    const proc = run(['--repo-root', dir]);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });

  test('missing --repo-root exits 2 with usage on stderr', async () => {
    const proc = run(['--manifest', path.join(dir, 'manifest.json')]);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });
});

describe('carry-staged-artifacts CLI — manifest shape guard', () => {
  test('absent manifest: prints [] and exits 0', async () => {
    const proc = run(['--manifest', path.join(dir, 'missing.json'), '--repo-root', dir]);
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('[]');
  });

  test('zero-byte manifest: exits 1 and names the manifest path on stderr', async () => {
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifestPath, '');
    const proc = run(['--manifest', manifestPath, '--repo-root', dir]);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(1);
    expect(stderr).toContain(manifestPath);
  });

  test('unparseable manifest: exits 1', async () => {
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifestPath, '{ not json');
    const proc = run(['--manifest', manifestPath, '--repo-root', dir]);
    const code = await proc.exited;
    expect(code).toBe(1);
  });
});

describe('carry-staged-artifacts CLI — end to end', () => {
  test('carries a new_file entry and prints its target path as a JSON array', async () => {
    const stagedRel = '.blackhole/staged/1/plan-x.md';
    fs.mkdirSync(path.join(dir, path.dirname(stagedRel)), { recursive: true });
    fs.writeFileSync(path.join(dir, stagedRel), '---\ntype: plan\nstatus: current\n---\n# Plan\n');

    const manifest = {
      issue: 1,
      updated_at: '2026-08-06T18:00:00.000Z',
      entries: [
        {
          route: 'plan',
          sub_mode: null,
          produced_by: 'planner',
          declared_at: '2026-08-06T17:58:00.000Z',
          staged_path: stagedRel,
          target_path: 'documentation/plans/plan-x.md',
          target_kind: 'new_file',
        },
      ],
    };
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const proc = run(['--manifest', manifestPath, '--repo-root', dir]);
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(['documentation/plans/plan-x.md']);
    expect(fs.existsSync(path.join(dir, 'documentation/plans/plan-x.md'))).toBe(true);
  });

  test('reports a malformed entry on stderr and still carries the well-formed remainder', async () => {
    const stagedRel = '.blackhole/staged/1/plan-x.md';
    fs.mkdirSync(path.join(dir, path.dirname(stagedRel)), { recursive: true });
    fs.writeFileSync(path.join(dir, stagedRel), '# Plan\n');

    const manifest = {
      issue: 1,
      updated_at: '2026-08-06T18:00:00.000Z',
      entries: [
        { route: 'plan', sub_mode: null, produced_by: 'planner', declared_at: 'x' }, // missing staged_path/target_path/target_kind
        {
          route: 'plan',
          sub_mode: null,
          produced_by: 'planner',
          declared_at: '2026-08-06T17:58:00.000Z',
          staged_path: stagedRel,
          target_path: 'documentation/plans/plan-x.md',
          target_kind: 'new_file',
        },
      ],
    };
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const proc = run(['--manifest', manifestPath, '--repo-root', dir]);
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(['documentation/plans/plan-x.md']);
    expect(stderr).toContain('entries[0]');
  });
});
