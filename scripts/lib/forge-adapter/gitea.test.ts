import { describe, expect, spyOn, test, afterEach } from 'bun:test';
import * as teaCli from './tea-cli.ts';
import { GiteaForgeAdapter } from './gitea.ts';

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

  test('prChecks normalizes distinct rows using tea actions status shape', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockReturnValue([
      { name: 'lint', status: 'in_progress', conclusion: null },
      { name: 'build', status: 'queued', conclusion: null },
      { name: 'test', status: 'completed', conclusion: 'failure' },
    ]);
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    const checks = await adapter.prChecks(9);
    expect(checks).toEqual([
      { name: 'lint', status: 'IN_PROGRESS', conclusion: null },
      { name: 'build', status: 'QUEUED', conclusion: null },
      { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
    ]);
  });

  test('authStatus reports logged-in host from repo prefix', async () => {
    const runTeaSpy = spyOn(teaCli, 'runTea').mockReturnValue({
      status: 0,
      stdout: 'user@host (default)\n',
      stderr: '',
      error: null,
    });
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    const status = await adapter.authStatus();
    expect(status).toEqual({ ok: true, forge: 'gitea', host: 'host' });
    runTeaSpy.mockRestore();
  });

  test('authStatus reports missing tea binary', async () => {
    const runTeaSpy = spyOn(teaCli, 'runTea').mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    });
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    const status = await adapter.authStatus();
    expect(status.ok).toBe(false);
    expect(status.detail).toContain('not found');
    runTeaSpy.mockRestore();
  });

  test('authStatus surfaces a non-zero tea logins exit', async () => {
    const runTeaSpy = spyOn(teaCli, 'runTea').mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'no config file found',
      error: null,
    });
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    const status = await adapter.authStatus();
    expect(status).toEqual({
      ok: false,
      forge: 'gitea',
      host: null,
      detail: 'no config file found',
    });
    runTeaSpy.mockRestore();
  });

  test('labelAdd pins the exact tea argv for a pull request', async () => {
    const runTeaTextSpy = spyOn(teaCli, 'runTeaText').mockReturnValue('');
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    await adapter.labelAdd({ type: 'pr', number: 12 }, ['bug', 'urgent']);
    expect(runTeaTextSpy).toHaveBeenCalledWith([
      'pull',
      'edit',
      '12',
      '--repo',
      'host/owner/repo',
      '--add-labels',
      'bug,urgent',
    ]);
    runTeaTextSpy.mockRestore();
  });

  test('labelRemove pins the exact tea argv for an issue', async () => {
    const runTeaTextSpy = spyOn(teaCli, 'runTeaText').mockReturnValue('');
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    await adapter.labelRemove({ type: 'issue', number: 3 }, ['wontfix']);
    expect(runTeaTextSpy).toHaveBeenCalledWith([
      'issue',
      'edit',
      '3',
      '--repo',
      'host/owner/repo',
      '--remove-labels',
      'wontfix',
    ]);
    runTeaTextSpy.mockRestore();
  });

  test('issueCreate maps the created tea issue row', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockReturnValue({
      index: 21,
      title: 'New bug',
      content: 'Steps to reproduce',
      labels: ['bug'],
      state: 'open',
    });
    const adapter = new GiteaForgeAdapter('host/owner/repo');
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

  test('issueEdit pins the exact tea argv', async () => {
    const runTeaTextSpy = spyOn(teaCli, 'runTeaText').mockReturnValue('');
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    await adapter.issueEdit(4, { title: 'Renamed', body: 'Updated body' });
    expect(runTeaTextSpy).toHaveBeenCalledWith([
      'issue',
      'edit',
      '4',
      '--repo',
      'host/owner/repo',
      '--title',
      'Renamed',
      '--description',
      'Updated body',
    ]);
    runTeaTextSpy.mockRestore();
  });

  test('issueComment pins the exact tea argv', async () => {
    const runTeaTextSpy = spyOn(teaCli, 'runTeaText').mockReturnValue('');
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    await adapter.issueComment(4, 'looking into it');
    expect(runTeaTextSpy).toHaveBeenCalledWith([
      'issue',
      'comment',
      '4',
      '--repo',
      'host/owner/repo',
      '--content',
      'looking into it',
    ]);
    runTeaTextSpy.mockRestore();
  });

  test('prCreate maps the created tea pull row', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockReturnValue({
      index: 30,
      title: 'Add feature',
      body: 'description',
      head: { name: 'feature-branch' },
      state: 'open',
      merged_at: null,
    });
    const adapter = new GiteaForgeAdapter('host/owner/repo');
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
      state: 'OPEN',
      mergedAt: null,
    });
  });

  test('prComment pins the exact tea argv', async () => {
    const runTeaTextSpy = spyOn(teaCli, 'runTeaText').mockReturnValue('');
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    await adapter.prComment(30, 'LGTM');
    expect(runTeaTextSpy).toHaveBeenCalledWith([
      'pull',
      'comment',
      '30',
      '--repo',
      'host/owner/repo',
      '--content',
      'LGTM',
    ]);
    runTeaTextSpy.mockRestore();
  });

  test('prView maps a single tea pull row', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockReturnValue({
      index: 30,
      title: 'Add feature',
      body: 'description',
      head: { name: 'feature-branch' },
      state: 'merged',
      merged_at: '2026-01-01T00:00:00Z',
    });
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    const pr = await adapter.prView(30);
    expect(pr).toEqual({
      number: 30,
      title: 'Add feature',
      body: 'description',
      headRefName: 'feature-branch',
      state: 'MERGED',
      mergedAt: '2026-01-01T00:00:00Z',
    });
  });
});

describe('createForgeAdapter gitea', () => {
  test('selects gitea backend', async () => {
    const { createForgeAdapter } = await import('./index.ts');
    const adapter = createForgeAdapter({ repo: 'host/o/r', forge: 'gitea' });
    expect(adapter.forge).toBe('gitea');
  });
});
