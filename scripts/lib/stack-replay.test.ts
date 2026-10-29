import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from './fs.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]): { code: number; out: string } => {
  const r = Bun.spawnSync(
    ['git', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdout: 'pipe', stderr: 'pipe' },
  );
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};

const write = (cwd: string, file: string, body: string): void => {
  fs.writeFileSync(path.join(cwd, file), body);
};

describe('stacked child replay after a squash-merged parent', () => {
  test('merging the target branch into the child, with a hand resolution, leaves zero conflicts', () => {
    const repo = makeTempDir('stack-replay');
    dirs.push(repo);
    git(repo, 'init', '-q', '-b', 'main');
    write(repo, 'shared.txt', 'base\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'base');

    git(repo, 'checkout', '-q', '-b', 'parent');
    write(repo, 'shared.txt', 'base\nparent\n');
    git(repo, 'commit', '-q', '-am', 'parent change');

    git(repo, 'checkout', '-q', '-b', 'child');
    write(repo, 'shared.txt', 'base\nparent\nchild\n');
    write(repo, 'child-only.txt', 'child\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'child change');

    git(repo, 'checkout', '-q', 'main');
    expect(git(repo, 'merge', '--squash', 'parent').code).toBe(0);
    git(repo, 'commit', '-q', '-m', 'squash parent');
    write(repo, 'unrelated.txt', 'main-only\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'unrelated main change');

    // Documented replay: merge main into the child (never rebase), resolve the shared source
    // file by hand keeping both sides' intent, and commit the merge.
    git(repo, 'checkout', '-q', 'child');
    expect(git(repo, 'merge', '--no-commit', '--no-ff', 'main').code).not.toBe(0);
    write(repo, 'shared.txt', 'base\nparent\nchild\n');
    git(repo, 'add', 'shared.txt');
    expect(git(repo, 'commit', '-q', '--no-edit').code).toBe(0);

    git(repo, 'checkout', '-q', 'main');
    const final = git(repo, 'merge', '--no-edit', 'child');
    expect(final.code).toBe(0);
    expect(fs.readFileSync(path.join(repo, 'shared.txt'), 'utf8')).toBe('base\nparent\nchild\n');
    expect(fs.existsSync(path.join(repo, 'child-only.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'unrelated.txt'), 'utf8')).toBe('main-only\n');
  });
});
