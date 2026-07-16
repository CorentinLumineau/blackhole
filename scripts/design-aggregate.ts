import { readJsonFile } from './lib/fs.ts';

// ADR-010 D4 — deterministic Design Track verdict script. Same shape as review-aggregate.ts
// (ADR-003): pure aggregateDesign(input) core, typed I/O, CLI entrypoint reading via the shared
// readJsonFile helper, no side effects beyond stdout. The planner (`planner.md` §4.8) reads only
// this script's `status` field — it never self-certifies.

/** One score per rubric column (`design-rubric.md`), on the fixed 1-5 scale. */
export type ColumnScore = Record<string, number>;

/** Fixed rubric weights for the decision's type (`design-rubric.md`) — weights sum to 100 and
 *  apply identically to the primary and both critics (this is what makes "blind" scoring
 *  comparable across all three scorers). */
export type ColumnWeights = Record<string, number>;

export type RefactoringImpactRow = {
  consumer: string;
  classification: 'BREAKING' | 'DEPRECATION' | 'TRANSPARENT';
  note?: string;
};

export type PrimaryDesignInput = {
  per_option_scores: Record<string, ColumnScore>;
  refactoring_impact: RefactoringImpactRow[];
};

export type DesignFinding = {
  option: string;
  tag: 'discriminating' | 'domain-inherent';
  severity: 'CRITICAL' | 'NOTABLE' | 'MINOR';
  note: string;
};

/** Returned by the two blind critique-only sub-invocations (`planner.md` §4.3,
 *  `worker-schemas.md` § Design Track Critic). */
export type CriticScore = {
  per_option_scores: Record<string, ColumnScore>;
  findings: DesignFinding[];
};

export type DesignAggregateInput = {
  weights: ColumnWeights;
  primary: PrimaryDesignInput;
  critics: CriticScore[];
  /** Percentage dominance margin an option must exceed (not merely meet) over the runner-up,
   *  under every scorer, to be eligible for `ready`. Defaults to 30 (`autonomy.design_dominance_delta`). */
  design_dominance_delta?: number;
};

export type ScorerName = 'primary' | 'critic_a' | 'critic_b';

export type ScorerVerdict = {
  scorer: ScorerName;
  winner: string | null;
  margin: number | null;
};

export type DesignAggregateReason =
  | 'dominance'
  | 'disagreement'
  | 'critical-finding'
  | 'breaking-consumer'
  | 'malformed-input';

export type DesignAggregateOutput = {
  status: 'ready' | 'blocked';
  winner: string | null;
  reasons: DesignAggregateReason[];
  scorer_results: ScorerVerdict[];
  /** Human-readable detail, populated for `malformed-input` (V-API-01 style diagnostic — never
   *  a throw for a bad-shaped-but-parseable input, per Stop Condition 1). */
  detail?: string;
};

const DEFAULT_DOMINANCE_DELTA = 30;
const WEIGHT_SUM_TOLERANCE = 0.001;

function isColumnScore(value: unknown): value is ColumnScore {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (v) => typeof v === 'number' && Number.isFinite(v),
  );
}

function isCriticScore(value: unknown): value is CriticScore {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.per_option_scores !== 'object' || obj.per_option_scores === null) return false;
  if (!Object.values(obj.per_option_scores as Record<string, unknown>).every(isColumnScore)) {
    return false;
  }
  if (!Array.isArray(obj.findings)) return false;
  return obj.findings.every((f) => isDesignFinding(f));
}

function isDesignFinding(value: unknown): value is DesignFinding {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.option === 'string' &&
    (obj.tag === 'discriminating' || obj.tag === 'domain-inherent') &&
    (obj.severity === 'CRITICAL' || obj.severity === 'NOTABLE' || obj.severity === 'MINOR') &&
    typeof obj.note === 'string'
  );
}

/** Validates the aggregation input's shape and invariants before any scoring runs. Returns a
 *  descriptive error string on any anomaly, or `null` when the input is well-formed — the
 *  fail-safe default this function backstops is "any aggregation-input anomaly → blocked", not
 *  a thrown exception (Stop Condition 1). */
function validateInput(input: DesignAggregateInput): string | null {
  if (!input.weights || typeof input.weights !== 'object' || Array.isArray(input.weights)) {
    return 'missing or invalid weights';
  }
  const weightValues = Object.values(input.weights);
  if (weightValues.length === 0) {
    return 'weights must declare at least one column';
  }
  const weightSum = weightValues.reduce((sum, w) => sum + w, 0);
  if (Math.abs(weightSum - 100) > WEIGHT_SUM_TOLERANCE) {
    return `weights must sum to 100 (got ${weightSum})`;
  }

  if (!input.primary || typeof input.primary !== 'object') {
    return 'missing primary input';
  }
  if (!Array.isArray(input.primary.refactoring_impact)) {
    return 'primary.refactoring_impact must be an array';
  }
  const options = Object.keys(input.primary.per_option_scores ?? {});
  if (options.length === 0) {
    return 'empty/zero-row trade-off matrix — primary.per_option_scores has no options';
  }
  if (options.length < 2) {
    return 'trade-off matrix has fewer than 2 options — no runner-up to compare against';
  }
  if (!Object.values(input.primary.per_option_scores).every(isColumnScore)) {
    return 'primary.per_option_scores has a malformed column-score entry';
  }

  if (!Array.isArray(input.critics) || input.critics.length !== 2) {
    return `expected exactly 2 critic scores, got ${Array.isArray(input.critics) ? input.critics.length : 'non-array'}`;
  }
  for (const [i, critic] of input.critics.entries()) {
    if (!isCriticScore(critic)) {
      return `critic ${i} has an invalid shape (expected { per_option_scores, findings }))`;
    }
  }

  return null;
}

function weightedTotal(scores: ColumnScore, weights: ColumnWeights): number {
  let total = 0;
  for (const [column, weight] of Object.entries(weights)) {
    total += (scores[column] ?? 0) * weight;
  }
  return total / 100;
}

function computeScorerVerdict(
  scorer: ScorerName,
  perOptionScores: Record<string, ColumnScore>,
  weights: ColumnWeights,
): ScorerVerdict {
  const totals = Object.entries(perOptionScores)
    .map(([option, columnScore]) => ({ option, total: weightedTotal(columnScore, weights) }))
    .sort((a, b) => b.total - a.total);

  const [top, runnerUp] = totals;
  if (!top) return { scorer, winner: null, margin: null };

  const margin = runnerUp && top.total > 0 ? ((top.total - runnerUp.total) / top.total) * 100 : 0;
  return { scorer, winner: top.option, margin };
}

function findDiscriminatingCriticalOnWinner(critics: CriticScore[], winner: string): boolean {
  return critics.some((critic) =>
    critic.findings.some(
      (f) => f.option === winner && f.tag === 'discriminating' && f.severity === 'CRITICAL',
    ),
  );
}

/**
 * Pure deterministic verdict: computes `ready` or `blocked` from the primary's weighted matrix
 * plus both critics' JSON, per ADR-010 D4's three-condition gate. Any single failed condition
 * blocks — the planner cannot self-certify a `ready` the script did not compute.
 */
export function aggregateDesign(input: DesignAggregateInput): DesignAggregateOutput {
  const malformedDetail = validateInput(input);
  if (malformedDetail) {
    return {
      status: 'blocked',
      winner: null,
      reasons: ['malformed-input'],
      scorer_results: [],
      detail: malformedDetail,
    };
  }

  const delta = input.design_dominance_delta ?? DEFAULT_DOMINANCE_DELTA;

  const scorerResults: ScorerVerdict[] = [
    computeScorerVerdict('primary', input.primary.per_option_scores, input.weights),
    computeScorerVerdict('critic_a', input.critics[0].per_option_scores, input.weights),
    computeScorerVerdict('critic_b', input.critics[1].per_option_scores, input.weights),
  ];

  const reasons: DesignAggregateReason[] = [];

  const allDominant = scorerResults.every((r) => r.margin !== null && r.margin > delta);
  if (!allDominant) reasons.push('dominance');

  const winners = scorerResults.map((r) => r.winner);
  const allSameWinner = winners.every((w) => w !== null && w === winners[0]);
  if (!allSameWinner) reasons.push('disagreement');

  const candidateWinner = allSameWinner ? winners[0] : null;

  if (candidateWinner && findDiscriminatingCriticalOnWinner(input.critics, candidateWinner)) {
    reasons.push('critical-finding');
  }

  const hasBreakingConsumer = input.primary.refactoring_impact.some(
    (row) => row.classification === 'BREAKING',
  );
  if (hasBreakingConsumer) reasons.push('breaking-consumer');

  const status = reasons.length === 0 ? 'ready' : 'blocked';

  return {
    status,
    winner: status === 'ready' ? candidateWinner : null,
    reasons,
    scorer_results: scorerResults,
  };
}

function parseArgs(argv: string[]): { inputFile?: string } {
  const out: ReturnType<typeof parseArgs> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input-file' && argv[i + 1]) {
      out.inputFile = argv[++i];
    }
  }
  return out;
}

function isDesignAggregateInput(value: unknown): value is DesignAggregateInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.weights === 'object' &&
    obj.weights !== null &&
    typeof obj.primary === 'object' &&
    obj.primary !== null &&
    Array.isArray(obj.critics)
  );
}

if (import.meta.main) {
  const { inputFile } = parseArgs(process.argv);

  if (!inputFile) {
    console.error('Usage: bun run scripts/design-aggregate.ts --input-file <path>');
    process.exit(1);
  }

  try {
    const raw = readJsonFile(inputFile, 'design-aggregate input file');
    if (!isDesignAggregateInput(raw)) {
      throw new Error('input file: invalid DesignAggregateInput JSON shape');
    }

    const result = aggregateDesign(raw);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
