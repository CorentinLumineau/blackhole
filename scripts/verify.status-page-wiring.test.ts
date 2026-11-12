import { describe, expect, test } from 'bun:test';
import {
  findStatusPageWiringGaps,
  runChecks,
  sectionOf,
  type StatusPageWiringDocs,
} from './checks/status-page-wiring.check.ts';

const CITED = 'refresh the status page ([status-page.md](references/status-page.md))';

const wired = (): StatusPageWiringDocs => ({
  skill: [
    '## Modes',
    '| `status` | then refresh the status page (status-page.md) |',
    '## Phase 0: Bootstrap (ALL modes)',
    `7. **Status page** — ${CITED}`,
    '## Five-phase lifecycle',
    '## Orchestration (run mode — orchestrator)',
    `4. End turn; ${CITED}`,
    '## State references',
  ].join('\n'),
  coordinator: [
    '### Bootstrap preflight',
    'On **Proceed** publish the page (`status-page.md` § Refresh procedure).',
    '### Campaign visibility',
    '1. Before spawning: print the dashboard, then refresh the page (`status-page.md`).',
    '## Maintainer release routing',
  ].join('\n'),
  native: [
    '## Bootstrap gate ownership',
    'After the gate, publish the status page (`status-page.md` § Refresh procedure).',
    '## Two-tier gate topology',
    '## Turn-end step (main-chat orchestrator)',
    'Also when handing back with workers still in flight (`status-page.md`).',
    '## Resume path',
  ].join('\n'),
  statusPage: [
    '## When to refresh',
    '| Campaign start, after bootstrap and before the first spawn | main chat |',
    '| The main chat hands the turn back while workers are still in flight | main chat |',
    '## Refresh procedure',
  ].join('\n'),
});

describe('sectionOf', () => {
  test('returns the text from the heading up to the next heading of the same or higher level', () => {
    const doc = '## A\nfirst\n### A.1\nnested\n## B\nsecond';
    expect(sectionOf(doc, '## A')).toBe('## A\nfirst\n### A.1\nnested\n');
  });

  test('returns an empty string when the heading is absent', () => {
    expect(sectionOf('## A\nfirst', '## Missing')).toBe('');
  });

  test('matches a heading by prefix so a suffixed title still resolves', () => {
    expect(sectionOf('## Phase 0: Bootstrap (ALL modes)\nbody\n## Next', '## Phase 0')).toContain('body');
  });
});

describe('findStatusPageWiringGaps', () => {
  test('reports nothing when every run-path section cites status-page.md', () => {
    expect(findStatusPageWiringGaps(wired())).toEqual([]);
  });

  test('a citation in the Modes table alone does not satisfy Phase 0', () => {
    const docs = wired();
    docs.skill = docs.skill.replace(`7. **Status page** — ${CITED}`, '6. **Dashboard** — counts');
    expect(findStatusPageWiringGaps(docs)).toEqual([
      'SKILL.md § Phase 0 does not cite status-page.md',
    ]);
  });

  test('flags the run-mode Orchestration section when its turn end drops the refresh', () => {
    const docs = wired();
    docs.skill = docs.skill.replace(`4. End turn; ${CITED}`, '4. End turn');
    expect(findStatusPageWiringGaps(docs)).toEqual([
      'SKILL.md § Orchestration does not cite status-page.md',
    ]);
  });

  test('flags each coordinator section separately', () => {
    const docs = wired();
    docs.coordinator = '### Bootstrap preflight\ngate\n### Campaign visibility\nprint\n## Next';
    expect(findStatusPageWiringGaps(docs)).toEqual([
      'coordinator.md § Bootstrap preflight does not cite status-page.md',
      'coordinator.md § Campaign visibility does not cite status-page.md',
    ]);
  });

  test('flags the Pattern C bootstrap and turn-end sections', () => {
    const docs = wired();
    docs.native = '## Bootstrap gate ownership\ngate\n## Turn-end step (main-chat orchestrator)\nend\n## Resume path';
    expect(findStatusPageWiringGaps(docs)).toEqual([
      'claude-code-native.md § Bootstrap gate ownership does not cite status-page.md',
      'claude-code-native.md § Turn-end step does not cite status-page.md',
    ]);
  });

  test('flags a turn-end step that never covers handing back with workers in flight', () => {
    const docs = wired();
    docs.native = docs.native.replace('with workers still in flight ', '');
    expect(findStatusPageWiringGaps(docs)).toEqual([
      'claude-code-native.md § Turn-end step does not cover a hand-back with workers in flight',
    ]);
  });

  test('flags a refresh table that lost the campaign-start or the in-flight hand-back row', () => {
    const docs = wired();
    docs.statusPage = '## When to refresh\n| Every checkpoint write | orchestrator |\n## Refresh procedure';
    expect(findStatusPageWiringGaps(docs)).toEqual([
      'status-page.md § When to refresh has no campaign-start row',
      'status-page.md § When to refresh has no in-flight hand-back row',
    ]);
  });
});

describe('runChecks', () => {
  test('the shipped sources are wired', () => {
    expect(runChecks()).toEqual([{ id: 'V-STATUSPAGE-01', ok: true }]);
  });
});
