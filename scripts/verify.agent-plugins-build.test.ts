import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { evaluateAgentPluginsBundle } from './checks/agent-plugins-build.check.ts';
import { AGENT_PLUGINS_SCHEMA } from './lib/build/manifests.ts';
import { populateAgentPluginsTree, withTempDir } from './lib/test-fixtures.ts';

describe('evaluateAgentPluginsBundle', () => {
  test('passes (empty error list) on a correctly-built tree', () => {
    withTempDir('blackhole-verify-test', (destRoot) => {
      populateAgentPluginsTree(destRoot);
      expect(evaluateAgentPluginsBundle(destRoot)).toEqual([]);
    });
  });

  test('fails when plugin.json is absent', () => {
    withTempDir('blackhole-verify-test', (destRoot) => {
      populateAgentPluginsTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'plugin.json'));
      const errors = evaluateAgentPluginsBundle(destRoot);
      expect(errors.some((e) => e.includes('plugin.json'))).toBe(true);
    });
  });

  test('fails when $schema is wrong', () => {
    withTempDir('blackhole-verify-test', (destRoot) => {
      populateAgentPluginsTree(destRoot);
      const manifestPath = path.join(destRoot, 'plugin.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      manifest.$schema = 'https://wrong.example/schema';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      const errors = evaluateAgentPluginsBundle(destRoot);
      expect(errors.some((e) => e.includes(AGENT_PLUGINS_SCHEMA))).toBe(true);
    });
  });

  test('fails when skills/blackhole/SKILL.md is missing', () => {
    withTempDir('blackhole-verify-test', (destRoot) => {
      populateAgentPluginsTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'skills', 'blackhole', 'SKILL.md'));
      const errors = evaluateAgentPluginsBundle(destRoot);
      expect(errors.some((e) => e.includes('SKILL.md'))).toBe(true);
    });
  });

  test('fails when rules/ is present at bundle root', () => {
    withTempDir('blackhole-verify-test', (destRoot) => {
      populateAgentPluginsTree(destRoot);
      fs.mkdirSync(path.join(destRoot, 'rules'), { recursive: true });
      const errors = evaluateAgentPluginsBundle(destRoot);
      expect(errors.some((e) => e.includes('forbidden rules/'))).toBe(true);
    });
  });

  test('fails when agents/ is present at bundle root', () => {
    withTempDir('blackhole-verify-test', (destRoot) => {
      populateAgentPluginsTree(destRoot);
      fs.mkdirSync(path.join(destRoot, 'agents'), { recursive: true });
      const errors = evaluateAgentPluginsBundle(destRoot);
      expect(errors.some((e) => e.includes('forbidden agents/'))).toBe(true);
    });
  });

  test('fails when mcp.json is present at bundle root', () => {
    withTempDir('blackhole-verify-test', (destRoot) => {
      populateAgentPluginsTree(destRoot);
      fs.writeFileSync(path.join(destRoot, 'mcp.json'), '{}');
      const errors = evaluateAgentPluginsBundle(destRoot);
      expect(errors.some((e) => e.includes('mcp.json'))).toBe(true);
    });
  });
});
