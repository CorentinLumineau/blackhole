import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './checks/check-utils.ts';
import {
  HOOK_BUNDLE_ROOTS,
  REQUIRED_PATTERN_KEYS,
  REQUIRED_PRETOOLUSE_MATCHERS,
  REQUIRED_PRETOOLUSE_ON_FAILURE,
  evaluateHookPatterns,
  evaluateHooksWiring,
  runChecks,
} from './checks/hooks.check.ts';
import { PRETOOLUSE_HOOKS_DIR, runPreToolUseHook, withTempDir, withTempGitRepo } from './lib/test-fixtures.ts';

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
        | { matcher?: string; hooks?: { type?: string; command?: string; onFailure?: string }[] }[]
        | undefined;
      expect(Array.isArray(preToolUse)).toBe(true);

      const matchers = (preToolUse ?? []).map((entry) => entry.matcher);
      expect(matchers).toContain('Bash');
      expect(matchers).toContain('Write|Edit');

      // Every matcher must actually dispatch to a command that resolves inside the bundle —
      // a matcher with an empty hooks array passes a naive "matcher present" assertion while
      // intercepting nothing. onFailure: "block" (Claude Code ≥2.1.295) is what makes a
      // missing bun, a crash, or the 5s timeout refuse the tool call instead of failing open.
      for (const entry of preToolUse ?? []) {
        expect(entry.hooks?.length).toBeGreaterThan(0);
        for (const h of entry.hooks ?? []) {
          expect(h.type).toBe('command');
          expect(h.onFailure).toBe(REQUIRED_PRETOOLUSE_ON_FAILURE);
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

  test('a PreToolUse command hook missing onFailure: block is reported', () => {
    withDamagedBundle((bundle) => {
      const abs = path.join(bundle, 'hooks', 'hooks.json');
      const parsed = JSON.parse(fs.readFileSync(abs, 'utf-8'));
      for (const entry of parsed.hooks.PreToolUse) {
        for (const h of entry.hooks) delete h.onFailure;
      }
      fs.writeFileSync(abs, JSON.stringify(parsed));
      const errors = evaluateHooksWiring(bundle, 'fixture');
      expect(errors.some((e) => e.includes('onFailure'))).toBe(true);
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

  // F-00050 (review round 1): the pre-fix evaluator flattened `Object.values().filter(Array
  // .isArray)` — any array-valued top-level key, not specifically the required ones — so renaming
  // or dropping a required key (e.g. `blockPatterns` -> `blockedPatterns`) still found *some*
  // array to validate and reported zero errors on a bundle whose loader would actually throw at
  // runtime.
  test('a pattern file with a renamed required key is reported, not silently skipped', () => {
    withDamagedBundle((bundle) => {
      const abs = path.join(bundle, 'hooks', 'patterns', 'bash-patterns.json');
      const parsed = JSON.parse(fs.readFileSync(abs, 'utf-8'));
      parsed.blockedPatterns = parsed.blockPatterns;
      delete parsed.blockPatterns;
      fs.writeFileSync(abs, JSON.stringify(parsed));
      const errors = evaluateHookPatterns(bundle, 'fixture');
      expect(errors.some((e) => e.includes('blockPatterns'))).toBe(true);
    });
  });

  // F-00050 (review round 1): `new RegExp(entry.pattern as string, ...)` lied to the type checker
  // — at runtime, `new RegExp(undefined)` compiles to `/(?:)/` (matches everything) without
  // throwing, so an entry missing `pattern` entirely passed with zero static errors.
  test('a pattern entry missing "pattern" is reported, not silently compiled as match-all', () => {
    withDamagedBundle((bundle) => {
      const abs = path.join(bundle, 'hooks', 'patterns', 'bash-patterns.json');
      const parsed = JSON.parse(fs.readFileSync(abs, 'utf-8'));
      delete parsed.blockPatterns[0].pattern;
      fs.writeFileSync(abs, JSON.stringify(parsed));
      const errors = evaluateHookPatterns(bundle, 'fixture');
      expect(errors.some((e) => e.includes(parsed.blockPatterns[0].id) && e.includes('pattern'))).toBe(true);
    });
  });

  test('REQUIRED_PATTERN_KEYS covers both shipped pattern files', () => {
    expect(Object.keys(REQUIRED_PATTERN_KEYS).sort()).toEqual(['bash-patterns.json', 'file-patterns.json']);
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

describe('PreToolUse fail-closed contract (onFailure: block)', () => {
  const templateHooks = JSON.parse(
    fs.readFileSync(path.join(root, 'templates', 'hooks', 'pretooluse', 'hooks.json'), 'utf-8'),
  ) as {
    hooks: { PreToolUse: { matcher: string; hooks: { timeout?: number; onFailure?: string }[] }[] };
  };

  test('SSOT template pins timeout: 5 and onFailure: block on every PreToolUse command hook', () => {
    expect(templateHooks.hooks.PreToolUse.length).toBeGreaterThan(0);
    for (const entry of templateHooks.hooks.PreToolUse) {
      for (const h of entry.hooks) {
        expect(h.timeout).toBe(5);
        expect(h.onFailure).toBe(REQUIRED_PRETOOLUSE_ON_FAILURE);
      }
    }
  });

  test('validator exit 2 (deliberate deny) is a blocking PreToolUse outcome', async () => {
    await withTempGitRepo('blackhole-hook-onfailure-', async (repo) => {
      const result = await runPreToolUseHook(
        'validate-bash-command.js',
        { tool_name: 'Bash', tool_input: { command: 'rm -rf /' }, tool_use_id: 'toolu_onfailure' },
        repo,
        PRETOOLUSE_HOOKS_DIR,
      );
      expect(result.exitCode).toBe(2);
    });
  });

  test('timeout is a blocking outcome via the same onFailure: block + timeout: 5 pair', () => {
    // Claude Code's harness (v2.1.295+) treats a timed-out command hook as a failure, then
    // applies onFailure. We cannot spawn that harness here; the pair above is the shipped
    // contract that makes a 5s stall refuse the tool call instead of failing open.
    for (const entry of templateHooks.hooks.PreToolUse) {
      for (const h of entry.hooks) {
        expect(h.timeout).toBe(5);
        expect(h.onFailure).toBe('block');
      }
    }
  });
});
