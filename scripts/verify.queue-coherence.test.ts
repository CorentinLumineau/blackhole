import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';
import {
  checkQueueCoherence,
  findOrphanedInFlightWorktrees,
  findPhaseArtifactMismatches,
  findStaleBlockedIssues,
} from './checks/queue-coherence.check.ts';

// Issue #570 — queue-coherence.check.ts: advisory (WARN, `ok: true` always) mechanical
// coherence assertions over the live `.blackhole/queue.json`, reproducing three concrete
// incident shapes named in the issue body (#464/#468/#492 stale-blocked; #450/#451
// phantom-implement). File-absent SKIP (fresh checkout / CI / no active campaign) returns
// `{ ok: true }` for all three checks with no `detail`, matching parity-matrix.check.ts's
// established SKIP discipline.

describe('findStaleBlockedIssues (V-QUEUE-01)', () => {
  test('a blocked issue whose only resolved dependency is merged is reported', () => {
    const issues = {
      '10': { status: 'merged', depends_on: [] },
      '20': { status: 'blocked', depends_on: [10] },
    };
    expect(findStaleBlockedIssues(issues)).toEqual(['20']);
  });

  test('a blocked issue whose dependency is still ready is not reported', () => {
    const issues = {
      '10': { status: 'ready', depends_on: [] },
      '20': { status: 'blocked', depends_on: [10] },
    };
    expect(findStaleBlockedIssues(issues)).toEqual([]);
  });

  test('a blocked issue with no depends_on entries is not reported', () => {
    const issues = { '20': { status: 'blocked', depends_on: [] } };
    expect(findStaleBlockedIssues(issues)).toEqual([]);
  });

  test('a blocked issue whose only dependency is absent from the queue entirely is not reported (conservative — no forge lookup)', () => {
    const issues = { '20': { status: 'blocked', depends_on: [999] } };
    expect(findStaleBlockedIssues(issues)).toEqual([]);
  });

  test('a blocked issue with one merged in-queue dep and one absent dep is reported (at least one resolves)', () => {
    const issues = {
      '10': { status: 'closed', depends_on: [] },
      '20': { status: 'blocked', depends_on: [10, 999] },
    };
    expect(findStaleBlockedIssues(issues)).toEqual(['20']);
  });
});

describe('findPhaseArtifactMismatches (V-QUEUE-02)', () => {
  const noop = { worktreeExists: () => false, planArtifactExists: () => false };

  test('phase implement with no worktree, no pr, and no plan artifact is reported', () => {
    const issues = { '30': { phase: 'implement', worktree: null, pr: null } };
    expect(findPhaseArtifactMismatches(issues, noop)).toEqual(['30']);
  });

  test('phase implement with a pr number is not reported', () => {
    const issues = { '30': { phase: 'implement', worktree: null, pr: 42 } };
    expect(findPhaseArtifactMismatches(issues, noop)).toEqual([]);
  });

  test('phase implement with an on-disk worktree is not reported', () => {
    const issues = { '30': { phase: 'implement', worktree: '/tmp/wt-30', pr: null } };
    const deps = { worktreeExists: (w: string) => w === '/tmp/wt-30', planArtifactExists: () => false };
    expect(findPhaseArtifactMismatches(issues, deps)).toEqual([]);
  });

  test('phase implement with a plan artifact on disk is not reported', () => {
    const issues = { '30': { phase: 'implement', worktree: null, pr: null } };
    const deps = { worktreeExists: () => false, planArtifactExists: (n: string) => n === '30' };
    expect(findPhaseArtifactMismatches(issues, deps)).toEqual([]);
  });

  test('phase plan with no route object is reported', () => {
    const issues = { '40': { phase: 'plan' } };
    expect(findPhaseArtifactMismatches(issues, noop)).toEqual(['40']);
  });

  test('phase plan with a route object present is not reported', () => {
    const issues = { '40': { phase: 'plan', route: {} } };
    expect(findPhaseArtifactMismatches(issues, noop)).toEqual([]);
  });

  test('other phases are never reported', () => {
    const issues = { '50': { phase: 'handle' }, '60': { phase: 'done' } };
    expect(findPhaseArtifactMismatches(issues, noop)).toEqual([]);
  });
});

describe('findOrphanedInFlightWorktrees (V-QUEUE-03)', () => {
  test('an in-flight issue whose worktree does not exist on disk is reported', () => {
    const issues = { '70': { status: 'in-flight', worktree: '/nonexistent/wt-1' } };
    expect(findOrphanedInFlightWorktrees(issues, () => false)).toEqual(['70']);
  });

  test('an in-flight issue whose worktree exists on disk is not reported', () => {
    const issues = { '70': { status: 'in-flight', worktree: '/real/wt-1' } };
    expect(findOrphanedInFlightWorktrees(issues, (w) => w === '/real/wt-1')).toEqual([]);
  });

  test('an in-flight issue with a null worktree is not reported', () => {
    const issues = { '70': { status: 'in-flight', worktree: null } };
    expect(findOrphanedInFlightWorktrees(issues, () => false)).toEqual([]);
  });

  test('a non-in-flight issue is never reported regardless of worktree state', () => {
    const issues = { '70': { status: 'ready', worktree: '/nonexistent/wt-1' } };
    expect(findOrphanedInFlightWorktrees(issues, () => false)).toEqual([]);
  });
});

describe('checkQueueCoherence file-absent SKIP', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('no queue.json on disk: all three checks are ok with no detail', () => {
    const dir = makeTempDir('queue-coherence-');
    tempDirs.push(dir);
    const results = checkQueueCoherence(path.join(dir, 'queue.json'), dir);
    expect(results).toEqual([
      { id: 'V-QUEUE-01', ok: true },
      { id: 'V-QUEUE-02', ok: true },
      { id: 'V-QUEUE-03', ok: true },
    ]);
  });

  test('a live queue.json with real violations produces non-empty detail, still ok: true (advisory)', () => {
    const dir = makeTempDir('queue-coherence-');
    tempDirs.push(dir);
    const queueFile = path.join(dir, 'queue.json');
    fs.writeFileSync(
      queueFile,
      JSON.stringify({
        issues: {
          '10': { status: 'merged', depends_on: [] },
          '20': { status: 'blocked', depends_on: [10] },
          '30': { phase: 'implement', status: 'ready', worktree: null, pr: null },
          '70': { status: 'in-flight', worktree: '/nonexistent/wt-1' },
        },
      }),
    );
    const results = checkQueueCoherence(queueFile, dir);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(byId['V-QUEUE-01'].detail).toMatch(/20/);
    expect(byId['V-QUEUE-02'].detail).toMatch(/30/);
    expect(byId['V-QUEUE-03'].detail).toMatch(/70/);
  });
});
