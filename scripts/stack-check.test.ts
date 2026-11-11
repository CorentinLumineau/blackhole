import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from './lib/fs.ts';
import type { OpenPrSnapshot, SnapshotPr } from './lib/open-pr-snapshot.ts';
import { evaluateStackGate } from './stack-check.ts';

// V-STACK-02: a PR that would conflict with another open PR must be stacked on it. Exit codes
// follow merge-base-guard.ts: 0 proceed, 1 refuse, 2 usage, 3 could not check.

const spr = (number: number, files: string[] | null, extra: Partial<SnapshotPr> = {}): SnapshotPr => ({
  number,
  headRefName: `feat-${number}`,
  headSha: `sha${number}`,
  baseRefName: 'main',
  isFork: false,
  draft: false,
  createdAt: null,
  files,
  ...extra,
});
const snap = (...prs: SnapshotPr[]): OpenPrSnapshot => ({ status: 'ok', prs, filesSource: 'refs' });
const conflict = () => 'conflict' as const;

describe('evaluateStackGate', () => {
  test('overlapping and not stacked: exit 1 naming V-STACK-02 and both PRs', () => {
    const r = evaluateStackGate(9, snap(spr(7, ['a.ts']), spr(9, ['a.ts'])), conflict);
    expect(r.exit).toBe(1);
    expect(r.message).toContain('V-STACK-02');
    expect(r.message).toContain('#9');
    expect(r.message).toContain('#7');
    expect(r.message).toContain('feat-7');
  });

  test('stacked on the right tip of the chain: exit 0', () => {
    const r = evaluateStackGate(9, snap(spr(7, ['a.ts']), spr(8, ['a.ts'], { baseRefName: 'feat-7' }), spr(9, ['a.ts'], { baseRefName: 'feat-8' })), conflict);
    expect(r.exit).toBe(0);
  });

  test('stacked on a non-tip of the same chain: exit 1, pointing at the tip', () => {
    const r = evaluateStackGate(9, snap(spr(7, ['a.ts']), spr(8, ['a.ts'], { baseRefName: 'feat-7' }), spr(9, ['a.ts'], { baseRefName: 'feat-7' })), conflict);
    expect(r.exit).toBe(1);
    expect(r.message).toContain('#8');
  });

  test('no overlap with any other open PR: exit 0', () => {
    expect(evaluateStackGate(9, snap(spr(7, ['a.ts']), spr(9, ['b.ts'])), conflict).exit).toBe(0);
  });

  test('a younger overlapping PR is not a reason to fail the older one', () => {
    expect(evaluateStackGate(7, snap(spr(7, ['a.ts']), spr(9, ['a.ts'])), conflict).exit).toBe(0);
  });

  test('a fork parent is exempt: exit 0 with the exemption reason printed', () => {
    const r = evaluateStackGate(9, snap(spr(7, ['a.ts'], { isFork: true }), spr(9, ['a.ts'])), conflict);
    expect(r.exit).toBe(0);
    expect(r.message).toContain('unstackable-parent:fork:#7');
  });

  test('a stack deeper than the cap: exit 1', () => {
    const chain = [spr(1, ['a.ts']), spr(2, ['a.ts'], { baseRefName: 'feat-1' }), spr(3, ['a.ts'], { baseRefName: 'feat-2' }), spr(4, ['a.ts'], { baseRefName: 'feat-3' })];
    const r = evaluateStackGate(9, snap(...chain, spr(9, ['a.ts'])), conflict);
    expect(r.exit).toBe(1);
    expect(r.message).toContain('depth');
  });

  test('an unknown snapshot is exit 3, never 0', () => {
    const r = evaluateStackGate(9, { status: 'unknown', reason: 'forge down' }, conflict);
    expect(r.exit).toBe(3);
    expect(r.message).toContain('forge down');
  });

  test('a PR missing from the snapshot is exit 3', () => {
    expect(evaluateStackGate(9, snap(spr(7, ['a.ts'])), conflict).exit).toBe(3);
  });

  test('a merge-tree verdict that cannot be read is exit 3', () => {
    expect(evaluateStackGate(9, snap(spr(7, ['a.ts']), spr(9, ['a.ts'])), () => 'unknown').exit).toBe(3);
  });

  test('a shared file that merges clean is not an overlap', () => {
    expect(evaluateStackGate(9, snap(spr(7, ['a.ts']), spr(9, ['a.ts'])), () => 'clean').exit).toBe(0);
  });
});

const cli = (...args: string[]) => {
  const r = Bun.spawnSync(['bun', 'run', path.join(import.meta.dir, 'stack-check.ts'), ...args]);
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
};

describe('stack-check CLI', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const openPrs = (value: unknown): string => {
    const dir = makeTempDir('stack-check-');
    dirs.push(dir);
    const file = path.join(dir, 'open-prs.json');
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };

  test('malformed flags are exit 2', () => {
    expect(cli().code).toBe(2);
    expect(cli('--pr', 'abc').code).toBe(2);
    expect(cli('--pr', '9', '--bogus', 'x').code).toBe(2);
  });

  test('--open-prs serves the snapshot: overlap is exit 1, --fix prints the restack hint', () => {
    const file = openPrs(snap(spr(7, ['a.ts']), spr(9, ['a.ts'])));
    const r = cli('--pr', '9', '--open-prs', file, '--fix');
    expect(r.code).toBe(1);
    expect(r.out).toContain('V-STACK-02');
    expect(r.out).toContain('stack-repair.ts restack');
  });

  test('--open-prs with no overlap is exit 0', () => {
    expect(cli('--pr', '9', '--open-prs', openPrs(snap(spr(7, ['a.ts']), spr(9, ['b.ts'])))).code).toBe(0);
  });

  test('an unreadable --open-prs file is exit 3', () => {
    expect(cli('--pr', '9', '--open-prs', '/nonexistent/open-prs.json').code).toBe(3);
  });

  test('an unknown snapshot in --open-prs is exit 3', () => {
    expect(cli('--pr', '9', '--open-prs', openPrs({ status: 'unknown', reason: 'x' })).code).toBe(3);
  });
});
