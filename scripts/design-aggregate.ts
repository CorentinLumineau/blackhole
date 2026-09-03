import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from './lib/fs.ts';
import { hasPostAcceptanceAmendmentSection } from './checks/adr-supersession.check.ts';

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

/** A single ADR citation drafted as decisive evidence for an option — self-declared by the
 *  scorer that made it (primary or a blind critic, issue #775). `has_amendment` is never
 *  self-reported: it is ground truth the CLI-layer `resolveAdrAmendmentTruth` resolves from the
 *  live ADR tree before `aggregateDesign` runs (Design Decision 2) — absent on citations as
 *  drafted by a scorer, present once resolved. */
export type AdrCitation = {
  adr: string;
  option: string;
  amendment_acknowledged: boolean;
  has_amendment?: boolean;
};

/** The primary planner's own weighted matrix, refactoring-impact scan, and (optionally) ADR
 *  citations — one of the three scorers `computeScorerVerdict` compares. */
export type PrimaryDesignInput = {
  per_option_scores: Record<string, ColumnScore>;
  refactoring_impact: RefactoringImpactRow[];
  adr_citations?: AdrCitation[];
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
  adr_citations?: AdrCitation[];
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
  | 'unverified-adr-citation'
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

function isAdrCitation(value: unknown): value is AdrCitation {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.adr === 'string' &&
    typeof obj.option === 'string' &&
    typeof obj.amendment_acknowledged === 'boolean' &&
    (obj.has_amendment === undefined || typeof obj.has_amendment === 'boolean')
  );
}

function isAdrCitationArray(value: unknown): value is AdrCitation[] {
  return Array.isArray(value) && value.every(isAdrCitation);
}

function isCriticScore(value: unknown): value is CriticScore {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.per_option_scores !== 'object' || obj.per_option_scores === null) return false;
  if (!Object.values(obj.per_option_scores as Record<string, unknown>).every(isColumnScore)) {
    return false;
  }
  if (!Array.isArray(obj.findings)) return false;
  if (!obj.findings.every((f) => isDesignFinding(f))) return false;
  if (obj.adr_citations !== undefined && !isAdrCitationArray(obj.adr_citations)) return false;
  return true;
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
  if (input.primary.adr_citations !== undefined && !isAdrCitationArray(input.primary.adr_citations)) {
    return 'primary.adr_citations has a malformed entry (expected { adr, option, amendment_acknowledged })';
  }

  if (!Array.isArray(input.critics) || input.critics.length !== 2) {
    return `expected exactly 2 critic scores, got ${Array.isArray(input.critics) ? input.critics.length : 'non-array'}`;
  }
  for (const [i, critic] of input.critics.entries()) {
    if (!isCriticScore(critic)) {
      return `critic ${i} has an invalid shape (expected { per_option_scores, findings })`;
    }
  }

  // Every scorer must score every weights column for every option — a missing column would
  // otherwise silently score as 0 in weightedTotal and can flip the verdict (fail-safe: block).
  const weightColumns = Object.keys(input.weights);
  const scorers: Array<[string, Record<string, ColumnScore>]> = [
    ['primary', input.primary.per_option_scores],
    ['critic 0', input.critics[0].per_option_scores],
    ['critic 1', input.critics[1].per_option_scores],
  ];
  for (const [scorer, perOptionScores] of scorers) {
    for (const [option, columnScore] of Object.entries(perOptionScores)) {
      for (const column of weightColumns) {
        if (!(column in columnScore)) {
          return `${scorer} is missing weights column "${column}" for option "${option}"`;
        }
      }
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

/** True when any declared citation — primary or either critic — names an ADR that ground truth
 *  (`has_amendment`) confirms carries a `## Post-acceptance amendments` section the scorer never
 *  acknowledged. Only `has_amendment`, resolved by the CLI-layer `resolveAdrAmendmentTruth`,
 *  decides this — never `amendment_acknowledged` alone (Design Decision 2: a scorer that
 *  mistakenly believes an ADR has no amendments must not silently pass this gate). */
function hasUnverifiedCitation(primary: PrimaryDesignInput, critics: CriticScore[]): boolean {
  const allCitations = [
    ...(primary.adr_citations ?? []),
    ...critics.flatMap((c) => c.adr_citations ?? []),
  ];
  return allCitations.some((c) => c.has_amendment === true && !c.amendment_acknowledged);
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

  if (hasUnverifiedCitation(input.primary, input.critics)) reasons.push('unverified-adr-citation');

  const status = reasons.length === 0 ? 'ready' : 'blocked';

  return {
    status,
    winner: status === 'ready' ? candidateWinner : null,
    reasons,
    scorer_results: scorerResults,
  };
}

// Design Decision 1 (issue #775) — a trivial 3-line duplicate of
// adr-supersession.check.ts's own findAdrFileByNumber, kept local rather than exported from
// that file. The issue scopes V-ADR-06's own detection logic Out; this keeps that file's diff
// at zero while still reusing its one substantive export, hasPostAcceptanceAmendmentSection
// (Codebase Conventions table). The codebase already tolerates this exact small duplicate twice
// (adr-supersession.check.ts, links.check.ts) without flagging it as DRY debt.
function findAdrFileByNumber(decisionsDir: string, adrRef: string): string | null {
  if (!fs.existsSync(decisionsDir)) return null;
  const found = fs.readdirSync(decisionsDir).find((f) => f.startsWith(`${adrRef}-`));
  return found ? path.join(decisionsDir, found) : null;
}

/**
 * CLI-layer only — never called from inside the pure `aggregateDesign`, which must perform no
 * fs reads. Resolves ground truth (`has_amendment`) for every declared `adr_citations[]` entry
 * on the primary and both critics from the live ADR tree under `decisionsDir`, discarding any
 * `has_amendment` a scorer may have supplied (Design Decision 2). An ADR reference that does not
 * resolve to a file fails open — `has_amendment: false`, never blocks (Design Decision 3).
 */
export function resolveAdrAmendmentTruth(
  input: DesignAggregateInput,
  decisionsDir: string,
): DesignAggregateInput {
  const cache = new Map<string, boolean>();
  const resolve = (adr: string): boolean => {
    const cached = cache.get(adr);
    if (cached !== undefined) return cached;
    const file = findAdrFileByNumber(decisionsDir, adr);
    const value = file ? hasPostAcceptanceAmendmentSection(fs.readFileSync(file, 'utf-8')) : false;
    cache.set(adr, value);
    return value;
  };
  const resolveCitations = (citations?: AdrCitation[]): AdrCitation[] | undefined =>
    citations?.map((c) => ({ ...c, has_amendment: resolve(c.adr) }));

  return {
    ...input,
    primary: { ...input.primary, adr_citations: resolveCitations(input.primary.adr_citations) },
    critics: input.critics.map((c) => ({ ...c, adr_citations: resolveCitations(c.adr_citations) })),
  };
}

function parseArgs(argv: string[]): { inputFile?: string; repoRoot?: string } {
  const out: ReturnType<typeof parseArgs> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input-file' && argv[i + 1]) {
      out.inputFile = argv[++i];
    } else if (arg === '--repo-root' && argv[i + 1]) {
      out.repoRoot = argv[++i];
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
  const { inputFile, repoRoot } = parseArgs(process.argv);

  if (!inputFile) {
    console.error(
      'Usage: bun run scripts/design-aggregate.ts --input-file <path> [--repo-root <path>]',
    );
    process.exit(1);
  }

  try {
    const raw = readJsonFile(inputFile, 'design-aggregate input file');
    if (!isDesignAggregateInput(raw)) {
      throw new Error('input file: invalid DesignAggregateInput JSON shape');
    }

    const decisionsDir = path.join(repoRoot ?? process.cwd(), 'documentation', 'decisions');
    const resolved = resolveAdrAmendmentTruth(raw, decisionsDir);
    const result = aggregateDesign(resolved);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
