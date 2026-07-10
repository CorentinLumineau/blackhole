import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyPlatformConditionals,
  compileContent,
  buildGeminiPluginManifest,
  buildCodexPluginManifest,
  buildCodexMarketplace,
  parseMdFrontmatter,
  buildCodexAgentYaml,
  serializeCodexAgentYaml,
  compileGeminiTree,
  copyTemplatesDir,
  writeGeminiManifest,
  compileCodexTree,
  generatedMarkerLine,
  buildClaudePluginManifest,
  buildClaudeMarketplace,
  cleanDir,
} from './build.ts';
import { projectIdentity } from './project-identity.ts';

const root = path.resolve(import.meta.dirname, '..');

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'blackhole-build-test-'));

describe('applyPlatformConditionals', () => {
  test('gemini keeps gemini body and removes cursor/claude/skills', () => {
    const input = `before
{{#cursor}}cursor only{{/cursor}}
{{#claude}}claude only{{/claude}}
{{#skills}}skills only{{/skills}}
{{#gemini}}gemini content{{/gemini}}
after`;
    const result = applyPlatformConditionals(input, 'gemini');
    expect(result).toContain('gemini content');
    expect(result).not.toContain('cursor only');
    expect(result).not.toContain('claude only');
    expect(result).not.toContain('skills only');
    expect(result).not.toContain('{{#cursor}}');
    expect(result).not.toContain('{{#claude}}');
    expect(result).not.toContain('{{#gemini}}');
  });

  test('codex keeps codex body and removes other platforms', () => {
    const input = `before
{{#cursor}}cursor only{{/cursor}}
{{#claude}}claude only{{/claude}}
{{#codex}}codex content{{/codex}}
after`;
    const result = applyPlatformConditionals(input, 'codex');
    expect(result).toContain('codex content');
    expect(result).not.toContain('cursor only');
    expect(result).not.toContain('claude only');
    expect(result).not.toContain('{{#codex}}');
  });
});

describe('compileContent', () => {
  test('substitutes AGENT_DIR and VCODES_PATH for distribution layout', () => {
    const result = compileContent(
      'dir={{AGENT_DIR}} vcodes={{VCODES_PATH}}',
      'plugins/blackhole',
      'plugins/blackhole/rules/blackhole-vcodes.md',
      'gemini'
    );
    expect(result).toBe(
      'dir=plugins/blackhole vcodes=plugins/blackhole/rules/blackhole-vcodes.md'
    );
  });

  test('substitutes workspace paths for .agents/build layout', () => {
    const result = compileContent(
      'dir={{AGENT_DIR}} vcodes={{VCODES_PATH}}',
      '.agents/build',
      '.agents/build/rules/blackhole-vcodes.md',
      'gemini'
    );
    expect(result).toBe('dir=.agents/build vcodes=.agents/build/rules/blackhole-vcodes.md');
  });
});

describe('buildGeminiPluginManifest', () => {
  test('includes required Antigravity schema fields', () => {
    const manifest = buildGeminiPluginManifest('1.2.3');
    expect(manifest.$schema).toBe('https://antigravity.google/schemas/v1/plugin.json');
    expect(manifest.name).toBe('blackhole');
    expect(manifest.author.name).toBe('blackhole contributors');
    expect(manifest.keywords[0]).toBe('blackhole');
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.description).toContain('backlog campaign');
  });

  test('sources description and keywords from project-identity.ts (not a separate literal)', () => {
    const manifest = buildGeminiPluginManifest('1.2.3');
    expect(manifest.description).toBe(projectIdentity.description);
    expect(manifest.keywords).toEqual([projectIdentity.name, 'gemini', ...projectIdentity.keywordsBase]);
  });
});

describe('cleanDir', () => {
  test('removes an existing directory recursively', () => {
    const destRoot = makeTempDir();
    try {
      const nested = path.join(destRoot, 'a', 'b');
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(nested, 'file.txt'), 'x');

      cleanDir(path.join(destRoot, 'a'));

      expect(fs.existsSync(path.join(destRoot, 'a'))).toBe(false);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('is a no-op when the directory does not exist', () => {
    const destRoot = makeTempDir();
    try {
      const missing = path.join(destRoot, 'does-not-exist');
      expect(() => cleanDir(missing)).not.toThrow();
      expect(fs.existsSync(missing)).toBe(false);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('leaves sibling directories untouched (regression: cleaning .claude/agents must not remove .claude/initiatives)', () => {
    const destRoot = makeTempDir();
    try {
      const claudeDir = path.join(destRoot, '.claude');
      fs.mkdirSync(path.join(claudeDir, 'agents'), { recursive: true });
      fs.mkdirSync(path.join(claudeDir, 'initiatives'), { recursive: true });
      fs.writeFileSync(path.join(claudeDir, 'progress.md'), 'in progress');

      cleanDir(path.join(claudeDir, 'agents'));

      expect(fs.existsSync(path.join(claudeDir, 'agents'))).toBe(false);
      expect(fs.existsSync(path.join(claudeDir, 'initiatives'))).toBe(true);
      expect(fs.readFileSync(path.join(claudeDir, 'progress.md'), 'utf-8')).toBe('in progress');
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});

describe('compileGeminiTree', () => {
  test('includeAgents: false produces rules + skill + references but no agents/ dir', () => {
    const destRoot = makeTempDir();
    try {
      compileGeminiTree(
        destRoot,
        'plugins/blackhole',
        'plugins/blackhole/rules/blackhole-vcodes.md',
        { includeAgents: false }
      );

      expect(fs.existsSync(path.join(destRoot, 'agents'))).toBe(false);

      for (const rule of ['blackhole-protocol.md', 'blackhole-state.md', 'blackhole-vcodes.md']) {
        expect(fs.existsSync(path.join(destRoot, 'rules', rule))).toBe(true);
      }

      const skillPath = path.join(destRoot, 'skills', 'blackhole', 'SKILL.md');
      expect(fs.existsSync(skillPath)).toBe(true);

      const refsDir = path.join(destRoot, 'skills', 'blackhole', 'references');
      expect(fs.existsSync(refsDir)).toBe(true);
      expect(fs.readdirSync(refsDir).length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});

describe('copyTemplatesDir', () => {
  test('copies all files from templates/companion-files into destRoot, preserving filenames', () => {
    const destRoot = makeTempDir();
    try {
      copyTemplatesDir(destRoot);

      const sourceDir = path.join(root, 'templates', 'companion-files');
      const destDir = path.join(destRoot, 'templates', 'companion-files');
      const sourceFiles = fs.readdirSync(sourceDir).sort();
      const destFiles = fs.readdirSync(destDir).sort();

      expect(destFiles).toEqual(sourceFiles);
      for (const file of sourceFiles) {
        expect(fs.readFileSync(path.join(destDir, file), 'utf-8')).toBe(
          fs.readFileSync(path.join(sourceDir, file), 'utf-8')
        );
      }
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('both compileGeminiTree call-site shapes (workspace and distribution) populate templates/companion-files', () => {
    const workspaceRoot = makeTempDir();
    const distributionRoot = makeTempDir();
    try {
      compileGeminiTree(workspaceRoot, '.agents/build', '.agents/build/rules/blackhole-vcodes.md');
      compileGeminiTree(
        distributionRoot,
        'plugins/blackhole',
        'plugins/blackhole/rules/blackhole-vcodes.md',
        { includeAgents: false }
      );

      const sourceFiles = fs.readdirSync(path.join(root, 'templates', 'companion-files')).sort();
      expect(
        fs.readdirSync(path.join(workspaceRoot, 'templates', 'companion-files')).sort()
      ).toEqual(sourceFiles);
      expect(
        fs.readdirSync(path.join(distributionRoot, 'templates', 'companion-files')).sort()
      ).toEqual(sourceFiles);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      fs.rmSync(distributionRoot, { recursive: true, force: true });
    }
  });
});

describe('writeGeminiManifest', () => {
  test('writes valid JSON matching the input object, creating parent dirs as needed', () => {
    const destRoot = makeTempDir();
    try {
      const destPath = path.join(destRoot, 'nested', 'dir', 'plugin.json');
      const manifest = buildGeminiPluginManifest('9.9.9');

      writeGeminiManifest(destPath, manifest);

      expect(fs.existsSync(destPath)).toBe(true);
      const written = JSON.parse(fs.readFileSync(destPath, 'utf-8'));
      expect(written).toEqual(manifest);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});

describe('buildCodexPluginManifest', () => {
  test('includes required Codex plugin fields', () => {
    const manifest = buildCodexPluginManifest('0.3.0');
    expect(manifest.name).toBe('blackhole');
    expect(manifest.version).toBe('0.3.0');
    expect(manifest.skills).toBe('./codex-skills/');
    expect(manifest.interface?.displayName).toBe('Blackhole');
    expect(manifest.interface?.defaultPrompt?.length).toBeGreaterThan(0);
  });

  test('sources name, description, homepage, repository, and keywords from project-identity.ts', () => {
    const manifest = buildCodexPluginManifest('0.3.0');
    expect(manifest.name).toBe(projectIdentity.name);
    expect(manifest.description).toBe(projectIdentity.description);
    expect(manifest.homepage).toBe(projectIdentity.homepage);
    expect(manifest.repository).toBe(projectIdentity.repository);
    expect(manifest.interface?.websiteURL).toBe(projectIdentity.repository);
    expect(manifest.keywords).toEqual([projectIdentity.name, 'codex', ...projectIdentity.keywordsBase]);
  });
});

describe('buildClaudePluginManifest', () => {
  test('includes required Claude Code plugin fields, sourced from project-identity.ts', () => {
    const manifest = buildClaudePluginManifest('1.2.3');
    expect(manifest.name).toBe(projectIdentity.name);
    expect(manifest.description).toBe(projectIdentity.description);
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.license).toBe('Apache-2.0');
    expect(manifest.keywords).toEqual([projectIdentity.name, 'claude-code', ...projectIdentity.keywordsBase]);
  });
});

describe('buildClaudeMarketplace', () => {
  test('derives name from project-identity.ts and embeds the plugin manifest', () => {
    const pluginMeta = buildClaudePluginManifest('1.2.3');
    const marketplace = buildClaudeMarketplace(pluginMeta);
    expect(marketplace.name).toBe(`${projectIdentity.name}-marketplace`);
    expect(marketplace.plugins[0].name).toBe(projectIdentity.name);
    expect(marketplace.plugins[0].source).toBe('.');
  });
});

describe('buildCodexMarketplace', () => {
  test('uses git source format not Claude owner shape', () => {
    const marketplace = buildCodexMarketplace();
    expect(marketplace.name).toBe('blackhole-codex');
    expect(marketplace.plugins[0].source.source).toBe('git');
    expect(marketplace.plugins[0].source.url).toBe(projectIdentity.repository);
    expect((marketplace as Record<string, unknown>).owner).toBeUndefined();
  });

  test('derives name and plugin name from project-identity.ts', () => {
    const marketplace = buildCodexMarketplace();
    expect(marketplace.name).toBe(`${projectIdentity.name}-codex`);
    expect(marketplace.plugins[0].name).toBe(projectIdentity.name);
  });
});

describe('parseMdFrontmatter', () => {
  test('extracts body after first closing --- only, not markdown horizontal rules', () => {
    const input = `---
name: test-agent
description: A test
---

Opening paragraph.

---

## Section after horizontal rule

More content here.`;
    const { frontmatter, body } = parseMdFrontmatter(input);
    expect(frontmatter).toContain('name: test-agent');
    expect(body).toContain('Opening paragraph.');
    expect(body).toContain('## Section after horizontal rule');
    expect(body).toContain('More content here.');
  });
});

describe('serializeCodexAgentYaml', () => {
  test('omits model when absent from frontmatter', () => {
    const yaml = serializeCodexAgentYaml(
      { name: 'test', description: 'desc', permissionMode: 'default' },
      'body content here'
    );
    expect(yaml).not.toMatch(/^model:/m);
    expect(yaml).not.toContain('model:');
  });

  test('emits model when present in frontmatter', () => {
    const yaml = serializeCodexAgentYaml(
      { name: 'test', description: 'desc', model: 'sonnet', permissionMode: 'default' },
      'body'
    );
    expect(yaml).toContain('model: sonnet');
  });
});

describe('buildCodexAgentYaml', () => {
  const agentDir = 'codex-skills';
  const rulesPath = 'codex-skills/blackhole/references/blackhole-vcodes.md';

  test('preserves frontmatter metadata and compiles codex-only body', () => {
    const yaml = buildCodexAgentYaml(
      `---
name: coordinator
description: test desc
permissionMode: default
disallowedTools: [Write, Edit, Delete]
---

{{#codex}}codex intro{{/codex}}
{{#cursor}}cursor only{{/cursor}}

---

## Section after HR
`,
      agentDir,
      rulesPath
    );
    expect(yaml).toMatch(/^name: coordinator\n/);
    expect(yaml).toContain('description: test desc');
    expect(yaml).not.toMatch(/^model:/m);
    expect(yaml).toContain('permissionMode: default');
    expect(yaml).toContain('disallowedTools:');
    expect(yaml).toContain('  - Write');
    expect(yaml).toContain('codex intro');
    expect(yaml).not.toContain('cursor only');
    expect(yaml).toContain('## Section after HR');
    const instructions = yaml.split('instructions: |\n')[1] ?? '';
    expect(instructions.replace(/^  /gm, '').trim().length).toBeGreaterThan(20);
  });

  test('coordinator source yields full metadata and long instructions', () => {
    const source = fs.readFileSync(path.join(root, 'src/agents/coordinator.md'), 'utf-8');
    const yaml = buildCodexAgentYaml(source, agentDir, rulesPath);
    expect(yaml).toMatch(/^name: coordinator\n/);
    expect(yaml).toContain('description: Multitask Mode coordinator');
    expect(yaml).not.toMatch(/^model:/m);
    expect(yaml).toContain('permissionMode: default');
    expect(yaml).toContain('  - Write');
    const instructions = yaml.split('instructions: |\n')[1] ?? '';
    expect(instructions.replace(/^  /gm, '').trim().length).toBeGreaterThan(200);
    expect(instructions).toContain('Chat Feedback Intake Protocol');
    expect(instructions).toContain('Interrupt & Management Policy');
  });

  test('implementer has empty disallowedTools and full instructions', () => {
    const source = fs.readFileSync(path.join(root, 'src/agents/implementer.md'), 'utf-8');
    const yaml = buildCodexAgentYaml(source, agentDir, rulesPath);

    expect(yaml).toMatch(/^name: implementer\n/);
    expect(yaml).toContain('disallowedTools: []');
    expect(yaml).toContain('5-Field Contract');
    expect(yaml).toContain('Refactoring & Implementation Workflow');
  });
});

describe('generatedMarkerLine', () => {
  test('html style produces the markdown/MDC comment marker', () => {
    expect(generatedMarkerLine('src/SKILL.md', 'html')).toBe(
      '<!-- GENERATED by scripts/build.ts from src/SKILL.md — do not hand-edit -->'
    );
  });

  test('yaml style produces the codex YAML comment marker', () => {
    expect(generatedMarkerLine('src/agents/coordinator.md', 'yaml')).toBe(
      '# GENERATED by scripts/build.ts from src/agents/coordinator.md — do not hand-edit'
    );
  });
});

describe('generated-file marker', () => {
  test('compiled SKILL.md contains the html marker referencing its source', () => {
    const destRoot = makeTempDir();
    try {
      compileGeminiTree(
        destRoot,
        'plugins/blackhole',
        'plugins/blackhole/rules/blackhole-vcodes.md',
        { includeAgents: false }
      );
      const skillContent = fs.readFileSync(
        path.join(destRoot, 'skills', 'blackhole', 'SKILL.md'),
        'utf-8'
      );
      expect(skillContent).toContain(
        '<!-- GENERATED by scripts/build.ts from src/SKILL.md — do not hand-edit -->'
      );
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('compiled rules/blackhole-protocol.md contains the html marker referencing its source', () => {
    const destRoot = makeTempDir();
    try {
      compileGeminiTree(
        destRoot,
        'plugins/blackhole',
        'plugins/blackhole/rules/blackhole-vcodes.md',
        { includeAgents: false }
      );
      const ruleContent = fs.readFileSync(
        path.join(destRoot, 'rules', 'blackhole-protocol.md'),
        'utf-8'
      );
      expect(ruleContent).toContain(
        '<!-- GENERATED by scripts/build.ts from src/references/blackhole-protocol.md — do not hand-edit -->'
      );
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('compiled codex-agents/coordinator.yaml contains the yaml marker and remains valid YAML', () => {
    const destRoot = makeTempDir();
    try {
      compileCodexTree(
        destRoot,
        'codex-skills',
        'codex-skills/blackhole/references/blackhole-vcodes.md'
      );
      const yamlContent = fs.readFileSync(
        path.join(destRoot, 'codex-agents', 'coordinator.yaml'),
        'utf-8'
      );
      expect(yamlContent).toContain(
        '# GENERATED by scripts/build.ts from src/agents/coordinator.md — do not hand-edit'
      );
      expect(yamlContent).toContain('instructions: |');
      expect(yamlContent).toMatch(/^name: coordinator\n/);
      expect(yamlContent).toContain('disallowedTools:');
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('double compileGeminiTree into independent temp dirs is byte-identical (idempotency)', () => {
    const destRootA = makeTempDir();
    const destRootB = makeTempDir();
    try {
      compileGeminiTree(
        destRootA,
        'plugins/blackhole',
        'plugins/blackhole/rules/blackhole-vcodes.md',
        { includeAgents: false }
      );
      compileGeminiTree(
        destRootB,
        'plugins/blackhole',
        'plugins/blackhole/rules/blackhole-vcodes.md',
        { includeAgents: false }
      );
      const contentA = fs.readFileSync(
        path.join(destRootA, 'skills', 'blackhole', 'SKILL.md'),
        'utf-8'
      );
      const contentB = fs.readFileSync(
        path.join(destRootB, 'skills', 'blackhole', 'SKILL.md'),
        'utf-8'
      );
      expect(contentA).toBe(contentB);
    } finally {
      fs.rmSync(destRootA, { recursive: true, force: true });
      fs.rmSync(destRootB, { recursive: true, force: true });
    }
  });

  test('marked .claude-agent-equivalent output still round-trips through parseMdFrontmatter', () => {
    const destRoot = makeTempDir();
    try {
      compileGeminiTree(destRoot, '.agents/build', '.agents/build/rules/blackhole-vcodes.md');
      const agentContent = fs.readFileSync(
        path.join(destRoot, 'agents', 'coordinator.md'),
        'utf-8'
      );
      expect(agentContent).toContain(
        '<!-- GENERATED by scripts/build.ts from src/agents/coordinator.md — do not hand-edit -->'
      );
      const { frontmatter } = parseMdFrontmatter(agentContent);
      expect(frontmatter.length).toBeGreaterThan(0);
      expect(frontmatter).toContain('name: coordinator');
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});
