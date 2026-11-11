import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { makeTempDir } from './fs.ts';
import {
  assertAllowedGit,
  assertOwnedBranch,
  changedFileCount,
  classifyParentLanding,
  isAncestor,
  landingAction,
  ownPatchId,
  probeMergeTreeMergeBase,
  realGit,
  replayMerge,
  restackOnto,
  revParse,
  type GitRunner,
} from './stack-merge.ts';

const PARENT = 'blackhole/issue-1';
const CHILD = 'blackhole/issue-2';
const QUEUE = { issues: { '1': {}, '2': {} } };
const lines = (n: number, edits: Record<number, string> = {}): string =>
  Array.from({ length: n }, (_, i) => edits[i + 1] ?? `l${i + 1}`).join('\n') + '\n';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

type Fixture = {
  work: string;
  origin: string;
  git: (...args: string[]) => string;
  originGit: (...args: string[]) => string;
  write: (file: string, body: string) => void;
  commit: (message: string) => string;
  parentTip: string;
  childHead: string;
};

// A bare origin plus a working clone: main (l1..l10), a two-commit parent branch editing l1, and a
// child branched off the parent tip that appends l11 and adds child.txt.
const fixture = (): Fixture => {
  const root = makeTempDir('stack-merge');
  dirs.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  fs.mkdirSync(work);
  const run = (cwd: string, args: string[]): string => {
    const r = spawnSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  run(root, ['init', '-q', '--bare', '-b', 'main', origin]);
  run(work, ['init', '-q', '-b', 'main']);
  run(work, ['config', 'user.name', 't']);
  run(work, ['config', 'user.email', 't@t']);
  run(work, ['remote', 'add', 'origin', origin]);
  const git = (...args: string[]) => run(work, args);
  const write = (file: string, body: string) => fs.writeFileSync(path.join(work, file), body);
  const commit = (message: string): string => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };

  write('shared.txt', lines(10));
  write('base.txt', 'base\n');
  commit('base');
  git('checkout', '-q', '-b', PARENT);
  write('shared.txt', lines(10, { 1: 'P1' }));
  commit('parent 1');
  write('p.txt', 'p\n');
  const parentTip = commit('parent 2');
  git('checkout', '-q', '-b', CHILD);
  write('shared.txt', lines(10, { 1: 'P1' }) + 'l11\n');
  write('child.txt', 'c\n');
  const childHead = commit('child');
  git('push', '-q', 'origin', 'main', PARENT, CHILD);
  git('checkout', '-q', 'main');
  return { work, origin, git, originGit: (...args) => run(origin, args), write, commit, parentTip, childHead };
};

const landSquash = (f: Fixture): void => {
  f.git('checkout', '-q', 'main');
  f.git('merge', '--squash', '-q', PARENT);
  f.commit('parent squashed');
  f.write('unrelated.txt', 'u\n');
  f.commit('unrelated');
  f.git('push', '-q', 'origin', 'main');
};

const landMergeCommit = (f: Fixture): void => {
  f.git('checkout', '-q', 'main');
  f.git('merge', '--no-ff', '-q', '-m', 'merge parent', PARENT);
  f.git('push', '-q', 'origin', 'main');
};

const landRebase = (f: Fixture): void => {
  f.git('checkout', '-q', 'main');
  f.write('unrelated.txt', 'u\n');
  f.commit('unrelated');
  f.git('cherry-pick', `${f.git('rev-list', '--max-parents=0', 'main')}..${PARENT}`);
  f.git('push', '-q', 'origin', 'main');
};

const replayArgs = (f: Fixture, extra: Record<string, unknown> = {}) => ({
  repoRoot: f.work,
  child: CHILD,
  newBase: 'main',
  mergeBase: f.parentTip,
  push: { remote: 'origin', queue: QUEUE },
  ...extra,
});

describe('git support probe', () => {
  test('this git supports merge-tree --write-tree --merge-base', () => {
    const f = fixture();
    expect(probeMergeTreeMergeBase(f.work)).toEqual({ supported: true });
  });

  test('a git without it yields "unsupported" and the replay refuses to fall back', () => {
    const f = fixture();
    landSquash(f);
    const oldGit: GitRunner = (root, args, input) =>
      args[0] === 'merge-tree'
        ? { ok: false, code: 129, stdout: '', stderr: "error: unknown option `merge-base=HEAD'" }
        : realGit(root, args, input);
    expect(probeMergeTreeMergeBase(f.work, oldGit).supported).toBe(false);
    const result = replayMerge(replayArgs(f, { git: oldGit }));
    expect(result.status).toBe('unsupported');
    expect(f.originGit('rev-parse', CHILD)).toBe(f.childHead);
    expect(restackOnto({ repoRoot: f.work, child: CHILD, parentHead: PARENT, git: oldGit }).status).toBe('unsupported');
  });
});

describe('parent squash-merged', () => {
  test('replays with the recorded tip as base: zero conflicts, own diff preserved, two parents, fast-forward push', () => {
    const f = fixture();
    landSquash(f);
    expect(classifyParentLanding({ repoRoot: f.work, parentTip: f.parentTip, target: 'main', forge: { state: 'closed', merged: true } })).toBe('rewrite');
    expect(changedFileCount(f.work, 'main', CHILD, true)).toBeGreaterThan(2);

    const result = replayMerge(replayArgs(f));
    if (result.status !== 'merged') throw new Error(JSON.stringify(result));
    expect(result.pushed).toBe(true);
    expect(result.reviewCarry).toBe(true);
    expect(result.expectedFiles).toBe(2);
    expect(result.observedFiles).toBe(2);

    expect(f.git('rev-list', '--parents', '-n', '1', result.sha).split(' ').slice(1)).toEqual([f.childHead, revParse(f.work, 'main')]);
    expect(isAncestor(f.work, f.childHead, result.sha)).toBe(true);
    expect(f.originGit('rev-parse', CHILD)).toBe(result.sha);
    expect(ownPatchId(f.work, 'main', result.sha)).toBe(ownPatchId(f.work, f.parentTip, f.childHead));
    expect(f.git('diff', '--name-only', `main..${result.sha}`).split('\n').sort()).toEqual(['child.txt', 'shared.txt']);
  });

  test('re-running the replay once the child already contains the new base is up-to-date and pushes nothing', () => {
    const f = fixture();
    landSquash(f);
    const first = replayMerge(replayArgs(f));
    if (first.status !== 'merged') throw new Error(JSON.stringify(first));
    const again = replayMerge(replayArgs(f, { child: first.sha, childBranch: CHILD }));
    expect(again).toEqual({ status: 'up-to-date' });
    expect(f.originGit('rev-parse', CHILD)).toBe(first.sha);
  });

  test('a build without a push leaves the remote untouched', () => {
    const f = fixture();
    landSquash(f);
    const result = replayMerge(replayArgs(f, { push: undefined }));
    expect(result.status === 'merged' && result.pushed).toBe(false);
    expect(f.originGit('rev-parse', CHILD)).toBe(f.childHead);
  });
});

describe('parent merged with a merge commit', () => {
  test('is retarget-only: the child already contains the tip, no commit is created', () => {
    const f = fixture();
    landMergeCommit(f);
    const kind = classifyParentLanding({ repoRoot: f.work, parentTip: f.parentTip, target: 'main', forge: { state: 'closed', merged: true } });
    expect(kind).toBe('merge-commit');
    expect(landingAction(kind)).toBe('retarget-only');
    expect(changedFileCount(f.work, 'main', CHILD, true)).toBe(2);
    expect(f.originGit('rev-parse', CHILD)).toBe(f.childHead);
  });
});

describe('parent rebase-merged', () => {
  test('classifies as a rewrite and replays exactly like a squash', () => {
    const f = fixture();
    landRebase(f);
    expect(classifyParentLanding({ repoRoot: f.work, parentTip: f.parentTip, target: 'main', forge: { state: 'closed', merged: true } })).toBe('rewrite');
    const result = replayMerge(replayArgs(f));
    if (result.status !== 'merged') throw new Error(JSON.stringify(result));
    expect(result.reviewCarry).toBe(true);
    expect(f.git('diff', '--name-only', `main..${result.sha}`).split('\n').sort()).toEqual(['child.txt', 'shared.txt']);
  });
});

describe('parent closed unmerged', () => {
  test('replaying against the parent base removes the parent lines', () => {
    const f = fixture();
    expect(classifyParentLanding({ repoRoot: f.work, parentTip: f.parentTip, target: 'main', forge: { state: 'closed', merged: false } })).toBe('abandoned');
    const result = replayMerge(replayArgs(f));
    if (result.status !== 'merged') throw new Error(JSON.stringify(result));
    const shared = f.git('show', `${result.sha}:shared.txt`);
    expect(shared).not.toContain('P1');
    expect(shared).toContain('l11');
    expect(f.git('ls-tree', '--name-only', result.sha).split('\n')).not.toContain('p.txt');
  });

  test('reports a conflict, and pushes nothing, when the child edited the parent lines', () => {
    const f = fixture();
    f.git('checkout', '-q', CHILD);
    f.write('shared.txt', lines(10, { 1: 'CHILD-EDIT' }));
    f.commit('child edits the parent line');
    f.git('push', '-q', 'origin', CHILD);
    const before = f.originGit('rev-parse', CHILD);
    f.git('checkout', '-q', 'main');
    const result = replayMerge(replayArgs(f));
    expect(result).toEqual({ status: 'conflict', conflicts: ['shared.txt'] });
    expect(f.originGit('rev-parse', CHILD)).toBe(before);
  });
});

describe('external parent force-pushed', () => {
  test('replays with the old tip as base onto the new head', () => {
    const f = fixture();
    f.git('checkout', '-q', PARENT);
    f.git('reset', '-q', '--hard', 'main');
    f.write('shared.txt', lines(10, { 5: 'P5' }));
    f.write('p.txt', 'p\n');
    const newHead = f.commit('parent rewritten');
    f.git('checkout', '-q', 'main');

    expect(classifyParentLanding({ repoRoot: f.work, parentTip: f.parentTip, target: PARENT, forge: { state: 'open', merged: false } })).toBe('force-pushed');
    expect(landingAction('force-pushed')).toBe('replay');
    const result = replayMerge(replayArgs(f, { newBase: PARENT }));
    if (result.status !== 'merged') throw new Error(JSON.stringify(result));
    const shared = f.git('show', `${result.sha}:shared.txt`);
    expect(shared).toContain('P5');
    expect(shared).not.toContain('P1');
    expect(f.git('diff', '--name-only', `${newHead}..${result.sha}`).split('\n').sort()).toEqual(['child.txt', 'shared.txt']);
  });

  test('a parent that merely advanced is classified for an ordinary restack', () => {
    const f = fixture();
    f.git('checkout', '-q', PARENT);
    f.write('p2.txt', 'x\n');
    f.commit('parent advances');
    f.git('checkout', '-q', 'main');
    expect(classifyParentLanding({ repoRoot: f.work, parentTip: f.parentTip, target: PARENT, forge: { state: 'open', merged: false } })).toBe('advanced');
  });
});

describe('late restack', () => {
  const lateFixture = () => {
    const f = fixture();
    // an older open PR and a child that branched from main before the overlap appeared
    f.git('checkout', '-q', 'main');
    f.git('checkout', '-q', '-b', 'blackhole/issue-3');
    f.write('late-child.txt', 'c\n');
    f.write('shared.txt', lines(10) + 'l11\n');
    f.commit('late child');
    f.git('push', '-q', 'origin', 'blackhole/issue-3');
    f.git('checkout', '-q', 'main');
    return f;
  };
  const queue = { issues: { '1': {}, '2': {}, '3': {} } };

  test('a normal merge of the parent head yields only the child own diff against the parent', () => {
    const f = lateFixture();
    const result = restackOnto({ repoRoot: f.work, child: 'blackhole/issue-3', parentHead: PARENT, push: { remote: 'origin', queue } });
    if (result.status !== 'merged') throw new Error(JSON.stringify(result));
    expect(result.pushed).toBe(true);
    expect(f.originGit('rev-parse', 'blackhole/issue-3')).toBe(result.sha);
    expect(f.git('diff', '--name-only', `${PARENT}...${result.sha}`).split('\n').sort()).toEqual(['late-child.txt', 'shared.txt']);
    expect(restackOnto({ repoRoot: f.work, child: result.sha, parentHead: PARENT }).status).toBe('up-to-date');
  });

  test('a real conflict is reported and nothing is pushed', () => {
    const f = lateFixture();
    f.git('checkout', '-q', 'blackhole/issue-3');
    f.write('shared.txt', lines(10, { 1: 'LATE' }));
    f.commit('conflicting edit');
    f.git('push', '-q', 'origin', 'blackhole/issue-3');
    f.git('checkout', '-q', 'main');
    const before = f.originGit('rev-parse', 'blackhole/issue-3');
    const result = restackOnto({ repoRoot: f.work, child: 'blackhole/issue-3', parentHead: PARENT, push: { remote: 'origin', queue } });
    expect(result).toEqual({ status: 'conflict', conflicts: ['shared.txt'] });
    expect(f.originGit('rev-parse', 'blackhole/issue-3')).toBe(before);
  });
});

describe('patch-id', () => {
  test('is equal before and after a conflict-free replay', () => {
    const f = fixture();
    landSquash(f);
    const result = replayMerge(replayArgs(f, { push: undefined }));
    if (result.status !== 'merged') throw new Error(JSON.stringify(result));
    expect(ownPatchId(f.work, 'main', result.sha)).toBe(ownPatchId(f.work, f.parentTip, f.childHead));
  });

  test('differs after a hand-resolved conflict', () => {
    const f = fixture();
    f.git('checkout', '-q', 'main');
    f.write('shared.txt', lines(10) + 'l11-from-main\n');
    f.commit('main touches the same tail');
    f.git('checkout', '-q', CHILD);
    expect(spawnSync('git', ['-C', f.work, 'merge', '--no-commit', '--no-ff', 'main']).status).not.toBe(0);
    f.write('shared.txt', lines(10, { 1: 'P1' }) + 'l11\nresolved-differently\n');
    f.git('add', 'shared.txt');
    f.git('commit', '-q', '--no-edit');
    expect(ownPatchId(f.work, 'main', 'HEAD')).not.toBe(ownPatchId(f.work, f.parentTip, f.childHead));
  });
});

describe('high-risk guards', () => {
  test('a recorded tip that is not an ancestor of the child is refused before any merge', () => {
    const f = fixture();
    landSquash(f);
    const result = replayMerge(replayArgs(f, { mergeBase: 'main' }));
    expect(result.status).toBe('refused');
    expect(result.status === 'refused' && result.code).toBe('not-ancestor');
    expect(f.originGit('rev-parse', CHILD)).toBe(f.childHead);
  });

  test('a wrong-but-ancestral boundary fails the file-count check and pushes nothing', () => {
    const f = fixture();
    landSquash(f);
    const baseCommit = f.git('rev-list', '--max-parents=0', 'main');
    const result = replayMerge(replayArgs(f, { mergeBase: baseCommit }));
    expect(result.status === 'refused' && result.code).toBe('file-count');
    expect(f.originGit('rev-parse', CHILD)).toBe(f.childHead);
  });

  test('a clean merge that changes the own patch-id is refused unless explicitly accepted', () => {
    const f = fixture();
    landSquash(f);
    f.write('shared.txt', fs.readFileSync(path.join(f.work, 'shared.txt'), 'utf-8').replace('l9\n', 'l9-main\n'));
    f.commit('main edits the child hunk context');
    f.git('push', '-q', 'origin', 'main');
    const refused = replayMerge(replayArgs(f));
    expect(refused.status === 'refused' && refused.code).toBe('patch-id');
    expect(f.originGit('rev-parse', CHILD)).toBe(f.childHead);

    const accepted = replayMerge(replayArgs(f, { acceptPatchIdChange: true }));
    expect(accepted.status === 'merged' && accepted.reviewCarry).toBe(false);
  });

  test('a push to a branch outside the queue is refused', () => {
    const f = fixture();
    landSquash(f);
    const result = replayMerge(replayArgs(f, { push: { remote: 'origin', queue: { issues: { '1': {} } } } }));
    expect(result.status === 'refused' && result.code).toBe('unowned');
    expect(f.originGit('rev-parse', CHILD)).toBe(f.childHead);
  });

  test('a remote child that moved on rejects the non-fast-forward push, and nothing is forced', () => {
    const f = fixture();
    landSquash(f);
    const other = path.join(path.dirname(f.work), 'other');
    spawnSync('git', ['clone', '-q', f.origin, other]);
    spawnSync('git', ['-C', other, 'checkout', '-q', CHILD]);
    fs.writeFileSync(path.join(other, 'someone.txt'), 's\n');
    spawnSync('git', ['-C', other, 'add', '-A']);
    spawnSync('git', ['-C', other, '-c', 'user.name=o', '-c', 'user.email=o@o', 'commit', '-q', '-m', 'someone else']);
    spawnSync('git', ['-C', other, 'push', '-q', 'origin', CHILD]);
    const moved = f.originGit('rev-parse', CHILD);

    const result = replayMerge(replayArgs(f));
    expect(result.status === 'refused' && result.code).toBe('push-rejected');
    expect(f.originGit('rev-parse', CHILD)).toBe(moved);
  });

  test('every push the module runs is a plain <sha>:refs/heads/<branch> fast-forward', () => {
    const f = fixture();
    landSquash(f);
    const seen: string[][] = [];
    const recording: GitRunner = (root, args, input) => {
      seen.push(args);
      return realGit(root, args, input);
    };
    expect(replayMerge(replayArgs(f, { git: recording })).status).toBe('merged');
    const pushes = seen.filter((a) => a.includes('push'));
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toEqual(['push', 'origin', expect.stringMatching(/^[0-9a-f]{40}:refs\/heads\/blackhole\/issue-2$/)]);
  });
});

describe('assertOwnedBranch', () => {
  test('accepts a queue-owned campaign branch', () => {
    expect(() => assertOwnedBranch(CHILD, QUEUE)).not.toThrow();
  });

  test('refuses an external head ref and a branch of an issue not in the queue', () => {
    expect(() => assertOwnedBranch('feature/someone-elses-work', QUEUE)).toThrow(/refusing to push/);
    expect(() => assertOwnedBranch('blackhole/issue-9', QUEUE)).toThrow(/refusing to push/);
    expect(() => assertOwnedBranch('main', {})).toThrow(/refusing to push/);
  });
});

describe('no history rewriting', () => {
  const source = fs.readFileSync(path.join(import.meta.dir, 'stack-merge.ts'), 'utf-8');

  test('the source contains no rebase, force option or force push', () => {
    expect(source).not.toMatch(/rebase/);
    expect(source).not.toMatch(/--force/);
    expect(source).not.toMatch(/force-with-lease/);
    expect(source).not.toMatch(/push\s+-f/);
  });

  test('the runner refuses anything outside the allowlist, at execution time', () => {
    const sha = 'a'.repeat(40);
    for (const args of [
      ['reb' + 'ase', 'main'],
      ['reset', '--hard', 'main'],
      ['push', '--for' + 'ce', 'origin', `${sha}:refs/heads/blackhole/issue-2`],
      ['push', 'origin', `+${sha}:refs/heads/blackhole/issue-2`],
      ['push', 'origin', `${sha}:refs/heads/main`],
      ['push', 'origin', `${sha}:refs/heads/blackhole/issue-2`, '-f'],
      ['push', 'origin', '--delete', 'blackhole/issue-2'],
      ['merge', 'main'],
    ]) {
      expect(() => assertAllowedGit(args)).toThrow();
    }
    expect(() => assertAllowedGit(['push', 'origin', `${sha}:refs/heads/blackhole/issue-2`])).not.toThrow();
  });
});
