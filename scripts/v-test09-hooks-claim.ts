#!/usr/bin/env bun
import * as fs from 'fs';
import { checkHooksOnlyClaimAdvisory } from './checks/v-test09-hooks-claim.check.ts';

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
  let filesFile: string | null = null;
  let claimFile: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--files-file' && argv[i + 1]) {
      filesFile = argv[++i];
    } else if (argv[i] === '--claim-file' && argv[i + 1]) {
      claimFile = argv[++i];
    }
  }
  return { filesFile, claimFile };
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
