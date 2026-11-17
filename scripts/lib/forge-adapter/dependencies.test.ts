import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as childProcess from 'child_process';
import {
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

/** An in-memory forge: native edges of one PR (native: false = no native feature) and its body. */
function fakeForge(opts: { native: boolean; holds?: (ref: DependencyRef) => boolean; edges?: DependencyRef[]; body?: string }) {
  const log: string[] = [];
  let edges: NativeEdge[] = (opts.edges ?? []).map((ref, i) => ({ ref, handle: i + 100 }));
  let body = opts.body ?? 'Closes #9';
  const native: NativeDependencyChannel = {
    list: () => (opts.native ? edges : null),
    holds: opts.holds ?? (() => true),
    add: (_pr, ref) => {
      log.push(`add ${refKey(ref, 'github')}`);
      edges = [...edges, { ref, handle: edges.length + 200 }];
    },
    remove: (_pr, edge) => {
      log.push(`remove ${refKey(edge.ref, 'github')}`);
      edges = edges.filter((e) => e.handle !== edge.handle);
    },
  };
  const bodies: BodyChannel = {
    read: () => body,
    write: (_pr, next) => {
      log.push('write body');
      body = next;
    },
  };
  return { native, bodies, log, body: () => body };
}

describe('readDependencies / writeDependencies', () => {
  test('the read is native edges plus body lines, each once', () => {
    const f = fakeForge({ native: true, edges: [pr(12)], body: 'Blocked by #12\nBlocked by #13' });
    expect(readDependencies('github', REPO, 5, f.native, f.bodies)).toEqual({ native: true, blockedBy: [pr(12), issue(13)] });
  });

  test('native edges are added and removed to match the set, and stray body lines are cleared', () => {
    const f = fakeForge({ native: true, edges: [pr(12)], body: 'Closes #9\nBlocked by #13' });
    const after = writeDependencies('github', REPO, 5, [pr(14)], f.native, f.bodies);
    expect(f.log).toEqual(['remove acme/app#12', 'add acme/app#14', 'write body']);
    expect(after).toEqual({ native: true, blockedBy: [pr(14)] });
    expect(f.body()).toBe('Closes #9');
  });

  test('a second write of the same set writes nothing', () => {
    const f = fakeForge({ native: true, edges: [pr(14)] });
    writeDependencies('github', REPO, 5, [pr(14), pr(14)], f.native, f.bodies);
    expect(f.log).toEqual([]);
  });

  test('without a native feature every edge is a body line', () => {
    const f = fakeForge({ native: false });
    const after = writeDependencies('github', REPO, 5, [pr(12)], f.native, f.bodies);
    expect(f.body()).toBe('Closes #9\n\n## Dependencies\nBlocked by #12');
    expect(after).toEqual({ native: false, blockedBy: [issue(12)] });
  });

  test('an edge the native feature cannot hold goes to the body (GitLab issue blockers)', () => {
    const f = fakeForge({ native: true, holds: (r) => r.kind === 'pr' });
    writeDependencies('gitlab', REPO, 5, [pr(3), issue(8)], f.native, f.bodies);
    expect(f.log).toEqual(['add acme/app#3', 'write body']);
    expect(f.body()).toBe('Closes #9\n\n## Dependencies\nBlocked by #8');
  });
});

// ---- Backends: each test drives the real adapter against a recorded forge (fixture replies). ----

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
});

describe('GitHub getDependencies / setDependencies (REST)', () => {
  /** A forge holding PR #5's blockers by global id and its body; `native: false` answers 404. */
  function github(native: boolean) {
    const calls: string[] = [];
    let blockers = [{ id: 912, number: 12, pull_request: { url: 'x' }, repository_url: 'https://api.github.com/repos/o/r' }];
    let body = 'Closes #9';
    spies.push(
      spyOn(childProcess, 'spawnSync').mockImplementation((_cmd, args, options) => {
        const [, , method, endpoint] = args as string[];
        const input = (options as { input?: string } | undefined)?.input;
        calls.push(`${method} ${endpoint}${input ? ` ${input}` : ''}`);
        const ok = (stdout: unknown) => ({ status: 0, stdout: JSON.stringify(stdout), stderr: '' }) as never;
        if (endpoint.startsWith('repos/o/r/issues/5/dependencies/blocked_by')) {
          if (!native) return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' } as never;
          if (method === 'GET') return ok(blockers);
          if (method === 'DELETE') blockers = blockers.filter((b) => !endpoint.endsWith(`/${b.id}`));
          if (method === 'POST') blockers = [...blockers, { id: JSON.parse(input!).issue_id, number: 13, pull_request: { url: 'y' }, repository_url: 'https://api.github.com/repos/other/lib' }];
          return ok(null);
        }
        if (endpoint === 'repos/other/lib/issues/13') return ok({ id: 7013, number: 13 });
        if (endpoint === 'repos/o/r/pulls/5') {
          if (method === 'PATCH') body = JSON.parse(input!).body;
          return ok({ number: 5, title: 'p', body, head: { ref: 'f', sha: 's' }, state: 'open', merged_at: null });
        }
        throw new Error(`unexpected gh api ${method} ${endpoint}`);
      }),
    );
    return { calls, body: () => body };
  }

  test('reads native blocked_by rows with their repo and kind', async () => {
    github(true);
    expect(await new GitHubForgeAdapter('o/r').getDependencies(5)).toEqual({ native: true, blockedBy: [pr(12, 'o/r')] });
  });

  test('replaces the set: DELETE by global id, POST with the blocker issue_id, body untouched', async () => {
    const f = github(true);
    const after = await new GitHubForgeAdapter('o/r').setDependencies(5, [pr(13, 'other/lib')]);
    expect(after).toEqual({ native: true, blockedBy: [pr(13, 'other/lib')] });
    expect(f.calls).toContain('DELETE repos/o/r/issues/5/dependencies/blocked_by/912');
    expect(f.calls).toContain('POST repos/o/r/issues/5/dependencies/blocked_by {"issue_id":7013}');
    expect(f.calls.some((c) => c.startsWith('PATCH'))).toBe(false);
  });

  test('a repo without the endpoint (404) gets a `Blocked by #N` line in the PR body', async () => {
    const f = github(false);
    const after = await new GitHubForgeAdapter('o/r').setDependencies(5, [pr(12, 'o/r')]);
    expect(f.body()).toBe('Closes #9\n\n## Dependencies\nBlocked by #12');
    expect(after).toEqual({ native: false, blockedBy: [issue(12, 'o/r')] });
  });

  test('a failure other than a missing endpoint throws rather than reading as no blockers', async () => {
    spies.push(spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 1, stdout: '', stderr: 'gh: Bad credentials (HTTP 401)' } as never));
    await expect(new GitHubForgeAdapter('o/r').getDependencies(5)).rejects.toThrow('HTTP 401');
  });
});

describe('Gitea getDependencies / setDependencies (tea api)', () => {
  function gitea(native: boolean) {
    const calls: string[] = [];
    let blockers = [{ number: 12, pull_request: { merged: false }, repository: { full_name: 'owner/repo' } }];
    let body = 'Closes #9';
    spies.push(
      spyOn(teaCli, 'runTea').mockImplementation((argv: string[]) => {
        const method = argv[3];
        const endpoint = argv[4];
        const data = argv[5] === '-d' ? argv[6] : undefined;
        calls.push(`${method} ${endpoint}${data ? ` ${data}` : ''}`);
        const ok = (stdout: unknown) => ({ status: 0, stdout: JSON.stringify(stdout), stderr: 'HTTP/1.1 200 OK\n', error: null });
        if (endpoint.startsWith('repos/owner/repo/issues/5/dependencies')) {
          if (!native) return { status: 0, stdout: '{"message":"not found"}', stderr: 'HTTP/1.1 404 Not Found\n', error: null };
          const meta = data ? JSON.parse(data) : null;
          if (method === 'DELETE') blockers = blockers.filter((b) => b.number !== meta.index);
          if (method === 'POST') blockers = [...blockers, { number: meta.index, pull_request: null, repository: { full_name: `${meta.owner}/${meta.repo}` } }];
          return ok(method === 'GET' ? blockers : null);
        }
        if (endpoint === 'repos/owner/repo/pulls/5') {
          if (method === 'PATCH') body = JSON.parse(data!).body;
          return ok({ number: 5, title: 'p', body, head: { ref: 'f', sha: 's' }, base: { ref: 'main' } });
        }
        throw new Error(`unexpected tea api ${method} ${endpoint}`);
      }),
    );
    return { calls, body: () => body };
  }

  test('strips the host from the repo and reads dependency rows', async () => {
    gitea(true);
    expect(await new GiteaForgeAdapter('host/owner/repo').getDependencies(5)).toEqual({ native: true, blockedBy: [pr(12, 'owner/repo')] });
  });

  test('adds and removes by owner, repo and index', async () => {
    const f = gitea(true);
    const after = await new GiteaForgeAdapter('host/owner/repo').setDependencies(5, [issue(30, 'owner/repo')]);
    expect(f.calls).toContain('DELETE repos/owner/repo/issues/5/dependencies {"owner":"owner","repo":"repo","index":12}');
    expect(f.calls).toContain('POST repos/owner/repo/issues/5/dependencies {"owner":"owner","repo":"repo","index":30}');
    expect(after.blockedBy).toEqual([issue(30, 'owner/repo')]);
  });

  test('dependencies turned off (404) fall back to body lines', async () => {
    const f = gitea(false);
    await new GiteaForgeAdapter('host/owner/repo').setDependencies(5, [pr(12, 'owner/repo'), pr(4, 'other/lib')]);
    expect(f.body()).toBe('Closes #9\n\n## Dependencies\nBlocked by #12\nBlocked by other/lib#4');
  });
});

describe('GitLab getDependencies / setDependencies (glab api)', () => {
  function gitlab(native: boolean) {
    const calls: string[] = [];
    let blocks = [{ id: 81, blocking_merge_request: { iid: 12, references: { full: 'group/app!12' } } }];
    let body = 'Closes #9';
    spies.push(
      spyOn(glabCli, 'runGlabText').mockImplementation((args: string[]) => {
        calls.push(args.join(' '));
        if (args[0] === 'mr' && args[1] === 'update') {
          body = args[args.indexOf('--description') + 1];
          return '';
        }
        const [, endpoint, , method] = args;
        if (endpoint.startsWith('projects/group%2Fapp/merge_requests/5/blocks')) {
          if (!native) throw new Error('glab: 403 Forbidden (HTTP 403)');
          if (method === 'DELETE') blocks = blocks.filter((b) => !endpoint.endsWith(`/${b.id}`));
          if (method === 'POST') blocks = [...blocks, { id: 90, blocking_merge_request: { iid: 7, references: { full: 'group/lib!7' } } }];
          return JSON.stringify(method === 'GET' ? blocks : {});
        }
        if (endpoint === 'projects/group%2Flib/merge_requests/7') return JSON.stringify({ id: 4007, iid: 7 });
        throw new Error(`unexpected glab ${args.join(' ')}`);
      }),
      spyOn(glabCli, 'runGlabJson').mockImplementation(() => ({ iid: 5, title: 'm', description: body, state: 'opened' })),
    );
    return { calls, body: () => body };
  }

  test('reads blocking merge requests with their project path', async () => {
    gitlab(true);
    expect(await new GitLabForgeAdapter('group/app').getDependencies(5)).toEqual({ native: true, blockedBy: [pr(12, 'group/app')] });
  });

  test('a merge request blocker is native (by global id); an issue blocker is a body line', async () => {
    const f = gitlab(true);
    const after = await new GitLabForgeAdapter('group/app').setDependencies(5, [pr(7, 'group/lib'), issue(3, 'group/app')]);
    expect(f.calls).toContain('api projects/group%2Fapp/merge_requests/5/blocks/81 --method DELETE');
    expect(f.calls).toContain('api projects/group%2Fapp/merge_requests/5/blocks?blocking_merge_request_id=4007 --method POST');
    expect(f.body()).toBe('Closes #9\n\n## Dependencies\nBlocked by #3');
    expect(after.blockedBy).toEqual([pr(7, 'group/lib'), issue(3, 'group/app')]);
  });

  test('a plan without merge request dependencies (403) writes `!N` body lines', async () => {
    const f = gitlab(false);
    const after = await new GitLabForgeAdapter('group/app').setDependencies(5, [pr(12, 'group/app')]);
    expect(f.body()).toBe('Closes #9\n\n## Dependencies\nBlocked by !12');
    expect(after).toEqual({ native: false, blockedBy: [pr(12, 'group/app')] });
  });
});
