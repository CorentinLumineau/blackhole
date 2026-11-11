import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import type { OpenPrSnapshot, SnapshotPr } from './open-pr-snapshot.ts';
import {
  LANDINGS,
  MERGE_MODES,
  parentMergeMethod,
  recheckStack,
  recoveryRoute,
  snapshotParentFiles,
  type RecheckOptions,
} from './stack-lifecycle.ts';

const root = path.resolve(import.meta.dir, '..', '..');

const spr = (number: number, files: string[] | null, extra: Partial<SnapshotPr> = {}): SnapshotPr => ({
  number,
  headRefName: `blackhole/issue-${number}`,
  headSha: `sha${number}`,
  baseRefName: 'main',
  isFork: false,
  draft: false,
  createdAt: null,
  files,
  ...extra,
});

const snapshot = (...prs: SnapshotPr[]): OpenPrSnapshot => ({ status: 'ok', prs, filesSource: 'refs' });

const opts = (verdict: 'conflict' | 'clean' | 'unknown' = 'conflict'): RecheckOptions => ({
  conflicts: () => verdict,
  isOwned: (b) => b.startsWith('blackhole/issue-'),
});

describe('parentMergeMethod (D2)', () => {
  test('a parent with open children gets a merge commit when the repo allows one', () => {
    const c = parentMergeMethod({ hasOpenChildren: true, settings: { allow_squash_merge: true, allow_merge_commit: true } });
    expect(c.method).toBe('merge');
    expect(c.flag).toBe('--merge');
  });

  test('a parent with open children falls back to squash when merge commits are off', () => {
    const c = parentMergeMethod({ hasOpenChildren: true, settings: { allow_squash_merge: true, allow_merge_commit: false } });
    expect(c.method).toBe('squash');
    expect(c.reason).toContain('mandatory');
  });

  test('a PR with no open children keeps squash even when merge commits are allowed', () => {
    const c = parentMergeMethod({ hasOpenChildren: false, settings: { allow_squash_merge: true, allow_merge_commit: true } });
    expect(c.method).toBe('squash');
  });

  test("Gitea's plural merge-commit key is honoured", () => {
    const c = parentMergeMethod({ hasOpenChildren: true, settings: { allow_squash_merge: true, allow_merge_commits: true } });
    expect(c.method).toBe('merge');
  });

  test('unreadable settings fall back to squash and say so', () => {
    const c = parentMergeMethod({ hasOpenChildren: true, settings: null });
    expect(c.method).toBe('squash');
    expect(c.reason).toContain('unreadable');
  });

  test('a repo without squash gets the next allowed method', () => {
    expect(parentMergeMethod({ hasOpenChildren: false, settings: { allow_squash_merge: false, allow_merge_commit: true } }).method).toBe('merge');
    expect(parentMergeMethod({ hasOpenChildren: false, settings: { allow_squash_merge: false, allow_merge_commit: false, allow_rebase_merge: true } }).method).toBe('rebase');
  });
});

describe('recoveryRoute: 3 merge modes x 4 landings', () => {
  test('every cell names a command and a HITL route', () => {
    for (const mode of MERGE_MODES) {
      for (const landing of LANDINGS) {
        const r = recoveryRoute(mode, landing);
        expect(r.command).toMatch(/^repair --apply --child-issue <N>/);
        expect(r.hitl.length).toBeGreaterThan(10);
        expect(r.trigger.length).toBeGreaterThan(10);
        expect(r.ordering.length).toBeGreaterThan(10);
      }
    }
  });

  test('a merge-commit landing is retarget-only; the others replay or remove the parent', () => {
    expect(recoveryRoute('immediate', 'merge').outcome).toContain('no commit');
    expect(recoveryRoute('immediate', 'squash').outcome).toContain('replay');
    expect(recoveryRoute('immediate', 'closed-unmerged').command).toContain('--parent-state closed-unmerged');
  });

  test('leave-open revokes the delivered note and gated-batch waits for CI', () => {
    expect(recoveryRoute('leave-open', 'squash').ordering).toContain('delivered-at-LGTM');
    expect(recoveryRoute('gated-batch', 'squash').ordering).toContain('CI green');
    expect(recoveryRoute('immediate', 'squash').ordering).toContain('before');
  });

  test('merge-gate.md § 7 prints every route verbatim', () => {
    const doc = fs.readFileSync(path.join(root, 'src', 'references', 'merge-gate.md'), 'utf-8');
    for (const mode of MERGE_MODES) {
      for (const landing of LANDINGS) {
        const r = recoveryRoute(mode, landing);
        expect(doc).toContain(r.trigger);
        expect(doc).toContain(`\`${r.command}\``);
        expect(doc).toContain(r.outcome);
        expect(doc).toContain(r.hitl);
        expect(doc).toContain(r.ordering);
      }
    }
  });
});

describe('recheckStack', () => {
  test('a PR that newly overlaps an older open PR is restacked onto it', () => {
    const snap = snapshot(spr(7, ['a.ts']), spr(9, ['a.ts']));
    expect(recheckStack(9, snap, opts())).toEqual({ action: 'restack', parent: 7, parentBranch: 'blackhole/issue-7', alsoOverlaps: [] });
  });

  test('a younger overlapping PR triggers nothing for the older one', () => {
    const snap = snapshot(spr(7, ['a.ts']), spr(9, ['a.ts']));
    expect(recheckStack(7, snap, opts())).toEqual({ action: 'none' });
  });

  test('a PR already based on the older PR needs nothing', () => {
    const snap = snapshot(spr(7, ['a.ts']), spr(9, ['a.ts'], { baseRefName: 'blackhole/issue-7' }));
    expect(recheckStack(9, snap, opts())).toEqual({ action: 'none' });
  });

  test('a clean merge-tree means no restack', () => {
    const snap = snapshot(spr(7, ['a.ts']), spr(9, ['a.ts']));
    expect(recheckStack(9, snap, opts('clean'))).toEqual({ action: 'none' });
  });

  test('an external PR is never moved', () => {
    const snap = snapshot(spr(7, ['a.ts']), spr(9, ['a.ts'], { headRefName: 'someone/feature' }));
    expect(recheckStack(9, snap, opts())).toEqual({ action: 'none' });
  });

  test('a fork parent holds the PR with a named reason', () => {
    const snap = snapshot(spr(7, ['a.ts'], { isFork: true }), spr(9, ['a.ts']));
    expect(recheckStack(9, snap, opts())).toEqual({ action: 'hold', reason: 'unstackable-parent:fork:#7' });
  });

  test('two older chains: the lowest root is the parent and the other is reported', () => {
    const snap = snapshot(spr(5, ['a.ts']), spr(7, ['a.ts']), spr(9, ['a.ts']));
    expect(recheckStack(9, snap, opts())).toMatchObject({ action: 'restack', parent: 5, alsoOverlaps: [7] });
  });

  test('an unknown snapshot is unknown, never none', () => {
    expect(recheckStack(9, { status: 'unknown', reason: 'list failed' }, opts())).toEqual({ action: 'unknown', reason: 'list failed' });
  });

  test('a PR missing from the snapshot is unknown', () => {
    expect(recheckStack(9, snapshot(spr(7, ['a.ts'])), opts()).action).toBe('unknown');
  });

  test('a merge-tree that cannot decide is unknown', () => {
    const snap = snapshot(spr(7, ['a.ts']), spr(9, ['a.ts']));
    expect(recheckStack(9, snap, opts('unknown')).action).toBe('unknown');
  });
});

describe('snapshotParentFiles', () => {
  test('maps queue issues to their PR files and leaves unknown files out', () => {
    const snap = snapshot(spr(7, ['a.ts']), spr(8, null));
    const files = snapshotParentFiles({ '1': { pr: 7 }, '2': { pr: 8 }, '3': { pr: null }, '4': {} }, snap);
    expect(files).toEqual({ '1': ['a.ts'] });
  });

  test('an unknown snapshot yields no files', () => {
    expect(snapshotParentFiles({ '1': { pr: 7 } }, { status: 'unknown', reason: 'x' })).toEqual({});
  });
});
