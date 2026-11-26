import { describe, expect, test } from 'bun:test';
import { findMalformedIssueTriggers, malformedTriggerDetail, parseReviewTrigger } from './review-trigger-grammar.ts';

describe('parseReviewTrigger', () => {
  test('exact form parses to the issue number, quoted or bare', () => {
    expect(parseReviewTrigger('on issue-close #1391')).toEqual({ kind: 'issue-close', issue: 1391 });
    expect(parseReviewTrigger('"on issue-close #12"')).toEqual({ kind: 'issue-close', issue: 12 });
  });

  test('free-text issue-keyed values are malformed', () => {
    expect(parseReviewTrigger('"when #5228 closes"').kind).toBe('malformed');
    expect(parseReviewTrigger('"on merge of the issue #4047 PR"').kind).toBe('malformed');
    expect(parseReviewTrigger('on issue-close #12 today').kind).toBe('malformed');
  });

  test('enum and free text without an issue reference are opaque', () => {
    for (const v of ['on file change', '"on release"', 'quarterly', '', 'on merge of the PR implementing this plan'])
      expect(parseReviewTrigger(v).kind).toBe('opaque');
  });
});

describe('findMalformedIssueTriggers', () => {
  test('reports only malformed docs, in input order', () => {
    const docs = [
      { relPath: 'plans/a.md', reviewTrigger: '"when #5228 closes"' },
      { relPath: 'plans/b.md', reviewTrigger: 'on issue-close #7' },
      { relPath: 'plans/c.md', reviewTrigger: 'on file change' },
      { relPath: 'plans/d.md', reviewTrigger: '"on merge of the issue #4047 PR"' },
    ];
    expect(findMalformedIssueTriggers(docs)).toEqual(['plans/a.md', 'plans/d.md']);
  });
});

describe('malformedTriggerDetail', () => {
  test('names only the malformed docs, undefined when clean', () => {
    const docs = [
      { relPath: 'a.md', fm: { review_trigger: 'when #5 closes' } },
      { relPath: 'b.md', fm: { review_trigger: 'on issue-close #5' } },
      { relPath: 'c.md', fm: {} },
    ];
    expect(malformedTriggerDetail(docs)).toBe('review_trigger not in grammar (use "on issue-close #N"): a.md');
    expect(malformedTriggerDetail(docs.slice(1))).toBeUndefined();
  });
});
