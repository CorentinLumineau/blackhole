import { describe, expect, spyOn, test, afterEach } from 'bun:test';
import * as glabCli from './glab-cli.ts';
import { GitLabForgeAdapter } from './gitlab.ts';

describe('GitLabForgeAdapter', () => {
  let runGlabJsonSpy: ReturnType<typeof spyOn<typeof glabCli, 'runGlabJson'>>;

  afterEach(() => {
    runGlabJsonSpy?.mockRestore();
  });

  test('issueList normalizes glab issue rows', async () => {
    runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockReturnValue([
      {
        iid: 12,
        title: 'GitLab issue',
        description: 'body',
        labels: ['bug'],
        state: 'opened',
      },
    ]);
    const adapter = new GitLabForgeAdapter('group/project');
    const issues = await adapter.issueList();
    expect(issues[0].number).toBe(12);
    expect(issues[0].labels).toEqual([{ name: 'bug' }]);
    expect(issues[0].state).toBe('OPEN');
  });

  test('prList maps merge requests to ForgePr', async () => {
    runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockReturnValue([
      {
        iid: 4,
        title: 'mr',
        description: '',
        source_branch: 'feature',
        state: 'opened',
        merged_at: null,
      },
    ]);
    const adapter = new GitLabForgeAdapter('group/project');
    const prs = await adapter.prList();
    expect(prs[0].number).toBe(4);
    expect(prs[0].headRefName).toBe('feature');
  });

  // Issue #864: `prChecks` used to swallow any `glab ci status` failure into `[]` —
  // indistinguishable from "no pipeline configured". A caller reading an empty array as "nothing
  // failing" would let a merge proceed on a CI read it never actually got.
  test('prChecks propagates a glab CLI failure instead of returning an empty check list', async () => {
    runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockImplementation(() => {
      throw new Error('glab: connection refused');
    });
    const adapter = new GitLabForgeAdapter('group/project');
    await expect(adapter.prChecks(9)).rejects.toThrow('glab: connection refused');
  });

  // Issue #868: `prChecks` collapsed an entire pipeline into one synthetic `{ name: 'pipeline' }`
  // row via `glab ci status`, however many jobs actually ran — violating the `ForgeAdapter`
  // contract's per-check shape that `gitea.ts`/`github.ts` both honor (V-SOLID-03). The fix reads
  // GitLab's public REST API directly (`glab api ...`) for the MR's latest pipeline, then that
  // pipeline's jobs, and maps each job to its own `ForgeCheck`.
  test('prChecks returns one ForgeCheck per GitLab pipeline job', async () => {
    runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockImplementation((args: string[]) => {
      const endpoint = args[1] ?? '';
      if (endpoint === 'projects/group%2Fproject/merge_requests/9/pipelines') {
        return [{ id: 55 }];
      }
      if (endpoint === 'projects/group%2Fproject/pipelines/55/jobs') {
        return [
          { name: 'lint', status: 'success' },
          { name: 'test', status: 'failed' },
        ];
      }
      throw new Error('unexpected glab api call: ' + args.join(' '));
    });
    const adapter = new GitLabForgeAdapter('group/project');
    const checks = await adapter.prChecks(9);
    expect(checks).toEqual([
      { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
    ]);
  });

  test('prChecks picks the pipeline with the highest id, not array order', async () => {
    runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockImplementation((args: string[]) => {
      const endpoint = args[1] ?? '';
      if (endpoint === 'projects/group%2Fproject/merge_requests/9/pipelines') {
        // Array order and max-id disagree: id 55 (lower, but listed first) vs id 90 (the max,
        // listed second). Only the jobs endpoint for the max id (90) is stubbed — a `pipelines[0]`
        // regression would request pipeline 55's jobs instead and hit the throw below.
        return [{ id: 55 }, { id: 90 }];
      }
      if (endpoint === 'projects/group%2Fproject/pipelines/90/jobs') {
        return [{ name: 'build', status: 'running' }];
      }
      throw new Error('unexpected glab api call: ' + args.join(' '));
    });
    const adapter = new GitLabForgeAdapter('group/project');
    const checks = await adapter.prChecks(9);
    expect(checks).toEqual([{ name: 'build', status: 'IN_PROGRESS', conclusion: null }]);
  });

  // 100% line coverage on the status/conclusion ternary chain does not imply every branch ran —
  // Bun's line coverage does not require branch coverage on a ternary chain. Exercise every
  // GitLab job `status` value the mapping distinguishes, including the two statuses that share
  // the QUEUED status mapping and the unrecognized-status fallthrough.
  test.each([
    ['pending', 'QUEUED', null],
    ['created', 'QUEUED', null],
    ['canceled', 'COMPLETED', 'CANCELLED'],
    ['skipped', 'COMPLETED', 'SKIPPED'],
    ['manual', 'COMPLETED', null],
  ] as const)(
    'prChecks maps GitLab job status %s to status %s / conclusion %s',
    async (jobStatus, expectedStatus, expectedConclusion) => {
      runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockImplementation((args: string[]) => {
        const endpoint = args[1] ?? '';
        if (endpoint === 'projects/group%2Fproject/merge_requests/9/pipelines') {
          return [{ id: 1 }];
        }
        if (endpoint === 'projects/group%2Fproject/pipelines/1/jobs') {
          return [{ name: 'job', status: jobStatus }];
        }
        throw new Error('unexpected glab api call: ' + args.join(' '));
      });
      const adapter = new GitLabForgeAdapter('group/project');
      const checks = await adapter.prChecks(9);
      expect(checks).toEqual([
        { name: 'job', status: expectedStatus, conclusion: expectedConclusion },
      ]);
    },
  );

  test('prChecks returns an empty list when the MR has no pipeline yet', async () => {
    runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockImplementation((args: string[]) => {
      const endpoint = args[1] ?? '';
      if (endpoint === 'projects/group%2Fproject/merge_requests/9/pipelines') {
        return [];
      }
      throw new Error('unexpected glab api call: ' + args.join(' '));
    });
    const adapter = new GitLabForgeAdapter('group/project');
    const checks = await adapter.prChecks(9);
    expect(checks).toEqual([]);
  });

  test('authStatus reports the logged-in GitLab host', async () => {
    const runGlabSpy = spyOn(glabCli, 'runGlab').mockReturnValue({
      status: 0,
      stdout: 'GitLab: gitlab.com as user (glab)\n',
      stderr: '',
      error: null,
    });
    const adapter = new GitLabForgeAdapter('group/project');
    const status = await adapter.authStatus();
    expect(status).toEqual({ ok: true, forge: 'gitlab', host: 'gitlab.com' });
    runGlabSpy.mockRestore();
  });

  test('authStatus reports missing glab binary', async () => {
    const runGlabSpy = spyOn(glabCli, 'runGlab').mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    });
    const adapter = new GitLabForgeAdapter('group/project');
    const status = await adapter.authStatus();
    expect(status.ok).toBe(false);
    expect(status.detail).toContain('not found');
    runGlabSpy.mockRestore();
  });

  test('authStatus surfaces a non-zero glab auth status exit', async () => {
    const runGlabSpy = spyOn(glabCli, 'runGlab').mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'no token found',
      error: null,
    });
    const adapter = new GitLabForgeAdapter('group/project');
    const status = await adapter.authStatus();
    expect(status).toEqual({
      ok: false,
      forge: 'gitlab',
      host: null,
      detail: 'no token found',
    });
    runGlabSpy.mockRestore();
  });

  test('labelAdd pins the exact glab argv for a merge request', async () => {
    const runGlabTextSpy = spyOn(glabCli, 'runGlabText').mockReturnValue('');
    const adapter = new GitLabForgeAdapter('group/project');
    await adapter.labelAdd({ type: 'pr', number: 12 }, ['bug', 'urgent']);
    expect(runGlabTextSpy).toHaveBeenCalledWith([
      'mr',
      'update',
      '12',
      '--repo',
      'group/project',
      '--label',
      'bug,urgent',
    ]);
    runGlabTextSpy.mockRestore();
  });

  test('labelRemove pins the exact glab argv for an issue', async () => {
    const runGlabTextSpy = spyOn(glabCli, 'runGlabText').mockReturnValue('');
    const adapter = new GitLabForgeAdapter('group/project');
    await adapter.labelRemove({ type: 'issue', number: 3 }, ['wontfix']);
    expect(runGlabTextSpy).toHaveBeenCalledWith([
      'issue',
      'update',
      '3',
      '--repo',
      'group/project',
      '--unlabel',
      'wontfix',
    ]);
    runGlabTextSpy.mockRestore();
  });

  test('issueCreate maps the created glab issue row', async () => {
    runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockReturnValue({
      iid: 21,
      title: 'New bug',
      description: 'Steps to reproduce',
      labels: ['bug'],
      state: 'opened',
    });
    const adapter = new GitLabForgeAdapter('group/project');
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

  test('issueEdit pins the exact glab argv', async () => {
    const runGlabTextSpy = spyOn(glabCli, 'runGlabText').mockReturnValue('');
    const adapter = new GitLabForgeAdapter('group/project');
    await adapter.issueEdit(4, { title: 'Renamed', body: 'Updated body' });
    expect(runGlabTextSpy).toHaveBeenCalledWith([
      'issue',
      'update',
      '4',
      '--repo',
      'group/project',
      '--title',
      'Renamed',
      '--description',
      'Updated body',
    ]);
    runGlabTextSpy.mockRestore();
  });

  test('issueComment pins the exact glab argv', async () => {
    const runGlabTextSpy = spyOn(glabCli, 'runGlabText').mockReturnValue('');
    const adapter = new GitLabForgeAdapter('group/project');
    await adapter.issueComment(4, 'looking into it');
    expect(runGlabTextSpy).toHaveBeenCalledWith([
      'issue',
      'note',
      '4',
      '--repo',
      'group/project',
      '--message',
      'looking into it',
    ]);
    runGlabTextSpy.mockRestore();
  });

  test('prCreate maps the created glab merge request row', async () => {
    runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockReturnValue({
      iid: 30,
      title: 'Add feature',
      description: 'description',
      source_branch: 'feature-branch',
      state: 'opened',
      merged_at: null,
    });
    const adapter = new GitLabForgeAdapter('group/project');
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

  test('prComment pins the exact glab argv', async () => {
    const runGlabTextSpy = spyOn(glabCli, 'runGlabText').mockReturnValue('');
    const adapter = new GitLabForgeAdapter('group/project');
    await adapter.prComment(30, 'LGTM');
    expect(runGlabTextSpy).toHaveBeenCalledWith([
      'mr',
      'note',
      '30',
      '--repo',
      'group/project',
      '--message',
      'LGTM',
    ]);
    runGlabTextSpy.mockRestore();
  });

  test('prView carries the label names and reads has_conflicts as mergeability', async () => {
    runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockReturnValue({
      iid: 31,
      title: 'mr',
      description: '',
      source_branch: 'f',
      state: 'opened',
      labels: ['ai-review:LGTM'],
      has_conflicts: true,
    });
    expect(await new GitLabForgeAdapter('group/project').prView(31)).toMatchObject({ labels: ['ai-review:LGTM'], mergeable: false });
  });

  test('prList of every state passes --all, so merged merge requests are listed', async () => {
    runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockReturnValue([
      { iid: 5, title: 'done', description: '', source_branch: 'f', state: 'merged', merged_at: '2026-11-12T08:00:00Z' },
    ]);
    const prs = await new GitLabForgeAdapter('group/project').prList({ state: 'all', limit: 300 });
    expect(runGlabJsonSpy.mock.calls[0][0]).toContain('--all');
    expect(prs[0]).toMatchObject({ number: 5, state: 'MERGED', mergedAt: '2026-11-12T08:00:00Z' });
  });

  test('prView maps a single glab merge request row', async () => {
    runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockReturnValue({
      iid: 30,
      title: 'Add feature',
      description: 'description',
      source_branch: 'feature-branch',
      state: 'merged',
      merged_at: '2026-01-01T00:00:00Z',
    });
    const adapter = new GitLabForgeAdapter('group/project');
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

  test('prUpdateBranch is UNSUPPORTED (rebase would force-push) and calls glab zero times', async () => {
    runGlabJsonSpy = spyOn(glabCli, 'runGlabJson').mockReturnValue([]);
    const result = await new GitLabForgeAdapter('group/project').prUpdateBranch(4, 'abc123');
    expect(result.verdict).toBe('UNSUPPORTED');
    expect(result.detail).toContain('force-push');
    expect(runGlabJsonSpy).toHaveBeenCalledTimes(0);
  });
});

describe('GitLabForgeAdapter stacking additions', () => {
  test('prFiles and prChangeBase are not supported and say so', async () => {
    const adapter = new GitLabForgeAdapter('host/owner/repo');
    await expect(adapter.prFiles(1)).rejects.toThrow(/not-supported/);
    await expect(adapter.prChangeBase(1, 'main')).rejects.toThrow(/not-supported/);
  });
});

describe('createForgeAdapter gitlab', () => {
  test('selects gitlab backend', async () => {
    const { createForgeAdapter } = await import('./index.ts');
    const adapter = createForgeAdapter({ repo: 'group/project', forge: 'gitlab' });
    expect(adapter.forge).toBe('gitlab');
  });
});

describe('GitLabForgeAdapter claim and release', () => {
  const fresh = new Date(Date.now() - 3_600_000).toISOString();
  const stale = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const issue = (extra: Record<string, unknown> = {}) => ({ iid: 7, title: 't', state: 'opened', labels: [], assignees: [], updated_at: fresh, ...extra });
  const adapter = new GitLabForgeAdapter('group/project');
  let apiSpy: ReturnType<typeof spyOn<typeof glabCli, 'runGlabText'>>;
  let textCalls: string[][] = [];
  let jsonSpy: ReturnType<typeof spyOn<typeof glabCli, 'runGlabJson'>> | undefined;

  const mockGlab = (reply: (endpoint: string) => unknown) => {
    textCalls = [];
    apiSpy = spyOn(glabCli, 'runGlabText').mockImplementation(((args: string[]) => {
      textCalls.push(args);
      return args[0] === 'api' ? JSON.stringify(reply(args[1])) : '';
    }) as never);
  };
  afterEach(() => {
    apiSpy?.mockRestore();
    jsonSpy?.mockRestore();
    jsonSpy = undefined;
  });
  const apiWrites = () => textCalls.filter((a) => a[0] === 'api' && a[3] === 'PUT').map((a) => a[1]);
  const issueEndpoint = 'projects/group%2Fproject/issues/7';

  test('claim labels the issue then PUTs the union of assignee ids', async () => {
    mockGlab((e) => (e.startsWith('users?') ? [{ id: 99 }] : issue({ assignees: [{ id: 5, username: 'other' }] })));
    expect(await adapter.claim(7, 'acct-a', 'me')).toEqual({ verdict: 'CLAIMED' });
    expect(textCalls).toContainEqual(['issue', 'update', '7', '--repo', 'group/project', '--label', 'in-progress:acct-a']);
    expect(apiWrites()).toEqual([`${issueEndpoint}?assignee_ids[]=5&assignee_ids[]=99`]);
  });

  test('a live foreign claim is HELD and writes nothing', async () => {
    mockGlab((e) => (e.includes('merge_requests') ? [] : issue({ labels: ['in-progress:acct-b'] })));
    jsonSpy = spyOn(glabCli, 'runGlabJson').mockReturnValue([]);
    expect(await adapter.claim(7, 'acct-a', 'me')).toEqual({ verdict: 'HELD', held_by: 'acct-b' });
    expect(textCalls.some((a) => a[0] === 'issue')).toBe(false);
    expect(apiWrites()).toEqual([]);
  });

  test('a stale claim is reclaimed and the stale label is removed', async () => {
    let reads = 0;
    mockGlab((e) => (e.startsWith('users?') ? [{ id: 99 }] : issue({ labels: [reads++ === 0 ? 'in-progress:acct-b' : 'in-progress:acct-a'], updated_at: stale })));
    jsonSpy = spyOn(glabCli, 'runGlabJson').mockReturnValue([]);
    expect(await adapter.claim(7, 'acct-a', 'me')).toEqual({ verdict: 'RECLAIMED' });
    expect(textCalls).toContainEqual(['issue', 'update', '7', '--repo', 'group/project', '--unlabel', 'in-progress:acct-b']);
  });

  test('release PUTs the id list without the user', async () => {
    mockGlab((e) => {
      if (e === 'user') return { username: 'me' };
      if (e.startsWith('users?')) return [{ id: 99 }];
      return issue({ labels: ['in-progress:acct-a'], assignees: [{ id: 99, username: 'me' }, { id: 5, username: 'other' }] });
    });
    expect(await adapter.release(7, 'acct-a')).toEqual({ verdict: 'RELEASED' });
    expect(apiWrites()).toEqual([`${issueEndpoint}?assignee_ids[]=5`]);
  });

  test('viewerLogin reads the authenticated username', async () => {
    mockGlab(() => ({ username: 'me' }));
    expect(await adapter.viewerLogin()).toBe('me');
  });

  test('issueList maps assignees and updated_at, and omits them when absent', async () => {
    jsonSpy = spyOn(glabCli, 'runGlabJson').mockReturnValue([
      { iid: 1, title: 'a', updated_at: 'U', assignees: [{ id: 1, username: 'me' }] },
      { iid: 2, title: 'b' },
    ]);
    const [withFields, without] = await adapter.issueList();
    expect(withFields).toMatchObject({ assignees: ['me'], updatedAt: 'U' });
    expect(without).not.toHaveProperty('updatedAt');
  });
});
