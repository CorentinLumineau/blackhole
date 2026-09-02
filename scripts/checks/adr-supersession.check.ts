import * as fs from 'fs';
import * as path from 'path';
import { parseMdFrontmatter, parseFrontmatterFields } from '../lib/build/content.ts';
import { walkMdFilesAbs } from '../lib/check-common.ts';
import { root, type CheckResult } from './check-utils.ts';

// adr-supersession.check.ts: V-ADR-06. Two legs closing the RC-E self-disclosure gap — an ADR
// reversal that was accepted in practice but never recorded against the ADR itself: leg 1
// catches a plan that *declares* `supersedes_adr` without the amendment landing; leg 2 catches
// tracked prose that asserts a reversal in words without any declaration at all. Both legs
// converge on the same acceptance signal — an ADR's `## Post-acceptance amendments` section.

const POST_ACCEPTANCE_HEADING = '## Post-acceptance amendments';

// The section body is everything between the heading and the next `## ` heading (or EOF) —
// same "read until the next same-level heading" idiom used to bound any other ad hoc markdown
// section in this codebase (no shared helper exists for it; the bound is a two-line regex, not
// a parser worth extracting).
const sectionBody = (content: string, heading: string): string | null => {
  const idx = content.indexOf(heading);
  if (idx === -1) return null;
  const rest = content.slice(idx + heading.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
};

export const hasPostAcceptanceAmendmentSection = (adrContent: string): boolean =>
  adrContent.includes(POST_ACCEPTANCE_HEADING);

export const hasPostAcceptanceAmendmentCitingIssue = (adrContent: string, issueRef: string): boolean => {
  const body = sectionBody(adrContent, POST_ACCEPTANCE_HEADING);
  if (body === null) return false;
  const normalized = issueRef.startsWith('#') ? issueRef : `#${issueRef}`;
  return body.includes(normalized);
};

// --- Leg 1: declared `supersedes_adr` plan frontmatter (plan-template.md) ---

// Same bracket-split-and-trim idiom as content.ts's parseDisallowedTools (V-INT-02 — the
// technique is shared, not the field it parses).
export const extractSupersedesAdrDeclaration = (planContent: string): string[] => {
  const { frontmatter } = parseMdFrontmatter(planContent);
  if (!frontmatter) return [];
  const raw = parseFrontmatterFields(frontmatter)['supersedes_adr'];
  if (!raw || raw === 'null') return [];
  const m = raw.match(/\[(.*)\]/);
  if (!m || !m[1].trim()) return [];
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
};

export type DeclaredSupersessionEntry = { issueRef: string; declaredAdrs: string[] };

export const findDeclaredSupersessionViolations = (
  entries: DeclaredSupersessionEntry[],
  adrContents: Map<string, string | undefined>,
): { issueRef: string; adr: string }[] => {
  const violations: { issueRef: string; adr: string }[] = [];
  for (const entry of entries) {
    for (const adr of entry.declaredAdrs) {
      const content = adrContents.get(adr);
      if (content === undefined || !hasPostAcceptanceAmendmentCitingIssue(content, entry.issueRef)) {
        violations.push({ issueRef: entry.issueRef, adr });
      }
    }
  }
  return violations;
};

const findAdrFileByNumber = (decisionsDir: string, adrRef: string): string | null => {
  if (!fs.existsSync(decisionsDir)) return null;
  const found = fs.readdirSync(decisionsDir).find((f) => f.startsWith(`${adrRef}-`));
  return found ? path.join(decisionsDir, found) : null;
};

// Absent `.blackhole/plans/` (a fresh, non-self-hosting checkout, or this worktree before any
// plan lands) degrades to a logged no-op — same existence-gate convention doc-governance.md's
// Doc-Tree Health Signal uses for doc-health.check.ts.
export const collectDeclaredSupersessionViolations = (repoRoot: string): { issueRef: string; adr: string }[] => {
  const plansDir = path.join(repoRoot, '.blackhole', 'plans');
  if (!fs.existsSync(plansDir)) {
    console.error('adr-supersession.check.ts: .blackhole/plans/ absent — leg 1 no-op');
    return [];
  }
  const entries: DeclaredSupersessionEntry[] = [];
  for (const f of fs.readdirSync(plansDir).filter((n) => n.endsWith('.md'))) {
    const content = fs.readFileSync(path.join(plansDir, f), 'utf-8');
    const { frontmatter } = parseMdFrontmatter(content);
    const issueRef = parseFrontmatterFields(frontmatter)['issue'];
    const declaredAdrs = extractSupersedesAdrDeclaration(content);
    if (issueRef && declaredAdrs.length) entries.push({ issueRef, declaredAdrs });
  }
  if (!entries.length) return [];

  const decisionsDir = path.join(repoRoot, 'documentation', 'decisions');
  const adrContents = new Map<string, string | undefined>();
  for (const entry of entries) {
    for (const adr of entry.declaredAdrs) {
      if (adrContents.has(adr)) continue;
      const file = findAdrFileByNumber(decisionsDir, adr);
      adrContents.set(adr, file ? fs.readFileSync(file, 'utf-8') : undefined);
    }
  }
  return findDeclaredSupersessionViolations(entries, adrContents);
};

// --- Leg 2: undeclared reversal phrasing in tracked prose ---

// `(?!:)` right after the trigger word excludes the frontmatter key-form `supersedes: <path>`
// (hunt/docs.md's own `V-DOC-04` heuristic-2 concern, already enforced there) — this leg targets
// the *prose announcement* form a reversal is actually written in (e.g. "intentionally
// supersedes ADR-007"), not the structured field. `[^.\n]*?` bounds the gap to one sentence so
// an unrelated ADR mention later in a long line/paragraph is never swept in. `(?<!V-)` right
// before the capture excludes this check's own vcode id, same rationale as links.check.ts's
// ADR-reference scan — see that file's comment on its `(?<!V-)ADR-(\d+)` match.
const PHRASE_SCAN_SOURCE = String.raw`\b(?:supersedes|reverses|contrary to|do not amend)\b(?!:)[^.\n]*?(?<!V-)(ADR-\d+)`;

export const extractPhraseScanCitations = (content: string): { line: number; adr: string }[] => {
  const out: { line: number; adr: string }[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const re = new RegExp(PHRASE_SCAN_SOURCE, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[i]))) out.push({ line: i + 1, adr: m[1] });
  }
  return out;
};

export type PhraseScanCitation = { relPath: string; line: number; adr: string };

export const findPhraseScanViolations = (
  citations: PhraseScanCitation[],
  adrHasAmendment: Map<string, boolean>,
): PhraseScanCitation[] => citations.filter((c) => !adrHasAmendment.get(c.adr));

const toPosixRel = (from: string, to: string): string => path.relative(from, to).split(path.sep).join('/');

// `src/**/*.md` + `documentation/**/*.md`, excluding `documentation/decisions/` (the AC's own
// exclusion — that folder's ADR/INDEX prose legitimately discusses reversals of itself).
export const collectPhraseScanViolations = (repoRoot: string): PhraseScanCitation[] => {
  const srcDir = path.join(repoRoot, 'src');
  const docsDir = path.join(repoRoot, 'documentation');
  const files = [
    ...walkMdFilesAbs(srcDir),
    ...walkMdFilesAbs(docsDir).filter((f) => !toPosixRel(docsDir, f).startsWith('decisions/')),
  ];

  const decisionsDir = path.join(repoRoot, 'documentation', 'decisions');
  const adrHasAmendment = new Map<string, boolean>();
  const citations: PhraseScanCitation[] = [];
  for (const abs of files) {
    const content = fs.readFileSync(abs, 'utf-8');
    for (const c of extractPhraseScanCitations(content)) {
      citations.push({ relPath: toPosixRel(repoRoot, abs), line: c.line, adr: c.adr });
      if (!adrHasAmendment.has(c.adr)) {
        const adrFile = findAdrFileByNumber(decisionsDir, c.adr);
        adrHasAmendment.set(c.adr, adrFile ? hasPostAcceptanceAmendmentSection(fs.readFileSync(adrFile, 'utf-8')) : false);
      }
    }
  }
  return findPhraseScanViolations(citations, adrHasAmendment);
};

const checkAdrSupersession = (): CheckResult => {
  const declared = collectDeclaredSupersessionViolations(root);
  const phrased = collectPhraseScanViolations(root);
  if (!declared.length && !phrased.length) return { id: 'V-ADR-06', ok: true };

  const details: string[] = [];
  if (declared.length) {
    details.push(
      `declared supersedes_adr without a Post-acceptance amendments entry citing the issue: ${declared
        .map((v) => `${v.issueRef}→${v.adr}`)
        .join(', ')}`,
    );
  }
  if (phrased.length) {
    details.push(
      `undisclosed ADR reversal phrasing: ${phrased.map((v) => `${v.relPath}:${v.line} (${v.adr})`).join(', ')}`,
    );
  }
  return { id: 'V-ADR-06', ok: false, detail: details.join('; ') };
};

// ADR-007 T5/R2': domain entrypoint — see adr-status.check.ts's runChecks doc comment for the
// shared contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkAdrSupersession()];
