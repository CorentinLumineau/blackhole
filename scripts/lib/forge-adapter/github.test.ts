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

  test('authStatus surfaces a non-zero gh auth status exit', async () => {
    const runGhSpy = spyOn(cli, 'runGh').mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'You are not logged into any GitHub hosts',
      error: null,
    });
    const adapter = new GitHubForgeAdapter('owner/repo');
    const status = await adapter.authStatus();
    expect(status).toEqual({
      ok: false,
      forge: 'github',
      host: null,
      detail: 'You are not logged into any GitHub hosts',
    });
    runGhSpy.mockRestore();
  });

  test('labelAdd pins the exact gh argv for a pull request', async () => {
    const runGhTextSpy = spyOn(cli, 'runGhText').mockReturnValue('');
    const adapter = new GitHubForgeAdapter('owner/repo');
    await adapter.labelAdd({ type: 'pr', number: 12 }, ['bug', 'urgent']);
    expect(runGhTextSpy).toHaveBeenCalledWith(['pr', 'edit', '12', '--add-label', 'bug,urgent'], {
      repo: 'owner/repo',
    });
    runGhTextSpy.mockRestore();
  });

  test('labelRemove pins the exact gh argv for an issue', async () => {
    const runGhTextSpy = spyOn(cli, 'runGhText').mockReturnValue('');
    const adapter = new GitHubForgeAdapter('owner/repo');
    await adapter.labelRemove({ type: 'issue', number: 3 }, ['wontfix']);
    expect(runGhTextSpy).toHaveBeenCalledWith(['issue', 'edit', '3', '--remove-label', 'wontfix'], {
      repo: 'owner/repo',
    });
    runGhTextSpy.mockRestore();
  });

  test('issueCreate maps the created gh issue row', async () => {
    runGhJsonSpy = spyOn(cli, 'runGhJson').mockReturnValue({
      number: 21,
      title: 'New bug',
      body: 'Steps to reproduce',
      labels: [{ name: 'bug' }],
      milestone: null,
      state: 'OPEN',
    });
    const adapter = new GitHubForgeAdapter('owner/repo');
    const issue = await adapter.issueCreate({ title: 'New bug', body: 'Steps to reproduce', labels: ['bug'] });
    expect(issue).toEqual({
      number: 21,
      title: 'New bug',
      body: 'Steps to reproduce',
      labels: [{ name: 'bug' }],
      milestone: null,
      state: 'OPEN',
    });
  });

  test('issueEdit pins the exact gh argv', async () => {
    const runGhTextSpy = spyOn(cli, 'runGhText').mockReturnValue('');
    const adapter = new GitHubForgeAdapter('owner/repo');
    await adapter.issueEdit(4, { title: 'Renamed', body: 'Updated body' });
    expect(runGhTextSpy).toHaveBeenCalledWith(
      ['issue', 'edit', '4', '--title', 'Renamed', '--body', 'Updated body'],
      { repo: 'owner/repo' },
    );
    runGhTextSpy.mockRestore();
  });

  test('issueComment pins the exact gh argv', async () => {
    const runGhTextSpy = spyOn(cli, 'runGhText').mockReturnValue('');
    const adapter = new GitHubForgeAdapter('owner/repo');
    await adapter.issueComment(4, 'looking into it');
    expect(runGhTextSpy).toHaveBeenCalledWith(['issue', 'comment', '4', '--body', 'looking into it'], {
      repo: 'owner/repo',
    });
    runGhTextSpy.mockRestore();
  });

  test('prCreate maps the created gh pull request row', async () => {
    runGhJsonSpy = spyOn(cli, 'runGhJson').mockReturnValue({
      number: 30,
      title: 'Add feature',
      body: 'description',
      headRefName: 'feature-branch',
      state: 'OPEN',
      mergedAt: null,
    });
    const adapter = new GitHubForgeAdapter('owner/repo');
    const pr = await adapter.prCreate({
      title: 'Add feature',
      body: 'description',
      head: 'feature-branch',
      base: 'main',
    });
    expect(pr).toEqual({
      number: 30,
      title: 'Add feature',
      body: 'description',
      headRefName: 'feature-branch',
      headRefOid: undefined,
      state: 'OPEN',
      mergedAt: null,
    });
  });

  test('prComment pins the exact gh argv', async () => {
    const runGhTextSpy = spyOn(cli, 'runGhText').mockReturnValue('');
    const adapter = new GitHubForgeAdapter('owner/repo');
    await adapter.prComment(30, 'LGTM');
    expect(runGhTextSpy).toHaveBeenCalledWith(['pr', 'comment', '30', '--body', 'LGTM'], {
      repo: 'owner/repo',
    });
    runGhTextSpy.mockRestore();
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
