import { describe, expect, test } from 'bun:test';
import { buildCodexPluginManifest } from './build.ts';
import { detectBuildOutputDrift, evaluateBuildCheck } from './verify.ts';

describe('detectBuildOutputDrift', () => {
  test('returns [] for porcelain input with no build-output-pattern matches', () => {
    const porcelain = ' M src/agents/bc-coordinator.md\n';
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
