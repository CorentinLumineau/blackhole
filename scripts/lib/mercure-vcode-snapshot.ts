#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { root } from '../checks/check-utils.ts';
import { readJsonFile } from './fs.ts';
import { parseFlags } from './argv-flags.ts';

// Issue #869 (plan Design Decisions D4, ADR-003) — vendors mercure's V-code severity/description
// tables into a committed JSON snapshot (documentation/audits/mercure-vcode-snapshot.json),
// consumed by scripts/checks/vcode-parity.check.ts. A maintainer runs this by hand against a
// local mercure clone (`.claude/skills/prj-mercure-sync/SKILL.md`'s sweep) — never invoked by
// `bun run verify` itself, since CorentinLumineau/mercure is a private repo with no cross-repo
// CI credential (`.blackhole/plans/issue-869-analysis.md` § Decisive finding).

export type MercureVcodeRow = { id: string; severity: string; description: string };

export type MercureVcodeSnapshot = {
  synced_at: string;
  mercure_version: string;
  mercure_commit: string | null;
  source_files: string[];
  codes: Record<string, { severity: string; description: string }>;
};

// mercure's own row shape — same split('|').map(trim) + length-guard *technique* as
// parseVcodeTableRows (check-common.ts, V-INT-02), applied to mercure's distinct 3-column
// `| ID | Severity | Description |` shape (blackhole's own table is a 4-column
// `| Code | Rule | Severity | Site |`, a different column interpretation, not a different
// technique — see plan Codebase Conventions). Header/separator rows are skipped by the first
// data cell's `V-` prefix, exactly like parseVcodeTableRows does for blackhole's table.
export const parseMercureVcodeTable = (content: string): MercureVcodeRow[] => {
  const rows: MercureVcodeRow[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 5) continue;
    const id = cells[1];
    if (!id.startsWith('V-')) continue;
    rows.push({ id, severity: cells[2], description: cells[3] });
  }
  return rows;
};

const MERCURE_VCODE_FILE_PATTERN = /^v-codes-.*\.md$/;

// Verified against mercure v9.15.0 (`.blackhole/plans/issue-869-analysis.md`): exactly 8 files,
// all sharing the identical 3-column header. A 9th file, or a file that parses to zero rows
// (its header shape changed), means this snapshot's shape assumption is no longer trustworthy —
// abort rather than silently write a partial or misattributed snapshot (plan Execution Strategy
// stop conditions).
const EXPECTED_MERCURE_VCODE_FILE_COUNT = 8;

/**
 * Reads mercure's 8 `v-codes-*.md` files from `<mercureRoot>/mercure-plugin/rules/references/`,
 * merges their rows into one `codes` map, and reads `mercureRoot`'s plugin version and (when
 * present) its git HEAD commit. Pure with respect to `mercureRoot` (never mutates it, never
 * writes anywhere) — the impure write step lives only in `main()` below.
 */
export const buildMercureVcodeSnapshot = (mercureRoot: string, now: Date = new Date()): MercureVcodeSnapshot => {
  const referencesDir = path.join(mercureRoot, 'mercure-plugin', 'rules', 'references');
  const fileNames = fs.existsSync(referencesDir)
    ? fs.readdirSync(referencesDir).filter((f) => MERCURE_VCODE_FILE_PATTERN.test(f)).sort()
    : [];

  if (fileNames.length !== EXPECTED_MERCURE_VCODE_FILE_COUNT) {
    throw new Error(
      `expected ${EXPECTED_MERCURE_VCODE_FILE_COUNT} v-codes-*.md files under ${referencesDir}, found ${fileNames.length}: ${fileNames.join(', ') || '(none)'}`,
    );
  }

  const sourceFiles = fileNames.map((f) => path.posix.join('mercure-plugin', 'rules', 'references', f));
  const codes: Record<string, { severity: string; description: string }> = {};

  for (const fileName of fileNames) {
    const content = fs.readFileSync(path.join(referencesDir, fileName), 'utf-8');
    const fileRows = parseMercureVcodeTable(content);
    if (fileRows.length === 0) {
      throw new Error(`${fileName}: no | ID | Severity | Description | rows found — table header shape may have changed`);
    }
    for (const fileRow of fileRows) {
      codes[fileRow.id] = { severity: fileRow.severity, description: fileRow.description };
    }
  }

  const pluginJsonPath = path.join(mercureRoot, 'mercure-plugin', '.claude-plugin', 'plugin.json');
  const pluginJson = readJsonFile(pluginJsonPath, `${mercureRoot} plugin.json`) as { version?: unknown };
  const mercureVersion = typeof pluginJson.version === 'string' ? pluginJson.version : '';

  // A non-git install must not crash the sync (plan Task 4) — catches and nulls on failure,
  // same spawnSync-status-check idiom as scripts/plugin-drift-signal.ts's readRepoHeadSha
  // (V-INT-01 — same technique; not imported directly, since scripts/lib/ modules never depend
  // on a scripts/ root module — that would invert the established lib/ ← scripts/ layering).
  let mercureCommit: string | null = null;
  try {
    const result = spawnSync('git', ['-C', mercureRoot, 'rev-parse', 'HEAD'], { encoding: 'utf-8' });
    if (result.status === 0) mercureCommit = result.stdout.trim();
  } catch {
    mercureCommit = null;
  }

  return {
    synced_at: now.toISOString(),
    mercure_version: mercureVersion,
    mercure_commit: mercureCommit,
    source_files: sourceFiles,
    codes,
  };
};

function usage(): never {
  console.error('Usage: bun run scripts/lib/mercure-vcode-snapshot.ts --mercure-root <path>');
  process.exit(2);
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  if (typeof flags['mercure-root'] !== 'string') usage();

  let snapshot: MercureVcodeSnapshot;
  try {
    snapshot = buildMercureVcodeSnapshot(flags['mercure-root']);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`mercure-vcode-snapshot: ${message}`);
    process.exit(1);
    return;
  }

  const outPath = path.join(root, 'documentation', 'audits', 'mercure-vcode-snapshot.json');
  fs.writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`mercure-vcode-snapshot: wrote ${Object.keys(snapshot.codes).length} codes to ${path.relative(root, outPath)}`);
}

if (import.meta.main) {
  main();
}
