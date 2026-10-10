// CLI entry for `bun run build` — orchestration only (issue #378). Import build symbols from
// `scripts/lib/build/*` directly; this file does not re-export.
import * as path from 'path';
import { determineBuildTargets, cleanBuildDirectories } from './lib/build/clean.ts';
import {
  compileSkillsTarget,
  compileCursorTarget,
  compileClaudeNativeTarget,
  compileClaudeMarketplaceTarget,
  compileGeminiTargets,
  generateClaudePluginManifests,
  compileCodexTarget,
  compileAgentPluginsTarget,
} from './lib/build/targets.ts';
import { copyShadcnSkill } from './lib/build/trees.ts';
import { root } from './lib/build/paths.ts';

const main = () => {
  const targets = determineBuildTargets();
  cleanBuildDirectories(targets);
  compileSkillsTarget();
  compileCursorTarget();
  copyShadcnSkill(root);
  copyShadcnSkill(path.join(root, '.cursor'));
  compileClaudeNativeTarget();
  copyShadcnSkill(path.join(root, '.claude'));
  const claudeDistRoot = compileClaudeMarketplaceTarget();
  compileGeminiTargets(targets.gemini);
  generateClaudePluginManifests(claudeDistRoot);
  compileCodexTarget(targets.codex);
  compileAgentPluginsTarget(targets.agentPlugins);

  console.log('Build compilation completed successfully!');
};

if (import.meta.main) {
  main();
}
