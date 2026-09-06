import { describe, expect, test } from 'bun:test';
import { appendDecisionRecords, parseDecisionLogIds, type DecisionRecordRow } from './decision-log-append.ts';

// Issue #717 (R-12) — decision-log-append.ts replaces the hand-append path that keeps
// forgetting to bump `last_updated` (frozen at 2026-07-20 across 6+ hand-appended rows this
// turn). Covers append/dedup/escaping (task AC) plus the digit-token dedup identity fix
// (Execution Strategy item 2): a `PR #428 / #421`-shaped existing row must be recognized as
// already covering both 428 and 421, not just the first regex match.

const FIXTURE_LOG = `---
type: reference
status: current
review_trigger: "on file change"
created: 2026-07-20
last_updated: 2026-07-20
related:
  - documentation/decisions/ADR-012-shared-artifact-substrate.md
---

# Decision Log

## Rotation

When this table exceeds 500 rows, rotate to \`_archive/\`.

## Records

| PR/Issue | Kind | Touch Paths | Decision | Why |
|---|---|---|---|---|
| PR #428 / #421 | reuse | src/references/hunt/ux-coherence.md | Reused parity.md structure | One-file-per-kind is established |
`;

const rowFor = (overrides: Partial<DecisionRecordRow> = {}): DecisionRecordRow => ({
  pr: 745,
  kind: 'approach',
  touch_paths: ['scripts/foo.ts'],
  decision: 'Did the thing',
  why: 'Because reasons',
  ...overrides,
});

describe('appendDecisionRecords', () => {
  test('appends one new record as a table row and bumps last_updated to the run date', () => {
    const { content, appended, skipped } = appendDecisionRecords(FIXTURE_LOG, [rowFor()], '2026-09-02');
    expect(appended).toBe(1);
    expect(skipped).toBe(0);
    expect(content).toContain('last_updated: 2026-09-02');
    expect(content).toContain('| 745 | approach | scripts/foo.ts | Did the thing | Because reasons |');
  });

  // Guards the dedup Set against mid-loop mutation: two records sharing one (pr, kind) key in
  // the SAME batch must not collide with each other, even with entirely different decision/why
  // text. A single worker return carrying two {pr, kind}-identical records is the routine shape,
  // so it is the fixture here.
  test('two records with the same (pr, kind) key but different text in one call both append, in order', () => {
    const worktreeDecision = rowFor({
      pr: 750,
      kind: 'approach',
      touch_paths: ['src/agents/orchestrator.md'],
      decision: 'Write into the worker\'s own worktree',
      why: 'Needs zero changes to implementer.md',
    });
    const touchPathsDecision = rowFor({
      pr: 750,
      kind: 'approach',
      touch_paths: ['scripts/decision-log-append.ts'],
      decision: 'No backtick-wrapping on touch_paths',
      why: 'Matches the documented no-transformation spec',
    });
    const { content, appended, skipped } = appendDecisionRecords(
      FIXTURE_LOG,
      [worktreeDecision, touchPathsDecision],
      '2026-09-02',
    );
    expect(appended).toBe(2);
    expect(skipped).toBe(0);
    const worktreeIdx = content.indexOf("Write into the worker's own worktree");
    const touchPathsIdx = content.indexOf('No backtick-wrapping on touch_paths');
    expect(worktreeIdx).toBeGreaterThan(-1);
    expect(touchPathsIdx).toBeGreaterThan(-1);
    expect(worktreeIdx).toBeLessThan(touchPathsIdx);
  });

  test('a second append with the same (pr, kind) pair is skipped, but last_updated still bumps and row count is unchanged', () => {
    const first = appendDecisionRecords(FIXTURE_LOG, [rowFor()], '2026-09-02');
    const second = appendDecisionRecords(first.content, [rowFor()], '2026-09-03');
    expect(second.appended).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.content).toContain('last_updated: 2026-09-03');
    const rowOccurrences = second.content.split('| 745 | approach |').length - 1;
    expect(rowOccurrences).toBe(1);
  });

  test('a `PR #428 / #421`-shaped existing row is recognized as already covering PR 421 for dedup purposes', () => {
    const { appended, skipped } = appendDecisionRecords(
      FIXTURE_LOG,
      [rowFor({ pr: 421, kind: 'reuse' })],
      '2026-09-02',
    );
    expect(appended).toBe(0);
    expect(skipped).toBe(1);
  });

  test('escapes literal | characters in decision/why/touch_paths cell text', () => {
    const { content } = appendDecisionRecords(
      FIXTURE_LOG,
      [rowFor({ decision: 'Chose A | B', why: 'A|B tradeoff', touch_paths: ['a.ts', 'b|c.ts'] })],
      '2026-09-02',
    );
    expect(content).toContain('a.ts, b\\|c.ts');
    expect(content).toContain('Chose A \\| B');
    expect(content).toContain('A\\|B tradeoff');
  });

  test('a malformed decision-log.md missing the last_updated frontmatter field fails loud', () => {
    const malformed = '# Not a real decision log\n\nNo frontmatter here.\n';
    expect(() => appendDecisionRecords(malformed, [rowFor()], '2026-09-02')).toThrow(/last_updated/);
  });
});

describe('parseDecisionLogIds', () => {
  test('collects every digit token from the PR/Issue column, including both ids in a `PR #428 / #421` cell', () => {
    const ids = parseDecisionLogIds(FIXTURE_LOG);
    expect([...ids].sort((a, b) => a - b)).toEqual([421, 428]);
  });
});
