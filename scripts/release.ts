import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const root = path.resolve(import.meta.dirname, '..');
const releasesDir = path.join(root, '.github', 'releases');
const templatePath = path.join(releasesDir, 'TEMPLATE.md');
const pkgPath = path.join(root, 'package.json');

function usage(): never {
  console.log(`Usage:
  bun run release prepare <vX.Y.Z>   Copy TEMPLATE → notes file, bump package.json
  bun run release validate <vX.Y.Z>  Verify notes file, version sync, clean tree
  bun run release tag <vX.Y.Z>       Validate + create annotated git tag on HEAD
  bun run release push <vX.Y.Z>      Push main + tag to origin (triggers CI release)`);
  process.exit(1);
}

function normalizeTag(tag: string): string {
  const t = tag.trim();
  if (!/^v\d+\.\d+\.\d+$/.test(t)) {
    console.error(`Invalid tag "${tag}". Expected format: vX.Y.Z`);
    process.exit(1);
  }
  return t;
}

function versionFromTag(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

function notesPath(tag: string): string {
  return path.join(releasesDir, `${tag}.md`);
}

function readPkg(): { version: string; [k: string]: unknown } {
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
}

function writePkg(pkg: { version: string; [k: string]: unknown }): void {
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
}

function git(cmd: string): string {
  return execSync(cmd, { cwd: root, encoding: 'utf-8' }).trim();
}

function build(): void {
  execSync('bun run build --all', { cwd: root, stdio: 'inherit' });
}

export const MANIFEST_PATHS: Array<{ path: string; versionOf: (json: unknown) => string | undefined }> = [
  { path: '.claude-plugin/plugin.json', versionOf: (json) => (json as { version?: string }).version },
  {
    path: '.claude-plugin/marketplace.json',
    versionOf: (json) => (json as { plugins?: Array<{ version?: string }> }).plugins?.[0]?.version,
  },
  { path: '.codex-plugin/plugin.json', versionOf: (json) => (json as { version?: string }).version },
  { path: '.gemini-plugin/plugin.json', versionOf: (json) => (json as { version?: string }).version },
  { path: 'plugins/blackhole/plugin.json', versionOf: (json) => (json as { version?: string }).version },
];

export function findManifestVersionMismatches(
  pkgVersion: string,
  manifests: Record<string, unknown>
): string[] {
  const mismatches: string[] = [];
  for (const { path: manifestPath, versionOf } of MANIFEST_PATHS) {
    if (versionOf(manifests[manifestPath]) !== pkgVersion) {
      mismatches.push(manifestPath);
    }
  }
  return mismatches;
}

function tagExists(tag: string): boolean {
  try {
    git(`git rev-parse refs/tags/${tag}`);
    return true;
  } catch {
    return false;
  }
}

function remoteTagExists(tag: string): boolean {
  try {
    const out = git(`git ls-remote --tags origin refs/tags/${tag}`);
    return out.length > 0;
  } catch {
    return false;
  }
}

function validate(tag: string, opts: { allowDirty?: boolean } = {}): void {
  const version = versionFromTag(tag);
  const notes = notesPath(tag);

  if (!fs.existsSync(notes)) {
    console.error(`Missing release notes: ${path.relative(root, notes)}`);
    console.error(`Run: bun run release prepare ${tag}`);
    process.exit(1);
  }

  const content = fs.readFileSync(notes, 'utf-8').trim();
  if (content.length < 100) {
    console.error(`Release notes too short (${content.length} chars): ${path.relative(root, notes)}`);
    process.exit(1);
  }

  const pkg = readPkg();
  if (pkg.version !== version) {
    console.error(`package.json version "${pkg.version}" does not match tag "${tag}" (expected ${version})`);
    process.exit(1);
  }

  if (tagExists(tag)) {
    console.error(`Tag ${tag} already exists locally. Delete it first if you intend to recreate.`);
    process.exit(1);
  }

  if (remoteTagExists(tag)) {
    console.error(`Tag ${tag} already exists on origin.`);
    process.exit(1);
  }

  if (!opts.allowDirty) {
    const status = git('git status --porcelain');
    if (status) {
      console.warn('Warning: working tree is not clean:');
      console.warn(status);
    }
  }

  console.log(`✓ ${tag} validated — notes file OK, package.json ${version}`);
}

function prepare(tag: string): void {
  const version = versionFromTag(tag);
  const dest = notesPath(tag);

  if (!fs.existsSync(templatePath)) {
    console.error(`Missing template: ${path.relative(root, templatePath)}`);
    process.exit(1);
  }

  if (fs.existsSync(dest)) {
    console.error(`Release notes already exist: ${path.relative(root, dest)}`);
    process.exit(1);
  }

  let template = fs.readFileSync(templatePath, 'utf-8');
  template = template.replaceAll('vX.Y.Z', tag).replaceAll('X.Y.Z', version);
  fs.writeFileSync(dest, template, 'utf-8');

  const pkg = readPkg();
  pkg.version = version;
  writePkg(pkg);

  build();

  console.log(`Created ${path.relative(root, dest)}`);
  console.log(`Bumped package.json → ${version}`);
  console.log(`Ran bun run build --all — regenerated the 5 version-carrying manifests`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Edit ${path.relative(root, dest)} with product-focused release notes`);
  console.log(`  2. bun run release validate ${tag}`);
  console.log(`  3. Commit notes + package.json + the 5 regenerated manifests, then push`);
  console.log(`  4. bun run release tag ${tag}`);
  console.log(`  5. bun run release push ${tag}`);
}

function tag(tagName: string): void {
  validate(tagName);
  const message = `Release ${tagName}`;
  git(`git tag -a ${tagName} -m "${message}"`);
  console.log(`✓ Created annotated tag ${tagName} on ${git('git rev-parse --short HEAD')}`);
}

function push(tagName: string): void {
  if (!tagExists(tagName)) {
    console.error(`Tag ${tagName} does not exist locally. Run: bun run release tag ${tagName}`);
    process.exit(1);
  }
  git('git push origin main');
  git(`git push origin ${tagName}`);
  console.log(`✓ Pushed main and ${tagName} — CI will publish the GitHub release`);
}

function main(): void {
  const [, , command, rawTag] = process.argv;
  if (!command || !rawTag) usage();

  const tagArg = normalizeTag(rawTag);

  switch (command) {
    case 'prepare':
      prepare(tagArg);
      break;
    case 'validate':
      validate(tagArg);
      break;
    case 'tag':
      tag(tagArg);
      break;
    case 'push':
      push(tagArg);
      break;
    default:
      usage();
  }
}

if (import.meta.main) {
  main();
}
