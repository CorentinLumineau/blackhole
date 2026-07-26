import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { evaluateClaudeDistributionBundle } from './checks/claude-dist.check.ts';
import { populateClaudeFixtureTree, withTempDir } from './lib/test-fixtures.ts';

// ADR-009 (issue #262): Claude Code marketplace distribution bundle — the inverse invariant of
// evaluateDistributionBundle in gemini-build.check.ts (REQUIRES agents/, manifest lives at
// .claude-plugin/plugin.json).
describe('evaluateClaudeDistributionBundle', () => {
  test('passes (empty error list) on a correctly-built bundle with agents/ present', () => {
    withTempDir('blackhole-verify-test', (destRoot) => {
      populateClaudeFixtureTree(destRoot);
      expect(evaluateClaudeDistributionBundle(destRoot)).toEqual([]);
    });
  });

  test('fails when agents/ is absent — inverse of AC4, Claude bundles must ship agents', () => {
    withTempDir('blackhole-verify-test', (destRoot) => {
      populateClaudeFixtureTree(destRoot);
      fs.rmSync(path.join(destRoot, 'agents'), { recursive: true, force: true });
      const errors = evaluateClaudeDistributionBundle(destRoot);
      expect(errors.some((e) => e.includes('expected') && e.includes('agent'))).toBe(true);
    });
  });

  test('fails with a clear message when .claude-plugin/plugin.json is absent', () => {
    withTempDir('blackhole-verify-test', (destRoot) => {
      populateClaudeFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, '.claude-plugin', 'plugin.json'));
      const errors = evaluateClaudeDistributionBundle(destRoot);
      expect(errors.some((e) => e.includes('plugin.json'))).toBe(true);
    });
  });
});
