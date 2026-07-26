import * as path from 'path';
import { EXPECTED_CHECK_COUNT } from './build.ts';

// ADR-007 T5/R2': verify.ts is a thin runner — glob-discovers scripts/checks/*.check.ts (sorted,
// deterministic order), dynamically imports each module, calls its exported runChecks(), and
// concatenates the CheckResult[]s. No central registry file (the critics' binding rejection of a
// check-registry hub): adding a new domain means adding a new scripts/checks/{domain}.check.ts
// file with a runChecks() export — this runner never changes.

type CheckResult = { id: string; ok: boolean; detail?: string };

const defaultChecksDir = path.join(path.resolve(import.meta.dirname, '..'), 'scripts', 'checks');

export function discoverCheckModules(checksDir: string): string[] {
  return [...new Bun.Glob('*.check.ts').scanSync({ cwd: checksDir })].sort();
}

export async function runVerifyChecks(options?: { checksDir?: string }): Promise<CheckResult[]> {
  const dir = options?.checksDir ?? defaultChecksDir;
  const results: CheckResult[] = [];
  for (const file of discoverCheckModules(dir)) {
    const mod = await import(path.join(dir, file));
    if (typeof mod.runChecks !== 'function') {
      throw new Error(`scripts/checks/${file}: missing runChecks() export`);
    }
    results.push(...(mod.runChecks() as CheckResult[]));
  }
  return results;
}

export function exitCodeFromVerifyResults(results: CheckResult[]): number {
  return results.some((r) => !r.ok) ? 1 : 0;
}

export function warnOnCheckCountMismatch(results: CheckResult[], expected: number): void {
  if (results.length !== expected) {
    console.warn(`Warning: expected ${expected} checks, ran ${results.length}`);
  }
}

const main = async () => {
  console.log('blackhole verify\n');

  const results = await runVerifyChecks();
  warnOnCheckCountMismatch(results, EXPECTED_CHECK_COUNT);

  let failed = 0;
  for (const r of results) {
    const icon = r.ok ? '✓' : '✗';
    console.log(`  ${icon} ${r.id}${r.detail ? ` — ${r.detail}` : ''}`);
    if (!r.ok) failed++;
  }

  console.log(`\n${results.length - failed}/${results.length} checks passed`);

  process.exit(exitCodeFromVerifyResults(results));
};

if (import.meta.main) {
  await main();
}
