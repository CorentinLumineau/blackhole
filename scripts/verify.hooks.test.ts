import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './checks/check-utils.ts';
import { RETIRED_GUARD_SCRIPTS, evaluateNoBlockingHooks, evaluateSensitiveFilePatterns } from './checks/hooks.check.ts';
import { CLAUDE_DISTRIBUTION_ROOT, CLAUDE_NATIVE_ROOT } from './lib/build/paths.ts';
import { withTempDir } from './lib/test-fixtures.ts';

// ADR-065 contract: no built tree registers a deny-capable hook. The first describe pins the
// evaluator against synthetic trees (it must fail when a guard comes back); the second pins the
// committed build output the evaluator reads.

const write = (dir: string, rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};

describe('evaluateNoBlockingHooks', () => {
  test('a hooks.json registering PreToolUse in a built tree is reported', () => {
    withTempDir('noguard-pre', (dir) => {
      write(dir, '.agents/build/hooks/hooks.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [] }] } }));
      const errors = evaluateNoBlockingHooks(dir);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('.agents/build/hooks/hooks.json');
      expect(errors[0]).toContain('PreToolUse');
    });
  });

  test('a native-tree hooks.json registering PreToolUse is reported, case-insensitively', () => {
    withTempDir('noguard-native', (dir) => {
      write(dir, `${CLAUDE_NATIVE_ROOT}/hooks/hooks.json`, JSON.stringify({ hooks: { preToolUse: [{}] } }));
      expect(evaluateNoBlockingHooks(dir)).toHaveLength(1);
    });
  });

  test('maintainer state under .claude/ outside the generated dirs is not walked', () => {
    withTempDir('noguard-state', (dir) => {
      write(dir, `${CLAUDE_NATIVE_ROOT}/worktrees/old/hooks/hooks.json`, JSON.stringify({ hooks: { PreToolUse: [{}] } }));
      write(dir, `${CLAUDE_NATIVE_ROOT}/settings.json`, JSON.stringify({ hooks: { PreToolUse: [{}] } }));
      expect(evaluateNoBlockingHooks(dir)).toEqual([]);
    });
  });

  test('a retired validator script anywhere in a built tree is reported', () => {
    withTempDir('noguard-script', (dir) => {
      for (const script of RETIRED_GUARD_SCRIPTS) write(dir, `${CLAUDE_DISTRIBUTION_ROOT}/hooks/${script}`, '// guard');
      expect(evaluateNoBlockingHooks(dir)).toHaveLength(RETIRED_GUARD_SCRIPTS.length);
    });
  });

  test('a SessionStart-only hooks.json passes', () => {
    withTempDir('noguard-clean', (dir) => {
      write(dir, `${CLAUDE_DISTRIBUTION_ROOT}/hooks/hooks.json`, JSON.stringify({ hooks: { SessionStart: [{ hooks: [] }] } }));
      expect(evaluateNoBlockingHooks(dir)).toEqual([]);
    });
  });

  test('an unparseable registry file is an error, never a silent pass', () => {
    withTempDir('noguard-bad-json', (dir) => {
      write(dir, `${CLAUDE_DISTRIBUTION_ROOT}/hooks/hooks.json`, '{ not json');
      expect(evaluateNoBlockingHooks(dir)[0]).toContain('invalid JSON');
    });
  });
});

describe('evaluateSensitiveFilePatterns', () => {
  const patternsAt = (dir: string, body: unknown) =>
    write(dir, `${CLAUDE_DISTRIBUTION_ROOT}/hooks/patterns/file-patterns.json`, JSON.stringify(body));

  test('a well-formed file passes', () => {
    withTempDir('patterns-ok', (dir) => {
      patternsAt(dir, { version: 1, sensitiveFiles: [{ id: 'env', pattern: '(^|/)\\.env$', flags: 'i', reason: 'env file' }] });
      expect(evaluateSensitiveFilePatterns(dir)).toEqual([]);
    });
  });

  test('a pattern that does not compile, a wrong version and an empty list are each reported', () => {
    withTempDir('patterns-bad', (dir) => {
      patternsAt(dir, { version: 2, sensitiveFiles: [{ id: 'x', pattern: '(', reason: 'r' }] });
      const errors = evaluateSensitiveFilePatterns(dir);
      expect(errors.some((e) => e.includes('does not compile'))).toBe(true);
      expect(errors.some((e) => e.includes('unsupported schema version'))).toBe(true);
      patternsAt(dir, { version: 1, sensitiveFiles: [] });
      expect(evaluateSensitiveFilePatterns(dir).some((e) => e.includes('sensitiveFiles'))).toBe(true);
    });
  });
});

describe('committed build output', () => {
  test('no built tree registers PreToolUse or ships a retired guard validator', () => {
    expect(evaluateNoBlockingHooks(root)).toEqual([]);
  });

  test('the shipped sensitive-filename pattern data parses and compiles in every tree that carries it', () => {
    expect(evaluateSensitiveFilePatterns(root)).toEqual([]);
    expect(fs.existsSync(path.join(root, CLAUDE_DISTRIBUTION_ROOT, 'hooks', 'patterns', 'file-patterns.json'))).toBe(true);
  });

  test('the Claude marketplace bundle keeps the SessionStart plugin-root export and nothing else', () => {
    const hooks = JSON.parse(fs.readFileSync(path.join(root, CLAUDE_DISTRIBUTION_ROOT, 'hooks', 'hooks.json'), 'utf-8')) as {
      hooks: Record<string, unknown[]>;
    };
    expect(Object.keys(hooks.hooks)).toEqual(['SessionStart']);
    expect(JSON.stringify(hooks.hooks.SessionStart)).toContain('BLACKHOLE_PLUGIN_ROOT');
  });
});
