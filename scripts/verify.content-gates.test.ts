import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseSectionLineCounts,
  findContentGateViolations,
  ORCHESTRATOR_CONTENT_GATE_BASELINE,
  CONTENT_GATE_NEW_SECTION_BUDGET_LOC,
} from './checks/content-gates.check.ts';

// V-CONTENTGATE-01 (ADR-007 T6/R3′): section-budget content-gate for orchestrator.md. Inline
// fixtures cover the parser and the grow-never/new-section-budget decision logic; a final live
// integration case runs the same pure functions against the real orchestrator.md content to
// confirm zero false positives (T6 acceptance criterion 1).
describe('parseSectionLineCounts', () => {
  test('ignores ## headings inside fenced code blocks (fence-aware)', () => {
    const content = [
      '## Real Section',
      'text',
      '```',
      '## Not A Heading',
      '```',
      'more text',
      '## Second Section',
      'body',
    ].join('\n');
    const counts = parseSectionLineCounts(content);
    expect(Object.keys(counts)).toEqual(['## Real Section', '## Second Section']);
    expect(counts['## Real Section']).toBe(6);
  });

  test('maps each `##` header to its line count, up to the next `##` header', () => {
    const content = ['## First', 'a', 'b', '## Second', 'c'].join('\n');
    expect(parseSectionLineCounts(content)).toEqual({
      '## First': 3,
      '## Second': 2,
    });
  });

  test('extends the last section to end of content and drops a trailing empty split element', () => {
    const content = '## Only\nline one\nline two\n';
    expect(parseSectionLineCounts(content)).toEqual({ '## Only': 3 });
  });

  test('does not treat a `###` subsection as its own `##`-level boundary', () => {
    const content = ['## Parent', '### Child', 'body', '## Next'].join('\n');
    expect(parseSectionLineCounts(content)).toEqual({
      '## Parent': 3,
      '## Next': 1,
    });
  });

  test('returns {} for content with no `##` headers', () => {
    expect(parseSectionLineCounts('no headers here\njust prose')).toEqual({});
  });
});

describe('findContentGateViolations', () => {
  test('passes a baseline-grandfathered section at its recorded baseline size', () => {
    const sections = { '## Route-derived dispatch': 110 };
    const baseline = { '## Route-derived dispatch': 110 };
    expect(findContentGateViolations(sections, baseline, 50)).toEqual([]);
  });

  test('passes a baseline section that has shrunk below its recorded baseline', () => {
    const sections = { '## Route-derived dispatch': 90 };
    const baseline = { '## Route-derived dispatch': 110 };
    expect(findContentGateViolations(sections, baseline, 50)).toEqual([]);
  });

  test('fails a baseline section that grew past its recorded baseline (grow-never)', () => {
    const sections = { '## Route-derived dispatch': 111 };
    const baseline = { '## Route-derived dispatch': 110 };
    const violations = findContentGateViolations(sections, baseline, 50);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('## Route-derived dispatch');
    expect(violations[0]).toContain('111 LOC');
    expect(violations[0]).toContain('grandfathered baseline of 110 LOC');
  });

  test('passes a new (non-baseline) section at or under the budget', () => {
    const sections = { '## New Thin Pointer': 50 };
    expect(findContentGateViolations(sections, {}, 50)).toEqual([]);
  });

  test('fails a new section exceeding the budget, naming the header and its line count', () => {
    const sections = { '## New Sprawling Section': 51 };
    const violations = findContentGateViolations(sections, {}, 50);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('## New Sprawling Section');
    expect(violations[0]).toContain('51 LOC');
    expect(violations[0]).toContain('50-LOC budget');
  });
});

describe('checkContentGate integration (real orchestrator.md, zero false positives)', () => {
  test('every current orchestrator.md `##` section is grandfathered in the baseline and passes', () => {
    const orchestratorMd = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'src', 'agents', 'orchestrator.md'),
      'utf-8',
    );
    const sections = parseSectionLineCounts(orchestratorMd);
    const violations = findContentGateViolations(
      sections,
      ORCHESTRATOR_CONTENT_GATE_BASELINE,
      CONTENT_GATE_NEW_SECTION_BUDGET_LOC,
    );
    expect(violations).toEqual([]);
    // Sections not in the grandfathered baseline are legitimate new (post-T6) additions, budget-
    // checked above via findContentGateViolations rather than forbidden outright — ADR-010 M2's
    // "## Design Autonomy Dispatch" was the first such addition; companion-substrate-closure M4
    // Task 4 (ADR-012 E4) adds "## Decision Record Append" as the second, placed immediately
    // after the grandfathered barrier section it back-points to. companion-substrate-closure M2
    // Task 2 (ADR-012 E2.3) adds "## Design-Approval Resume Dispatch" as the third, placed
    // immediately after "## Design Autonomy Dispatch" (the section it back-points to). Assert the
    // non-baseline set is exactly the expected new-section allowlist, so an unexpected/undocumented
    // new `##` header still fails loudly here even though it would pass the budget check above.
    const nonBaselineSections = Object.keys(sections).filter((h) => !(h in ORCHESTRATOR_CONTENT_GATE_BASELINE));
    expect(nonBaselineSections).toEqual([
      '## Decision Record Append (decision-log.md)',
      '## Design Autonomy Dispatch (ADR-010 D4)',
      '## Design-Approval Resume Dispatch (ADR-012 E2.3)',
    ]);
  });
});
