import * as fs from 'fs';
import * as path from 'path';
import { projectIdentity } from '../../project-identity.ts';
import {
  geminiWorkspaceTreeErrors,
  distributionTreeErrors,
  claudeDistributionTreeErrors,
  codexTreeErrors,
} from '../../tree-shape.ts';
import {
  AGENT_NAMES,
  AGENT_MD_FILES,
  AGENT_YAML_FILES,
  RULES_LIST,
} from './facts.ts';
import {
  root,
  srcDir,
  AGENTS_BUILD_ROOT,
  AGENTS_BUILD_AGENT_DIR,
  AGENTS_BUILD_VCODES,
  DISTRIBUTION_ROOT,
  DISTRIBUTION_AGENT_DIR,
  DISTRIBUTION_VCODES,
  CLAUDE_DISTRIBUTION_ROOT,
  CLAUDE_DISTRIBUTION_AGENT_DIR,
  CLAUDE_DISTRIBUTION_VCODES,
  CLAUDE_NATIVE_ROOT,
} from './paths.ts';
import { processFile, compileFolder } from './content.ts';
import {
  buildGeminiPluginManifest,
  buildCodexPluginManifest,
  buildCodexMarketplace,
  buildClaudePluginManifest,
  buildClaudeMarketplace,
} from './manifests.ts';
import { compileGeminiTree, compileCodexTree, copyHooksDir, writeGeminiManifest } from './trees.ts';
import { mergeClaudeSettingsHooks } from './claude-native-settings.ts';

const version = projectIdentity.version;

// 2. Compile Target A: Agent-Agnostic / skills.sh (Root level flat layout)
export const compileSkillsTarget = () => {
  console.log('Compiling Target A (skills.sh root-level)...');
  processFile(
    path.join(srcDir, 'SKILL.md'),
    path.join(root, 'SKILL.md'),
    '',
    'references/blackhole-vcodes.md',
    'skills'
  );
  compileFolder(
    'references',
    path.join(root, 'references'),
    '',
    'references/blackhole-vcodes.md',
    'skills'
  );
  compileFolder('agents', path.join(root, 'agents'), '', 'rules/blackhole-vcodes.mdc', 'skills', true);
};

// 3. Compile Target B: Cursor (submodule root layout + .cursor/ mirror)
export const compileCursorTarget = () => {
  console.log('Compiling Target B (Cursor)...');
  const cursorAgentDir = '.cursor';
  const cursorVcodesPath = '.cursor/rules/blackhole-vcodes.mdc';

  const writeCursorRules = (destDir: string) => {
    for (const rule of RULES_LIST) {
      const isVcodesMdc = rule === 'blackhole-vcodes.md';
      const destName = rule.substring(0, rule.length - 3) + '.mdc';
      processFile(
        path.join(srcDir, 'references', rule),
        path.join(destDir, destName),
        cursorAgentDir,
        cursorVcodesPath,
        'cursor',
        isVcodesMdc
      );
    }
  };

  writeCursorRules(path.join(root, 'rules'));
  writeCursorRules(path.join(root, '.cursor', 'rules'));

  /** Project maintainer rules (not plugin SSOT) — survive cleanDir; copied into Cursor rules dir. */
  const copyMaintainerCursorRules = (destDir: string) => {
    const maintainerRulesDir = path.join(root, '.github', 'rules');
    if (!fs.existsSync(maintainerRulesDir)) return;
    for (const file of fs.readdirSync(maintainerRulesDir)) {
      if (!file.endsWith('.mdc')) continue;
      fs.copyFileSync(path.join(maintainerRulesDir, file), path.join(destDir, file));
    }
  };
  copyMaintainerCursorRules(path.join(root, '.cursor', 'rules'));
  compileFolder('agents', path.join(root, '.cursor', 'agents'), cursorAgentDir, cursorVcodesPath, 'cursor', true);
  processFile(path.join(srcDir, 'SKILL.md'), path.join(root, 'skills', 'blackhole', 'SKILL.md'), cursorAgentDir, cursorVcodesPath, 'cursor');
  processFile(path.join(srcDir, 'SKILL.md'), path.join(root, '.cursor', 'skills', 'blackhole', 'SKILL.md'), cursorAgentDir, cursorVcodesPath, 'cursor');
  compileFolder('references', path.join(root, 'skills', 'blackhole', 'references'), cursorAgentDir, cursorVcodesPath, 'cursor');
  compileFolder('references', path.join(root, '.cursor', 'skills', 'blackhole', 'references'), cursorAgentDir, cursorVcodesPath, 'cursor');
};

// 4. Compile Target C: Claude Project-Level Native (.claude/)
export const compileClaudeNativeTarget = () => {
  console.log('Compiling Target C (Claude Project Native)...');
  compileFolder(
    'agents',
    path.join(root, '.claude', 'agents'),
    '.claude',
    '.claude/rules/blackhole-vcodes.md',
    'claude',
    true
  );
  for (const rule of RULES_LIST) {
    processFile(
      path.join(srcDir, 'references', rule),
      path.join(root, '.claude', 'rules', rule),
      '.claude',
      '.claude/rules/blackhole-vcodes.md',
      'claude'
    );
  }
  processFile(
    path.join(srcDir, 'SKILL.md'),
    path.join(root, '.claude', 'skills', 'blackhole', 'SKILL.md'),
    '.claude',
    '.claude/rules/blackhole-vcodes.md',
    'claude'
  );
  compileFolder(
    'references',
    path.join(root, '.claude', 'skills', 'blackhole', 'references'),
    '.claude',
    '.claude/rules/blackhole-vcodes.md',
    'claude'
  );
  // Issue #472: this repo's own campaign runs from .claude/, so the PreToolUse safety gate
  // (#447/#470) must ship and wire here too, not just to the consumer-facing plugin bundles.
  copyHooksDir(path.join(root, CLAUDE_NATIVE_ROOT));
  mergeClaudeSettingsHooks(path.join(root, CLAUDE_NATIVE_ROOT));
};

// 4b. Compile Target C2: Claude Code marketplace distribution bundle (plugins/blackhole-claude/)
// — ADR-009, issue #262. Isolates the intentionally-shipped plugin surface (skill + 8 campaign
// agents + rules + templates) from maintainer-only repo-root .claude/ content. Unlike the Gemini
// distribution bundle (Target D2 below), this bundle SHIPS agents/ — Claude marketplace plugins
// ship agents; AC4's no-agents rule is Gemini/Antigravity-schema-scoped only.
// Returns claudeDistRoot so downstream steps (Target D2's manifest bundling and Codex's later
// steps do not need it, but generateClaudePluginManifests does) can reuse it without recomputing.
export const compileClaudeMarketplaceTarget = (): string => {
  console.log('Compiling Claude Code marketplace bundle (plugins/blackhole-claude/)...');
  const claudeDistRoot = path.join(root, CLAUDE_DISTRIBUTION_ROOT);
  compileGeminiTree(claudeDistRoot, CLAUDE_DISTRIBUTION_AGENT_DIR, CLAUDE_DISTRIBUTION_VCODES, {
    includeAgents: true,
    target: 'claude',
  });
  return claudeDistRoot;
};

// 5. Compile Target D: Gemini/Antigravity — workspace (.agents/build/) — opt-in (#13)
export const compileGeminiTargets = (buildGemini: boolean) => {
  if (!buildGemini) return;
  console.log('Compiling Target D (Gemini/Antigravity workspace — .agents/build/)...');
  const agentsBuildRoot = path.join(root, AGENTS_BUILD_ROOT);
  compileGeminiTree(agentsBuildRoot, AGENTS_BUILD_AGENT_DIR, AGENTS_BUILD_VCODES);
  const workspaceAgentsDir = path.join(agentsBuildRoot, 'agents');
  const workspaceAgentFiles = fs.existsSync(workspaceAgentsDir)
    ? fs.readdirSync(workspaceAgentsDir).filter((f) => AGENT_MD_FILES.has(f))
    : [];
  const workspaceErrors = geminiWorkspaceTreeErrors(agentsBuildRoot, 'workspace', RULES_LIST, workspaceAgentFiles, AGENT_NAMES.length);
  if (workspaceErrors.length) throw new Error(workspaceErrors.join('; '));

  console.log('Generating Gemini Plugin manifest...');
  const geminiPluginMeta = buildGeminiPluginManifest(version);

  // Detached manifest for marketplace metadata (same payload as co-located plugin.json).
  writeGeminiManifest(path.join(root, '.gemini-plugin', 'plugin.json'), geminiPluginMeta);

  // Distribution bundle: redistributable plugin co-located with skills/ and rules/, no agents/
  // (AC4). Independent write site from the detached manifest above — each block is deletable
  // without breaking the other (see Grounding in .blackhole/plans/issue-27.md).
  console.log('Compiling Target D2 (Gemini/Antigravity distribution bundle — plugins/blackhole/)...');
  const distributionRoot = path.join(root, DISTRIBUTION_ROOT);
  compileGeminiTree(distributionRoot, DISTRIBUTION_AGENT_DIR, DISTRIBUTION_VCODES, { includeAgents: false });
  writeGeminiManifest(path.join(distributionRoot, 'plugin.json'), geminiPluginMeta);
  const distributionErrors = distributionTreeErrors(
    distributionRoot,
    path.join(distributionRoot, 'plugin.json'),
    RULES_LIST
  );
  if (distributionErrors.length) throw new Error(distributionErrors.join('; '));
};

// 6. Generate Claude Code Plugin Manifest (.claude-plugin/plugin.json)
// 6b. Bundle manifest: same payload as the repo-root manifest above, written to its own
// .claude-plugin/plugin.json *inside* the isolated distribution bundle (ADR-009) — the Claude
// plugin schema requires the manifest co-located with the plugin, unlike Gemini's flat
// plugin.json at bundle root (buildGeminiPluginManifest / writeGeminiManifest above).
// 8. Generate Claude Code Marketplace Catalog (.claude-plugin/marketplace.json)
export const generateClaudePluginManifests = (claudeDistRoot: string) => {
  console.log('Generating Claude Code Plugin manifests...');
  const pluginMeta = buildClaudePluginManifest(version);
  const pluginDir = path.join(root, '.claude-plugin');
  if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify(pluginMeta, null, 2), 'utf-8');

  const claudeBundlePluginDir = path.join(claudeDistRoot, '.claude-plugin');
  if (!fs.existsSync(claudeBundlePluginDir)) fs.mkdirSync(claudeBundlePluginDir, { recursive: true });
  fs.writeFileSync(path.join(claudeBundlePluginDir, 'plugin.json'), JSON.stringify(pluginMeta, null, 2), 'utf-8');

  const claudeBundleAgentsDir = path.join(claudeDistRoot, 'agents');
  const claudeBundleAgentFiles = fs.existsSync(claudeBundleAgentsDir)
    ? fs.readdirSync(claudeBundleAgentsDir).filter((f) => AGENT_MD_FILES.has(f))
    : [];
  const claudeDistErrors = claudeDistributionTreeErrors(claudeDistRoot, claudeBundleAgentFiles, AGENT_NAMES.length, RULES_LIST);
  if (claudeDistErrors.length) throw new Error(claudeDistErrors.join('; '));

  const marketplaceJson = buildClaudeMarketplace(pluginMeta);
  fs.writeFileSync(path.join(pluginDir, 'marketplace.json'), JSON.stringify(marketplaceJson, null, 2), 'utf-8');
};

// 9. Compile Target E: Codex CLI Native Support (default build — #31)
export const compileCodexTarget = (buildCodex: boolean) => {
  if (!buildCodex) return;
  console.log('Compiling Target E (Codex CLI Support)...');
  const codexAgentDir = 'codex-skills';
  const codexVcodesPath = 'codex-skills/blackhole/references/blackhole-vcodes.md';
  compileCodexTree(root, codexAgentDir, codexVcodesPath);
  const codexAgentsDir = path.join(root, 'codex-agents');
  const codexAgentFiles = fs.existsSync(codexAgentsDir)
    ? fs.readdirSync(codexAgentsDir).filter((f) => AGENT_YAML_FILES.has(f))
    : [];
  const codexErrors = codexTreeErrors(root, codexAgentFiles, AGENT_NAMES.length);
  if (codexErrors.length) throw new Error(codexErrors.join('; '));

  console.log('Generating Codex Plugin manifest...');
  const codexPluginMeta = buildCodexPluginManifest(version);
  const codexPluginDir = path.join(root, '.codex-plugin');
  if (!fs.existsSync(codexPluginDir)) fs.mkdirSync(codexPluginDir, { recursive: true });
  fs.writeFileSync(path.join(codexPluginDir, 'plugin.json'), JSON.stringify(codexPluginMeta, null, 2), 'utf-8');

  const codexMarketplaceJson = buildCodexMarketplace();
  fs.writeFileSync(path.join(root, 'codex-marketplace.json'), JSON.stringify(codexMarketplaceJson, null, 2), 'utf-8');
};
