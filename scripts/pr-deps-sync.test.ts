import { describe, expect, test } from 'bun:test';
import { bodyOnlyNotice } from './pr-deps-sync.ts';

describe('bodyOnlyNotice', () => {
  test('names every issue whose forge has no native dependency feature', () => {
    expect(bodyOnlyNotice([{ issue: 4, native: false }, { issue: 7, native: true }, { issue: 9, native: false }])).toBe(
      'no native dependency feature (HTTP 404/410) for #4, #9: their edges are PR-body lines',
    );
  });

  test('says nothing when every row is native', () => {
    expect(bodyOnlyNotice([{ issue: 4, native: true }])).toBeNull();
    expect(bodyOnlyNotice([])).toBeNull();
  });
});
