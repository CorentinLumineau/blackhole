import { describe, expect, test } from 'bun:test';
import { applyPlatformConditionals, compileContent, buildGeminiPluginManifest } from './build.ts';

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
