import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseFrontmatterFields } from './lib/build/content.ts';
import {
  findOnDemandStubDrift,
  IMPLEMENTER_GATE_STUB_SHAPE,
  loadAuditModules,
  ONDEMAND_GATE_MODULE_DIR,
} from './checks/audit-modules.check.ts';
import {
  AGENT_FRONTMATTER_POLICY,
  AGENT_TOOL_POLICY_DENY_MATRIX,
  checkAgentFrontmatter,
  runChecks,
  validateAgentEffortFrontmatter,
  validateAgentToolPolicyFrontmatter,
} from './checks/agents.check.ts';

describe('V-TOOLS-01 — agent tool policy deny-matrix', () => {
  const coordinatorExpected = AGENT_TOOL_POLICY_DENY_MATRIX['coordinator.md']!;

  test('pass: coordinator frontmatter with correct disallowedTools and no tools: key', () => {
    const fmBody = `name: coordinator
description: Campaign intake
disallowedTools: [Write, Edit, Delete]`;
    expect(validateAgentToolPolicyFrontmatter('coordinator.md', fmBody, coordinatorExpected)).toEqual([]);
  });

  test('fail: frontmatter containing tools: allowlist → error mentions allowlist', () => {
    const fmBody = `name: coordinator
tools: [Read, Grep]
disallowedTools: [Write, Edit, Delete]`;
    const errors = validateAgentToolPolicyFrontmatter('coordinator.md', fmBody, coordinatorExpected);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('allowlist'))).toBe(true);
  });

  test('fail: coordinator missing disallowedTools entirely → error mentions missing', () => {
    const fmBody = `name: coordinator
description: Campaign intake`;
    const errors = validateAgentToolPolicyFrontmatter('coordinator.md', fmBody, coordinatorExpected);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('missing disallowedTools'))).toBe(true);
  });

  test('fail: coordinator disallowedTools omitting Delete → error cites the missing tool', () => {
    const fmBody = `name: coordinator
disallowedTools: [Write, Edit]`;
    const errors = validateAgentToolPolicyFrontmatter('coordinator.md', fmBody, coordinatorExpected);
    expect(errors.some((e) => e.includes('Delete'))).toBe(true);
  });

  test('pass: implementer frontmatter with no disallowedTools key (expected === null)', () => {
    const fmBody = `name: implementer
description: Implementation worker`;
    expect(validateAgentToolPolicyFrontmatter('implementer.md', fmBody, null)).toEqual([]);
  });

  test('fail: implementer frontmatter with disallowedTools present → error cites implementer must not have deny-list', () => {
    const fmBody = `name: implementer
disallowedTools: [Write]`;
    const errors = validateAgentToolPolicyFrontmatter('implementer.md', fmBody, null);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('must NOT have disallowedTools'))).toBe(true);
  });
});

describe('V-AGENT-01 — effort / model frontmatter', () => {
  test('pass: router effort: low with no model', () => {
    const fm = parseFrontmatterFields(`name: router
effort: low`);
    expect(validateAgentEffortFrontmatter('router.md', fm, AGENT_FRONTMATTER_POLICY['router.md']!)).toEqual([]);
  });

  test('fail: router missing effort is reported', () => {
    const errors = validateAgentEffortFrontmatter('router.md', parseFrontmatterFields('name: router'), {
      effort: 'low',
    });
    expect(errors.some((e) => e.includes('effort: low'))).toBe(true);
  });

  test('fail: planner with the wrong effort is reported', () => {
    const errors = validateAgentEffortFrontmatter(
      'planner.md',
      parseFrontmatterFields('model: opus[1m]\neffort: high'),
      AGENT_FRONTMATTER_POLICY['planner.md']!,
    );
    expect(errors.some((e) => e.includes('expected effort: medium'))).toBe(true);
  });

  test('every roster agent declares an effort (issue 1378)', () => {
    for (const [file, policy] of Object.entries(AGENT_FRONTMATTER_POLICY)) {
      expect([file, policy.effort]).toEqual([file, expect.stringMatching(/^(low|medium|high)$/)]);
    }
  });

  test('fail: V-AGENT-01 fails an agents dir holding an agent with no policy row and no effort', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-fixture-'));
    try {
      fs.writeFileSync(path.join(dir, 'newagent.md'), '---\nname: newagent\ndescription: fixture\n---\nbody\n');
      const result = checkAgentFrontmatter(dir);
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('newagent.md: no row in agents.check.ts AGENT_FRONTMATTER_POLICY');
      expect(result.detail).toContain('newagent.md: missing effort');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('pass: orchestrator pins both effort: low and model: opus[1m]', () => {
    const fm = parseFrontmatterFields(`effort: low
model: opus[1m]`);
    expect(validateAgentEffortFrontmatter('orchestrator.md', fm, AGENT_FRONTMATTER_POLICY['orchestrator.md']!)).toEqual(
      [],
    );
  });

  test('fail: heavy worker without model: opus[1m] is reported', () => {
    const errors = validateAgentEffortFrontmatter(
      'implementer.md',
      parseFrontmatterFields('name: implementer'),
      AGENT_FRONTMATTER_POLICY['implementer.md']!,
    );
    expect(errors.some((e) => e.includes('model: opus[1m]'))).toBe(true);
  });

  test('fail: router with a stray model is reported', () => {
    const errors = validateAgentEffortFrontmatter(
      'router.md',
      parseFrontmatterFields('effort: low\nmodel: opus[1m]'),
      AGENT_FRONTMATTER_POLICY['router.md']!,
    );
    expect(errors.some((e) => e.includes('unexpected model'))).toBe(true);
  });

  test('fail: autoCompactWindow is reported on any agent', () => {
    const errors = validateAgentEffortFrontmatter(
      'planner.md',
      parseFrontmatterFields('model: opus[1m]\nautoCompactWindow: 100000'),
      AGENT_FRONTMATTER_POLICY['planner.md']!,
    );
    expect(errors.some((e) => e.includes('autoCompactWindow'))).toBe(true);
  });

  test('heavy workers all run on the 1M window, light agents set no model', () => {
    for (const f of ['planner.md', 'implementer.md', 'investigator.md', 'hunter.md', 'orchestrator.md', 'reviewer.md']) {
      expect(AGENT_FRONTMATTER_POLICY[f]!.model).toBe('opus[1m]');
    }
    for (const f of ['router.md', 'coordinator.md']) {
      expect(AGENT_FRONTMATTER_POLICY[f]!.model).toBeUndefined();
    }
  });

  test('every roster agent has a frontmatter policy row', () => {
    expect(Object.keys(AGENT_FRONTMATTER_POLICY).sort()).toEqual(Object.keys(AGENT_TOOL_POLICY_DENY_MATRIX).sort());
  });
});

describe('agents.check runChecks()', () => {
  test('returns exactly four CheckResult entries in expected order', () => {
    const results = runChecks();
    expect(results).toHaveLength(4);
    expect(results.map((r) => r.id)).toEqual(['V-TOOLS-01', 'V-AGENT-01', 'V-DELEG-01', 'V-GATE-01']);
  });

  test('V-TOOLS-01 and V-AGENT-01 pass against current src/agents/ tree', () => {
    const results = runChecks();
    for (const id of ['V-TOOLS-01', 'V-AGENT-01'] as const) {
      const result = results.find((r) => r.id === id);
      expect(result).toBeDefined();
      expect(result!.detail ?? '').toBe('');
      expect(result!.ok).toBe(true);
    }
  });
});

// The implementer's conditional gates ship as `references/gate-modules/*.md`; `implementer.md`
// keeps one `##` stub each. Without these checks a stub could lose its Load-when line or its Read
// path and the worker would silently stop running that gate.
describe('implementer on-demand gate stubs (V-GATE-01)', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const modules = loadAuditModules(path.join(root, ONDEMAND_GATE_MODULE_DIR));
  const shell = fs.readFileSync(path.join(root, 'src/agents/implementer.md'), 'utf-8');

  test('the live shell has a complete stub for each of the six gate modules', () => {
    expect(modules.map((m) => m.file)).toEqual([
      '04-bugfix-gate.md',
      '05-conflict-resolution-gate.md',
      '11-promote-review-artifact.md',
      '12-companion-file-sync.md',
      '14-visual-evidence-capture.md',
      '16-shadcn-skill.md',
    ]);
    expect(findOnDemandStubDrift(shell, modules, IMPLEMENTER_GATE_STUB_SHAPE)).toEqual([]);
  });

  test('no module body is inlined into the shell', () => {
    for (const m of modules) {
      const body = fs.readFileSync(path.join(root, ONDEMAND_GATE_MODULE_DIR, m.file), 'utf-8');
      const firstProse = body.split('\n').find((l) => l.length > 60 && !l.startsWith('#') && !l.startsWith('section:'))!;
      expect(shell).not.toContain(firstProse);
    }
  });

  test('a stub that loses its Read path is reported by module file name', () => {
    const broken = shell.replace('gate-modules/04-bugfix-gate.md', 'gate-modules/elsewhere.md');
    const errors = findOnDemandStubDrift(broken, modules, IMPLEMENTER_GATE_STUB_SHAPE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('04-bugfix-gate.md');
    expect(errors[0]).toContain('Read');
  });

  test('a stub that loses its Load-when line is reported', () => {
    const broken = shell.replace(/\*   \*\*Load when\*\*: the plan frontmatter in[^\n]*\n/, '');
    const errors = findOnDemandStubDrift(broken, modules, IMPLEMENTER_GATE_STUB_SHAPE);
    expect(errors).toEqual(['04-bugfix-gate.md: stub has no `Load when` trigger line']);
  });

  test('a module with no stub heading is reported with the implementer shell name', () => {
    const broken = shell.replace('## Bundled shadcn skill (conditional)', '## Something else');
    const errors = findOnDemandStubDrift(broken, modules, IMPLEMENTER_GATE_STUB_SHAPE);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('16-shadcn-skill.md');
    expect(errors[0]).toContain('implementer.md');
  });
});
