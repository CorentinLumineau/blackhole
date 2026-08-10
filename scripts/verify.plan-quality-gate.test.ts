import { describe, expect, test } from 'bun:test';
import {
  extractBacktickPaths,
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
});

describe('findVagueMitigations', () => {
  test('a fixture plan with a vague mitigation is flagged', () => {
    const section = '## Execution Strategy (Stop Conditions)\n- Monitor the migration for errors.\n';
    expect(findVagueMitigations(section)).toEqual(['- Monitor the migration for errors.']);
  });

  test('a fixture plan with a concrete stop condition is not flagged', () => {
    const section =
      '## Execution Strategy (Stop Conditions)\n- If the generated migration lacks column X, abort.\n';
    expect(findVagueMitigations(section)).toEqual([]);
  });

  test('a vague word paired with an explicit stop condition is not flagged', () => {
    const section =
      '## Execution Strategy (Stop Conditions)\n- Watch for lock contention; if retries exceed 3, halt.\n';
    expect(findVagueMitigations(section)).toEqual([]);
  });

  test('multiple bullets: only the vague one is returned', () => {
    const section = [
      '## Execution Strategy (Stop Conditions)',
      '- If schema migration lacks column X, abort.',
      '- Be careful with the rollout.',
      '- If lint fails, block the merge.',
      '',
    ].join('\n');
    expect(findVagueMitigations(section)).toEqual(['- Be careful with the rollout.']);
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
