import * as path from 'path';
import * as fs from 'fs';
import { parseMdFrontmatter, parseFrontmatterFields } from './build/content.ts';
import { byPathByteOrder, renderIndexRowLine, walkMdFilesAbs, type RootIndexRow } from './check-common.ts';

// Issue #811 (ADR-031 Phase 1) — pure generator half of the "generated-artifact + drift-check"
// pattern (Codebase Conventions table): tree walk + frontmatter read + sorted row build. Reuses
// walkMdFilesAbs, parseMdFrontmatter/parseFrontmatterFields, byPathByteOrder, and
// renderIndexRowLine from existing modules — no new tree-walk, parse, sort, or render logic
// (V-INT-02). Phase 2 wires this into a blocking `bun run verify` gate; Phase 1 only proves the
// generator's output round-trips against the hand-appended committed file (scripts/generate-doc-
// index.ts's --check flag, and doc-health.check.ts's advisory evaluateGeneratedIndexParity).

// `summary:`/`review_trigger:` frontmatter values are written as JSON-quoted YAML double-quoted
// scalars (the same convention `review_trigger`/`target` already use in-tree — see
// documentation/architecture.md) so a value containing a colon, a double quote, or a backtick
// round-trips safely through a single frontmatter line. JSON.stringify/JSON.parse is a strict
// subset of YAML's double-quoted scalar syntax, so reusing it here is not a second escaping
// implementation — it is the language's own JSON codec, not a repo utility (V-INT-02 governs
// reimplementing this repo's own helpers, not calling a built-in).
const decodeYamlScalar = (raw: string): string => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const isExcludedPath = (relPath: string): boolean =>
  relPath === 'INDEX.md' || relPath.startsWith('decisions/') || relPath.startsWith('milestones/_archived/');

// Walks `docsDir`, excluding decisions/**, milestones/_archived/**, and INDEX.md itself
// (Touch-Paths scope), and builds one RootIndexRow per remaining doc from its frontmatter.
export const buildDocIndexRows = (docsDir: string): RootIndexRow[] => {
  const rows: RootIndexRow[] = walkMdFilesAbs(docsDir)
    .map((abs) => path.relative(docsDir, abs).split(path.sep).join('/'))
    .filter((relPath) => !isExcludedPath(relPath))
    .map((relPath) => {
      const content = fs.readFileSync(path.join(docsDir, relPath), 'utf-8');
      const fm = parseFrontmatterFields(parseMdFrontmatter(content).frontmatter);
      return {
        path: relPath,
        summary: fm.summary ? decodeYamlScalar(fm.summary) : '',
        type: fm.type ?? '',
        status: fm.status ?? '',
        reviewTrigger: fm.review_trigger ? decodeYamlScalar(fm.review_trigger) : '',
      };
    });

  return rows.sort(byPathByteOrder);
};

export const renderDocIndexTable = (rows: RootIndexRow[]): string => rows.map(renderIndexRowLine).join('\n');

// Issue #832 (ADR-031 Phase 2, Task 5) — hoisted from scripts/generate-doc-index.ts's former
// local `renderFullTable`/`HEADER` (title row + separator row + generated rows), so both the CLI
// and the carry-time auto-regeneration (carry-staged-artifacts.ts, Task 7) call one shared
// renderer rather than two (V-INT-02/V-DRY-01). Callers overwriting the whole
// documentation/INDEX.md file are responsible for the document's own leading `# Documentation
// Index` heading + blank line, which this function does not include (this renders the table
// portion only, exactly matching the CLI's pre-existing default output).
const INDEX_TABLE_HEADER =
  '| path | summary | type | status | review_trigger |\n|------|---------|------|--------|----------------|';

export const renderFullIndexFile = (docsDir: string): string =>
  `${INDEX_TABLE_HEADER}\n${renderDocIndexTable(buildDocIndexRows(docsDir))}\n`;

// Issue #832 (ADR-031 Phase 2) — the one shared diff `doc-health.check.ts`'s V-DOCHEALTH-01/02/04
// checks all consume, computed once against the same `RootIndexRow[]` shape both the committed
// table (`parseRootIndexRows`) and the generator (`buildDocIndexRows`) already produce, rather
// than three separate comparisons of the same two arrays (V-DRY-01/V-INT-02). `dangling` = a
// committed row whose path has no corresponding generated row (the file no longer exists, or was
// never eligible per `isExcludedPath`); `orphan` = a generated row with no corresponding
// committed row (a doc with no INDEX.md entry); `stale` = a path present on both sides whose
// `summary`/`type`/`status`/`reviewTrigger` content differs — the round-trip-parity duty
// `evaluateGeneratedIndexParity` (Phase 1, advisory) retired in favor of this blocking bucket.
export type DocIndexDiff = { dangling: string[]; orphan: string[]; stale: string[] };

export const diffDocIndexRows = (committed: RootIndexRow[], generated: RootIndexRow[]): DocIndexDiff => {
  const committedByPath = new Map(committed.map((r) => [r.path, r]));
  const generatedByPath = new Map(generated.map((r) => [r.path, r]));

  const dangling = committed.map((r) => r.path).filter((p) => !generatedByPath.has(p));
  const orphan = generated.map((r) => r.path).filter((p) => !committedByPath.has(p));
  const stale = committed
    .map((r) => r.path)
    .filter((p) => generatedByPath.has(p))
    .filter((p) => {
      const c = committedByPath.get(p)!;
      const g = generatedByPath.get(p)!;
      return c.summary !== g.summary || c.type !== g.type || c.status !== g.status || c.reviewTrigger !== g.reviewTrigger;
    });

  return { dangling, orphan, stale };
};
