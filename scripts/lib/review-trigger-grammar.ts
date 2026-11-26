// SSOT for the machine-evaluable `review_trigger` form (doc-governance.md § Lifecycle Frontmatter).
// Advisory only: the grammar is linted offline; no forge lookup evaluates it yet.

export type ReviewTrigger =
  | { kind: 'issue-close'; issue: number }
  | { kind: 'malformed' }
  | { kind: 'opaque' };

const ISSUE_CLOSE = /^on issue-close #(\d+)$/;
const ISSUE_REF = /#\d+/;
const CLOSURE_WORD = /clos|merge/i;

const unquote = (raw: string): string => raw.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

// Opaque values (the mercure enum, free text without an issue reference) are never findings.
export const parseReviewTrigger = (raw: string): ReviewTrigger => {
  const value = unquote(raw);
  const match = ISSUE_CLOSE.exec(value);
  if (match) return { kind: 'issue-close', issue: Number(match[1]) };
  return ISSUE_REF.test(value) && CLOSURE_WORD.test(value) ? { kind: 'malformed' } : { kind: 'opaque' };
};

export const findMalformedIssueTriggers = (docs: { relPath: string; reviewTrigger: string }[]): string[] =>
  docs.filter((d) => parseReviewTrigger(d.reviewTrigger).kind === 'malformed').map((d) => d.relPath);
