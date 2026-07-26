import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, test } from 'bun:test';
import {
  buildCodexPluginManifest,
} from './build.ts';
import {
  detectBuildOutputDrift,
  evaluateBuildCheck,
} from './checks/build.check.ts';

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

describe("check-common.ts's runFullBuildOnce (ADR-007 T2/R5′)", () => {
  test('invokes plain `bun run build`, never a --all/--gemini/--no-codex flag', () => {
    const checkCommonSrc = fs.readFileSync(
      path.join(import.meta.dirname, 'lib/check-common.ts'),
      'utf-8',
    );
    expect(checkCommonSrc).toContain("spawnSync('bun', ['run', 'build'],");
    expect(checkCommonSrc).not.toMatch(/bun run build --(gemini|all|no-codex)/);
    expect(checkCommonSrc).not.toContain("['run', 'build', '--gemini']");
  });
});
