import { describe, expect, mock, spyOn, test, afterEach } from 'bun:test';
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

  test('prView reads the REST row, so labels, mergeability and the head sha reach the caller', async () => {
    const spy = teaApi(() => ({
      stdout: apiPr(30, {
        title: 'Add feature',
        body: 'description',
        state: 'closed',
        merged: true,
        merged_at: '2026-01-01T00:00:00Z',
        mergeable: false,
        labels: [{ name: 'ai-review:LGTM' }, { name: 'bug' }],
        head: { ref: 'feature-branch', sha: 'abc', repo: { full_name: 'owner/repo' } },
      }),
    }));
    const pr = await new GiteaForgeAdapter('host/owner/repo').prView(30);
    expect(pr).toMatchObject({
      number: 30,
      title: 'Add feature',
      body: 'description',
      headRefName: 'feature-branch',
      headRefOid: 'abc',
      state: 'MERGED',
      mergedAt: '2026-01-01T00:00:00Z',
      mergeable: false,
      labels: ['ai-review:LGTM', 'bug'],
    });
    expect(spy.mock.calls[0][0]).toEqual(['api', '-i', '-X', 'GET', 'repos/owner/repo/pulls/30']);
    spy.mockRestore();
  });

  test('prList of every state reads REST rows, so a merged pull request carries its merge time', async () => {
    const spy = teaApi(() => ({
      stdout: [apiPr(8, { state: 'closed', merged: true, merged_at: '2026-11-12T08:00:00Z' }), apiPr(9, { state: 'closed' })],
      stderr: 'X-Total-Count: 2\n',
    }));
    const prs = await new GiteaForgeAdapter('host/owner/repo').prList({ state: 'all', limit: 300 });
    expect(prs.map((p) => [p.number, p.state, p.mergedAt])).toEqual([
      [8, 'MERGED', '2026-11-12T08:00:00Z'],
      [9, 'CLOSED', null],
    ]);
    expect(spy.mock.calls[0][0]).toContain('repos/owner/repo/pulls?state=all&page=1&limit=50');
    spy.mockRestore();
  });
  describe('prChecks, from the combined commit status of the head commit', () => {
    afterEach(() => mock.restore());

    const status = (context: string, state: string) => ({ context, status: state, target_url: 'https://forge.example/run/1' });
    const checksApi = (statuses: unknown[], extra: Record<string, unknown> = {}, seen: string[] = []) =>
      teaApi((argv) => {
        const endpoint = argv[argv.indexOf('-X') + 2];
        seen.push(endpoint);
        if (endpoint.endsWith('/pulls/9')) return { stdout: apiPr(9, { head: { ref: 'f', sha: 'abc123', repo: { full_name: 'owner/repo' } } }) };
        return { stdout: { state: 'success', sha: 'abc123', total_count: statuses.length, statuses, ...extra } };
      });

    test('reads the PR for its head sha, then the combined status of that commit', async () => {
      const seen: string[] = [];
      checksApi([status('build', 'success')], {}, seen);
      await new GiteaForgeAdapter('host/owner/repo').prChecks(9);
      expect(seen).toEqual(['repos/owner/repo/pulls/9', 'repos/owner/repo/commits/abc123/status?page=1&limit=50']);
    });

    test('maps each status state to one check', async () => {
      checksApi([
        status('lint', 'pending'),
        status('build', 'success'),
        status('unit', 'failure'),
        status('e2e', 'error'),
        status('docs', 'skipped'),
        status('style', 'warning'),
      ]);
      expect(await new GiteaForgeAdapter('host/owner/repo').prChecks(9)).toEqual([
        { name: 'lint', status: 'IN_PROGRESS', conclusion: null },
        { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'unit', status: 'COMPLETED', conclusion: 'FAILURE' },
        { name: 'e2e', status: 'COMPLETED', conclusion: 'FAILURE' },
        { name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
        { name: 'style', status: 'COMPLETED', conclusion: 'NEUTRAL' },
      ]);
    });

    test('a state it does not know is pending, never success', async () => {
      checksApi([status('odd', 'queued-by-a-newer-server')]);
      expect(await new GiteaForgeAdapter('host/owner/repo').prChecks(9)).toEqual([{ name: 'odd', status: 'IN_PROGRESS', conclusion: null }]);
    });

    test('a commit with no status at all is an empty list: no CI ran, which is not green', async () => {
      checksApi([]);
      expect(await new GiteaForgeAdapter('host/owner/repo').prChecks(9)).toEqual([]);
    });

    // Gitea's `total_count` is the length of the page it returned, not of the whole list, so
    // only a short page can end the read.
    test('pages until a short page, since total_count only counts the returned page', async () => {
      const first = Array.from({ length: 50 }, (_, i) => status(`job-${i}`, 'success'));
      const second = [status('job-50', 'failure')];
      const seen: string[] = [];
      teaApi((argv) => {
        const endpoint = argv[argv.indexOf('-X') + 2];
        seen.push(endpoint);
        if (endpoint.endsWith('/pulls/9')) return { stdout: apiPr(9) };
        const statuses = endpoint.includes('page=1') ? first : second;
        return { stdout: { total_count: statuses.length, statuses } };
      });
      const checks = await new GiteaForgeAdapter('host/owner/repo').prChecks(9);
      expect(checks).toHaveLength(51);
      expect(checks[50]).toEqual({ name: 'job-50', status: 'COMPLETED', conclusion: 'FAILURE' });
      expect(seen.filter((e) => e.includes('/status'))).toHaveLength(2);
    });

    test('a failing read propagates instead of reading as no CI (issue #864)', async () => {
      teaApi(() => ({ status: 1, stderr: 'tea: connection refused' }));
      await expect(new GiteaForgeAdapter('host/owner/repo').prChecks(9)).rejects.toThrow('tea: connection refused');
    });

    test('a PR without a head sha cannot be read, and says so', async () => {
      teaApi(() => ({ stdout: { ...apiPr(9), head: { ref: 'f', sha: '' } } }));
      await expect(new GiteaForgeAdapter('host/owner/repo').prChecks(9)).rejects.toThrow('head commit');
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
