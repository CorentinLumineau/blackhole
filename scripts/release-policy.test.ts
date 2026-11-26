import { describe, expect, test } from 'bun:test';
import { reportPolicy, type GitRunner } from './release-policy.ts';

const NOW = new Date('2026-11-26T12:00:00Z');

function fakeGit(log: string, tagDate = '2026-11-20T00:00:00Z'): GitRunner {
  return (args) => {
    if (args[0] === 'tag') return 'v0.36.0\nv0.35.0';
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
    const report = reportPolicy(fakeGit(log), '0.36.0', NOW);
    expect(report).toMatchObject({ class: 'age', cut: true, tag: 'v0.36.0', nextVersion: '0.37.0', pending: 1 });
    expect(report.reason.length).toBeGreaterThan(0);
  });

  test('reports no cut and no next version for an empty range', () => {
    expect(reportPolicy(fakeGit(''), '0.36.0', NOW)).toMatchObject({ class: 'none', cut: false, nextVersion: null });
  });
});
