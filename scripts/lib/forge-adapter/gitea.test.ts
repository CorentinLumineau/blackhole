import { describe, expect, mock, spyOn, test, afterEach } from 'bun:test';
import * as teaCli from './tea-cli.ts';
import { GiteaForgeAdapter } from './gitea.ts';

describe('GiteaForgeAdapter', () => {
  let runTeaJsonSpy: ReturnType<typeof spyOn<typeof teaCli, 'runTeaJson'>>;

  afterEach(() => {
    runTeaJsonSpy?.mockRestore();
  });

  test('issueList normalizes tea issue rows', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockReturnValueOnce([
      {
        index: 3,
        title: 'Gitea issue',
        content: 'body',
        labels: ['bug'],
        state: 'open',
      },
    ]).mockReturnValue([]);
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    const issues = await adapter.issueList();
    expect(issues[0].number).toBe(3);
    expect(issues[0].labels).toEqual([{ name: 'bug' }]);
    expect(issues[0].state).toBe('OPEN');
  });

  test('issueList asks tea for json with an explicit field list that keeps body, labels, milestone, updated and assignees', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockReturnValue([]);
    await new GiteaForgeAdapter('host/owner/repo').issueList();
    const argv = runTeaJsonSpy.mock.calls[0][0] as string[];
    expect(argv).not.toContain('--json');
    const fields = argv[argv.indexOf('--fields') + 1].split(',');
    expect(fields).toEqual(expect.arrayContaining(['index', 'title', 'body', 'state', 'labels', 'milestone', 'updated', 'assignees']));
  });

  test('issueList maps the string-valued cells tea 0.14.2 prints (index, comma-joined labels and assignees)', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockReturnValueOnce([
      { index: '12', title: 't', body: 'b', state: 'open', labels: 'bug,in-progress:acct-a', milestone: 'M1', updated: '2026-11-18T14:59:42Z', assignees: 'a,b' },
      { index: '13', title: 'u', body: '', state: 'closed', labels: '', milestone: '', updated: '2026-11-18T14:59:42Z', assignees: '' },
    ]).mockReturnValue([]);
    const issues = await new GiteaForgeAdapter('host/owner/repo').issueList();
    expect(issues[0]).toMatchObject({ number: 12, body: 'b', labels: [{ name: 'bug' }, { name: 'in-progress:acct-a' }], milestone: { title: 'M1' }, assignees: ['a', 'b'] });
    expect(issues[1]).toMatchObject({ number: 13, labels: [], milestone: null, state: 'CLOSED' });
  });

  const pageOf = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ index: String(from + i), title: `t${from + i}`, state: 'open' }));

  test('issueList walks --page until an empty page, because tea clamps a page to the server maximum', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockImplementation(((args: string[]) => {
      const page = Number(args[args.indexOf('--page') + 1]);
      return page === 1 ? pageOf(1, 50) : page === 2 ? pageOf(51, 50) : page === 3 ? pageOf(101, 7) : [];
    }) as never);
    const issues = await new GiteaForgeAdapter('host/owner/repo').issueList();
    expect(issues).toHaveLength(107);
    expect(issues[106].number).toBe(107);
    expect(runTeaJsonSpy.mock.calls.length).toBe(4);
  });

  test('issueList stops at the requested limit', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockImplementation(((args: string[]) => (args[args.indexOf('--page') + 1] === '1' ? pageOf(1, 50) : pageOf(51, 50))) as never);
    const issues = await new GiteaForgeAdapter('host/owner/repo').issueList({ limit: 60 });
    expect(issues).toHaveLength(60);
  });

  test('issueList throws when pages never end', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockReturnValue(pageOf(1, 50) as never);
    await expect(new GiteaForgeAdapter('host/owner/repo').issueList({ limit: 1_000_000 })).rejects.toThrow(/pages/);
  });

  test('prList without a state walks --page until an empty page', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockImplementation(((args: string[]) => {
      const page = Number(args[args.indexOf('--page') + 1]);
      return page === 1 ? pageOf(1, 50) : page === 2 ? pageOf(51, 3) : [];
    }) as never);
    const prs = await new GiteaForgeAdapter('host/owner/repo').prList();
    expect(prs).toHaveLength(53);
  });

  test('prList without a state asks tea for json with fields that carry body and head', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockReturnValueOnce([{ index: '7', title: 'pull', body: 'x', head: 'feature', state: 'open' }]).mockReturnValue([]);
    const prs = await new GiteaForgeAdapter('host/owner/repo').prList();
    const argv = runTeaJsonSpy.mock.calls[0][0] as string[];
    expect(argv.slice(0, 2)).toEqual(['pulls', 'list']);
    expect(argv).not.toContain('--json');
    expect(argv[argv.indexOf('--fields') + 1].split(',')).toEqual(expect.arrayContaining(['index', 'title', 'body', 'state', 'head']));
    expect(prs[0]).toMatchObject({ number: 7, headRefName: 'feature', body: 'x', state: 'OPEN' });
  });

  test('prList maps pull requests to ForgePr', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockReturnValueOnce([
      {
        index: 7,
        title: 'pull',
        body: '',
        head: { name: 'feature' },
        state: 'open',
        merged_at: null,
      },
    ]).mockReturnValue([]);
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
    const argvs = runTeaTextSpy.mock.calls.map((c) => c[0]);
    const create = (name: string) => ['labels', 'create', '--repo', 'host/owner/repo', '--name', name, '--color', '#1d76db'];
    // Every label is created before the edit that adds it, so a first-use bucket label does not fail the edit.
    expect(argvs.slice(0, 2)).toEqual([create('bug'), create('urgent')]);
    expect(argvs).toHaveLength(3);
    expect(runTeaTextSpy).toHaveBeenLastCalledWith([
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

  test('labelAdd tolerates an existing label but surfaces any other create failure', async () => {
    const adapter = new GiteaForgeAdapter('host/owner/repo');
    let failure = 'label already exists';
    const spy = spyOn(teaCli, 'runTeaText').mockImplementation(((argv: string[]) => {
      if (argv[0] === 'labels') throw new Error(failure);
      return '';
    }) as never);
    await adapter.labelAdd({ type: 'issue', number: 3 }, ['pareto:P1']);
    expect(spy).toHaveBeenLastCalledWith(['issue', 'edit', '3', '--repo', 'host/owner/repo', '--add-labels', 'pareto:P1']);
    failure = 'HTTP 500';
    await expect(adapter.labelAdd({ type: 'issue', number: 3 }, ['pareto:P1'])).rejects.toThrow('HTTP 500');
    spy.mockRestore();
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

  describe('create through REST (tea 0.14.2 has no JSON output for create)', () => {
    let apiSpy: ReturnType<typeof spyOn<typeof teaCli, 'runTeaApiJson'>>;
    let calls: Array<{ method: string; endpoint: string; body: unknown }>;
    const mockApi = (reply: (method: string, endpoint: string) => unknown, headers = '') => {
      calls = [];
      apiSpy = spyOn(teaCli, 'runTeaApiJson').mockImplementation(((method: string, endpoint: string, body?: unknown) => {
        calls.push({ method, endpoint, body });
        return { data: reply(method, endpoint), headers };
      }) as never);
    };
    afterEach(() => apiSpy?.mockRestore());

    test('issueCreate resolves label names to ids, POSTs, and maps the REST row; spawns no tea create', async () => {
      const textSpy = spyOn(teaCli, 'runTeaText').mockReturnValue('');
      runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockReturnValue(null as never);
      mockApi((method, endpoint) =>
        method === 'GET'
          ? endpoint.includes('page=1&') ? [{ id: 5, name: 'bug' }, { id: 6, name: 'other' }] : []
          : { number: 21, title: 'New bug', body: 'Steps to reproduce', labels: [{ name: 'bug' }], state: 'open', milestone: null },
      );
      const issue = await new GiteaForgeAdapter('host/owner/repo').issueCreate({ title: 'New bug', body: 'Steps to reproduce', labels: ['bug'] });
      expect(calls.find((c) => c.method === 'POST')).toEqual({
        method: 'POST',
        endpoint: 'repos/owner/repo/issues',
        body: { title: 'New bug', body: 'Steps to reproduce', labels: [5] },
      });
      expect(runTeaJsonSpy).not.toHaveBeenCalled();
      expect(textSpy).not.toHaveBeenCalled();
      textSpy.mockRestore();
      expect(issue).toEqual({ number: 21, title: 'New bug', body: 'Steps to reproduce', labels: [{ name: 'bug' }], milestone: null, state: 'OPEN' });
    });

    test('issueCreate names the missing label instead of creating the issue unlabelled', async () => {
      mockApi((_m, endpoint) => (endpoint.includes('page=1&') ? [{ id: 5, name: 'bug' }] : []));
      await expect(new GiteaForgeAdapter('host/owner/repo').issueCreate({ title: 't', body: 'b', labels: ['nope'] })).rejects.toThrow(/nope/);
      expect(calls.some((c) => c.method === 'POST')).toBe(false);
    });

    test('issueCreate without labels makes no label request', async () => {
      mockApi(() => ({ number: 2, title: 't', body: 'b', labels: [], state: 'open' }));
      await new GiteaForgeAdapter('host/owner/repo').issueCreate({ title: 't', body: 'b' });
      expect(calls.map((c) => c.method)).toEqual(['POST']);
      expect(calls[0].body).toEqual({ title: 't', body: 'b' });
    });

    test('issueCreate finds a label on a later page and stops at the first empty page', async () => {
      const full = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `l${i + 1}` }));
      mockApi((method, endpoint) => {
        if (method === 'POST') return { number: 3, title: 't', body: 'b', labels: [], state: 'open' };
        if (endpoint.includes('page=1&')) return full;
        if (endpoint.includes('page=2&')) return [{ id: 99, name: 'late' }];
        return [];
      });
      await new GiteaForgeAdapter('host/owner/repo').issueCreate({ title: 't', body: 'b', labels: ['late', 'l3'] });
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ labels: [99, 3] });
      expect(calls.filter((c) => c.method === 'GET').length).toBe(3);
    });

    test('issueCreate walks past a server page cap smaller than the requested limit', async () => {
      mockApi((method, endpoint) => {
        if (method === 'POST') return { number: 3, title: 't', body: 'b', labels: [], state: 'open' };
        const page = Number(/page=(\d+)/.exec(endpoint)?.[1]);
        return page === 1 ? [{ id: 1, name: 'a' }] : page === 2 ? [{ id: 2, name: 'b' }] : [];
      });
      await new GiteaForgeAdapter('host/owner/repo').issueCreate({ title: 't', body: 'b', labels: ['b'] });
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ labels: [2] });
    });

    test('issueCreate stops after one GET when X-Total-Count is already reached', async () => {
      mockApi(
        (method) => (method === 'POST' ? { number: 4, title: 't', body: 'b', labels: [], state: 'open' } : [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]),
        'HTTP/1.1 200 OK\nX-Total-Count: 2\n',
      );
      await new GiteaForgeAdapter('host/owner/repo').issueCreate({ title: 't', body: 'b', labels: ['b'] });
      expect(calls.filter((c) => c.method === 'GET').length).toBe(1);
    });

    test('issueCreate keeps walking while X-Total-Count exceeds the labels read, then stops at the total', async () => {
      mockApi((method, endpoint) => {
        if (method === 'POST') return { number: 4, title: 't', body: 'b', labels: [], state: 'open' };
        const page = Number(/page=(\d+)/.exec(endpoint)?.[1]);
        return page === 1 ? [{ id: 1, name: 'a' }] : page === 2 ? [{ id: 2, name: 'b' }] : [{ id: 3, name: 'c' }];
      }, 'HTTP/1.1 200 OK\nX-Total-Count: 2\n');
      await new GiteaForgeAdapter('host/owner/repo').issueCreate({ title: 't', body: 'b', labels: ['b'] });
      expect(calls.filter((c) => c.method === 'GET').length).toBe(2);
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ labels: [2] });
    });

    test('issueCreate throws when the label pages never end', async () => {
      mockApi((method) => (method === 'GET' ? [{ id: 1, name: 'a' }] : {}));
      await expect(new GiteaForgeAdapter('host/owner/repo').issueCreate({ title: 't', body: 'b', labels: ['a'] })).rejects.toThrow(/pages/);
      expect(calls.some((c) => c.method === 'POST')).toBe(false);
    });

    test('prCreate POSTs title, body, head and base and maps the REST row', async () => {
      mockApi(() => apiPr(30, { title: 'Add feature', body: 'description', head: { ref: 'feature-branch', sha: 'abc', repo: { full_name: 'owner/repo' } } }));
      const pr = await new GiteaForgeAdapter('host/owner/repo').prCreate({ title: 'Add feature', body: 'description', head: 'feature-branch', base: 'main' });
      expect(calls).toEqual([
        { method: 'POST', endpoint: 'repos/owner/repo/pulls', body: { title: 'Add feature', body: 'description', head: 'feature-branch', base: 'main' } },
      ]);
      expect(pr).toMatchObject({ number: 30, title: 'Add feature', body: 'description', headRefName: 'feature-branch', baseRefName: 'main', state: 'OPEN' });
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

  test('prUpdateBranch is UNSUPPORTED (no expected-head guard) and calls tea zero times', async () => {
    runTeaJsonSpy = spyOn(teaCli, 'runTeaJson').mockReturnValue([]);
    const result = await new GiteaForgeAdapter('host/owner/repo').prUpdateBranch(4, 'abc123');
    expect(result.verdict).toBe('UNSUPPORTED');
    expect(result.detail).toContain('expected-head');
    expect(runTeaJsonSpy).toHaveBeenCalledTimes(0);
  });
});

describe('GiteaForgeAdapter claim and release', () => {
  const fresh = new Date(Date.now() - 3_600_000).toISOString();
  const stale = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const row = (extra: Record<string, unknown> = {}) => ({ number: 7, title: 't', state: 'open', labels: [], assignees: [], updated_at: fresh, ...extra });
  let apiSpy: ReturnType<typeof spyOn<typeof teaCli, 'runTeaApiJson'>>;
  let textSpy: ReturnType<typeof spyOn<typeof teaCli, 'runTeaText'>>;
  let apiCalls: Array<{ method: string; endpoint: string; body: unknown }> = [];

  const mock$ = (reply: (method: string, endpoint: string) => unknown, text: (argv: string[]) => string = () => '') => {
    apiCalls = [];
    apiSpy = spyOn(teaCli, 'runTeaApiJson').mockImplementation(((method: string, endpoint: string, body?: unknown) => {
      apiCalls.push({ method, endpoint, body });
      return { data: reply(method, endpoint), headers: '' };
    }) as never);
    textSpy = spyOn(teaCli, 'runTeaText').mockImplementation(text as never);
  };
  afterEach(() => {
    apiSpy?.mockRestore();
    textSpy?.mockRestore();
  });
  const adapter = new GiteaForgeAdapter('host/owner/repo');

  test('claim creates the label, adds it and PATCHes the assignee list with the user kept alongside others', async () => {
    mock$(() => row({ assignees: [{ login: 'other' }] }));
    expect(await adapter.claim(7, 'acct-a', 'me')).toEqual({ verdict: 'CLAIMED' });
    expect(textSpy).toHaveBeenCalledWith(['labels', 'create', '--repo', 'host/owner/repo', '--name', 'in-progress:acct-a', '--color', '#1d76db']);
    expect(textSpy).toHaveBeenCalledWith(['issue', 'edit', '7', '--repo', 'host/owner/repo', '--add-labels', 'in-progress:acct-a']);
    expect(apiCalls.find((c) => c.method === 'PATCH')).toEqual({ method: 'PATCH', endpoint: 'repos/owner/repo/issues/7', body: { assignees: ['other', 'me'] } });
  });

  test('an existing label is not an error, any other failure is', async () => {
    mock$(() => row(), (argv) => {
      if (argv[0] === 'labels') throw new Error('label already exists');
      return '';
    });
    expect((await adapter.claim(7, 'acct-a', 'me')).verdict).toBe('CLAIMED');
    textSpy.mockRestore();
    textSpy = spyOn(teaCli, 'runTeaText').mockImplementation(((argv: string[]) => {
      if (argv[0] === 'labels') throw new Error('HTTP 500');
      return '';
    }) as never);
    await expect(adapter.claim(7, 'acct-a', 'me')).rejects.toThrow('HTTP 500');
  });

  test('a live foreign claim is HELD and writes nothing', async () => {
    mock$((_m, endpoint) => (endpoint.includes('/pulls') ? [] : row({ labels: [{ name: 'in-progress:acct-b' }] })));
    expect(await adapter.claim(7, 'acct-a', 'me')).toEqual({ verdict: 'HELD', held_by: 'acct-b' });
    expect(textSpy).not.toHaveBeenCalled();
    expect(apiCalls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  test('a stale claim is reclaimed', async () => {
    let reads = 0;
    mock$((_m, endpoint) => (endpoint.includes('/pulls') ? [] : row({ labels: [{ name: reads++ === 0 ? 'in-progress:acct-b' : 'in-progress:acct-a' }], updated_at: stale })));
    expect(await adapter.claim(7, 'acct-a', 'me')).toEqual({ verdict: 'RECLAIMED' });
    expect(textSpy).toHaveBeenCalledWith(['issue', 'edit', '7', '--repo', 'host/owner/repo', '--remove-labels', 'in-progress:acct-b']);
  });

  test('release drops only the user from the assignee list', async () => {
    mock$((_m, endpoint) => (endpoint === 'user' ? { login: 'me' } : row({ labels: [{ name: 'in-progress:acct-a' }], assignees: [{ login: 'me' }, { login: 'other' }] })));
    expect(await adapter.release(7, 'acct-a')).toEqual({ verdict: 'RELEASED' });
    expect(apiCalls.find((c) => c.method === 'PATCH')?.body).toEqual({ assignees: ['other'] });
  });

  test('viewerLogin reads GET user', async () => {
    mock$(() => ({ login: 'me' }));
    expect(await adapter.viewerLogin()).toBe('me');
  });

  test('both update-time spellings and both assignee shapes map', async () => {
    const rows = [
      { index: 1, title: 'a', updated: 'U1', assignees: ['me'] },
      { index: 2, title: 'b', updated_at: 'U2', assignees: [{ login: 'you' }] },
      { index: 3, title: 'c' },
    ];
    const spy = spyOn(teaCli, 'runTeaJson').mockReturnValue(rows);
    const out = await adapter.issueList();
    spy.mockRestore();
    expect(out[0]).toMatchObject({ updatedAt: 'U1', assignees: ['me'] });
    expect(out[1]).toMatchObject({ updatedAt: 'U2', assignees: ['you'] });
    expect(out[2]).not.toHaveProperty('updatedAt');
  });
});

describe('createForgeAdapter gitea', () => {
  test('selects gitea backend', async () => {
    const { createForgeAdapter } = await import('./index.ts');
    const adapter = createForgeAdapter({ repo: 'host/o/r', forge: 'gitea' });
    expect(adapter.forge).toBe('gitea');
  });

});
