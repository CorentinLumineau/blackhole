import { describe, expect, test } from 'bun:test';
import { findMissingGateMarkers } from './checks/core.check.ts';
import {
  DESIGN_TRACK_REQUIRED_HEADINGS,
  findMissingDesignTrackHeadings,
  ORCHESTRATOR_DESIGN_GATE_REQUIRED_MARKERS,
  PLANNER_DESIGN_GATE_REQUIRED_MARKERS,
} from './checks/design-track.check.ts';

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

  test('DESIGN_TRACK_REQUIRED_HEADINGS lists all 8 headings verbatim from planner.md template', () => {
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
    expect(findMissingGateMarkers(PLANNER_FIXTURE_FIXED, PLANNER_DESIGN_GATE_REQUIRED_MARKERS)).toEqual([]);
  });

  test('stale planner.md fixture (pre-M2 unconditional-blocked gate) is missing all markers', () => {
    expect(findMissingGateMarkers(PLANNER_FIXTURE_STALE, PLANNER_DESIGN_GATE_REQUIRED_MARKERS)).toEqual(
      PLANNER_DESIGN_GATE_REQUIRED_MARKERS,
    );
  });
});

describe('ORCHESTRATOR_DESIGN_GATE_REQUIRED_MARKERS', () => {
  test('fixed orchestrator.md fixture (applies-only-status language) has all markers present', () => {
    expect(
      findMissingGateMarkers(ORCHESTRATOR_FIXTURE_FIXED, ORCHESTRATOR_DESIGN_GATE_REQUIRED_MARKERS),
    ).toEqual([]);
  });

  test('stale orchestrator.md fixture (pre-M2 dispatch, no gated-verdict language) is missing all markers', () => {
    expect(
      findMissingGateMarkers(ORCHESTRATOR_FIXTURE_STALE, ORCHESTRATOR_DESIGN_GATE_REQUIRED_MARKERS),
    ).toEqual(ORCHESTRATOR_DESIGN_GATE_REQUIRED_MARKERS);
  });
});
