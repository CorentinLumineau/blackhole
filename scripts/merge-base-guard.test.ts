import { beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';

const root = path.resolve(import.meta.dirname);
const scriptPath = path.join(root, 'merge-base-guard.ts');

const runGuard = (args: string[]) =>
  spawnSync('bun', ['run', '--cwd', path.join(root, '..'), scriptPath, ...args], {
    encoding: 'utf-8',
  });

const git = (repo: string, args: string[]) =>
  spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });

describe('merge-base-guard CLI — usage contract', () => {
  test('exits 2 with usage when --mode is absent', () => {
    const result = runGuard(['--base-ref', 'main', '--target-branch', 'main']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage:');
  });

  test('exits 2 on an unknown mode', () => {
    const result = runGuard(['--mode', 'sideways', '--base-ref', 'main', '--target-branch', 'main']);
    expect(result.status).toBe(2);
  });

  test('exits 2 when a pre-merge flag is missing', () => {
    expect(runGuard(['--mode', 'pre-merge', '--base-ref', 'main']).status).toBe(2);
  });

  test('exits 2 when --repo-root is relative in post-merge mode', () => {
    const result = runGuard([
      '--mode',
      'post-merge',
      '--pr',
      '42',
      '--target-branch',
      'main',
      '--repo-root',
      'relative/path',
    ]);
    expect(result.status).toBe(2);
  });
});

describe('merge-base-guard CLI — pre-merge mode', () => {
  test('exits 0 when the PR base is the campaign target branch', () => {
    const result = runGuard(['--mode', 'pre-merge', '--base-ref', 'main', '--target-branch', 'main']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ok');
  });

  test('exits 1 and names both branches on an un-opted-in stacked base', () => {
    const result = runGuard([
      '--mode',
      'pre-merge',
      '--base-ref',
      'blackhole/issue-700',
      '--target-branch',
      'main',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('blackhole/issue-700');
    expect(result.stderr).toContain('main');
  });

  test('exits 0 when the stacked-merge opt-in names the actual base', () => {
    const result = runGuard([
      '--mode',
      'pre-merge',
      '--base-ref',
      'blackhole/issue-700',
      '--target-branch',
      'main',
      '--stacked-into',
      'blackhole/issue-700',
    ]);
    expect(result.status).toBe(0);
  });
});

describe('merge-base-guard CLI — post-merge mode', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeTempDir('merge-base-guard-repo');
    git(repo, ['init', '--initial-branch', 'main']);
    git(repo, ['commit', '--allow-empty', '-m', 'feat(merge): land the thing (#4242)']);
  });

  test('exits 0 when the PR commit is on the target branch', () => {
    const result = runGuard([
      '--mode',
      'post-merge',
      '--pr',
      '4242',
      '--target-branch',
      'main',
      '--repo-root',
      repo,
      '--attempts',
      '1',
      '--interval-ms',
      '1',
    ]);
    expect(result.status).toBe(0);
  });

  test('exits 1 when the PR commit is absent from the target branch', () => {
    const result = runGuard([
      '--mode',
      'post-merge',
      '--pr',
      '9999',
      '--target-branch',
      'main',
      '--repo-root',
      repo,
      '--attempts',
      '2',
      '--interval-ms',
      '1',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('#9999');
    expect(result.stderr).toContain('did not land');
  });

  test('exits 1 when the target branch does not resolve at all', () => {
    const result = runGuard([
      '--mode',
      'post-merge',
      '--pr',
      '4242',
      '--target-branch',
      'no-such-branch',
      '--repo-root',
      repo,
      '--attempts',
      '1',
      '--interval-ms',
      '1',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no-such-branch');
  });
});
