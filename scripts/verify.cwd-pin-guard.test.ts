import { describe, expect, test } from 'bun:test';
import { findMissingCwdPin, runChecks, sweepTargets } from './checks/cwd-pin-guard.check.ts';

// Regression guard for issue #798: `bun run scripts/<name>.ts` resolves the entry file and every
// transitive relative `./lib/...` import against the process cwd, not against any `--repo-root`
// argument value — so a documented invocation of check-review-artifact.ts,
// carry-staged-artifacts.ts, or scripts/lib/companion-file-sync.ts that omits `--cwd` silently
// runs stale/divergent library code when cwd and --repo-root point at different trees. This pins
// the class (every documented invocation site), not just the three instances fixed in this PR.

describe('findMissingCwdPin', () => {
  test('flags a bare check-review-artifact.ts invocation with no --cwd', () => {
    const bad = 'Mechanical check: `bun run scripts/check-review-artifact.ts --config <abs>`';
    expect(findMissingCwdPin(bad, 'fixture.md')).toEqual(['fixture.md:1']);
  });

  test('does not flag a --cwd-pinned check-review-artifact.ts invocation', () => {
    const good =
      'Mechanical check: `bun run --cwd <abs repo-root> scripts/check-review-artifact.ts --config <abs>`';
    expect(findMissingCwdPin(good, 'fixture.md')).toEqual([]);
  });

  test('flags a bare carry-staged-artifacts.ts invocation with no --cwd', () => {
    const bad = '**Invoke**: `bun run scripts/carry-staged-artifacts.ts --manifest <path>`';
    expect(findMissingCwdPin(bad, 'fixture.md')).toEqual(['fixture.md:1']);
  });

  test('does not flag a --cwd-pinned carry-staged-artifacts.ts invocation', () => {
    const good = '**Invoke**: `bun run --cwd <worktree-abs> scripts/carry-staged-artifacts.ts --manifest <path>`';
    expect(findMissingCwdPin(good, 'fixture.md')).toEqual([]);
  });

  test('flags a bare companion-file-sync.ts invocation in a fenced code block', () => {
    const bad = [
      '```bash',
      'bun run scripts/lib/companion-file-sync.ts --repo-root <worktree-abs> --diff-file <paths.txt>',
      '```',
    ].join('\n');
    expect(findMissingCwdPin(bad, 'fixture.md')).toEqual(['fixture.md:2']);
  });

  test('does not flag a --cwd-pinned companion-file-sync.ts invocation', () => {
    const good = [
      '```bash',
      'bun run --cwd <worktree-abs> scripts/lib/companion-file-sync.ts --repo-root <worktree-abs> --diff-file <paths.txt>',
      '```',
    ].join('\n');
    expect(findMissingCwdPin(good, 'fixture.md')).toEqual([]);
  });

  test('ignores a mention of the script that is not a bun run invocation', () => {
    const mention = 'mechanized by `scripts/carry-staged-artifacts.ts` (issue #715, R-10)';
    expect(findMissingCwdPin(mention, 'fixture.md')).toEqual([]);
  });

  test('ignores a V-code table row prose-describing the scripts by name (not an invocation)', () => {
    // Reproduces this check's own blackhole-vcodes.md row: "bun run" and a target script both
    // appear on the line, but separated by descriptive prose, not a `--cwd` clause.
    const row =
      '| V-CWDPIN-01 | A documented bun run invocation of check-review-artifact.ts, carry-staged-artifacts.ts, or scripts/lib/companion-file-sync.ts omits a --cwd pin | BLOCK | scripts/checks/cwd-pin-guard.check.ts |';
    expect(findMissingCwdPin(row, 'fixture.md')).toEqual([]);
  });
});

describe('cwd-pin-guard runChecks() against the real src/ tree', () => {
  test('returns exactly one V-CWDPIN-01 result', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-CWDPIN-01');
  });

  test('passes against the current tree', () => {
    const [result] = runChecks();
    // On failure, surface which file:line lacks a --cwd pin rather than a bare `false`.
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });
});

describe('cwd-pin-guard sweep scope', () => {
  test('sweeps root src/SKILL.md alongside the src/agents and src/references directories', () => {
    const targets = sweepTargets();
    expect(targets).toContain('src/SKILL.md');
    expect(targets).toContain('src/agents/implementer.md');
    expect(targets).toContain('src/references/companion-file-sync.md');
  });

  test('stays non-recursive — src/references/hunt/*.md is outside the declared scope', () => {
    expect(sweepTargets().some((target) => target.startsWith('src/references/hunt/'))).toBe(false);
  });

  test('flags the bootstrap-scaffold companion-file-sync.ts invocation shape when unpinned', () => {
    const bad = '   `bun run scripts/lib/companion-file-sync.ts --repo-root <path> --upsert-journeys-index` to';
    expect(findMissingCwdPin(bad, 'src/SKILL.md')).toEqual(['src/SKILL.md:1']);
  });

  test('does not flag the bootstrap-scaffold invocation once --cwd matches --repo-root', () => {
    const good =
      '   `bun run --cwd <path> scripts/lib/companion-file-sync.ts --repo-root <path> --upsert-journeys-index` to';
    expect(findMissingCwdPin(good, 'src/SKILL.md')).toEqual([]);
  });
});
