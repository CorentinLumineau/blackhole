import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './checks/check-utils.ts';
import {
  AUDIT_MODULE_DIR,
  ONDEMAND_AUDIT_MODULE_DIR,
  documentedCodes,
  findOnDemandStubDrift,
  findTriggerTableDrift,
  findAuditModuleCountDrift,
  findAuditRegistryDrift,
  loadAuditModules,
  parseAuditModuleVcodes,
  reviewerSitedCodes,
  runChecks,
} from './checks/audit-modules.check.ts';
import { REVIEWER_AUDIT_MODULE_COUNT, REVIEWER_ONDEMAND_AUDIT_MODULE_COUNT } from './lib/build/facts.ts';

// ADR-034 / V-AUDIT-01. Every leg below is driven first with a registry that is deliberately
// broken (red) and then with the corresponding healthy shape (green), so the check demonstrates
// it can fail on its own inputs rather than only ever being observed passing (V-UNFALSIFIABLE-01).
// The environment each leg names is the live pair the check reads in production: the audit-module
// directory's `vcodes:` frontmatter and `blackhole-vcodes.md`'s enforcement-site column.

const mod = (file: string, vcodes: string[]) => ({ file, vcodes });

const TABLE = [
  '| Code | Rule | Severity | Primary enforcement site |',
  '|------|------|----------|--------------------------|',
  '| V-ALPHA-01 | Alpha rule | BLOCK | reviewer.md § Alpha Audit |',
  '| V-BETA-01/02 | Beta rule | WARN | reviewer.md § Beta Audit |',
  '| V-GAMMA-01 | Gamma rule | BLOCK | implementer.md § Gamma Gate + reviewer.md § Gamma Backstop |',
  '| V-DELTA-01 | Delta rule | WARN | scripts/checks/delta.check.ts |',
].join('\n');

describe('parseAuditModuleVcodes', () => {
  test('reads a YAML flow sequence out of module frontmatter', () => {
    const content = '---\nsection: Alpha Audit\nvcodes: [V-ALPHA-01, V-BETA-01]\n---\n### Alpha Audit\nbody\n';
    expect(parseAuditModuleVcodes(content)).toEqual(['V-ALPHA-01', 'V-BETA-01']);
  });

  test('an empty list and an absent key both yield no claimed codes', () => {
    expect(parseAuditModuleVcodes('---\nsection: Empty\nvcodes: []\n---\nbody\n')).toEqual([]);
    expect(parseAuditModuleVcodes('### No frontmatter at all\nbody\n')).toEqual([]);
  });
});

describe('reviewerSitedCodes / documentedCodes', () => {
  test('reviewer-sited selection expands combined keys and keeps compound sites', () => {
    expect(reviewerSitedCodes(TABLE)).toEqual(['V-ALPHA-01', 'V-BETA-01', 'V-BETA-02', 'V-GAMMA-01']);
  });

  test('documented set spans every row, reviewer-sited or not', () => {
    expect(documentedCodes(TABLE)).toContain('V-DELTA-01');
  });
});

describe('findAuditRegistryDrift (legs A and B)', () => {
  const sited = reviewerSitedCodes(TABLE);
  const table = documentedCodes(TABLE);
  const healthy = [mod('01-alpha.md', ['V-ALPHA-01']), mod('02-beta.md', ['V-BETA-01', 'V-BETA-02', 'V-GAMMA-01'])];

  test('red — a reviewer-sited code no module claims is reported by name', () => {
    const errors = findAuditRegistryDrift([mod('01-alpha.md', ['V-ALPHA-01'])], sited, table);
    expect(errors.some((e) => e.startsWith('V-GAMMA-01') && e.includes('claimed by no audit module'))).toBe(true);
  });

  test('red — a code claimed by two modules names both files', () => {
    const errors = findAuditRegistryDrift(
      [mod('01-alpha.md', ['V-ALPHA-01']), mod('02-beta.md', ['V-ALPHA-01', 'V-BETA-01', 'V-BETA-02', 'V-GAMMA-01'])],
      sited,
      table,
    );
    const contested = errors.find((e) => e.startsWith('V-ALPHA-01'));
    expect(contested).toContain('01-alpha.md');
    expect(contested).toContain('02-beta.md');
  });

  test('red — a claimed code with no table row is reported as absent from the table', () => {
    const errors = findAuditRegistryDrift([...healthy, mod('03-ghost.md', ['V-GHOST-99'])], sited, table);
    expect(errors.some((e) => e.startsWith('V-GHOST-99') && e.includes('absent from the V-code table'))).toBe(true);
  });

  test('red — an empty registry reports every reviewer-sited code rather than passing vacuously', () => {
    expect(findAuditRegistryDrift([], sited, table)).toHaveLength(sited.length);
  });

  test('green — exactly-once ownership of every reviewer-sited code passes', () => {
    expect(findAuditRegistryDrift(healthy, sited, table)).toEqual([]);
  });
});

describe('findAuditModuleCountDrift (leg C)', () => {
  test('red — a declared count above the directory count names both numbers', () => {
    const errors = findAuditModuleCountDrift(32, 31);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('32');
    expect(errors[0]).toContain('31');
    expect(errors[0]).toContain(AUDIT_MODULE_DIR);
  });

  test('red — a missing or empty module directory scans to zero and fails loudly', () => {
    expect(loadAuditModules(path.join(root, 'src/references/no-such-audits'))).toEqual([]);
    expect(findAuditModuleCountDrift(REVIEWER_AUDIT_MODULE_COUNT, 0)).toHaveLength(1);
  });

  test('green — matching counts pass', () => {
    expect(findAuditModuleCountDrift(32, 32)).toEqual([]);
  });
});

describe('runChecks live tree (V-AUDIT-01)', () => {
  test('every audit module on disk declares a non-empty vcodes list or an explicit empty one', () => {
    const modules = loadAuditModules(path.join(root, AUDIT_MODULE_DIR));
    expect(modules.length).toBe(REVIEWER_AUDIT_MODULE_COUNT);
    expect(loadAuditModules(path.join(root, ONDEMAND_AUDIT_MODULE_DIR)).length).toBe(REVIEWER_ONDEMAND_AUDIT_MODULE_COUNT);
    for (const m of modules) {
      const content = fs.readFileSync(path.join(root, AUDIT_MODULE_DIR, m.file), 'utf-8');
      expect(content.includes('\nvcodes:'), `${m.file} has no vcodes: frontmatter key`).toBe(true);
    }
  });

  test('passes against the live reviewer audit-module registry', () => {
    const results = runChecks();
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('V-AUDIT-01');
    expect(results[0].ok, results[0].detail).toBe(true);
  });
});

// Captured from `src/references/audits/` at plan_base_commit 732995fc, before the split: the module
// file names and the V-codes their `vcodes:` frontmatter claimed. A hand-copied snapshot on purpose —
// deriving it from the live tree would make the equality test unfalsifiable (V-UNFALSIFIABLE-01).
const PRE_SPLIT_MODULE_FILES = [
  '01-five-field-contract-plan-compliance.md',
  '02-tdd-testing-baselines.md',
  '03-code-quality-conventions.md',
  '04-security-checks.md',
  '05-integration-coherence.md',
  '06-improvement-discoveries-pareto.md',
  '07-pr-git-hygiene.md',
  '08-docs-only-execution-mode.md',
  '09-public-api-docs-currency.md',
  '10-companion-file-audit.md',
  '11-confidence-filtering-consolidation.md',
  '12-suggestion-proportionality-gate.md',
  '13-recheck-mode-compliance.md',
  '14-information-hierarchy-audit.md',
  '15-decision-record-audit.md',
  '16-threat-model-audit.md',
  '17-performance-budget-audit.md',
  '18-documentation-prose-factual-accuracy.md',
  '19-owner-ruling-violation-audit.md',
  '20-spec-change-gate.md',
  '21-ui-interpretation-gate-audit.md',
  '22-visual-evidence-audit.md',
  '23-test-integrity-audit.md',
  '24-independent-security-verification.md',
  '25-staged-artifact-carry-audit.md',
  '26-comment-discipline-audit.md',
  '27-doc-governance-judgment-audit.md',
  '28-actionman-workclaude-discipline-audit.md',
  '29-plugin-cache-version-bump-audit.md',
  '30-v-test09-hooks-claim-audit.md',
  '31-unfalsifiable-control-checklist.md',
  '32-executed-vs-reasoned-disclosure.md',
  '33-runtime-proof-audit.md',
];

const PRE_SPLIT_CLAIMED_VCODES = [
  'V-ADA-01',
  'V-ADA-02',
  'V-ADA-03',
  'V-ADA-04',
  'V-ADA-05',
  'V-ADA-06',
  'V-ADA-07',
  'V-API-01',
  'V-AUTO-02',
  'V-AUTO-03',
  'V-BRANCH-02',
  'V-CONFIG-01',
  'V-DOC-01',
  'V-DOC-03',
  'V-DOC-05',
  'V-DOC-06',
  'V-DOC-07',
  'V-DOC-GOV-01',
  'V-DOC-GOV-02',
  'V-DOC-GOV-03',
  'V-DOC-GOV-04',
  'V-DOCFACT-01',
  'V-DOCSYNC-01',
  'V-DRY-01',
  'V-DRY-02',
  'V-DRY-03',
  'V-DRY-04',
  'V-FIX-01',
  'V-GIT-01',
  'V-GITFIX-01',
  'V-INT-01',
  'V-INT-02',
  'V-INT-03',
  'V-INT-04',
  'V-INT-05',
  'V-KISS-01',
  'V-KISS-02',
  'V-KISS-03',
  'V-PARETO-01',
  'V-PARETO-02',
  'V-PAT-01',
  'V-PAT-02',
  'V-PAT-03',
  'V-PAT-04',
  'V-PAT-05',
  'V-PERF-01',
  'V-PERF-02',
  'V-PLUGIN-01',
  'V-PROOF-01',
  'V-RULE-01',
  'V-SCOPE-01',
  'V-SCOPE-02',
  'V-SCOPE-03',
  'V-SEC-01',
  'V-SEC-02',
  'V-SEC-03',
  'V-SEC-04',
  'V-SEC-11',
  'V-SEC-13',
  'V-SEC-14',
  'V-SOLID-01',
  'V-SOLID-02',
  'V-SOLID-03',
  'V-SOLID-04',
  'V-SOLID-05',
  'V-TEST-01',
  'V-TEST-02',
  'V-TEST-05',
  'V-TEST-09',
  'V-TEST-10',
  'V-TEST-11',
  'V-THREAT-01',
  'V-THREAT-02',
  'V-THREAT-03',
  'V-UI-01',
  'V-UNFALSIFIABLE-01',
  'V-UX-01',
  'V-UX-04',
  'V-UX-05',
  'V-UX-07',
  'V-UX-08',
  'V-UX-09',
  'V-UX-10',
  'V-VIS-01',
  'V-VIS-02',
  'V-YAGNI-01',
  'V-YAGNI-02',
  'V-YAGNI-03',
];

// Issue #1387 — on-demand audit modules. A module whose own first clause is a mechanical gate
// moves out of the inlined `audits/` directory into `audit-modules/`; `reviewer.md` keeps a
// hand-written stub per module. Leg D is what makes those stubs safe: without it a stub could
// lose its Read path or a V-code and the reviewer would silently stop running that audit.
const onDemand = (file: string, section: string, vcodes: string[]) => ({ file, section, vcodes });
const STUB_SRC = [
  '## On-demand audit modules',
  '### Alpha Audit (`V-ALPHA-01`)',
  '*   **Load when**: the plan has an `## Alpha` heading.',
  '*   **Read**: `{{AGENT_DIR}}/skills/blackhole/references/audit-modules/01-alpha.md`',
  '### Beta Audit (`V-BETA-01/02`)',
  '*   **Load when**: the diff touches `beta/**`.',
  '*   **Read**: `{{AGENT_DIR}}/skills/blackhole/references/audit-modules/02-beta.md`',
  '',
].join('\n');
const STUB_MODULES = [
  onDemand('01-alpha.md', 'Alpha Audit', ['V-ALPHA-01']),
  onDemand('02-beta.md', 'Beta Audit', ['V-BETA-01', 'V-BETA-02']),
];

describe('findOnDemandStubDrift (leg D)', () => {
  test('green — every module has one stub that names its codes and its Read path', () => {
    expect(findOnDemandStubDrift(STUB_SRC, STUB_MODULES)).toEqual([]);
  });

  test('red — a module with no stub heading is reported by file name', () => {
    const errors = findOnDemandStubDrift(STUB_SRC, [...STUB_MODULES, onDemand('03-gamma.md', 'Gamma Audit', [])]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('03-gamma.md');
    expect(errors[0]).toContain('no stub');
  });

  test('red — a stub without the Read path of its module is reported', () => {
    const broken = STUB_SRC.replace('audit-modules/02-beta.md', 'audit-modules/elsewhere.md');
    const errors = findOnDemandStubDrift(broken, STUB_MODULES);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('02-beta.md');
    expect(errors[0]).toContain('Read');
  });

  test('red — a stub that omits one of its module V-codes names the omitted code', () => {
    const broken = STUB_SRC.replace('`V-BETA-01/02`', '`V-BETA-01`');
    const errors = findOnDemandStubDrift(broken, STUB_MODULES);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('V-BETA-02');
  });

  test('red — a stub with no Load-when trigger line is reported', () => {
    const broken = STUB_SRC.replace('*   **Load when**: the diff touches `beta/**`.\n', '');
    const errors = findOnDemandStubDrift(broken, STUB_MODULES);
    expect(errors.some((e) => e.includes('02-beta.md') && e.includes('Load when'))).toBe(true);
  });

  test('red — a duplicated stub heading is reported', () => {
    const errors = findOnDemandStubDrift(`${STUB_SRC}### Alpha Audit (\`V-ALPHA-01\`)\n`, STUB_MODULES);
    expect(errors.some((e) => e.includes('01-alpha.md') && e.includes('2 stubs'))).toBe(true);
  });

  test('red — a module without a section: key cannot be matched and is reported', () => {
    const errors = findOnDemandStubDrift(STUB_SRC, [{ file: '04-nosection.md', vcodes: [] }]);
    expect(errors.some((e) => e.includes('04-nosection.md') && e.includes('section:'))).toBe(true);
  });
});

describe('leg C for the on-demand directory', () => {
  test('red — a wrong on-demand count names the on-demand constant and directory', () => {
    const errors = findAuditModuleCountDrift(17, 16, 'REVIEWER_ONDEMAND_AUDIT_MODULE_COUNT', ONDEMAND_AUDIT_MODULE_DIR);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('REVIEWER_ONDEMAND_AUDIT_MODULE_COUNT');
    expect(errors[0]).toContain(ONDEMAND_AUDIT_MODULE_DIR);
  });
});

describe('live on-demand split (issue #1387)', () => {
  const inline = loadAuditModules(path.join(root, AUDIT_MODULE_DIR));
  const lazy = loadAuditModules(path.join(root, ONDEMAND_AUDIT_MODULE_DIR));
  const reviewerSrc = () => fs.readFileSync(path.join(root, 'src/agents/reviewer.md'), 'utf-8');

  test('no module file lives in both directories', () => {
    const inlineFiles = new Set(inline.map((m) => m.file));
    expect(lazy.filter((m) => inlineFiles.has(m.file)).map((m) => m.file)).toEqual([]);
  });

  test('both directories together hold exactly the pre-split 33 module files', () => {
    expect([...inline, ...lazy].map((m) => m.file).sort()).toEqual(PRE_SPLIT_MODULE_FILES);
  });

  test('both directories together still claim every reviewer-sited V-code exactly once', () => {
    const table = fs.readFileSync(path.join(root, 'src/references/blackhole-vcodes.md'), 'utf-8');
    expect(findAuditRegistryDrift([...inline, ...lazy], reviewerSitedCodes(table), documentedCodes(table))).toEqual([]);
  });

  test('the V-code set claimed after the split equals the set claimed before it', () => {
    expect([...inline, ...lazy].flatMap((m) => m.vcodes).sort()).toEqual(PRE_SPLIT_CLAIMED_VCODES);
  });

  test('every on-demand module has a drift-free stub in the live reviewer source', () => {
    expect(findOnDemandStubDrift(reviewerSrc(), lazy)).toEqual([]);
  });

  test('the fail-open sentence appears exactly once in the reviewer source', () => {
    expect(reviewerSrc().split('When unsure whether a trigger holds, Read the module.').length - 1).toBe(1);
  });

  test('every on-demand module has a predicate in the trigger table and vice versa (Leg E)', () => {
    expect(findTriggerTableDrift(lazy)).toEqual([]);
  });
});

describe('findTriggerTableDrift', () => {
  test('red: a module with no predicate and a predicate with no module are both reported', () => {
    const errors = findTriggerTableDrift([mod('a.md', []), mod('b.md', [])], { 'b.md': () => true, 'ghost.md': () => true });
    expect(errors).toEqual([
      'a.md: no predicate in AUDIT_MODULE_TRIGGERS',
      'ghost.md: AUDIT_MODULE_TRIGGERS names a module absent from src/references/audit-modules',
    ]);
  });

  test('green: matching sets report nothing', () => {
    expect(findTriggerTableDrift([mod('a.md', [])], { 'a.md': () => true })).toEqual([]);
  });
});
