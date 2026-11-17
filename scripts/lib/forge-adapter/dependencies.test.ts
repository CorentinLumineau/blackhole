import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'child_process';
import {
  isUnavailable,
  parseBodyRefs,
  readDependencies,
  refKey,
  writeBodyRefs,
  writeDependencies,
  type BodyChannel,
  type NativeDependencyChannel,
  type NativeEdge,
} from './dependencies.ts';
import * as glabCli from './glab-cli.ts';
import { GitHubForgeAdapter } from './github.ts';
import { GiteaForgeAdapter } from './gitea.ts';
import { GitLabForgeAdapter } from './gitlab.ts';
import * as teaCli from './tea-cli.ts';
import type { DependencyRef } from './types.ts';

const REPO = 'acme/app';
const issue = (number: number, repo = REPO): DependencyRef => ({ repo, number, kind: 'issue' });
const pr = (number: number, repo = REPO): DependencyRef => ({ repo, number, kind: 'pr' });

describe('refKey', () => {
  test('GitHub and Gitea share one number sequence, so kind does not change the key', () => {
    expect(refKey(issue(4), 'github')).toBe(refKey(pr(4), 'github'));
    expect(refKey(pr(4), 'gitea')).toBe('acme/app#4');
  });

  test('GitLab numbers issues and merge requests apart', () => {
    expect(refKey(issue(4), 'gitlab')).toBe('acme/app#4');
    expect(refKey(pr(4), 'gitlab')).toBe('acme/app!4');
  });
});

describe('PR body dependency lines', () => {
  test('reads same-repo, cross-repo and alias lines; ignores Part of and Closes', () => {
    const body = 'Closes #9\nPart of #1\n\n## Dependencies\nBlocked by #11\nDepends on other/lib#185\nAfter #12 merges\n';
    expect(parseBodyRefs(body, REPO, 'github')).toEqual([issue(11), issue(185, 'other/lib'), issue(12)]);
  });

  test('GitLab reads `!N` as a merge request and allows a nested group path', () => {
    const body = 'Blocked by !7\nBlocked by #8\nBlocked by group/sub/proj!3';
    expect(parseBodyRefs(body, 'group/app', 'gitlab')).toEqual([pr(7, 'group/app'), issue(8, 'group/app'), pr(3, 'group/sub/proj')]);
  });

  test('GitHub ignores a three-segment repo path, as the issue-body parser does', () => {
    expect(parseBodyRefs('Depends on acme/workflows/extra#3', REPO, 'github')).toEqual([]);
  });

  test('writes canonical lines under ## Dependencies and keeps every other line', () => {
    const body = 'Closes #9\n\n## Dependencies\nDepends on #11\nWhy: shared schema.\n\n## Notes\nx';
    const out = writeBodyRefs(body, [pr(12), pr(185, 'other/lib')], REPO, 'github');
    expect(out).toBe('Closes #9\n\n## Dependencies\nBlocked by #12\nBlocked by other/lib#185\nWhy: shared schema.\n\n## Notes\nx');
    expect(parseBodyRefs(out, REPO, 'github').map((r) => refKey(r, 'github'))).toEqual(['acme/app#12', 'other/lib#185']);
  });

  test('GitLab writes a merge request as `!N`', () => {
    expect(writeBodyRefs('', [pr(7, 'group/app')], 'group/app', 'gitlab')).toBe('## Dependencies\nBlocked by !7');
  });

  test('an empty set removes every dependency line', () => {
    expect(writeBodyRefs('Closes #9\n\n## Dependencies\nBlocked by #11', [], REPO, 'github')).toBe('Closes #9\n\n## Dependencies');
  });
});

const T = { issue: 9, pr: 5 };
const native = (r: DependencyRef): DependencyRef => ({ ...r, via: 'native' });
const body = (r: DependencyRef): DependencyRef => ({ ...r, via: 'body' });

/** An in-memory forge: native edges of one target (native: false = no native feature) and its PR body. */
function fakeForge(opts: { native: boolean; holds?: (ref: DependencyRef) => boolean; edges?: DependencyRef[]; body?: string }) {
  const log: string[] = [];
  let edges: NativeEdge[] = (opts.edges ?? []).map((ref, i) => ({ ref, handle: i + 100 }));
  let text = opts.body ?? 'Closes #9';
  const channel: NativeDependencyChannel = {
    list: () => (opts.native ? edges : null),
    holds: opts.holds ?? (() => true),
    add: (_t, ref) => {
      log.push(`add ${refKey(ref, 'github')}`);
      edges = [...edges, { ref: { repo: ref.repo, number: ref.number, kind: ref.kind }, handle: edges.length + 200 }];
    },
    remove: (_t, edge) => {
      log.push(`remove ${refKey(edge.ref, 'github')}`);
      edges = edges.filter((e) => e.handle !== edge.handle);
    },
  };
  const bodies: BodyChannel = {
    read: () => text,
    write: (_pr, next) => {
      log.push('write body');
      text = next;
    },
  };
  return { channel, bodies, log, body: () => text };
}

describe('readDependencies / writeDependencies', () => {
  test('the read is native edges plus body lines, each once, each tagged with its channel', () => {
    const f = fakeForge({ native: true, edges: [issue(12)], body: 'Blocked by #12\nBlocked by #13' });
    expect(readDependencies('github', REPO, T, f.channel, f.bodies)).toEqual({ native: true, blockedBy: [native(issue(12)), body(issue(13))] });
  });

  test('native edges are added and removed to match the set, and stray body lines are cleared', () => {
    const f = fakeForge({ native: true, edges: [issue(12)], body: 'Closes #9\nBlocked by #13' });
    const after = writeDependencies('github', REPO, T, [issue(14)], f.channel, f.bodies);
    expect(f.log).toEqual(['remove acme/app#12', 'add acme/app#14', 'write body']);
    expect(after).toEqual({ native: true, blockedBy: [native(issue(14))] });
    expect(f.body()).toBe('Closes #9');
  });

  test('a second write of the same set writes nothing', () => {
    const f = fakeForge({ native: true, edges: [issue(14)] });
    writeDependencies('github', REPO, T, [issue(14), issue(14)], f.channel, f.bodies);
    expect(f.log).toEqual([]);
  });

  test('without a native feature every edge is a body line', () => {
    const f = fakeForge({ native: false });
    const after = writeDependencies('github', REPO, T, [issue(12)], f.channel, f.bodies);
    expect(f.body()).toBe('Closes #9\n\n## Dependencies\nBlocked by #12');
    expect(after).toEqual({ native: false, blockedBy: [body(issue(12))] });
  });

  test('an edge the native channel cannot hold goes to the body; an edge read from a channel stays in it', () => {
    const f = fakeForge({ native: true, holds: (r) => r.kind === 'issue', edges: [issue(4, 'other/lib')] });
    writeDependencies('github', REPO, T, [issue(3), pr(8), native(issue(4, 'other/lib'))], f.channel, f.bodies);
    expect(f.log).toEqual(['add acme/app#3', 'write body']);
    expect(f.body()).toBe('Closes #9\n\n## Dependencies\nBlocked by #8');
  });
});

describe('isUnavailable', () => {
  test('404 and 410 mean no such feature; a 403 (rate limit, token scope) does not', () => {
    expect(isUnavailable('gh: Not Found (HTTP 404)')).toBe(true);
    expect(isUnavailable('tea api GET x failed: HTTP 410')).toBe(true);
    expect(isUnavailable('gh: API rate limit exceeded (HTTP 403)')).toBe(false);
  });
});

// ---- Backends: each test drives the real adapter against a recorded forge (fixture replies). ----

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
});

describe('GitHub getDependencies / setDependencies (REST)', () => {
  /**
   * A GitHub repo as the REST API behaves: issues 9, 12 and 13, pull requests 5 and 20. blocked_by
   * joins issues only: on a PR, or with a PR as the blocker, it answers 422 "Source issue may only
   * be an issue". `mode` 404 is a repo without the feature, 403 a rate limit.
   */
  function github(mode: 'ok' | '404' | '403' = 'ok') {
    const calls: string[] = [];
    const ISSUES: Record<number, { id: number; pull_request?: unknown }> = { 9: { id: 909 }, 12: { id: 912 }, 13: { id: 913 }, 5: { id: 905, pull_request: {} }, 20: { id: 920, pull_request: {} } };
    const byId = (id: number) => Number(Object.entries(ISSUES).find(([, v]) => v.id === id)![0]);
    let blockers: number[] = [12];
    let text = 'Closes #9';
    spies.push(
      spyOn(childProcess, 'spawnSync').mockImplementation((_cmd, args, options) => {
        const [, , method, endpoint] = args as string[];
        const input = (options as { input?: string } | undefined)?.input;
        calls.push(`${method} ${endpoint}${input ? ` ${input}` : ''}`);
        const ok = (stdout: unknown) => ({ status: 0, stdout: JSON.stringify(stdout), stderr: '' }) as never;
        const fail = (stderr: string) => ({ status: 1, stdout: '', stderr }) as never;
        const dep = endpoint.match(/^repos\/o\/r\/issues\/(\d+)\/dependencies\/blocked_by/);
        if (dep) {
          if (mode === '404') return fail('gh: Not Found (HTTP 404)');
          if (mode === '403') return fail('gh: API rate limit exceeded (HTTP 403)');
          if (ISSUES[Number(dep[1])]?.pull_request) return fail('gh: Validation Failed: Source issue may only be an issue (HTTP 422)');
          if (method === 'GET') return ok(blockers.map((n) => ({ id: ISSUES[n]!.id, number: n, repository_url: 'https://api.github.com/repos/o/r' })));
          if (method === 'POST') {
            const n = byId(JSON.parse(input!).issue_id);
            if (ISSUES[n]?.pull_request) return fail('gh: Validation Failed: Source issue may only be an issue (HTTP 422)');
            blockers = [...blockers, n];
          }
          if (method === 'DELETE') blockers = blockers.filter((n) => !endpoint.endsWith(`/${ISSUES[n]!.id}`));
          return ok(null);
        }
        const one = endpoint.match(/^repos\/o\/r\/issues\/(\d+)$/);
        if (one) return ok({ number: Number(one[1]), ...ISSUES[Number(one[1])] });
        if (endpoint === 'repos/o/r/pulls/5') {
          if (method === 'PATCH') text = JSON.parse(input!).body;
          return ok({ number: 5, title: 'p', body: text, head: { ref: 'f', sha: 's' }, state: 'open', merged_at: null });
        }
        throw new Error(`unexpected gh api ${method} ${endpoint}`);
      }),
    );
    return { calls, body: () => text };
  }
  const gh = () => new GitHubForgeAdapter('o/r');

  test('reads blocked_by on the ISSUE, not on its PR', async () => {
    const f = github();
    expect(await gh().getDependencies({ issue: 9, pr: 5 })).toEqual({ native: true, blockedBy: [native(issue(12, 'o/r'))] });
    expect(f.calls[0]).toBe('GET repos/o/r/issues/9/dependencies/blocked_by?per_page=100&page=1');
  });

  test('the fixture refuses a PR-sourced edge with 422, as GitHub does', async () => {
    github();
    await expect(gh().getDependencies({ issue: 5, pr: 5 })).rejects.toThrow('Source issue may only be an issue');
  });

  test('issue 9 blocked by issue 13: DELETE and POST on the issue, posting the blocker issue id', async () => {
    const f = github();
    const after = await gh().setDependencies({ issue: 9, pr: 5 }, [issue(13, 'o/r')]);
    expect(f.calls).toContain('DELETE repos/o/r/issues/9/dependencies/blocked_by/912');
    expect(f.calls).toContain('POST repos/o/r/issues/9/dependencies/blocked_by {"issue_id":913}');
    expect(f.calls.some((c) => c.includes('issues/5/dependencies'))).toBe(false);
    expect(after).toEqual({ native: true, blockedBy: [native(issue(13, 'o/r'))] });
  });

  test('a PR blocker, a cross-repo blocker and a PR with no queue issue are PR-body lines', async () => {
    const f = github();
    await gh().setDependencies({ issue: 9, pr: 5 }, [issue(12, 'o/r'), pr(20, 'o/r'), pr(185, 'other/lib')]);
    expect(f.body()).toBe('Closes #9\n\n## Dependencies\nBlocked by #20\nBlocked by other/lib#185');
    expect(f.calls.some((c) => c.startsWith('POST'))).toBe(false);
    const f2 = github();
    await gh().setDependencies({ issue: null, pr: 5 }, [issue(12, 'o/r')]);
    expect(f2.calls.some((c) => c.includes('/dependencies/'))).toBe(false);
    expect(f2.body()).toContain('Blocked by #12');
  });

  test('a repo without the feature (404) gets body lines, and the read says native: false', async () => {
    const f = github('404');
    const after = await gh().setDependencies({ issue: 9, pr: 5 }, [issue(12, 'o/r')]);
    expect(f.body()).toBe('Closes #9\n\n## Dependencies\nBlocked by #12');
    expect(after).toEqual({ native: false, blockedBy: [body(issue(12, 'o/r'))] });
  });

  test('a 403 fails loudly and never switches to body lines', async () => {
    const f = github('403');
    await expect(gh().setDependencies({ issue: 9, pr: 5 }, [issue(12, 'o/r')])).rejects.toThrow('HTTP 403');
    expect(f.body()).toBe('Closes #9');
  });
});

describe('Gitea getDependencies / setDependencies (tea api)', () => {
  function gitea(mode: 'ok' | '404' | '403' = 'ok') {
    const calls: string[] = [];
    let blockers = [{ number: 12, pull_request: null, repository: { full_name: 'owner/repo' } }];
    let text = 'Closes #9';
    spies.push(
      spyOn(teaCli, 'runTea').mockImplementation((argv: string[]) => {
        const method = argv[3];
        const endpoint = argv[4];
        const data = argv[5] === '-d' ? argv[6] : undefined;
        calls.push(`${method} ${endpoint}${data ? ` ${data}` : ''}`);
        const ok = (stdout: unknown) => ({ status: 0, stdout: JSON.stringify(stdout), stderr: 'HTTP/1.1 200 OK\n', error: null });
        if (endpoint.startsWith('repos/owner/repo/issues/9/dependencies')) {
          if (mode !== 'ok') return { status: 0, stdout: '{"message":"x"}', stderr: `HTTP/1.1 ${mode} X\n`, error: null };
          const meta = data ? JSON.parse(data) : null;
          if (method === 'DELETE') blockers = blockers.filter((b) => b.number !== meta.index);
          if (method === 'POST') blockers = [...blockers, { number: meta.index, pull_request: null, repository: { full_name: `${meta.owner}/${meta.repo}` } }];
          return ok(method === 'GET' ? blockers : null);
        }
        if (endpoint === 'repos/owner/repo/pulls/5') {
          if (method === 'PATCH') text = JSON.parse(data!).body;
          return ok({ number: 5, title: 'p', body: text, head: { ref: 'f', sha: 's' }, base: { ref: 'main' } });
        }
        throw new Error(`unexpected tea api ${method} ${endpoint}`);
      }),
    );
    return { calls, body: () => text };
  }
  const tea = () => new GiteaForgeAdapter('host/owner/repo');

  test('reads the issue dependencies with the host stripped from the repo', async () => {
    gitea();
    expect(await tea().getDependencies({ issue: 9, pr: 5 })).toEqual({ native: true, blockedBy: [native(issue(12, 'owner/repo'))] });
  });

  test('adds and removes on the issue by owner, repo and index', async () => {
    const f = gitea();
    const after = await tea().setDependencies({ issue: 9, pr: 5 }, [issue(30, 'owner/repo')]);
    expect(f.calls).toContain('DELETE repos/owner/repo/issues/9/dependencies {"owner":"owner","repo":"repo","index":12}');
    expect(f.calls).toContain('POST repos/owner/repo/issues/9/dependencies {"owner":"owner","repo":"repo","index":30}');
    expect(after.blockedBy).toEqual([native(issue(30, 'owner/repo'))]);
  });

  test('dependencies turned off (404) fall back to body lines; a 403 throws', async () => {
    const f = gitea('404');
    await tea().setDependencies({ issue: 9, pr: 5 }, [issue(12, 'owner/repo'), pr(4, 'other/lib')]);
    expect(f.body()).toBe('Closes #9\n\n## Dependencies\nBlocked by #12\nBlocked by other/lib#4');
    spies.pop()!.mockRestore();
    gitea('403');
    await expect(tea().getDependencies({ issue: 9, pr: 5 })).rejects.toThrow('HTTP 403');
  });
});

describe('GitLab getDependencies / setDependencies (glab api)', () => {
  function gitlab(mode: 'ok' | '404' | '403' = 'ok') {
    const calls: string[] = [];
    let blocks = [{ id: 81, blocking_merge_request: { iid: 12, references: { full: 'group/app!12' } } }];
    let text = 'Closes #9';
    spies.push(
      spyOn(glabCli, 'runGlabText').mockImplementation((args: string[]) => {
        calls.push(args.join(' '));
        if (args[0] === 'mr' && args[1] === 'update') {
          text = args[args.indexOf('--description') + 1];
          return '';
        }
        const [, endpoint, , method] = args;
        if (endpoint.startsWith('projects/group%2Fapp/merge_requests/5/blocks')) {
          if (mode !== 'ok') throw new Error(`glab: (HTTP ${mode})`);
          if (method === 'DELETE') blocks = blocks.filter((b) => !endpoint.endsWith(`/${b.id}`));
          if (method === 'POST') blocks = [...blocks, { id: 90, blocking_merge_request: { iid: 7, references: { full: 'group/app!7' } } }];
          return JSON.stringify(method === 'GET' ? blocks : {});
        }
        if (endpoint === 'projects/group%2Fapp/merge_requests/7') return JSON.stringify({ id: 4007, iid: 7 });
        throw new Error(`unexpected glab ${args.join(' ')}`);
      }),
      spyOn(glabCli, 'runGlabJson').mockImplementation(() => ({ iid: 5, title: 'm', description: text, state: 'opened' })),
    );
    return { calls, body: () => text };
  }
  const glab = () => new GitLabForgeAdapter('group/app');

  test('reads blocking merge requests of the MR', async () => {
    gitlab();
    expect(await glab().getDependencies({ issue: 9, pr: 5 })).toEqual({ native: true, blockedBy: [native(pr(12, 'group/app'))] });
  });

  test('a merge request blocker is native (by global id); an issue blocker is a body line', async () => {
    const f = gitlab();
    const after = await glab().setDependencies({ issue: 9, pr: 5 }, [pr(7, 'group/app'), issue(3, 'group/app')]);
    expect(f.calls).toContain('api projects/group%2Fapp/merge_requests/5/blocks/81 --method DELETE');
    expect(f.calls).toContain('api projects/group%2Fapp/merge_requests/5/blocks?blocking_merge_request_id=4007 --method POST');
    expect(f.body()).toBe('Closes #9\n\n## Dependencies\nBlocked by #3');
    expect(after.blockedBy).toEqual([native(pr(7, 'group/app')), body(issue(3, 'group/app'))]);
  });

  test('a project without the feature (404) writes `!N` body lines', async () => {
    const f = gitlab('404');
    const after = await glab().setDependencies({ issue: 9, pr: 5 }, [pr(12, 'group/app')]);
    expect(f.body()).toBe('Closes #9\n\n## Dependencies\nBlocked by !12');
    expect(after).toEqual({ native: false, blockedBy: [body(pr(12, 'group/app'))] });
  });

  test('a 403 fails loudly and writes no body line', async () => {
    const f = gitlab('403');
    await expect(glab().setDependencies({ issue: 9, pr: 5 }, [pr(12, 'group/app')])).rejects.toThrow('HTTP 403');
    expect(f.body()).toBe('Closes #9');
  });
});
