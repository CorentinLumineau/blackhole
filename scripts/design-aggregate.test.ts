import { describe, expect, test } from 'bun:test';
import {
  aggregateDesign,
  type ColumnScore,
  type ColumnWeights,
  type CriticScore,
  type DesignAggregateInput,
  type DesignFinding,
  type PrimaryDesignInput,
  type RefactoringImpactRow,
} from './design-aggregate';

// Single-column weight set (weight 100 on "Risk") — keeps weighted_total == raw score so
// dominance-percentage math in fixtures is easy to reason about and verify by hand.
const WEIGHTS: ColumnWeights = { Risk: 100 };

const scores = (a: number, b: number): Record<string, ColumnScore> => ({
  'Option A': { Risk: a },
  'Option B': { Risk: b },
});

const basePrimaryInput = (overrides: Partial<PrimaryDesignInput> = {}): PrimaryDesignInput => ({
  per_option_scores: scores(5, 3),
  refactoring_impact: [],
  ...overrides,
});

const baseCriticScore = (overrides: Partial<CriticScore> = {}): CriticScore => ({
  per_option_scores: scores(5, 3),
  findings: [],
  ...overrides,
});

const baseFinding = (overrides: Partial<DesignFinding> = {}): DesignFinding => ({
  option: 'Option A',
  tag: 'discriminating',
  severity: 'CRITICAL',
  note: 'finding',
  ...overrides,
});

const baseInput = (overrides: Partial<DesignAggregateInput> = {}): DesignAggregateInput => ({
  weights: WEIGHTS,
  primary: basePrimaryInput(),
  critics: [baseCriticScore(), baseCriticScore()],
  ...overrides,
});

describe('aggregateDesign — dominance', () => {
  test('all three scorers agree the winner dominates by more than design_dominance_delta → ready', () => {
    // margin = (5 - 3) / 5 = 40% > 30% default delta
    const result = aggregateDesign(baseInput());
    expect(result.status).toBe('ready');
    expect(result.winner).toBe('Option A');
    expect(result.reasons).toEqual([]);
  });

  test('dominance holds on 2 of 3 scorers, near-tie on the third → blocked', () => {
    const result = aggregateDesign(
      baseInput({
        critics: [baseCriticScore(), baseCriticScore({ per_option_scores: scores(4, 4) })],
      }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toContain('dominance');
  });

  test('tie score (0% dominance) → blocked', () => {
    const result = aggregateDesign(
      baseInput({
        primary: basePrimaryInput({ per_option_scores: scores(4, 4) }),
        critics: [
          baseCriticScore({ per_option_scores: scores(4, 4) }),
          baseCriticScore({ per_option_scores: scores(4, 4) }),
        ],
      }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['dominance']);
    expect(result.winner).toBeNull();
  });

  test('exactly at design_dominance_delta threshold (boundary) → blocked — delta must be exceeded, not met', () => {
    // margin = (5 - 3.5) / 5 = 30% exactly == default delta 30
    const result = aggregateDesign(
      baseInput({
        primary: basePrimaryInput({ per_option_scores: scores(5, 3.5) }),
        critics: [
          baseCriticScore({ per_option_scores: scores(5, 3.5) }),
          baseCriticScore({ per_option_scores: scores(5, 3.5) }),
        ],
      }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['dominance']);
  });

  test('custom design_dominance_delta (15) changes the verdict for a case that would block at the default 30', () => {
    // margin = (5 - 4) / 5 = 20% — blocks at default 30, passes at custom 15
    const scoresA = scores(5, 4);
    const input = baseInput({
      primary: basePrimaryInput({ per_option_scores: scoresA }),
      critics: [
        baseCriticScore({ per_option_scores: scoresA }),
        baseCriticScore({ per_option_scores: scoresA }),
      ],
    });

    const atDefault = aggregateDesign(input);
    expect(atDefault.status).toBe('blocked');
    expect(atDefault.reasons).toContain('dominance');

    const atCustomDelta = aggregateDesign({ ...input, design_dominance_delta: 15 });
    expect(atCustomDelta.status).toBe('ready');
  });
});

describe('aggregateDesign — critic disagreement', () => {
  test('one critic ranks a different option as winner → blocked', () => {
    const result = aggregateDesign(
      baseInput({
        critics: [
          baseCriticScore(),
          baseCriticScore({ per_option_scores: scores(3, 5) }), // critic_b picks Option B
        ],
      }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['disagreement']);
    expect(result.winner).toBeNull();
  });
});

describe('aggregateDesign — critical findings', () => {
  test('a discriminating CRITICAL finding tagged on the winning option → blocked even when dominance and Refactoring Impact both pass', () => {
    const result = aggregateDesign(
      baseInput({
        critics: [
          baseCriticScore({
            findings: [baseFinding({ option: 'Option A', tag: 'discriminating', severity: 'CRITICAL' })],
          }),
          baseCriticScore(),
        ],
      }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['critical-finding']);
  });

  test('a domain-inherent CRITICAL finding (not discriminating) on the winner → does NOT block', () => {
    const result = aggregateDesign(
      baseInput({
        critics: [
          baseCriticScore({
            findings: [baseFinding({ option: 'Option A', tag: 'domain-inherent', severity: 'CRITICAL' })],
          }),
          baseCriticScore(),
        ],
      }),
    );
    expect(result.status).toBe('ready');
    expect(result.reasons).toEqual([]);
  });

  test('a discriminating finding with severity NOTABLE (not CRITICAL) on the winner → does NOT block', () => {
    const result = aggregateDesign(
      baseInput({
        critics: [
          baseCriticScore({
            findings: [baseFinding({ option: 'Option A', tag: 'discriminating', severity: 'NOTABLE' })],
          }),
          baseCriticScore(),
        ],
      }),
    );
    expect(result.status).toBe('ready');
  });

  test('a discriminating CRITICAL finding tagged on the LOSING option → does NOT block', () => {
    const result = aggregateDesign(
      baseInput({
        critics: [
          baseCriticScore({
            findings: [baseFinding({ option: 'Option B', tag: 'discriminating', severity: 'CRITICAL' })],
          }),
          baseCriticScore(),
        ],
      }),
    );
    expect(result.status).toBe('ready');
  });
});

describe('aggregateDesign — refactoring impact', () => {
  const breakingRow: RefactoringImpactRow = {
    consumer: 'src/agents/orchestrator.md:90',
    classification: 'BREAKING',
    note: 'dispatch branch depends on the removed field',
  };

  test('Refactoring Impact table contains ≥1 BREAKING consumer → blocked regardless of scores', () => {
    const result = aggregateDesign(
      baseInput({ primary: basePrimaryInput({ refactoring_impact: [breakingRow] }) }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['breaking-consumer']);
  });

  test('DEPRECATION/TRANSPARENT-only refactoring impact rows do NOT block', () => {
    const result = aggregateDesign(
      baseInput({
        primary: basePrimaryInput({
          refactoring_impact: [
            { consumer: 'a.ts:1', classification: 'DEPRECATION', note: 'migrate later' },
            { consumer: 'b.ts:2', classification: 'TRANSPARENT' },
          ],
        }),
      }),
    );
    expect(result.status).toBe('ready');
  });

  test('dominance failure AND a BREAKING row combine into two reasons, deterministic order', () => {
    const result = aggregateDesign(
      baseInput({
        primary: basePrimaryInput({
          per_option_scores: scores(4, 4),
          refactoring_impact: [breakingRow],
        }),
        critics: [
          baseCriticScore({ per_option_scores: scores(4, 4) }),
          baseCriticScore({ per_option_scores: scores(4, 4) }),
        ],
      }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['dominance', 'breaking-consumer']);
  });
});

describe('aggregateDesign — malformed/missing input (fail-safe default)', () => {
  test('only 1 of 2 critics returned → blocked, fail-safe default', () => {
    const result = aggregateDesign(baseInput({ critics: [baseCriticScore()] }));
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['malformed-input']);
    expect(result.scorer_results).toEqual([]);
  });

  test('a critic returned an invalid shape (findings not an array) → blocked, fail-safe default', () => {
    const result = aggregateDesign(
      baseInput({
        critics: [
          baseCriticScore(),
          { per_option_scores: scores(5, 3), findings: undefined as unknown as DesignFinding[] },
        ],
      }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['malformed-input']);
  });

  test('weights that do not sum to 100 → blocked, fail-safe default', () => {
    const result = aggregateDesign(baseInput({ weights: { Risk: 90 } }));
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['malformed-input']);
  });

  test('empty/zero-row trade-off matrix → blocked with a descriptive error, not a throw', () => {
    const result = aggregateDesign(
      baseInput({ primary: basePrimaryInput({ per_option_scores: {} }) }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['malformed-input']);
    expect(result.detail).toMatch(/empty|zero.?row/i);
  });

  test('single-option matrix (no runner-up to compare against) → blocked, fail-safe default', () => {
    const result = aggregateDesign(
      baseInput({ primary: basePrimaryInput({ per_option_scores: { 'Option A': { Risk: 5 } } }) }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['malformed-input']);
  });
});

describe('aggregateDesign — scorer_results shape', () => {
  test('ready verdict reports per-scorer winner and margin for primary + both critics', () => {
    const result = aggregateDesign(baseInput());
    expect(result.scorer_results).toHaveLength(3);
    expect(result.scorer_results.map((r) => r.scorer)).toEqual(['primary', 'critic_a', 'critic_b']);
    for (const r of result.scorer_results) {
      expect(r.winner).toBe('Option A');
      expect(r.margin).toBeCloseTo(40, 5);
    }
  });
});
