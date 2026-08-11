import * as fs from 'fs';
import * as path from 'path';
import { parseMdFrontmatter } from '../lib/build/content.ts';
import { parseIndexTableRows } from '../lib/check-common.ts';
import { root, type CheckResult } from './check-utils.ts';

// ADR-007 T5/R2' — adr-status.check.ts: matches verify.adr-status.test.ts.
//
// Issue #324: declares and enforces the single ADR-specific `status` enum
// (`accepted | superseded | deprecated` — see the Design Decision in
// `.blackhole/plans/issue-324.md` and `src/references/doc-governance.md` § ADR Status Enum)
// across three surfaces every `documentation/decisions/ADR-*.md` file may carry:
//   1. frontmatter `status:` — must be a bare enum token (V-ADR-01)
//   2. `documentation/decisions/INDEX.md`'s `status` column — must match the file's
//      frontmatter, bare token, case-sensitive (V-ADR-02)
//   3. an in-body `## Status` section (present on 6/14 ADRs as of #321's review, ledger
//      F-00006) — human prose carrying shipped-milestone evidence, never flattened to a bare
//      token; only its *leading token* must agree with frontmatter, case-insensitively, and
//      only when the section is present at all (V-ADR-03)

const decisionsDir = path.join(root, 'documentation', 'decisions');

export const ADR_STATUS_ENUM = ['accepted', 'superseded', 'deprecated'] as const;
export type AdrStatus = (typeof ADR_STATUS_ENUM)[number];

// V-ADR-01: extract the frontmatter `status:` value (raw, unvalidated) from an ADR file's content.
export const extractFrontmatterStatus = (content: string): string | null => {
  const { frontmatter } = parseMdFrontmatter(content);
  if (!frontmatter) return null;
  const line = frontmatter.split('\n').find((l) => /^status:\s*/.test(l));
  if (!line) return null;
  return line.replace(/^status:\s*/, '').trim();
};

// V-ADR-03: extract the leading token of an ADR's in-body `## Status` section, if present.
// The section carries human prose evidence (e.g. "Accepted — 2026-07-21 (shipped in v0.15.0:
// ...)") — only the first word is a status token; everything after it is preserved verbatim
// and never touched by this check.
export const extractBodyStatusLeadingToken = (content: string): string | null => {
  const match = content.match(/^## Status\s*\r?\n\s*\r?\n(.+)$/m);
  if (!match) return null;
  const tokenMatch = match[1].trim().match(/^([A-Za-z]+)/);
  return tokenMatch ? tokenMatch[1] : null;
};

// V-ADR-02: keyed by bare ADR filename (documentation/decisions/INDEX.md's own convention,
// distinct from the root INDEX.md's folder-prefixed paths — see check-common.ts's
// parseIndexTableRows for the shared row-parsing contract). The ADR- prefix filter is this
// caller's content filter, not part of the shared row shape.
export const parseIndexStatusMap = (indexContent: string): Map<string, string> => {
  const rows = new Map<string, string>();
  for (const row of parseIndexTableRows(indexContent)) {
    if (!row.path.startsWith('ADR-')) continue;
    rows.set(row.path, row.status);
  }
  return rows;
};

// V-ADR-01 (pure): given each ADR file's frontmatter status, return the filenames whose value
// is not an exact (case-sensitive) member of ADR_STATUS_ENUM.
export const findInvalidAdrStatuses = (files: { filename: string; status: string | null }[]): string[] =>
  files
    .filter((f) => f.status === null || !(ADR_STATUS_ENUM as readonly string[]).includes(f.status))
    .map((f) => f.filename);

// V-ADR-02 (pure): given each ADR file's frontmatter status and the INDEX.md status map, return
// the filenames whose frontmatter status does not exactly (case-sensitive) match the INDEX row.
export const findAdrIndexMismatches = (
  files: { filename: string; frontmatterStatus: string | null }[],
  indexMap: Map<string, string>,
): string[] =>
  files
    .filter((f) => {
      const indexStatus = indexMap.get(f.filename);
      return indexStatus === undefined || indexStatus !== f.frontmatterStatus;
    })
    .map((f) => f.filename);

// V-ADR-03 (pure): given each ADR file's frontmatter status and body `## Status` leading token
// (null when the section is absent — tolerated, not a failure), return the filenames where a
// present leading token disagrees with frontmatter, case-insensitively.
export const findBodyStatusMismatches = (
  files: { filename: string; frontmatterStatus: string | null; bodyLeadingToken: string | null }[],
): string[] =>
  files
    .filter((f) => f.bodyLeadingToken !== null && f.bodyLeadingToken.toLowerCase() !== f.frontmatterStatus?.toLowerCase())
    .map((f) => f.filename);

const listAdrFiles = (): string[] =>
  fs
    .readdirSync(decisionsDir)
    .filter((f) => /^ADR-\d+-.*\.md$/.test(f))
    .sort();

const checkAdrStatusEnum = (): CheckResult => {
  const files = listAdrFiles().map((filename) => ({
    filename,
    status: extractFrontmatterStatus(fs.readFileSync(path.join(decisionsDir, filename), 'utf-8')),
  }));
  const invalid = findInvalidAdrStatuses(files);
  if (invalid.length) {
    return {
      id: 'V-ADR-01',
      ok: false,
      detail: `frontmatter status not in {${ADR_STATUS_ENUM.join(', ')}}: ${invalid.join(', ')}`,
    };
  }
  return { id: 'V-ADR-01', ok: true };
};

const checkAdrIndexMatch = (): CheckResult => {
  const indexMap = parseIndexStatusMap(fs.readFileSync(path.join(decisionsDir, 'INDEX.md'), 'utf-8'));
  const files = listAdrFiles().map((filename) => ({
    filename,
    frontmatterStatus: extractFrontmatterStatus(fs.readFileSync(path.join(decisionsDir, filename), 'utf-8')),
  }));
  const mismatched = findAdrIndexMismatches(files, indexMap);
  if (mismatched.length) {
    return { id: 'V-ADR-02', ok: false, detail: `frontmatter/INDEX.md status mismatch: ${mismatched.join(', ')}` };
  }
  return { id: 'V-ADR-02', ok: true };
};

const checkAdrBodyStatusAgreement = (): CheckResult => {
  const files = listAdrFiles().map((filename) => {
    const content = fs.readFileSync(path.join(decisionsDir, filename), 'utf-8');
    return {
      filename,
      frontmatterStatus: extractFrontmatterStatus(content),
      bodyLeadingToken: extractBodyStatusLeadingToken(content),
    };
  });
  const mismatched = findBodyStatusMismatches(files);
  if (mismatched.length) {
    return {
      id: 'V-ADR-03',
      ok: false,
      detail: `body '## Status' leading token disagrees with frontmatter: ${mismatched.join(', ')}`,
    };
  }
  return { id: 'V-ADR-03', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see core.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkAdrStatusEnum(), checkAdrIndexMatch(), checkAdrBodyStatusAgreement()];
