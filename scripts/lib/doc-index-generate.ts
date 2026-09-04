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
