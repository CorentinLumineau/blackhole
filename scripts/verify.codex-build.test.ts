import { describe, expect, test } from 'bun:test';
import * as os from 'os';
import * as path from 'path';
import { AGENT_YAML_FILES } from './build.ts';
import { isAgentCountError } from './checks/codex-build.check.ts';
import { codexTreeErrors } from './tree-shape.ts';

describe('isAgentCountError (V-CODEX-04 filter — #234)', () => {
  test('matches the real agent-count mismatch message codexTreeErrors emits', () => {
    // Simulate codexTreeErrors output with a mismatch: pass zero agent files against the real
    // expected count derived from AGENT_YAML_FILES (SSOT, no hardcoded literal — V-DRY-03).
    // A nonexistent root means the SKILL.md/references checks also fire, giving us unrelated
    // messages in the same array to prove the filter discriminates correctly.
    const bogusRoot = path.join(os.tmpdir(), 'blackhole-verify-vcodex04-nonexistent-root');
    const errors = codexTreeErrors(bogusRoot, [], AGENT_YAML_FILES.size);

    const countError = errors.find((e) => e.includes('agent YAML files'));
    expect(countError).toBeDefined();
    expect(countError).toBe(`Codex: expected ${AGENT_YAML_FILES.size} agent YAML files, got 0`);
    expect(isAgentCountError(countError!)).toBe(true);
  });

  test('does not match unrelated codexTreeErrors messages (SKILL.md / references / per-file)', () => {
    expect(isAgentCountError('Codex: missing codex-skills/blackhole/SKILL.md')).toBe(false);
    expect(isAgentCountError('Codex: missing or empty codex-skills/blackhole/references/')).toBe(false);
    expect(isAgentCountError('Codex: some-agent.yaml missing instructions block scalar')).toBe(false);
  });
});
