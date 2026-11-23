import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';
import { detectForCampaign, readRegistry, realDeps, recordedWorktree, run, sessionIdentity, type RegistryDeps } from './peer-campaigns.ts';

// Two worktrees of one throwaway clone: the registry must be shared through the git common dir.
// Every path is absolute and the CLI runs with cwd at the temp root, so nothing reaches this
// checkout's own git common dir.

const scriptPath = path.join(path.resolve(import.meta.dirname), 'peer-campaigns.ts');

let root: string;
let wt1: string;
let wt2: string;
let registry: string;

const git = (cwd: string, args: string[]) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** The host session id env var; unset unless a test passes one, so the outer session's id never leaks in. */
const HOST_ENV = 'CLAUDE_CODE_SESSION_ID';
/** The host process id env var. */
const PID_ENV = 'CLAUDE_PID';
const savedHostSession = process.env[HOST_ENV];
const savedPid = process.env[PID_ENV];
/** A pid whose process has exited. */
const deadPid = () => spawnSync('true').pid;

const cli = (args: string[], hostSession?: string, hostPid?: number) => {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env[HOST_ENV];
  delete env[PID_ENV];
  if (hostSession !== undefined) env[HOST_ENV] = hostSession;
  if (hostPid !== undefined) env[PID_ENV] = String(hostPid);
  const r = spawnSync('bun', ['run', scriptPath, ...args], { cwd: root, encoding: 'utf-8', env });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

const campaign = (wt: string) => path.join(wt, '.blackhole');
const writeJson = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};
const registryFiles = () => (fs.existsSync(registry) ? fs.readdirSync(registry).filter((f) => f.endsWith('.json')) : []);

beforeAll(() => {
  delete process.env[HOST_ENV];
  delete process.env[PID_ENV];
  root = makeTempDir('peer-campaigns');
  wt1 = path.join(root, 'main');
  wt2 = path.join(root, 'wt2');
  fs.mkdirSync(wt1);
  git(wt1, ['init', '-q', '-b', 'main']);
  git(wt1, ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  git(wt1, ['worktree', 'add', '-q', '-b', 'side', wt2]);
  registry = path.join(wt1, '.git', 'blackhole', 'campaigns');
  writeJson(path.join(campaign(wt1), 'queue.json'), {
    issues: {
      '10': { status: 'in-flight', pr: null },
      '11': { status: 'blocked', pr: 90 },
      '12': { status: 'ready', pr: null },
      '13': { status: 'merged', pr: 91 },
    },
  });
  fs.mkdirSync(campaign(wt2));
});

afterAll(() => {
  if (savedHostSession !== undefined) process.env[HOST_ENV] = savedHostSession;
  if (savedPid !== undefined) process.env[PID_ENV] = savedPid;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('peer-campaigns CLI', () => {
  test('an unknown subcommand exits 2 with usage', () => {
    const r = cli(['bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Usage:');
  });

  test('heartbeat without --turn exits 2', () => {
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt1)]).code).toBe(2);
  });

  test('detect is read-only: no registry and no token are created', () => {
    const r = cli(['detect', '--campaign-dir', campaign(wt2)]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ verdict: 'solo', reach: 'clone', unreadable: 0, unreadable_files: [], peers: [] });
    expect(fs.existsSync(registry)).toBe(false);
    expect(fs.existsSync(path.join(campaign(wt2), '.tmp', 'campaign-session.json'))).toBe(false);
  });

  test('a heartbeat in worktree 1 is a peer in worktree 2, with its claims', () => {
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '7']).code).toBe(0);
    const r = cli(['detect', '--campaign-dir', campaign(wt2)]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.verdict).toBe('peers');
    expect(out.reach).toBe('clone');
    expect(out.peers).toHaveLength(1);
    expect(out.peers[0]).toMatchObject({ worktree: fs.realpathSync(wt1), turn: 7, claims: [10, 11], role: 'solo' });
  });

  test('worktree 1 does not see its own record', () => {
    expect(JSON.parse(cli(['detect', '--campaign-dir', campaign(wt1)]).stdout).verdict).toBe('solo');
  });

  test('a second heartbeat from the same worktree rewrites the one file', () => {
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '8']).code).toBe(0);
    expect(registryFiles()).toHaveLength(1);
    const out = JSON.parse(cli(['detect', '--campaign-dir', campaign(wt2)]).stdout);
    expect(out.peers[0].turn).toBe(8);
  });

  test('a lost token reads the old record as superseded self and replaces it', () => {
    fs.rmSync(path.join(campaign(wt1), '.tmp', 'campaign-session.json'));
    expect(JSON.parse(cli(['detect', '--campaign-dir', campaign(wt1)]).stdout).verdict).toBe('solo');
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '9']).code).toBe(0);
    expect(registryFiles()).toHaveLength(1);
  });

  test('a peer naming my host_session as its manager reports names_me', () => {
    writeJson(path.join(campaign(wt1), 'config.json'), {
      usage_budget: { coordination: { role: 'peer', manager_session: 'session_wt2' } },
    });
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '10']).code).toBe(0);
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt2), '--turn', '1', '--host-session', 'session_wt2']).code).toBe(0);
    const out = JSON.parse(cli(['detect', '--campaign-dir', campaign(wt2)]).stdout);
    expect(out.peers[0]).toMatchObject({ role: 'peer', manager_session: 'session_wt2', names_me: true, coordinated: true });
    // A later heartbeat without --host-session keeps the recorded one.
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt2), '--turn', '2']).code).toBe(0);
    expect(JSON.parse(cli(['detect', '--campaign-dir', campaign(wt2)]).stdout).peers[0].names_me).toBe(true);
  });

  test('after release in worktree 1, worktree 2 is solo with reach clone', () => {
    expect(cli(['release', '--campaign-dir', campaign(wt1)]).code).toBe(0);
    expect(JSON.parse(cli(['detect', '--campaign-dir', campaign(wt2)]).stdout)).toEqual({ verdict: 'solo', reach: 'clone', unreadable: 0, unreadable_files: [], peers: [] });
  });

  test('two host sessions on one campaign dir keep two records and see each other', () => {
    const a = 'aaaaaaaa-1111-4000-8000-000000000001';
    const b = 'bbbbbbbb-2222-4000-8000-000000000002';
    const before = registryFiles();
    // Both host processes are alive: this test process and its parent.
    const [pa, pb] = [process.pid, process.ppid];
    const detectAs = (hostSession: string) => cli(['detect', '--campaign-dir', campaign(wt1)], hostSession, hostSession === a ? pa : pb);
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '3'], a, pa).code).toBe(0);
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '5'], b, pb).code).toBe(0);
    expect(registryFiles().filter((f) => !before.includes(f)).sort()).toEqual([`${a}.json`, `${b}.json`]);
    // Peers in this same worktree (worktree 2's session from the earlier tests is still live too).
    type Peer = { session: string; turn: number; worktree: string };
    const sameWorktree = (hostSession: string): [string, number][] =>
      (JSON.parse(detectAs(hostSession).stdout).peers as Peer[])
        .filter((p) => p.worktree === fs.realpathSync(wt1))
        .map((p) => [p.session, p.turn]);
    expect(JSON.parse(detectAs(a).stdout).verdict).toBe('peers');
    expect(sameWorktree(a)).toEqual([[b, 5]]);
    expect(sameWorktree(b)).toEqual([[a, 3]]);
    // A's next heartbeat keeps B's record and turn.
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '4'], a, pa).code).toBe(0);
    expect(sameWorktree(a)).toEqual([[b, 5]]);
    expect(cli(['release', '--campaign-dir', campaign(wt1)], a).code).toBe(0);
    expect(cli(['release', '--campaign-dir', campaign(wt1)], b).code).toBe(0);
    expect(registryFiles()).toEqual(before);
  });

  test("a new host session supersedes this campaign's last session once that host process is gone", () => {
    const a = 'aaaaaaaa-3333-4000-8000-000000000003';
    const b = 'bbbbbbbb-4444-4000-8000-000000000004';
    expect(cli(['release', '--campaign-dir', campaign(wt2)]).code).toBe(0);
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '6'], a, deadPid()).code).toBe(0);
    expect(registryFiles()).toEqual([`${a}.json`]);
    // Resumed in a new session (new id, new process): its own earlier record is not a peer.
    const solo = { verdict: 'solo', reach: 'clone', unreadable: 0, unreadable_files: [], peers: [] };
    expect(JSON.parse(cli(['detect', '--campaign-dir', campaign(wt1)], b, process.pid).stdout)).toEqual(solo);
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '0'], b, process.pid).code).toBe(0);
    expect(registryFiles()).toEqual([`${b}.json`]);
    expect(cli(['release', '--campaign-dir', campaign(wt1)], b, process.pid).code).toBe(0);
  });

  test('a new host session in the same host process (/clear) supersedes the earlier one', () => {
    const a = 'aaaaaaaa-5555-4000-8000-000000000005';
    const b = 'bbbbbbbb-6666-4000-8000-000000000006';
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '6'], a, process.pid).code).toBe(0);
    expect(JSON.parse(cli(['detect', '--campaign-dir', campaign(wt1)], b, process.pid).stdout).verdict).toBe('solo');
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '0'], b, process.pid).code).toBe(0);
    expect(registryFiles()).toEqual([`${b}.json`]);
    expect(cli(['release', '--campaign-dir', campaign(wt1)], b, process.pid).code).toBe(0);
  });

  test("a token-mode session never adopts a live host session's id, overwrites or releases its record", () => {
    const a = 'aaaaaaaa-9999-4000-8000-000000000009';
    const tokenFile = path.join(campaign(wt1), '.tmp', 'campaign-session.json');
    fs.rmSync(tokenFile, { force: true });
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '2'], a, process.pid).code).toBe(0);
    // A plain shell (no host session id) on the same campaign dir.
    expect(cli(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '1']).code).toBe(0);
    const token = JSON.parse(fs.readFileSync(tokenFile, 'utf-8')).session;
    expect(token).not.toBe(a);
    expect(registryFiles().sort()).toEqual([`${a}.json`, `${token}.json`].sort());
    expect(JSON.parse(fs.readFileSync(path.join(registry, `${a}.json`), 'utf-8'))).toMatchObject({ turn: 2, host_pid: process.pid });
    const peers = JSON.parse(cli(['detect', '--campaign-dir', campaign(wt1)]).stdout).peers.map((p: { session: string }) => p.session);
    expect(peers).toEqual([a]);
    expect(cli(['release', '--campaign-dir', campaign(wt1)]).code).toBe(0);
    expect(registryFiles()).toEqual([`${a}.json`]);
    expect(cli(['release', '--campaign-dir', campaign(wt1)], a, process.pid).code).toBe(0);
  });

  test('an unusable host session id warns on stderr and falls back to the campaign-dir token', () => {
    const r = cli(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '1'], 'not a session id!');
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('CLAUDE_CODE_SESSION_ID');
    const token = JSON.parse(fs.readFileSync(path.join(campaign(wt1), '.tmp', 'campaign-session.json'), 'utf-8')).session;
    expect(registryFiles()).toEqual([`${token}.json`]);
    expect(cli(['release', '--campaign-dir', campaign(wt1)]).code).toBe(0);
  });

  test('a campaign dir outside any git repo exits 1', () => {
    const outside = makeTempDir('peer-campaigns-nogit');
    try {
      const r = cli(['detect', '--campaign-dir', path.join(outside, '.blackhole')]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('git common dir');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('sessionIdentity', () => {
  const withHost = (id: string | null): RegistryDeps => ({ ...realDeps, hostSessionId: () => id });
  const tokenDir = () => {
    const dir = path.join(root, 'identity', '.blackhole');
    writeJson(path.join(dir, '.tmp', 'campaign-session.json'), { session: 'cccccccc-7777-4000-8000-000000000007' });
    return dir;
  };

  test('a valid host session id is the session id, host-scoped', () => {
    expect(sessionIdentity(tokenDir(), withHost('dddddddd-8888-4000-8000-000000000008'))).toEqual({
      session: 'dddddddd-8888-4000-8000-000000000008',
      hostScoped: true,
      warning: null,
    });
  });

  test('an invalid host session id falls back to the token, with a warning', () => {
    const id = sessionIdentity(tokenDir(), withHost('../etc/passwd'));
    expect(id).toMatchObject({ session: 'cccccccc-7777-4000-8000-000000000007', hostScoped: false });
    expect(id.warning).toContain('CLAUDE_CODE_SESSION_ID');
  });

  test('an absent host session id falls back to the token, silently', () => {
    expect(sessionIdentity(tokenDir(), withHost(null))).toEqual({ session: 'cccccccc-7777-4000-8000-000000000007', hostScoped: false, warning: null });
    expect(sessionIdentity(tokenDir(), withHost(''))).toEqual({ session: 'cccccccc-7777-4000-8000-000000000007', hostScoped: false, warning: null });
  });
});

describe('peer-campaigns in process, with injected deps', () => {
  test('an unresolvable git common dir is exit 1 and detection reads as not run', () => {
    const noGit: RegistryDeps = { ...realDeps, git: () => ({ status: 128, stdout: '' }) };
    expect(run(['detect', '--campaign-dir', campaign(wt2)], noGit)).toMatchObject({ code: 1 });
    expect(detectForCampaign(campaign(wt2), noGit)).toBeNull();
  });

  test('a heartbeat past the lease is not a peer; a fresh one is', () => {
    const at = (iso: string): RegistryDeps => ({ ...realDeps, nowMs: () => Date.parse(iso) });
    expect(run(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '20'], at('2026-11-18T10:00:00.000Z')).code).toBe(0);
    expect(detectForCampaign(campaign(wt2), at('2026-11-18T10:39:00.000Z'))?.verdict).toBe('peers');
    expect(detectForCampaign(campaign(wt2), at('2026-11-18T10:41:00.000Z'))?.verdict).toBe('solo');
    expect(run(['release', '--campaign-dir', campaign(wt1)]).out).toContain('removed');
    expect(run(['release', '--campaign-dir', campaign(wt1)]).out).toBe('Release: no record for this session.');
  });

  test('bad flags are usage errors', () => {
    expect(run(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '-1']).code).toBe(2);
    expect(run(['detect', '--turn', '3']).code).toBe(2);
    expect(run(['heartbeat', '--turn', '3', '--host-session', ' ']).code).toBe(2);
  });
});

describe('peer-campaigns fails closed on unreadable registry content', () => {
  const detectWt2 = () => JSON.parse(cli(['detect', '--campaign-dir', campaign(wt2)]).stdout);

  test('a fresh garbage record and a version-skewed record read as unknown, never solo', () => {
    fs.mkdirSync(registry, { recursive: true });
    const garbage = path.join(registry, 'garbage.json');
    const skewed = path.join(registry, 'b0000000-0000-4000-8000-000000000002.json');
    fs.writeFileSync(garbage, '{"version":1,');
    fs.writeFileSync(skewed, JSON.stringify({ version: 2, session: 'b0000000-0000-4000-8000-000000000002' }));
    try {
      expect(detectWt2()).toMatchObject({ verdict: 'unknown', unreadable: 2, peers: [] });
    } finally {
      fs.rmSync(garbage);
      fs.rmSync(skewed);
    }
  });

  test('an unreadable registry dir reads as unknown', () => {
    if (process.getuid?.() === 0) return; // root reads a 000 dir anyway
    fs.mkdirSync(registry, { recursive: true });
    fs.chmodSync(registry, 0o000);
    try {
      expect(detectWt2()).toMatchObject({ verdict: 'unknown', unreadable: 1 });
    } finally {
      fs.chmodSync(registry, 0o755);
    }
  });
});

describe('peer-campaigns: entries that are not plain record files', () => {
  const detectWt2 = () => JSON.parse(cli(['detect', '--campaign-dir', campaign(wt2)]).stdout);

  test('a directory named *.json and a dangling symlink are unreadable, and named', () => {
    fs.mkdirSync(registry, { recursive: true });
    const dir = path.join(registry, 'dir.json');
    const link = path.join(registry, 'link.json');
    fs.mkdirSync(dir);
    fs.symlinkSync(path.join(root, 'nowhere.json'), link);
    try {
      expect(detectWt2()).toMatchObject({ verdict: 'unknown', unreadable: 2, unreadable_files: ['dir.json', 'link.json'] });
    } finally {
      fs.rmSync(dir, { recursive: true });
      fs.rmSync(link);
    }
  });

  test('a directory named *.json lapses by its own mtime, like any record', () => {
    fs.mkdirSync(registry, { recursive: true });
    const dir = path.join(registry, 'stale-dir.json');
    fs.mkdirSync(dir);
    const old = new Date(Date.now() - 90 * 60_000);
    fs.utimesSync(dir, old, old);
    try {
      expect(detectWt2()).toMatchObject({ verdict: 'solo', unreadable: 0 });
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  test('a garbage file whose mtime is more than one lease ahead lapses', () => {
    fs.mkdirSync(registry, { recursive: true });
    const future = path.join(registry, 'future.json');
    fs.writeFileSync(future, 'garbage');
    const ahead = new Date(Date.now() + 120 * 60_000);
    fs.utimesSync(future, ahead, ahead);
    try {
      expect(detectWt2()).toMatchObject({ verdict: 'solo', unreadable: 0 });
    } finally {
      fs.rmSync(future);
    }
  });
});

describe('peer-campaigns: worktree paths', () => {
  test("a worktree under R&D/wt it's heartbeats and is seen by its peers", () => {
    const odd = path.join(root, 'R&D', "wt it's");
    fs.mkdirSync(path.dirname(odd), { recursive: true });
    git(wt1, ['worktree', 'add', '-q', '-b', 'odd', odd]);
    fs.mkdirSync(campaign(odd));
    try {
      expect(cli(['heartbeat', '--campaign-dir', campaign(odd), '--turn', '3']).code).toBe(0);
      const out = JSON.parse(cli(['detect', '--campaign-dir', campaign(wt2)]).stdout);
      expect(out.peers.map((p: { worktree: string }) => p.worktree)).toContain(fs.realpathSync(odd));
    } finally {
      cli(['release', '--campaign-dir', campaign(odd)]);
    }
  });

  test('a worktree path a peer could not read is refused at heartbeat, writing nothing', () => {
    const bad = path.join(root, 'cost$dir');
    git(wt1, ['worktree', 'add', '-q', '-b', 'bad', bad]);
    fs.mkdirSync(campaign(bad));
    const before = registryFiles().length;
    const r = cli(['heartbeat', '--campaign-dir', campaign(bad), '--turn', '1']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('cannot be recorded');
    expect(registryFiles()).toHaveLength(before);
  });
});

describe('peer-campaigns heartbeat write failure', () => {
  const asRoot = process.getuid?.() === 0;

  test.skipIf(asRoot)('an unwritable registry exits 1 with one line and no stack trace', () => {
    fs.mkdirSync(registry, { recursive: true });
    fs.chmodSync(registry, 0o555);
    try {
      const r = run(['heartbeat', '--campaign-dir', campaign(wt2), '--turn', '41']);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/^peer-campaigns: heartbeat could not be written \(EACCES\): .+campaigns$/);
      expect(r.err).not.toContain('\n');
      expect(r.err).not.toMatch(/^\s+at /m);
    } finally {
      fs.chmodSync(registry, 0o755);
    }
  });

  test('a non-filesystem error from the heartbeat still propagates', () => {
    const deps: RegistryDeps = { ...realDeps, hostname: () => { throw new TypeError('boom'); } };
    expect(() => run(['heartbeat', '--campaign-dir', campaign(wt2), '--turn', '42'], deps)).toThrow('boom');
  });
});

describe('peer-campaigns in process: refusal and lstat', () => {
  test('a host a peer could not read is refused with exit 1 and no record', () => {
    const before = registryFiles().length;
    const r = run(['heartbeat', '--campaign-dir', campaign(wt2), '--turn', '4'], { ...realDeps, hostname: () => 'box"$(id)' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('cannot be recorded');
    expect(registryFiles()).toHaveLength(before);
  });

  test("a first heartbeat mints this session's token, then release removes the record", () => {
    fs.rmSync(path.join(campaign(wt1), '.tmp', 'campaign-session.json'), { force: true });
    expect(run(['heartbeat', '--campaign-dir', campaign(wt1), '--turn', '30']).code).toBe(0);
    const token = JSON.parse(fs.readFileSync(path.join(campaign(wt1), '.tmp', 'campaign-session.json'), 'utf-8')).session;
    expect(registryFiles()).toContain(`${token}.json`);
    expect(run(['release', '--campaign-dir', campaign(wt1)]).out).toContain(token);
  });

  test('readRegistry lstats every entry: a dir and a dangling link have no text and keep their own mtime', () => {
    const reg = makeTempDir('peer-registry');
    try {
      fs.mkdirSync(path.join(reg, 'dir.json'));
      fs.symlinkSync(path.join(reg, 'missing'), path.join(reg, 'link.json'));
      fs.writeFileSync(path.join(reg, 'ok.json'), '{}');
      fs.writeFileSync(path.join(reg, 'ok.json.tmp'), '{}');
      const old = new Date(Date.now() - 90 * 60_000);
      fs.utimesSync(path.join(reg, 'dir.json'), old, old);
      const { entries, dirError } = readRegistry(reg);
      expect(dirError).toBe(false);
      const byName = Object.fromEntries(entries.map((e) => [e.file, e]));
      expect(Object.keys(byName).sort()).toEqual(['dir.json', 'link.json', 'ok.json']);
      expect(byName['dir.json'].text).toBeNull();
      expect(byName['dir.json'].mtimeMs).toBeLessThan(Date.now() - 80 * 60_000);
      expect(byName['link.json'].text).toBeNull();
      expect(byName['ok.json'].text).toBe('{}');
    } finally {
      fs.rmSync(reg, { recursive: true, force: true });
    }
  });

  test('an entry that lists but cannot be lstat-ed (EACCES) is unreadable and fresh, never skipped', () => {
    if (process.getuid?.() === 0) return; // root lstats through a 0444 dir anyway
    const reg = makeTempDir('peer-registry-noexec');
    fs.writeFileSync(path.join(reg, 'locked.json'), '{}');
    fs.chmodSync(reg, 0o444);
    try {
      expect(readRegistry(reg, 1_000_000)).toEqual({ entries: [{ file: 'locked.json', text: null, mtimeMs: 1_000_000 }], dirError: false });
    } finally {
      fs.chmodSync(reg, 0o755);
      fs.rmSync(reg, { recursive: true, force: true });
    }
  });

  test('a Windows worktree is recorded with forward slashes; a POSIX path is kept as is', () => {
    expect(recordedWorktree('C:\\Users\\me\\repo\\wt', '\\')).toBe('C:/Users/me/repo/wt');
    expect(recordedWorktree('/repo/odd\\name', '/')).toBe('/repo/odd\\name');
  });

  test('readRegistry reports an unlistable dir and an absent one apart', () => {
    expect(readRegistry(path.join(root, 'no-such-registry'))).toEqual({ entries: [], dirError: false });
    if (process.getuid?.() === 0) return;
    const reg = makeTempDir('peer-registry-locked');
    fs.chmodSync(reg, 0o000);
    try {
      expect(readRegistry(reg).dirError).toBe(true);
    } finally {
      fs.chmodSync(reg, 0o755);
      fs.rmSync(reg, { recursive: true, force: true });
    }
  });
});
