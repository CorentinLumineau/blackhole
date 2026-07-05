import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const srcDir = path.join(root, 'src');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const version = pkg.version;

// Gemini/Codex targets are opt-in until tracked in repo (#10, #13). Default build matches CI.
const args = new Set(process.argv.slice(2));
const buildAll = args.has('--all');
const buildGemini = buildAll || args.has('--gemini');
const buildCodex = buildAll || args.has('--codex');

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
  isAgent = false
) => {
  let content = fs.readFileSync(srcPath, 'utf-8');

  if (target === 'cursor') {
    // Cursor: enrich vcodes .mdc with glob patterns
    if (isVcodesMdc) {
      content = enrichVcodesMdcGlobs(content);
    }
  } else if (isAgent && (target === 'claude' || target === 'gemini')) {
    // Claude/Gemini agents: preserve frontmatter (name, description, model, disallowedTools)
    // — do not strip, since Claude Code / Gemini reads agent frontmatter
  } else {
    // Claude rules / skills.sh / Gemini rules: strip Cursor-only MDC frontmatter entirely
    content = stripCursorFrontmatter(content);
  }

  content = applyPlatformConditionals(content, target);
  const compiled = compileContent(content, agentDir, rulesPath, target);

  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Codex agents: serialize frontmatter + body as YAML
  if (isAgent && target === 'codex') {
    const parts = compiled.split(/^---$/m);
    const fmContent = parts.length >= 3 ? parts[1] : '';
    const bodyContent = parts.length >= 3 ? parts.slice(2).join('---').trim() : compiled.trim();

    // Parse frontmatter key-value pairs
    const fm: Record<string, string> = {};
    for (const line of fmContent.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.substring(0, colonIdx).trim();
      const val = line.substring(colonIdx + 1).trim();
      if (key) fm[key] = val;
    }

    // Parse disallowedTools array value like [Write, Edit]
    let tools: string[] = [];
    if (fm.disallowedTools) {
      const m = fm.disallowedTools.match(/\[(.*)\]/);
      if (m && m[1].trim()) {
        tools = m[1].split(',').map(t => t.trim()).filter(Boolean);
      }
    }

    // Build YAML output
    let yaml = '';
    yaml += `name: ${fm.name || ''}\n`;
    yaml += `description: ${fm.description || ''}\n`;
    yaml += `model: ${fm.model || ''}\n`;
    yaml += `permissionMode: ${fm.permissionMode || ''}\n`;
    if (tools.length > 0) {
      yaml += `disallowedTools:\n`;
      for (const tool of tools) yaml += `  - ${tool}\n`;
    } else {
      yaml += `disallowedTools: []\n`;
    }
    // Block scalar for instructions
    const indentedBody = bodyContent
      .split('\n')
      .map(line => (line ? `  ${line}` : ''))
      .join('\n');
    yaml += `instructions: |\n${indentedBody}\n`;

    fs.writeFileSync(destPath, yaml, 'utf-8');
    return;
  }

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
  name: 'backlog-campaign',
  description: 'Agent-agnostic backlog campaign orchestrator to empty the forge backlog.',
  version: pkgVersion,
  author: { name: 'backlog-campaign contributors' },
  license: 'Apache-2.0',
  keywords: ['backlog-campaign', 'gemini', 'native', 'workflows', 'skills'],
});

export const compileGeminiTree = (destRoot: string, agentDir: string, rulesPath: string) => {
  compileFolder('agents', path.join(destRoot, 'agents'), agentDir, rulesPath, 'gemini', true);
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
  if (agentFiles.length !== 6) {
    throw new Error(`Gemini ${label}: expected 6 agents, got ${agentFiles.length}`);
  }
  if (ruleFiles.length !== 3) {
    throw new Error(`Gemini ${label}: expected 3 rules, got ${ruleFiles.length}`);
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
  cleanDir(path.join(root, '.agents', 'rules'));
  cleanDir(path.join(root, '.agents', 'agents'));
  cleanDir(path.join(root, '.agents', 'skills', 'bc-campaign'));
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

// 5. Compile Target D: Gemini/Antigravity — workspace (.agents/) + distribution (.gemini-plugin/) — opt-in (#13)
if (buildGemini) {
  console.log('Compiling Target D (Gemini/Antigravity Project Native)...');
  const agentsRoot = path.join(root, '.agents');
  compileGeminiTree(agentsRoot, '.agents', '.agents/rules/bc-campaign-vcodes.md');
  assertGeminiTree(agentsRoot, 'workspace');

  console.log('Generating Gemini Plugin manifest...');
  const geminiPluginMeta = buildGeminiPluginManifest(version);
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

// 9. Compile Target E: Codex CLI Native Support — opt-in (#10)
if (buildCodex) {
  console.log('Compiling Target E (Codex CLI Support)...');
  const codexAgentDir = 'codex-skills';
  const codexVcodesPath = 'codex-skills/bc-campaign/references/bc-campaign-vcodes.md';
  compileFolder(
    'agents',
    path.join(root, 'codex-agents'),
    codexAgentDir,
    codexVcodesPath,
    'codex',
    true
  );
  processFile(
    path.join(srcDir, 'SKILL.md'),
    path.join(root, 'codex-skills', 'bc-campaign', 'SKILL.md'),
    codexAgentDir,
    codexVcodesPath,
    'codex'
  );
  compileFolder(
    'references',
    path.join(root, 'codex-skills', 'bc-campaign', 'references'),
    codexAgentDir,
    codexVcodesPath,
    'codex'
  );

  console.log('Generating Codex Plugin manifest...');
  const codexPluginMeta = {
    name: 'bc-campaign',
    description: 'Agent-agnostic backlog campaign orchestrator to empty the forge backlog.',
    version,
    author: { name: 'bc-campaign contributors' },
    license: 'Apache-2.0',
    keywords: ['bc-campaign', 'codex', 'native', 'workflows', 'skills'],
  };
  const codexPluginDir = path.join(root, '.codex-plugin');
  if (!fs.existsSync(codexPluginDir)) fs.mkdirSync(codexPluginDir, { recursive: true });
  fs.writeFileSync(path.join(codexPluginDir, 'plugin.json'), JSON.stringify(codexPluginMeta, null, 2), 'utf-8');

  const codexMarketplaceJson = {
    name: 'bc-campaign-marketplace',
    description: 'Backlog Campaign Marketplace',
    owner: { name: 'CorentinLumineau' },
    plugins: [{ ...codexPluginMeta, source: '.' }],
  };
  fs.writeFileSync(path.join(root, 'codex-marketplace.json'), JSON.stringify(codexMarketplaceJson, null, 2), 'utf-8');
}

console.log('Build compilation completed successfully!');
};

if (import.meta.main) {
  main();
}
