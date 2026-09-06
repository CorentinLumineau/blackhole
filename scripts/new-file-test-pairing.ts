#!/usr/bin/env bun
import * as fs from 'fs';
import { findUnpairedNewSourceFiles } from './checks/new-file-test-pairing.check.ts';
import { parseFlags } from './lib/argv-flags.ts';

// CLI entrypoint wrapping new-file-test-pairing.check.ts's findUnpairedNewSourceFiles pure
// detector against real added/touched/base-tree file lists on disk (mirrors
// v-test09-hooks-claim.ts's CLI-over-pure-detectors split — invoked from
// src/references/audits/02-tdd-testing-baselines.md's "New-File Test-Pairing Backstop" bullet).
// Advisory-only: `ok` is always `true`; a non-empty `detail` is a signal to look closer, never a
// substitute for the reviewer's own V-TEST-01/02 judgment.

function usage(): never {
  console.error(
    'Usage: bun run scripts/new-file-test-pairing.ts --added-files <path> --touched-files <path> --base-tree-files <path>',
  );
  process.exit(2);
}

function readFileList(p: string): string[] {
  return fs
    .readFileSync(p, 'utf-8')
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

function parseCliArgs(argv: string[]): {
  addedFilesFile: string | null;
  touchedFilesFile: string | null;
  baseTreeFilesFile: string | null;
} {
  const flags = parseFlags(argv);
  return {
    addedFilesFile: typeof flags['added-files'] === 'string' ? flags['added-files'] : null,
    touchedFilesFile: typeof flags['touched-files'] === 'string' ? flags['touched-files'] : null,
    baseTreeFilesFile: typeof flags['base-tree-files'] === 'string' ? flags['base-tree-files'] : null,
  };
}

if (import.meta.main) {
  const { addedFilesFile, touchedFilesFile, baseTreeFilesFile } = parseCliArgs(process.argv.slice(2));
  if (!addedFilesFile || !touchedFilesFile || !baseTreeFilesFile) usage();

  const addedFiles = readFileList(addedFilesFile);
  const touchedFiles = readFileList(touchedFilesFile);
  const baseTreeFiles = readFileList(baseTreeFilesFile);

  const unpaired = findUnpairedNewSourceFiles(addedFiles, touchedFiles, baseTreeFiles);
  const result = {
    id: 'V-TEST-01',
    ok: true,
    ...(unpaired.length ? { detail: `unpaired new source files (no test at derived path): ${unpaired.join(', ')}` } : {}),
  };
  console.log(JSON.stringify(result, null, 2));
}
