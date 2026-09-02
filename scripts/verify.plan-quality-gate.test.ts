import { describe, expect, test } from 'bun:test';
import {
  checkExecutionStrategyHeadingGrounding,
  checkPlanQualityGateGrounding,
  checkStandardTrackBugfixGrounding,
  EXECUTION_STRATEGY_HEADING,
  extractBacktickPaths,
  extractQuotedBranches,
  extractStandardTrackSection,
  findExecutionStrategyHeadingDrift,
  findMissingCriticalFiles,
  findSweepRetainConflicts,
  findTouchPathSsotGaps,
  findUnscopedSweepACs,
  findVagueMitigations,
  PLAN_QUALITY_GATE_REQUIRED_MARKERS,
  PLAN_QUALITY_GATE_VAGUE_WORDS,
  TOUCH_PATH_SSOT_PAIRS,
  runChecks,
  splitTaskBreakdownBullets,
  STANDARD_TRACK_BUGFIX_REQUIRED_MARKERS,
} from './checks/plan-quality-gate.check.ts';
import { read } from './checks/check-utils.ts';
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

// A sweep-to-zero AC's grep pattern quotes its `\|`-alternation branches in backticks (e.g.
// `` `grep -rn "commit the ADR\|planner\.md:288-291" documentation/` ``) — extractQuotedBranches
// pulls those branches out so the overlap check below can test each against other tasks' text.
describe('extractQuotedBranches', () => {
  test('splits a backtick grep command\'s quoted alternation on the literal \\|', () => {
    const line = '`grep -rn "commit the ADR\\|planner\\.md:288-291" documentation/`';
    expect(extractQuotedBranches(line)).toEqual(['commit the ADR', 'planner\\.md:288-291']);
  });

  test('a line with no quoted span returns []', () => {
    expect(extractQuotedBranches('no quotes here')).toEqual([]);
  });
});

describe('splitTaskBreakdownBullets', () => {
  test('splits a Task Breakdown section into per-task label/text pairs', () => {
    const section = [
      '## Task Breakdown',
      '1. **First task** — do the first thing.',
      '2. **Second task** — do the second thing.',
    ].join('\n');
    const tasks = splitTaskBreakdownBullets(section);
    expect(tasks.map((t) => t.label)).toEqual(['First task', 'Second task']);
    expect(tasks[0].text).toContain('do the first thing');
    expect(tasks[0].text).not.toContain('Second task');
  });

  test('a section with no numbered tasks returns []', () => {
    expect(splitTaskBreakdownBullets('## Task Breakdown\nno tasks here\n')).toEqual([]);
  });
});

describe('findSweepRetainConflicts', () => {
  const CONFLICT_FIXTURE = [
    '## Task Breakdown',
    '1. **Sweep stale references** — **AC**: `grep -rn "commit the ADR\\|planner\\.md:288-291" documentation/` returns zero remaining matches.',
    '2. **Update PR checklist** — retain the quoted sentence "commit the ADR inside the issue\'s own PR" verbatim.',
  ].join('\n');

  test('a sweep-to-zero AC overlapping a same-plan retain instruction is flagged', () => {
    expect(findSweepRetainConflicts(CONFLICT_FIXTURE)).toEqual([
      { sweepTask: 'Sweep stale references', retainTask: 'Update PR checklist', token: 'commit the ADR' },
    ]);
  });

  test('a sweep-shaped AC with no retain instruction anywhere returns []', () => {
    const section = [
      '## Task Breakdown',
      '1. **Sweep stale references** — **AC**: `grep -rn "commit the ADR" documentation/` returns zero remaining matches.',
    ].join('\n');
    expect(findSweepRetainConflicts(section)).toEqual([]);
  });

  test('a sweep-shaped AC and an unrelated retain instruction (no token overlap) returns []', () => {
    const section = [
      '## Task Breakdown',
      '1. **Sweep stale references** — **AC**: `grep -rn "commit the ADR" documentation/` returns zero remaining matches.',
      '2. **Update changelog** — retain the quoted sentence "release notes stay untouched" verbatim.',
    ].join('\n');
    expect(findSweepRetainConflicts(section)).toEqual([]);
  });
});

describe('findUnscopedSweepACs', () => {
  test('a sweep-to-zero AC with no scope path and no exemption clause is flagged', () => {
    const section = [
      '## Task Breakdown',
      '1. **Sweep stale references** — **AC**: search returns zero remaining matches.',
    ].join('\n');
    expect(findUnscopedSweepACs(section)).toEqual(['Sweep stale references']);
  });

  test('a sweep-to-zero AC carrying both a backtick path and "no exemptions" is not flagged', () => {
    const section = [
      '## Task Breakdown',
      '1. **Sweep stale references** — **AC**: `grep -rn "foo" bar/` returns zero remaining matches under `documentation/`, no exemptions.',
    ].join('\n');
    expect(findUnscopedSweepACs(section)).toEqual([]);
  });
});

describe('findTouchPathSsotGaps', () => {
  const VCODE_606_TOUCH_PATHS = [
    '## Touch-Paths',
    '- `src/references/blackhole-vcodes.md`',
    '- `src/agents/reviewer.md`',
  ].join('\n');
  const VCODE_606_BODY = [
    '## Task Steps',
    '1. Mint two new V-code rows in blackhole-vcodes.md and update reviewer citations.',
  ].join('\n');

  test('#606 shape: vcode row-mint without facts.ts companion is flagged', () => {
    const gaps = findTouchPathSsotGaps(VCODE_606_TOUCH_PATHS, VCODE_606_BODY);
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    expect(gaps.some((g) => g.missingPath === 'scripts/lib/build/facts.ts')).toBe(true);
    expect(gaps.find((g) => g.missingPath === 'scripts/lib/build/facts.ts')?.reason).toMatch(
      /VCODE_TABLE_ROW_COUNT/
    );
    expect(gaps.find((g) => g.missingPath === 'scripts/lib/build/facts.ts')?.reason).toMatch(
      /V-GROUND-01/
    );
  });

  test('companion already declared returns []', () => {
    const touchPaths = [
      '## Touch-Paths',
      '- `src/references/blackhole-vcodes.md`',
      '- `src/agents/reviewer.md`',
      '- `scripts/lib/build/facts.ts`',
    ].join('\n');
    expect(findTouchPathSsotGaps(touchPaths, VCODE_606_BODY)).toEqual([]);
  });

  test('wording-only vcodes edit (no row-add language) returns []', () => {
    const touchPaths = '## Touch-Paths\n- `src/references/blackhole-vcodes.md`\n';
    const body = '## Task Steps\n1. Update V-TEST-01 severity wording in blackhole-vcodes.md only.\n';
    expect(findTouchPathSsotGaps(touchPaths, body)).toEqual([]);
  });

  test('TOUCH_PATH_SSOT_PAIRS documents exactly one relationship', () => {
    expect(TOUCH_PATH_SSOT_PAIRS).toHaveLength(1);
    expect(TOUCH_PATH_SSOT_PAIRS[0].constant).toBe('VCODE_TABLE_ROW_COUNT');
  });
});

describe('PLAN_QUALITY_GATE_REQUIRED_MARKERS grounding', () => {
  test('carries exactly the five documented markers', () => {
    expect(PLAN_QUALITY_GATE_REQUIRED_MARKERS.length).toBe(5);
  });

  const FIXED = `
8. **Verify Quality Gate**: ...
   * **Critical-file existence** (\`critical_files_exist\`): Glob every path.
   * **Mitigation concreteness** (\`mitigation_concrete\`): scan against the word list.
   * **Sweep/retain overlap** (\`ac_sweep_conflict\`): advisory, never blocking.
   * **Unscoped sweep** (\`ac_sweep_scope\`): advisory, never blocking.
   * **Touch-Paths SSOT gaps** (\`touch_paths_ssot_gap\`): advisory, never blocking.
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

// Issue #533 — Standard Track bugfix-classification symmetry: reviewer.md §15's V-FIX-01 BLOCK
// branch reads the plan frontmatter's `task_type: bugfix` field regardless of track, but only
// Quick Track ever stamped it (planner.md's pre-#533 § Quick Track "Bugfix classification"
// bullet had no Standard Track counterpart) — so the BLOCK could never fire on a Standard-track
// bugfix, exactly the multi-file case where root-cause correctness matters most. Section-scoped
// extraction (not a whole-file marker check) because Quick Track already carries this bullet's
// text verbatim — a whole-file `findMissingGateMarkers` call would report "present" even if
// Standard Track's own copy silently regressed.
describe('extractStandardTrackSection', () => {
  test('extracts only the text between the Standard Track and Skip Track headings', () => {
    const fixture = [
      '### 1. Quick Track',
      'quick track prose',
      '### 2. Standard Track',
      'standard track prose',
      '### 3. Skip Track',
      'skip track prose',
    ].join('\n');
    const section = extractStandardTrackSection(fixture);
    expect(section).toContain('standard track prose');
    expect(section).not.toContain('quick track prose');
    expect(section).not.toContain('skip track prose');
  });

  test('missing either boundary heading returns an empty string', () => {
    expect(extractStandardTrackSection('no headings here')).toBe('');
    expect(extractStandardTrackSection('### 2. Standard Track\nonly the start')).toBe('');
  });
});

describe('STANDARD_TRACK_BUGFIX_REQUIRED_MARKERS grounding', () => {
  const FIXED = [
    '### 2. Standard Track',
    '*   **Bugfix classification**: ... stamp `task_type: bugfix` in the plan\'s frontmatter ...',
    '### 3. Skip Track',
  ].join('\n');
  const STALE = [
    '### 2. Standard Track',
    '*   **Objective**: Issue summary and constraints.',
    '### 3. Skip Track',
  ].join('\n');

  test('fixed planner.md fixture has both markers present in the Standard Track section', () => {
    expectMarkersPresent(extractStandardTrackSection(FIXED), STANDARD_TRACK_BUGFIX_REQUIRED_MARKERS);
  });

  test('stale (pre-#533) planner.md fixture is missing both markers in the Standard Track section', () => {
    expectMarkersMissing(extractStandardTrackSection(STALE), STANDARD_TRACK_BUGFIX_REQUIRED_MARKERS);
  });

  test('real planner.md Standard Track section carries the Bugfix classification bullet', () => {
    const plannerContent = read('src/agents/planner.md');
    const section = extractStandardTrackSection(plannerContent);
    expect(section).not.toBe('');
    expectMarkersPresent(section, STANDARD_TRACK_BUGFIX_REQUIRED_MARKERS);
  });
});

// Issue #534 — split the single V-PLANGATE-01 CheckResult (which had folded in the heading-drift
// guard and the Standard Track bugfix marker check purely to avoid touching a locked facts.ts)
// into three CheckResults: V-PLANGATE-01 keeps the two-file marker-grounding concern (same shape
// as design-track.check.ts's V-DESIGN-02), V-PLANGATE-02 is the heading-spelling-drift concern,
// V-PLANGATE-03 is the Standard Track track-symmetry concern. Each is now independently
// pass/fail instead of one aggregate string conflating three unrelated regression classes — the
// same overload shape #518 had to unpick from V-TEST-09.
describe('checkPlanQualityGateGrounding() against the real src/ files', () => {
  test('returns ok: true — planner.md and worker-schemas.md both carry the required markers', () => {
    const result = checkPlanQualityGateGrounding();
    expect(result.id).toBe('V-PLANGATE-01');
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });
});

describe('checkExecutionStrategyHeadingGrounding() against the real src/ files', () => {
  test('returns ok: true — planner.md uses the canonical heading spelling', () => {
    const result = checkExecutionStrategyHeadingGrounding();
    expect(result.id).toBe('V-PLANGATE-02');
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });
});

describe('checkStandardTrackBugfixGrounding() against the real src/ files', () => {
  test('returns ok: true — planner.md Standard Track section carries the bugfix stamp', () => {
    const result = checkStandardTrackBugfixGrounding();
    expect(result.id).toBe('V-PLANGATE-03');
    expect(result.detail ?? '').toBe('');
    expect(result.ok).toBe(true);
  });
});

describe('runChecks()', () => {
  test('returns exactly three CheckResults, one per split concern, all passing', () => {
    const results = runChecks();
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.id)).toEqual(['V-PLANGATE-01', 'V-PLANGATE-02', 'V-PLANGATE-03']);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
