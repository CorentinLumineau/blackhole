import { describe, expect, test } from 'bun:test';
import {
  AGENT_TOOL_POLICY_DENY_MATRIX,
  runChecks,
  validateAgentToolPolicyFrontmatter,
} from './checks/agents.check.ts';
import { findMissingGateMarkers } from './lib/check-common.ts';

describe('findMissingGateMarkers', () => {
  test('returns the subset of required markers absent from content', () => {
    const content = '5-step gate\n**IDENTIFY** — what needs verification?\n**RUN** — execute now.';
    const required = ['5-step gate', '**IDENTIFY**', '**RUN**', '**READ**', '**VERIFY**', '**CLAIM**'];
    expect(findMissingGateMarkers(content, required)).toEqual(['**READ**', '**VERIFY**', '**CLAIM**']);
  });

  test('returns [] when all required markers are present', () => {
    const content = '5-step gate\n**IDENTIFY**\n**RUN**\n**READ**\n**VERIFY**\n**CLAIM**';
    const required = ['5-step gate', '**IDENTIFY**', '**RUN**', '**READ**', '**VERIFY**', '**CLAIM**'];
    expect(findMissingGateMarkers(content, required)).toEqual([]);
  });
});

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

describe('agents.check runChecks()', () => {
  test('returns exactly four CheckResult entries in expected order', () => {
    const results = runChecks();
    expect(results).toHaveLength(4);
    expect(results.map((r) => r.id)).toEqual(['V-TOOLS-01', 'V-AGENT-01', 'V-DELEG-01', 'V-GATE-01']);
  });

  test('V-TOOLS-01 passes against current src/agents/ tree', () => {
    const toolsResult = runChecks().find((r) => r.id === 'V-TOOLS-01');
    expect(toolsResult).toBeDefined();
    expect(toolsResult!.ok).toBe(true);
    expect(toolsResult!.detail).toBeUndefined();
  });
});
