import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';

// Issue #679: enforce ADR-027 routing — all `gh` spawns live in forge-adapter/cli.ts only.

const ADAPTER_CLI = path.join(root, 'scripts', 'lib', 'forge-adapter', 'cli.ts');
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

/** Direct gh spawn is permitted only inside forge-adapter/cli.ts (ADR-027, #679). */
export const findBareGhSpawns = (files: string[]): string[] => {
  const violations: string[] = [];
  const allowed = ADAPTER_CLI;

  for (const file of files) {
    if (file === allowed) continue;
    const content = fs.readFileSync(file, 'utf-8');
    if (/spawnSync\(\s*['"]gh['"]/.test(content)) {
      violations.push(path.relative(root, file));
    }
    if (/spawn\(\s*['"]gh['"]/.test(content)) {
      violations.push(path.relative(root, file));
    }
  }
  return violations;
};

const checkBareGhSpawns = (): CheckResult => {
  const scriptFiles = walkTsFiles(SCRIPTS_DIR).filter(
    (f) => !f.includes(`${path.sep}checks${path.sep}`),
  );
  const violations = findBareGhSpawns(scriptFiles);
  if (violations.length > 0) {
    return {
      id: 'V-FORGE-01',
      ok: false,
      detail: `bare gh spawn outside forge-adapter/cli.ts: ${violations.join(', ')}`,
    };
  }
  return { id: 'V-FORGE-01', ok: true };
};

export function runChecks(): CheckResult[] {
  return [checkBareGhSpawns()];
}
