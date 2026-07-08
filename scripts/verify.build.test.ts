import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildCodexPluginManifest, buildGeminiPluginManifest, compileGeminiTree, writeGeminiManifest } from './build.ts';
import { detectBuildOutputDrift, evaluateBuildCheck, evaluateDistributionBundle } from './verify.ts';

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-verify-test-'));

describe('detectBuildOutputDrift', () => {
  test('returns [] for porcelain input with no build-output-pattern matches', () => {
    const porcelain = ' M src/agents/coordinator.md\n';
    expect(detectBuildOutputDrift(porcelain)).toEqual([]);
  });

  test('flags dirty .codex-plugin/plugin.json and .gemini-plugin/plugin.json lines', () => {
    const porcelain = ' M .codex-plugin/plugin.json\n M .gemini-plugin/plugin.json\n';
    expect(detectBuildOutputDrift(porcelain)).toEqual([
      ' M .codex-plugin/plugin.json',
      ' M .gemini-plugin/plugin.json',
    ]);
  });

  test('regression: #57 stale plugin manifest version scenario is detected', () => {
    const before = JSON.stringify(buildCodexPluginManifest('0.4.1'));
    const after = JSON.stringify(buildCodexPluginManifest('0.4.2'));
    expect(before).not.toEqual(after);

    const porcelain = ' M .codex-plugin/plugin.json\n M .gemini-plugin/plugin.json\n';
    const dirty = detectBuildOutputDrift(porcelain);
    expect(dirty).toContain(' M .codex-plugin/plugin.json');
    expect(dirty).toContain(' M .gemini-plugin/plugin.json');
  });

  test('flags dirty plugins/blackhole/plugin.json the same way as .gemini-plugin/ (parity)', () => {
    const porcelain = ' M plugins/blackhole/plugin.json\n M .gemini-plugin/plugin.json\n';
    expect(detectBuildOutputDrift(porcelain)).toEqual([
      ' M plugins/blackhole/plugin.json',
      ' M .gemini-plugin/plugin.json',
    ]);
  });

  test('regression: #138 stale .agents/build/ gemini workspace mirror is detected', () => {
    const porcelain = ' M .agents/build/agents/coordinator.md\n';
    expect(detectBuildOutputDrift(porcelain)).toEqual([' M .agents/build/agents/coordinator.md']);
  });
});

describe('evaluateBuildCheck', () => {
  test('skip always short-circuits to ok: true', () => {
    const result = evaluateBuildCheck({
      skip: true,
      buildOk: false,
      buildOutput: 'boom',
      afterPorcelain: ' M .codex-plugin/plugin.json\n',
    });
    expect(result).toEqual({ id: 'V-BUILD-01', ok: true });
  });

  test('build failure fails with detail containing build output', () => {
    const result = evaluateBuildCheck({
      skip: false,
      buildOk: false,
      buildOutput: 'boom',
      afterPorcelain: '',
    });
    expect(result.id).toBe('V-BUILD-01');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('boom');
  });

  test('dirty build-output path fails with detail listing paths and a fix hint', () => {
    const result = evaluateBuildCheck({
      skip: false,
      buildOk: true,
      buildOutput: '',
      afterPorcelain: ' M .codex-plugin/plugin.json\n',
    });
    expect(result.id).toBe('V-BUILD-01');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('.codex-plugin/plugin.json');
    expect(result.detail).toContain('bun run build');
  });

  test('clean tree (no build-output-pattern porcelain lines) passes', () => {
    const result = evaluateBuildCheck({
      skip: false,
      buildOk: true,
      buildOutput: '',
      afterPorcelain: '',
    });
    expect(result).toEqual({ id: 'V-BUILD-01', ok: true });
  });

  test('unrelated dirty files do not false-positive', () => {
    const result = evaluateBuildCheck({
      skip: false,
      buildOk: true,
      buildOutput: '',
      afterPorcelain: ' M README.md\n',
    });
    expect(result).toEqual({ id: 'V-BUILD-01', ok: true });
  });
});

describe('evaluateDistributionBundle', () => {
  const populateFixtureTree = (destRoot: string) => {
    compileGeminiTree(
      destRoot,
      'plugins/blackhole',
      'plugins/blackhole/rules/blackhole-vcodes.md',
      { includeAgents: false }
    );
    writeGeminiManifest(path.join(destRoot, 'plugin.json'), buildGeminiPluginManifest('1.0.0'));
  };

  test('passes (empty error list) on a correctly-built tree', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      expect(evaluateDistributionBundle(destRoot)).toEqual([]);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails with a clear message when plugin.json is absent', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'plugin.json'));
      const errors = evaluateDistributionBundle(destRoot);
      expect(errors.some((e) => e.includes('plugin.json'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails with a clear message when rules/ is incomplete', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'rules', 'blackhole-state.md'));
      const errors = evaluateDistributionBundle(destRoot);
      expect(errors.some((e) => e.includes('blackhole-state.md'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails with a clear message when skills/blackhole/SKILL.md is missing', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'skills', 'blackhole', 'SKILL.md'));
      const errors = evaluateDistributionBundle(destRoot);
      expect(errors.some((e) => e.includes('SKILL.md'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});
