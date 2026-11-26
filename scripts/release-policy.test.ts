import { describe, expect, test } from 'bun:test';
import { reportPolicy, type GitRunner } from './release-policy.ts';

const VERIFIED_SHA = 'f'.repeat(40);
const STALE_SHA = 'e'.repeat(40);
const UNVERIFIED_COMMIT = 'd'.repeat(40);
const VERIFIED_COMMIT = 'c'.repeat(40);
const NOW = new Date('2026-11-26T12:00:00Z');

function fakeGit(log: string, tagDate = '2026-11-20T00:00:00Z'): GitRunner {
  return (args) => {
    if (args[0] === 'tag') return 'v0.36.0\nv0.35.0';
    if (args[0] === 'merge-base') {
      if (args[2] === STALE_SHA || args[2] === UNVERIFIED_COMMIT) throw new Error('not an ancestor');
      return '';
    }
    if (args[0] === 'log' && args.includes('-1')) return tagDate;
    if (args[0] === 'log') {
      expect(args).toContain('v0.36.0..HEAD');
      return log;
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

describe('reportPolicy', () => {
  test('reports the class, reason and next version when a cut is due', () => {
    const log = `\x1e${'a'.repeat(40)}\x1f2026-11-24T00:00:00Z\x1ffeat(x): y (#7)\x1f\x1f\n\nskills/a.md\n`;
    const report = reportPolicy(fakeGit(log), '0.36.0', NOW, false, VERIFIED_SHA);
    expect(report).toMatchObject({ class: 'age', cut: true, tag: 'v0.36.0', nextVersion: '0.37.0', pending: 1 });
    expect(report.reason.length).toBeGreaterThan(0);
  });

  test('reports no cut and no next version for an empty range', () => {
    expect(reportPolicy(fakeGit(''), '0.36.0', NOW, false, VERIFIED_SHA)).toMatchObject({ class: 'none', cut: false, nextVersion: null });
  });

  test('fails closed without a verified SHA: nothing but force cuts', () => {
    const log = `\x1e${'a'.repeat(40)}\x1f2026-11-24T00:00:00Z\x1ffeat(x): y (#7)\x1f\x1f\n\nskills/a.md\n`;
    const report = reportPolicy(fakeGit(log), '0.36.0', NOW);
    expect(report).toMatchObject({ class: 'none', cut: false, nextVersion: null });
    expect(report.reason).toContain('verified');
    expect(reportPolicy(fakeGit(log), '0.36.0', NOW, true)).toMatchObject({ class: 'force', cut: true });
  });

  test('a verified SHA that is not an ancestor of the tip blocks the cut', () => {
    const log = `\x1e${'a'.repeat(40)}\x1f2026-11-24T00:00:00Z\x1ffeat(x): y (#7)\x1f\x1f\n\nskills/a.md\n`;
    expect(reportPolicy(fakeGit(log), '0.36.0', NOW, false, STALE_SHA)).toMatchObject({ class: 'none', cut: false });
  });

  test('an immediate commit that is not an ancestor of the verified SHA does not cut', () => {
    const fresh = new Date('2026-11-26T10:00:00Z').toISOString();
    const log = `\x1e${UNVERIFIED_COMMIT}\x1f${fresh}\x1ffix(x): y (#8)\x1fRelease: immediate\x1f\n\nskills/a.md\n`;
    const report = reportPolicy(fakeGit(log, '2026-11-26T00:00:00Z'), '0.36.0', NOW, false, VERIFIED_SHA);
    expect(report).toMatchObject({ class: 'none', cut: false });
  });

  test('an immediate commit that is an ancestor of the verified SHA cuts at once', () => {
    const fresh = new Date('2026-11-26T10:00:00Z').toISOString();
    const log = `\x1e${VERIFIED_COMMIT}\x1f${fresh}\x1ffix(x): y (#8)\x1fRelease: immediate\x1f\n\nskills/a.md\n`;
    const report = reportPolicy(fakeGit(log, '2026-11-26T00:00:00Z'), '0.36.0', NOW, false, VERIFIED_SHA);
    expect(report).toMatchObject({ class: 'immediate', cut: true });
  });
});
