#!/usr/bin/env bun
import * as fs from 'fs';
import { checkHooksOnlyClaimAdvisory } from './checks/v-test09-hooks-claim.check.ts';
import { parseFlags } from './lib/argv-flags.ts';

// issue #787 — CLI entrypoint wrapping v-test09-hooks-claim.check.ts's checkHooksOnlyClaimAdvisory
// pure detector against real changed-file/claim-text input on disk (mirrors plan-quality-gate.ts's
// CLI-over-pure-detectors split — invoked from reviewer.md § 30's "Mechanical backstop" bullet).

function usage(): never {
  console.error(
    'Usage: bun run scripts/v-test09-hooks-claim.ts --files-file <path> --claim-file <path>',
  );
  process.exit(2);
}

function parseCliArgs(argv: string[]): { filesFile: string | null; claimFile: string | null } {
  const flags = parseFlags(argv);
  return {
    filesFile: typeof flags['files-file'] === 'string' ? flags['files-file'] : null,
    claimFile: typeof flags['claim-file'] === 'string' ? flags['claim-file'] : null,
  };
}

if (import.meta.main) {
  const { filesFile, claimFile } = parseCliArgs(process.argv.slice(2));
  if (!filesFile || !claimFile) usage();

  const files = fs
    .readFileSync(filesFile, 'utf-8')
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  const claimText = fs.readFileSync(claimFile, 'utf-8');

  const result = checkHooksOnlyClaimAdvisory(files, claimText);
  console.log(JSON.stringify(result, null, 2));
}
