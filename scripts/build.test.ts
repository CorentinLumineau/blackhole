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
  writeGeminiManifest,
  assertDistributionTree,
} from './build.ts';

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

describe('assertDistributionTree', () => {
  const populateFixtureTree = (destRoot: string) => {
    compileGeminiTree(
      destRoot,
      'plugins/blackhole',
      'plugins/blackhole/rules/blackhole-vcodes.md',
      { includeAgents: false }
    );
    writeGeminiManifest(path.join(destRoot, 'plugin.json'), buildGeminiPluginManifest('1.0.0'));
  };

  test('passes (returns void, no throw) on a fully-populated fixture tree', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      expect(() => assertDistributionTree(destRoot)).not.toThrow();
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('throws when rules/ has fewer than 3 recognized rule files', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'rules', 'blackhole-state.md'));
      expect(() => assertDistributionTree(destRoot)).toThrow();
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('throws when skills/blackhole/SKILL.md is missing', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'skills', 'blackhole', 'SKILL.md'));
      expect(() => assertDistributionTree(destRoot)).toThrow();
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('throws when plugin.json is missing at destRoot', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'plugin.json'));
      expect(() => assertDistributionTree(destRoot)).toThrow();
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
});

describe('buildCodexMarketplace', () => {
  test('uses git source format not Claude owner shape', () => {
    const marketplace = buildCodexMarketplace();
    expect(marketplace.name).toBe('blackhole-codex');
    expect(marketplace.plugins[0].source.source).toBe('git');
    expect(marketplace.plugins[0].source.url).toContain('github.com');
    expect((marketplace as Record<string, unknown>).owner).toBeUndefined();
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
