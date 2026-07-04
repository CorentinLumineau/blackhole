import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const srcDir = path.join(root, 'src');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const version = pkg.version;

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

type Target = 'cursor' | 'claude' | 'skills';

// Strip platform-conditional blocks: {{#cursor}}...{{/cursor}} etc.
// Keeps only the block matching the current compile target.
const applyPlatformConditionals = (content: string, target: Target): string => {
  const active = target === 'skills' ? 'skills' : target;
  let res = content;
  for (const platform of ['cursor', 'claude', 'skills'] as const) {
    if (platform !== active) {
      res = res.replace(new RegExp(`\\{\\{#${platform}\\}\\}[\\s\\S]*?\\{\\{/${platform}\\}\\}\\n?`, 'g'), '');
    }
  }
  res = res.replace(new RegExp(`\\{\\{#${active}\\}\\}`, 'g'), '');
  res = res.replace(new RegExp(`\\{\\{/${active}\\}\\}\\n?`, 'g'), '');
  return res;
};

const compileContent = (content: string, agentDir: string, rulesPath: string, target: Target): string => {
  let res = content;
  if (agentDir === '') {
    // skills.sh root layout: flat references/ at repo root
    res = res.replaceAll('{{AGENT_DIR}}/skills/backlog-campaign/', '');
    res = res.replaceAll('{{AGENT_DIR}}', '');
  } else {
    res = res.replaceAll('{{AGENT_DIR}}', agentDir);
  }
  res = res.replaceAll('{{VCODES_PATH}}', rulesPath);
  if (target === 'skills' && agentDir !== '') {
    res = res.replaceAll('skills/backlog-campaign/skills/backlog-campaign/', 'skills/backlog-campaign/');
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
  } else if (isAgent && target === 'claude') {
    // Claude agents: preserve frontmatter (name, description, model, disallowedTools)
    // — do not strip, since Claude Code reads agent frontmatter
  } else {
    // Claude rules / skills.sh: strip Cursor-only MDC frontmatter entirely
    content = stripCursorFrontmatter(content);
  }

  content = applyPlatformConditionals(content, target);
  const compiled = compileContent(content, agentDir, rulesPath, target);

  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.writeFileSync(destPath, compiled, 'utf-8');
};

const compileFolder = (srcSub: string, destParent: string, agentDir: string, rulesPath: string, target: Target, isAgent = false) => {
  const fullSrc = path.join(srcDir, srcSub);
  if (!fs.existsSync(fullSrc)) return;

  const files = fs.readdirSync(fullSrc);
  for (const file of files) {
    const srcPath = path.join(fullSrc, file);
    const destPath = path.join(destParent, file);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      compileFolder(path.join(srcSub, file), destPath, agentDir, rulesPath, target, isAgent);
    } else if (stat.isFile()) {
      processFile(srcPath, destPath, agentDir, rulesPath, target, false, isAgent);
    }
  }
};

// 1. Clean existing build directories
console.log('Cleaning existing build directories...');
cleanDir(path.join(root, 'rules'));
cleanDir(path.join(root, 'agents'));
cleanDir(path.join(root, 'skills'));
cleanDir(path.join(root, 'references'));
cleanDir(path.join(root, '.cursor'));
cleanDir(path.join(root, '.claude'));
cleanDir(path.join(root, '.claude-plugin'));
if (fs.existsSync(path.join(root, 'SKILL.md'))) {
  fs.unlinkSync(path.join(root, 'SKILL.md'));
}
if (fs.existsSync(path.join(root, 'marketplace.json'))) {
  fs.unlinkSync(path.join(root, 'marketplace.json'));
}

// 2. Compile Target A: Agent-Agnostic / skills.sh (Root level flat layout)
console.log('Compiling Target A (skills.sh root-level)...');
processFile(
  path.join(srcDir, 'SKILL.md'),
  path.join(root, 'SKILL.md'),
  '',
  'references/backlog-campaign-vcodes.md',
  'skills'
);
compileFolder(
  'references',
  path.join(root, 'references'),
  '',
  'references/backlog-campaign-vcodes.md',
  'skills'
);

// 3. Compile Target B: Cursor (submodule root layout + .cursor/ mirror)
console.log('Compiling Target B (Cursor)...');
const rulesList = ['backlog-campaign-protocol.md', 'backlog-campaign-state.md', 'backlog-campaign-vcodes.md'];
const cursorAgentDir = '.cursor';
const cursorVcodesPath = '.cursor/rules/backlog-campaign-vcodes.mdc';

const writeCursorRules = (destDir: string) => {
  for (const rule of rulesList) {
    const isVcodesMdc = rule === 'backlog-campaign-vcodes.md';
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
processFile(path.join(srcDir, 'SKILL.md'), path.join(root, 'skills', 'backlog-campaign', 'SKILL.md'), cursorAgentDir, cursorVcodesPath, 'cursor');
processFile(path.join(srcDir, 'SKILL.md'), path.join(root, '.cursor', 'skills', 'backlog-campaign', 'SKILL.md'), cursorAgentDir, cursorVcodesPath, 'cursor');
compileFolder('references', path.join(root, 'skills', 'backlog-campaign', 'references'), cursorAgentDir, cursorVcodesPath, 'cursor');
compileFolder('references', path.join(root, '.cursor', 'skills', 'backlog-campaign', 'references'), cursorAgentDir, cursorVcodesPath, 'cursor');

// 4. Compile Target C: Claude Project-Level Native (.claude/)
console.log('Compiling Target C (Claude Project Native)...');
compileFolder(
  'agents',
  path.join(root, '.claude', 'agents'),
  '.claude',
  '.claude/rules/backlog-campaign-vcodes.md',
  'claude',
  true
);
for (const rule of rulesList) {
  processFile(
    path.join(srcDir, 'references', rule),
    path.join(root, '.claude', 'rules', rule),
    '.claude',
    '.claude/rules/backlog-campaign-vcodes.md',
    'claude'
  );
}
processFile(
  path.join(srcDir, 'SKILL.md'),
  path.join(root, '.claude', 'skills', 'backlog-campaign', 'SKILL.md'),
  '.claude',
  '.claude/rules/backlog-campaign-vcodes.md',
  'claude'
);
compileFolder(
  'references',
  path.join(root, '.claude', 'skills', 'backlog-campaign', 'references'),
  '.claude',
  '.claude/rules/backlog-campaign-vcodes.md',
  'claude'
);

// 5. Generate Claude Code Plugin Manifest (.claude-plugin/plugin.json)
console.log('Generating Claude Code Plugin manifests...');
const pluginMeta = {
  name: 'backlog-campaign',
  description: 'Agent-agnostic backlog campaign orchestrator to empty the forge backlog.',
  version,
  author: { name: 'backlog-campaign contributors' },
  license: 'Apache-2.0',
  keywords: ['backlog-campaign', 'claude-code', 'native', 'workflows', 'skills'],
};
const pluginDir = path.join(root, '.claude-plugin');
if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify(pluginMeta, null, 2), 'utf-8');

// 6. Generate Claude Code Marketplace Catalog (marketplace.json)
const marketplaceJson = {
  name: 'backlog-campaign-marketplace',
  description: 'Backlog Campaign Marketplace',
  owner: { name: 'CorentinLumineau' },
  plugins: [{ ...pluginMeta, source: '.' }],
};
fs.writeFileSync(path.join(root, 'marketplace.json'), JSON.stringify(marketplaceJson, null, 2), 'utf-8');

console.log('Build compilation completed successfully!');
