import { describe, expect, test } from 'bun:test';
import { parseFrontmatterFields } from './lib/build/content.ts';
import {
  AGENT_FRONTMATTER_POLICY,
  AGENT_TOOL_POLICY_DENY_MATRIX,
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

  test('fail: planner with stray effort is reported', () => {
    const errors = validateAgentEffortFrontmatter(
      'planner.md',
      parseFrontmatterFields('model: opus[1m]\neffort: high'),
      AGENT_FRONTMATTER_POLICY['planner.md']!,
    );
    expect(errors.some((e) => e.includes('unexpected effort'))).toBe(true);
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
