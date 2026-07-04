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

const compileContent = (content: string, agentDir: string, rulesPath: string): string => {
  let res = content.replaceAll('{{AGENT_DIR}}', agentDir);
  res = res.replaceAll('{{AGENT_DIR}}/rules/backlog-campaign-vcodes.md', rulesPath);
  if (agentDir === 'skills/backlog-campaign') {
    res = res.replaceAll('skills/backlog-campaign/skills/backlog-campaign/', 'skills/backlog-campaign/');
  }
  return res;
};

const processFile = (srcPath: string, destPath: string, agentDir: string, rulesPath: string, isVcodesMdc = false) => {
  let content = fs.readFileSync(srcPath, 'utf-8');
  
  if (isVcodesMdc) {
    // Add glob patterns to the frontmatter of backlog-campaign-vcodes.mdc
    content = content.replace(
      'globs:\nalwaysApply: false',
      'globs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.go", "**/*.py", "**/*.rs", "**/*.java", "**/*.c", "**/*.cpp", "**/*.cs"]\nalwaysApply: false'
    );
  }

  const compiled = compileContent(content, agentDir, rulesPath);
  
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  
  fs.writeFileSync(destPath, compiled, 'utf-8');
};

const compileFolder = (srcSub: string, destParent: string, agentDir: string, rulesPath: string) => {
  const fullSrc = path.join(srcDir, srcSub);
  if (!fs.existsSync(fullSrc)) return;

  const files = fs.readdirSync(fullSrc);
  for (const file of files) {
    const srcPath = path.join(fullSrc, file);
    const destPath = path.join(destParent, file);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      compileFolder(path.join(srcSub, file), destPath, agentDir, rulesPath);
    } else if (stat.isFile()) {
      processFile(srcPath, destPath, agentDir, rulesPath);
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
  'skills/backlog-campaign',
  'skills/backlog-campaign/references/backlog-campaign-vcodes.md'
);
compileFolder(
  'references',
  path.join(root, 'references'),
  'skills/backlog-campaign',
  'skills/backlog-campaign/references/backlog-campaign-vcodes.md'
);

// 3. Compile Target B: Unified Root-level directories (natively read by Cursor submodule / Claude Plugin)
console.log('Compiling Target B (Cursor Submodule / Claude Plugin root layouts)...');
// rules/ containing .mdc files for Cursor
const rulesList = ['backlog-campaign-protocol.md', 'backlog-campaign-state.md', 'backlog-campaign-vcodes.md'];
for (const rule of rulesList) {
  const isVcodesMdc = rule === 'backlog-campaign-vcodes.md';
  const destName = rule.substring(0, rule.length - 3) + '.mdc';
  processFile(
    path.join(srcDir, 'references', rule),
    path.join(root, 'rules', destName),
    '.cursor',
    '.cursor/rules/backlog-campaign-vcodes.mdc',
    isVcodesMdc
  );
  processFile(
    path.join(srcDir, 'references', rule),
    path.join(root, '.cursor', 'rules', destName),
    '.cursor',
    '.cursor/rules/backlog-campaign-vcodes.mdc',
    isVcodesMdc
  );
}
// agents/ containing .md files resolved for Cursor (.cursor)
compileFolder(
  'agents',
  path.join(root, 'agents'),
  '.cursor',
  '.cursor/rules/backlog-campaign-vcodes.mdc'
);
compileFolder(
  'agents',
  path.join(root, '.cursor', 'agents'),
  '.cursor',
  '.cursor/rules/backlog-campaign-vcodes.mdc'
);
// skills/backlog-campaign/ containing SKILL.md and references/ resolved for Cursor (.cursor)
processFile(
  path.join(srcDir, 'SKILL.md'),
  path.join(root, 'skills', 'backlog-campaign', 'SKILL.md'),
  '.cursor',
  '.cursor/rules/backlog-campaign-vcodes.mdc'
);
processFile(
  path.join(srcDir, 'SKILL.md'),
  path.join(root, '.cursor', 'skills', 'backlog-campaign', 'SKILL.md'),
  '.cursor',
  '.cursor/rules/backlog-campaign-vcodes.mdc'
);
compileFolder(
  'references',
  path.join(root, 'skills', 'backlog-campaign', 'references'),
  '.cursor',
  '.cursor/rules/backlog-campaign-vcodes.mdc'
);
compileFolder(
  'references',
  path.join(root, '.cursor', 'skills', 'backlog-campaign', 'references'),
  '.cursor',
  '.cursor/rules/backlog-campaign-vcodes.mdc'
);

// 4. Compile Target C: Claude Project-Level Native (.claude/)
console.log('Compiling Target C (Claude Project Native)...');
compileFolder(
  'agents',
  path.join(root, '.claude', 'agents'),
  '.claude',
  '.claude/rules/backlog-campaign-vcodes.md'
);
for (const rule of rulesList) {
  processFile(
    path.join(srcDir, 'references', rule),
    path.join(root, '.claude', 'rules', rule),
    '.claude',
    '.claude/rules/backlog-campaign-vcodes.md'
  );
}
processFile(
  path.join(srcDir, 'SKILL.md'),
  path.join(root, '.claude', 'skills', 'backlog-campaign', 'SKILL.md'),
  '.claude',
  '.claude/rules/backlog-campaign-vcodes.md'
);
compileFolder(
  'references',
  path.join(root, '.claude', 'skills', 'backlog-campaign', 'references'),
  '.claude',
  '.claude/rules/backlog-campaign-vcodes.md'
);

// 5. Generate Claude Code Plugin Manifest (.claude-plugin/plugin.json)
console.log('Generating Claude Code Plugin manifests...');
const pluginJson = {
  name: "backlog-campaign",
  description: "Agent-agnostic backlog campaign orchestrator to empty the forge backlog.",
  version: version,
  author: {
    name: "backlog-campaign contributors"
  },
  license: "Apache-2.0",
  keywords: [
    "backlog-campaign",
    "claude-code",
    "native",
    "workflows",
    "skills"
  ]
};
const pluginDir = path.join(root, '.claude-plugin');
if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify(pluginJson, null, 2), 'utf-8');

// 6. Generate Claude Code Marketplace Catalog (marketplace.json)
const marketplaceJson = {
  name: "backlog-campaign-marketplace",
  description: "Backlog Campaign Marketplace",
  owner: {
    name: "CorentinLumineau"
  },
  plugins: [
    {
      name: "backlog-campaign",
      version: version,
      source: ".",
      description: "Agent-agnostic backlog campaign orchestrator to empty the forge backlog.",
      author: {
        name: "backlog-campaign contributors"
      },
      keywords: [
        "backlog-campaign",
        "claude-code",
        "native",
        "workflows",
        "skills"
      ]
    }
  ]
};
fs.writeFileSync(path.join(root, 'marketplace.json'), JSON.stringify(marketplaceJson, null, 2), 'utf-8');

console.log('Build compilation completed successfully!');
