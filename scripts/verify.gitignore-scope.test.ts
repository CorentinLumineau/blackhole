import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

describe('.gitignore scope', () => {
  test('no tracked file is ignored by a depth-unanchored pattern', () => {
    // `git ls-files` lists tracked paths; piping them through `check-ignore --no-index`
    // re-evaluates .gitignore against those exact paths regardless of their tracked state
    // (plain `check-ignore` without --no-index always returns empty for tracked files,
    // which is why an unanchored pattern like `build/` can silently swallow a tracked
    // directory such as scripts/lib/build/ without ever showing up here otherwise).
    // `-v` is deliberately omitted: it also reports paths whose decisive match is a
    // negation (e.g. `!.gemini-plugin/plugin.json`), which are not actually ignored.
    const lsFiles = spawnSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    expect(lsFiles.status).toBe(0);

    const checkIgnore = spawnSync(
      'git',
      ['check-ignore', '--no-index', '--stdin'],
      { cwd: REPO_ROOT, encoding: 'utf-8', input: lsFiles.stdout }
    );

    expect(checkIgnore.stdout.trim()).toBe('');
  });
});
