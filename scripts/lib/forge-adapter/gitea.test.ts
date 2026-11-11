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

  // `tea api` prints the Gitea REST JSON; the adapter reads PR graph fields from it because
  // `tea pulls list --json` carries neither the base branch nor the head repository.
  const apiPr = (n: number, extra: Record<string, unknown> = {}) => ({
    number: n,
    title: `p${n}`,
    body: '',
    state: 'open',
    merged: false,
    merged_at: null,
    draft: false,
    created_at: '2026-11-01T10:00:00Z',
    head: { ref: 'feat', sha: 'abc', repo: { full_name: 'owner/repo' } },
    base: { ref: 'main', repo: { full_name: 'owner/repo' } },
    ...extra,
  });
  const teaApi = (reply: (argv: string[]) => { stdout?: unknown; stderr?: string; status?: number }) =>
    spyOn(teaCli, 'runTea').mockImplementation((argv: string[]) => {
      const r = reply(argv);
      return {
        status: r.status ?? 0,
        stdout: typeof r.stdout === 'string' ? r.stdout : JSON.stringify(r.stdout ?? {}),
        stderr: r.stderr ?? '',
        error: null,
      };
    });

  test('prList of open pull requests reads REST rows with base, fork flag and draft', async () => {
    const spy = teaApi(() => ({
      stdout: [apiPr(7, { draft: true, head: { ref: 'f', sha: 's', repo: { full_name: 'stranger/repo' } } })],
      stderr: 'HTTP/1.1 200 OK\nX-Total-Count: 1\n',
    }));
    const prs = await new GiteaForgeAdapter('host/owner/repo').prList({ state: 'open', limit: 1001 });
    expect(prs).toEqual([
      {
        number: 7,
        title: 'p7',
        body: '',
        headRefName: 'f',
        headRefOid: 's',
        baseRefName: 'main',
        headRepoIsFork: true,
        draft: true,
        createdAt: '2026-11-01T10:00:00Z',
        state: 'OPEN',
        mergedAt: null,
      },
    ]);
    expect(spy.mock.calls[0][0].slice(0, 4)).toEqual(['api', '-i', '-X', 'GET']);
    expect(spy.mock.calls[0][0]).toContain('repos/owner/repo/pulls?state=open&page=1&limit=50');
    spy.mockRestore();
  });

  test('prList of open pull requests keeps paging until X-Total-Count rows are read', async () => {
    const rows = Array.from({ length: 70 }, (_, i) => apiPr(i + 1));
    const spy = teaApi((argv) => ({
      stdout: argv.some((a) => a.endsWith('page=1&limit=50')) ? rows.slice(0, 50) : rows.slice(50),
      stderr: 'X-Total-Count: 70\n',
    }));
    const prs = await new GiteaForgeAdapter('host/owner/repo').prList({ state: 'open', limit: 1001 });
    expect(prs).toHaveLength(70);
    expect(spy.mock.calls).toHaveLength(2);
    spy.mockRestore();
  });

  test('prList of open pull requests fails when a page comes back empty before the total', async () => {
    const spy = teaApi(() => ({ stdout: [], stderr: 'X-Total-Count: 5\n' }));
    await expect(new GiteaForgeAdapter('host/owner/repo').prList({ state: 'open' })).rejects.toThrow(/total/);
    spy.mockRestore();
  });

  test('prFiles reads the files endpoint until an empty page', async () => {
    const spy = teaApi((argv) => ({
      stdout: argv.some((a) => a.endsWith('page=1&limit=50'))
        ? [{ filename: 'a.ts' }, { filename: 'b.ts', previous_filename: 'old.ts' }]
        : [],
    }));
    expect(await new GiteaForgeAdapter('host/owner/repo').prFiles(3)).toEqual(['a.ts', 'b.ts', 'old.ts']);
    expect(spy.mock.calls[0][0]).toContain('repos/owner/repo/pulls/3/files?page=1&limit=50');
    spy.mockRestore();
  });

  test('prChangeBase patches base, reads it back, and reports a mismatch', async () => {
    const spy = teaApi((argv) => ({ stdout: argv.includes('PATCH') ? { number: 4 } : apiPr(4, { base: { ref: 'main', repo: { full_name: 'owner/repo' } } }) }));
    const result = await new GiteaForgeAdapter('host/owner/repo').prChangeBase(4, 'blackhole/issue-10');
    expect(result).toMatchObject({ ok: false, base: 'main' });
    const patch = spy.mock.calls[0][0];
    expect(patch).toContain('PATCH');
    expect(patch).toContain('repos/owner/repo/pulls/4');
    expect(patch[patch.indexOf('-d') + 1]).toBe(JSON.stringify({ base: 'blackhole/issue-10' }));
    spy.mockRestore();
  });

  test('prChangeBase is ok when the read-back base matches', async () => {
    const spy = teaApi((argv) => ({
      stdout: argv.includes('PATCH') ? { number: 4 } : apiPr(4, { base: { ref: 'blackhole/issue-10', repo: { full_name: 'owner/repo' } } }),
    }));
    expect(await new GiteaForgeAdapter('host/owner/repo').prChangeBase(4, 'blackhole/issue-10')).toEqual({
      ok: true,
      base: 'blackhole/issue-10',
    });
    spy.mockRestore();
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
