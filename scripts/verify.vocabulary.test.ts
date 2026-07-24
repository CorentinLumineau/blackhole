import { describe, expect, test } from 'bun:test';
import {
  VOCAB_REGISTRY,
  findVocabMismatch,
  extractQueueStatuses,
  extractQueueNotes,
  extractHuntKinds,
  extractPlatformTargets,
} from './checks/vocabulary.check.ts';

// ADR-007 T5/R2' style: pure extraction/comparison functions tested against synthetic string
// fixtures — no real filesystem reads (real-repo scanning is exercised by `bun run verify` /
// CI itself). Issue #320: generalized V-VOCAB-01 registry-driven check.

describe('findVocabMismatch', () => {
  test('all scanned values declared returns null', () => {
    expect(findVocabMismatch(['a', 'b'], ['a', 'b', 'c'])).toBeNull();
  });

  test('one undeclared scanned value returns a message naming it', () => {
    const result = findVocabMismatch(['a', 'z'], ['a', 'b']);
    expect(result).not.toBeNull();
    expect(result).toContain('z');
  });

  test('case-insensitive comparison ignores case differences', () => {
    expect(findVocabMismatch(['Accepted', 'current'], ['accepted', 'current'], true)).toBeNull();
  });

  test('case-sensitive by default: differing case is reported as a mismatch', () => {
    expect(findVocabMismatch(['Accepted'], ['accepted'])).not.toBeNull();
  });

  test('duplicate scanned values are deduped in the report', () => {
    const result = findVocabMismatch(['z', 'z', 'z'], ['a']);
    const occurrences = (result ?? '').split('z').length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('extractQueueStatuses', () => {
  test('extracts a status value from a line mentioning both phase and status', () => {
    expect(extractQueueStatuses('- Parent issue: set `status: blocked`, `phase: handle`.')).toEqual(['blocked']);
  });

  test('ignores a status mention on a line without phase context', () => {
    expect(extractQueueStatuses('Return `status: complete` in the worker JSON.')).toEqual([]);
  });

  test('an undeclared status value is still extracted (mismatch is the caller\'s job)', () => {
    expect(extractQueueStatuses('`phase: handle`, `status: cancelled`')).toEqual(['cancelled']);
  });
});

describe('extractQueueNotes', () => {
  test('extracts an awaiting-* token after notes:', () => {
    expect(extractQueueNotes('Set `status: blocked`, `notes: awaiting-plan-approval` in queue.json.')).toEqual([
      'awaiting-plan-approval',
    ]);
  });

  test('does not match open-ended parameterized notes text', () => {
    expect(extractQueueNotes('notes: overlap with #301')).toEqual([]);
  });

  test('an undeclared awaiting-* token is still extracted', () => {
    expect(extractQueueNotes('notes: "awaiting-something-new"')).toEqual(['awaiting-something-new']);
  });
});

describe('extractHuntKinds', () => {
  test('extracts every quoted token from a "kinds": [...] JSON array', () => {
    expect(extractHuntKinds('"kaizen": { "kinds": ["quickwins", "bug"], "trigger": "on-empty" }')).toEqual([
      'quickwins',
      'bug',
    ]);
  });

  test('returns empty when no kinds array is present', () => {
    expect(extractHuntKinds('one of `kaizen.kinds` (e.g. `quickwins`, `bug`)')).toEqual([]);
  });
});

describe('extractPlatformTargets', () => {
  test('extracts every quoted token from an array literal anchored by cursor', () => {
    expect(extractPlatformTargets(`['cursor', 'claude', 'skills', 'gemini', 'codex']`)).toEqual([
      'cursor',
      'claude',
      'skills',
      'gemini',
      'codex',
    ]);
  });

  test('an array literal without cursor is not treated as a target-name array', () => {
    expect(extractPlatformTargets(`['foo', 'bar']`)).toEqual([]);
  });

  test('an undeclared token in a cursor-anchored array is still extracted', () => {
    expect(extractPlatformTargets(`['cursor', 'newplatform']`)).toEqual(['cursor', 'newplatform']);
  });
});

describe('VOCAB_REGISTRY', () => {
  // ADR status was removed in fix round 1 (PR #339 review) — issue #324 (PR #338) already owns
  // that concern with a purpose-built, more rigorous check. 4 entries, not 5.
  test('has exactly 4 entries, one per named vocabulary', () => {
    expect(VOCAB_REGISTRY).toHaveLength(4);
    expect(VOCAB_REGISTRY.map((v) => v.name).sort()).toEqual(
      ['kaizen kinds', 'platform targets', 'queue notes', 'queue status'].sort(),
    );
  });
});
