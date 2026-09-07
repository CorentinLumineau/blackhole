import * as fs from 'fs';
import * as path from 'path';
import { walkFilesAbs } from './fs.ts';

// V-DOC-06 citation measurement — pure detection primitives for "does this source
// comment cite an issue/PR number" (`blackhole-vcodes.md` V-DOC-06). A `//` line comment or a
// `/* ... */` block-comment continuation line (`* ...`) counts; a code line — including a
// `describe()`/`test()`/`it()` title string that happens to contain `#NNN` — never does, per
// V-DOC-06's own boundary (1) exemption. `.md` prose is out of scope for this module entirely:
// boundary (3) already exempts it, and callers only ever pass `.ts`/`.js` directories.

const COMMENT_LINE_RE = /^\s*(\/\/|\/\*|\*)/;
const ISSUE_CITATION_RE = /#\d+/;

export const isCommentLine = (line: string): boolean => COMMENT_LINE_RE.test(line);

export const isIssueCitationLine = (line: string): boolean =>
  isCommentLine(line) && ISSUE_CITATION_RE.test(line);

export const countCitationsInFile = (content: string): number =>
  content.split('\n').filter(isIssueCitationLine).length;

const SCANNED_EXTENSIONS = new Set(['.ts', '.js']);

// Scans each absolute directory for `.ts`/`.js` files and returns one entry per file that has
// at least one citing comment line (files with zero citations are omitted, not zero-valued).
export const scanDirsForCitations = (absDirs: string[]): { file: string; count: number }[] => {
  const results: { file: string; count: number }[] = [];
  for (const dir of absDirs) {
    for (const file of walkFilesAbs(dir)) {
      if (!SCANNED_EXTENSIONS.has(path.extname(file))) continue;
      const count = countCitationsInFile(fs.readFileSync(file, 'utf-8'));
      if (count > 0) results.push({ file, count });
    }
  }
  return results;
};
