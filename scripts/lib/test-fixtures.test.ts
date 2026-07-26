import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  populateClaudeFixtureTree,
  populateCodexFixtureTree,
  populateGeminiDistributionTree,
  withTempDir,
} from './test-fixtures.ts';

describe('withTempDir', () => {
  test('removes the directory after the callback returns', () => {
    let capturedDir = '';
    withTempDir('test-fixtures-with-temp', (dir) => {
      capturedDir = dir;
      expect(fs.existsSync(dir)).toBe(true);
    });
    expect(fs.existsSync(capturedDir)).toBe(false);
  });
});

describe('populateGeminiDistributionTree', () => {
  test('populates plugin.json at the distribution root', () => {
    withTempDir('test-fixtures-gemini', (destRoot) => {
      populateGeminiDistributionTree(destRoot);
      const manifestPath = path.join(destRoot, 'plugin.json');
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest).toHaveProperty('name');
      expect(manifest).toHaveProperty('version');
    });
  });
});

describe('populateCodexFixtureTree', () => {
  test('populates .codex-plugin/plugin.json', () => {
    withTempDir('test-fixtures-codex', (destRoot) => {
      populateCodexFixtureTree(destRoot);
      const manifestPath = path.join(destRoot, '.codex-plugin', 'plugin.json');
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest).toHaveProperty('name');
    });
  });
});

describe('populateClaudeFixtureTree', () => {
  test('populates .claude-plugin/plugin.json and agents/', () => {
    withTempDir('test-fixtures-claude', (destRoot) => {
      populateClaudeFixtureTree(destRoot);
      expect(fs.existsSync(path.join(destRoot, '.claude-plugin', 'plugin.json'))).toBe(true);
      expect(fs.existsSync(path.join(destRoot, 'agents'))).toBe(true);
    });
  });
});
