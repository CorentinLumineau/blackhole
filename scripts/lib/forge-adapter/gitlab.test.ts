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
});

describe('createForgeAdapter gitlab', () => {
  test('selects gitlab backend', async () => {
    const { createForgeAdapter } = await import('./index.ts');
    const adapter = createForgeAdapter({ repo: 'group/project', forge: 'gitlab' });
    expect(adapter.forge).toBe('gitlab');
  });
});
