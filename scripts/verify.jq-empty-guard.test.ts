import { describe, expect, test } from 'bun:test';
import { findBareJqEmptyPrescriptions, runChecks } from './checks/jq-empty-guard.check.ts';

// Regression guard for issue #558: `jq empty` has been hand-fixed three times (#536, #546, #553)
// with nothing stopping a fourth reintroduction — this pins the class, not just the instance.

describe('findBareJqEmptyPrescriptions', () => {
  test('flags a bare prescription with no negation in the window', () => {
    const bad = 'Validate the `.tmp` file with `jq empty` before installing it.';
    expect(findBareJqEmptyPrescriptions(bad, 'fixture.md')).toEqual(['fixture.md:1']);
  });

  test('does not flag a same-line negated mention', () => {
    const good = '`jq empty` alone is never sufficient to tell the two apart.';
    expect(findBareJqEmptyPrescriptions(good, 'fixture.md')).toEqual([]);
  });

  test('does not flag a mention whose negation sits 4 lines away in the window', () => {
    // Reproduces blackhole-state.md's real shape: "never sufficient" anchors the paragraph,
    // then a later sentence re-mentions `jq empty` without repeating the negation inline.
    const spaced = [
      '`jq empty <file>` is never sufficient as a write guard on its own — do not reintroduce it.',
      'It exits 0 on a zero-byte file: it detects malformed JSON, not absent JSON.',
      'Issue #489 traced a real incident to exactly this gap — a heredoc-authored `jq` program',
      'failed to compile, the shell redirect had already truncated the `.tmp` file to 0 bytes',
      '`jq empty` on that 0-byte file exited 0, and the empty file was atomically installed.',
    ].join('\n');
    expect(findBareJqEmptyPrescriptions(spaced, 'fixture.md')).toEqual([]);
  });
});

describe('jq-empty-guard runChecks() against the real src/ tree', () => {
  test('returns exactly one V-JQEMPTY-01 result', () => {
    const results = runChecks();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('V-JQEMPTY-01');
  });

  test('passes against the current tree', () => {
    const [result] = runChecks();
    // On failure, surface which file:line lacks a negation rather than a bare `false`.
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });
});
