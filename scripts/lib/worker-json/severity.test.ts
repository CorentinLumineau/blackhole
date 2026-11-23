import { describe, expect, test } from 'bun:test';
import { normalizeSeverity, severityRank, SEVERITIES } from './constants.ts';

// Issue #1439 — one optional severity (INFO) across reviewer returns and the ledger; the legacy
// ledger spelling NOTE is read as INFO, never written.
describe('normalizeSeverity', () => {
  test('legacy NOTE reads as INFO', () => {
    expect(normalizeSeverity('NOTE')).toBe('INFO');
  });

  test('every SEVERITIES value passes through unchanged', () => {
    for (const s of SEVERITIES) expect(normalizeSeverity(s)).toBe(s);
  });

  test('an unknown value passes through unchanged (validators report it, this does not guess)', () => {
    expect(normalizeSeverity('LOW')).toBe('LOW');
  });
});

describe('severityRank', () => {
  test('BLOCK > WARN > INFO > unknown', () => {
    expect(severityRank('BLOCK')).toBeGreaterThan(severityRank('WARN'));
    expect(severityRank('WARN')).toBeGreaterThan(severityRank('INFO'));
    expect(severityRank('INFO')).toBeGreaterThan(severityRank('bogus'));
    expect(severityRank(undefined)).toBe(0);
  });

  test('legacy NOTE ranks exactly like INFO', () => {
    expect(severityRank('NOTE')).toBe(severityRank('INFO'));
  });
});
