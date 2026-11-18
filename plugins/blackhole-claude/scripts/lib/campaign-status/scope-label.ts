export interface ScopeLike {
  milestone?: string | null;
  labels?: readonly string[] | null;
}

/**
 * The one formatter of the campaign issue filter, shared by the text dashboard, `--summary`, the
 * HTML page and the `--data` Scope panel so no surface words the same scope differently.
 * `markdown` is the text-dashboard shape (bold milestone, backticked labels).
 */
export function formatScopeLabel(scope?: ScopeLike | null, style: 'plain' | 'markdown' = 'plain'): string {
  const md = style === 'markdown';
  const parts: string[] = [];
  if (scope?.milestone) parts.push(`milestone ${md ? `**${scope.milestone}**` : scope.milestone}`);
  if (scope?.labels?.length) parts.push(`labels ${scope.labels.map((l) => (md ? `\`${l}\`` : l)).join(', ')}`);
  return parts.length ? parts.join(' and ') : 'all open issues';
}
