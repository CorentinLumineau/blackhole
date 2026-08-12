import { describe, expect, test } from 'bun:test';
import { deriveConcernSlug, planTargetPath, reviewTargetPath } from './concern-slug.ts';

describe('deriveConcernSlug', () => {
  test('strips size/priority labels and kebab-cases the title', () => {
    expect(deriveConcernSlug('[size:xs] Campaign config confirmation gate', 123)).toBe(
      'campaign-config-confirmation-gate',
    );
  });

  test('collapses repeated hyphens and caps at 80 characters', () => {
    const long = 'a'.repeat(120);
    const slug = deriveConcernSlug(long, 1);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug).not.toMatch(/--/);
  });

  test('falls back to issue number when title normalizes empty', () => {
    expect(deriveConcernSlug('!!!', 445)).toBe('issue-445');
  });
});

describe('planTargetPath', () => {
  test('uses plan- prefix when title lacks plan prefix', () => {
    expect(planTargetPath('Durable artifact staging D3', 445)).toBe(
      'documentation/plans/plan-durable-artifact-staging-d3.md',
    );
  });

  test('omits plan- prefix when title starts with Plan', () => {
    expect(planTargetPath('Plan: Campaign Launch Config', 100)).toBe(
      'documentation/plans/plan-campaign-launch-config.md',
    );
  });
});

describe('reviewTargetPath', () => {
  test('always uses review- prefix', () => {
    expect(reviewTargetPath('Campaign config confirmation gate', 100)).toBe(
      'documentation/reviews/review-campaign-config-confirmation-gate.md',
    );
  });
});
