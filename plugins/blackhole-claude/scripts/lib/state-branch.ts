import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Branch state store (ADR-049). On a machine whose disk does not outlive the session, campaign
// state is committed to a dedicated branch at each turn end and restored from it on resume. The
// commit is built with plumbing against a throwaway index, so the working tree, the real index
// and the checked-out branch are never touched.

export const STATE_BRANCH = 'blackhole/state';
export const STATE_DIR = '.blackhole';

/** Scratch and machine-local material that must not travel: rotation snapshots, hook-event
 * inboxes, write intermediates, and signals that describe this machine (each is re-derived on
 * the next one). Everything else under `.blackhole/` is campaign state. */
const EXCLUDED_DIRS = new Set(['.tmp', 'hook-events', 'archive']);
const MACHINE_FILES = new Set(['run-context.json', 'plugin-drift.json', 'doc-health.json', 'pace-log.jsonl']);
const isExcludedFile = (rel: string, name: string): boolean =>
  name.endsWith('.tmp') || (rel === STATE_DIR && MACHINE_FILES.has(name));

const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv, input?: string): string => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8', env: env ? { ...process.env, ...env } : process.env, input });
  if (result.error) throw new Error(`git ${args.join(' ')}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.trim()}`);
  return result.stdout.trim();
};

/** Repo-relative POSIX paths of every state file under `.blackhole/`, sorted. */
export const listStateFiles = (repoRoot: string): string[] => {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(repoRoot, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (rel === STATE_DIR && EXCLUDED_DIRS.has(entry.name)) continue;
        walk(childRel);
      } else if (entry.isFile() && !isExcludedFile(rel, entry.name)) {
        out.push(childRel);
      }
    }
  };
  if (fs.existsSync(path.join(repoRoot, STATE_DIR))) walk(STATE_DIR);
  return out.sort();
};

/** The state branch tip on the remote, fetched into the local tracking ref, or null when absent. */
export const fetchStateTip = (repoRoot: string, remote = 'origin'): string | null => {
  const ref = `refs/remotes/${remote}/${STATE_BRANCH}`;
  const result = spawnSync('git', ['fetch', '--quiet', remote, `+refs/heads/${STATE_BRANCH}:${ref}`], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    if (/couldn't find remote ref/i.test(result.stderr)) return null;
    throw new Error(`git fetch ${STATE_BRANCH}: ${result.stderr.trim()}`);
  }
  return git(repoRoot, ['rev-parse', ref]);
};

export type PushResult = { status: 'pushed' | 'unchanged' | 'empty'; commit: string | null; files: number };

/** Commits the current state files on top of the remote tip and pushes them (fast-forward only). */
export const pushState = (repoRoot: string, message: string, remote = 'origin'): PushResult => {
  const files = listStateFiles(repoRoot);
  if (files.length === 0) return { status: 'empty', commit: null, files: 0 };

  const indexFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-state-')), 'index');
  try {
    const env = { GIT_INDEX_FILE: indexFile };
    const cacheinfo = files
      .map((rel) => `100644 ${git(repoRoot, ['hash-object', '-w', '--', rel])}\t${rel}`)
      .join('\n');
    git(repoRoot, ['update-index', '--add', '--index-info'], env, `${cacheinfo}\n`);
    const tree = git(repoRoot, ['write-tree'], env);

    const parent = fetchStateTip(repoRoot, remote);
    if (parent && git(repoRoot, ['rev-parse', `${parent}^{tree}`]) === tree) {
      return { status: 'unchanged', commit: parent, files: files.length };
    }
    const commit = git(repoRoot, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message]);
    git(repoRoot, ['push', '--quiet', remote, `${commit}:refs/heads/${STATE_BRANCH}`]);
    git(repoRoot, ['update-ref', `refs/remotes/${remote}/${STATE_BRANCH}`, commit]);
    return { status: 'pushed', commit, files: files.length };
  } finally {
    fs.rmSync(path.dirname(indexFile), { recursive: true, force: true });
  }
};

export type PullResult =
  | { status: 'absent' }
  | { status: 'restored'; commit: string; written: string[]; unchanged: number }
  | { status: 'conflict'; commit: string; differing: string[] };

/**
 * Restores state files from the remote tip. A local file that differs from the branch is never
 * overwritten unless `force` is set: the disk may hold newer state than the last push.
 */
export const pullState = (repoRoot: string, options: { force?: boolean; remote?: string } = {}): PullResult => {
  const tip = fetchStateTip(repoRoot, options.remote ?? 'origin');
  if (!tip) return { status: 'absent' };

  const paths = git(repoRoot, ['ls-tree', '-r', '--name-only', tip, '--', STATE_DIR]).split('\n').filter(Boolean);
  const blobs = paths.map((rel) => ({ rel, content: blobContent(repoRoot, `${tip}:${rel}`) }));
  const differing = blobs
    .filter(({ rel, content }) => {
      const abs = path.join(repoRoot, rel);
      return fs.existsSync(abs) && !fs.readFileSync(abs).equals(content);
    })
    .map(({ rel }) => rel);
  if (differing.length > 0 && !options.force) return { status: 'conflict', commit: tip, differing };

  const written: string[] = [];
  for (const { rel, content } of blobs) {
    const abs = path.join(repoRoot, rel);
    if (fs.existsSync(abs) && fs.readFileSync(abs).equals(content)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    written.push(rel);
  }
  return { status: 'restored', commit: tip, written, unchanged: blobs.length - written.length };
};

const blobContent = (repoRoot: string, spec: string): Buffer => {
  const result = spawnSync('git', ['cat-file', 'blob', spec], { cwd: repoRoot });
  if (result.status !== 0) throw new Error(`git cat-file ${spec}: ${result.stderr.toString().trim()}`);
  return result.stdout;
};
