// Thin CLI entry + re-export barrel for scripts/lib/build/* (issue #363).
export {
  AGENTS_BUILD_ROOT,
  AGENTS_BUILD_AGENT_DIR,
  AGENTS_BUILD_VCODES,
  DISTRIBUTION_ROOT,
  DISTRIBUTION_AGENT_DIR,
  DISTRIBUTION_VCODES,
  CLAUDE_DISTRIBUTION_ROOT,
  CLAUDE_DISTRIBUTION_AGENT_DIR,
  CLAUDE_DISTRIBUTION_VCODES,
  GEMINI_TARGET_DIRS,
  CODEX_TARGET_DIRS,
  DEPRECATED_BUILD_FLAGS,
} from './lib/build/paths.ts';

export {
  RULES_LIST,
  AGENT_NAMES,
  AGENT_MD_FILES,
  AGENT_YAML_FILES,
  PHASE_NAMES,
  PHASE_PLAYBOOK_FILES,
  REQUIRED_REFERENCES,
  VCODE_TABLE_ROW_COUNT,
  QUEUE_STATUSES,
  QUEUE_NOTES,
  HUNT_KINDS,
  PLATFORM_TARGETS,
  CONTENT_GATE_BUDGETS,
  EXPECTED_CHECK_COUNT,
  type ContentGateBudget,
  type Target,
} from './lib/build/facts.ts';

export {
  parseMdFrontmatter,
  parseFrontmatterFields,
  parseDisallowedTools,
  serializeCodexAgentYaml,
  buildCodexAgentYaml,
  applyPlatformConditionals,
  compileContent,
  generatedMarkerLine,
  processFile,
  compileFolder,
} from './lib/build/content.ts';

export {
  buildGeminiPluginManifest,
  buildCodexPluginManifest,
  buildCodexMarketplace,
  buildClaudePluginManifest,
  buildClaudeMarketplace,
} from './lib/build/manifests.ts';

export {
  copyTemplatesDir,
  compileGeminiTree,
  writeGeminiManifest,
  compileCodexTree,
} from './lib/build/trees.ts';

export {
  isTargetTracked,
  cleanDir,
  determineBuildTargets,
  cleanBuildDirectories,
} from './lib/build/clean.ts';

export {
  compileSkillsTarget,
  compileCursorTarget,
  compileClaudeNativeTarget,
  compileClaudeMarketplaceTarget,
  compileGeminiTargets,
  generateClaudePluginManifests,
  compileCodexTarget,
} from './lib/build/targets.ts';

import { determineBuildTargets, cleanBuildDirectories } from './lib/build/clean.ts';
import {
  compileSkillsTarget,
  compileCursorTarget,
  compileClaudeNativeTarget,
  compileClaudeMarketplaceTarget,
  compileGeminiTargets,
  generateClaudePluginManifests,
  compileCodexTarget,
} from './lib/build/targets.ts';

const main = () => {
  const { buildGemini, buildCodex } = determineBuildTargets();
  cleanBuildDirectories(buildGemini, buildCodex);
  compileSkillsTarget();
  compileCursorTarget();
  compileClaudeNativeTarget();
  const claudeDistRoot = compileClaudeMarketplaceTarget();
  compileGeminiTargets(buildGemini);
  generateClaudePluginManifests(claudeDistRoot);
  compileCodexTarget(buildCodex);

  console.log('Build compilation completed successfully!');
};

if (import.meta.main) {
  main();
}
