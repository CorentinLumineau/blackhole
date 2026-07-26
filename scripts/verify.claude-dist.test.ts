import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { buildClaudePluginManifest } from './lib/build/manifests.ts';
import { compileGeminiTree } from './lib/build/trees.ts';
import { evaluateClaudeDistributionBundle } from './checks/claude-dist.check.ts';
import { makeTempDir as sharedMakeTempDir } from './lib/fs.ts';

const makeTempDir = (): string => sharedMakeTempDir('blackhole-verify-test');

// ADR-009 (issue #262): Claude Code marketplace distribution bundle — the inverse invariant of
// evaluateDistributionBundle in gemini-build.check.ts (REQUIRES agents/, manifest lives at
// .claude-plugin/plugin.json).
describe('evaluateClaudeDistributionBundle', () => {
  const populateClaudeFixtureTree = (destRoot: string) => {
    compileGeminiTree(
      destRoot,
      'plugins/blackhole-claude',
      'plugins/blackhole-claude/rules/blackhole-vcodes.md',
      { includeAgents: true, target: 'claude' }
    );
    const pluginDir = path.join(destRoot, '.claude-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, 'plugin.json'),
      JSON.stringify(buildClaudePluginManifest('1.0.0'), null, 2),
      'utf-8'
    );
  };

  test('passes (empty error list) on a correctly-built bundle with agents/ present', () => {
    const destRoot = makeTempDir();
    try {
      populateClaudeFixtureTree(destRoot);
      expect(evaluateClaudeDistributionBundle(destRoot)).toEqual([]);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails when agents/ is absent — inverse of AC4, Claude bundles must ship agents', () => {
    const destRoot = makeTempDir();
    try {
      populateClaudeFixtureTree(destRoot);
      fs.rmSync(path.join(destRoot, 'agents'), { recursive: true, force: true });
      const errors = evaluateClaudeDistributionBundle(destRoot);
      expect(errors.some((e) => e.includes('expected') && e.includes('agent'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails with a clear message when .claude-plugin/plugin.json is absent', () => {
    const destRoot = makeTempDir();
    try {
      populateClaudeFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, '.claude-plugin', 'plugin.json'));
      const errors = evaluateClaudeDistributionBundle(destRoot);
      expect(errors.some((e) => e.includes('plugin.json'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});
