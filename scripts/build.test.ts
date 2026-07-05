import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  applyPlatformConditionals,
  compileContent,
  buildGeminiPluginManifest,
  buildCodexPluginManifest,
  buildCodexMarketplace,
  parseMdFrontmatter,
  buildCodexAgentYaml,
} from './build.ts';

const root = path.resolve(import.meta.dirname, '..');

describe('parseMdFrontmatter', () => {
  test('body preserves markdown horizontal rules after frontmatter', () => {
    const content = `---
name: test-agent
model: sonnet
---

## Section One

---

## Section Two
`;
    const { frontmatter, body } = parseMdFrontmatter(content);
    expect(frontmatter).toContain('name: test-agent');
    expect(body).toContain('## Section One');
    expect(body).toContain('## Section Two');
  });
});

describe('buildCodexAgentYaml', () => {
  const agentDir = 'codex-skills';
  const rulesPath = 'codex-skills/bc-campaign/references/bc-campaign-vcodes.md';

  test('preserves frontmatter metadata and compiles codex-only body', () => {
    const yaml = buildCodexAgentYaml(
      `---
name: bc-coordinator
description: test desc
model: sonnet
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
    expect(yaml).toMatch(/^name: bc-coordinator\n/);
    expect(yaml).toContain('description: test desc');
    expect(yaml).toContain('model: sonnet');
    expect(yaml).toContain('permissionMode: default');
    expect(yaml).toContain('disallowedTools:');
    expect(yaml).toContain('  - Write');
    expect(yaml).toContain('codex intro');
    expect(yaml).not.toContain('cursor only');
    expect(yaml).toContain('## Section after HR');
    const instructions = yaml.split('instructions: |\n')[1] ?? '';
    expect(instructions.replace(/^  /gm, '').trim().length).toBeGreaterThan(20);
  });

  test('bc-coordinator source yields full metadata and long instructions', () => {
    const source = fs.readFileSync(path.join(root, 'src/agents/bc-coordinator.md'), 'utf-8');
    const yaml = buildCodexAgentYaml(source, agentDir, rulesPath);
    expect(yaml).toMatch(/^name: bc-coordinator\n/);
    expect(yaml).toContain('description: Multitask Mode coordinator');
    expect(yaml).toContain('model: sonnet');
    expect(yaml).toContain('permissionMode: default');
    expect(yaml).toContain('  - Write');
    const instructions = yaml.split('instructions: |\n')[1] ?? '';
    expect(instructions.replace(/^  /gm, '').trim().length).toBeGreaterThan(200);
    expect(instructions).toContain('Chat Feedback Intake Protocol');
    expect(instructions).toContain('Interrupt & Management Policy');
  });

  test('implementer has empty disallowedTools and full instructions', () => {
    const source = fs.readFileSync(path.join(root, 'src/agents/bc-implementer.md'), 'utf-8');
    const yaml = buildCodexAgentYaml(source, agentDir, rulesPath);
    expect(yaml).toMatch(/^name: bc-implementer\n/);
    expect(yaml).toContain('disallowedTools: []');
    expect(yaml).toContain('5-Field Contract');
    expect(yaml).toContain('Refactoring & Implementation Workflow');
  });
});

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
      'plugins/backlog-campaign',
      'plugins/backlog-campaign/rules/bc-campaign-vcodes.md',
      'gemini'
    );
    expect(result).toBe(
      'dir=plugins/backlog-campaign vcodes=plugins/backlog-campaign/rules/bc-campaign-vcodes.md'
    );
  });

  test('substitutes workspace paths for .agents layout', () => {
    const result = compileContent(
      'dir={{AGENT_DIR}} vcodes={{VCODES_PATH}}',
      '.agents',
      '.agents/rules/bc-campaign-vcodes.md',
      'gemini'
    );
    expect(result).toBe('dir=.agents vcodes=.agents/rules/bc-campaign-vcodes.md');
  });
});

describe('buildGeminiPluginManifest', () => {
  test('includes required Antigravity schema fields', () => {
    const manifest = buildGeminiPluginManifest('1.2.3');
    expect(manifest.$schema).toBe('https://antigravity.google/schemas/v1/plugin.json');
    expect(manifest.name).toBe('backlog-campaign');
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.description).toContain('backlog campaign');
  });
});

describe('buildCodexPluginManifest', () => {
  test('includes required Codex plugin fields', () => {
    const manifest = buildCodexPluginManifest('0.3.0');
    expect(manifest.name).toBe('bc-campaign');
    expect(manifest.version).toBe('0.3.0');
    expect(manifest.skills).toBe('./codex-skills/');
    expect(manifest.interface?.displayName).toBe('Backlog Campaign');
    expect(manifest.interface?.defaultPrompt?.length).toBeGreaterThan(0);
  });
});

describe('buildCodexMarketplace', () => {
  test('uses git source format not Claude owner shape', () => {
    const marketplace = buildCodexMarketplace();
    expect(marketplace.name).toBe('bc-campaign-codex');
    expect(marketplace.plugins[0].source.source).toBe('git');
    expect(marketplace.plugins[0].source.url).toContain('github.com');
    expect((marketplace as Record<string, unknown>).owner).toBeUndefined();
  });
});
