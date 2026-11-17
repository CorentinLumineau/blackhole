import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { listStateFiles, pullState, pushState, STATE_BRANCH } from './state-branch.ts';
import { runGit, withTempDir } from './test-fixtures.ts';

const STATE: Record<string, string | Buffer> = {
  '.blackhole/config.json': '{"repo":"o/r"}\n',
  '.blackhole/queue.json': JSON.stringify({ refreshed_at: 't', issues: { '1': { status: 'ready' } } }, null, 2),
  '.blackhole/findings-ledger.json': '{"next_id":2,"findings":[{"id":"F-00001"}]}',
  '.blackhole/campaign-checkpoint.md': '---\norchestrator_turn_id: 7\n---\n\n# Campaign Checkpoint\n',
  '.blackhole/plans/issue-1.md': '# Plan\r\nwith CRLF and trailing spaces   \n',
  '.blackhole/staged/1/manifest.json': '{"issue":1,"entries":[]}',
  '.blackhole/staged/1/blob.bin': Buffer.from([0, 255, 10, 13, 128]),
};
const MACHINE_ONLY: Record<string, string> = {
  '.blackhole/run-context.json': '{}',
  '.blackhole/plugin-drift.json': '{}',
  '.blackhole/pace-log.jsonl': '{}',
  '.blackhole/queue.json.tmp': 'partial',
  '.blackhole/archive/queue-1.json': '{}',
  '.blackhole/hook-events/e.json': '{}',
  '.blackhole/.tmp/x': 'x',
};

const write = (repo: string, files: Record<string, string | Buffer>) => {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content);
  }
};

const gitOut = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf-8' }).stdout.trim();

/** A bare remote with one commit on main, and `clone(name)` for fresh checkouts of it. */
const withRemote = (fn: (clone: (name: string) => string) => void) =>
  withTempDir('state-branch-', (dir) => {
    const remote = path.join(dir, 'remote.git');
    runGit(dir, ['init', '--quiet', '--bare', '-b', 'main', remote]);
    const clone = (name: string) => {
      const repo = path.join(dir, name);
      runGit(dir, ['clone', '--quiet', remote, repo]);
      runGit(repo, ['config', 'user.email', 't@example.com']);
      runGit(repo, ['config', 'user.name', 'T']);
      return repo;
    };
    const seed = clone('seed');
    fs.writeFileSync(path.join(seed, '.gitignore'), '.blackhole/\n');
    fs.writeFileSync(path.join(seed, 'README.md'), 'x\n');
    runGit(seed, ['add', '.']);
    runGit(seed, ['commit', '--quiet', '-m', 'init']);
    runGit(seed, ['push', '--quiet', 'origin', 'main']);
    fn(clone);
  });

describe('state branch store (ADR-049)', () => {
  test('a fresh clone restores queue, ledger, checkpoint, plans and staging byte-for-byte', () => {
    withRemote((clone) => {
      const a = clone('a');
      write(a, { ...STATE, ...MACHINE_ONLY });
      const head = gitOut(a, ['rev-parse', 'HEAD']);

      const pushed = pushState(a, 'checkpoint turn 7');
      expect(pushed).toMatchObject({ status: 'pushed', files: Object.keys(STATE).length });
      // The checked-out branch, its index and the working tree are untouched.
      expect(gitOut(a, ['rev-parse', 'HEAD'])).toBe(head);
      expect(gitOut(a, ['status', '--porcelain'])).toBe('');
      expect(gitOut(a, ['symbolic-ref', '--short', 'HEAD'])).toBe('main');

      const b = clone('b');
      const pulled = pullState(b);
      expect(pulled.status).toBe('restored');
      for (const [rel, content] of Object.entries(STATE)) {
        expect(fs.readFileSync(path.join(b, rel)).equals(Buffer.from(content))).toBe(true);
      }
      for (const rel of Object.keys(MACHINE_ONLY)) expect(fs.existsSync(path.join(b, rel))).toBe(false);
      expect(listStateFiles(b)).toEqual(Object.keys(STATE).sort());
    });
  });

  test('pushing unchanged state adds no commit; a change commits on top of the previous tip', () => {
    withRemote((clone) => {
      const a = clone('a');
      write(a, STATE);
      const first = pushState(a, 'turn 1');
      expect(pushState(a, 'turn 1 again')).toEqual({ status: 'unchanged', commit: first.commit, files: first.files });

      write(a, { '.blackhole/queue.json': '{"issues":{}}' });
      const second = pushState(a, 'turn 2');
      expect(second.status).toBe('pushed');
      expect(gitOut(a, ['rev-parse', `${second.commit}^`])).toBe(first.commit!);
      expect(gitOut(a, ['log', '--format=%s', `refs/remotes/origin/${STATE_BRANCH}`]).split('\n')).toEqual(['turn 2', 'turn 1']);
    });
  });

  test('pull refuses to overwrite a differing local file unless forced', () => {
    withRemote((clone) => {
      const a = clone('a');
      write(a, STATE);
      pushState(a, 'turn 1');

      const b = clone('b');
      write(b, { '.blackhole/queue.json': 'local, newer' });
      const refused = pullState(b);
      expect(refused).toMatchObject({ status: 'conflict', differing: ['.blackhole/queue.json'] });
      expect(fs.readFileSync(path.join(b, '.blackhole/queue.json'), 'utf-8')).toBe('local, newer');
      expect(fs.existsSync(path.join(b, '.blackhole/findings-ledger.json'))).toBe(false);

      expect(pullState(b, { force: true }).status).toBe('restored');
      expect(fs.readFileSync(path.join(b, '.blackhole/queue.json'), 'utf-8')).toBe(STATE['.blackhole/queue.json']);
    });
  });

  test('pull reports an absent branch and push reports empty state', () => {
    withRemote((clone) => {
      const a = clone('a');
      expect(pullState(a)).toEqual({ status: 'absent' });
      expect(pushState(a, 'nothing')).toEqual({ status: 'empty', commit: null, files: 0 });
    });
  });
});
