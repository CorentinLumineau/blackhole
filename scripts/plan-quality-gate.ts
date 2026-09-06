#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import {
  findMissingCriticalFiles,
  findVagueMitigations,
  splitTaskBreakdownBullets,
} from './checks/plan-quality-gate.check.ts';

// Issue #716 (R-11) — CLI entrypoint wrapping plan-quality-gate.check.ts's exported pure
// detectors against a real plan file on disk. Invoked from `planner.md` Step 8 in place of the
// prior manual Glob/word-list re-derivation; see that step for the invocation contract.

// `ac_mapping` has no existing exported detector — reuses the already-exported
// splitTaskBreakdownBullets rather than inventing a new parsing primitive (Design Decision,
// documentation/plans/plan-retrospective-v0.21.0-remediation.md § R-11).
export const findMissingAcMapping = (taskBreakdownSection: string): string[] =>
  splitTaskBreakdownBullets(taskBreakdownSection)
    .filter((t) => !/\*\*AC\*\*:/.test(t.text))
    .map((t) => t.label);

// Same "next `## ` line or EOF" boundary rule as content-gates.check.ts's parseSectionLineCounts,
// simplified to a single heading returning section text rather than a full line-count map.
export const extractSection = (content: string, heading: string): string => {
  const lines = content.split('\n');
  const start = lines.findIndex((l) => l === `## ${heading}`);
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
};

function usage(): never {
  console.error(
    'Usage: bun run --cwd <abs repo-root> scripts/plan-quality-gate.ts --plan-file <path> --repo-root <abs repo-root>'
  );
  process.exit(2);
}

function parseCliArgs(argv: string[]): { planFile: string | null; repoRoot: string | null } {
  let planFile: string | null = null;
  let repoRoot: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--plan-file' && argv[i + 1]) {
      planFile = argv[++i];
    } else if (argv[i] === '--repo-root' && argv[i + 1]) {
      repoRoot = argv[++i];
    }
  }
  return { planFile, repoRoot };
}

if (import.meta.main) {
  const { planFile, repoRoot } = parseCliArgs(process.argv.slice(2));
  if (!planFile) usage();
  // Required and absolute — same convention as check-review-artifact.ts's ABSOLUTE_PATH_KEYS
  // (issue #806 AC4). A silent default to blackhole's own checkout is exactly the false-pass
  // bug this flag exists to close (issue #891), so there is no fallback here.
  if (!repoRoot || !path.isAbsolute(repoRoot)) usage();

  const content = fs.readFileSync(planFile, 'utf-8');
  const exists = (p: string) => fs.existsSync(path.join(repoRoot, p));
  const result = {
    ac_mapping: findMissingAcMapping(extractSection(content, 'Task Breakdown')).length === 0,
    critical_files_exist:
      findMissingCriticalFiles(extractSection(content, 'Critical Files'), exists).length === 0,
    mitigation_concrete:
      findVagueMitigations(extractSection(content, 'Execution Strategy & Stop Conditions')).length === 0,
  };
  console.log(JSON.stringify(result, null, 2));
}
