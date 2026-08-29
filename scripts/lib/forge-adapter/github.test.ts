import { describe, expect, spyOn, test, afterEach } from 'bun:test';
import * as cli from './cli.ts';
import { GitHubForgeAdapter } from './github.ts';

describe('GitHubForgeAdapter', () => {
  let runGhJsonSpy: ReturnType<typeof spyOn<typeof cli, 'runGhJson'>>;

  afterEach(() => {
    runGhJsonSpy?.mockRestore();
  });

  test('issueList normalizes gh issue rows', async () => {
    runGhJsonSpy = spyOn(cli, 'runGhJson').mockReturnValue([
      {
        number: 1,
        title: 't',
        body: 'b',
        labels: [{ name: 'bug' }],
        milestone: { title: 'v1' },
        state: 'OPEN',
      },
    ]);
    const adapter = new GitHubForgeAdapter('owner/repo');
    const issues = await adapter.issueList({ state: 'open' });
    expect(issues).toEqual([
      {
        number: 1,
        title: 't',
        body: 'b',
        labels: [{ name: 'bug' }],
        milestone: { title: 'v1' },
        state: 'OPEN',
      },
    ]);
  });

  test('prView includes headRefOid for CI diagnosis', async () => {
    runGhJsonSpy = spyOn(cli, 'runGhJson').mockReturnValue({
      number: 5,
      title: 'pr',
      body: '',
      headRefName: 'feat',
      headRefOid: 'abc123',
      state: 'OPEN',
      mergedAt: null,
    });
    const adapter = new GitHubForgeAdapter('owner/repo');
    const pr = await adapter.prView(5);
    expect(pr.headRefOid).toBe('abc123');
    expect(pr.state).toBe('OPEN');
  });

  test('prChecks normalizes check conclusions', async () => {
    runGhJsonSpy = spyOn(cli, 'runGhJson').mockReturnValue([
      { name: 'verify', state: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'lint', state: 'IN_PROGRESS', conclusion: null },
    ]);
    const adapter = new GitHubForgeAdapter('owner/repo');
    const checks = await adapter.prChecks(1);
    expect(checks[0]).toEqual({
      name: 'verify',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
    });
    expect(checks[1].status).toBe('IN_PROGRESS');
  });

  test('authStatus reports missing gh binary', async () => {
    const runGhSpy = spyOn(cli, 'runGh').mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    });
    const adapter = new GitHubForgeAdapter('owner/repo');
    const status = await adapter.authStatus();
    expect(status.ok).toBe(false);
    expect(status.detail).toContain('not found');
    runGhSpy.mockRestore();
  });
});

describe('createForgeAdapter', () => {
  test('defaults to github backend', async () => {
    const { createForgeAdapter } = await import('./index.ts');
    const adapter = createForgeAdapter({ repo: 'o/r', forge: 'github' });
    expect(adapter.forge).toBe('github');
    expect(adapter.repo).toBe('o/r');
  });

  test('rejects unsupported forge backends', async () => {
    const { createForgeAdapter } = await import('./index.ts');
    expect(() => createForgeAdapter({ repo: 'o/r', forge: 'bitbucket' as 'github' })).toThrow(
      /unsupported forge/,
    );
  });
});
