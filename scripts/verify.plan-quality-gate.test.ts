import { describe, expect, test } from 'bun:test';
import {
  EXECUTION_STRATEGY_HEADING,
  extractBacktickPaths,
  findExecutionStrategyHeadingDrift,
  findMissingCriticalFiles,
  findVagueMitigations,
  PLAN_QUALITY_GATE_REQUIRED_MARKERS,
  PLAN_QUALITY_GATE_VAGUE_WORDS,
} from './checks/plan-quality-gate.check.ts';
import { expectMarkersMissing, expectMarkersPresent } from './lib/marker-fixture-test.ts';

// Issue #459 — plan quality gate parity: critical-file existence (a Glob call) and
// vague-mitigation concreteness (a stated word list). Modeled on
// verify.design-track.test.ts's fixture-string-in, result-out shape.

describe('extractBacktickPaths', () => {
  test('extracts every backtick-quoted path from a bullet list', () => {
    const section = '## Critical Files\n- `src/lib/db.ts` — auth client\n- `src/config/auth.ts`\n';
    expect(extractBacktickPaths(section)).toEqual(['src/lib/db.ts', 'src/config/auth.ts']);
  });

  test('section with no backtick paths returns []', () => {
    expect(extractBacktickPaths('## Critical Files\n...\n')).toEqual([]);
  });

  // Reviewer-reproduced false positive on PR #515: a Critical Files bullet citing a V-code and
  // a multi-word command in backticks alongside the real path — only the path is path-shaped.
  test('a mixed-content bullet (path + V-code + command) extracts only the path', () => {
    const section =
      '## Critical Files\n- `src/lib/db.ts` — auth client; requires `V-SEC-03` review and `npm audit`\n';
    expect(extractBacktickPaths(section)).toEqual(['src/lib/db.ts']);
  });
});

describe('findMissingCriticalFiles', () => {
  const existsIn = (real: Set<string>) => (p: string) => real.has(p);

  test('a fixture plan naming a nonexistent file is flagged', () => {
    const section = '## Critical Files\n- `src/lib/does-not-exist.ts`\n';
    expect(findMissingCriticalFiles(section, existsIn(new Set()))).toEqual([
      'src/lib/does-not-exist.ts',
    ]);
  });

  test('a fixture plan naming only files that exist is not flagged', () => {
    const section = '## Critical Files\n- `src/lib/db.ts`\n';
    expect(findMissingCriticalFiles(section, existsIn(new Set(['src/lib/db.ts'])))).toEqual([]);
  });

  test('mixed hit/miss returns only the miss', () => {
    const section = '## Critical Files\n- `src/lib/db.ts`\n- `src/lib/ghost.ts`\n';
    expect(findMissingCriticalFiles(section, existsIn(new Set(['src/lib/db.ts'])))).toEqual([
      'src/lib/ghost.ts',
    ]);
  });

  test('empty section returns []', () => {
    expect(findMissingCriticalFiles('## Critical Files\n...\n', existsIn(new Set()))).toEqual([]);
  });

  // Reviewer-reproduced false positive on PR #515: `V-SEC-03` and `npm audit` are not paths and
  // must never be reported as missing files just because the real path (`src/lib/db.ts`) exists.
  test('inline V-code and command citations in the same bullet are not reported as missing', () => {
    const section =
      '## Critical Files\n- `src/lib/db.ts` — auth client; requires `V-SEC-03` review and `npm audit`\n';
    expect(findMissingCriticalFiles(section, existsIn(new Set(['src/lib/db.ts'])))).toEqual([]);
  });
});

describe('findVagueMitigations', () => {
  test('a fixture plan with a vague mitigation is flagged', () => {
    const section = '## Execution Strategy & Stop Conditions\n- Monitor the migration for errors.\n';
    expect(findVagueMitigations(section)).toEqual(['- Monitor the migration for errors.']);
  });

  test('a fixture plan with a concrete stop condition is not flagged', () => {
    const section =
      '## Execution Strategy & Stop Conditions\n- If the generated migration lacks column X, abort.\n';
    expect(findVagueMitigations(section)).toEqual([]);
  });

  test('a vague word paired with an explicit stop condition is not flagged', () => {
    const section =
      '## Execution Strategy & Stop Conditions\n- Watch for lock contention; if retries exceed 3, halt.\n';
    expect(findVagueMitigations(section)).toEqual([]);
  });

  test('multiple bullets: only the vague one is returned', () => {
    const section = [
      '## Execution Strategy & Stop Conditions',
      '- If schema migration lacks column X, abort.',
      '- Be careful with the rollout.',
      '- If lint fails, block the merge.',
      '',
    ].join('\n');
    expect(findVagueMitigations(section)).toEqual(['- Be careful with the rollout.']);
  });

  // Reviewer-reproduced false positive on PR #515: a long qualifying clause between the "if"
  // trigger and the "abort" stop verb (~145 chars) previously fell outside a fixed 80-char
  // proximity window, so the leading "Monitor" won and this fully concrete bullet was flagged.
  test('a long condition clause between trigger and stop verb is not flagged', () => {
    const bullet =
      '- Monitor the queue; if depth exceeds threshold sustained for more than five consecutive ' +
      'polling intervals across every shard in the cluster without any sign of drain, abort.';
    const section = `## Execution Strategy & Stop Conditions\n${bullet}\n`;
    expect(findVagueMitigations(section)).toEqual([]);
  });

  test('PLAN_QUALITY_GATE_VAGUE_WORDS covers the issue-cited examples', () => {
    expect(PLAN_QUALITY_GATE_VAGUE_WORDS).toContain('monitor');
    expect(PLAN_QUALITY_GATE_VAGUE_WORDS).toContain('be careful');
  });
});

describe('PLAN_QUALITY_GATE_REQUIRED_MARKERS grounding', () => {
  const FIXED = `
8. **Verify Quality Gate**: ...
   * **Critical-file existence** (\`critical_files_exist\`): Glob every path.
   * **Mitigation concreteness** (\`mitigation_concrete\`): scan against the word list.
`;
  const STALE = `
8. **Verify Quality Gate**: Ensure all Touch-Paths are declared explicitly.
`;

  test('fixed planner.md fixture has both markers present', () => {
    expectMarkersPresent(FIXED, PLAN_QUALITY_GATE_REQUIRED_MARKERS);
  });

  test('stale (pre-#459) planner.md fixture is missing both markers', () => {
    expectMarkersMissing(STALE, PLAN_QUALITY_GATE_REQUIRED_MARKERS);
  });
});

// Issue #519 gap 3 — heading spelling drift: planner.md previously cited
// "Execution Strategy (Stop Conditions)" while plan-template.md's actual heading is
// "Execution Strategy & Stop Conditions" (the canonical form — it is literally what the
// planner writes into every Standard Track plan file). Modeled on
// PLAN_QUALITY_GATE_REQUIRED_MARKERS grounding above: fixture-in, drift-list-out.
describe('findExecutionStrategyHeadingDrift', () => {
  test('a planner.md fixture using the canonical heading has no drift', () => {
    const fixture = `Scan every bullet under \`## ${EXECUTION_STRATEGY_HEADING}\` against the word list.`;
    expect(findExecutionStrategyHeadingDrift(fixture)).toEqual([]);
  });

  test('a planner.md fixture using the stale parenthetical spelling is flagged', () => {
    const fixture = 'Scan every bullet under `## Execution Strategy (Stop Conditions)` against the word list.';
    expect(findExecutionStrategyHeadingDrift(fixture)).toEqual([
      'Execution Strategy (Stop Conditions)',
    ]);
  });

  test('a fixture with no Execution Strategy citation at all has no drift', () => {
    expect(findExecutionStrategyHeadingDrift('## Critical Files\n...\n')).toEqual([]);
  });

  test('EXECUTION_STRATEGY_HEADING matches plan-template.md\'s actual heading text', () => {
    expect(EXECUTION_STRATEGY_HEADING).toBe('Execution Strategy & Stop Conditions');
  });
});
