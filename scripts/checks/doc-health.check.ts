import * as fs from 'fs';
import * as path from 'path';
import { parseMdFrontmatter, parseFrontmatterFields } from '../lib/build/content.ts';
import { parseIndexTableRows, walkMdFilesAbs } from '../lib/check-common.ts';
import { buildDocIndexRows, diffDocIndexRows, type DocIndexDiff } from '../lib/doc-index-generate.ts';
import { DOC_HEALTH_THRESHOLDS } from '../lib/build/facts.ts';
import { root, type CheckResult } from './check-utils.ts';

// Issue #462 (ADR-021 D6 Scope 1) — doc-health.check.ts: matches verify.doc-health.test.ts.
// Delivers owner ruling R-001: INDEX.md upkeep (V-DOCHEALTH-01/02), the doc-tree health signal
// (V-DOCHEALTH-03), and reuse of the two existing WARN V-DOC-GOV codes (frontmatter, naming).

const DOCS_DIR = path.join(root, 'documentation');

type DocFile = { relPath: string; content: string };

const isIndexFile = (relPath: string): boolean => path.basename(relPath) === 'INDEX.md';
const isArchivedMilestone = (relPath: string): boolean => relPath.startsWith('milestones/_archived/');

// Walks `docsDir` (fixture in tests, DOCS_DIR in production) via the shared tree-walker (V-INT-02).
const collectDocFiles = (docsDir: string): DocFile[] =>
  walkMdFilesAbs(docsDir).map((abs) => ({
    relPath: path.relative(docsDir, abs).split(path.sep).join('/'),
    content: fs.readFileSync(abs, 'utf-8'),
  }));

// V-DOC-GOV-02 (reused): lifecycle frontmatter present on every doc, excluding INDEX.md/milestones/_archived/**.
export type FrontmatterPresence = {
  relPath: string;
  hasType: boolean;
  hasStatus: boolean;
  hasReviewTrigger: boolean;
  hasCreated: boolean;
  hasLastUpdated: boolean;
};

const lifecycleFrontmatterComplete = (f: FrontmatterPresence): boolean =>
  f.hasType && f.hasStatus && f.hasReviewTrigger && f.hasCreated && f.hasLastUpdated;

export const findMissingFrontmatter = (files: FrontmatterPresence[]): string[] =>
  files
    .filter((f) => !isIndexFile(f.relPath) && !isArchivedMilestone(f.relPath))
    .filter((f) => !lifecycleFrontmatterComplete(f))
    .map((f) => f.relPath);

export const evaluateFrontmatterPresence = (docsDir: string): CheckResult => {
  const missing = findMissingFrontmatter(
    collectDocFiles(docsDir).map((f) => {
      const fm = parseFrontmatterFields(parseMdFrontmatter(f.content).frontmatter);
      return {
        relPath: f.relPath,
        hasType: !!fm.type,
        hasStatus: !!fm.status,
        hasReviewTrigger: !!fm.review_trigger,
        hasCreated: !!fm.created,
        hasLastUpdated: !!fm.last_updated,
      };
    }),
  );
  return missing.length
    ? { id: 'V-DOC-GOV-02', ok: true, detail: `missing lifecycle frontmatter: ${missing.join(', ')}` }
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

// Issue #573: shared root-INDEX row parser (V-DOCHEALTH-01/02/03), reused by adr-status.check.ts.
export const parseRootIndexRows = parseIndexTableRows;

// Issue #728 (V-INT-02): `RootIndexRow`/`appendIndexRowIfAbsent` moved to check-common.ts (this
// module can't be imported by companion-file-sync.ts, a lib/ module) — re-exported so this
// module's public surface is unchanged.
export { appendIndexRowIfAbsent } from '../lib/check-common.ts';
export type { RootIndexRow } from '../lib/check-common.ts';

// Issue #832 (ADR-031 Phase 2): V-DOCHEALTH-01/02/04 all consume one shared diff
// (`diffDocIndexRows`, doc-index-generate.ts) between the committed INDEX.md rows and the
// generator's own frontmatter-derived rows, computed once per call — retargeted off the former
// raw file-tree-walk set comparison so a doc's frontmatter is the single source of truth for
// what its INDEX.md row should say. `null` (INDEX.md absent) is the pre-existing SKIP branch.
const docIndexDiff = (docsDir: string): ReturnType<typeof diffDocIndexRows> | null => {
  const indexAbs = path.join(docsDir, 'INDEX.md');
  if (!fs.existsSync(indexAbs)) return null;
  return diffDocIndexRows(parseRootIndexRows(fs.readFileSync(indexAbs, 'utf-8')), buildDocIndexRows(docsDir));
};

// V-DOCHEALTH-01 (blocking): every INDEX.md row resolves to an existing, eligible file.
export const findDanglingIndexRows = (diff: DocIndexDiff): string[] => diff.dangling;

export const evaluateIndexDangling = (docsDir: string): CheckResult => {
  const diff = docIndexDiff(docsDir);
  const dangling = diff ? findDanglingIndexRows(diff) : [];
  return dangling.length
    ? { id: 'V-DOCHEALTH-01', ok: false, detail: `INDEX.md rows with no matching file: ${dangling.join(', ')}` }
    : { id: 'V-DOCHEALTH-01', ok: true };
};

// V-DOCHEALTH-02 (blocking): every eligible doc has a corresponding INDEX.md row (decisions/**,
// INDEX.md itself, and milestones/_archived/** are excluded from the generator's own walk).
export const findOrphanDocs = (diff: DocIndexDiff): string[] => diff.orphan;

export const evaluateOrphanFiles = (docsDir: string): CheckResult => {
  const diff = docIndexDiff(docsDir);
  const orphans = diff ? findOrphanDocs(diff) : [];
  return orphans.length
    ? { id: 'V-DOCHEALTH-02', ok: false, detail: `files missing an INDEX.md row: ${orphans.join(', ')}` }
    : { id: 'V-DOCHEALTH-02', ok: true };
};

// V-DOCHEALTH-03 (new, advisory — never blocking, mirrors mercure's own framing): aggregated
// doc-tree health — line ceiling, row ceiling, tree-size advisory, deprecation window.
// Thresholds from facts.ts (Numeric-fact SSOT — never hardcoded here).
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

// V-DOCHEALTH-04 (new, blocking, issue #832 ADR-031 Phase 2): a path present on both sides whose
// row content diverges from its own doc's frontmatter. Retires evaluateGeneratedIndexParity's
// round-trip-parity duty (Phase 1, advisory, folded under V-DOCHEALTH-03) — the same comparison,
// now blocking and under its own code, sharing docIndexDiff with V-DOCHEALTH-01/02 above.
export const findStaleIndexRows = (diff: DocIndexDiff): string[] => diff.stale;

export const evaluateStaleIndexContent = (docsDir: string): CheckResult => {
  const diff = docIndexDiff(docsDir);
  const stale = diff ? findStaleIndexRows(diff) : [];
  return stale.length
    ? { id: 'V-DOCHEALTH-04', ok: false, detail: `INDEX.md row content stale vs. frontmatter: ${stale.join(', ')}` }
    : { id: 'V-DOCHEALTH-04', ok: true };
};

const checkFrontmatterPresence = (): CheckResult => evaluateFrontmatterPresence(DOCS_DIR);
const checkCanonicalNaming = (): CheckResult => evaluateCanonicalNaming(DOCS_DIR);
const checkIndexDangling = (): CheckResult => evaluateIndexDangling(DOCS_DIR);
const checkOrphanFiles = (): CheckResult => evaluateOrphanFiles(DOCS_DIR);
const checkDocTreeHealth = (): CheckResult => evaluateDocTreeHealth(DOCS_DIR);
const checkStaleIndexContent = (): CheckResult => evaluateStaleIndexContent(DOCS_DIR);

// ADR-007 T5/R2': domain entrypoint — see adr-status.check.ts's runChecks doc comment for the
// shared contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [
  checkFrontmatterPresence(),
  checkCanonicalNaming(),
  checkIndexDangling(),
  checkOrphanFiles(),
  checkDocTreeHealth(),
  checkStaleIndexContent(),
];
