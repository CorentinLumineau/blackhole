import { describe, expect, spyOn, test, afterEach } from 'bun:test';
import * as teaCli from './tea-cli.ts';
import { GiteaForgeAdapter } from './gitea.ts';
import type { ForgeCheck } from './types.ts';

// Models `merge-gate.md`'s documented CI-check contract (V-CI-01): a check-list read that could
// not actually be obtained must block the merge, never be treated as "no failing checks". No
// production module calls `prChecks()` yet (ADR-027 defines the interface; the CI-wait poller
// itself still shells out to `gh pr checks` per `merge-gate.md`), so this is the consumer
// contract the adapter method exists to serve, exercised directly against the interface.
async function isMergeBlockedByChecks(prChecks: () => Promise<ForgeCheck[]>): Promise<boolean> {
  try {
    const checks = await prChecks();
    return checks.some((check) => check.conclusion === 'FAILURE');
  } catch {
    return true; // fail closed — an unreadable CI state blocks the merge, same as a failing check
  }
}

describe('GiteaForgeAdapter', () => {
  let runTeaJsonSpy: ReturnType<typeof spyOn<typeof teaCli, 'runTeaJson'>>;

  afterEach(() => {
    runTeaJsonSpy?.mockRestore();
  });

  test('issueList normalizes tea issue rows', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockReturnValue([
      {
        index: 3,
        title: 'Gitea issue',
        content: 'body',
        labels: ['bug'],
        state: 'open',
      },
    ]);
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    const issues = await adapter.issueList();
    expect(issues[0].number).toBe(3);
    expect(issues[0].labels).toEqual([{ name: 'bug' }]);
    expect(issues[0].state).toBe('OPEN');
  });

  test('prList maps pull requests to ForgePr', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockReturnValue([
      {
        index: 7,
        title: 'pull',
        body: '',
        head: { name: 'feature' },
        state: 'open',
        merged_at: null,
      },
    ]);
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    const prs = await adapter.prList();
    expect(prs[0].number).toBe(7);
    expect(prs[0].headRefName).toBe('feature');
  });

  // Issue #864: `prChecks` used to swallow any `tea actions status` failure into `[]` —
  // indistinguishable from "no checks configured". A caller reading an empty array as "nothing
  // failing" would let a merge proceed on a CI read it never actually got.
  test('prChecks propagates a tea CLI failure instead of returning an empty check list', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockImplementation(() => {
      throw new Error('tea: connection refused');
    });
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    await expect(adapter.prChecks(9)).rejects.toThrow('tea: connection refused');
  });

  // Consumer-level assertion (team ask): the defect was never really "the array is empty", it
  // was "the caller cannot tell a swallowed failure apart from a clean read". Prove the merge
  // gate's documented contract actually flips on this adapter's behavior, not just that the
  // adapter's return value changed shape.
  test('prChecks failure is treated as a blocking, unknown CI state by the merge gate — not as clean checks', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockImplementation(() => {
      throw new Error('tea: connection refused');
    });
    const adapter = new GiteaForgeAdapter('host/owner/repo');

    const blocked = await isMergeBlockedByChecks(() => adapter.prChecks(9));

    expect(blocked).toBe(true);
  });
});

describe('createForgeAdapter gitea', () => {
  test('selects gitea backend', async () => {
    const { createForgeAdapter } = await import('./index.ts');
    const adapter = createForgeAdapter({ repo: 'host/o/r', forge: 'gitea' });
    expect(adapter.forge).toBe('gitea');
  });
});
