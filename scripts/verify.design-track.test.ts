import { afterEach, describe, expect, mock, test } from 'bun:test';
import * as path from 'path';
import {
  DESIGN_TRACK_REQUIRED_HEADINGS,
  findMissingDesignTrackHeadings,
  ORCHESTRATOR_DESIGN_GATE_REQUIRED_MARKERS,
  PLANNER_DESIGN_GATE_REQUIRED_MARKERS,
  runChecks,
} from './checks/design-track.check.ts';
import * as content from './lib/build/content.ts';
import { root } from './lib/build/paths.ts';
import { expectMarkersMissing, expectMarkersPresent } from './lib/marker-fixture-test.ts';

const COMPLETE_FIXTURE = `
## Requirements Framing
...

## Options + Trade-off Matrix
...

## Adversarial Evaluation
...

## Component Decomposition
...

## Design Principles Validation
...

## Refactoring Impact Analysis
...

## Assumption Audit
...

## Gate
status: blocked
`;

describe('findMissingDesignTrackHeadings', () => {
  test('all 8 headings present in a synthetic fixture returns []', () => {
    expect(findMissingDesignTrackHeadings(COMPLETE_FIXTURE)).toEqual([]);
  });

  test('one heading missing returns exactly that heading', () => {
    const fixture = COMPLETE_FIXTURE.replace('## Adversarial Evaluation\n...\n\n', '');
    expect(findMissingDesignTrackHeadings(fixture)).toEqual(['## Adversarial Evaluation']);
  });

  test('multiple headings missing (thin ADR-lite shape) returns all others as missing', () => {
    const fixture = `
## Options + Trade-off Matrix
...

## Gate
status: blocked
`;
    expect(findMissingDesignTrackHeadings(fixture)).toEqual([
      '## Requirements Framing',
      '## Adversarial Evaluation',
      '## Component Decomposition',
      '## Design Principles Validation',
      '## Refactoring Impact Analysis',
      '## Assumption Audit',
    ]);
  });

  test('wrong spacing near-miss is treated as missing (exact-string, not fuzzy)', () => {
    const fixture = COMPLETE_FIXTURE.replace('## Options + Trade-off Matrix', '## Options+Trade-off Matrix');
    expect(findMissingDesignTrackHeadings(fixture)).toEqual(['## Options + Trade-off Matrix']);
  });

  test('DESIGN_TRACK_REQUIRED_HEADINGS lists all 8 headings verbatim from plan-template.md', () => {
    expect(DESIGN_TRACK_REQUIRED_HEADINGS).toEqual([
      '## Requirements Framing',
      '## Options + Trade-off Matrix',
      '## Adversarial Evaluation',
      '## Component Decomposition',
      '## Design Principles Validation',
      '## Refactoring Impact Analysis',
      '## Assumption Audit',
      '## Gate',
    ]);
  });
});

// V-DESIGN-02 (ADR-010 M2): the gated-verdict markers Task 5/6 wrote into planner.md §4.8 and
// orchestrator.md's Route-derived dispatch must stay present. Modeled on
// verify.single-writer.test.ts's required-markers-present fixture shape.

const PLANNER_FIXTURE_FIXED = `
8.  **Gate (ADR-010 D4 — config-gated, otherwise unchanged)**: invoke
    \`scripts/design-aggregate.ts\` with the primary's weighted matrix.
    The planner reads the script's returned \`status\`.
    **The planner MUST NOT substitute its own judgment** for it — the script is the sole source
    of the verdict.
`;

const PLANNER_FIXTURE_STALE = `
8.  **Gate**: \`status: blocked\` — unchanged, unconditional, no confidence bypass. There is no
    code path in this track that returns \`status: ready\`; the substance above does not create an
    exception for "obviously correct" designs.
`;

const ORCHESTRATOR_FIXTURE_FIXED = `
The orchestrator applies only the worker JSON's \`status\` field as returned — it never
re-derives or second-guesses the verdict itself.
`;

const ORCHESTRATOR_FIXTURE_STALE = `
See \`phase-plan.md\` § Plan approval gate, "Design track (ADR-004)" row — the
unconditional human sign-off gate is already documented there; no new gate logic here.
`;

describe('PLANNER_DESIGN_GATE_REQUIRED_MARKERS', () => {
  test('fixed planner.md fixture (gated verdict + no-substitution language) has all markers present', () => {
    expectMarkersPresent(PLANNER_FIXTURE_FIXED, PLANNER_DESIGN_GATE_REQUIRED_MARKERS);
  });

  test('stale planner.md fixture (pre-M2 unconditional-blocked gate) is missing all markers', () => {
    expectMarkersMissing(PLANNER_FIXTURE_STALE, PLANNER_DESIGN_GATE_REQUIRED_MARKERS);
  });
});

describe('ORCHESTRATOR_DESIGN_GATE_REQUIRED_MARKERS', () => {
  test('fixed orchestrator.md fixture (applies-only-status language) has all markers present', () => {
    expectMarkersPresent(ORCHESTRATOR_FIXTURE_FIXED, ORCHESTRATOR_DESIGN_GATE_REQUIRED_MARKERS);
  });

  test('stale orchestrator.md fixture (pre-M2 dispatch, no gated-verdict language) is missing all markers', () => {
    expectMarkersMissing(ORCHESTRATOR_FIXTURE_STALE, ORCHESTRATOR_DESIGN_GATE_REQUIRED_MARKERS);
  });
});

// The two verdict functions take no parameters: they read fixed repo files through
// check-utils.ts's `read()`, which passes every file's text through `expandIncludes(text,
// absPath)`. Swapping `expandIncludes` at the module boundary is the narrowest seam that lets a
// fixture stand in for a file without a production change. Paths without an override delegate to
// the real implementation, so every other `expandIncludes` consumer in the same `bun test`
// process sees unchanged behavior once `readOverrides` is cleared. If `read()` ever stops routing
// through `expandIncludes`, the not-ok tests below fail loudly rather than passing vacuously.
const realExpandIncludes = content.expandIncludes;
const readOverrides = new Map<string, string>();
mock.module('./lib/build/content.ts', () => ({
  ...content,
  expandIncludes: (text: string, srcPath: string, ...rest: [string[]?, string[]?]) =>
    readOverrides.get(path.relative(root, srcPath)) ?? realExpandIncludes(text, srcPath, ...rest),
}));

const PLAN_TEMPLATE = 'src/references/plan-template.md';
const PLANNER = 'src/agents/planner.md';
const ORCHESTRATOR_DISPATCH = 'src/references/orchestrator-dispatch.md';

const verdict = (id: string) => runChecks().find((r) => r.id === id);

describe('runChecks verdicts (V-DESIGN-01 / V-DESIGN-02)', () => {
  afterEach(() => readOverrides.clear());

  test('live repo tree passes both checks', () => {
    expect(runChecks()).toEqual([
      { id: 'V-DESIGN-01', ok: true },
      { id: 'V-DESIGN-02', ok: true },
    ]);
  });

  test('V-DESIGN-01: conforming plan template -> ok', () => {
    readOverrides.set(PLAN_TEMPLATE, COMPLETE_FIXTURE);
    expect(verdict('V-DESIGN-01')).toEqual({ id: 'V-DESIGN-01', ok: true });
  });

  test('V-DESIGN-01: plan template missing a Design Track section -> not ok, names the heading', () => {
    readOverrides.set(PLAN_TEMPLATE, COMPLETE_FIXTURE.replace('## Adversarial Evaluation\n...\n\n', ''));
    expect(verdict('V-DESIGN-01')).toEqual({
      id: 'V-DESIGN-01',
      ok: false,
      detail: 'plan-template.md missing Design Track headings: ## Adversarial Evaluation',
    });
  });

  test('V-DESIGN-01: several missing headings are all listed, comma-joined in declared order', () => {
    readOverrides.set(PLAN_TEMPLATE, '## Options + Trade-off Matrix\n\n## Gate\n');
    expect(verdict('V-DESIGN-01')).toEqual({
      id: 'V-DESIGN-01',
      ok: false,
      detail:
        'plan-template.md missing Design Track headings: ## Requirements Framing, ## Adversarial Evaluation, ' +
        '## Component Decomposition, ## Design Principles Validation, ## Refactoring Impact Analysis, ' +
        '## Assumption Audit',
    });
  });

  test('V-DESIGN-02: grounded gate (design-aggregate.ts verdict, no substitution) -> ok', () => {
    readOverrides.set(PLANNER, PLANNER_FIXTURE_FIXED);
    readOverrides.set(ORCHESTRATOR_DISPATCH, ORCHESTRATOR_FIXTURE_FIXED);
    expect(verdict('V-DESIGN-02')).toEqual({ id: 'V-DESIGN-02', ok: true });
  });

  test('V-DESIGN-02: planner.md citing no verdict artifact -> not ok, names both planner markers', () => {
    readOverrides.set(PLANNER, PLANNER_FIXTURE_STALE);
    readOverrides.set(ORCHESTRATOR_DISPATCH, ORCHESTRATOR_FIXTURE_FIXED);
    expect(verdict('V-DESIGN-02')).toEqual({
      id: 'V-DESIGN-02',
      ok: false,
      detail: 'planner.md missing "design-aggregate.ts"; planner.md missing "MUST NOT substitute its own judgment"',
    });
  });

  test('V-DESIGN-02: orchestrator-dispatch.md without applies-only-status language -> not ok', () => {
    readOverrides.set(PLANNER, PLANNER_FIXTURE_FIXED);
    readOverrides.set(ORCHESTRATOR_DISPATCH, ORCHESTRATOR_FIXTURE_STALE);
    expect(verdict('V-DESIGN-02')).toEqual({
      id: 'V-DESIGN-02',
      ok: false,
      detail: 'orchestrator-dispatch.md missing "applies only the worker JSON\'s `status` field"',
    });
  });

  test('V-DESIGN-02: both files stale -> planner errors first, then orchestrator, "; "-joined', () => {
    readOverrides.set(PLANNER, PLANNER_FIXTURE_STALE);
    readOverrides.set(ORCHESTRATOR_DISPATCH, ORCHESTRATOR_FIXTURE_STALE);
    expect(verdict('V-DESIGN-02')?.detail).toBe(
      'planner.md missing "design-aggregate.ts"; planner.md missing "MUST NOT substitute its own judgment"; ' +
        'orchestrator-dispatch.md missing "applies only the worker JSON\'s `status` field"',
    );
    expect(verdict('V-DESIGN-02')?.ok).toBe(false);
  });
});
