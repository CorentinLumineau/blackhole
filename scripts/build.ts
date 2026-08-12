// CLI entry for `bun run build` — orchestration only (issue #378). Import build symbols from
// `scripts/lib/build/*` directly; this file does not re-export.
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

const main = () => {
  const { buildGemini, buildCodex, buildAgentPlugins } = determineBuildTargets();
  cleanBuildDirectories(buildGemini, buildCodex, buildAgentPlugins);
  compileSkillsTarget();
  compileCursorTarget();
  compileClaudeNativeTarget();
  const claudeDistRoot = compileClaudeMarketplaceTarget();
  compileGeminiTargets(buildGemini);
  generateClaudePluginManifests(claudeDistRoot);
  compileCodexTarget(buildCodex);
  compileAgentPluginsTarget(buildAgentPlugins);

  console.log('Build compilation completed successfully!');
};

if (import.meta.main) {
  main();
}
