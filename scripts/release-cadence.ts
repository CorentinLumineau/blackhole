import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import {
  bumpPackageVersion,
  MANIFEST_PATHS,
  notesFilePath,
  pushRelease,
  tagRelease,
  validateRelease,
} from './release.ts';

/** Single SSOT for the every-N-merged-PR cut. Do not scatter this literal. */
export const CADENCE_THRESHOLD = 20;

export const SKIP_RELEASE_MARKER = '[skip release]';

export const VERIFY_WORKFLOW_FILE = 'verify.yml';

const root = path.resolve(import.meta.dirname, '..');

export type MergedPr = {
  number: number;
  title: string;
  body: string;
  mergedAt: string;
};

export type SemverBump = 'major' | 'minor' | 'patch';

export type CadenceGateDecision = 'skip' | 'no-op' | 'cut';

export type CadenceGateInput = {
  skipReleaseOnHead: boolean;
  mergedPrCount: number;
  threshold: number;
  force: boolean;
};

export type VerifyRun = {
  status: string;
  conclusion: string | null;
  created_at: string;
};

export type CutOutcome =
  | { status: 'cut'; tag: string }
  | { status: 'skipped'; reason: string };

export type CadenceCliArgs = {
  cut: boolean;
  force: boolean;
  json: boolean;
};

export type ReleaseAnchor = {
  count: number;
  latestTag: string | null;
  prs: MergedPr[];
  baseVersion: string;
};

export type CadenceDeps = {
  git: (cmd: string) => string;
  listMergedPrs: () => Promise<MergedPr[]>;
  getLatestVTag: () => string | null;
  getTagDateIso: (tag: string) => string | null;
  listVerifyRuns: (sha: string) => VerifyRun[];
  headSha: () => string;
  originMainSha: () => string | null;
  tagExists: (tag: string) => boolean;
  remoteTagExists: (tag: string) => boolean;
  readPkgVersion: () => string;
  writePkgVersion: (version: string) => void;
  writeNotes: (tag: string, markdown: string) => void;
  notesExist: (tag: string) => boolean;
  build: () => void;
  validateRelease: (tag: string) => void;
  tagRelease: (tag: string) => void;
  pushRelease: (tag: string) => void;
  repoUrl: () => string;
  configureGitIdentity: () => void;
};

const MAJOR_TITLE = /^[a-z]+(\([^)]*\))?!:|^major(\(|:)/i;
const MAJOR_BODY = /^BREAKING[ -]CHANGE:/m;
const MINOR_TITLE = /^feat(\([^)]*\))?:/i;
const TRAILING_PR_REF = /(?:\s*\(#\d+\))+$/;
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

function usage(): never {
  console.log(`Usage:
  bun run release-cadence                 Dry-run status (default)
  bun run release-cadence --cut           CI: gate → notes → bump → build → commit → tag → push
  bun run release-cadence --cut --force   Cut when N < ${CADENCE_THRESHOLD} (maintainer emergency)
  bun run release-cadence --json          Machine-readable dry-run status`);
  process.exit(1);
}

export function parseCadenceArgs(argv: string[]): CadenceCliArgs {
  const flags = parseFlags(argv);
  const unknown = unknownFlagKeys(flags, ['cut', 'force', 'json', 'help', 'h']);
  if (flags.help === true || flags.h === true) usage();
  if (unknown.length > 0) {
    console.error(`Unknown argument: --${unknown[0]}`);
    usage();
  }
  const isOn = (value: string | true | undefined): boolean => value === true || value === 'true';
  return {
    cut: isOn(flags.cut),
    force: isOn(flags.force),
    json: isOn(flags.json),
  };
}

/**
 * `[skip release]` on HEAD marks a cadence commit. It stops a cut only while fewer than
 * `threshold` PRs are pending. `force` does not override that skip. With a full batch pending
 * the cut proceeds so the next 20 can land.
 */
export function evaluateCadenceGate(input: CadenceGateInput): CadenceGateDecision {
  if (input.skipReleaseOnHead && input.mergedPrCount < input.threshold) return 'skip';
  if (input.mergedPrCount >= input.threshold || input.force) return 'cut';
  return 'no-op';
}

export function selectBatch(prs: MergedPr[], limit = CADENCE_THRESHOLD): MergedPr[] {
  return [...prs].sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt) || a.number - b.number).slice(0, limit);
}

function bumpSemver(base: string, bump: SemverBump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(base);
  if (!match) {
    throw new Error(`Invalid semver base "${base}"`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default: {
      const exhaustive: never = bump;
      throw new Error(`Unhandled semver bump: ${exhaustive}`);
    }
  }
}

function isMajor(title: string, body: string): boolean {
  return MAJOR_TITLE.test(title) || MAJOR_BODY.test(body);
}

function isMinor(title: string): boolean {
  return MINOR_TITLE.test(title);
}

/** feat → minor; BREAKING / `type!:` → major; everything else → patch. */
export function classifyBatch(
  prs: MergedPr[],
  baseVersion: string,
): { bump: SemverBump; nextVersion: string } {
  let bump: SemverBump = 'patch';
  for (const pr of prs) {
    if (isMajor(pr.title, pr.body)) {
      bump = 'major';
      break;
    }
    if (isMinor(pr.title)) bump = 'minor';
  }
  return { bump, nextVersion: bumpSemver(baseVersion, bump) };
}

export function cleanPrTitle(title: string): string {
  return title.replace(TRAILING_PR_REF, '').trim();
}

export function buildNotesMarkdown(opts: {
  tag: string;
  previousTag: string | null;
  prs: MergedPr[];
  repoUrl: string;
}): string {
  const { tag, previousTag, prs, repoUrl } = opts;
  const since = previousTag ?? 'the start of history';
  const bullets = prs.map((pr) => {
    const title = cleanPrTitle(pr.title);
    return `- ${title} ([#${pr.number}](${repoUrl}/pull/${pr.number}))`;
  });
  return [
    `## Release — backlog-campaign ${tag}`,
    '',
    `### ✨ What's new in ${tag}`,
    '',
    `Automated cadence cut of ${prs.length} merged PR${prs.length === 1 ? '' : 's'} since ${since}.`,
    '',
    ...bullets,
    '',
    '---',
    '',
    `**Full feature overview:** see [v0.1.0 release notes](${repoUrl}/releases/tag/v0.1.0) · [README](${repoUrl}#readme)`,
    '',
  ].join('\n');
}

/** Latest completed Verify workflow run on this SHA must be success. In-progress or red → skip. */
export function verifySucceededOnSha(runs: VerifyRun[]): boolean {
  const completed = runs.filter((run) => run.status === 'completed');
  if (completed.length === 0) return false;
  const latest = [...completed].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  return latest?.conclusion === 'success';
}

export function headHasSkipRelease(runGit: (cmd: string) => string): boolean {
  try {
    return runGit('git log -1 --format=%s').includes(SKIP_RELEASE_MARKER);
  } catch {
    return false;
  }
}

export function releaseCommitPaths(tag: string): string[] {
  return [`.github/releases/${tag}.md`, 'package.json', ...MANIFEST_PATHS.map((m) => m.path)];
}

function stripTagPrefix(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

function defaultExec(cmd: string): string {
  return execSync(cmd, { cwd: root, encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 }).trim();
}

function parseRepoSlug(): string {
  const fromEnv = process.env.GITHUB_REPOSITORY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const remote = defaultExec('git remote get-url origin');
    const match = /github\.com[:/](.+?)(?:\.git)?$/.exec(remote);
    if (match) return match[1];
  } catch {
    // Fall through to the canonical public repo.
  }
  return 'CorentinLumineau/blackhole';
}

function defaultRepoUrl(): string {
  const server = (process.env.GITHUB_SERVER_URL ?? 'https://github.com').replace(/\/$/, '');
  return `${server}/${parseRepoSlug()}`;
}

function defaultListMergedPrs(): MergedPr[] {
  const repo = parseRepoSlug();
  const raw = defaultExec(`gh api --paginate "repos/${repo}/pulls?state=closed&base=main&per_page=100"`);
  const rows = JSON.parse(raw) as Array<{
    number: number;
    title: string;
    body: string | null;
    merged_at: string | null;
  }>;
  return rows
    .filter((row) => row.merged_at != null)
    .map((row) => ({
      number: row.number,
      title: row.title,
      body: row.body ?? '',
      mergedAt: row.merged_at!,
    }));
}

function defaultListVerifyRuns(sha: string): VerifyRun[] {
  const repo = parseRepoSlug();
  try {
    const raw = defaultExec(
      `gh api "repos/${repo}/actions/workflows/${VERIFY_WORKFLOW_FILE}/runs?head_sha=${sha}&per_page=20"`,
    );
    const parsed = JSON.parse(raw) as { workflow_runs?: VerifyRun[] };
    return parsed.workflow_runs ?? [];
  } catch {
    return [];
  }
}

function defaultLatestVTag(): string | null {
  const out = defaultExec("git tag -l 'v*' --sort=-version:refname");
  if (!out) return null;
  for (const line of out.split('\n')) {
    const tag = line.trim();
    if (RELEASE_TAG.test(tag)) return tag;
  }
  return null;
}

function defaultTagDateIso(tag: string): string | null {
  try {
    return defaultExec(`git log -1 --format=%cI ${tag}`) || null;
  } catch {
    return null;
  }
}

function tagExistsGit(git: (cmd: string) => string, tag: string): boolean {
  try {
    git(`git rev-parse refs/tags/${tag}`);
    return true;
  } catch {
    return false;
  }
}

function remoteTagExistsGit(git: (cmd: string) => string, tag: string): boolean {
  try {
    return git(`git ls-remote --tags origin refs/tags/${tag}`).length > 0;
  } catch {
    return false;
  }
}

export function createDefaultCadenceDeps(): CadenceDeps {
  const git = defaultExec;
  return {
    git,
    listMergedPrs: async () => defaultListMergedPrs(),
    getLatestVTag: defaultLatestVTag,
    getTagDateIso: defaultTagDateIso,
    listVerifyRuns: defaultListVerifyRuns,
    headSha: () => git('git rev-parse HEAD'),
    originMainSha: () => {
      try {
        git('git fetch --quiet origin main');
        return git('git rev-parse origin/main');
      } catch {
        return null;
      }
    },
    tagExists: (tag) => tagExistsGit(git, tag),
    remoteTagExists: (tag) => remoteTagExistsGit(git, tag),
    readPkgVersion: () => {
      const pkg = readJsonFile(path.join(root, 'package.json'), 'package.json') as { version: string };
      return pkg.version;
    },
    writePkgVersion: (version) => bumpPackageVersion(root, version),
    writeNotes: (tag, markdown) => {
      const dest = notesFilePath(root, tag);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, markdown, 'utf-8');
    },
    notesExist: (tag) => fs.existsSync(notesFilePath(root, tag)),
    build: () => {
      execSync('bun run build', { cwd: root, stdio: 'inherit' });
    },
    validateRelease: (tag) => validateRelease(root, tag, { allowDirty: true, deps: { execGit: git } }),
    tagRelease: (tag) => tagRelease(root, tag, { execGit: git }),
    pushRelease: (tag) => pushRelease(root, tag, { execGit: git }),
    repoUrl: defaultRepoUrl,
    configureGitIdentity: () => {
      if (process.env.CI === 'true') {
        git('git config user.name "github-actions[bot]"');
        git('git config user.email "github-actions[bot]@users.noreply.github.com"');
      }
    },
  };
}

export async function resolveAnchor(deps: CadenceDeps): Promise<ReleaseAnchor> {
  const latestTag = deps.getLatestVTag();
  const pkgVersion = deps.readPkgVersion();
  const all = await deps.listMergedPrs();
  if (!latestTag) {
    const prs = [...all].sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt) || a.number - b.number);
    return { count: prs.length, latestTag: null, prs, baseVersion: pkgVersion };
  }
  const tagDate = deps.getTagDateIso(latestTag);
  const since = tagDate ? Date.parse(tagDate) : 0;
  const prs = all
    .filter((pr) => Date.parse(pr.mergedAt) > since)
    .sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt) || a.number - b.number);
  return { count: prs.length, latestTag, prs, baseVersion: stripTagPrefix(latestTag) };
}

function skip(reason: string): CutOutcome {
  console.log(reason);
  return { status: 'skipped', reason };
}

export async function cutRelease(
  args: CadenceCliArgs,
  deps: CadenceDeps = createDefaultCadenceDeps(),
): Promise<CutOutcome> {
  const head = deps.headSha();
  const live = deps.originMainSha();
  if (live && live !== head) {
    return skip(`Tip SHA ${head} is stale (origin/main is ${live}) — skipping.`);
  }

  if (!verifySucceededOnSha(deps.listVerifyRuns(head))) {
    return skip(`Verify did not succeed on tip SHA ${head} — skipping.`);
  }

  const skipReleaseOnHead = headHasSkipRelease(deps.git);
  const anchor = await resolveAnchor(deps);
  const decision = evaluateCadenceGate({
    skipReleaseOnHead,
    mergedPrCount: anchor.count,
    threshold: CADENCE_THRESHOLD,
    force: args.force,
  });

  switch (decision) {
    case 'skip':
      return skip(
        `HEAD contains ${SKIP_RELEASE_MARKER} and only ${anchor.count} PR(s) are pending (threshold ${CADENCE_THRESHOLD}) — skipping.`,
      );
    case 'no-op':
      return skip(
        `Only ${anchor.count} merged PR(s) since ${anchor.latestTag ?? 'beginning'} — below threshold ${CADENCE_THRESHOLD}.`,
      );
    case 'cut':
      break;
    default: {
      const exhaustive: never = decision;
      throw new Error(`Unhandled cadence gate: ${exhaustive}`);
    }
  }

  if (anchor.prs.length === 0) {
    return skip('Nothing to release.');
  }

  const batch = selectBatch(anchor.prs, CADENCE_THRESHOLD);
  const classified = classifyBatch(batch, anchor.baseVersion);
  const tag = `v${classified.nextVersion}`;

  if (deps.tagExists(tag) || deps.remoteTagExists(tag) || deps.notesExist(tag)) {
    return skip(`Tag or notes for ${tag} already exist — not retagging.`);
  }

  deps.configureGitIdentity();
  const markdown = buildNotesMarkdown({
    tag,
    previousTag: anchor.latestTag,
    prs: batch,
    repoUrl: deps.repoUrl(),
  });
  deps.writeNotes(tag, markdown);
  deps.writePkgVersion(classified.nextVersion);
  deps.build();

  const paths = releaseCommitPaths(tag);
  try {
    deps.git(`git add -- ${paths.join(' ')}`);
    deps.git(`git commit -m "chore(release): prepare ${tag} ${SKIP_RELEASE_MARKER}"`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to commit release artifacts: ${message}`);
    process.exit(1);
  }

  try {
    deps.validateRelease(tag);
    deps.tagRelease(tag);
    deps.pushRelease(tag);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to tag or push ${tag}: ${message}`);
    process.exit(1);
  }

  console.log(`✓ Release ${tag} cut (${classified.bump}); GitHub Release is published by release.yml`);
  console.log(`  PRs since ${anchor.latestTag ?? 'beginning'}: ${anchor.count} (threshold ${CADENCE_THRESHOLD}, batch ${batch.length})`);
  return { status: 'cut', tag };
}

export async function dryRunStatus(args: CadenceCliArgs, deps: CadenceDeps = createDefaultCadenceDeps()): Promise<void> {
  const skipReleaseOnHead = headHasSkipRelease(deps.git);
  const anchor = await resolveAnchor(deps);
  const decision = evaluateCadenceGate({
    skipReleaseOnHead,
    mergedPrCount: anchor.count,
    threshold: CADENCE_THRESHOLD,
    force: args.force,
  });
  const batch = selectBatch(anchor.prs, CADENCE_THRESHOLD);
  const classified = batch.length > 0 ? classifyBatch(batch, anchor.baseVersion) : null;
  const status = {
    count: anchor.count,
    threshold: CADENCE_THRESHOLD,
    latestTag: anchor.latestTag,
    wouldCut: decision === 'cut',
    decision,
    skipReleaseOnHead,
    proposedTag: classified ? `v${classified.nextVersion}` : null,
    proposedBump: classified?.bump ?? null,
    batchSize: batch.length,
  };
  if (args.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log('Release cadence status (dry-run):');
  console.log(`  Merged PRs since ${anchor.latestTag ?? 'beginning'}: ${anchor.count}`);
  console.log(`  Threshold: ${CADENCE_THRESHOLD}`);
  console.log(`  Would cut release: ${status.wouldCut ? 'yes' : 'no'}`);
  if (skipReleaseOnHead) console.log(`  HEAD commit contains ${SKIP_RELEASE_MARKER}`);
  if (status.proposedTag) {
    console.log(`  Proposed tag: ${status.proposedTag} (${status.proposedBump})`);
  }
  if (anchor.count === 0) console.log('  Nothing to release.');
}

async function main(): Promise<void> {
  const args = parseCadenceArgs(process.argv.slice(2));
  if (args.cut) {
    await cutRelease(args);
    return;
  }
  await dryRunStatus(args);
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
