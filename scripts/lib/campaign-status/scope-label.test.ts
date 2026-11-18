import { describe, expect, test } from 'bun:test';
import { formatScopeLabel } from './scope-label.ts';

describe('formatScopeLabel', () => {
  test('an unrecorded scope reads "all open issues" in both styles', () => {
    expect(formatScopeLabel({}, 'plain')).toBe('all open issues');
    expect(formatScopeLabel({ milestone: null, labels: [] }, 'markdown')).toBe('all open issues');
    expect(formatScopeLabel(undefined)).toBe('all open issues');
  });

  test('plain style names the milestone, the labels, or both', () => {
    expect(formatScopeLabel({ milestone: 'v2' }, 'plain')).toBe('milestone v2');
    expect(formatScopeLabel({ labels: ['a', 'b'] }, 'plain')).toBe('labels a, b');
    expect(formatScopeLabel({ milestone: 'v2', labels: ['a', 'b'] }, 'plain')).toBe('milestone v2 and labels a, b');
  });

  test('markdown style bolds the milestone and backticks each label', () => {
    expect(formatScopeLabel({ milestone: 'v2', labels: [] }, 'markdown')).toBe('milestone **v2**');
    expect(formatScopeLabel({ labels: ['a', 'b'] }, 'markdown')).toBe('labels `a`, `b`');
    expect(formatScopeLabel({ milestone: 'v2', labels: ['a'] }, 'markdown')).toBe('milestone **v2** and labels `a`');
  });
});
