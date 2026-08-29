/** Ops surfaces that should stage/patch a runbook (issue #689). */
export const OPS_TOUCH_PATH_GLOBS = [
  '.github/workflows/**',
  '.devlocal/**',
  'scripts/ci-*.sh',
  '**/e2e/**/*runner*',
] as const;

export function touchPathsHitOpsSurface(touchPaths: string[]): boolean {
  const normalized = touchPaths.map((p) => p.replace(/\\/g, '/'));
  return normalized.some((path) => {
    if (path.includes('.github/workflows')) return true;
    if (path.includes('.devlocal')) return true;
    if (/scripts\/ci-.*\.sh/i.test(path) || path.startsWith('scripts/ci-')) return true;
    if (/e2e/i.test(path) && /runner/i.test(path)) return true;
    return false;
  });
}

export function defaultRunbookTargetForIssue(issueNumber: number, concernSlug: string): string {
  // Search-before-write: prefer patching an existing runbook; callers grep first.
  return `documentation/runbooks/${concernSlug || `issue-${issueNumber}`}.md`;
}
