import * as fs from 'fs';
import * as path from 'path';
import { root, read, type CheckResult } from './check-utils.ts';
import { walkMdFilesAbs } from '../lib/check-common.ts';

// ADR-007 T5/R2' — links.check.ts: markdown cross-reference integrity + epic-runbook linkage
// (split from the former catch-all check file, issue #322).

const srcDir = path.join(root, 'src');

// V-LINK-01 (ADR-007 T4/R7): markdown cross-reference integrity.
//
// Extracts `[text](target)` link targets from `content`, one-indexed by line. Skips targets
// inside fenced (```) code blocks, absolute http(s)/mailto links, and pure-anchor (`#fragment`)
// links — none of those are a same-repo cross-reference this check can validate.
export const extractMarkdownLinkTargets = (content: string): { line: number; target: string }[] => {
  const out: { line: number; target: string }[] = [];
  let inFence = false;
  const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;

  content.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    let m: RegExpExecArray | null;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(line))) {
      const target = m[1].trim();
      if (/^https?:\/\//.test(target) || /^mailto:/.test(target) || target.startsWith('#')) continue;
      out.push({ line: i + 1, target });
    }
  });

  return out;
};

// Resolves every link target in `content` relative to `fileAbs`'s directory (stripping any
// `#fragment` suffix) and reports the ones that do not exist on disk. `fileLabel` (defaults to
// `fileAbs`) is the path used in the error message, so callers can report a repo-relative path.
export const findDeadMarkdownLinks = (fileAbs: string, content: string, fileLabel: string = fileAbs): string[] => {
  const errors: string[] = [];

  for (const { line, target } of extractMarkdownLinkTargets(content)) {
    const withoutFragment = target.split('#')[0];
    if (!withoutFragment) continue;
    const resolved = path.resolve(path.dirname(fileAbs), withoutFragment);
    if (!fs.existsSync(resolved)) {
      errors.push(`${fileLabel}:${line}: dead link -> ${target}`);
    }
  }

  return errors;
};

// Same "ADR-NNN" shorthand this repo uses for its own documentation/decisions/ADR-*.md files is
// also used in a few places to reference *another* repo's ADR numbering (mercure) — those can
// never resolve to a local file and are not doc drift. Each entry below carries the exact prose
// that scopes it externally, so the allowlist can be audited at a glance.
export const EXTERNAL_ADR_REFS: ReadonlySet<string> = new Set([
  '026', // ADR-002-synthesizer-extraction.md: "ADR-026 in mercure"
  '082', // ADR-006-kaizen-hunt.md: "x-analyze ADR-082 lesson" / "the mechanism ADR-082 exists"
  '103', // ADR-016-story-driven-conformance-adoption.md: "the architecture defined in mercure ADR-103"
]);

// Parses a `related:` key out of ADR frontmatter (the block already captured between the `---`
// delimiters), supporting both the block-list form (`related:\n  - a\n  - b`) and the inline
// array form (`related: [a, b]`) documented in `.claude/rules/doc-governance.md`.
const extractRelatedEntries = (frontmatter: string): string[] => {
  const lines = frontmatter.split('\n');
  const headerIdx = lines.findIndex((l) => /^related:/.test(l));
  if (headerIdx === -1) return [];

  const inlineMatch = lines[headerIdx].match(/^related:\s*\[(.*)\]\s*$/);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  const entries: string[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const itemMatch = lines[i].match(/^\s+-\s+(.+)$/);
    if (!itemMatch) break;
    entries.push(itemMatch[1].trim());
  }
  return entries;
};

// Validates documentation/decisions/*.md ADR cross-references: every `related:` frontmatter
// entry must resolve (relative to `repoRoot`) to a file on disk, and every inline `ADR-NNN`
// mention must resolve to a local `documentation/decisions/ADR-NNN-*.md` file unless it is in
// `externalAdrRefs`. Returns [] when `documentation/decisions/` does not exist (e.g. a fixture
// repo without ADRs) rather than treating that as an error — this check only validates
// cross-references that are present, it does not require the directory to exist.
export const findAdrCrossReferenceErrors = (
  repoRoot: string,
  externalAdrRefs: ReadonlySet<string> = EXTERNAL_ADR_REFS,
): string[] => {
  const decisionsDir = path.join(repoRoot, 'documentation', 'decisions');
  if (!fs.existsSync(decisionsDir)) return [];

  const adrFiles = fs.readdirSync(decisionsDir).filter((f) => /^ADR-\d+-.*\.md$/.test(f));
  const localAdrNumbers = new Set(adrFiles.map((f) => f.match(/^ADR-(\d+)-/)![1]));
  const errors: string[] = [];

  for (const file of adrFiles) {
    const abs = path.join(decisionsDir, file);
    const content = fs.readFileSync(abs, 'utf-8');
    const rel = path.relative(repoRoot, abs);

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      for (const entry of extractRelatedEntries(frontmatterMatch[1])) {
        const resolved = path.resolve(repoRoot, entry);
        if (!fs.existsSync(resolved)) {
          errors.push(`${rel}: related: entry does not exist -> ${entry}`);
        }
      }
    }

    for (const m of content.matchAll(/ADR-(\d+)/g)) {
      const num = m[1];
      if (externalAdrRefs.has(num) || localAdrNumbers.has(num)) continue;
      errors.push(`${rel}: inline mention of ADR-${num} does not resolve to a local documentation/decisions/ADR-${num}-*.md file`);
    }
  }

  return errors;
};

// V-LINK-01: src/**/*.md cross-references resolve on disk; documentation/decisions/*.md ADR
// cross-references (related: frontmatter + inline ADR-NNN mentions) resolve locally.
const checkLinkIntegrity = (): CheckResult => {
  const errors: string[] = [];

  for (const abs of walkMdFilesAbs(srcDir)) {
    const rel = path.relative(root, abs);
    const content = fs.readFileSync(abs, 'utf-8');
    errors.push(...findDeadMarkdownLinks(abs, content, rel));
  }

  errors.push(...findAdrCrossReferenceErrors(root));

  if (errors.length) return { id: 'V-LINK-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-LINK-01', ok: true };
};

// V-EPIC-01: epic-orchestration.md exists and phase-handle.md links to it
const checkEpicRunbook = (): CheckResult => {
  const errors: string[] = [];

  if (!fs.existsSync(path.join(srcDir, 'references', 'epic-orchestration.md'))) {
    errors.push('epic-orchestration.md does not exist');
  }

  const phaseHandle = read('src/references/phase-handle.md');
  if (!phaseHandle.includes('epic-orchestration.md')) {
    errors.push('phase-handle.md does not link to epic-orchestration.md');
  }

  const issueSplitting = read('src/references/issue-splitting.md');
  if (!issueSplitting.includes('epic-orchestration.md')) {
    errors.push('issue-splitting.md does not link to epic-orchestration.md');
  }

  if (errors.length) return { id: 'V-EPIC-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-EPIC-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkLinkIntegrity(), checkEpicRunbook()];
