// Prints the deterministic release decision (ADR-063 M4) for the current checkout: offline, git only,
// no model call. `--json` is the machine-readable form; the default is one human line.
import { execFileSync } from 'child_process';
import * as path from 'path';
import { parseLatestVTagList } from './release-cadence.ts';
import {
  FIRST_PARENT_LOG_FORMAT,
  decideCut,
  evaluateFreshness,
  nextCutVersion,
  parseFirstParentLog,
  type CutDecision,
} from './lib/release-policy.ts';
import { readJsonFile } from './lib/fs.ts';

const root = path.resolve(import.meta.dirname, '..');

export type GitRunner = (args: string[]) => string;

const defaultGit: GitRunner = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim();

export type PolicyReport = CutDecision & { tag: string | null; nextVersion: string | null };

const isAncestor = (git: GitRunner, sha: string, of: string): boolean => {
  try {
    git(['merge-base', '--is-ancestor', sha, of]);
    return true;
  } catch {
    return false;
  }
};

/**
 * Offline release decision for the checkout: reads tags and first-parent history through `git`
 * and decides with `decideCut`. It does not list verify runs: the caller passes the SHA of the
 * newest green main run as `verifiedSha`, and without it the M2 freshness check fails closed
 * (only `force` cuts). An immediate commit is verified when it is an ancestor of that SHA.
 */
export function reportPolicy(
  git: GitRunner,
  manifestVersion: string,
  now: Date,
  force = false,
  verifiedSha: string | null = null,
): PolicyReport {
  const tag = parseLatestVTagList(git(['tag', '-l', 'v*', '--sort=-version:refname']));
  const range = tag ? [`${tag}..HEAD`] : [];
  const commits = parseFirstParentLog(
    git(['log', '--first-parent', '--name-only', `--format=${FIRST_PARENT_LOG_FORMAT}`, ...range]),
  );
  const tagDate = tag ? git(['log', '-1', '--format=%cI', tag]) : '';
  const freshness = verifiedSha
    ? evaluateFreshness([{ status: 'completed', conclusion: 'success', headSha: verifiedSha }], (sha) => isAncestor(git, sha, 'HEAD'))
    : { ok: false, sha: null, reason: 'no verified main run supplied (pass --verified-sha)' };
  const isVerified = (sha: string): boolean =>
    verifiedSha !== null && isAncestor(git, sha, verifiedSha);
  const decision = decideCut({
    commits,
    now,
    lastTagAt: tagDate ? new Date(tagDate) : null,
    force,
    freshness,
    isVerified,
  });
  const nextVersion = decision.cut && tag ? nextCutVersion(tag.slice(1), manifestVersion, commits).version : null;
  return { ...decision, tag, nextVersion };
}

if (import.meta.main) {
  const pkg = readJsonFile(path.join(root, 'package.json'), 'package.json') as { version: string };
  const verifiedIdx = process.argv.indexOf('--verified-sha');
  const report = reportPolicy(
    defaultGit,
    pkg.version,
    new Date(),
    process.argv.includes('--force'),
    verifiedIdx >= 0 ? (process.argv[verifiedIdx + 1] ?? null) : null,
  );
  console.log(
    process.argv.includes('--json')
      ? JSON.stringify(report, null, 2)
      : `${report.class}: ${report.reason} (${report.cut ? 'cut' : 'no cut'})`,
  );
}
