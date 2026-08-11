import * as fs from 'fs';
import * as path from 'path';
import { parseMdFrontmatter, parseFrontmatterFields } from '../lib/build/content.ts';
import { parseIndexTableRows, walkMdFilesAbs } from '../lib/check-common.ts';
import { DOC_HEALTH_THRESHOLDS } from '../lib/build/facts.ts';
import { root, type CheckResult } from './check-utils.ts';

// Issue #462 (ADR-021 D6 Scope 1) — doc-health.check.ts: matches verify.doc-health.test.ts.
// Delivers owner ruling R-001 (documentation/reference/product-principles.md): brings
// blackhole's own documentation/ tree to parity with the two obligations mercure's doc
// governance has that blackhole's Scope-1 (this repo) enforcement lacked — INDEX.md upkeep
// (V-DOCHEALTH-01/02) and the doc-tree health signal (V-DOCHEALTH-03) — plus reuses the two
// existing WARN-severity V-DOC-GOV codes for lifecycle frontmatter and canonical naming.

const DOCS_DIR = path.join(root, 'documentation');

type DocFile = { relPath: string; content: string };

const isIndexFile = (relPath: string): boolean => path.basename(relPath) === 'INDEX.md';
const isArchivedMilestone = (relPath: string): boolean => relPath.startsWith('milestones/_archived/');
const isDecisionsDoc = (relPath: string): boolean => relPath.startsWith('decisions/');

// Walks `docsDir` (a fixture dir in tests, DOCS_DIR in production) for every *.md file, reusing
// the shared tree-walker (V-INT-02) rather than re-implementing recursion here.
const collectDocFiles = (docsDir: string): DocFile[] =>
  walkMdFilesAbs(docsDir).map((abs) => ({
    relPath: path.relative(docsDir, abs).split(path.sep).join('/'),
    content: fs.readFileSync(abs, 'utf-8'),
  }));

// V-DOC-GOV-02 (reused): lifecycle frontmatter (`type:`/`status:`) present on every doc,
// excluding INDEX.md and documentation/milestones/_archived/**.
export const findMissingFrontmatter = (files: { relPath: string; hasType: boolean; hasStatus: boolean }[]): string[] =>
  files
    .filter((f) => !isIndexFile(f.relPath) && !isArchivedMilestone(f.relPath))
    .filter((f) => !f.hasType || !f.hasStatus)
    .map((f) => f.relPath);

export const evaluateFrontmatterPresence = (docsDir: string): CheckResult => {
  const files = collectDocFiles(docsDir).map((f) => {
    const fm = parseFrontmatterFields(parseMdFrontmatter(f.content).frontmatter);
    return { relPath: f.relPath, hasType: !!fm.type, hasStatus: !!fm.status };
  });
  const missing = findMissingFrontmatter(files);
  return missing.length
    ? { id: 'V-DOC-GOV-02', ok: true, detail: `missing type/status frontmatter: ${missing.join(', ')}` }
    : { id: 'V-DOC-GOV-02', ok: true };
};

// V-DOC-GOV-03 (reused): canonical filename — no `-YYYY-MM-DD` suffix; ADR-*.md/INDEX.md exempt.
const ADR_FILENAME = /^ADR-\d+-.*\.md$/;
const DATE_STAMP_SUFFIX = /-\d{4}-\d{2}-\d{2}\.md$/;

export const findDateStampedFilenames = (relPaths: string[]): string[] =>
  relPaths.filter((p) => {
    const base = path.basename(p);
    if (base === 'INDEX.md' || ADR_FILENAME.test(base)) return false;
    return DATE_STAMP_SUFFIX.test(base);
  });

export const evaluateCanonicalNaming = (docsDir: string): CheckResult => {
  const violating = findDateStampedFilenames(collectDocFiles(docsDir).map((f) => f.relPath));
  return violating.length
    ? { id: 'V-DOC-GOV-03', ok: true, detail: `date-stamped filenames: ${violating.join(', ')}` }
    : { id: 'V-DOC-GOV-03', ok: true };
};

// Issue #573: shared with adr-status.check.ts via parseIndexTableRows (check-common.ts).
// Root-INDEX row parser (shared by V-DOCHEALTH-01/02/03) — the same 5-column schema already in
// production at documentation/decisions/INDEX.md (`path | summary | type | status |
// review_trigger`), row paths relative to documentation/ itself (Codebase Conventions).
export type RootIndexRow = { path: string; summary: string; type: string; status: string; reviewTrigger: string };

export const parseRootIndexRows = parseIndexTableRows;

// Idempotent row-append primitive (issue #490, ADR-021 D2 carry-step) — built on
// parseRootIndexRows above (V-INT-02). Guards a duplicate row on implementer re-spawn.
export const appendIndexRowIfAbsent = (indexContent: string, row: RootIndexRow): { content: string; appended: boolean } => {
  if (parseRootIndexRows(indexContent).some((r) => r.path === row.path)) return { content: indexContent, appended: false };
  const line = `| ${row.path} | ${row.summary} | ${row.type} | ${row.status} | ${row.reviewTrigger} |`;
  return { content: `${indexContent}${indexContent.endsWith('\n') ? '' : '\n'}${line}\n`, appended: true };
};

// V-DOCHEALTH-01 (new, blocking): every INDEX.md row resolves to an existing file.
export const findDanglingIndexRows = (indexPaths: string[], existingRelPaths: Set<string>): string[] =>
  indexPaths.filter((p) => !existingRelPaths.has(p));

export const evaluateIndexDangling = (docsDir: string): CheckResult => {
  const indexAbs = path.join(docsDir, 'INDEX.md');
  if (!fs.existsSync(indexAbs)) return { id: 'V-DOCHEALTH-01', ok: true };
  const rows = parseRootIndexRows(fs.readFileSync(indexAbs, 'utf-8'));
  const existing = new Set(collectDocFiles(docsDir).map((f) => f.relPath));
  const dangling = findDanglingIndexRows(rows.map((r) => r.path), existing);
  return dangling.length
    ? { id: 'V-DOCHEALTH-01', ok: false, detail: `INDEX.md rows with no matching file: ${dangling.join(', ')}` }
    : { id: 'V-DOCHEALTH-01', ok: true };
};

// V-DOCHEALTH-02 (new, blocking): every doc has a corresponding INDEX.md row, excluding
// decisions/** (governed by its own per-folder INDEX.md + adr-status.check.ts), INDEX.md
// files, and documentation/milestones/_archived/**.
export const findOrphanDocs = (allRelPaths: string[], indexPaths: Set<string>): string[] =>
  allRelPaths
    .filter((p) => !isIndexFile(p) && !isDecisionsDoc(p) && !isArchivedMilestone(p))
    .filter((p) => !indexPaths.has(p));

export const evaluateOrphanFiles = (docsDir: string): CheckResult => {
  const indexAbs = path.join(docsDir, 'INDEX.md');
  if (!fs.existsSync(indexAbs)) return { id: 'V-DOCHEALTH-02', ok: true };
  const rows = parseRootIndexRows(fs.readFileSync(indexAbs, 'utf-8'));
  const indexPaths = new Set(rows.map((r) => r.path));
  const allRelPaths = collectDocFiles(docsDir).map((f) => f.relPath);
  const orphans = findOrphanDocs(allRelPaths, indexPaths);
  return orphans.length
    ? { id: 'V-DOCHEALTH-02', ok: false, detail: `files missing an INDEX.md row: ${orphans.join(', ')}` }
    : { id: 'V-DOCHEALTH-02', ok: true };
};

// V-DOCHEALTH-03 (new, advisory — never blocking, mirrors mercure's own framing for this exact
// signal): aggregated doc-tree health — single-doc line ceiling, root-INDEX row ceiling,
// tree-size advisory, deprecation window. Thresholds imported from facts.ts (Numeric-fact SSOT
// — never hardcoded here).
export const findOversizedDocs = (files: { relPath: string; lineCount: number }[], ceiling: number): string[] =>
  files.filter((f) => !isIndexFile(f.relPath) && f.lineCount > ceiling).map((f) => f.relPath);

export const isRootIndexRowCeilingExceeded = (rowCount: number, ceiling: number): boolean => rowCount > ceiling;

export const isTreeSizeAdvisoryExceeded = (fileCount: number, advisory: number): boolean => fileCount > advisory;

export const findStaleDeprecatedDocs = (
  files: { relPath: string; status: string; lastUpdated: string }[],
  windowDays: number,
  now: Date = new Date()
): string[] =>
  files
    .map((f) => ({ relPath: f.relPath, status: f.status, updatedAt: Date.parse(f.lastUpdated) }))
    .filter((f) => f.status === 'deprecated' && !Number.isNaN(f.updatedAt))
    .filter((f) => (now.getTime() - f.updatedAt) / 86_400_000 > windowDays)
    .map((f) => f.relPath);

export const evaluateDocTreeHealth = (docsDir: string): CheckResult => {
  const files = collectDocFiles(docsDir);
  const details: string[] = [];

  const oversized = findOversizedDocs(
    files.map((f) => ({ relPath: f.relPath, lineCount: f.content.split('\n').length })),
    DOC_HEALTH_THRESHOLDS.singleDocLineCeiling
  );
  if (oversized.length) details.push(`over ${DOC_HEALTH_THRESHOLDS.singleDocLineCeiling}-line ceiling: ${oversized.join(', ')}`);

  const indexAbs = path.join(docsDir, 'INDEX.md');
  if (fs.existsSync(indexAbs)) {
    const rowCount = parseRootIndexRows(fs.readFileSync(indexAbs, 'utf-8')).length;
    if (isRootIndexRowCeilingExceeded(rowCount, DOC_HEALTH_THRESHOLDS.rootIndexRowCeiling)) {
      details.push(`INDEX.md row count ${rowCount} exceeds ${DOC_HEALTH_THRESHOLDS.rootIndexRowCeiling}`);
    }
  }

  if (isTreeSizeAdvisoryExceeded(files.length, DOC_HEALTH_THRESHOLDS.treeSizeAdvisory)) {
    details.push(`tree file count ${files.length} exceeds ${DOC_HEALTH_THRESHOLDS.treeSizeAdvisory}`);
  }

  const stale = findStaleDeprecatedDocs(
    files.map((f) => {
      const fm = parseFrontmatterFields(parseMdFrontmatter(f.content).frontmatter);
      return { relPath: f.relPath, status: fm.status ?? '', lastUpdated: fm.last_updated ?? '' };
    }),
    DOC_HEALTH_THRESHOLDS.deprecationWindowDays
  );
  if (stale.length) details.push(`deprecated past ${DOC_HEALTH_THRESHOLDS.deprecationWindowDays}-day window: ${stale.join(', ')}`);

  return details.length ? { id: 'V-DOCHEALTH-03', ok: true, detail: details.join('; ') } : { id: 'V-DOCHEALTH-03', ok: true };
};

const checkFrontmatterPresence = (): CheckResult => {
  return evaluateFrontmatterPresence(DOCS_DIR);
};

const checkCanonicalNaming = (): CheckResult => {
  return evaluateCanonicalNaming(DOCS_DIR);
};

const checkIndexDangling = (): CheckResult => {
  return evaluateIndexDangling(DOCS_DIR);
};

const checkOrphanFiles = (): CheckResult => {
  return evaluateOrphanFiles(DOCS_DIR);
};

const checkDocTreeHealth = (): CheckResult => {
  return evaluateDocTreeHealth(DOCS_DIR);
};

// ADR-007 T5/R2': domain entrypoint — see adr-status.check.ts's runChecks doc comment for the
// shared contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [
  checkFrontmatterPresence(),
  checkCanonicalNaming(),
  checkIndexDangling(),
  checkOrphanFiles(),
  checkDocTreeHealth(),
];
