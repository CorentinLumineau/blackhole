// Prints the deterministic release decision (ADR-063 M4) for the current checkout: offline, git only,
// no model call. `--json` is the machine-readable form; the default is one human line.
import { execFileSync } from 'child_process';
import * as path from 'path';
import { parseLatestVTagList } from './release-cadence.ts';
import {
  FIRST_PARENT_LOG_FORMAT,
  decideCut,
  nextCutVersion,
  parseFirstParentLog,
  type CutDecision,
} from './lib/release-policy.ts';
import { readJsonFile } from './lib/fs.ts';

const root = path.resolve(import.meta.dirname, '..');

export type GitRunner = (args: string[]) => string;

const defaultGit: GitRunner = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim();

export type PolicyReport = CutDecision & { tag: string | null; nextVersion: string | null };

export function reportPolicy(git: GitRunner, manifestVersion: string, now: Date, force = false): PolicyReport {
  const tag = parseLatestVTagList(git(['tag', '-l', 'v*', '--sort=-version:refname']));
  const range = tag ? [`${tag}..HEAD`] : [];
  const commits = parseFirstParentLog(
    git(['log', '--first-parent', '--name-only', `--format=${FIRST_PARENT_LOG_FORMAT}`, ...range]),
  );
  const tagDate = tag ? git(['log', '-1', '--format=%cI', tag]) : '';
  const decision = decideCut({ commits, now, lastTagAt: tagDate ? new Date(tagDate) : null, force });
  const nextVersion = decision.cut && tag ? nextCutVersion(tag.slice(1), manifestVersion, commits).version : null;
  return { ...decision, tag, nextVersion };
}

if (import.meta.main) {
  const pkg = readJsonFile(path.join(root, 'package.json'), 'package.json') as { version: string };
  const report = reportPolicy(defaultGit, pkg.version, new Date(), process.argv.includes('--force'));
  console.log(
    process.argv.includes('--json')
      ? JSON.stringify(report, null, 2)
      : `${report.class}: ${report.reason} (${report.cut ? 'cut' : 'no cut'})`,
  );
}
