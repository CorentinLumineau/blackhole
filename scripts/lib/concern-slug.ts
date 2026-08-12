const LABEL_PREFIX_RE = /^(?:\[(?:size|priority):[^\]]+\]\s*)+/i;
const SIZE_PRIORITY_TOKEN_RE = /^(?:size|priority):[a-z0-9-]+\s+/i;

/** Strip GitHub issue title adornments and normalize to a kebab-case concern slug (max 80 chars). */
export function deriveConcernSlug(title: string, _issueNumber: number): string {
  let working = title.trim();
  while (LABEL_PREFIX_RE.test(working) || SIZE_PRIORITY_TOKEN_RE.test(working)) {
    working = working.replace(LABEL_PREFIX_RE, '').replace(SIZE_PRIORITY_TOKEN_RE, '').trim();
  }

  const slug = working
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');

  return slug || `issue-${_issueNumber}`;
}

/** Plan artifact path — `plan-{slug}.md` unless the title already carries a plan prefix. */
export function planTargetPath(title: string, issueNumber: number): string {
  const slug = deriveConcernSlug(title, issueNumber);
  const hasPlanPrefix = /^\s*plan\b/i.test(title.trim());
  return hasPlanPrefix
    ? `documentation/plans/${slug}.md`
    : `documentation/plans/plan-${slug}.md`;
}

/** Review artifact path — always `review-{slug}.md`. */
export function reviewTargetPath(title: string, issueNumber: number): string {
  const slug = deriveConcernSlug(title, issueNumber);
  return `documentation/reviews/review-${slug}.md`;
}
