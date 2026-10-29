import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'child_process';
import { GitHubForgeAdapter } from './github.ts';
import { repoSlugFromOrigin } from './github-rest.ts';

// Every adapter call is `gh api -X <method> <endpoint> [--input -]` (ADR-048). The mock answers by
// method + endpoint and records each call, so a test asserts both the REST request and the mapping.

type Call = { method: string; endpoint: string; body: unknown };
type Reply = { status?: number; stdout?: unknown; stderr?: string };

const issueRow = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `t${number}`,
  body: 'b',
  labels: [{ name: 'bug' }],
  milestone: { title: 'v1' },
  state: 'open',
  ...extra,
});

const prRow = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `p${number}`,
  body: null,
  head: { ref: 'feat', sha: 'abc123' },
  state: 'open',
  merged_at: null,
  ...extra,
});

describe('GitHubForgeAdapter (REST)', () => {
  let spawnSyncSpy: ReturnType<typeof spyOn<typeof childProcess, 'spawnSync'>>;
  let calls: Call[] = [];

  afterEach(() => {
    spawnSyncSpy?.mockRestore();
    calls = [];
  });

  function mockApi(reply: (method: string, endpoint: string) => Reply): void {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockImplementation((_cmd, args, options) => {
      const argv = args as string[];
      const method = argv[2];
      const endpoint = argv[3];
      const input = (options as { input?: string } | undefined)?.input;
      calls.push({ method, endpoint, body: input === undefined ? undefined : JSON.parse(input) });
      const r = reply(method, endpoint);
      const stdout = typeof r.stdout === 'string' ? r.stdout : JSON.stringify(r.stdout ?? {});
      return { status: r.status ?? 0, stdout, stderr: r.stderr ?? '' } as never;
    });
  }

  const adapter = new GitHubForgeAdapter('owner/repo');

  test('issueList drops pull requests and maps REST rows', async () => {
    mockApi(() => ({ stdout: [issueRow(1), issueRow(2, { pull_request: { url: 'x' } })] }));
    const issues = await adapter.issueList({ state: 'open', labels: ['bug', 'p1'] });
    expect(issues).toEqual([
      { number: 1, title: 't1', body: 'b', labels: [{ name: 'bug' }], milestone: { title: 'v1' }, state: 'OPEN' },
    ]);
    expect(calls[0]).toMatchObject({ method: 'GET' });
    expect(calls[0].endpoint).toBe('repos/owner/repo/issues?state=open&labels=bug%2Cp1&per_page=100&page=1');
  });

  test('issueList filters by milestone title and reads the next page after a full one', async () => {
    const full = Array.from({ length: 100 }, (_, i) => issueRow(i + 1, { milestone: { title: 'other' } }));
    mockApi((_m, endpoint) => ({ stdout: endpoint.endsWith('page=1') ? full : [issueRow(500)] }));
    const issues = await adapter.issueList({ milestone: 'v1' });
    expect(issues.map((i) => i.number)).toEqual([500]);
    expect(calls).toHaveLength(2);
  });

  test('prView maps head ref, head sha and a merged state', async () => {
    mockApi(() => ({ stdout: prRow(5, { state: 'closed', merged_at: '2026-10-10T00:00:00Z' }) }));
    const pr = await adapter.prView(5);
    expect(pr).toEqual({
      number: 5,
      title: 'p5',
      body: '',
      headRefName: 'feat',
      headRefOid: 'abc123',
      state: 'MERGED',
      mergedAt: '2026-10-10T00:00:00Z',
    });
    expect(calls[0].endpoint).toBe('repos/owner/repo/pulls/5');
  });

  test('prChecks reads check runs and commit statuses for the head sha', async () => {
    mockApi((_m, endpoint) => {
      if (endpoint.endsWith('/pulls/7')) return { stdout: prRow(7) };
      if (endpoint.includes('/check-runs')) {
        return {
          stdout: {
            check_runs: [
              { name: 'verify', status: 'completed', conclusion: 'success' },
              { name: 'lint', status: 'in_progress', conclusion: null },
            ],
          },
        };
      }
      return { stdout: { statuses: [{ context: 'Vercel', state: 'pending' }, { context: 'ci/legacy', state: 'error' }] } };
    });
    expect(await adapter.prChecks(7)).toEqual([
      { name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'lint', status: 'IN_PROGRESS', conclusion: null },
      { name: 'Vercel', status: 'QUEUED', conclusion: null },
      { name: 'ci/legacy', status: 'COMPLETED', conclusion: 'FAILURE' },
    ]);
    expect(calls.map((c) => c.endpoint)).toEqual([
      'repos/owner/repo/pulls/7',
      'repos/owner/repo/commits/abc123/check-runs?per_page=100',
      'repos/owner/repo/commits/abc123/status',
    ]);
  });

  test('issueCreate posts title, body and labels as JSON on stdin', async () => {
    mockApi(() => ({ stdout: issueRow(9, { labels: ['bug'] }) }));
    const issue = await adapter.issueCreate({ title: 't9', body: 'b', labels: ['bug'] });
    expect(issue.labels).toEqual([{ name: 'bug' }]);
    expect(calls[0]).toEqual({ method: 'POST', endpoint: 'repos/owner/repo/issues', body: { title: 't9', body: 'b', labels: ['bug'] } });
  });

  test('issueEdit patches only the provided fields', async () => {
    mockApi(() => ({ stdout: issueRow(3) }));
    await adapter.issueEdit(3, { body: 'new' });
    expect(calls[0]).toEqual({ method: 'PATCH', endpoint: 'repos/owner/repo/issues/3', body: { body: 'new' } });
  });

  test('issueComment and prComment both post to the issue comments endpoint', async () => {
    mockApi(() => ({ stdout: { id: 1 } }));
    await adapter.issueComment(3, 'hi');
    await adapter.prComment(4, 'there');
    expect(calls).toEqual([
      { method: 'POST', endpoint: 'repos/owner/repo/issues/3/comments', body: { body: 'hi' } },
      { method: 'POST', endpoint: 'repos/owner/repo/issues/4/comments', body: { body: 'there' } },
    ]);
  });

  test('prCreate posts head and base and maps the created pull request', async () => {
    mockApi(() => ({ stdout: prRow(11) }));
    const pr = await adapter.prCreate({ title: 'p11', body: 'b', head: 'feat', base: 'main' });
    expect(pr.number).toBe(11);
    expect(calls[0]).toEqual({
      method: 'POST',
      endpoint: 'repos/owner/repo/pulls',
      body: { title: 'p11', body: 'b', head: 'feat', base: 'main' },
    });
  });

  test('labelAdd posts the labels; labelRemove deletes each and ignores a missing label', async () => {
    mockApi((method, endpoint) =>
      method === 'DELETE' && endpoint.endsWith('/needs%20review')
        ? { status: 1, stdout: '', stderr: 'gh: Label does not exist (HTTP 404)' }
        : { stdout: [] },
    );
    await adapter.labelAdd({ type: 'pr', number: 5 }, ['a', 'b']);
    await adapter.labelRemove({ type: 'issue', number: 6 }, ['stale', 'needs review']);
    expect(calls).toEqual([
      { method: 'POST', endpoint: 'repos/owner/repo/issues/5/labels', body: { labels: ['a', 'b'] } },
      { method: 'DELETE', endpoint: 'repos/owner/repo/issues/6/labels/stale', body: undefined },
      { method: 'DELETE', endpoint: 'repos/owner/repo/issues/6/labels/needs%20review', body: undefined },
    ]);
  });

  test('labelRemove still throws on a failure other than not-found', async () => {
    mockApi(() => ({ status: 1, stdout: '', stderr: 'gh: Forbidden (HTTP 403)' }));
    await expect(adapter.labelRemove({ type: 'issue', number: 6 }, ['stale'])).rejects.toThrow('HTTP 403');
  });

  test('authStatus is ok when the repo is readable over REST', async () => {
    mockApi(() => ({ stdout: { full_name: 'owner/repo' } }));
    expect(await adapter.authStatus()).toEqual({ ok: true, forge: 'github', host: 'github.com' });
    expect(calls[0].endpoint).toBe('repos/owner/repo');
  });

  test('authStatus reports a missing gh binary and a failed REST read', async () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    } as never);
    expect((await adapter.authStatus()).detail).toContain('not found');
    spawnSyncSpy.mockRestore();

    mockApi(() => ({ status: 1, stdout: '', stderr: 'gh: Bad credentials (HTTP 401)' }));
    expect(await adapter.authStatus()).toMatchObject({ ok: false, detail: 'gh: Bad credentials (HTTP 401)' });
  });
});

describe('repoSlugFromOrigin', () => {
  test('reads owner/name from https and ssh GitHub remotes', () => {
    expect(repoSlugFromOrigin('https://github.com/CorentinLumineau/blackhole')).toBe('CorentinLumineau/blackhole');
    expect(repoSlugFromOrigin('https://github.com/o/r.git')).toBe('o/r');
    expect(repoSlugFromOrigin('git@github.com:o/r.git')).toBe('o/r');
  });

  test('returns null for a non-GitHub or missing remote', () => {
    expect(repoSlugFromOrigin('https://gitlab.com/o/r')).toBeNull();
    expect(repoSlugFromOrigin(null)).toBeNull();
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
