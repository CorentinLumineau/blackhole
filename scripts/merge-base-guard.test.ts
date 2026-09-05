import { describe, expect, test } from 'bun:test';
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

// A repo whose `git fetch origin <branch>` genuinely succeeds: without a reachable origin every
// post-merge run would take the transport-failure path and no test could exercise the landing
// verdicts at all.
function originBackedRepo(): { repo: string; origin: string } {
  const origin = makeTempDir('merge-base-guard-origin');
  spawnSync('git', ['init', '--bare', '--initial-branch', 'main', origin]);
  const repo = makeTempDir('merge-base-guard-repo');
  git(repo, ['init', '--initial-branch', 'main']);
  git(repo, ['remote', 'add', 'origin', origin]);
  git(repo, ['commit', '--allow-empty', '-m', 'chore: root commit']);
  git(repo, ['push', 'origin', 'main']);
  return { repo, origin };
}

// A repo with a commit on `main` and no remote at all — every git fetch here exits non-zero.
function remotelessRepo(): string {
  const repo = makeTempDir('merge-base-guard-remoteless');
  git(repo, ['init', '--initial-branch', 'main']);
  git(repo, ['commit', '--allow-empty', '-m', 'feat(merge): land the thing (#4242)']);
  return repo;
}

const postMerge = (extra: string[]) => runGuard(['--mode', 'post-merge', ...extra]);

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
    const result = postMerge([
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

describe('merge-base-guard CLI — post-merge landing verdicts', () => {
  test('exits 0 only because the fetch pulled a commit the local repo had never seen', () => {
    const { repo, origin } = originBackedRepo();
    const publisher = makeTempDir('merge-base-guard-publisher');
    spawnSync('git', ['clone', origin, publisher], { encoding: 'utf-8' });
    git(publisher, ['commit', '--allow-empty', '-m', 'feat(merge): squashed (#5150)']);
    git(publisher, ['push', 'origin', 'main']);

    // The landing is invisible to `repo` until the guard's own fetch runs — so a pass here is
    // evidence the fetch happened, not that a stale local ref happened to contain the subject.
    expect(git(repo, ['log', 'origin/main', '--format=%s']).stdout).not.toContain('#5150');

    const result = postMerge([
      '--pr',
      '5150',
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
    expect(result.stdout).toContain('#5150');
  });

  test('exits 1 for a commit that exists on a sibling branch but not on --target-branch', () => {
    const { repo } = originBackedRepo();
    git(repo, ['checkout', '-b', 'blackhole/issue-1234']);
    git(repo, ['commit', '--allow-empty', '-m', 'feat(merge): sibling-only work (#1234)']);
    git(repo, ['push', 'origin', 'blackhole/issue-1234']);
    git(repo, ['checkout', 'main']);

    const miss = postMerge([
      '--pr',
      '1234',
      '--target-branch',
      'main',
      '--repo-root',
      repo,
      '--attempts',
      '1',
      '--interval-ms',
      '1',
    ]);
    expect(miss.status).toBe(1);
    expect(miss.stderr).toContain('did not land');

    // Same repo, same PR, same moment — only --target-branch differs. A guard that ignored the
    // flag for the log read would have to give both runs the same verdict.
    const hit = postMerge([
      '--pr',
      '1234',
      '--target-branch',
      'blackhole/issue-1234',
      '--repo-root',
      repo,
      '--attempts',
      '1',
      '--interval-ms',
      '1',
    ]);
    expect(hit.status).toBe(0);
  });

  test('spends the whole retry budget before calling a miss terminal', () => {
    const { repo } = originBackedRepo();
    const result = postMerge([
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
    expect(result.stderr).toContain('after 2 attempt(s)');
  });
});

describe('merge-base-guard CLI — verification that could not run', () => {
  test('exits 3 rather than reporting a landing when the fetch fails', () => {
    const result = postMerge([
      '--pr',
      '4242',
      '--target-branch',
      'main',
      '--repo-root',
      remotelessRepo(),
      '--attempts',
      '1',
      '--interval-ms',
      '1',
    ]);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('verification could not run');
    expect(result.stderr).toContain('fetch');
    expect(result.stdout).not.toContain('ok');
  });

  test('exits 3 rather than reporting a miss when the fetch fails', () => {
    const result = postMerge([
      '--pr',
      '9999',
      '--target-branch',
      'main',
      '--repo-root',
      remotelessRepo(),
      '--attempts',
      '2',
      '--interval-ms',
      '1',
    ]);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('verification could not run');
    expect(result.stderr).not.toContain('did not land');
  });

  test('exits 3 when the target branch does not resolve at all', () => {
    const { repo } = originBackedRepo();
    const result = postMerge([
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
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('verification could not run');
    expect(result.stderr).toContain('no-such-branch');
  });
});
