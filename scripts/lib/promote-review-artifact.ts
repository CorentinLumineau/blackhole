export type RecheckEntry = {
  verdict: 'fixed' | 'not_fixed';
  evidence?: string;
  at?: string;
};

export type LedgerFinding = {
  id: string;
  vcode: string;
  severity: string;
  phase: string;
  issue_ref: number;
  pr_ref: number | null;
  file: string;
  line: number;
  summary: string;
  status: string;
  deferred_to_issue?: number | null;
  created_at?: string;
  recheck?: RecheckEntry[];
};

export type LedgerFile = {
  findings: LedgerFinding[];
};

export type ReviewPromotionInput = {
  issueNumber: number;
  issueTitle: string;
  prNumber: number;
  branchName: string;
  headSha: string;
  ledger: LedgerFile;
  today?: string;
};

export type ReviewPromotionOutput = {
  targetPath: string;
  slug: string;
  markdown: string;
  indexRow: string;
  verdict: 'LGTM' | 'CHANGES REQUESTED';
  /** Count of blocking findings only — deferred rows are excluded. */
  findingsCount: number;
};

import { deriveConcernSlug, reviewTargetPath } from './concern-slug.ts';

const SEVERITY_RANK: Record<string, number> = { BLOCK: 3, WARN: 2, NOTE: 1, INFO: 1 };

const findingKey = (f: LedgerFinding): string => `${f.vcode}\0${f.file}\0${f.line}`;

const isRecheckFixed = (finding: LedgerFinding): boolean => {
  const recheck = finding.recheck ?? [];
  if (recheck.length === 0) return false;
  return recheck[recheck.length - 1]!.verdict === 'fixed';
};

const isRecheckNotFixed = (finding: LedgerFinding): boolean => {
  const recheck = finding.recheck ?? [];
  if (recheck.length === 0) return false;
  return recheck[recheck.length - 1]!.verdict === 'not_fixed';
};

/** Select final-iteration review findings for promotion (ADR-021 D3). */
export function selectReviewFindings(
  ledger: LedgerFile,
  issueNumber: number,
  prNumber: number,
): LedgerFinding[] {
  const candidates = ledger.findings.filter(
    (f) =>
      f.issue_ref === issueNumber &&
      (f.phase === 'review' || f.pr_ref === prNumber),
  );

  const byKey = new Map<string, LedgerFinding>();
  for (const finding of candidates) {
    if (finding.status === 'resolved' && !isRecheckNotFixed(finding)) continue;
    if (finding.status === 'fixed-in-pr' && !isRecheckNotFixed(finding)) continue;
    if (isRecheckFixed(finding)) continue;

    const key = findingKey(finding);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, finding);
      continue;
    }
    const existingPr = existing.pr_ref ?? 0;
    const nextPr = finding.pr_ref ?? 0;
    if (nextPr > existingPr) {
      byKey.set(key, finding);
      continue;
    }
    if (nextPr === existingPr && (SEVERITY_RANK[finding.severity] ?? 0) > (SEVERITY_RANK[existing.severity] ?? 0)) {
      byKey.set(key, finding);
    }
  }

  return [...byKey.values()].sort((a, b) => {
    const rankDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
    if (rankDiff !== 0) return rankDiff;
    return a.file.localeCompare(b.file);
  });
}

export function renderIndexRow(targetPath: string, summary: string): string {
  const relPath = targetPath.replace(/^documentation\//, '');
  return `| ${relPath} | ${summary} | review | current | on file change |`;
}

export function renderReviewMarkdown(input: ReviewPromotionInput): ReviewPromotionOutput {
  const findings = selectReviewFindings(input.ledger, input.issueNumber, input.prNumber);
  const slug = deriveConcernSlug(input.issueTitle, input.issueNumber);
  const targetPath = reviewTargetPath(input.issueTitle, input.issueNumber);
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  // A deferred finding is filed as its own issue and is non-blocking by definition — it must
  // stay visible for disclosure but never count toward the verdict (issue #737).
  const blocking = findings.filter((f) => f.status !== 'deferred');
  const deferred = findings.filter((f) => f.status === 'deferred');
  const blockers = blocking.filter((f) => f.severity === 'BLOCK').length;
  const warns = blocking.filter((f) => f.severity === 'WARN').length;
  const verdict: 'LGTM' | 'CHANGES REQUESTED' = blockers > 0 || warns > 0 ? 'CHANGES REQUESTED' : 'LGTM';

  const findingsTable =
    blocking.length === 0
      ? '_No BLOCK/WARN findings at merge-readiness._\n'
      : [
          '| # | file:line | V-code | Severity | Finding |',
          '|---|---|---|---|---|',
          ...blocking.map(
            (f, i) =>
              `| ${i + 1} | \`${f.file}:${f.line}\` | ${f.vcode} | **${f.severity}** | ${f.summary.replace(/\|/g, '\\|')} |`,
          ),
        ].join('\n');

  const deferredTable =
    deferred.length === 0
      ? ''
      : `\n### Deferred (not counted toward verdict)\n\n${[
          '| # | file:line | V-code | Severity | Finding | Deferred to |',
          '|---|---|---|---|---|---|',
          ...deferred.map(
            (f, i) =>
              `| ${i + 1} | \`${f.file}:${f.line}\` | ${f.vcode} | ${f.severity} | ${f.summary.replace(/\|/g, '\\|')} | ${f.deferred_to_issue != null ? `#${f.deferred_to_issue}` : '—'} |`,
          ),
        ].join('\n')}\n`;

  const ledgerRow =
    deferred.length > 0
      ? `${blocking.length} BLOCK/WARN row(s) for issue #${input.issueNumber}, ${deferred.length} deferred`
      : `${blocking.length} BLOCK/WARN row(s) for issue #${input.issueNumber}`;

  const markdown = `---
type: review
status: current
review_trigger: "on file change"
created: ${today}
last_updated: ${today}
issue: ${input.issueNumber}
---

# Review: \`${input.branchName}\` (${input.headSha.slice(0, 7)})

**Verdict: ${verdict}** — ${blockers} BLOCK, ${warns} WARN at merge-readiness.

Diff: PR #${input.prNumber}, branch \`${input.branchName}\`.

## Quality gates — campaign review aggregate

| Gate | Result |
|---|---|
| Findings ledger | ${ledgerRow} |

## Findings

${findingsTable}
${deferredTable}`;

  const indexRow = renderIndexRow(
    targetPath,
    `Review artifact for issue #${input.issueNumber} (${verdict})`,
  );

  return {
    targetPath,
    slug,
    markdown,
    indexRow,
    verdict,
    findingsCount: blocking.length,
  };
}
