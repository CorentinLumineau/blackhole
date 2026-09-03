import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  aggregateDesign,
  resolveAdrAmendmentTruth,
  type AdrCitation,
  type ColumnScore,
  type ColumnWeights,
  type CriticScore,
  type DesignAggregateInput,
  type DesignFinding,
  type PrimaryDesignInput,
  type RefactoringImpactRow,
} from './design-aggregate';
import { withTempDir } from './lib/test-fixtures.ts';

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

describe('aggregateDesign — ADR citation gate (issue #775, V-ADR-06 reader)', () => {
  // has_amendment is a resolved-ground-truth field the CLI layer attaches via
  // resolveAdrAmendmentTruth (see the describe block below) — set directly here so these cases
  // exercise the pure gate logic in aggregateDesign without touching the filesystem.
  const citation = (overrides: Partial<AdrCitation> = {}): AdrCitation => ({
    adr: 'ADR-007',
    option: 'Option A',
    amendment_acknowledged: false,
    has_amendment: true,
    ...overrides,
  });

  test('primary cites an amended ADR without acknowledging it → blocked, unverified-adr-citation', () => {
    const result = aggregateDesign(
      baseInput({ primary: basePrimaryInput({ adr_citations: [citation()] }) }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['unverified-adr-citation']);
  });

  test('either critic cites an amended ADR without acknowledging it → blocked, unverified-adr-citation', () => {
    const result = aggregateDesign(
      baseInput({
        critics: [baseCriticScore({ adr_citations: [citation()] }), baseCriticScore()],
      }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['unverified-adr-citation']);
  });

  test('an acknowledged citation to an amended ADR does not block', () => {
    const result = aggregateDesign(
      baseInput({
        primary: basePrimaryInput({ adr_citations: [citation({ amendment_acknowledged: true })] }),
      }),
    );
    expect(result.status).toBe('ready');
    expect(result.reasons).toEqual([]);
  });

  test('a citation to a non-amended ADR never blocks, regardless of amendment_acknowledged', () => {
    const result = aggregateDesign(
      baseInput({
        primary: basePrimaryInput({
          adr_citations: [citation({ has_amendment: false, amendment_acknowledged: false })],
        }),
      }),
    );
    expect(result.status).toBe('ready');
    expect(result.reasons).toEqual([]);
  });

  test('a malformed adr_citations[] entry is caught by validateInput as malformed-input', () => {
    const result = aggregateDesign(
      baseInput({
        primary: basePrimaryInput({
          adr_citations: [{ adr: 'ADR-007' } as unknown as AdrCitation],
        }),
      }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['malformed-input']);
  });

  test('absent adr_citations on both primary and critics behaves exactly as before this change', () => {
    const result = aggregateDesign(baseInput());
    expect(result.status).toBe('ready');
    expect(result.reasons).toEqual([]);
    expect(result.winner).toBe('Option A');
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

  // Regression: a missing rubric column must never silently score as 0 — omitting one column
  // for the runner-up used to flip the verdict from blocked to ready with the wrong winner.
  test('primary omits a weights column for one option → blocked, not a silent 0 score', () => {
    const multiWeights: ColumnWeights = { Simplicity: 30, Performance: 30, Maintainability: 40 };
    const complete: Record<string, ColumnScore> = {
      'Option A': { Simplicity: 4, Performance: 4, Maintainability: 3 },
      'Option B': { Simplicity: 3, Performance: 3, Maintainability: 5 },
    };
    const missingColumn: Record<string, ColumnScore> = {
      ...complete,
      'Option B': { Simplicity: 3, Performance: 3 }, // Maintainability omitted
    };
    const result = aggregateDesign(
      baseInput({
        weights: multiWeights,
        primary: basePrimaryInput({ per_option_scores: missingColumn }),
        critics: [
          baseCriticScore({ per_option_scores: complete }),
          baseCriticScore({ per_option_scores: complete }),
        ],
      }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['malformed-input']);
    expect(result.detail).toMatch(/Maintainability/);
  });

  test('a critic omits a weights column for one option → blocked, fail-safe default', () => {
    const multiWeights: ColumnWeights = { Simplicity: 50, Risk: 50 };
    const complete: Record<string, ColumnScore> = {
      'Option A': { Simplicity: 5, Risk: 4 },
      'Option B': { Simplicity: 3, Risk: 3 },
    };
    const result = aggregateDesign(
      baseInput({
        weights: multiWeights,
        primary: basePrimaryInput({ per_option_scores: complete }),
        critics: [
          baseCriticScore({ per_option_scores: complete }),
          baseCriticScore({
            per_option_scores: {
              ...complete,
              'Option A': { Simplicity: 5 }, // Risk omitted
            },
          }),
        ],
      }),
    );
    expect(result.status).toBe('blocked');
    expect(result.reasons).toEqual(['malformed-input']);
    expect(result.detail).toMatch(/Risk/);
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

// AMENDED_ADR / UNAMENDED_ADR fixtures mirror verify.adr-supersession.test.ts's own fixtures —
// resolveAdrAmendmentTruth is a thin CLI-layer wrapper around the same
// hasPostAcceptanceAmendmentSection export that file already tests against these bodies.
const AMENDED_ADR = `---\ntype: adr\nstatus: accepted\n---\n\n# ADR-007: Fixture\n\n## Post-acceptance amendments\n\n- 2026-09-02 — #712 reverses R3′.\n`;
const UNAMENDED_ADR = `---\ntype: adr\nstatus: accepted\n---\n\n# ADR-007: Fixture\n`;

describe('resolveAdrAmendmentTruth (CLI-layer ground-truth resolver)', () => {
  test('resolves has_amendment: true for a cited ADR carrying the amendments section', () => {
    withTempDir('design-aggregate-', (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'ADR-007-fixture.md'), AMENDED_ADR);

      const input = baseInput({
        primary: basePrimaryInput({
          adr_citations: [{ adr: 'ADR-007', option: 'Option A', amendment_acknowledged: false }],
        }),
      });
      const resolved = resolveAdrAmendmentTruth(input, dir);
      expect(resolved.primary.adr_citations).toEqual([
        { adr: 'ADR-007', option: 'Option A', amendment_acknowledged: false, has_amendment: true },
      ]);
    });
  });

  test('resolves has_amendment: false for a cited ADR without the amendments section', () => {
    withTempDir('design-aggregate-', (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'ADR-007-fixture.md'), UNAMENDED_ADR);

      const input = baseInput({
        primary: basePrimaryInput({
          adr_citations: [{ adr: 'ADR-007', option: 'Option A', amendment_acknowledged: false }],
        }),
      });
      const resolved = resolveAdrAmendmentTruth(input, dir);
      expect(resolved.primary.adr_citations?.[0].has_amendment).toBe(false);
    });
  });

  test('an unresolvable ADR reference fails open — has_amendment: false, never blocks (Design Decision 3)', () => {
    withTempDir('design-aggregate-', (dir) => {
      const input = baseInput({
        primary: basePrimaryInput({
          adr_citations: [{ adr: 'ADR-999', option: 'Option A', amendment_acknowledged: false }],
        }),
      });
      const resolved = resolveAdrAmendmentTruth(input, dir);
      expect(resolved.primary.adr_citations?.[0].has_amendment).toBe(false);
      expect(aggregateDesign(resolved).status).toBe('ready');
    });
  });

  test('resolves citations on both critics independently of the primary', () => {
    withTempDir('design-aggregate-', (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'ADR-007-fixture.md'), AMENDED_ADR);

      const input = baseInput({
        critics: [
          baseCriticScore({
            adr_citations: [{ adr: 'ADR-007', option: 'Option A', amendment_acknowledged: false }],
          }),
          baseCriticScore(),
        ],
      });
      const resolved = resolveAdrAmendmentTruth(input, dir);
      expect(resolved.critics[0].adr_citations?.[0].has_amendment).toBe(true);
    });
  });
});
