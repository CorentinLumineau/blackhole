import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  countCitationsInFile,
  isCommentLine,
  isIssueCitationLine,
  scanDirsForCitations,
} from './doc06-citation-scan.ts';
import { makeTempDir } from './fs.ts';

// V-DOC-06 boundary measurement (issue #951) — pure detection primitives used both by the
// one-off CLI report (`scripts/analyze-doc06-citations.ts`) and by any future re-measurement.
// `.md` prose is deliberately never walked here: markdown citations are already the settled
// boundary-3 exemption in `blackhole-vcodes.md`'s V-DOC-06 row.

describe('isCommentLine', () => {
  test('recognizes a `//` line comment', () => {
    expect(isCommentLine('// this is a comment')).toBe(true);
    expect(isCommentLine('  // indented comment')).toBe(true);
  });

  test('recognizes a `/* ... */` block-comment continuation line (`* ...`)', () => {
    expect(isCommentLine(' * continuation line inside a block comment')).toBe(true);
    expect(isCommentLine('/* opening a block comment')).toBe(true);
  });

  test('rejects a non-comment code line', () => {
    expect(isCommentLine('const x = 1; // trailing comment does not matter here')).toBe(false);
    expect(isCommentLine("describe('regression for #123', () => {")).toBe(false);
  });
});

describe('isIssueCitationLine', () => {
  test('matches a `//` line comment citing an issue number', () => {
    expect(isIssueCitationLine('// fixed in #951')).toBe(true);
  });

  test('matches a `/* ... */` block-comment continuation citing an issue number', () => {
    expect(isIssueCitationLine(' * see #951 for the incident writeup')).toBe(true);
  });

  test('does not match a non-comment code line containing #123', () => {
    expect(isIssueCitationLine('const issueRef = "#123";')).toBe(false);
  });

  test('does not match a describe() title line citing an issue (code, not a comment)', () => {
    expect(isIssueCitationLine("describe('regression for #123', () => {")).toBe(false);
  });

  test('does not match a plain prose comment with no digits after #', () => {
    expect(isIssueCitationLine('// use #fff for the border color')).toBe(false);
    expect(isIssueCitationLine('// see the #main anchor')).toBe(false);
  });
});

describe('countCitationsInFile', () => {
  test('counts only comment lines citing an issue number', () => {
    const content = [
      '// fixed in #951',
      'const issueRef = "#123";',
      " * also see #952",
      "describe('regression for #123', () => {",
      '// use #fff for the border color',
    ].join('\n');
    expect(countCitationsInFile(content)).toBe(2);
  });

  test('returns 0 for content with no citing comment lines', () => {
    const content = ['// a plain comment', 'const x = 1;'].join('\n');
    expect(countCitationsInFile(content)).toBe(0);
  });
});

describe('scanDirsForCitations — fixture-directory integration', () => {
  test('reports exactly the .ts comment citation, excluding .md prose and describe() titles', () => {
    const dir = makeTempDir('doc06-citation-scan-fixture');
    try {
      // (a) .ts file with a #951-citing comment line — the one line this scan must report.
      fs.writeFileSync(path.join(dir, 'a.ts'), '// see #951 for context\nconst x = 1;\n');
      // (b) .md file with a #951-citing line — markdown is never walked (boundary 3 exemption).
      fs.writeFileSync(path.join(dir, 'b.md'), '# Notes\n\nSee #951 for context.\n');
      // (c) .ts file whose only citation is inside a describe() title — code, not a comment.
      fs.writeFileSync(
        path.join(dir, 'c.test.ts'),
        "describe('regression for #951', () => {\n  test('x', () => {});\n});\n"
      );

      const findings = scanDirsForCitations([dir]);
      expect(findings).toHaveLength(1);
      expect(findings[0].file).toBe(path.join(dir, 'a.ts'));
      expect(findings[0].count).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('mutating the fixture (moving the .md citation into a .ts comment) changes the count from 1 to 2', () => {
    const dir = makeTempDir('doc06-citation-scan-fixture-mutated');
    try {
      fs.writeFileSync(path.join(dir, 'a.ts'), '// see #951 for context\nconst x = 1;\n');
      fs.writeFileSync(path.join(dir, 'b.md'), '# Notes\n\nSee #951 for context.\n');
      fs.writeFileSync(
        path.join(dir, 'c.test.ts'),
        "describe('regression for #951', () => {\n  test('x', () => {});\n});\n"
      );

      const before = scanDirsForCitations([dir]).reduce((sum, f) => sum + f.count, 0);
      expect(before).toBe(1);

      // Move the .md citation into a new .ts comment (the .md file's own citation is removed
      // so the total isn't just growing from an unrelated third source).
      fs.writeFileSync(path.join(dir, 'b.md'), '# Notes\n\nNo citation here.\n');
      fs.writeFileSync(path.join(dir, 'd.ts'), '// moved from b.md, see #951 for context\n');

      const after = scanDirsForCitations([dir]).reduce((sum, f) => sum + f.count, 0);
      expect(after).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('only .ts and .js extensions are walked — a non-.ts/.js file is ignored entirely', () => {
    const dir = makeTempDir('doc06-citation-scan-fixture-ext');
    try {
      fs.writeFileSync(path.join(dir, 'a.js'), '// see #951 for context\n');
      fs.writeFileSync(path.join(dir, 'b.txt'), '// see #951 for context\n');

      const findings = scanDirsForCitations([dir]);
      expect(findings).toHaveLength(1);
      expect(findings[0].file).toBe(path.join(dir, 'a.js'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
