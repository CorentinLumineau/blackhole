import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './checks/check-utils.ts';
import {
  HOOK_BUNDLE_ROOTS,
  REQUIRED_PRETOOLUSE_MATCHERS,
  evaluateHookPatterns,
  evaluateHooksWiring,
  runChecks,
} from './checks/hooks.check.ts';
import { withTempDir } from './lib/test-fixtures.ts';

// Build-pipeline contract for the PreToolUse safety gate (#447). Both redistributable plugin
// bundles must ship a hooks/ tree — a bundle without it installs with zero interception, which is
// exactly the gap this issue closes. Modeled on verify.gemini-build.test.ts / verify.claude-dist
// .test.ts: assert the generated tree on disk, since `bun run build` output is git-tracked.

const readJson = (abs: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>;

describe('shipped hooks/ tree in both plugin bundles', () => {
  for (const bundle of HOOK_BUNDLE_ROOTS) {
    test(`${bundle}/hooks/hooks.json wires PreToolUse for Bash and Write|Edit`, () => {
      const hooksJson = path.join(root, bundle, 'hooks', 'hooks.json');
      expect(fs.existsSync(hooksJson)).toBe(true);

      const parsed = readJson(hooksJson);
      const preToolUse = (parsed.hooks as Record<string, unknown>)?.PreToolUse as
        | { matcher?: string; hooks?: { type?: string; command?: string }[] }[]
        | undefined;
      expect(Array.isArray(preToolUse)).toBe(true);

      const matchers = (preToolUse ?? []).map((entry) => entry.matcher);
      expect(matchers).toContain('Bash');
      expect(matchers).toContain('Write|Edit');

      // Every matcher must actually dispatch to a command that resolves inside the bundle —
      // a matcher with an empty hooks array passes a naive "matcher present" assertion while
      // intercepting nothing.
      for (const entry of preToolUse ?? []) {
        expect(entry.hooks?.length).toBeGreaterThan(0);
        for (const h of entry.hooks ?? []) {
          expect(h.type).toBe('command');
          const scriptName = (h.command ?? '').split('/').pop() ?? '';
          expect(fs.existsSync(path.join(root, bundle, 'hooks', scriptName))).toBe(true);
        }
      }
    });

    test(`${bundle}/hooks/patterns/*.json parse and every entry compiles as a RegExp`, () => {
      const patternsDir = path.join(root, bundle, 'hooks', 'patterns');
      for (const file of ['bash-patterns.json', 'file-patterns.json']) {
        const abs = path.join(patternsDir, file);
        expect(fs.existsSync(abs)).toBe(true);

        const parsed = readJson(abs);
        expect(parsed.version).toBe(1);

        const entries = Object.values(parsed).filter(Array.isArray).flat() as {
          id?: string;
          pattern?: string;
          flags?: string;
          reason?: string;
        }[];
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
          expect(typeof entry.id).toBe('string');
          expect(typeof entry.reason).toBe('string');
          expect(() => new RegExp(entry.pattern as string, entry.flags ?? '')).not.toThrow();
        }
      }
    });
  }
});

// The assertions above pin the shipped trees; these pin the check module that guards them. A
// check whose evaluator silently returns [] for a broken tree passes every green-tree assertion
// while enforcing nothing — so each evaluator is exercised against a deliberately damaged copy.

const withDamagedBundle = (fn: (bundleRoot: string) => void) =>
  withTempDir('blackhole-hooks-check-', (dir) => {
    fs.cpSync(path.join(root, HOOK_BUNDLE_ROOTS[0], 'hooks'), path.join(dir, 'hooks'), {
      recursive: true,
    });
    fn(dir);
  });

describe('hooks.check.ts evaluators', () => {
  test('a correctly built bundle produces no errors from either evaluator', () => {
    const bundle = path.join(root, HOOK_BUNDLE_ROOTS[0]);
    expect(evaluateHooksWiring(bundle, 'fixture')).toEqual([]);
    expect(evaluateHookPatterns(bundle, 'fixture')).toEqual([]);
  });

  test('a missing hooks.json is reported, not silently tolerated', () => {
    withDamagedBundle((bundle) => {
      fs.unlinkSync(path.join(bundle, 'hooks', 'hooks.json'));
      expect(evaluateHooksWiring(bundle, 'fixture')).toEqual(['fixture: missing hooks/hooks.json']);
    });
  });

  test('a hooks.json that drops a required matcher is reported', () => {
    withDamagedBundle((bundle) => {
      const abs = path.join(bundle, 'hooks', 'hooks.json');
      const parsed = JSON.parse(fs.readFileSync(abs, 'utf-8'));
      parsed.hooks.PreToolUse = parsed.hooks.PreToolUse.filter(
        (e: { matcher: string }) => e.matcher !== REQUIRED_PRETOOLUSE_MATCHERS[0],
      );
      fs.writeFileSync(abs, JSON.stringify(parsed));
      const errors = evaluateHooksWiring(bundle, 'fixture');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(REQUIRED_PRETOOLUSE_MATCHERS[0]);
    });
  });

  test('a matcher wired to a nonexistent script is reported', () => {
    withDamagedBundle((bundle) => {
      fs.unlinkSync(path.join(bundle, 'hooks', 'validate-bash-command.js'));
      const errors = evaluateHooksWiring(bundle, 'fixture');
      expect(errors.some((e) => e.includes('validate-bash-command.js'))).toBe(true);
    });
  });

  test('an uncompilable pattern is reported with the offending entry id', () => {
    withDamagedBundle((bundle) => {
      const abs = path.join(bundle, 'hooks', 'patterns', 'bash-patterns.json');
      const parsed = JSON.parse(fs.readFileSync(abs, 'utf-8'));
      parsed.blockPatterns[0].pattern = '([unclosed';
      fs.writeFileSync(abs, JSON.stringify(parsed));
      const errors = evaluateHookPatterns(bundle, 'fixture');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(parsed.blockPatterns[0].id);
    });
  });

  test('an unparseable pattern file is reported rather than throwing', () => {
    withDamagedBundle((bundle) => {
      fs.writeFileSync(path.join(bundle, 'hooks', 'patterns', 'file-patterns.json'), '{ not json');
      const errors = evaluateHookPatterns(bundle, 'fixture');
      expect(errors.some((e) => e.includes('file-patterns.json'))).toBe(true);
    });
  });
});

describe('hooks runChecks() against the real bundles', () => {
  test('returns exactly the two hook check results, both passing', () => {
    const results = runChecks();
    expect(results.map((r) => r.id)).toEqual(['V-HOOKWIRE-01', 'V-HOOKPAT-01']);
    for (const result of results) {
      // Surface which bundle/marker failed rather than a bare `false`.
      expect(result.detail ?? '').toBe('');
      expect(result.ok).toBe(true);
    }
  });
});
