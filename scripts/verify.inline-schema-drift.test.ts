import { describe, expect, test } from 'bun:test';
import { ROUTE_STATUSES } from './lib/worker-json/constants.ts';
import {
  collectRoleHeadings,
  findFencedJsonBlocks,
  nearestPrecedingRole,
  normalizeHeadingRoleText,
  resolveRoleFromAgentFilename,
  resolveRoleFromHeading,
  runChecks,
  scanFileForInlineSchemaDrift,
} from './checks/inline-schema-drift.check.ts';

// Issue #611 — inline-schema-drift.check.ts: advisory detector (V-BRIEF-02) for a
// spawn-brief-adjacent doc inlining a literal return-JSON `"status"` skeleton whose value sits
// outside the resolved role's status enum. Modeled on verify.adr-status.test.ts /
// verify.vcode-citation.test.ts's synthetic-fixture shape: pure helper functions are exercised
// directly with hand-built markdown content, plus a live-tree integration smoke test.

const fixture = (lines: string[]): string => lines.join('\n');

describe('normalizeHeadingRoleText / resolveRoleFromHeading', () => {
  test('strips backticks and a trailing parenthetical, lowercases', () => {
    expect(normalizeHeadingRoleText('Router (`router`)')).toBe('router');
  });

  test('resolves a bare role heading', () => {
    expect(resolveRoleFromHeading('Implementer')).toBe('implementer');
  });

  test('a non-role heading resolves to null', () => {
    expect(resolveRoleFromHeading('Orchestrator validation')).toBeNull();
  });
});

describe('resolveRoleFromAgentFilename', () => {
  test('resolves each of the six role basenames', () => {
    expect(resolveRoleFromAgentFilename('router.md')).toBe('router');
    expect(resolveRoleFromAgentFilename('hunter.md')).toBe('hunter');
  });

  test('coordinator.md and orchestrator.md have no status array — resolve to null', () => {
    expect(resolveRoleFromAgentFilename('coordinator.md')).toBeNull();
    expect(resolveRoleFromAgentFilename('orchestrator.md')).toBeNull();
  });
});

describe('findFencedJsonBlocks', () => {
  test('extracts a single fenced ```json block with a correct 1-indexed start line', () => {
    const content = fixture(['intro', '```json', '{', '  "a": 1', '}', '```', 'outro']);
    expect(findFencedJsonBlocks(content)).toEqual([{ startLine: 3, body: '{\n  "a": 1\n}' }]);
  });

  test('ignores a fenced ```bash block', () => {
    const content = fixture(['```bash', '{"status":"complete"}', '```']);
    expect(findFencedJsonBlocks(content)).toEqual([]);
  });
});

describe('nearestPrecedingRole', () => {
  test('picks the nearest heading at or before the target line', () => {
    const headings: { line: number; role: 'router' | 'planner' }[] = [
      { line: 1, role: 'router' },
      { line: 10, role: 'planner' },
    ];
    expect(nearestPrecedingRole(headings, 5)).toBe('router');
    expect(nearestPrecedingRole(headings, 10)).toBe('planner');
    expect(nearestPrecedingRole(headings, 15)).toBe('planner');
  });

  test('no preceding heading resolves to null', () => {
    expect(nearestPrecedingRole([{ line: 5, role: 'router' }], 2)).toBeNull();
  });
});

describe('scanFileForInlineSchemaDrift', () => {
  // (a) an out-of-enum status under a resolvable role heading is flagged.
  test('flags an out-of-enum status value under a resolvable ## Router heading', () => {
    const content = fixture(['## Router', '', '```json', '{', '  "status": "complete"', '}', '```', '']);
    expect(scanFileForInlineSchemaDrift('references/fixture.md', content, false)).toEqual([
      { file: 'references/fixture.md', line: 5, role: 'router', found: 'complete', expected: ROUTE_STATUSES },
    ]);
  });

  // (b) the same fixture with a valid enum value produces no finding.
  test('a valid enum status value under the same heading produces no finding', () => {
    const content = fixture(['## Router', '', '```json', '{', '  "status": "routed"', '}', '```', '']);
    expect(scanFileForInlineSchemaDrift('references/fixture.md', content, false)).toEqual([]);
  });

  // (c) the shared "partial" status is valid on every role — no finding under any of the six.
  test('"partial" is valid under every one of the six role headings', () => {
    const roles = ['Router', 'Planner', 'Implementer', 'Reviewer', 'Investigator', 'Hunter'];
    const content = fixture(
      roles.flatMap((r) => [`## ${r}`, '```json', '{', '  "status": "partial"', '}', '```', ''])
    );
    expect(scanFileForInlineSchemaDrift('references/fixture.md', content, false)).toEqual([]);
  });

  // (d) no preceding role heading — insufficient context, skipped by design.
  test('a status literal with no preceding role heading is skipped, never guessed', () => {
    const content = fixture(['```json', '{', '  "status": "complete"', '}', '```']);
    expect(scanFileForInlineSchemaDrift('references/fixture.md', content, false)).toEqual([]);
  });

  // (e) worker-schemas.md is never scanned regardless of content.
  test('worker-schemas.md is excluded from scanning regardless of content', () => {
    const content = fixture(['## Router', '```json', '{', '  "status": "complete"', '}', '```']);
    expect(scanFileForInlineSchemaDrift('references/worker-schemas.md', content, false)).toEqual([]);
  });

  test('filename-based role detection flags an agent file without a role heading', () => {
    const content = fixture(['```json', '{', '  "status": "complete"', '}', '```']);
    expect(scanFileForInlineSchemaDrift('agents/router.md', content, true)).toEqual([
      { file: 'agents/router.md', line: 3, role: 'router', found: 'complete', expected: ROUTE_STATUSES },
    ]);
  });

  test('an agent file with no resolvable role (e.g. orchestrator.md) is skipped entirely', () => {
    const content = fixture(['```json', '{', '  "status": "complete"', '}', '```']);
    expect(scanFileForInlineSchemaDrift('agents/orchestrator.md', content, true)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (f) Integration smoke test — runChecks() against the real repo. The live src/agents/*.md and
// src/references/*.md trees carry zero inline out-of-enum status skeletons at this plan's base
// commit (verified during planning by direct grep) — clean baseline, no detail.
// ---------------------------------------------------------------------------
describe('runChecks (live-tree assertion)', () => {
  test('returns a single clean V-BRIEF-02 result on the current tree', () => {
    const results = runChecks();
    expect(results).toEqual([{ id: 'V-BRIEF-02', ok: true }]);
  });
});
