import * as fs from 'fs';
import * as path from 'path';
import {
  buildClaudePluginManifest,
  buildCodexMarketplace,
  buildCodexPluginManifest,
  buildGeminiPluginManifest,
} from './build/manifests.ts';
import { compileCodexTree, compileGeminiTree, writeGeminiManifest } from './build/trees.ts';
import { makeTempDir } from './fs.ts';

// ADR-007 R6 — shared bun:test fixture kit for distribution-tree population and temp-dir lifecycle.
// Delegates to lib/build compile/manifest functions; never reimplements makeTempDir (V-INT-02).

export const withTempDir = <T>(prefix: string, fn: (dir: string) => T): T => {
  const dir = makeTempDir(prefix);
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

export type GeminiDistributionTreeOptions = {
  includeAgents?: boolean;
  target?: 'gemini' | 'claude';
  pluginSubdir?: string;
  vcodesSubpath?: string;
};

export const populateGeminiDistributionTree = (
  destRoot: string,
  opts: GeminiDistributionTreeOptions = {},
): void => {
  const {
    includeAgents = false,
    target = 'gemini',
    pluginSubdir = 'plugins/blackhole',
    vcodesSubpath = 'plugins/blackhole/rules/blackhole-vcodes.md',
  } = opts;
  compileGeminiTree(destRoot, pluginSubdir, vcodesSubpath, { includeAgents, target });
  writeGeminiManifest(path.join(destRoot, 'plugin.json'), buildGeminiPluginManifest('1.0.0'));
};

export const populateCodexFixtureTree = (destRoot: string): void => {
  compileCodexTree(
    destRoot,
    'codex-skills',
    'codex-skills/blackhole/references/blackhole-vcodes.md',
  );
  const pluginDir = path.join(destRoot, '.codex-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify(buildCodexPluginManifest('1.0.0'), null, 2),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(destRoot, 'codex-marketplace.json'),
    JSON.stringify(buildCodexMarketplace(), null, 2),
    'utf-8',
  );
};

export const populateClaudeFixtureTree = (destRoot: string): void => {
  compileGeminiTree(
    destRoot,
    'plugins/blackhole-claude',
    'plugins/blackhole-claude/rules/blackhole-vcodes.md',
    { includeAgents: true, target: 'claude' },
  );
  const pluginDir = path.join(destRoot, '.claude-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify(buildClaudePluginManifest('1.0.0'), null, 2),
    'utf-8',
  );
};
