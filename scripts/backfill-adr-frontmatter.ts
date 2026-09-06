#!/usr/bin/env bun
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { parseMdFrontmatter, parseFrontmatterFields } from './lib/build/content.ts';
import { parseIndexTableRows, walkMdFilesAbs } from './lib/check-common.ts';
import { parseFlags } from './lib/argv-flags.ts';
import { root } from './checks/check-utils.ts';

// Issue #923 — one-time migration CLI: backfills the six `doc-governance.md` lifecycle
// frontmatter keys (type, summary, status, review_trigger, created, last_updated) onto every
// `documentation/decisions/ADR-*.md` file missing at least one. `status` is always present
// already and is never touched (governed separately by V-ADR-01). `type` is the constant "adr"
// for every file in this folder. `summary`/`review_trigger` are copied verbatim from the file's
// existing `documentation/decisions/INDEX.md` row — not authored — because doc-governance.md
// requires frontmatter `summary` to equal its INDEX row, and copying guarantees that rather than
// risking drift across 37 hand-authored values. `created`/`last_updated` are derived from git
// history via an injected dateLookup callback, kept out of the pure planning function below so
// its own test suite never needs to shell out to git (mirrors the ADR-031 precedent,
// scripts/migrate-doc-index-summaries.ts, which separates its pure plan function from its CLI's
// real I/O the same way).
//
// This is a new script, not an extension of migrate-doc-index-summaries.ts: that script's
// isExcludedPath explicitly excludes decisions/** (scoped away from ADRs on purpose — ADR-031
// predates the ADR lifecycle-frontmatter requirement), and this migration's key set (5 keys,
// two independent sources: INDEX.md rows and git history) is materially different from that
// script's single-field, single-source shape. It reuses that precedent's own conventions instead
// of reinventing them (V-INT-01/V-INT-02): parseMdFrontmatter, parseIndexTableRows, and the
// JSON.stringify/JSON.parse YAML-double-quoted-scalar idiom (a language builtin, not a second
// repo-owned YAML parser).
//
// Kept in the tree after use, unwired from package.json/verify — same precedent as
// migrate-doc-index-summaries.ts, which is still present, dormant, and unreferenced. A future
// auditor asking "how was this frontmatter derived" gets a runnable answer.

const REQUIRED_KEYS = ['type', 'summary', 'status', 'review_trigger', 'created', 'last_updated'] as const;
type RequiredKey = (typeof REQUIRED_KEYS)[number];

export type AdrFrontmatterFields = {
  type: string;
  summary: string;
  status: string;
  reviewTrigger: string;
  created: string;
  lastUpdated: string;
};

export type AdrBackfillEntry = {
  path: string;
  skipped: boolean;
  addedKeys: string[];
  fields?: AdrFrontmatterFields;
};

export type AdrBackfillException = { path: string; reason: string };

export type AdrBackfillPlan = {
  entries: AdrBackfillEntry[];
  exceptions: AdrBackfillException[];
};

export type DateLookup = (relPath: string) => { created: string; lastUpdated: string } | null;

// Same JSON-as-YAML-double-quoted-scalar convention as scripts/lib/doc-index-generate.ts and
// scripts/migrate-doc-index-summaries.ts (V-INT-02) — JSON.stringify/JSON.parse is a strict
// subset of YAML's double-quoted scalar syntax, so a value containing a colon, a double quote,
// or a backtick round-trips safely through a single frontmatter line.
const decodeYamlScalar = (raw: string): string => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};
const encodeYamlScalar = (value: string): string => JSON.stringify(value);

const adrRelPaths = (adrDir: string): string[] =>
  walkMdFilesAbs(adrDir)
    .map((abs) => path.relative(adrDir, abs).split(path.sep).join('/'))
    .filter((relPath) => relPath !== 'INDEX.md')
    .sort();

// Joins each ADR's current frontmatter against the live documentation/decisions/INDEX.md rows
// and an injected dateLookup for git-derived dates. All-or-nothing per file: a file missing
// summary/review_trigger with no matching INDEX.md row, or missing created/last_updated with an
// unresolvable dateLookup, is reported in `exceptions` and never partially planned (Migration
// Design Notes — "a file... is left completely untouched and reported in an exceptions list
// rather than partially written").
export const computeAdrFrontmatterBackfillPlan = (
  adrDir: string,
  indexContent: string,
  dateLookup: DateLookup,
): AdrBackfillPlan => {
  const indexRows = new Map(parseIndexTableRows(indexContent).map((r) => [r.path, r]));
  const entries: AdrBackfillEntry[] = [];
  const exceptions: AdrBackfillException[] = [];

  for (const relPath of adrRelPaths(adrDir)) {
    const content = fs.readFileSync(path.join(adrDir, relPath), 'utf-8');
    const fm = parseFrontmatterFields(parseMdFrontmatter(content).frontmatter);

    const missing = REQUIRED_KEYS.filter((k) => fm[k] === undefined);
    if (missing.length === 0) {
      entries.push({ path: relPath, skipped: true, addedKeys: [] });
      continue;
    }

    if (fm.status === undefined) {
      exceptions.push({ path: relPath, reason: 'no status: field found (should already be present on every ADR)' });
      continue;
    }

    let summary = fm.summary !== undefined ? decodeYamlScalar(fm.summary) : undefined;
    let reviewTrigger = fm.review_trigger !== undefined ? decodeYamlScalar(fm.review_trigger) : undefined;

    if (summary === undefined || reviewTrigger === undefined) {
      const indexRow = indexRows.get(relPath);
      if (!indexRow) {
        exceptions.push({ path: relPath, reason: 'no matching documentation/decisions/INDEX.md row' });
        continue;
      }
      if (summary === undefined) summary = indexRow.summary;
      if (reviewTrigger === undefined) reviewTrigger = indexRow.reviewTrigger;
    }

    let created = fm.created;
    let lastUpdated = fm.last_updated;
    if (created === undefined || lastUpdated === undefined) {
      const looked = dateLookup(relPath);
      if (!looked) {
        exceptions.push({ path: relPath, reason: 'creation/last-updated date unresolvable via git history' });
        continue;
      }
      if (created === undefined) created = looked.created;
      if (lastUpdated === undefined) lastUpdated = looked.lastUpdated;
    }

    entries.push({
      path: relPath,
      skipped: false,
      addedKeys: [...missing],
      fields: {
        type: fm.type ?? 'adr',
        summary,
        status: fm.status,
        reviewTrigger,
        created,
        lastUpdated,
      },
    });
  }

  return { entries, exceptions };
};

const renderKeyLine = (key: RequiredKey, fields: AdrFrontmatterFields): string => {
  switch (key) {
    case 'type':
      return `type: ${fields.type}`;
    case 'summary':
      return `summary: ${encodeYamlScalar(fields.summary)}`;
    case 'status':
      return `status: ${fields.status}`;
    case 'review_trigger':
      return `review_trigger: ${encodeYamlScalar(fields.reviewTrigger)}`;
    case 'created':
      return `created: ${fields.created}`;
    case 'last_updated':
      return `last_updated: ${fields.lastUpdated}`;
  }
};

// Surgically splices only the missing keys into the existing frontmatter line array, each
// inserted immediately after the nearest preceding required key already present (or at the very
// top when none precede it yet) — it never regenerates or reorders a line that already exists.
//
// This is the load-bearing safety property for "preserve every existing value": a literal
// full-block regeneration to a canonical 6-line frontmatter would silently drop every ADR's
// non-required frontmatter keys (`related:` multi-line lists, `tracking_initiative:`, `scope:`,
// `supersedes:` — all widely present across this corpus, confirmed by a full-corpus scan before
// writing this function). Splicing only the missing lines in place, leaving every other line
// byte-for-byte untouched, is strictly safer and still produces the canonical relative order for
// the six required keys (Decision Record, PR body).
export const insertMissingFrontmatterKeys = (
  frontmatterLines: string[],
  fields: AdrFrontmatterFields,
  addedKeys: string[],
): string[] => {
  const added = new Set(addedKeys);
  const lines = [...frontmatterLines];
  let insertAfter = -1;
  for (const key of REQUIRED_KEYS) {
    const existingIdx = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
    if (existingIdx !== -1) {
      insertAfter = existingIdx;
      continue;
    }
    if (!added.has(key)) continue;
    const insertPos = insertAfter + 1;
    lines.splice(insertPos, 0, renderKeyLine(key, fields));
    insertAfter = insertPos;
  }
  return lines;
};

export type ApplyResult = { migrated: string[]; exceptions: AdrBackfillException[] };

// Writes every non-skipped plan entry. All-or-nothing per file: a file whose frontmatter cannot
// be round-trip-parsed before or after the edit is left completely untouched and reported in
// `exceptions` instead of force-written (same precedent-script guarantee as
// migrate-doc-index-summaries.ts's applySummaryMigration).
export const applyAdrFrontmatterBackfill = (adrDir: string, entries: AdrBackfillEntry[]): ApplyResult => {
  const migrated: string[] = [];
  const exceptions: AdrBackfillException[] = [];

  for (const entry of entries) {
    if (entry.skipped || !entry.fields) continue;
    const fields = entry.fields;

    const abs = path.join(adrDir, entry.path);
    const content = fs.readFileSync(abs, 'utf-8');
    const { frontmatter, body } = parseMdFrontmatter(content);
    if (!frontmatter) {
      exceptions.push({ path: entry.path, reason: 'no parseable frontmatter block' });
      continue;
    }

    const newLines = insertMissingFrontmatterKeys(frontmatter.split('\n'), fields, entry.addedKeys);
    const newContent = `---\n${newLines.join('\n')}\n---\n${body}`;

    const reparsed = parseFrontmatterFields(parseMdFrontmatter(newContent).frontmatter);
    const summaryOk = reparsed.summary !== undefined && decodeYamlScalar(reparsed.summary) === fields.summary;
    const reviewTriggerOk =
      reparsed.review_trigger !== undefined && decodeYamlScalar(reparsed.review_trigger) === fields.reviewTrigger;
    const ok =
      reparsed.type === fields.type &&
      summaryOk &&
      reparsed.status === fields.status &&
      reviewTriggerOk &&
      reparsed.created === fields.created &&
      reparsed.last_updated === fields.lastUpdated;

    if (!ok) {
      exceptions.push({ path: entry.path, reason: 'post-insertion round-trip mismatch' });
      continue;
    }

    fs.writeFileSync(abs, newContent, 'utf-8');
    migrated.push(entry.path);
  }

  return { migrated, exceptions };
};

// Real git-log date resolver (Task 3) — deliberately not part of the pure planning function
// above so its test suite never shells out to git. `created` is the OLDEST `--diff-filter=A`
// commit's date (git log prints newest-first, so the oldest is the last line — the plan's own
// `| tail -1` instruction, implemented here as an array-index take instead of a shell pipe).
const gitDateLookup = (repoRoot: string): DateLookup => {
  return (relPath: string) => {
    const abs = path.join(repoRoot, 'documentation/decisions', relPath);
    const created = spawnSync('git', ['-C', repoRoot, 'log', '--diff-filter=A', '--format=%ad', '--date=short', '--', abs], {
      encoding: 'utf-8',
    });
    const lastUpdated = spawnSync('git', ['-C', repoRoot, 'log', '-1', '--format=%ad', '--date=short', '--', abs], {
      encoding: 'utf-8',
    });
    if (created.status !== 0 || lastUpdated.status !== 0) return null;

    const createdLines = created.stdout.trim().split('\n').filter(Boolean);
    const createdDate = createdLines.length > 0 ? createdLines[createdLines.length - 1] : '';
    const lastUpdatedDate = lastUpdated.stdout.trim();
    if (!createdDate || !lastUpdatedDate) return null;
    return { created: createdDate, lastUpdated: lastUpdatedDate };
  };
};

function usage(): never {
  console.error('Usage: bun run scripts/backfill-adr-frontmatter.ts [--dry-run] [--verify]');
  process.exit(2);
}

// --verify: re-reads every ADR's frontmatter `summary` and compares it byte-for-byte against its
// documentation/decisions/INDEX.md row, across all 42 files (not just the 37 touched) — reusing
// the same parseIndexTableRows/parseFrontmatterFields/decodeYamlScalar used by the plan function
// above, not a second comparison implementation (Task 5 AC).
function runVerify(adrDir: string, indexContent: string): void {
  const indexRows = new Map(parseIndexTableRows(indexContent).map((r) => [r.path, r.summary]));
  const relPaths = adrRelPaths(adrDir);

  let mismatches = 0;
  for (const relPath of relPaths) {
    const content = fs.readFileSync(path.join(adrDir, relPath), 'utf-8');
    const fm = parseFrontmatterFields(parseMdFrontmatter(content).frontmatter);
    const expected = indexRows.get(relPath);
    const actual = fm.summary !== undefined ? decodeYamlScalar(fm.summary) : undefined;

    if (expected === undefined) {
      mismatches++;
      console.error(`  ${relPath}: no matching documentation/decisions/INDEX.md row`);
      continue;
    }
    if (actual !== expected) {
      mismatches++;
      console.error(`  ${relPath}: frontmatter summary != INDEX.md row summary`);
    }
  }

  console.log(`backfill-adr-frontmatter --verify: checked ${relPaths.length} file(s), ${mismatches} mismatch(es)`);
  process.exit(mismatches > 0 ? 1 : 0);
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  const adrDir = path.join(root, 'documentation/decisions');
  const indexContent = fs.readFileSync(path.join(adrDir, 'INDEX.md'), 'utf-8');

  if (flags.verify) {
    runVerify(adrDir, indexContent);
    return;
  }
  if (flags['dry-run'] !== undefined && flags['dry-run'] !== true) usage();

  const plan = computeAdrFrontmatterBackfillPlan(adrDir, indexContent, gitDateLookup(root));
  const toWrite = plan.entries.filter((e) => !e.skipped);
  const skippedCount = plan.entries.length - toWrite.length;

  console.log(
    `backfill-adr-frontmatter: ${toWrite.length} file(s) planned for backfill, ${skippedCount} already compliant (skipped)`,
  );
  for (const e of toWrite) console.log(`  ${e.path}: +${e.addedKeys.join(',')}`);

  if (plan.exceptions.length > 0) {
    console.error(`backfill-adr-frontmatter: ${plan.exceptions.length} exception(s):`);
    for (const e of plan.exceptions) console.error(`  ${e.path}: ${e.reason}`);
  }

  if (flags['dry-run'] === true) {
    process.exit(plan.exceptions.length > 0 ? 1 : 0);
  }

  const result = applyAdrFrontmatterBackfill(adrDir, toWrite);
  console.log(`backfill-adr-frontmatter: wrote ${result.migrated.length} file(s)`);

  const allExceptions = [...plan.exceptions, ...result.exceptions];
  if (allExceptions.length > 0) {
    console.error(`backfill-adr-frontmatter: ${allExceptions.length} total exception(s):`);
    for (const e of allExceptions) console.error(`  ${e.path}: ${e.reason}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
