import { describe, expect, test } from 'bun:test';
import type { Manifest } from './carry-staged-artifacts.ts';
import { checkRouteArtifacts, collectDocCarry, dispatchGaps, latestRoute, promisedRoutes } from './route-artifacts.ts';

const entry = (route: string, target: string, kind = 'new_file') => ({
  route, sub_mode: null, produced_by: 'planner', declared_at: '2026-11-18T00:00:00Z',
  staged_path: `.blackhole/staged/9/${route}.md`, target_path: target, target_kind: kind,
});
const manifest = (...entries: unknown[]): Manifest => ({ issue: 9, updated_at: 'x', entries: entries as Manifest['entries'] });

describe('latestRoute', () => {
  const ledger = { routing_decisions: [
    { id: 'R-00002', issue_ref: 9, route: { needs_design: true } },
    { id: 'R-00010', issue_ref: 9, route: { needs_research: true } },
    { id: 'R-00011', issue_ref: 8, route: { needs_analysis: true } },
  ] };
  test('picks the highest id for the issue', () => {
    expect(latestRoute(ledger, null, 9)).toEqual({ needs_research: true });
  });
  test('falls back to the queue entry route', () => {
    expect(latestRoute({ routing_decisions: [] }, { issues: { '9': { route: { needs_design: true } } } }, 9)).toEqual({ needs_design: true });
  });
  test('null when neither exists', () => {
    expect(latestRoute(null, null, 9)).toBeNull();
  });
});

describe('promisedRoutes', () => {
  test('all-false route promises only plan', () => {
    expect(promisedRoutes({ needs_design: false })).toEqual(['plan']);
  });
  test('each flag adds its route', () => {
    expect(promisedRoutes({ needs_design: true, needs_analysis: true, needs_investigation: true, needs_research: true }))
      .toEqual(['plan', 'design', 'analyze', 'investigate', 'research']);
  });
});

describe('dispatchGaps', () => {
  test('lists promised routes with no manifest entry', () => {
    expect(dispatchGaps(['plan', 'design'], manifest(entry('plan', 'documentation/plans/p.md')))).toEqual(['design']);
  });
  test('absent manifest means every promised route is a gap', () => {
    expect(dispatchGaps(['plan'], null)).toEqual(['plan']);
  });
  test('an entry skipped by validateEntries does not count', () => {
    expect(dispatchGaps(['plan'], manifest({ route: 'plan' }))).toEqual(['plan']);
  });
});

describe('checkRouteArtifacts', () => {
  const m = manifest(entry('plan', 'documentation/plans/p.md'), entry('plan', 'documentation/INDEX.md', 'append_row'));
  test('flags a new_file target absent from the diff', () => {
    expect(checkRouteArtifacts(m, ['src/a.ts'])).toEqual(['documentation/plans/p.md']);
  });
  test('passes when the target is in the diff; append_row is ignored', () => {
    expect(checkRouteArtifacts(m, ['documentation/plans/p.md\n'])).toEqual([]);
  });
});

describe('collectDocCarry', () => {
  test('counts staged and carried new_file docs', () => {
    const m = manifest(entry('plan', 'a.md'), entry('investigate', 'b.md'), entry('plan', 'c.md', 'append_row'));
    expect(collectDocCarry(m, (p) => p === 'a.md')).toEqual({ staged: 2, carried: 1 });
  });
  test('null manifest is zero', () => {
    expect(collectDocCarry(null, () => true)).toEqual({ staged: 0, carried: 0 });
  });
});
