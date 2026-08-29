import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';

// Issue #679/#680/#681: forge CLI spawns only in forge-adapter/*-cli.ts.

const SCRIPTS_DIR = path.join(root, 'scripts');

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walkTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

type CliName = 'gh' | 'tea' | 'glab';

const CLI_ALLOWLIST: Record<CliName, string> = {
  gh: path.join(root, 'scripts', 'lib', 'forge-adapter', 'cli.ts'),
  tea: path.join(root, 'scripts', 'lib', 'forge-adapter', 'tea-cli.ts'),
  glab: path.join(root, 'scripts', 'lib', 'forge-adapter', 'glab-cli.ts'),
};

export const findBareForgeCliSpawns = (files: string[]): string[] => {
  const violations: string[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    for (const cli of ['gh', 'tea', 'glab'] as CliName[]) {
      const allow = CLI_ALLOWLIST[cli];
      if (!fs.existsSync(allow)) continue;
      if (file === allow) continue;
      const pattern = new RegExp(`spawnSync\\(\\s*['"]${cli}['"]`);
      if (pattern.test(content)) {
        violations.push(`${path.relative(root, file)} (${cli})`);
      }
    }
  }
  return violations;
};

const checkBareForgeCliSpawns = (): CheckResult => {
  const scriptFiles = walkTsFiles(SCRIPTS_DIR).filter(
    (f) => !f.includes(`${path.sep}checks${path.sep}`),
  );
  const violations = findBareForgeCliSpawns(scriptFiles);
  if (violations.length > 0) {
    return {
      id: 'V-FORGE-01',
      ok: false,
      detail: `bare forge CLI spawn outside forge-adapter/*-cli.ts: ${violations.join(', ')}`,
    };
  }
  return { id: 'V-FORGE-01', ok: true };
};

export function runChecks(): CheckResult[] {
  return [checkBareForgeCliSpawns()];
}

export const findBareGhSpawns = findBareForgeCliSpawns;
