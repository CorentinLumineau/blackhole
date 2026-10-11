#!/usr/bin/env bun
import * as fs from 'fs';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import {
  classifyMergeRisk,
  filesFromNameStatus,
  parseMergeRiskSnapshot,
  patchesFromUnifiedDiff,
} from './lib/merge-gate/merge-risk.ts';

// Merge-gate low-risk classifier (merge-gate.md § 9). Exit 0 automerge, 1 needs-chef hold, 2 usage.

const USAGE =
  'Usage: bun run scripts/merge-risk.ts --files <json>\n' +
  '       bun run scripts/merge-risk.ts --name-status <file> [--patches <diff>] [--head-ref <branch>]\n' +
  '  --files: JSON { files: [{path, status}], patches?, headRef? }\n' +
  '  --name-status: git / gh pr diff --name-status output\n' +
  'Exit 0 automerge (low-risk campaign PR), 1 needs-chef hold, 2 usage';

const KNOWN = ['files', 'name-status', 'patches', 'head-ref'];

const main = (): number => {
  const flags = parseFlags(process.argv.slice(2));
  if (unknownFlagKeys(flags, KNOWN).length) {
    console.error(USAGE);
    return 2;
  }

  let files;
  let patches;
  let headRef: string | undefined;
  try {
    if (typeof flags.files === 'string') {
      if (flags['name-status'] || flags.patches) {
        console.error(`--files cannot be combined with --name-status or --patches\n${USAGE}`);
        return 2;
      }
      const parsed = parseMergeRiskSnapshot(readJsonFile(flags.files, flags.files));
      files = parsed.files;
      patches = parsed.patches;
      headRef = parsed.headRef;
    } else if (typeof flags['name-status'] === 'string') {
      files = filesFromNameStatus(fs.readFileSync(flags['name-status'], 'utf-8'));
      if (typeof flags.patches === 'string') {
        patches = patchesFromUnifiedDiff(fs.readFileSync(flags.patches, 'utf-8'));
      }
    } else {
      console.error(USAGE);
      return 2;
    }
    if (typeof flags['head-ref'] === 'string') headRef = flags['head-ref'];
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }

  const result = classifyMergeRisk({ files, patches, headRef });
  console.log(JSON.stringify(result));
  return result.automerge ? 0 : 1;
};

if (import.meta.main) process.exit(main());
