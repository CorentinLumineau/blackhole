import { describe, expect, test } from 'bun:test';
import { hasArgvFlagsAdoptionInContent, hasArgvFlagsImport, runChecks } from './checks/argv-flags-adoption.check.ts';

describe('hasArgvFlagsImport', () => {
  test('detects a single-name import of parseFlags', () => {
    expect(hasArgvFlagsImport('scripts/lib/argv-flags.test.ts')).toBe(true);
  });

  test('returns false for a file with no argv-flags import at all', () => {
    expect(hasArgvFlagsImport('scripts/lib/argv-flags.ts')).toBe(false);
  });

  test('returns false for the deliberately non-migrated seed', () => {
    expect(hasArgvFlagsImport('scripts/stack-repair.ts')).toBe(false);
  });
});

describe('hasArgvFlagsAdoptionInContent', () => {
  test('true when both an import and a call are present', () => {
    const content = `import { parseFlags } from './lib/argv-flags.ts';\nconst flags = parseFlags(argv);\n`;
    expect(hasArgvFlagsAdoptionInContent(content)).toBe(true);
  });

  // The future-drift hole this content-level split closes: a file that imports the module but
  // never actually calls it (keeps its own pre-existing hand-rolled loop) must not pass.
  test('false when the import is present but neither function is ever called', () => {
    const content = [
      "import { parseFlags, requireFlag } from './lib/argv-flags.ts';",
      "function parseArgs(argv: string[]) {",
      "  const flags: Record<string, string> = {};",
      "  for (let i = 0; i < argv.length; i++) {",
      "    if (argv[i] === '--x' && argv[i + 1]) flags.x = argv[++i];",
      "  }",
      "  return flags;",
      "}",
    ].join('\n');
    expect(hasArgvFlagsAdoptionInContent(content)).toBe(false);
  });

  test('false when a call is present but the import is missing', () => {
    const content = `const flags = parseFlags(argv);\n`;
    expect(hasArgvFlagsAdoptionInContent(content)).toBe(false);
  });
});

describe('argv-flags-adoption runChecks() against the real src/ tree', () => {
  test('returns exactly one V-ARGV-01 result', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-ARGV-01');
  });

  test('passes against the current tree — all 15 target scripts import the shared primitive', () => {
    const [result] = runChecks();
    // On failure, surface which files still lack the import rather than a bare `false`.
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });
});
