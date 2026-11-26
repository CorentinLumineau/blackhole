import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'child_process';
import { GitHubForgeAdapter } from './github.ts';
import { classifyUpdateBranchFailure, mapRestCheckRun, mapRestStatus, repoSlugFromOrigin, suiteProducers } from './github-rest.ts';

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

  test('prView carries the label names and the mergeability the REST row reports', async () => {
    mockApi(() => ({ stdout: prRow(6, { mergeable: false, labels: [{ name: 'ai-review:LGTM' }, { name: 'bug' }] }) }));
    expect(await adapter.prView(6)).toMatchObject({ mergeable: false, labels: ['ai-review:LGTM', 'bug'] });
  });

  test('prChecks reads check runs and commit statuses for the head sha, and proves a producer through the workflow runs', async () => {
    mockApi((_m, endpoint) => {
      if (endpoint.endsWith('/pulls/7')) return { stdout: prRow(7) };
      if (endpoint.includes('/check-runs')) {
        return {
          stdout: {
            total_count: 2,
            check_runs: [
              { id: 5, name: 'verify', status: 'completed', conclusion: 'success', started_at: '2026-11-20T11:00:00Z', check_suite: { id: 31 } },
              { id: 6, name: 'lint', status: 'in_progress', conclusion: null, check_suite: { id: 99 } },
            ],
          },
        };
      }
      if (endpoint.includes('/actions/runs')) {
        const pullRequests = [{ number: 7, head: { ref: 'feat' }, base: { ref: 'main' } }];
        return { stdout: { workflow_runs: [{ check_suite_id: 31, workflow_id: 4, event: 'pull_request', head_branch: 'feat', pull_requests: pullRequests }] } };
      }
      return { stdout: { statuses: [{ context: 'Vercel', state: 'pending' }, { context: 'ci/legacy', state: 'error' }] } };
    });
    expect(await adapter.prChecks(7)).toEqual([
      { name: 'verify', status: 'COMPLETED', conclusion: 'SUCCESS', runId: 5, suiteId: 31, startedAt: '2026-11-20T11:00:00Z', producer: 'actions:4:pull_request:feat:7:main' },
      { name: 'lint', status: 'IN_PROGRESS', conclusion: null, runId: 6, suiteId: 99 },
      { name: 'Vercel', status: 'QUEUED', conclusion: null },
      { name: 'ci/legacy', status: 'COMPLETED', conclusion: 'FAILURE' },
    ]);
    expect(calls.map((c) => c.endpoint)).toEqual([
      'repos/owner/repo/pulls/7',
      'repos/owner/repo/commits/abc123/check-runs?per_page=100&page=1',
      'repos/owner/repo/commits/abc123/status?per_page=100&page=1',
      'repos/owner/repo/actions/runs?head_sha=abc123&per_page=100',
    ]);
  });

  test('prChecks reads every check-runs page, so a failure past the first page reaches the verdict', async () => {
    const page = (from: number, count: number, conclusion = 'success') =>
      Array.from({ length: count }, (_, i) => ({ id: from + i, name: `job-${from + i}`, status: 'completed', conclusion }));
    mockApi((_m, endpoint) => {
      if (endpoint.endsWith('/pulls/7')) return { stdout: prRow(7) };
      if (endpoint.includes('/check-runs')) {
        return { stdout: endpoint.endsWith('&page=1') ? { total_count: 101, check_runs: page(1, 100) } : { total_count: 101, check_runs: page(101, 1, 'failure') } };
      }
      if (endpoint.includes('/actions/runs')) return { stdout: { workflow_runs: [] } };
      return { stdout: { statuses: [] } };
    });
    const checks = await adapter.prChecks(7);
    expect(checks).toHaveLength(101);
    expect(checks[100]).toEqual({ name: 'job-101', status: 'COMPLETED', conclusion: 'FAILURE', runId: 101 });
    expect(calls.map((c) => c.endpoint).filter((e) => e.includes('/check-runs'))).toEqual([
      'repos/owner/repo/commits/abc123/check-runs?per_page=100&page=1',
      'repos/owner/repo/commits/abc123/check-runs?per_page=100&page=2',
    ]);
  });

  describe('prChecks paging stops on the total, a short page or the page cap, and never returns a partial list', () => {
    const rows = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: from + i, name: `job-${from + i}`, status: 'completed', conclusion: 'success' }));
    const statusRows = (count: number) => Array.from({ length: count }, (_, i) => ({ context: `ctx-${i}`, state: 'success' }));
    const pageOf = (endpoint: string) => Number(/[?&]page=(\d+)/.exec(endpoint)?.[1]);
    type Answer = (page: number) => Reply;
    const serve = (checkRuns: Answer, status: Answer = () => ({ stdout: { statuses: [] } })) =>
      mockApi((_m, endpoint) => {
        if (endpoint.endsWith('/pulls/7')) return { stdout: prRow(7) };
        if (endpoint.includes('/check-runs')) return checkRuns(pageOf(endpoint));
        if (endpoint.includes('/actions/runs')) return { stdout: { workflow_runs: [] } };
        return status(pageOf(endpoint));
      });
    const endpointsFor = (part: string) => calls.map((c) => c.endpoint).filter((e) => e.includes(part));

    test('a full first page that reaches total_count ends the check-runs read without another request', async () => {
      serve(() => ({ stdout: { total_count: 100, check_runs: rows(1, 100) } }));
      expect(await adapter.prChecks(7)).toHaveLength(100);
      expect(endpointsFor('/check-runs')).toEqual(['repos/owner/repo/commits/abc123/check-runs?per_page=100&page=1']);
    });

    test('statuses are paged at 100 rows: an exact 100-row page is followed by a read of the next, empty page', async () => {
      serve(() => ({ stdout: { total_count: 0, check_runs: [] } }), (page) => ({ stdout: { statuses: page === 1 ? statusRows(100) : [] } }));
      expect(await adapter.prChecks(7)).toHaveLength(100);
      expect(endpointsFor('/status')).toEqual([
        'repos/owner/repo/commits/abc123/status?per_page=100&page=1',
        'repos/owner/repo/commits/abc123/status?per_page=100&page=2',
      ]);
    });

    test('a check-runs read that ends below total_count throws instead of returning the rows it got', async () => {
      serve((page) => ({ stdout: { total_count: 150, check_runs: page === 1 ? rows(1, 100) : [] } }));
      await expect(adapter.prChecks(7)).rejects.toThrow('check runs of abc123: read 100 of total_count 150');
    });

    test('a failure on a later page fails the read', async () => {
      serve((page) => (page === 1 ? { stdout: { total_count: 150, check_runs: rows(1, 100) } } : { status: 1, stderr: 'HTTP 502: Bad Gateway' }));
      await expect(adapter.prChecks(7)).rejects.toThrow('HTTP 502: Bad Gateway');
    });

    test('a page body without the list or an integer total_count is a named error', async () => {
      serve(() => ({ stdout: { message: 'Not Found' } }));
      await expect(adapter.prChecks(7)).rejects.toThrow('check runs of abc123: page 1 is not a { total_count, check_runs } body');
      serve(() => ({ stdout: { total_count: 0, check_runs: [] } }), () => ({ stdout: { message: 'Not Found' } }));
      await expect(adapter.prChecks(7)).rejects.toThrow('statuses of abc123: page 1 is not a { statuses } body');
    });

    test('a read that is still short after the page cap throws', async () => {
      serve((page) => ({ stdout: { total_count: 5000, check_runs: rows((page - 1) * 100 + 1, 100) } }));
      await expect(adapter.prChecks(7)).rejects.toThrow('check runs of abc123: still 1000 of total_count 5000 after 10 pages');
      expect(endpointsFor('/check-runs')).toHaveLength(10);
    });
  });

  test('prChecks keeps every run producer-less and writes one stderr line when the workflow runs call fails', async () => {
    mockApi((_m, endpoint) => {
      if (endpoint.endsWith('/pulls/7')) return { stdout: prRow(7) };
      if (endpoint.includes('/check-runs')) {
        return { stdout: { total_count: 1, check_runs: [{ id: 5, name: 'verify', status: 'completed', conclusion: 'cancelled', check_suite: { id: 31 } }] } };
      }
      if (endpoint.includes('/actions/runs')) return { status: 1, stderr: 'HTTP 403: Resource not accessible by integration' };
      return { stdout: { statuses: [] } };
    });
    const stderr = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await adapter.prChecks(7)).toEqual([{ name: 'verify', status: 'COMPLETED', conclusion: 'CANCELLED', runId: 5, suiteId: 31 }]);
      expect(stderr.mock.calls).toEqual([
        ['listChecks: workflow-runs join failed (HTTP 403: Resource not accessible by integration); every check run is judged on its own'],
      ]);
    } finally {
      stderr.mockRestore();
    }
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

  test('prView maps base ref, fork flag, draft and creation time', async () => {
    mockApi(() => ({
      stdout: prRow(8, {
        base: { ref: 'main', repo: { full_name: 'owner/repo' } },
        head: { ref: 'feat', sha: 'abc123', repo: { full_name: 'someone/repo' } },
        draft: true,
        created_at: '2026-11-01T10:00:00Z',
      }),
    }));
    expect(await adapter.prView(8)).toMatchObject({
      baseRefName: 'main',
      headRepoIsFork: true,
      draft: true,
      createdAt: '2026-11-01T10:00:00Z',
    });
  });

  test('a same-repo head is not a fork and a deleted fork repo is', async () => {
    const same = {
      base: { ref: 'main', repo: { full_name: 'owner/repo' } },
      head: { ref: 'feat', sha: 'a', repo: { full_name: 'owner/repo' } },
    };
    mockApi(() => ({ stdout: prRow(1, same) }));
    expect((await adapter.prView(1)).headRepoIsFork).toBe(false);
    spawnSyncSpy.mockRestore();
    mockApi(() => ({ stdout: prRow(2, { ...same, head: { ref: 'feat', sha: 'a', repo: null } }) }));
    expect((await adapter.prView(2)).headRepoIsFork).toBe(true);
  });

  test('prList of open pull requests reads ceil(open/100) pages, one REST call each', async () => {
    const page = (from: number, n: number) => Array.from({ length: n }, (_, i) => prRow(from + i));
    mockApi((_m, endpoint) => ({
      stdout: endpoint.endsWith('page=1') ? page(1, 100) : endpoint.endsWith('page=2') ? page(101, 100) : page(201, 50),
    }));
    const prs = await adapter.prList({ state: 'open', limit: 1001 });
    expect(prs).toHaveLength(250);
    expect(calls.map((c) => c.endpoint)).toEqual([
      'repos/owner/repo/pulls?state=open&per_page=100&page=1',
      'repos/owner/repo/pulls?state=open&per_page=100&page=2',
      'repos/owner/repo/pulls?state=open&per_page=100&page=3',
    ]);
  });

  test('prFiles pages through the files endpoint and lists both sides of a rename', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}.ts` }));
    mockApi((_m, endpoint) => ({
      stdout: endpoint.endsWith('page=1') ? full : [{ filename: 'new.ts', previous_filename: 'old.ts' }],
    }));
    const files = await adapter.prFiles(9);
    expect(files).toHaveLength(102);
    expect(files).toContain('old.ts');
    expect(files).toContain('new.ts');
    expect(calls[0].endpoint).toBe('repos/owner/repo/pulls/9/files?per_page=100&page=1');
  });

  test('prFiles refuses a truncated list at the 3000-file REST cap', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}.ts` }));
    mockApi(() => ({ stdout: full }));
    await expect(adapter.prFiles(9)).rejects.toThrow(/3000/);
  });

  test('prChangeBase patches the base, then reads it back', async () => {
    mockApi((method) => ({
      stdout: method === 'PATCH' ? { number: 4 } : prRow(4, { base: { ref: 'blackhole/issue-10', repo: { full_name: 'owner/repo' } } }),
    }));
    expect(await adapter.prChangeBase(4, 'blackhole/issue-10')).toEqual({ ok: true, base: 'blackhole/issue-10' });
    expect(calls.map((c) => [c.method, c.endpoint, c.body])).toEqual([
      ['PATCH', 'repos/owner/repo/pulls/4', { base: 'blackhole/issue-10' }],
      ['GET', 'repos/owner/repo/pulls/4', undefined],
    ]);
  });

  test('prChangeBase reports ok:false when the read-back base differs, even on a zero exit', async () => {
    mockApi((method) => ({
      stdout: method === 'PATCH' ? { number: 4 } : prRow(4, { base: { ref: 'main', repo: { full_name: 'owner/repo' } } }),
    }));
    expect(await adapter.prChangeBase(4, 'blackhole/issue-10')).toEqual({
      ok: false,
      base: 'main',
      detail: 'base is main after the change, expected blackhole/issue-10',
    });
  });

  test('prUpdateBranch sends one PUT with expected_head_sha and maps 202 to UPDATED', async () => {
    mockApi(() => ({ stdout: { message: 'Updating pull request branch.' } }));
    expect(await adapter.prUpdateBranch(4, 'abc123')).toEqual({ verdict: 'UPDATED' });
    expect(calls.map((c) => [c.method, c.endpoint, c.body])).toEqual([
      ['PUT', 'repos/owner/repo/pulls/4/update-branch', { expected_head_sha: 'abc123' }],
    ]);
  });

  test('prUpdateBranch maps a 422 merge conflict to CONFLICT', async () => {
    mockApi(() => ({ status: 1, stderr: 'gh: merge conflict between base and head (HTTP 422)' }));
    expect(await adapter.prUpdateBranch(4, 'abc123')).toEqual({
      verdict: 'CONFLICT',
      detail: 'gh: merge conflict between base and head (HTTP 422)',
    });
  });

  test('prUpdateBranch maps a 422 head-sha mismatch to STALE-HEAD', async () => {
    mockApi(() => ({ status: 1, stderr: "gh: expected head sha didn't match current head ref. (HTTP 422)" }));
    expect(await adapter.prUpdateBranch(4, 'abc123')).toMatchObject({ verdict: 'STALE-HEAD' });
    mockApi(() => ({ status: 1, stderr: 'gh: Head branch was modified. Review and try the merge again. (HTTP 422)' }));
    expect(await adapter.prUpdateBranch(4, 'abc123')).toMatchObject({ verdict: 'STALE-HEAD' });
  });

  test('prUpdateBranch maps a 403 and an unrecognised 422 to FAILED with stderr in detail, never throwing', async () => {
    mockApi(() => ({ status: 1, stderr: 'gh: Resource not accessible by integration (HTTP 403)' }));
    expect(await adapter.prUpdateBranch(4, 'abc123')).toEqual({
      verdict: 'FAILED',
      detail: 'gh: Resource not accessible by integration (HTTP 403)',
    });
    mockApi(() => ({ status: 1, stderr: 'gh: Validation Failed (HTTP 422)' }));
    expect(await adapter.prUpdateBranch(4, 'abc123')).toEqual({ verdict: 'FAILED', detail: 'gh: Validation Failed (HTTP 422)' });
  });

  test('prUpdateBranch reports FAILED when the gh binary cannot run', async () => {
    spawnSyncSpy = spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    } as never);
    expect(await adapter.prUpdateBranch(4, 'abc123')).toMatchObject({ verdict: 'FAILED' });
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

  describe('claim and release', () => {
    const stale = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const fresh = new Date(Date.now() - 3_600_000).toISOString();

    test('claim posts the label then the assignee and returns CLAIMED', async () => {
      mockApi(() => ({ stdout: issueRow(7, { labels: [], assignees: [], updated_at: fresh }) }));
      expect(await adapter.claim(7, 'acct-a', 'me')).toEqual({ verdict: 'CLAIMED' });
      const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.endpoint}`);
      expect(writes).toEqual(['POST repos/owner/repo/issues/7/labels', 'POST repos/owner/repo/issues/7/assignees']);
      expect(calls.find((c) => c.endpoint.endsWith('/labels'))?.body).toEqual({ labels: ['in-progress:acct-a'] });
      expect(calls.find((c) => c.endpoint.endsWith('/assignees'))?.body).toEqual({ assignees: ['me'] });
    });

    test('a live foreign claim is HELD with no write', async () => {
      mockApi((_m, endpoint) => (endpoint.endsWith('/pulls?state=open&per_page=100&page=1') ? { stdout: [] } : { stdout: issueRow(7, { labels: [{ name: 'in-progress:acct-b' }], updated_at: fresh }) }));
      expect(await adapter.claim(7, 'acct-a', 'me')).toEqual({ verdict: 'HELD', held_by: 'acct-b' });
      expect(calls.every((c) => c.method === 'GET')).toBe(true);
    });

    test('a stale foreign claim is reclaimed', async () => {
      let reads = 0;
      mockApi((method, endpoint) => {
        if (endpoint.includes('/pulls')) return { stdout: [] };
        if (method === 'GET') return { stdout: issueRow(7, { labels: reads++ === 0 ? [{ name: 'in-progress:acct-b' }] : [{ name: 'in-progress:acct-a' }], updated_at: stale }) };
        return { stdout: {} };
      });
      expect(await adapter.claim(7, 'acct-a', 'me')).toEqual({ verdict: 'RECLAIMED' });
      expect(calls.some((c) => c.method === 'DELETE' && c.endpoint.endsWith('/labels/in-progress%3Aacct-b'))).toBe(true);
    });

    test('release removes the lane label and the assignee', async () => {
      mockApi((_m, endpoint) => (endpoint === 'user' ? { stdout: { login: 'me' } } : { stdout: issueRow(7, { labels: [{ name: 'in-progress:acct-a' }], assignees: [{ login: 'me' }] }) }));
      expect(await adapter.release(7, 'acct-a')).toEqual({ verdict: 'RELEASED' });
      expect(calls.some((c) => c.method === 'DELETE' && c.endpoint.includes('/labels/'))).toBe(true);
      expect(calls.find((c) => c.method === 'DELETE' && c.endpoint.endsWith('/assignees'))?.body).toEqual({ assignees: ['me'] });
    });

    test('viewerLogin reads GET user', async () => {
      mockApi(() => ({ stdout: { login: 'me' } }));
      expect(await adapter.viewerLogin()).toBe('me');
      expect(calls[0]).toMatchObject({ method: 'GET', endpoint: 'user' });
    });

    test('issueList maps assignees and updatedAt, and omits them when absent', async () => {
      mockApi(() => ({ stdout: [issueRow(1, { assignees: [{ login: 'me' }], updated_at: 'T' }), issueRow(2)] }));
      const [withFields, without] = await adapter.issueList();
      expect(withFields).toMatchObject({ assignees: ['me'], updatedAt: 'T' });
      expect(without).not.toHaveProperty('updatedAt');
      expect(without).not.toHaveProperty('assignees');
    });
  });
});

describe('repoSlugFromOrigin', () => {
  test('reads owner/name from https and ssh GitHub remotes', () => {
    expect(repoSlugFromOrigin('https://github.com/CorentinLumineau/blackhole')).toBe('CorentinLumineau/blackhole');
    expect(repoSlugFromOrigin('https://github.com/o/r.git')).toBe('o/r');
    expect(repoSlugFromOrigin('git@github.com:o/r.git')).toBe('o/r');
  });

  test('wraps the forge-agnostic parser: GitHub hosts only, exactly owner/name', () => {
    expect(repoSlugFromOrigin('https://github.com/a/b/c')).toBeNull();
    expect(repoSlugFromOrigin('file:///srv/github.com/o/r')).toBeNull();
    expect(repoSlugFromOrigin('git@github.com:o/r.GIT')).toBe('o/r');
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

describe('check producer fields', () => {
  const pr = (number: unknown, base: unknown = 'main') => ({ number, head: { ref: 'feat' }, base: { ref: base } });
  const wf = (suite: unknown, workflow: unknown, event: unknown = 'pull_request', branch: unknown = 'feat', prs: unknown = [pr(7)]) =>
    ({ check_suite_id: suite, workflow_id: workflow, event, head_branch: branch, pull_requests: prs });

  test('suiteProducers keys a pull_request suite by workflow, branch, PR number and base', () => {
    const map = suiteProducers({ workflow_runs: [wf(1, 10), wf(2, 10), wf(3, 11, 'pull_request', 'fix', [pr(8, 'release')])] });
    expect(map.get(1)).toBe('actions:10:pull_request:feat:7:main');
    expect(map.get(2)).toBe(map.get(1));
    expect(map.get(3)).toBe('actions:11:pull_request:fix:8:release');
    expect(map.get(4)).toBeUndefined();
  });

  test.each([
    ['a push run', wf(1, 10, 'push', 'feat', [])],
    ['a push run that lists a PR', wf(1, 10, 'push')],
    ['a workflow_dispatch run', wf(1, 10, 'workflow_dispatch', 'feat', [])],
    ['a repository_dispatch run', wf(1, 10, 'repository_dispatch', 'feat', [])],
    ['a pull_request_target run', wf(1, 10, 'pull_request_target')],
    ['a pull_request run listing no PR', wf(1, 10, 'pull_request', 'feat', [])],
    ['a pull_request run listing two PRs', wf(1, 10, 'pull_request', 'feat', [pr(7), pr(8, 'release')])],
    ['a pull_request run with no pull_requests field', { check_suite_id: 1, workflow_id: 10, event: 'pull_request', head_branch: 'feat' }],
    ['a PR entry without a number', wf(1, 10, 'pull_request', 'feat', [pr('7')])],
    ['a PR entry without a base ref', wf(1, 10, 'pull_request', 'feat', [{ number: 7, base: null }])],
    ['a non-array pull_requests', wf(1, 10, 'pull_request', 'feat', pr(7))],
  ])('suiteProducers proves no producer for %s', (_label, entry) => {
    expect(suiteProducers({ workflow_runs: [entry] }).size).toBe(0);
  });

  test('suiteProducers skips an entry missing a field and drops a suite claimed by two different keys', () => {
    const map = suiteProducers({
      workflow_runs: [wf(1, undefined), wf('2', 10), wf(3, 10, null), wf(4, 10, 'pull_request', null), wf(5, 10), wf(5, 11), wf(6, 10), wf(6, 10), wf(5, 10)],
    });
    expect([...map.keys()]).toEqual([6]);
    expect(suiteProducers({ workflow_runs: [wf(7, 10), wf(7, 10, 'pull_request', 'feat', [pr(8)])] }).size).toBe(0);
  });

  test.each([[null], [[]], [{}], [{ workflow_runs: 'x' }], ['x']])('suiteProducers rejects the malformed payload %j', (payload) => {
    expect(() => suiteProducers(payload)).toThrow('workflow_runs');
  });

  test('mapRestCheckRun carries the run id, suite id, start time and the producer its suite resolves to', () => {
    const suites = suiteProducers({ workflow_runs: [wf(7, 10)] });
    const row = { id: 77, name: 'pr-lint', status: 'completed', conclusion: 'cancelled', started_at: '2026-11-20T11:29:49Z', check_suite: { id: 7 } };
    expect(mapRestCheckRun(row, suites)).toEqual({
      name: 'pr-lint',
      status: 'COMPLETED',
      conclusion: 'CANCELLED',
      runId: 77,
      suiteId: 7,
      startedAt: '2026-11-20T11:29:49Z',
      producer: 'actions:10:pull_request:feat:7:main',
    });
    expect(mapRestCheckRun(row)).toEqual({ name: 'pr-lint', status: 'COMPLETED', conclusion: 'CANCELLED', runId: 77, suiteId: 7, startedAt: '2026-11-20T11:29:49Z' });
    expect(mapRestCheckRun({ ...row, check_suite: { id: 8 } }, suites)).toEqual({ name: 'pr-lint', status: 'COMPLETED', conclusion: 'CANCELLED', runId: 77, suiteId: 8, startedAt: '2026-11-20T11:29:49Z' });
    expect(mapRestCheckRun({ ...row, check_suite: null }, suites)).toEqual({ name: 'pr-lint', status: 'COMPLETED', conclusion: 'CANCELLED', runId: 77, startedAt: '2026-11-20T11:29:49Z' });
  });

  test('mapRestStatus maps a commit status to name, status and conclusion only', () => {
    expect(mapRestStatus({ context: 'ci/legacy', state: 'success' })).toEqual({ name: 'ci/legacy', status: 'COMPLETED', conclusion: 'SUCCESS' });
    expect(mapRestStatus({ context: 'ci/legacy', state: 'error' })).toEqual({ name: 'ci/legacy', status: 'COMPLETED', conclusion: 'FAILURE' });
    expect(mapRestStatus({ context: 'ci/legacy', state: 'pending' })).toEqual({ name: 'ci/legacy', status: 'QUEUED', conclusion: null });
  });
});

describe('classifyUpdateBranchFailure', () => {
  test('reads the HTTP 422 reason from stderr; anything unrecognised stays FAILED', () => {
    expect(classifyUpdateBranchFailure('merge conflict between base and head (HTTP 422)')).toBe('CONFLICT');
    expect(classifyUpdateBranchFailure("expected head sha didn't match current head ref. (HTTP 422)")).toBe('STALE-HEAD');
    expect(classifyUpdateBranchFailure('merge conflict (HTTP 500)')).toBe('FAILED');
    expect(classifyUpdateBranchFailure('')).toBe('FAILED');
  });
});
