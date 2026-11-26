import { describe, expect, test } from 'bun:test';
import { AUDIT_MODULE_TRIGGERS, directReviewBlockers, findUnloadedAuditModules, requiredAuditModules, type AuditContext } from './audit-module-triggers.ts';

const base: AuditContext = { changedFiles: ['scripts/a.ts'] };
const docsOn = { docs_governance: { enabled: true } };

describe('requiredAuditModules', () => {
  test('a plain backend diff in a repo without docs_governance requires no module', () => {
    expect(requiredAuditModules(base)).toEqual([]);
  });

  test('a plan with a Threat Model heading requires the threat-model module (V-THREAT-02 BLOCK)', () => {
    const ctx = { ...base, planText: '---\ntrack: standard\n---\n## Threat Model\n| row |' };
    expect(requiredAuditModules(ctx)).toEqual(['16-threat-model-audit.md']);
  });

  test('suffixed Threat Model and Performance Budget headings still trigger modules 16 and 17', () => {
    const t = { ...base, planText: '---\ntrack: standard\n---\n## Threat Model (security_review_required)\n| row |' };
    expect(requiredAuditModules(t)).toContain('16-threat-model-audit.md');
    const p = { ...base, planText: '## Performance Budget (perf_review_required)\nx' };
    expect(requiredAuditModules(p)).toContain('17-performance-budget-audit.md');
  });

  test('a Quick-track security review requires the threat-model module without the heading', () => {
    const ctx = { ...base, planText: '---\ntrack: quick\n---\nbody', route: { security_review_required: true } };
    expect(requiredAuditModules(ctx)).toContain('16-threat-model-audit.md');
    expect(requiredAuditModules({ ...ctx, route: { security_review_required: false } })).not.toContain('16-threat-model-audit.md');
  });

  test('a Performance Budget heading requires V-PERF-01; the substring in prose does not', () => {
    expect(requiredAuditModules({ ...base, planText: '## Performance Budget\nx' })).toEqual(['17-performance-budget-audit.md']);
    expect(requiredAuditModules({ ...base, planText: 'see the ## Performance Budget idea' })).toEqual([]);
  });

  test('route.ui requires V-UI-01 unless the issue is size:xs', () => {
    expect(requiredAuditModules({ ...base, route: { ui: true, size: 'size:m' } })).toEqual(['21-ui-interpretation-gate-audit.md']);
    expect(requiredAuditModules({ ...base, route: { ui: true, size: 'size:xs' } })).toEqual([]);
  });

  test('display_targets plus a UI route requires the visual-evidence module', () => {
    const ctx = { ...base, config: { display_targets: [412] }, route: { ui: true, size: 'size:xs' } };
    expect(requiredAuditModules(ctx)).toEqual(['22-visual-evidence-audit.md']);
    expect(requiredAuditModules({ ...ctx, config: { display_targets: [] } })).toEqual([]);
  });

  test('docs_governance enabled requires the companion, owner-ruling and carry modules', () => {
    const ctx = { ...base, config: docsOn, productPrinciplesExists: true };
    expect(requiredAuditModules(ctx)).toEqual([
      '10-companion-file-audit.md',
      '19-owner-ruling-violation-audit.md',
      '25-staged-artifact-carry-audit.md',
    ]);
  });

  test('companion_files:false drops the companion and owner-ruling modules but keeps carry', () => {
    const ctx = { ...base, config: { docs_governance: { enabled: true, companion_files: false } }, productPrinciplesExists: true };
    expect(requiredAuditModules(ctx)).toEqual(['25-staged-artifact-carry-audit.md']);
  });

  test('a documentation diff adds the doc-governance judgment module only when write governance holds', () => {
    const ctx = { changedFiles: ['documentation/x.md'], config: docsOn };
    expect(requiredAuditModules(ctx)).toContain('27-doc-governance-judgment-audit.md');
    expect(requiredAuditModules({ ...ctx, config: { docs_governance: { enabled: true, write_governance: false } } })).not.toContain('27-doc-governance-judgment-audit.md');
  });

  test('a templates/hooks diff requires V-PLUGIN-01; only-hooks also requires the V-TEST-09 claim audit', () => {
    expect(requiredAuditModules({ changedFiles: ['templates/hooks/a.ts', 'scripts/b.ts'] })).toEqual(['29-plugin-cache-version-bump-audit.md']);
    expect(requiredAuditModules({ changedFiles: ['templates/hooks/a.ts'] })).toEqual([
      '29-plugin-cache-version-bump-audit.md',
      '30-v-test09-hooks-claim-audit.md',
    ]);
  });

  test('a hooks PR that also changes a test file (and docs) still requires the V-TEST-09 claim audit', () => {
    const files = ['templates/hooks/a.ts', 'scripts/hooks-validate-file.test.ts', 'documentation/x.md', 'plugins/blackhole-claude/scripts/gen.ts'];
    expect(requiredAuditModules({ changedFiles: files })).toEqual(['29-plugin-cache-version-bump-audit.md', '30-v-test09-hooks-claim-audit.md']);
  });

  test('a hooks PR that also changes non-hooks source does not require the V-TEST-09 claim audit', () => {
    expect(requiredAuditModules({ changedFiles: ['templates/hooks/a.ts', 'scripts/b.ts'] })).not.toContain('30-v-test09-hooks-claim-audit.md');
  });

  test('a codex-agents mirror alongside docs counts as documentation for the no-plan docs-only trigger', () => {
    expect(requiredAuditModules({ changedFiles: ['src/agents/x.md', 'codex-agents/x.yaml'] })).toEqual(['08-docs-only-execution-mode.md']);
    expect(requiredAuditModules({ changedFiles: ['codex-agents/x.yaml', 'scripts/a.ts'] })).toEqual([]);
  });

  test('docs-only plan, docs task_type, or an all-documentation diff with no plan requires the docs-only module', () => {
    expect(requiredAuditModules({ ...base, planText: '---\nexecution_mode: docs-only\n---\nx' })).toEqual(['08-docs-only-execution-mode.md']);
    expect(requiredAuditModules({ ...base, route: { task_type: 'docs' } })).toEqual(['08-docs-only-execution-mode.md']);
    expect(requiredAuditModules({ changedFiles: ['README.md'] })).toEqual(['08-docs-only-execution-mode.md']);
    expect(requiredAuditModules({ changedFiles: ['README.md'], planText: 'plan' })).toEqual([]);
  });

  test('recheck, actionman and frontend signals each require their own module', () => {
    expect(requiredAuditModules({ ...base, dispatch: { recheck: true } })).toEqual(['13-recheck-mode-compliance.md']);
    expect(requiredAuditModules({ ...base, queue: { pipeline_detection: { actionman_workclaude: true } } })).toEqual(['28-actionman-workclaude-discipline-audit.md']);
    expect(requiredAuditModules({ ...base, frontendDiff: true })).toEqual(['14-information-hierarchy-audit.md']);
  });

  test('the table covers all 14 on-demand modules', () => {
    expect(Object.keys(AUDIT_MODULE_TRIGGERS)).toHaveLength(14);
  });
});

describe('findUnloadedAuditModules', () => {
  const ctx = { ...base, planText: '## Threat Model\nx', route: { ui: true, size: 'size:m' } };

  test('reports every triggered module the reviewer did not list', () => {
    expect(findUnloadedAuditModules(ctx, ['16-threat-model-audit.md'])).toEqual(['21-ui-interpretation-gate-audit.md']);
  });

  test('an absent loaded_modules fails every triggered module (fail closed)', () => {
    expect(findUnloadedAuditModules(ctx, undefined)).toEqual(['16-threat-model-audit.md', '21-ui-interpretation-gate-audit.md']);
  });

  test('loading a module whose trigger does not hold is not an error', () => {
    expect(findUnloadedAuditModules(base, ['16-threat-model-audit.md'])).toEqual([]);
  });
});

describe('directReviewBlockers', () => {
  test('a plan-bearing non-docs-only PR whose diff is only .md is blocked; a docs-only plan is allowed', () => {
    const featurePlan = '---\ntrack: standard\n---\n## Objective\n';
    expect(directReviewBlockers({ changedFiles: ['README.md'], planText: featurePlan }).join()).toContain('docs-only module trigger does not hold');
    expect(directReviewBlockers({ changedFiles: ['README.md'], planText: '---\nexecution_mode: docs-only\n---\n' })).toEqual([]);
    expect(directReviewBlockers({ changedFiles: ['README.md'], planText: featurePlan, route: { task_type: 'docs' } })).toEqual([]);
  });

  test('a docs-only diff with no other trigger is allowed', () => {
    expect(directReviewBlockers({ changedFiles: ['README.md', 'documentation/a.md', 'codex-agents/x.yaml'] })).toEqual([]);
  });

  test('an empty diff, a source path, or a holding module trigger each block', () => {
    expect(directReviewBlockers({ changedFiles: [] })[0]).toContain('empty');
    expect(directReviewBlockers({ changedFiles: ['README.md', 'scripts/a.ts'] }).join()).toContain('scripts/a.ts');
    const gated = directReviewBlockers({ changedFiles: ['README.md'], config: docsOn });
    expect(gated.join()).toContain('10-companion-file-audit.md');
    expect(gated.join()).not.toContain('08-docs-only');
  });
});
