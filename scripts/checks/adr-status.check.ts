import * as fs from 'fs';
import * as path from 'path';
import { parseMdFrontmatter } from '../lib/build/content.ts';
import { parseIndexTableRows } from '../lib/check-common.ts';
import { root, type CheckResult } from './check-utils.ts';

// ADR-007 T5/R2' — adr-status.check.ts: V-ADR-01..05, V-ADA-08 lifecycle (#460).

const decisionsDir = path.join(root, 'documentation', 'decisions');

export const ADR_STATUS_ENUM = ['accepted', 'superseded', 'deprecated'] as const;
export type AdrStatus = (typeof ADR_STATUS_ENUM)[number];

// V-ADR-01: frontmatter `status:` bare enum token.
export const extractFrontmatterStatus = (content: string): string | null => {
  const { frontmatter } = parseMdFrontmatter(content);
  if (!frontmatter) return null;
  const line = frontmatter.split('\n').find((l) => /^status:\s*/.test(l));
  if (!line) return null;
  return line.replace(/^status:\s*/, '').trim();
};

// V-ADR-03: in-body `## Status` leading token vs frontmatter.
export const extractBodyStatusLeadingToken = (content: string): string | null => {
  const match = content.match(/^## Status\s*\r?\n\s*\r?\n(.+)$/m);
  if (!match) return null;
  const tokenMatch = match[1].trim().match(/^([A-Za-z]+)/);
  return tokenMatch ? tokenMatch[1] : null;
};

// V-ADR-02: INDEX.md status column keyed by ADR filename.
export const parseIndexStatusMap = (indexContent: string): Map<string, string> => {
  const rows = new Map<string, string>();
  for (const row of parseIndexTableRows(indexContent)) {
    if (!row.path.startsWith('ADR-')) continue;
    rows.set(row.path, row.status);
  }
  return rows;
};

// V-ADR-01 (pure)
export const findInvalidAdrStatuses = (files: { filename: string; status: string | null }[]): string[] =>
  files
    .filter((f) => f.status === null || !(ADR_STATUS_ENUM as readonly string[]).includes(f.status))
    .map((f) => f.filename);

// V-ADR-02 (pure)
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

// V-ADR-03 (pure)
export const findBodyStatusMismatches = (
  files: { filename: string; frontmatterStatus: string | null; bodyLeadingToken: string | null }[],
): string[] =>
  files
    .filter((f) => f.bodyLeadingToken !== null && f.bodyLeadingToken.toLowerCase() !== f.frontmatterStatus?.toLowerCase())
    .map((f) => f.filename);

export const extractSupersessionCitation = (content: string): string | null => {
  const { frontmatter } = parseMdFrontmatter(content);
  if (frontmatter) {
    for (const line of frontmatter.split('\n')) {
      const by = line.match(/^superseded_by:\s*(.+)$/)?.[1]?.trim();
      if (by) return by;
      const sup = line.match(/^supersedes:\s*(.+)$/)?.[1]?.trim();
      if (sup && /^ADR-\d+/i.test(sup)) return sup;
    }
  }
  const m = content.match(/Superseded by\s+(ADR-\d+)/i);
  return m ? m[1] : null;
};

export const findSupersededLifecycleViolations = (
  files: {
    filename: string;
    frontmatterStatus: string | null;
    indexStatus: string | undefined;
    supersessionCitation: string | null;
  }[],
): string[] =>
  files
    .filter((f) => f.frontmatterStatus === 'superseded')
    .filter((f) => f.indexStatus !== 'superseded' || !f.supersessionCitation)
    .map((f) => f.filename);

export const extractAdrNumber = (filename: string): number | null => {
  const m = filename.match(/^ADR-(\d+)-/);
  return m ? Number.parseInt(m[1], 10) : null;
};

export const findAdrNumberingCollisions = (numbers: number[]): { duplicates: number[]; gaps: number[] } => {
  const seen = new Set<number>();
  const duplicates: number[] = [];
  for (const n of numbers) {
    if (seen.has(n)) duplicates.push(n);
    else seen.add(n);
  }
  const max = seen.size ? Math.max(...seen) : 0;
  const gaps: number[] = [];
  for (let i = 1; i <= max; i++) if (!seen.has(i)) gaps.push(i);
  return { duplicates: [...new Set(duplicates)], gaps };
};

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

const checkAdrSupersededLifecycle = (): CheckResult => {
  const indexMap = parseIndexStatusMap(fs.readFileSync(path.join(decisionsDir, 'INDEX.md'), 'utf-8'));
  const files = listAdrFiles().map((filename) => {
    const content = fs.readFileSync(path.join(decisionsDir, filename), 'utf-8');
    return {
      filename,
      frontmatterStatus: extractFrontmatterStatus(content),
      indexStatus: indexMap.get(filename),
      supersessionCitation: extractSupersessionCitation(content),
    };
  });
  const violations = findSupersededLifecycleViolations(files);
  if (violations.length) {
    return {
      id: 'V-ADR-04',
      ok: false,
      detail: `superseded ADR missing INDEX superseded status or supersession citation (V-ADA-08): ${violations.join(', ')}`,
    };
  }
  return { id: 'V-ADR-04', ok: true };
};

const checkAdrNumbering = (): CheckResult => {
  const numbers = listAdrFiles().map((f) => extractAdrNumber(f)).filter((n): n is number => n !== null);
  const { duplicates, gaps } = findAdrNumberingCollisions(numbers);
  if (duplicates.length) {
    return {
      id: 'V-ADR-05',
      ok: false,
      detail: `duplicate ADR numbers: ${duplicates.join(', ')}`,
    };
  }
  if (gaps.length) {
    return {
      id: 'V-ADR-05',
      ok: true,
      detail: `sequence gaps (WARN detail only): ${gaps.join(', ')}`,
    };
  }
  return { id: 'V-ADR-05', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see core.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [
  checkAdrStatusEnum(),
  checkAdrIndexMatch(),
  checkAdrBodyStatusAgreement(),
  checkAdrSupersededLifecycle(),
  checkAdrNumbering(),
];
