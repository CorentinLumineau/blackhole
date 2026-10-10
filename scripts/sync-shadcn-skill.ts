#!/usr/bin/env bun
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { root } from './lib/build/paths.ts';
import { parseFlags } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';

// Maintainer re-sync for the official shadcn/ui skill (vendor/shadcn/). Same
// "hand-run, never invoked by bun run verify" posture as mercure-vcode-snapshot.ts.

export const SHADCN_UPSTREAM_REPO = 'shadcn-ui/ui';
export const SHADCN_SKILL_SOURCE_PATH = 'skills/shadcn';
export const SHADCN_VENDOR_DIR = 'vendor/shadcn';
export const SHADCN_COMMIT_RE = /^[0-9a-f]{40}$/;
export const SHADCN_DEFAULT_EXCLUDE = ['evals'] as const;

export type ShadcnUpstreamPin = {
  repo: string;
  source_path: string;
  commit: string;
  fetched_at: string;
  license: string;
  license_file: string;
  docs: string;
  exclude: string[];
  files: string[];
};

export const vendorPaths = (repoRoot: string = root) => {
  const vendorDir = path.join(repoRoot, SHADCN_VENDOR_DIR);
  return {
    vendorDir,
    pinPath: path.join(vendorDir, 'upstream.json'),
    licensePath: path.join(vendorDir, 'LICENSE.md'),
    skillDir: path.join(vendorDir, 'skill'),
  };
};

export const parseCommitSha = (value: string): string => {
  const sha = value.trim().toLowerCase();
  if (!SHADCN_COMMIT_RE.test(sha)) {
    throw new Error(`invalid commit SHA "${value}": expected 40 hex chars`);
  }
  return sha;
};

export const shouldIncludeSkillRelPath = (
  relPath: string,
  exclude: readonly string[] = SHADCN_DEFAULT_EXCLUDE
): boolean => {
  const posix = relPath.split(path.sep).join('/');
  if (posix === '' || posix.endsWith('/')) return false;
  return !exclude.some((dir) => posix === dir || posix.startsWith(`${dir}/`));
};

export const listSkillFiles = (skillDir: string, exclude: readonly string[] = SHADCN_DEFAULT_EXCLUDE): string[] => {
  const files: string[] = [];
  const walk = (abs: string, rel: string) => {
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (!shouldIncludeSkillRelPath(childRel + (entry.isDirectory() ? '/' : ''), exclude) && entry.isDirectory()) {
        if (exclude.includes(entry.name)) continue;
      }
      if (entry.isDirectory()) {
        walk(path.join(abs, entry.name), childRel);
        continue;
      }
      if (shouldIncludeSkillRelPath(childRel, exclude)) files.push(childRel);
    }
  };
  walk(skillDir, '');
  return files.sort();
};

export const readUpstreamPin = (pinPath: string): ShadcnUpstreamPin => {
  const pin = readJsonFile(pinPath, pinPath) as ShadcnUpstreamPin;
  parseCommitSha(pin.commit);
  if (!Array.isArray(pin.files) || pin.files.length === 0) {
    throw new Error(`${pinPath}: files[] must be a non-empty array`);
  }
  return pin;
};

export const buildUpstreamPin = (input: {
  commit: string;
  files: string[];
  fetchedAt?: Date;
  exclude?: string[];
}): ShadcnUpstreamPin => ({
  repo: SHADCN_UPSTREAM_REPO,
  source_path: SHADCN_SKILL_SOURCE_PATH,
  commit: parseCommitSha(input.commit),
  fetched_at: (input.fetchedAt ?? new Date()).toISOString(),
  license: 'MIT',
  license_file: 'LICENSE.md',
  docs: 'https://ui.shadcn.com/docs/skills',
  exclude: input.exclude ?? [...SHADCN_DEFAULT_EXCLUDE],
  files: [...input.files].sort(),
});

export const tarballUrl = (commit: string): string =>
  `https://github.com/${SHADCN_UPSTREAM_REPO}/archive/${parseCommitSha(commit)}.tar.gz`;

export const extractSkillFromArchiveRoot = (
  archiveRoot: string,
  destSkillDir: string,
  destLicensePath: string,
  exclude: readonly string[] = SHADCN_DEFAULT_EXCLUDE
): string[] => {
  const skillSrc = path.join(archiveRoot, SHADCN_SKILL_SOURCE_PATH);
  const licenseSrc = path.join(archiveRoot, 'LICENSE.md');
  if (!fs.existsSync(path.join(skillSrc, 'SKILL.md'))) {
    throw new Error(`archive is missing ${SHADCN_SKILL_SOURCE_PATH}/SKILL.md`);
  }
  if (!fs.existsSync(licenseSrc)) {
    throw new Error('archive is missing LICENSE.md');
  }
  if (fs.existsSync(destSkillDir)) fs.rmSync(destSkillDir, { recursive: true, force: true });
  fs.mkdirSync(destSkillDir, { recursive: true });
  copyFiltered(skillSrc, destSkillDir, '', exclude);
  fs.mkdirSync(path.dirname(destLicensePath), { recursive: true });
  fs.copyFileSync(licenseSrc, destLicensePath);
  return listSkillFiles(destSkillDir, exclude);
};

const copyFiltered = (srcDir: string, destDir: string, rel: string, exclude: readonly string[]) => {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (exclude.includes(entry.name)) continue;
      const nextDest = path.join(destDir, entry.name);
      fs.mkdirSync(nextDest, { recursive: true });
      copyFiltered(path.join(srcDir, entry.name), nextDest, childRel, exclude);
      continue;
    }
    if (!shouldIncludeSkillRelPath(childRel, exclude)) continue;
    fs.copyFileSync(path.join(srcDir, entry.name), path.join(destDir, entry.name));
  }
};

const run = (command: string, args: string[], cwd?: string) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout || result.status}`);
  }
};

export const fetchAndExtract = (commit: string, dest: ReturnType<typeof vendorPaths>): string[] => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shadcn-skill-'));
  try {
    const tarball = path.join(tmp, 'ui.tar.gz');
    run('curl', ['-fsSL', tarballUrl(commit), '-o', tarball]);
    run('tar', ['-xzf', tarball, '-C', tmp]);
    const archiveRoot = fs.readdirSync(tmp).find((name) => name.startsWith('ui-') && fs.statSync(path.join(tmp, name)).isDirectory());
    if (!archiveRoot) throw new Error('tarball did not contain an ui-* root directory');
    return extractSkillFromArchiveRoot(
      path.join(tmp, archiveRoot),
      dest.skillDir,
      dest.licensePath
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};

function usage(): never {
  console.error('Usage: bun run scripts/sync-shadcn-skill.ts [--commit <sha>]');
  process.exit(2);
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.commit === true) usage();
  const dest = vendorPaths();
  const existing = fs.existsSync(dest.pinPath) ? readUpstreamPin(dest.pinPath) : null;
  const commit = typeof flags.commit === 'string' ? parseCommitSha(flags.commit) : existing?.commit;
  if (!commit) {
    throw new Error('no --commit and no existing vendor/shadcn/upstream.json pin');
  }
  const files = fetchAndExtract(commit, dest);
  const pin = buildUpstreamPin({ commit, files });
  fs.writeFileSync(dest.pinPath, `${JSON.stringify(pin, null, 2)}\n`);
  console.log(`sync-shadcn-skill: pinned ${commit} (${files.length} files) → ${path.relative(root, dest.vendorDir)}`);
}

if (import.meta.main) {
  main();
}
