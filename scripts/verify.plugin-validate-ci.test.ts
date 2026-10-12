import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Pins the Claude Code plugin-validate CI step: `--strict` on `.` and the marketplace bundle,
// plus `claude plugin test` only when a tests/ tree exists. The step must run on pull_request
// (GitHub-hosted installs the CLI; self-hosted already has it).
// Resolves paths via this file's dirname so the test is not a check-utils consumer
// (V-BLASTRADIUS-01).

const REPO = path.join(import.meta.dirname, '..');
const WORKFLOW = path.join(REPO, '.github', 'workflows', 'verify.yml');
const ROOT_AGENTS = path.join(REPO, 'agents');

describe('verify.yml Claude plugin validate step', () => {
  const yaml = fs.readFileSync(WORKFLOW, 'utf-8');

  test('runs claude plugin validate --strict against the repo root and the marketplace bundle', () => {
    expect(yaml).toContain('claude plugin validate --strict .');
    expect(yaml).toContain('claude plugin validate --strict plugins/blackhole-claude');
  });

  test('runs on pull_request: not gated to push/self-hosted, installs CLI on GitHub-hosted', () => {
    expect(yaml).toContain('name: Validate Claude plugin (strict)');
    expect(yaml).toContain('name: Setup Claude Code CLI');
    expect(yaml).toMatch(/if:\s*runner\.environment != 'self-hosted'/);
    expect(yaml).not.toMatch(/if:\s*github\.event_name == 'push' \|\| runner\.environment == 'self-hosted'/);
  });

  test('invokes claude plugin test only when a tests/ tree exists', () => {
    expect(yaml).toMatch(/if \[ -d plugins\/blackhole-claude\/tests \] \|\| \[ -d tests \]/);
    expect(yaml).toContain('claude plugin test');
  });
});

describe('plugin-validate surface at repo root', () => {
  test('project CLAUDE.md lives under .claude/ not the plugin root', () => {
    expect(fs.existsSync(path.join(REPO, 'CLAUDE.md'))).toBe(false);
    expect(fs.existsSync(path.join(REPO, '.claude', 'CLAUDE.md'))).toBe(true);
  });

  test('skills.sh agents carry YAML frontmatter (name + description)', () => {
    const files = fs.readdirSync(ROOT_AGENTS).filter((f) => f.endsWith('.md')).sort();
    expect(files).toEqual([
      'coordinator.md',
      'hunter.md',
      'implementer.md',
      'investigator.md',
      'orchestrator.md',
      'planner.md',
      'reviewer.md',
      'router.md',
    ]);
    for (const file of files) {
      const text = fs.readFileSync(path.join(ROOT_AGENTS, file), 'utf-8');
      expect(text.startsWith('---\n'), file).toBe(true);
      expect(text, file).toContain('name:');
      expect(text, file).toContain('description:');
    }
  });
});

describe('plugin-validate surface at plugins/blackhole-claude', () => {
  const bundle = path.join(REPO, 'plugins', 'blackhole-claude');

  test('compiled SKILL.md keeps YAML frontmatter (name + description)', () => {
    const skill = fs.readFileSync(path.join(bundle, 'skills', 'blackhole', 'SKILL.md'), 'utf-8');
    expect(skill.startsWith('---\n')).toBe(true);
    expect(skill).toContain('name: blackhole');
    expect(skill).toContain('description:');
  });

  test('PreToolUse commands quote ${CLAUDE_PLUGIN_ROOT}', () => {
    const ssot = JSON.parse(
      fs.readFileSync(path.join(REPO, 'templates', 'hooks', 'pretooluse', 'hooks.json'), 'utf-8'),
    ) as { hooks: { PreToolUse: { hooks: { command: string }[] }[] } };
    for (const entry of ssot.hooks.PreToolUse) {
      for (const h of entry.hooks) {
        expect(h.command).toMatch(/^bun run "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[^"]+"$/);
      }
    }
  });
});
