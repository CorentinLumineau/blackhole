import * as path from 'path';
import { type CheckResult } from './checks/check-utils.ts';

// ADR-007 T5/R2': verify.ts is a thin runner — glob-discovers scripts/checks/*.check.ts (sorted,
// deterministic order), dynamically imports each module, calls its exported runChecks(), and
// concatenates the CheckResult[]s. No central registry file (the critics' binding rejection of a
// check-registry hub): adding a new domain means adding a new scripts/checks/{domain}.check.ts
// file with a runChecks() export — this runner never changes.

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

export function formatVerifyResultLine(r: CheckResult): string {
  const icon = r.ok ? '✓' : '✗';
  return `  ${icon} ${r.id}${r.detail ? ` — ${r.detail}` : ''}`;
}

export function formatVerifySummary(results: CheckResult[]): string {
  const failed = results.filter((r) => !r.ok).length;
  return `\n${results.length - failed}/${results.length} checks passed`;
}

export async function runVerifyMain(options?: { checksDir?: string }): Promise<number> {
  console.log('blackhole verify\n');

  const results = await runVerifyChecks(options);

  for (const r of results) {
    console.log(formatVerifyResultLine(r));
  }

  console.log(formatVerifySummary(results));

  return exitCodeFromVerifyResults(results);
}

export async function main(options?: { checksDir?: string }): Promise<void> {
  process.exit(await runVerifyMain(options));
}

if (import.meta.main) {
  await main();
}
