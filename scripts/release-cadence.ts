import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import {
  AI_NOTES_TIMEOUT_MS,
  CADENCE_THRESHOLD,
  CLAUDE_CODE_PACKAGE,
  HAIKU_MODEL_ALIAS,
  NOTES_MAX_BYTES,
  buildAiNotesPrompt,
  buildDeterministicNotes,
  cadenceEnvAllowsCut,
  classifyBatch,
  claudePrintArgs,
  earlyCutVersion,
  higherCutVersion,
  evaluateCadenceGate,
  filterPrsSince,
  headHasSkipRelease,
  redactSecret,
  selectBatch,
  shouldRecheckAfterLock,
  parseGhPullPages,
  validateAiNotes,
  verifyWorkflowSucceeded,
  type AiNotesAttempt,
  type ClaudeSpawnResult,
  type MergedPr,
} from './lib/release-cadence.ts';
import {
  bumpVersionAndBuild as bumpPackageVersionAndBuild,
  MANIFEST_PATHS,
  pushRelease,
  tagRelease,
  validateRelease,
  type ReleaseDeps,
} from './release.ts';

export { CADENCE_THRESHOLD, CLAUDE_CODE_PACKAGE, HAIKU_MODEL_ALIAS };

const root = path.resolve(import.meta.dirname, '..');

export type CliArgs = {
  prepare: boolean;
  cut: boolean;
  force: boolean;
  json: boolean;
};

export type CadenceAnchor = {
  count: number;
  latestTag: string | null;
  prs: MergedPr[];
  baseVersion: string;
  earlyCutVersion: string | null;
};

export type ReleaseCadenceDeps = {
  env: NodeJS.ProcessEnv;
  git: (cmd: string) => string;
  exec: (cmd: string) => string;
  log: (msg: string) => void;
  error: (msg: string) => void;
  listMergedPrs: () => MergedPr[] | Promise<MergedPr[]>;
  latestVTag: () => string | null;
  tagDateIso: (tag: string) => string | null;
  tagExists: (tag: string) => boolean;
  remoteTagExists: (tag: string) => boolean;
  verifySucceeded: (sha: string) => boolean;
  headSha: () => string;
  readPkgVersion: () => string;
  writeNotes: (tag: string, markdown: string) => void;
  notesExist: (tag: string) => boolean;
  bumpVersionAndBuild: (version: string) => void;
  validateRelease: (tag: string) => void;
  tagRelease: (tag: string) => void;
  pushRelease: (tag: string) => void;
  tryAiNotes: (tag: string, prs: MergedPr[]) => { notes: string | null; attempt: AiNotesAttempt };
  configureGitIdentity: () => void;
};

function usage(): never {
  console.log(`Usage:
  bun run release-cadence                          Dry-run status (default)
  bun run release-cadence --json                   Machine-readable dry-run
  bun run release-cadence --prepare                Write next-batch notes + bump + build
  bun run release-cadence --cut                    CI: gate → notes → commit → tag → push
  bun run release-cadence --cut --force            Cut when N < ${CADENCE_THRESHOLD} (maintainer emergency)

Threshold is CADENCE_THRESHOLD = ${CADENCE_THRESHOLD}; a package.json already above the latest tag cuts early at that version. Existing .github/workflows/release.yml
publishes the GitHub Release from the annotated tag — this command never creates one itself.`);
  process.exit(1);
}

export function parseCadenceArgs(argv: string[]): CliArgs {
  if (argv.includes('-h') || argv.includes('--help')) usage();
  const flags = parseFlags(argv);
  const unknown = unknownFlagKeys(flags, ['cut', 'force', 'json', 'prepare', 'help']);
  if (unknown.length > 0) {
    console.error(`Unknown argument: --${unknown[0]}`);
    usage();
  }
  return {
    prepare: flags.prepare === true,
    cut: flags.cut === true,
    force: flags.force === true,
    json: flags.json === true,
  };
}

export function releaseCommitPaths(tag: string): string[] {
  return [`.github/releases/${tag}.md`, 'package.json', ...MANIFEST_PATHS.map((m) => m.path)];
}

function notesPath(repoRoot: string, tag: string): string {
  return path.join(repoRoot, '.github', 'releases', `${tag}.md`);
}

function defaultGit(cmd: string): string {
  return execSync(cmd, { cwd: root, encoding: 'utf-8' }).trim();
}

function repoSlug(env: NodeJS.ProcessEnv, git: (cmd: string) => string): string {
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
  const remote = git('git remote get-url origin');
  const match = /github\.com[:/](.+?)(?:\.git)?$/.exec(remote);
  if (!match) throw new Error(`Cannot parse GitHub repo from remote: ${remote}`);
  return match[1];
}

function defaultListMergedPrs(git: (cmd: string) => string, env: NodeJS.ProcessEnv): MergedPr[] {
  const repo = repoSlug(env, git);
  const raw = execSync(
    `gh api --paginate "repos/${repo}/pulls?state=closed&base=main&per_page=100"`,
    { cwd: root, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  );
  return parseGhPullPages(raw);
}

export function parseLatestVTagList(tagList: string): string | null {
  const tags = tagList
    .split('\n')
    .map((line) => line.trim())
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  return tags[0] ?? null;
}

function defaultLatestVTag(git: (cmd: string) => string): string | null {
  try {
    return parseLatestVTagList(git("git tag -l 'v*' --sort=-version:refname"));
  } catch {
    return null;
  }
}

function defaultTagDateIso(git: (cmd: string) => string, tag: string): string | null {
  try {
    return git(`git log -1 --format=%cI ${tag}`) || null;
  } catch {
    return null;
  }
}

function defaultTagExists(git: (cmd: string) => string, tag: string): boolean {
  try {
    git(`git rev-parse refs/tags/${tag}`);
    return true;
  } catch {
    return false;
  }
}

function defaultRemoteTagExists(git: (cmd: string) => string, tag: string): boolean {
  try {
    return git(`git ls-remote --tags origin refs/tags/${tag}`).length > 0;
  } catch {
    return false;
  }
}

function defaultVerifySucceeded(sha: string, git: (cmd: string) => string, env: NodeJS.ProcessEnv): boolean {
  const repo = repoSlug(env, git);
  try {
    const raw = execSync(
      `gh api "repos/${repo}/actions/workflows/verify.yml/runs?head_sha=${sha}&status=completed&per_page=20"`,
      { cwd: root, encoding: 'utf-8' },
    );
    const parsed = JSON.parse(raw) as { workflow_runs?: Array<{ conclusion?: string | null }> };
    return verifyWorkflowSucceeded(parsed.workflow_runs ?? []);
  } catch {
    return false;
  }
}

function defaultSpawnClaude(args: string[], input: string, env: NodeJS.ProcessEnv, cwd: string): ClaudeSpawnResult {
  const result = spawnSync('claude', args, {
    cwd,
    encoding: 'utf-8',
    timeout: AI_NOTES_TIMEOUT_MS,
    input,
    env,
    maxBuffer: NOTES_MAX_BYTES + 64 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.error?.message.includes('ETIMEDOUT') === true || result.signal === 'SIGTERM',
  };
}

export function tryAiNotesFromSpawn(opts: {
  tag: string;
  prs: MergedPr[];
  token: string | undefined;
  spawn: (args: string[], input: string, env: NodeJS.ProcessEnv, cwd: string) => ClaudeSpawnResult;
  env?: NodeJS.ProcessEnv;
  mkdtemp?: (prefix: string) => string;
  rm?: (dir: string) => void;
}): { notes: string | null; attempt: AiNotesAttempt } {
  const token = opts.token;
  if (!token) return { notes: null, attempt: { status: 'fallback', reason: 'no-token' } };

  const tmp = (opts.mkdtemp ?? ((prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix))))(
    'cadence-ai-notes-',
  );
  try {
    const childEnv: NodeJS.ProcessEnv = {
      PATH: opts.env?.PATH ?? process.env.PATH,
      HOME: opts.env?.HOME ?? process.env.HOME,
      LANG: opts.env?.LANG ?? process.env.LANG,
      CLAUDE_CODE_OAUTH_TOKEN: token,
    };
    const result = opts.spawn(claudePrintArgs(), buildAiNotesPrompt(opts.tag, opts.prs), childEnv, tmp);
    if (result.timedOut) return { notes: null, attempt: { status: 'fallback', reason: 'timeout' } };
    if (result.status !== 0) return { notes: null, attempt: { status: 'fallback', reason: 'spawn-failed' } };
    const validated = validateAiNotes(opts.tag, redactSecret(result.stdout, token));
    if (!validated) return { notes: null, attempt: { status: 'fallback', reason: 'invalid-output' } };
    return { notes: validated, attempt: { status: 'written' } };
  } catch {
    return { notes: null, attempt: { status: 'fallback', reason: 'spawn-failed' } };
  } finally {
    (opts.rm ?? ((dir) => fs.rmSync(dir, { recursive: true, force: true })))(tmp);
  }
}

function versionFromTag(tag: string | null, pkgVersion: string): string {
  if (!tag) return pkgVersion;
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

export async function resolveAnchor(deps: ReleaseCadenceDeps): Promise<CadenceAnchor> {
  const latestTag = deps.latestVTag();
  const pkgVersion = deps.readPkgVersion();
  const all = await Promise.resolve(deps.listMergedPrs());
  const since = latestTag ? deps.tagDateIso(latestTag) : null;
  if (latestTag && !since) {
    throw new Error(`Cannot read commit date for tag ${latestTag}`);
  }
  const prs = filterPrsSince(all, since);
  const baseVersion = versionFromTag(latestTag, pkgVersion);
  const bumped = latestTag ? earlyCutVersion(pkgVersion, baseVersion) : null;
  const manualRelease = bumped !== null && deps.notesExist(`v${bumped}`);
  return {
    count: prs.length,
    latestTag,
    prs,
    baseVersion,
    earlyCutVersion: manualRelease ? null : bumped,
  };
}

function writeNotesFile(repoRoot: string, tag: string, markdown: string): void {
  const dest = notesPath(repoRoot, tag);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf-8');
}

export function createDefaultReleaseCadenceDeps(repoRoot = root): ReleaseCadenceDeps {
  const git = defaultGit;
  const releaseDeps: ReleaseDeps = { execGit: git };
  return {
    env: process.env,
    git,
    exec: git,
    log: (msg) => console.log(msg),
    error: (msg) => console.error(msg),
    listMergedPrs: () => defaultListMergedPrs(git, process.env),
    latestVTag: () => defaultLatestVTag(git),
    tagDateIso: (tag) => defaultTagDateIso(git, tag),
    tagExists: (tag) => defaultTagExists(git, tag),
    remoteTagExists: (tag) => defaultRemoteTagExists(git, tag),
    verifySucceeded: (sha) => defaultVerifySucceeded(sha, git, process.env),
    headSha: () => git('git rev-parse HEAD'),
    readPkgVersion: () => {
      const pkg = readJsonFile(path.join(repoRoot, 'package.json'), 'package.json') as { version: string };
      return pkg.version;
    },
    writeNotes: (tag, markdown) => writeNotesFile(repoRoot, tag, markdown),
    notesExist: (tag) => fs.existsSync(notesPath(repoRoot, tag)),
    bumpVersionAndBuild: (version) => bumpPackageVersionAndBuild(repoRoot, version),
    validateRelease: (tag) => validateRelease(repoRoot, tag, { allowDirty: true, deps: releaseDeps }),
    tagRelease: (tag) => tagRelease(repoRoot, tag, releaseDeps),
    pushRelease: (tag) => pushRelease(repoRoot, tag, releaseDeps),
    tryAiNotes: (tag, prs) =>
      tryAiNotesFromSpawn({
        tag,
        prs,
        token: process.env.CLAUDE_CODE_OAUTH_TOKEN,
        spawn: defaultSpawnClaude,
        env: process.env,
      }),
    configureGitIdentity: () => {
      if (process.env.CI === 'true') {
        execSync('git config user.name "github-actions[bot]"', { cwd: repoRoot });
        execSync('git config user.email "github-actions[bot]@users.noreply.github.com"', { cwd: repoRoot });
      }
    },
  };
}

function quotedGitPaths(paths: string[]): string {
  return paths.map((p) => `'${p.replace(/'/g, `'\\''`)}'`).join(' ');
}

export async function dryRunStatus(args: CliArgs, deps: ReleaseCadenceDeps): Promise<CadenceAnchor & {
  wouldCut: boolean;
  proposedTag: string | null;
  proposedBump: string | null;
}> {
  const anchor = await resolveAnchor(deps);
  const skipReleaseOnHead = headHasSkipRelease(safeHeadSubject(deps));
  const decision = evaluateCadenceGate({
    skipReleaseOnHead,
    mergedPrCount: anchor.count,
    threshold: CADENCE_THRESHOLD,
    force: args.force,
    versionBumpedSinceTag: anchor.earlyCutVersion !== null,
  });
  const batch = selectBatch(anchor.prs, CADENCE_THRESHOLD);
  const classified = batch.length > 0 ? classifyBatch(batch, anchor.baseVersion) : null;
  const proposedVersion = anchor.earlyCutVersion
    ? (classified ? higherCutVersion(anchor.earlyCutVersion, classified.nextVersion) : anchor.earlyCutVersion)
    : (classified?.nextVersion ?? null);
  const status = {
    ...anchor,
    wouldCut: decision === 'cut',
    proposedTag: proposedVersion ? `v${proposedVersion}` : null,
    proposedBump: anchor.earlyCutVersion && proposedVersion === anchor.earlyCutVersion ? 'early' : (classified?.bump ?? null),
    threshold: CADENCE_THRESHOLD,
    skipReleaseOnHead,
  };

  if (args.json) {
    deps.log(JSON.stringify(status, null, 2));
  } else {
    deps.log('Release cadence status (dry-run):');
    deps.log(`  Merged PRs since ${anchor.latestTag ?? 'beginning'}: ${anchor.count}`);
    deps.log(`  Threshold: ${CADENCE_THRESHOLD}`);
    deps.log(`  Would cut release: ${status.wouldCut ? 'yes' : 'no'}`);
    if (skipReleaseOnHead) deps.log('  HEAD commit contains [skip release]');
    if (status.proposedTag) {
      deps.log(`  Proposed tag: ${status.proposedTag} (${status.proposedBump})`);
    }
    if (anchor.count === 0) deps.log('  Nothing to release.');
  }
  return status;
}

function safeHeadSubject(deps: ReleaseCadenceDeps): string {
  try {
    return deps.git('git log -1 --format=%s');
  } catch {
    return '';
  }
}

function notesForBatch(
  tag: string,
  batch: MergedPr[],
  deps: ReleaseCadenceDeps,
): { notes: string; source: 'ai' | 'deterministic' } {
  const deterministic = buildDeterministicNotes(tag, batch);
  const ai = deps.tryAiNotes(tag, batch);
  if (ai.notes) {
    deps.log(`AI release notes written for ${tag} (Haiku)`);
    return { notes: ai.notes, source: 'ai' };
  }
  if (ai.attempt.status === 'fallback' && ai.attempt.reason !== 'no-token') {
    deps.log(`AI release notes fallback (${ai.attempt.reason}) — using deterministic notes`);
  } else if (ai.attempt.status === 'fallback' && ai.attempt.reason === 'no-token') {
    deps.log('CLAUDE_CODE_OAUTH_TOKEN unset — using deterministic notes');
  }
  return { notes: deterministic, source: 'deterministic' };
}

export async function prepareCadenceRelease(
  args: CliArgs,
  deps: ReleaseCadenceDeps,
  opts: { skipThresholdCheck?: boolean } = {},
): Promise<string | null> {
  const anchor = await resolveAnchor(deps);
  if (anchor.prs.length === 0) {
    deps.log('Nothing to release.');
    return null;
  }
  if (
    !opts.skipThresholdCheck &&
    anchor.count < CADENCE_THRESHOLD &&
    !args.force &&
    !anchor.earlyCutVersion
  ) {
    deps.log(
      `Only ${anchor.count} pending PR(s) since ${anchor.latestTag ?? 'beginning'} — below threshold ${CADENCE_THRESHOLD}.`,
    );
    return null;
  }
  if (!anchor.latestTag) {
    deps.error('No v* tag found — refusing to prepare. Create a baseline release first.');
    process.exit(1);
  }

  const batch = selectBatch(anchor.prs, CADENCE_THRESHOLD);
  const classified = classifyBatch(batch, anchor.baseVersion);
  const version = anchor.earlyCutVersion
    ? higherCutVersion(anchor.earlyCutVersion, classified.nextVersion)
    : classified.nextVersion;
  const tag = `v${version}`;
  if (anchor.earlyCutVersion) {
    deps.log(`early cut: package.json at ${anchor.earlyCutVersion}, tagging ${version} (latest tag ${anchor.latestTag})`);
  }

  if (deps.tagExists(tag) || deps.remoteTagExists(tag)) {
    deps.error(`Tag ${tag} already exists. Refusing to retag.`);
    process.exit(1);
  }

  if (deps.notesExist(tag)) {
    deps.error(`Release notes already exist: .github/releases/${tag}.md`);
    process.exit(1);
  }

  const { notes, source } = notesForBatch(tag, batch, deps);
  deps.writeNotes(tag, notes);
  deps.bumpVersionAndBuild(version);
  deps.log(`Prepared release ${tag} (${anchor.earlyCutVersion && version === anchor.earlyCutVersion ? 'early' : classified.bump}, notes=${source})`);
  deps.log(`  PR range: #${batch[0]!.number}–#${batch[batch.length - 1]!.number} (${batch.length} of ${anchor.count})`);
  return tag;
}

export async function cutRelease(args: CliArgs, deps: ReleaseCadenceDeps): Promise<void> {
  if (!cadenceEnvAllowsCut(deps.env)) {
    deps.log("RELEASE_CADENCE_ENABLED is not 'true' — skipping cadence cut.");
    return;
  }

  deps.configureGitIdentity();

  const skipReleaseOnHead = headHasSkipRelease(safeHeadSubject(deps));
  const first = await resolveAnchor(deps);
  const firstDecision = evaluateCadenceGate({
    skipReleaseOnHead,
    mergedPrCount: first.count,
    threshold: CADENCE_THRESHOLD,
    force: args.force,
    versionBumpedSinceTag: first.earlyCutVersion !== null,
  });

  if (firstDecision === 'skip') {
    deps.log(
      `HEAD contains [skip release] and only ${first.count} PR(s) are pending (threshold ${CADENCE_THRESHOLD}) — skipping cadence cut.`,
    );
    return;
  }
  if (firstDecision === 'no-op') {
    deps.log(
      `Only ${first.count} merged PR(s) since ${first.latestTag ?? 'beginning'} — below threshold ${CADENCE_THRESHOLD}.`,
    );
    return;
  }
  if (!first.latestTag) {
    deps.error('No v* tag found — refusing to cut. Create a baseline release first.');
    process.exit(1);
  }

  const sha = deps.headSha();
  if (!deps.verifySucceeded(sha)) {
    deps.log(`Verify has not succeeded on ${sha} — skipping cadence cut.`);
    return;
  }

  const second = await resolveAnchor(deps);
  if (!shouldRecheckAfterLock(
      first.count,
      second.count,
      CADENCE_THRESHOLD,
      args.force,
      first.earlyCutVersion !== null && second.earlyCutVersion !== null,
    )) {
    deps.log(
      `Post-lock re-check: ${second.count} PR(s) since ${second.latestTag ?? 'beginning'} — below threshold; another run may have released.`,
    );
    return;
  }

  const tag = await prepareCadenceRelease(args, deps, { skipThresholdCheck: true });
  if (!tag) return;

  try {
    deps.git(`git add ${quotedGitPaths(releaseCommitPaths(tag))}`);
    deps.git(`git commit -m "chore(release): prepare ${tag} [skip release]"`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.error(`Failed to commit release artifacts: ${message}`);
    process.exit(1);
  }

  deps.validateRelease(tag);

  try {
    deps.tagRelease(tag);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.error(`Failed to create tag ${tag}: ${message}`);
    process.exit(1);
  }

  try {
    deps.pushRelease(tag);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.error(`git push failed for tag ${tag}: ${message}`);
    try {
      deps.git(`git tag -d ${tag}`);
      deps.error(`Deleted local tag ${tag} — no manual cleanup needed.`);
    } catch {
      // Tag may already be gone.
    }
    process.exit(1);
  }

  deps.log('');
  deps.log(`✓ Release ${tag} cut — existing release.yml will publish the GitHub Release`);
  deps.log(`  PRs since ${first.latestTag}: ${first.count} (threshold ${CADENCE_THRESHOLD})`);
}

async function main(): Promise<void> {
  const args = parseCadenceArgs(process.argv.slice(2));
  const deps = createDefaultReleaseCadenceDeps();

  if (args.cut) {
    await cutRelease(args, deps);
    return;
  }
  if (args.prepare) {
    const tag = await prepareCadenceRelease(args, deps);
    if (!tag) process.exit(0);
    return;
  }
  await dryRunStatus(args, deps);
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(redactSecret(message, process.env.CLAUDE_CODE_OAUTH_TOKEN));
    process.exit(1);
  });
}
