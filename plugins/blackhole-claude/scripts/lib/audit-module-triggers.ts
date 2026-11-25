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
  dispatch?: { recheck?: boolean; independentVerification?: boolean };
  /** `documentation/reference/product-principles.md` exists in the reviewed repo. */
  productPrinciplesExists?: boolean;
  /** The diff is frontend-touching by the `scripts/detect-frontend.sh` keyword set. */
  frontendDiff?: boolean;
};

const DOC_PATH = /^(documentation\/|.*\.md$)/;
const HOOKS_PATH = /^templates\/hooks\//;

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
    (c.planText === undefined && c.changedFiles.length > 0 && c.changedFiles.every((f) => DOC_PATH.test(f))),
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
  '24-independent-security-verification.md': (c) => c.dispatch?.independentVerification === true,
  '25-staged-artifact-carry-audit.md': writeGate,
  '27-doc-governance-judgment-audit.md': (c) => writeGate(c) && c.changedFiles.some((f) => f.startsWith('documentation/')),
  '28-actionman-workclaude-discipline-audit.md': (c) => c.queue?.pipeline_detection?.actionman_workclaude === true,
  '29-plugin-cache-version-bump-audit.md': (c) => c.changedFiles.some((f) => HOOKS_PATH.test(f)),
  '30-v-test09-hooks-claim-audit.md': (c) => c.changedFiles.length > 0 && c.changedFiles.every((f) => HOOKS_PATH.test(f)),
};

export const requiredAuditModules = (ctx: AuditContext): string[] =>
  Object.entries(AUDIT_MODULE_TRIGGERS).filter(([, holds]) => holds(ctx)).map(([file]) => file);

/** Modules whose trigger holds for `ctx` but that the reviewer's `loaded_modules[]` omits. */
export const findUnloadedAuditModules = (ctx: AuditContext, loaded: readonly string[] | undefined): string[] =>
  requiredAuditModules(ctx).filter((file) => !(loaded ?? []).includes(file));
