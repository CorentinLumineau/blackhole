import { describe, expect, test } from 'bun:test';
import { expectMarkerContract, expectMarkersSubstantive } from './marker-fixture-test.ts';

const MARKERS = ['gate marker alpha', 'gate marker beta'];

describe('expectMarkerContract', () => {
  test('passes when fixed content has all markers and stale content has none', () => {
    const fixed = 'gate marker alpha and gate marker beta present';
    const stale = 'no gate wording here';
    expect(() => expectMarkerContract(fixed, stale, MARKERS)).not.toThrow();
  });

  test('fails when fixed content is missing a marker', () => {
    const fixed = 'only gate marker alpha';
    const stale = 'no gate wording here';
    expect(() => expectMarkerContract(fixed, stale, MARKERS)).toThrow();
  });
});

describe('expectMarkersSubstantive', () => {
  test('passes for non-empty, trimmed markers longer than 3 chars', () => {
    expect(() => expectMarkersSubstantive(MARKERS)).not.toThrow();
  });

  test('fails for whitespace-only markers', () => {
    expect(() => expectMarkersSubstantive(['   '])).toThrow();
  });
});
