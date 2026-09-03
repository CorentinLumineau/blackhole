import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from './lib/fs.ts';
import { reviewArtifactPresent } from './lib/merge-gate/review-artifact.ts';
import { reviewTargetPath } from './lib/concern-slug.ts';

const root = path.resolve(import.meta.dirname);
const scriptPath = path.join(root, 'check-review-artifact.ts');
const fixturesDir = path.join(root, '..', 'fixtures', 'staging');

describe('reviewArtifactPresent', () => {
  test('passes when governance off', () => {
    expect(
      reviewArtifactPresent('Fix review promotion', 687, [], { enabled: false, write_governance: true }),
    ).toBe(true);
  });

  test('requires documentation/reviews path when governance on', () => {
    const title = 'Pattern B review promotion';
    const target = reviewTargetPath(title, 687);
    expect(reviewArtifactPresent(title, 687, ['src/foo.ts'], { enabled: true, write_governance: true })).toBe(
      false,
    );
    expect(reviewArtifactPresent(title, 687, [target], { enabled: true, write_governance: true })).toBe(true);
  });
});

// Issue #806 AC4 — the CLI's `--manifest` flag is gone; every path-shaped flag
// (`--config`/`--ledger`/`--repo-root`/`--diff-file`) must now be absolute.
describe('check-review-artifact CLI — absolute-path enforcement', () => {
  const issueTitle = 'Fix review-artifact merge gate content check';
  const issueNumber = 900;
  const targetPath = reviewTargetPath(issueTitle, issueNumber);

  let repoRoot: string;
  let configPath: string;
  let ledgerPath: string;
  let diffFile: string;

  beforeEach(() => {
    repoRoot = makeTempDir('check-review-artifact-cli');
    configPath = path.join(repoRoot, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ docs_governance: { enabled: true, write_governance: true } }),
    );
    ledgerPath = path.join(repoRoot, 'findings-ledger.json');
    fs.copyFileSync(path.join(fixturesDir, 'review-ledger-sample.json'), ledgerPath);
    const committedFull = path.join(repoRoot, targetPath);
    fs.mkdirSync(path.dirname(committedFull), { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, 'review-artifact-correct.md'), committedFull);
    diffFile = path.join(repoRoot, 'diff.txt');
    fs.writeFileSync(diffFile, `${targetPath}\n`);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  const baseArgs = () => [
    '--config',
    configPath,
    '--issue',
    String(issueNumber),
    '--title',
    issueTitle,
    '--ledger',
    ledgerPath,
    '--pr',
    '901',
    '--branch',
    'blackhole/issue-900',
    '--head',
    'abc1234def5678900000000000000000000000',
    '--repo-root',
    repoRoot,
    '--diff-file',
    diffFile,
  ];

  const run = (args: string[]) =>
    Bun.spawn(['bun', 'run', scriptPath, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });

  test('a relative --ledger path exits 2 with the usage message', async () => {
    const args = baseArgs();
    const ledgerIdx = args.indexOf('--ledger') + 1;
    args[ledgerIdx] = path.relative(root, ledgerPath);
    const proc = run(args);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });

  test('a relative --config path exits 2 with the usage message', async () => {
    const args = baseArgs();
    const configIdx = args.indexOf('--config') + 1;
    args[configIdx] = path.relative(root, configPath);
    const proc = run(args);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });

  test('a relative --repo-root path exits 2 with the usage message', async () => {
    const args = baseArgs();
    const rootIdx = args.indexOf('--repo-root') + 1;
    args[rootIdx] = path.relative(root, repoRoot);
    const proc = run(args);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });

  test('a relative --diff-file path exits 2 with the usage message', async () => {
    const args = baseArgs();
    const diffIdx = args.indexOf('--diff-file') + 1;
    args[diffIdx] = path.relative(root, diffFile);
    const proc = run(args);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });

  test('missing a required flag (--manifest is gone, no --ledger substitute given) exits 2', async () => {
    const proc = run(['--config', configPath, '--issue', String(issueNumber), '--title', issueTitle]);
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });

  test('all-absolute paths with matching content exits 0', async () => {
    const proc = run(baseArgs());
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(code).toBe(0);
    expect(stdout).toContain('ok');
  });

  test('all-absolute paths with drifted committed content exits 1', async () => {
    const committedFull = path.join(repoRoot, targetPath);
    fs.copyFileSync(path.join(fixturesDir, 'review-artifact-drifted.md'), committedFull);
    const proc = run(baseArgs());
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(1);
    expect(stderr).toContain('check-review-artifact:');
  });
});
