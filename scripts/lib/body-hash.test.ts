import { describe, expect, test } from 'bun:test';
import { computeBodyHash } from './body-hash.ts';

// Issue #885 — pins the single canonical body_hash concatenation convention
// (`queue-dag.md` § `body_hash` algorithm): sha256(title + "\n" + body), UTF-8
// bytes, no further normalization. The worked example below is the same one
// documented there, independently verified with `shasum -a 256` and Python
// `hashlib` before being pinned here.
describe('computeBodyHash', () => {
  test('pins the canonical worked example digest', () => {
    expect(computeBodyHash('Example Issue', 'This is the body.')).toBe(
      '31fe5c60c8773642b8cee437c596be10923a2bce4d24aa932d3f58d6f2d73a6e',
    );
  });
});
