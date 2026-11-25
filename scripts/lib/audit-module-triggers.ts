// ADR-034 amendment (issue #1387, V-PARETO-02 fix round): the `Load when` line of each on-demand
// reviewer audit module, restated as a predicate over facts the orchestrator already holds, so a
// reviewer that skipped a module whose trigger holds is caught by a script instead of by prose.
// `src/agents/reviewer.md` stubs stay the reviewer-facing wording; `findAuditModuleTriggerDrift`
// (audit-modules.check.ts) keeps this table and the module directory from diverging.

export type AuditContext = {
  /** Repo-relative paths of the reviewed diff (for a recheck dispatch: the fix commits' files). */
  changedFiles: string[];
  /** Contents of the plan file at PLAN_ABSOLUTE_PATH; absent when no plan exists. */
  planText?: string;
  /** Parsed `.blackhole/config.json`. */
  config?: { docs_governance?: { enabled?: boolean; companion_files?: boolean; write_governance?: boolean }; display_targets?: unknown[] };
  route?: { ui?: boolean; size?: string; task_type?: string; security_review_required?: boolean };
  /** Parsed `queue.json`. */
  queue?: { pipeline_detection?: { actionman_workclaude?: boolean } };
  /** Dispatch kind of this reviewer spawn. */
  dispatch?: { recheck?: boolean };
  /** `documentation/reference/product-principles.md` exists in the reviewed repo. */
  productPrinciplesExists?: boolean;
  /** The diff is frontend-touching by the `scripts/detect-frontend.sh` keyword set. */
  frontendDiff?: boolean;
};

// One home for every path set a predicate uses. `AUDIT_TRIGGER_GLOBS` is also what
// `findTriggerGlobDrift` (audit-modules.check.ts, Leg E) requires each reviewer stub to spell out,
// so the stub wording and the predicate cannot name different paths.
const DOC_GLOBS = ['**/*.md', 'documentation/**', 'codex-agents/*.yaml'] as const;
const HOOKS_GLOB = 'templates/hooks/**';
const TEST_GLOBS = ['**/*.test.{ts,tsx,js,mjs}', '**/__tests__/**'] as const;
// Hand-authored roots: a changed path outside them is a generated mirror, not source.
const SOURCE_ROOT_GLOBS = ['src/**', 'scripts/**', 'templates/**'] as const;

export const AUDIT_TRIGGER_GLOBS: Record<string, readonly string[]> = {
  '08-docs-only-execution-mode.md': DOC_GLOBS,
  '29-plugin-cache-version-bump-audit.md': [HOOKS_GLOB],
  '30-v-test09-hooks-claim-audit.md': [HOOKS_GLOB, ...SOURCE_ROOT_GLOBS],
};

const matchesAny = (globs: readonly string[], file: string): boolean => globs.some((g) => new Bun.Glob(g).match(file));
const isDocPath = (f: string): boolean => matchesAny(DOC_GLOBS, f);
const isHooksPath = (f: string): boolean => matchesAny([HOOKS_GLOB], f);
// Changed source: under a hand-authored root, and neither a test nor a documentation file.
const changedSource = (c: AuditContext): string[] =>
  c.changedFiles.filter((f) => matchesAny(SOURCE_ROOT_GLOBS, f) && !matchesAny(TEST_GLOBS, f) && !isDocPath(f));

const docsGate = (c: AuditContext): boolean => c.config?.docs_governance?.enabled === true;
const writeGate = (c: AuditContext): boolean => docsGate(c) && c.config?.docs_governance?.write_governance !== false;
const planHasHeading = (c: AuditContext, heading: string): boolean =>
  new RegExp(`^## ${heading}\\s*$`, 'm').test(c.planText ?? '');
const planFrontmatterValue = (c: AuditContext, key: string): string | undefined =>
  new RegExp(`^${key}:\\s*(\\S+)\\s*$`, 'm').exec(/^---\n([\s\S]*?)\n---/.exec(c.planText ?? '')?.[1] ?? '')?.[1];

export const AUDIT_MODULE_TRIGGERS: Record<string, (c: AuditContext) => boolean> = {
  '08-docs-only-execution-mode.md': (c) =>
    planFrontmatterValue(c, 'execution_mode') === 'docs-only' ||
    c.route?.task_type === 'docs' ||
    (c.planText === undefined && c.changedFiles.length > 0 && c.changedFiles.every(isDocPath)),
  '10-companion-file-audit.md': (c) => docsGate(c) && c.config?.docs_governance?.companion_files !== false,
  '13-recheck-mode-compliance.md': (c) => c.dispatch?.recheck === true,
  '14-information-hierarchy-audit.md': (c) => c.frontendDiff === true,
  '16-threat-model-audit.md': (c) =>
    planHasHeading(c, 'Threat Model') ||
    (c.route?.security_review_required === true && planFrontmatterValue(c, 'track') === 'quick'),
  '17-performance-budget-audit.md': (c) => planHasHeading(c, 'Performance Budget'),
  '19-owner-ruling-violation-audit.md': (c) => docsGate(c) && c.config?.docs_governance?.companion_files !== false && c.productPrinciplesExists === true,
  '21-ui-interpretation-gate-audit.md': (c) => c.route?.ui === true && c.route?.size !== 'size:xs',
  '22-visual-evidence-audit.md': (c) =>
    Array.isArray(c.config?.display_targets) && c.config.display_targets.length > 0 && (c.route?.ui === true || c.frontendDiff === true),
  '25-staged-artifact-carry-audit.md': writeGate,
  '27-doc-governance-judgment-audit.md': (c) => writeGate(c) && c.changedFiles.some((f) => f.startsWith('documentation/')),
  '28-actionman-workclaude-discipline-audit.md': (c) => c.queue?.pipeline_detection?.actionman_workclaude === true,
  '29-plugin-cache-version-bump-audit.md': (c) => c.changedFiles.some(isHooksPath),
  '30-v-test09-hooks-claim-audit.md': (c) => changedSource(c).length > 0 && changedSource(c).every(isHooksPath),
};

export const requiredAuditModules = (ctx: AuditContext): string[] =>
  Object.entries(AUDIT_MODULE_TRIGGERS).filter(([, holds]) => holds(ctx)).map(([file]) => file);

/** Modules whose trigger holds for `ctx` but that the reviewer's `loaded_modules[]` omits. */
export const findUnloadedAuditModules = (ctx: AuditContext, loaded: readonly string[] | undefined): string[] =>
  requiredAuditModules(ctx).filter((file) => !(loaded ?? []).includes(file));

const DOCS_ONLY_MODULE = '08-docs-only-execution-mode.md';

/**
 * Why an orchestrator direct review (no reviewer spawned, so no `loaded_modules` to check) is not
 * allowed for `ctx`; empty when it is. Allowed only for a docs-only diff (every changed path in the
 * `DOC_GLOBS` set the docs-only module's own trigger uses) where no on-demand module other than the
 * docs-only one has a trigger that holds, since the orchestrator reads none of them.
 */
export const directReviewBlockers = (ctx: AuditContext): string[] => {
  const blockers: string[] = [];
  if (ctx.changedFiles.length === 0) blockers.push('the diff is empty, so docs-only cannot be established');
  const nonDoc = ctx.changedFiles.filter((f) => !isDocPath(f));
  if (nonDoc.length > 0) blockers.push(`non-documentation path(s) changed: ${nonDoc.slice(0, 5).join(', ')}`);
  const others = requiredAuditModules(ctx).filter((file) => file !== DOCS_ONLY_MODULE);
  if (others.length > 0) blockers.push(`on-demand module trigger(s) hold that a direct review does not read: ${others.join(', ')}`);
  return blockers;
};
