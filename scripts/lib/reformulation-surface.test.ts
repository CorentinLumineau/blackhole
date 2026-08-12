import { describe, expect, test } from 'bun:test';
import {
  REFORMULATION_HEADING_ASSUMED,
  REFORMULATION_HEADING_IF_WRONG,
  REFORMULATION_HEADING_UNDERSTOOD,
  formatReformulationComment,
  validateReformulation,
} from './reformulation-surface.ts';

const validReformulation = {
  understood: 'Wire the async veto surface on the planner proceed path.',
  assumed: 'Orchestrator posts before implement spawn; no queue.json field.',
  if_wrong: 'Defer posting to a follow-up issue and keep validator-only enforcement.',
};

const collectErrors = (
  data: Record<string, unknown>,
  options: { status: string; track?: string },
): string[] => {
  const errors: string[] = [];
  validateReformulation(data, options, errors);
  return errors;
};

describe('validateReformulation', () => {
  test('accepts valid object on ready quick/standard', () => {
    for (const track of ['quick', 'standard'] as const) {
      expect(
        collectErrors({ reformulation: validReformulation }, { status: 'ready', track }),
      ).toEqual([]);
    }
  });

  test('rejects missing reformulation on ready quick/standard', () => {
    for (const track of ['quick', 'standard'] as const) {
      const errors = collectErrors({}, { status: 'ready', track });
      expect(errors.some((error) => error.includes('reformulation'))).toBe(true);
    }
  });

  test('rejects empty subfields', () => {
    const errors = collectErrors(
      {
        reformulation: {
          understood: 'ok',
          assumed: '',
          if_wrong: 'ok',
        },
      },
      { status: 'ready', track: 'standard' },
    );
    expect(errors.some((error) => error.includes('assumed'))).toBe(true);
  });

  test('rejects reformulation on blocked payload', () => {
    const errors = collectErrors(
      { reformulation: validReformulation },
      { status: 'blocked', track: 'standard' },
    );
    expect(errors).toContain('reformulation: must be absent when status is blocked');
  });

  test('does not require reformulation on skip track', () => {
    expect(collectErrors({}, { status: 'ready', track: 'skip' })).toEqual([]);
  });
});

describe('formatReformulationComment', () => {
  test('includes all three headings', () => {
    const comment = formatReformulationComment(validReformulation);
    expect(comment).toContain(`### ${REFORMULATION_HEADING_UNDERSTOOD}`);
    expect(comment).toContain(`### ${REFORMULATION_HEADING_ASSUMED}`);
    expect(comment).toContain(`### ${REFORMULATION_HEADING_IF_WRONG}`);
    expect(comment).toContain(validReformulation.understood);
    expect(comment).toContain(validReformulation.assumed);
    expect(comment).toContain(validReformulation.if_wrong);
  });
});
