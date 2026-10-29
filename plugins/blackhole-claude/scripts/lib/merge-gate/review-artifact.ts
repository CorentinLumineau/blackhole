import * as fs from 'fs';
import * as path from 'path';
import { reviewTargetPath } from '../concern-slug.ts';
import { renderReviewMarkdown, type LedgerFile } from '../promote-review-artifact.ts';

export type DocsGovernanceConfig = {
  enabled?: boolean;
  write_governance?: boolean;
};

export function writeGovernanceActive(config: DocsGovernanceConfig | undefined): boolean {
  return config?.enabled === true && config?.write_governance === true;
}

/** merge-gate.md §5 — review artifact must be on the PR before merge. */
export function reviewArtifactPresent(
  issueTitle: string,
  issueNumber: number,
  prDiffPaths: string[],
  config: DocsGovernanceConfig | undefined,
): boolean {
  if (!writeGovernanceActive(config)) return true;
  const expected = reviewTargetPath(issueTitle, issueNumber);
  return prDiffPaths.includes(expected);
}

const CREATED_DATE_RE = /^created:\s*(\S+)\s*$/m;

// `renderReviewMarkdown` defaults `today` to `new Date()` — a naive re-render at check time
// would stamp today's date into `created:`/`last_updated:` and diff spuriously against a
// committed artifact from an earlier day on any cross-midnight PR (issue #806). Extracting the
// committed file's own `created:` value and feeding it back in as the `today` override means
// only actual content can differ.
export function extractCreatedDate(markdown: string): string | undefined {
  return markdown.match(CREATED_DATE_RE)?.[1];
}

/**
 * Issue #806 — re-renders the expected review markdown from the live findings ledger
 * (`renderReviewMarkdown`, a pure function of the ledger the promoter does not control — see
 * `blackhole-state.md` § Single-writer invariant) and diffs it against the committed file. This
 * replaces the removed `manifestHasReviewRoute` leg, which was circular by construction: it
 * checked a manifest entry the same party being verified (the promoter) had written.
 */
export function reviewArtifactContentMatchesLedger(opts: {
  issueTitle: string;
  issueNumber: number;
  prNumber: number;
  branchName: string;
  headSha: string;
  ledger: LedgerFile;
  repoRoot: string;
}): { ok: boolean; reason?: string } {
  const targetPath = reviewTargetPath(opts.issueTitle, opts.issueNumber);
  const committedPath = path.join(opts.repoRoot, targetPath);
  if (!fs.existsSync(committedPath)) {
    return { ok: false, reason: `missing committed review artifact at ${targetPath}` };
  }

  const committed = fs.readFileSync(committedPath, 'utf-8');
  const today = extractCreatedDate(committed);
  const expected = renderReviewMarkdown({
    issueNumber: opts.issueNumber,
    issueTitle: opts.issueTitle,
    prNumber: opts.prNumber,
    branchName: opts.branchName,
    headSha: opts.headSha,
    ledger: opts.ledger,
    today,
  });

  if (expected.markdown !== committed) {
    return {
      ok: false,
      reason: `committed review artifact at ${targetPath} does not match the findings-ledger re-render`,
    };
  }

  return { ok: true };
}

export function mergeReadinessForReviewPromotion(opts: {
  issueTitle: string;
  issueNumber: number;
  prDiffPaths: string[];
  config: DocsGovernanceConfig | undefined;
  prNumber: number;
  branchName: string;
  headSha: string;
  ledger: LedgerFile;
  repoRoot: string;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!writeGovernanceActive(opts.config)) {
    return { ok: true, reasons };
  }

  if (!reviewArtifactPresent(opts.issueTitle, opts.issueNumber, opts.prDiffPaths, opts.config)) {
    reasons.push(`PR missing ${reviewTargetPath(opts.issueTitle, opts.issueNumber)}`);
  } else {
    // Content check runs only once presence already passed, so a missing file is never
    // reported twice (once as "missing from diff", once as "missing from disk").
    const contentCheck = reviewArtifactContentMatchesLedger({
      issueTitle: opts.issueTitle,
      issueNumber: opts.issueNumber,
      prNumber: opts.prNumber,
      branchName: opts.branchName,
      headSha: opts.headSha,
      ledger: opts.ledger,
      repoRoot: opts.repoRoot,
    });
    if (!contentCheck.ok && contentCheck.reason) {
      reasons.push(contentCheck.reason);
    }
  }

  return { ok: reasons.length === 0, reasons };
}
