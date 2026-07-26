import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildGeminiPluginManifest,
  compileGeminiTree,
  writeGeminiManifest,
} from './build.ts';
import {
  evaluateDistributionBundle,
} from './checks/gemini-build.check.ts';
import { leakedPlatformConditionalMarkers } from './checks/build.check.ts';
import { makeTempDir as sharedMakeTempDir } from './lib/fs.ts';

const makeTempDir = (): string => sharedMakeTempDir('blackhole-verify-test');

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

// Regression for issue #327: checkGeminiBuild/checkCodexAgentFiles previously only tested for a
// leaked {{#cursor}} or {{#claude}} marker (2 of 5 platforms) — a leaked {{#skills}} or
// {{#gemini}} block in Codex output, or a leaked {{#skills}} block in Gemini output, went
// silently undetected. leakedPlatformConditionalMarkers is PLATFORM_TARGETS-driven and closes
// that gap; it's exported for direct unit coverage for the same reason isAgentCountError in
// codex-build.check.ts is — its callers close over the repo-root filesystem and can't be
// exercised in isolation.
describe('leakedPlatformConditionalMarkers (V-GEMINI-01/V-CODEX-04 gap — #327)', () => {
  test('detects a leaked {{#skills}} marker in Gemini output — previously undetected', () => {
    const leaked = leakedPlatformConditionalMarkers('before {{#skills}}leftover{{/skills}} after', 'gemini');
    expect(leaked).toContain('skills');
  });

  test('detects a leaked {{#gemini}} marker in Codex output — previously undetected', () => {
    const leaked = leakedPlatformConditionalMarkers('before {{#gemini}}leftover{{/gemini}} after', 'codex');
    expect(leaked).toContain('gemini');
  });

  test('still detects the previously-checked cursor/claude leaks (no regression)', () => {
    expect(leakedPlatformConditionalMarkers('{{#cursor}}x{{/cursor}}', 'gemini')).toContain('cursor');
    expect(leakedPlatformConditionalMarkers('{{#claude}}x{{/claude}}', 'gemini')).toContain('claude');
  });

  test('does not flag the active target\'s own marker', () => {
    expect(leakedPlatformConditionalMarkers('{{#gemini}}content{{/gemini}}', 'gemini')).toEqual([]);
  });

  test('returns [] for content with no unresolved markers', () => {
    expect(leakedPlatformConditionalMarkers('plain content, no markers', 'gemini')).toEqual([]);
  });
});
