import { describe, expect, test } from 'bun:test';
import { DESIGN_TRACK_REQUIRED_HEADINGS, findMissingDesignTrackHeadings } from './checks/design-track.check.ts';

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
