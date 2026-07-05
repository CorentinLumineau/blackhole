import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const srcDir = path.join(root, 'src');

/** Gemini workspace compile output — separate from ephemeral handoff dirs under `.agents/`. */
export const AGENTS_BUILD_ROOT = path.join('.agents', 'build');
export const AGENTS_BUILD_AGENT_DIR = '.agents/build';
export const AGENTS_BUILD_VCODES = '.agents/build/rules/bc-campaign-vcodes.md';
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const version = pkg.version;

// Gemini is opt-in until tracked in repo (#13). Codex is part of default build (#31).
const args = new Set(process.argv.slice(2));
const buildAll = args.has('--all');
const buildGemini = buildAll || args.has('--gemini');
const buildCodex = !args.has('--no-codex');

const cleanDir = (dirPath: string) => {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
};

// Strip Cursor-only MDC frontmatter (--- globs: / alwaysApply: ---) for non-Cursor targets.
// The frontmatter block is kept as-is for Cursor; for Claude and skills.sh it is removed entirely
// since those platforms do not understand Cursor rule metadata.
const stripCursorFrontmatter = (content: string): string => {
  return content.replace(/^---\n(?:.*\n)*?---\n\n?/, '');
};

// Parse YAML frontmatter from markdown — body is everything after the first closing --- only.
export const parseMdFrontmatter = (content: string): { frontmatter: string; body: string } => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: '', body: content };
  return { frontmatter: match[1], body: match[2] };
};

export const parseFrontmatterFields = (fmContent: string): Record<string, string> => {
  const fm: Record<string, string> = {};
  for (const line of fmContent.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    const val = line.substring(colonIdx + 1).trim();
    if (key) fm[key] = val;
  }
  return fm;
};

export const parseDisallowedTools = (fm: Record<string, string>): string[] => {
  if (!fm.disallowedTools) return [];
  const m = fm.disallowedTools.match(/\[(.*)\]/);
  if (!m || !m[1].trim()) return [];
  return m[1].split(',').map((t) => t.trim()).filter(Boolean);
};

export const serializeCodexAgentYaml = (fm: Record<string, string>, bodyContent: string): string => {
  const tools = parseDisallowedTools(fm);
  let yaml = '';
  yaml += `name: ${fm.name || ''}\n`;
  yaml += `description: ${fm.description || ''}\n`;
  if (fm.model) yaml += `model: ${fm.model}\n`;
  yaml += `permissionMode: ${fm.permissionMode || ''}\n`;
  if (tools.length > 0) {
    yaml += `disallowedTools:\n`;
    for (const tool of tools) yaml += `  - ${tool}\n`;
  } else {
    yaml += `disallowedTools: []\n`;
  }
  const indentedBody = bodyContent
    .split('\n')
    .map((line) => (line ? `  ${line}` : ''))
    .join('\n');
  yaml += `instructions: |\n${indentedBody}\n`;
  return yaml;
};

export const buildCodexAgentYaml = (
  sourceContent: string,
  agentDir: string,
  rulesPath: string
): string => {
  const { frontmatter, body } = parseMdFrontmatter(sourceContent);
  const fm = parseFrontmatterFields(frontmatter);
  let bodyContent = applyPlatformConditionals(body, 'codex');
  bodyContent = compileContent(bodyContent, agentDir, rulesPath, 'codex');
  return serializeCodexAgentYaml(fm, bodyContent.trim());
};

// Enrich Cursor MDC frontmatter with glob patterns so the rule auto-applies on matching files.
const enrichVcodesMdcGlobs = (content: string): string => {
  return content.replace(
    'globs:\nalwaysApply: false',
    'globs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.go", "**/*.py", "**/*.rs", "**/*.java", "**/*.c", "**/*.cpp", "**/*.cs"]\nalwaysApply: false'
  );
};

type Target = 'cursor' | 'claude' | 'skills' | 'gemini' | 'codex';

// Strip platform-conditional blocks: {{#cursor}}...{{/cursor}} etc.
// Keeps only the block matching the current compile target.
export const applyPlatformConditionals = (content: string, target: Target): string => {
  const active = target === 'skills' ? 'skills' : target;
  let res = content;
  for (const platform of ['cursor', 'claude', 'skills', 'gemini', 'codex'] as const) {
    if (platform !== active) {
      res = res.replace(new RegExp(`\\{\\{#${platform}\\}\\}[\\s\\S]*?\\{\\{/${platform}\\}\\}\\n?`, 'g'), '');
    }
  }
  res = res.replace(new RegExp(`\\{\\{#${active}\\}\\}`, 'g'), '');
  res = res.replace(new RegExp(`\\{\\{/${active}\\}\\}\\n?`, 'g'), '');
  return res;
};

export const compileContent = (content: string, agentDir: string, rulesPath: string, target: Target): string => {
  let res = content;
  if (target === 'codex') {
    res = res.replaceAll('{{AGENT_DIR}}/skills/bc-campaign/', 'codex-skills/bc-campaign/');
  }
  if (agentDir === '') {
    // skills.sh root layout: flat references/ at repo root
    res = res.replaceAll('{{AGENT_DIR}}/skills/bc-campaign/', '');
    res = res.replaceAll('{{AGENT_DIR}}', '');
  } else {
    res = res.replaceAll('{{AGENT_DIR}}', agentDir);
  }
  res = res.replaceAll('{{VCODES_PATH}}', rulesPath);
  if (target === 'skills' && agentDir !== '') {
    res = res.replaceAll('skills/bc-campaign/skills/bc-campaign/', 'skills/bc-campaign/');
  }
  return res;
};

const processFile = (
  srcPath: string,
  destPath: string,
  agentDir: string,
  rulesPath: string,
  target: Target,
  isVcodesMdc = false,
  isAgent = false,
  isSkill = false
) => {
  const originalContent = fs.readFileSync(srcPath, 'utf-8');

  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Codex agents: parse frontmatter from original source; compile body only
  if (isAgent && target === 'codex') {
    const yaml = buildCodexAgentYaml(originalContent, agentDir, rulesPath);
    fs.writeFileSync(destPath, yaml, 'utf-8');
    return;
  }

  let content = originalContent;

  if (target === 'cursor') {
    // Cursor: enrich vcodes .mdc with glob patterns
    if (isVcodesMdc) {
      content = enrichVcodesMdcGlobs(content);
    }
  } else if (isAgent && (target === 'claude' || target === 'gemini' || target === 'codex')) {
    // Claude/Gemini/Codex agents: preserve frontmatter (name, description, disallowedTools; model omitted by design)
    // — do not strip; Codex serializes frontmatter into YAML separately
  } else if (target === 'codex' && isSkill) {
    // Codex skill: preserve skill frontmatter (disable-model-invocation, name, description)
  } else {
    // Claude rules / skills.sh / Gemini rules: strip Cursor-only MDC frontmatter entirely
    content = stripCursorFrontmatter(content);
  }

  content = applyPlatformConditionals(content, target);
  const compiled = compileContent(content, agentDir, rulesPath, target);

  fs.writeFileSync(destPath, compiled, 'utf-8');
};

const compileFolder = (srcSub: string, destParent: string, agentDir: string, rulesPath: string, target: Target, isAgent = false) => {
  const fullSrc = path.join(srcDir, srcSub);
  if (!fs.existsSync(fullSrc)) return;

  const files = fs.readdirSync(fullSrc);
  for (const file of files) {
    const srcPath = path.join(fullSrc, file);
    // Codex agents are output as .yaml instead of .md
    const destFile = (isAgent && target === 'codex' && file.endsWith('.md'))
      ? file.replace(/\.md$/, '.yaml')
      : file;
    const destPath = path.join(destParent, destFile);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      compileFolder(path.join(srcSub, file), destPath, agentDir, rulesPath, target, isAgent);
    } else if (stat.isFile()) {
      processFile(srcPath, destPath, agentDir, rulesPath, target, false, isAgent);
    }
  }
};

const rulesList = ['bc-campaign-protocol.md', 'bc-campaign-state.md', 'bc-campaign-vcodes.md'];

export const buildGeminiPluginManifest = (pkgVersion: string) => ({
  $schema: 'https://antigravity.google/schemas/v1/plugin.json',
  name: 'bc-campaign',
  description: 'Agent-agnostic backlog campaign orchestrator to empty the forge backlog.',
  version: pkgVersion,
  author: { name: 'bc-campaign contributors' },
  license: 'Apache-2.0',
  keywords: ['bc-campaign', 'gemini', 'native', 'workflows', 'skills'],
});

export const buildCodexPluginManifest = (pkgVersion: string) => ({
  name: 'bc-campaign',
  version: pkgVersion,
  description: 'Agent-agnostic backlog campaign orchestrator to empty the forge backlog.',
  author: {
    name: 'Corentin Lumineau',
    email: 'corentin@lumineau.dev',
    url: 'https://github.com/CorentinLumineau',
  },
  homepage: 'https://github.com/CorentinLumineau/backlog-campaign',
  repository: 'https://github.com/CorentinLumineau/backlog-campaign',
  license: 'Apache-2.0',
  keywords: ['backlog-campaign', 'codex', 'native', 'workflows', 'skills'],
  skills: './codex-skills/',
  interface: {
    displayName: 'Backlog Campaign',
    shortDescription: 'Auto-solve your entire GitHub backlog',
    longDescription: 'Five-phase lifecycle: Handle → Plan → Implement → Review → Loop.',
    developerName: 'Corentin Lumineau',
    category: 'Developer Tools',
    capabilities: ['Write', 'Interactive'],
    websiteURL: 'https://github.com/CorentinLumineau/backlog-campaign',
    defaultPrompt: [
      'Run the backlog campaign until empty for this repo.',
      'Show backlog status: open issues, in-flight, and queue.',
      'Implement issue #N using the campaign pipeline.',
    ],
    brandColor: '#3B82F6',
  },
});

export const buildCodexMarketplace = () => ({
  name: 'bc-campaign-codex',
  interface: { displayName: 'Backlog Campaign - Codex' },
  plugins: [
    {
      name: 'bc-campaign',
      source: {
        source: 'git',
        url: 'https://github.com/CorentinLumineau/backlog-campaign',
      },
      policy: {
        installation: 'AVAILABLE',
        authentication: 'ON_INSTALL',
      },
      category: 'Developer Tools',
    },
  ],
});

export const compileGeminiTree = (
  destRoot: string,
  agentDir: string,
  rulesPath: string,
  options: { includeAgents?: boolean } = {}
) => {
  if (options.includeAgents !== false) {
    compileFolder('agents', path.join(destRoot, 'agents'), agentDir, rulesPath, 'gemini', true);
  }
  for (const rule of rulesList) {
    processFile(
      path.join(srcDir, 'references', rule),
      path.join(destRoot, 'rules', rule),
      agentDir,
      rulesPath,
      'gemini'
    );
  }
  processFile(
    path.join(srcDir, 'SKILL.md'),
    path.join(destRoot, 'skills', 'bc-campaign', 'SKILL.md'),
    agentDir,
    rulesPath,
    'gemini'
  );
  compileFolder(
    'references',
    path.join(destRoot, 'skills', 'bc-campaign', 'references'),
    agentDir,
    rulesPath,
    'gemini'
  );
};

const assertGeminiTree = (destRoot: string, label: string) => {
  const agentsDir = path.join(destRoot, 'agents');
  const rulesDir = path.join(destRoot, 'rules');
  const agentFiles = fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir).filter((f) => f.startsWith('bc-') && f.endsWith('.md'))
    : [];
  const ruleFiles = fs.existsSync(rulesDir)
    ? fs.readdirSync(rulesDir).filter((f) => rulesList.includes(f))
    : [];
  if (agentFiles.length !== 5) {
    throw new Error(`Gemini ${label}: expected 5 agents, got ${agentFiles.length}`);
  }
  if (ruleFiles.length !== 3) {
    throw new Error(`Gemini ${label}: expected 3 rules, got ${ruleFiles.length}`);
  }
};

export const compileCodexTree = (rootDir: string, agentDir: string, rulesPath: string) => {
  compileFolder('agents', path.join(rootDir, 'codex-agents'), agentDir, rulesPath, 'codex', true);
  processFile(
    path.join(srcDir, 'SKILL.md'),
    path.join(rootDir, 'codex-skills', 'bc-campaign', 'SKILL.md'),
    agentDir,
    rulesPath,
    'codex',
    false,
    false,
    true
  );
  compileFolder(
    'references',
    path.join(rootDir, 'codex-skills', 'bc-campaign', 'references'),
    agentDir,
    rulesPath,
    'codex'
  );
};

const assertCodexTree = (rootDir: string) => {
  const agentsDir = path.join(rootDir, 'codex-agents');
  const agentFiles = fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir).filter((f) => f.startsWith('bc-') && f.endsWith('.yaml'))
    : [];
  if (agentFiles.length !== 5) {
    throw new Error(`Codex: expected 5 agent YAML files, got ${agentFiles.length}`);
  }
  for (const file of agentFiles) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
    if (!content.includes('instructions: |')) {
      throw new Error(`Codex: ${file} missing instructions block scalar`);
    }
  }
  const skillPath = path.join(rootDir, 'codex-skills', 'bc-campaign', 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    throw new Error('Codex: missing codex-skills/bc-campaign/SKILL.md');
  }
  const refsDir = path.join(rootDir, 'codex-skills', 'bc-campaign', 'references');
  if (!fs.existsSync(refsDir) || fs.readdirSync(refsDir).length === 0) {
    throw new Error('Codex: missing or empty codex-skills/bc-campaign/references/');
  }
};

const main = () => {
console.log('Cleaning existing build directories...');
cleanDir(path.join(root, 'rules'));
cleanDir(path.join(root, 'agents'));
cleanDir(path.join(root, 'skills'));
cleanDir(path.join(root, 'references'));
cleanDir(path.join(root, '.cursor'));
cleanDir(path.join(root, '.claude'));
cleanDir(path.join(root, '.claude-plugin'));
if (buildGemini) {
  cleanDir(path.join(root, AGENTS_BUILD_ROOT));
  cleanDir(path.join(root, '.gemini-plugin'));
}
if (buildCodex) {
  cleanDir(path.join(root, 'codex-agents'));
  cleanDir(path.join(root, 'codex-skills'));
  cleanDir(path.join(root, '.codex-plugin'));
}
if (fs.existsSync(path.join(root, 'SKILL.md'))) {
  fs.unlinkSync(path.join(root, 'SKILL.md'));
}
if (fs.existsSync(path.join(root, 'marketplace.json'))) {
  fs.unlinkSync(path.join(root, 'marketplace.json'));
}
if (buildCodex && fs.existsSync(path.join(root, 'codex-marketplace.json'))) {
  fs.unlinkSync(path.join(root, 'codex-marketplace.json'));
}

// 2. Compile Target A: Agent-Agnostic / skills.sh (Root level flat layout)
console.log('Compiling Target A (skills.sh root-level)...');
processFile(
  path.join(srcDir, 'SKILL.md'),
  path.join(root, 'SKILL.md'),
  '',
  'references/bc-campaign-vcodes.md',
  'skills'
);
compileFolder(
  'references',
  path.join(root, 'references'),
  '',
  'references/bc-campaign-vcodes.md',
  'skills'
);

// 3. Compile Target B: Cursor (submodule root layout + .cursor/ mirror)
console.log('Compiling Target B (Cursor)...');
const cursorAgentDir = '.cursor';
const cursorVcodesPath = '.cursor/rules/bc-campaign-vcodes.mdc';

const writeCursorRules = (destDir: string) => {
  for (const rule of rulesList) {
    const isVcodesMdc = rule === 'bc-campaign-vcodes.md';
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
compileFolder('agents', path.join(root, 'agents'), cursorAgentDir, cursorVcodesPath, 'cursor', true);
compileFolder('agents', path.join(root, '.cursor', 'agents'), cursorAgentDir, cursorVcodesPath, 'cursor', true);
processFile(path.join(srcDir, 'SKILL.md'), path.join(root, 'skills', 'bc-campaign', 'SKILL.md'), cursorAgentDir, cursorVcodesPath, 'cursor');
processFile(path.join(srcDir, 'SKILL.md'), path.join(root, '.cursor', 'skills', 'bc-campaign', 'SKILL.md'), cursorAgentDir, cursorVcodesPath, 'cursor');
compileFolder('references', path.join(root, 'skills', 'bc-campaign', 'references'), cursorAgentDir, cursorVcodesPath, 'cursor');
compileFolder('references', path.join(root, '.cursor', 'skills', 'bc-campaign', 'references'), cursorAgentDir, cursorVcodesPath, 'cursor');

// 4. Compile Target C: Claude Project-Level Native (.claude/)
console.log('Compiling Target C (Claude Project Native)...');
compileFolder(
  'agents',
  path.join(root, '.claude', 'agents'),
  '.claude',
  '.claude/rules/bc-campaign-vcodes.md',
  'claude',
  true
);
for (const rule of rulesList) {
  processFile(
    path.join(srcDir, 'references', rule),
    path.join(root, '.claude', 'rules', rule),
    '.claude',
    '.claude/rules/bc-campaign-vcodes.md',
    'claude'
  );
}
processFile(
  path.join(srcDir, 'SKILL.md'),
  path.join(root, '.claude', 'skills', 'bc-campaign', 'SKILL.md'),
  '.claude',
  '.claude/rules/bc-campaign-vcodes.md',
  'claude'
);
compileFolder(
  'references',
  path.join(root, '.claude', 'skills', 'bc-campaign', 'references'),
  '.claude',
  '.claude/rules/bc-campaign-vcodes.md',
  'claude'
);

// 5. Compile Target D: Gemini/Antigravity — workspace (.agents/build/) — opt-in (#13)
if (buildGemini) {
  console.log('Compiling Target D (Gemini/Antigravity workspace — .agents/build/)...');
  const agentsBuildRoot = path.join(root, AGENTS_BUILD_ROOT);
  compileGeminiTree(agentsBuildRoot, AGENTS_BUILD_AGENT_DIR, AGENTS_BUILD_VCODES);
  assertGeminiTree(agentsBuildRoot, 'workspace');

  console.log('Generating Gemini Plugin manifest...');
  const geminiPluginMeta = buildGeminiPluginManifest(version);

  // Detached manifest for marketplace metadata (same payload as co-located plugin.json).
  const geminiPluginDir = path.join(root, '.gemini-plugin');
  if (!fs.existsSync(geminiPluginDir)) fs.mkdirSync(geminiPluginDir, { recursive: true });
  fs.writeFileSync(path.join(geminiPluginDir, 'plugin.json'), JSON.stringify(geminiPluginMeta, null, 2), 'utf-8');
}

// 6. Generate Claude Code Plugin Manifest (.claude-plugin/plugin.json)
console.log('Generating Claude Code Plugin manifests...');
const pluginMeta = {
  name: 'bc-campaign',
  description: 'Agent-agnostic backlog campaign orchestrator to empty the forge backlog.',
  version,
  author: { name: 'bc-campaign contributors' },
  license: 'Apache-2.0',
  keywords: ['bc-campaign', 'claude-code', 'native', 'workflows', 'skills'],
};
const pluginDir = path.join(root, '.claude-plugin');
if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify(pluginMeta, null, 2), 'utf-8');

// 8. Generate Claude Code Marketplace Catalog (marketplace.json)
const marketplaceJson = {
  name: 'bc-campaign-marketplace',
  description: 'Backlog Campaign Marketplace',
  owner: { name: 'CorentinLumineau' },
  plugins: [{ ...pluginMeta, source: '.' }],
};
fs.writeFileSync(path.join(root, 'marketplace.json'), JSON.stringify(marketplaceJson, null, 2), 'utf-8');

// 9. Compile Target E: Codex CLI Native Support (default build — #31)
if (buildCodex) {
  console.log('Compiling Target E (Codex CLI Support)...');
  const codexAgentDir = 'codex-skills';
  const codexVcodesPath = 'codex-skills/bc-campaign/references/bc-campaign-vcodes.md';
  compileCodexTree(root, codexAgentDir, codexVcodesPath);
  assertCodexTree(root);

  console.log('Generating Codex Plugin manifest...');
  const codexPluginMeta = buildCodexPluginManifest(version);
  const codexPluginDir = path.join(root, '.codex-plugin');
  if (!fs.existsSync(codexPluginDir)) fs.mkdirSync(codexPluginDir, { recursive: true });
  fs.writeFileSync(path.join(codexPluginDir, 'plugin.json'), JSON.stringify(codexPluginMeta, null, 2), 'utf-8');

  const codexMarketplaceJson = buildCodexMarketplace();
  fs.writeFileSync(path.join(root, 'codex-marketplace.json'), JSON.stringify(codexMarketplaceJson, null, 2), 'utf-8');
}

console.log('Build compilation completed successfully!');
};

if (import.meta.main) {
  main();
}
