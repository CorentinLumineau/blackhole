import * as path from 'path';
import { EXPECTED_CHECK_COUNT } from './build.ts';

// ADR-007 T5/R2': verify.ts is a thin runner — glob-discovers scripts/checks/*.check.ts (sorted,
// deterministic order), dynamically imports each module, calls its exported runChecks(), and
// concatenates the CheckResult[]s. No central registry file (the critics' binding rejection of a
// check-registry hub): adding a new domain means adding a new scripts/checks/{domain}.check.ts
// file with a runChecks() export — this runner never changes.

type CheckResult = { id: string; ok: boolean; detail?: string };

const root = path.resolve(import.meta.dirname, '..');
const checksDir = path.join(root, 'scripts', 'checks');

const discoverCheckModules = (): string[] =>
  [...new Bun.Glob('*.check.ts').scanSync({ cwd: checksDir })].sort();

const main = async () => {
  console.log('blackhole verify\n');

  const results: CheckResult[] = [];
  for (const file of discoverCheckModules()) {
    const mod = await import(path.join(checksDir, file));
    if (typeof mod.runChecks !== 'function') {
      throw new Error(`scripts/checks/${file}: missing runChecks() export`);
    }
    results.push(...(mod.runChecks() as CheckResult[]));
  }

  if (results.length !== EXPECTED_CHECK_COUNT) {
    console.warn(`Warning: expected ${EXPECTED_CHECK_COUNT} checks, ran ${results.length}`);
  }

  let failed = 0;
  for (const r of results) {
    const icon = r.ok ? '✓' : '✗';
    console.log(`  ${icon} ${r.id}${r.detail ? ` — ${r.detail}` : ''}`);
    if (!r.ok) failed++;
  }

  console.log(`\n${results.length - failed}/${results.length} checks passed`);

  if (failed > 0) process.exit(1);
};

if (import.meta.main) {
  await main();
}
