import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { makeTempDir } from './lib/fs.ts';
import { replayMerge } from './lib/stack-merge.ts';
import {
  changedFileCount,
  childBranchFor,
  findStackedChildren,
  main,
  planRepair,
  planRestack,
  recordParentTip,
  recordStackEdge,
  squashMergeWarning,
  verifyChildFileCount,
  verifyRetarget,
  type QueueIssues,
  type StackedChild,
} from './stack-repair.ts';

const child = (overrides: Partial<StackedChild> = {}): StackedChild => ({
  issue: 2403,
  pr: 2403,
  branch: 'blackhole/issue-2403',
  parentTipSha: 'd014e82a426c53ede436e2c446834182a5690e9a',
  ...overrides,
});

describe('childBranchFor', () => {
  test('derives the campaign branch convention from an issue number', () => {
    expect(childBranchFor(794)).toBe('blackhole/issue-794');
  });
});

describe('findStackedChildren (pure)', () => {
  const issues: QueueIssues = {
    '2403': { status: 'in-flight', pr: 2403, stacked_on: 2400, parent_tip_sha: 'aaa111' },
    '2412': { status: 'ready', pr: 2412, stacked_on: 2400, parent_tip_sha: 'bbb222' },
    '2390': { status: 'merged', pr: 2390, stacked_on: 2400, parent_tip_sha: 'ccc333' },
    '2500': { status: 'ready', pr: 2500, stacked_on: 2499, parent_tip_sha: 'ddd444' },
    '2600': { status: 'ready', pr: 2600 },
  };

  test('returns only open children of the named parent, ascending by issue number', () => {
    expect(findStackedChildren(issues, 2400).map((c) => c.issue)).toEqual([2403, 2412]);
  });

  test('carries each child branch and recorded parent tip through', () => {
    expect(findStackedChildren(issues, 2400)[0]).toEqual({
      issue: 2403,
      pr: 2403,
      branch: 'blackhole/issue-2403',
      parentTipSha: 'aaa111',
    });
  });

  test('surfaces a child whose parent tip was never recorded rather than dropping it', () => {
    const withGap: QueueIssues = { '2403': { status: 'ready', pr: 2403, stacked_on: 2400 } };
    expect(findStackedChildren(withGap, 2400)).toEqual([
      { issue: 2403, pr: 2403, branch: 'blackhole/issue-2403', parentTipSha: null },
    ]);
  });

  test('a parent with no stacked children yields an empty list', () => {
    expect(findStackedChildren(issues, 9999)).toEqual([]);
  });
});

describe('planRepair (pure)', () => {
  test('emits retarget-then-replay-merge in execution order, using the REST PATCH form', () => {
    const plan = planRepair(child(), 'main', 'CorentinLumineau/invest', '/repo');
    expect(plan.refusal).toBeNull();
    expect(plan.commands).toEqual([
      'git -C /repo fetch origin main',
      'gh api -X PATCH repos/CorentinLumineau/invest/pulls/2403 -f base=main',
      'gh api repos/CorentinLumineau/invest/pulls/2403 --jq .base.ref',
      'git -C /repo merge-tree --write-tree --name-only --merge-base=d014e82a426c53ede436e2c446834182a5690e9a blackhole/issue-2403 origin/main',
      'git -C /repo commit-tree <tree> -p blackhole/issue-2403 -p origin/main -m "Merge main into blackhole/issue-2403 (replay from recorded parent tip)"',
      'git -C /repo push origin <merge-commit>:refs/heads/blackhole/issue-2403',
    ]);
  });

  test('no planned command rewrites history: no rebase, no force, no plus-refspec', () => {
    const planned = [
      ...planRepair(child(), 'main', 'o/r', '/repo').commands,
      ...planRestack(child(), 'blackhole/issue-2400', 'o/r', '/repo').commands,
    ];
    expect(planned.length).toBeGreaterThan(0);
    for (const command of planned) {
      expect(command).not.toMatch(/rebase|--force|force-with-lease|push\s+-f|\s\+[^\s]*:/);
    }
    expect(planned.filter((c) => c.includes(' push ')).every((c) => /push origin <merge-commit>:refs\/heads\/blackhole\/issue-\d+$/.test(c))).toBe(true);
  });

  test('never emits `gh pr edit --base`, which silently no-ops on a classic-Projects repo', () => {
    const plan = planRepair(child(), 'main', 'o/r', '/repo');
    expect(plan.commands.some((c) => c.includes('pr edit'))).toBe(false);
  });

  test('refuses, with no commands, when the parent tip was never captured', () => {
    const plan = planRepair(child({ parentTipSha: null }), 'main', 'o/r', '/repo');
    expect(plan.commands).toEqual([]);
    expect(plan.refusal).toContain('no parent_tip_sha recorded for #2403');
  });

  test('refuses when the child has no PR to retarget', () => {
    const plan = planRepair(child({ pr: null }), 'main', 'o/r', '/repo');
    expect(plan.commands).toEqual([]);
    expect(plan.refusal).toContain('no PR recorded for #2403');
  });
});

describe('planRestack and recordParentTip (pure)', () => {
  test('a restack merges the parent head, then retargets onto the parent branch', () => {
    const plan = planRestack(child(), 'blackhole/issue-2400', 'o/r', '/repo');
    expect(plan.commands[1]).toBe('gh api -X PATCH repos/o/r/pulls/2403 -f base=blackhole/issue-2400');
    expect(plan.commands[3]).toContain('merge-tree --write-tree --name-only blackhole/issue-2403 origin/blackhole/issue-2400');
  });

  test('a child with no PR cannot be restacked', () => {
    expect(planRestack(child({ pr: null }), 'p', 'o/r', '/repo').refusal).toContain('no PR recorded');
  });

  test('records the new parent tip, and the stack link when a parent issue is given', () => {
    const queue = { issues: { '2403': { status: 'ready', stacked_on: 2400, parent_tip_sha: 'old' } } };
    expect(recordParentTip(queue, 2403, 'newtip')).toBe(true);
    expect(queue.issues['2403']).toMatchObject({ parent_tip_sha: 'newtip', stacked_on: 2400 });
    expect(recordParentTip(queue, 2403, 'tip3', 2411)).toBe(true);
    expect(queue.issues['2403']).toMatchObject({ parent_tip_sha: 'tip3', stacked_on: 2411 });
  });

  test('an issue absent from the queue is reported, not invented', () => {
    expect(recordParentTip({ issues: {} }, 1, 'x')).toBe(false);
  });

  test('records the open PR a child was restacked onto, queue issue or not', () => {
    const queue = { issues: { '2403': { status: 'ready' } } };
    expect(recordStackEdge(queue, 2403, 157, 'feat/external')).toBe(true);
    expect(queue.issues['2403']).toMatchObject({ stacked_on_pr: 157, parent_branch: 'feat/external' });
    expect(recordStackEdge({ issues: {} }, 1, 2, 'b')).toBe(false);
  });
});

describe('verifyRetarget (pure)', () => {
  test('passes only when the read-back base ref equals the expected base', () => {
    expect(verifyRetarget('main\n', 'main')).toEqual({ ok: true, reason: 'base.ref == main' });
  });

  test('fails, naming both refs, when the base did not actually change', () => {
    const verdict = verifyRetarget('blackhole/issue-2400', 'main');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('base.ref is "blackhole/issue-2400", expected "main"');
  });

  test('an empty read-back is a failure, not a pass', () => {
    expect(verifyRetarget('', 'main').ok).toBe(false);
  });
});

describe('verifyChildFileCount (pure)', () => {
  test('passes when the post-repair count returned to the pre-merge value', () => {
    expect(verifyChildFileCount(4, 4).ok).toBe(true);
  });

  test('fails, naming both counts, when the child still carries the parent files', () => {
    const verdict = verifyChildFileCount(4, 9);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('is 9, expected 4');
  });
});

describe('squashMergeWarning (pure)', () => {
  test('stays silent on a repo that cannot squash — stacking is lossless there', () => {
    expect(squashMergeWarning({ allow_squash_merge: false, allow_merge_commit: true })).toBeNull();
  });

  test('warns, and names the merge-commit escape hatch, when both strategies are allowed', () => {
    const warning = squashMergeWarning({ allow_squash_merge: true, allow_merge_commit: true });
    expect(warning).toContain('allows squash merges');
    expect(warning).toContain('merge commit');
  });

  test('warns harder when squash is the only strategy available', () => {
    const warning = squashMergeWarning({ allow_squash_merge: true, allow_merge_commit: false });
    expect(warning).toContain('WILL break');
    expect(warning).toContain('mandatory');
  });
});

describe('repair CLI (queue-driven, no forge access)', () => {
  let dir: string;
  const queuePath = () => `${dir}/queue.json`;
  const writeQueue = (issues: QueueIssues) =>
    fs.writeFileSync(queuePath(), JSON.stringify({ refreshed_at: '2026-09-04T00:00:00.000Z', issues }, null, 2));
  const repairArgs = (extra: string[] = []) => [
    'repair',
    '--queue',
    queuePath(),
    '--repo-root',
    dir,
    '--repo-slug',
    'o/r',
    '--base',
    'main',
    '--parent-issue',
    '2400',
    ...extra,
  ];

  beforeAll(() => {
    dir = makeTempDir('blackhole-stack-repair-cli');
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a parent with no stacked children exits 0', () => {
    writeQueue({ '2403': { status: 'ready', pr: 2403 } });
    expect(main(repairArgs())).toBe(0);
  });

  test('a dry run over fully-recorded children exits 0', () => {
    writeQueue({ '2403': { status: 'ready', pr: 2403, stacked_on: 2400, parent_tip_sha: 'aaa111' } });
    expect(main(repairArgs())).toBe(0);
  });

  test('a dry run exits non-zero when a child has no recorded parent tip', () => {
    writeQueue({ '2403': { status: 'ready', pr: 2403, stacked_on: 2400 } });
    expect(main(repairArgs())).toBe(1);
  });

  test('--apply without --child-issue is refused, since the replay needs one child worktree', () => {
    writeQueue({ '2403': { status: 'ready', pr: 2403, stacked_on: 2400, parent_tip_sha: 'aaa111' } });
    expect(main(repairArgs(['--apply']))).toBe(2);
  });

  test('an unknown subcommand exits 2 rather than doing nothing quietly', () => {
    expect(main(['rebase'])).toBe(2);
  });

  test('a restack dry run prints the plan and exits 0 without touching git or the forge', () => {
    writeQueue({ '2403': { status: 'ready', pr: 2403, stacked_on: 2400, parent_tip_sha: 'aaa111' } });
    expect(main(['restack', '--queue', queuePath(), '--repo-root', dir, '--repo-slug', 'o/r', '--child-issue', '2403', '--parent-issue', '2400'])).toBe(0);
  });

  test('a restack for a child absent from the queue exits 1', () => {
    writeQueue({});
    expect(main(['restack', '--queue', queuePath(), '--repo-root', dir, '--repo-slug', 'o/r', '--child-issue', '2403', '--parent-issue', '2400'])).toBe(1);
  });

  test('a missing required flag exits 2', () => {
    expect(main(['repair', '--queue', queuePath()])).toBe(2);
  });
});

describe('capture CLI (against a real repository, no forge access)', () => {
  let repo: string;
  const queuePath = () => `${repo}/queue.json`;
  const readIssue = () => JSON.parse(fs.readFileSync(queuePath(), 'utf-8')).issues['301'];
  const captureArgs = (extra: string[] = []) => [
    'capture',
    '--queue',
    queuePath(),
    '--repo-root',
    repo,
    '--child-issue',
    '301',
    '--parent-issue',
    '298',
    ...extra,
  ];

  beforeAll(() => {
    repo = makeTempDir('blackhole-stack-capture');
    const git = (...args: string[]) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
    git('init', '-q', '-b', 'main', '.');
    git('config', 'user.email', 'campaign@example.invalid');
    git('config', 'user.name', 'campaign');
    fs.writeFileSync(`${repo}/base.txt`, 'base\n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', childBranchFor(298));
    fs.writeFileSync(`${repo}/parent.txt`, 'p\n');
    git('add', '-A');
    git('commit', '-qm', 'parent work');
    git('checkout', '-q', 'main');
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  const writeQueue = () =>
    fs.writeFileSync(
      queuePath(),
      JSON.stringify({ refreshed_at: '2026-09-04T00:00:00.000Z', issues: { '301': { status: 'ready', pr: 43 } } }, null, 2),
    );

  test('a dry run resolves the parent tip and writes nothing', () => {
    writeQueue();
    expect(main(captureArgs())).toBe(0);
    expect(readIssue().parent_tip_sha).toBeUndefined();
  });

  test('--apply records stacked_on and the 40-char parent tip on the child entry', () => {
    writeQueue();
    expect(main(captureArgs(['--apply']))).toBe(0);
    const issue = readIssue();
    expect(issue.stacked_on).toBe(298);
    expect(issue.parent_tip_sha).toMatch(/^[0-9a-f]{40}$/);
  });

  test('an unresolvable parent branch exits 1 instead of recording a null boundary', () => {
    writeQueue();
    expect(main(captureArgs(['--parent-branch', 'blackhole/issue-does-not-exist', '--apply']))).toBe(1);
    expect(readIssue().parent_tip_sha).toBeUndefined();
  });

  test('a child absent from the queue exits 1 rather than inventing an entry', () => {
    writeQueue();
    const args = captureArgs(['--apply']).map((a) => (a === '301' ? '999' : a));
    expect(main(args)).toBe(1);
  });
});

// A real repository standing in for the observed incident: a multi-commit parent branch,
// a child branched off its tip, and a squash-merge that collapses the parent into one commit
// whose patch-id matches none of the originals. Everything below is measured, not asserted from
// the recipe's description.
describe('the replay merge against a squash-merged parent', () => {
  let repo: string;
  let parentTip: string;
  const parentBranch = childBranchFor(1);
  const childBranch = childBranchFor(2);

  const git = (...args: string[]) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
  const writeFiles = (names: string[], content: string) => {
    for (const name of names) fs.writeFileSync(`${repo}/${name}`, `${content}\n`);
  };
  const commitAll = (message: string) => {
    git('add', '-A');
    git('commit', '-qm', message);
  };

  beforeAll(() => {
    repo = makeTempDir('blackhole-stack-repair');
    git('init', '-q', '-b', 'main', '.');
    git('config', 'user.email', 'campaign@example.invalid');
    git('config', 'user.name', 'campaign');
    writeFiles(['base.txt'], 'base');
    commitAll('base');

    git('checkout', '-qb', parentBranch);
    writeFiles(['parent1.txt', 'parent2.txt', 'parent3.txt'], 'p');
    commitAll('parent work 1');
    writeFiles(['parent1.txt', 'parent4.txt', 'parent5.txt'], 'p revised');
    commitAll('parent work 2');
    parentTip = git('rev-parse', 'HEAD').stdout.trim();

    git('checkout', '-qb', childBranch);
    writeFiles(['child1.txt', 'child2.txt', 'child3.txt', 'child4.txt'], 'c');
    commitAll('child work');

    git('checkout', '-q', 'main');
    git('merge', '--squash', '-q', parentBranch);
    commitAll('parent squashed');
    git('branch', '-qD', parentBranch);
  });

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('the child claims the parent files the moment the parent squash-lands', () => {
    expect(changedFileCount(repo, 'main', childBranch, true)).toBe(9);
    expect(changedFileCount(repo, parentTip, childBranch)).toBe(4);
  });

  test('replayMerge restores the child to its pre-merge file count, with one merge commit and no rewrite', () => {
    const before = git('rev-parse', childBranch).stdout.trim();
    const expectedFiles = changedFileCount(repo, parentTip, childBranch);
    const result = replayMerge({ repoRoot: repo, child: childBranch, newBase: 'main', mergeBase: parentTip });
    if (result.status !== 'merged') throw new Error(JSON.stringify(result));

    const observedFiles = changedFileCount(repo, 'main', result.sha, true);
    expect(verifyChildFileCount(expectedFiles, observedFiles)).toEqual({
      ok: true,
      reason: 'changed-file count 4 matches the pre-merge value',
    });
    expect(result.reviewCarry).toBe(true);
    expect(git('merge-base', '--is-ancestor', before, result.sha).status).toBe(0);
    expect(git('rev-list', '--count', '--first-parent', `${before}..${result.sha}`).stdout.trim()).toBe('1');
  });
});
