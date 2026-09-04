import * as fs from 'fs';
import * as path from 'path';
import { parseMdFrontmatter } from './lib/build/content.ts';
import { parseIndexTableRows, walkMdFilesAbs } from './lib/check-common.ts';
import { root } from './checks/check-utils.ts';

// Issue #811 (ADR-031 Phase 1, Task 7/8) — one-time migration CLI: computes {path, summary}
// pairs by joining the live documentation/INDEX.md rows with each doc's current frontmatter,
// then inserts a YAML-safe `summary:` field into every doc missing one. Idempotent — a doc that
// already has a non-empty `summary:` is left untouched (skipped: true). All-or-nothing per
// file: a doc whose frontmatter cannot be round-trip-parsed before or after insertion is left
// completely untouched and reported in the exceptions list instead of force-written (Execution
// Strategy stop condition — a mismatched/dropped summary here is exactly the "malformed/dropped
// frontmatter could silently misrender a row" risk the Design Track's blind critics flagged).

export type SummaryMigrationEntry = { path: string; summary: string; skipped: boolean };
export type MigrationException = { path: string; reason: string };
export type MigrationResult = { migrated: string[]; exceptions: MigrationException[] };

const isExcludedPath = (relPath: string): boolean =>
  relPath === 'INDEX.md' || relPath.startsWith('decisions/') || relPath.startsWith('milestones/_archived/');

// Same JSON-as-YAML-double-quoted-scalar convention doc-index-generate.ts's decodeYamlScalar
// uses — a language builtin, not a second repo-owned parser (V-INT-02).
const decodeYamlScalar = (raw: string): string => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};
const encodeYamlScalar = (value: string): string => JSON.stringify(value);

const readFrontmatterField = (frontmatter: string, key: string): string | undefined => {
  const line = frontmatter.split('\n').find((l) => new RegExp(`^${key}:\\s*`).test(l));
  if (line === undefined) return undefined;
  return line.replace(new RegExp(`^${key}:\\s*`), '').trim();
};

// Joins each in-scope doc's current frontmatter against the live INDEX.md rows; a doc already
// carrying a non-empty `summary:` is skipped (idempotent no-op). A doc with no matching INDEX.md
// row is also skipped — it is a pre-existing V-DOCHEALTH-02 orphan, out of this plan's scope
// (flagged, not fixed — Touch-Paths note), not a migration failure.
export const computeSummaryMigrationPlan = (docsDir: string, indexContent: string): SummaryMigrationEntry[] => {
  const indexRows = new Map(parseIndexTableRows(indexContent).map((r) => [r.path, r.summary]));

  return walkMdFilesAbs(docsDir)
    .map((abs) => path.relative(docsDir, abs).split(path.sep).join('/'))
    .filter((relPath) => !isExcludedPath(relPath))
    .map((relPath): SummaryMigrationEntry => {
      const content = fs.readFileSync(path.join(docsDir, relPath), 'utf-8');
      const { frontmatter } = parseMdFrontmatter(content);
      const existingSummary = readFrontmatterField(frontmatter, 'summary');
      if (existingSummary && existingSummary.trim() !== '') {
        return { path: relPath, summary: decodeYamlScalar(existingSummary), skipped: true };
      }
      const rowSummary = indexRows.get(relPath);
      if (rowSummary === undefined) {
        return { path: relPath, summary: '', skipped: true };
      }
      return { path: relPath, summary: rowSummary, skipped: false };
    });
};

// Inserts `summary: "<escaped>"` immediately after each doc's `type:` frontmatter line, for
// every non-skipped plan entry. All-or-nothing per file: a doc whose frontmatter has no
// parseable block, no `type:` line, or fails a post-insertion round-trip re-parse is left
// completely untouched and reported in `exceptions` — never partially written.
export const applySummaryMigration = (docsDir: string, plan: SummaryMigrationEntry[]): MigrationResult => {
  const migrated: string[] = [];
  const exceptions: MigrationException[] = [];

  for (const entry of plan) {
    if (entry.skipped) continue;

    const abs = path.join(docsDir, entry.path);
    const content = fs.readFileSync(abs, 'utf-8');
    const { frontmatter, body } = parseMdFrontmatter(content);
    if (!frontmatter) {
      exceptions.push({ path: entry.path, reason: 'no parseable frontmatter block' });
      continue;
    }

    const lines = frontmatter.split('\n');
    const typeIdx = lines.findIndex((l) => /^type:\s*/.test(l));
    if (typeIdx === -1) {
      exceptions.push({ path: entry.path, reason: 'no type: line found in frontmatter' });
      continue;
    }

    const newLines = [...lines];
    newLines.splice(typeIdx + 1, 0, `summary: ${encodeYamlScalar(entry.summary)}`);
    const newContent = `---\n${newLines.join('\n')}\n---\n${body}`;

    const reparsedSummary = readFrontmatterField(parseMdFrontmatter(newContent).frontmatter, 'summary');
    if (reparsedSummary === undefined || decodeYamlScalar(reparsedSummary) !== entry.summary) {
      exceptions.push({ path: entry.path, reason: 'post-insertion round-trip mismatch' });
      continue;
    }

    fs.writeFileSync(abs, newContent, 'utf-8');
    migrated.push(entry.path);
  }

  return { migrated, exceptions };
};

function main(): void {
  const docsDir = path.join(root, 'documentation');
  const indexContent = fs.readFileSync(path.join(docsDir, 'INDEX.md'), 'utf-8');
  const plan = computeSummaryMigrationPlan(docsDir, indexContent);
  const result = applySummaryMigration(docsDir, plan);

  console.log(`migrate-doc-index-summaries: migrated ${result.migrated.length} doc(s)`);
  const skippedCount = plan.filter((e) => e.skipped).length;
  console.log(`migrate-doc-index-summaries: skipped ${skippedCount} doc(s) (already had summary, or no INDEX.md row)`);

  if (result.exceptions.length > 0) {
    console.error(`migrate-doc-index-summaries: ${result.exceptions.length} exception(s):`);
    for (const e of result.exceptions) console.error(`  ${e.path}: ${e.reason}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
