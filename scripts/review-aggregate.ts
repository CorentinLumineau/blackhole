import * as fs from 'fs';

export type Finding = {
  vcode: string;
  severity: string;
  file: string;
  line: number;
  summary: string;
  issue_ref?: string;
  gain?: number;
  effort?: number;
  confidence?: number;
  locations?: { file: string; line: number }[];
};

export type ReviewerInput = {
  status: 'complete' | 'error';
  findings: Finding[];
  error?: string;
};

export type ParetoCandidate = {
  summary: string;
  priority: number;
  file: string;
};

export type AggregateOutput = {
  status: 'approved' | 'changes_requested' | 'error';
  findings: Finding[];
  blockers_count: number;
  lgtm: boolean;
  pareto_candidates: ParetoCandidate[];
  error?: string;
};

const SEVERITY_RANK: Record<string, number> = {
  BLOCK: 3,
  WARN: 2,
  NOTE: 1,
  INFO: 1,
};

function dedupKey(finding: Finding): string {
  return `${finding.vcode}\0${finding.file}\0${finding.line}\0${finding.issue_ref ?? ''}`;
}

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 0;
}

function stampIssueRef(findings: Finding[], issueRef: string): Finding[] {
  return findings.map((finding) => ({
    ...finding,
    issue_ref: finding.issue_ref ?? issueRef,
  }));
}

// Stable idempotency marker: matches a previously-applied caveat regardless of
// the interpolated confidence value, so re-running the gate over an
// already-gated finding never appends a second caveat (V-API-01 fix).
const LOW_CONFIDENCE_CAVEAT_RE =
  /\[low-confidence finding: verify before acting — confidence \d+\]/;

function lowConfidenceCaveat(confidence: number): string {
  return `[low-confidence finding: verify before acting — confidence ${confidence}]`;
}

/**
 * Clamps/validates a raw `confidence` value read from (possibly external)
 * finding data: values below 0 clamp to 0, values above 100 clamp to 100,
 * and anything that isn't a finite number (including `NaN`) is treated as
 * absent (`undefined`, i.e. full confidence). `undefined` stays `undefined`.
 */
function clampConfidence(confidence: unknown): number | undefined {
  if (confidence === undefined) {
    return undefined;
  }
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    return undefined;
  }
  return Math.min(100, Math.max(0, confidence));
}

/**
 * Confidence-band gate (AC1): findings with `confidence < 50` are dropped
 * entirely; `confidence` in `[50, 80]` (inclusive on both ends) survive but
 * are downgraded from `BLOCK` to `WARN` (never BLOCK in this band) and carry
 * an explicit caveat in `summary` naming the finding's actual confidence
 * value; `confidence > 80` (or absent, i.e. full confidence) pass through
 * unchanged. Mirrors `reviewer.md` §11 / `review-core.md`'s documented band
 * boundaries as the deterministic backstop. Idempotent: re-running the gate
 * over findings that already carry the caveat marker is a no-op — it does
 * not append the marker a second time.
 */
export function applyConfidenceGate(findings: Finding[]): Finding[] {
  return findings
    .map((finding) => {
      const clamped = clampConfidence(finding.confidence);
      return clamped === finding.confidence ? finding : { ...finding, confidence: clamped };
    })
    .filter((finding) => finding.confidence === undefined || finding.confidence >= 50)
    .map((finding) => {
      if (finding.confidence === undefined || finding.confidence > 80) {
        return finding;
      }

      const alreadyGated = LOW_CONFIDENCE_CAVEAT_RE.test(finding.summary);

      return {
        ...finding,
        severity: finding.severity === 'BLOCK' ? 'WARN' : finding.severity,
        summary: alreadyGated
          ? finding.summary
          : `${finding.summary} ${lowConfidenceCaveat(finding.confidence)}`,
      };
    });
}

export function dedupeFindings(findings: Finding[]): Finding[] {
  const byKey = new Map<string, Finding>();

  for (const finding of findings) {
    const key = dedupKey(finding);
    const existing = byKey.get(key);
    if (!existing || severityRank(finding.severity) > severityRank(existing.severity)) {
      byKey.set(key, finding);
    }
  }

  return [...byKey.values()];
}

export function paretoPriority(gain: number, effort: number): number {
  return gain * (11 - effort);
}

export function buildParetoCandidates(findings: Finding[]): ParetoCandidate[] {
  return findings
    .filter(
      (finding) =>
        finding.vcode === 'V-PARETO-02' &&
        typeof finding.gain === 'number' &&
        typeof finding.effort === 'number',
    )
    .map((finding) => ({
      summary: finding.summary,
      priority: paretoPriority(finding.gain!, finding.effort!),
      file: finding.file,
    }))
    .sort((a, b) => b.priority - a.priority);
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const severityDiff = severityRank(b.severity) - severityRank(a.severity);
    if (severityDiff !== 0) return severityDiff;

    if (a.vcode === 'V-PARETO-02' && b.vcode === 'V-PARETO-02') {
      const aPriority =
        typeof a.gain === 'number' && typeof a.effort === 'number'
          ? paretoPriority(a.gain, a.effort)
          : 0;
      const bPriority =
        typeof b.gain === 'number' && typeof b.effort === 'number'
          ? paretoPriority(b.gain, b.effort)
          : 0;
      return bPriority - aPriority;
    }

    return 0;
  });
}

export function aggregateReview(input: {
  reviewer: ReviewerInput;
  issueRef: string;
  priorFindings?: Finding[];
}): AggregateOutput {
  if (input.reviewer.status === 'error') {
    return {
      status: 'error',
      findings: [],
      blockers_count: 0,
      lgtm: false,
      pareto_candidates: [],
      error: input.reviewer.error ?? 'reviewer error',
    };
  }

  const stamped = stampIssueRef(input.reviewer.findings, input.issueRef);
  const prior = input.priorFindings ?? [];
  const gated = applyConfidenceGate([...prior, ...stamped]);
  const deduped = dedupeFindings(gated);
  const findings = sortFindings(deduped);
  const blockers_count = findings.filter((f) => f.severity === 'BLOCK').length;
  const lgtm = input.reviewer.status === 'complete' && blockers_count === 0;
  const status = lgtm ? 'approved' : 'changes_requested';

  return {
    status,
    findings,
    blockers_count,
    lgtm,
    pareto_candidates: buildParetoCandidates(findings),
  };
}

function parseArgs(argv: string[]): {
  reviewerFile?: string;
  issueRef?: string;
  prRef?: string;
  priorFile?: string;
} {
  const out: ReturnType<typeof parseArgs> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--reviewer-file' && argv[i + 1]) {
      out.reviewerFile = argv[++i];
    } else if (arg === '--issue-ref' && argv[i + 1]) {
      out.issueRef = argv[++i];
    } else if (arg === '--pr-ref' && argv[i + 1]) {
      out.prRef = argv[++i];
    } else if (arg === '--prior-file' && argv[i + 1]) {
      out.priorFile = argv[++i];
    }
  }
  return out;
}

function readJsonFile(path: string, label: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf-8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }
}

function isReviewerInput(value: unknown): value is ReviewerInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    (obj.status === 'complete' || obj.status === 'error') &&
    Array.isArray(obj.findings)
  );
}

function isFindingArray(value: unknown): value is Finding[] {
  return Array.isArray(value);
}

if (import.meta.main) {
  const { reviewerFile, issueRef, priorFile } = parseArgs(process.argv);

  if (!reviewerFile || !issueRef) {
    console.error(
      'Usage: bun run scripts/review-aggregate.ts --reviewer-file <path> --issue-ref <N> [--pr-ref <P>] [--prior-file <ledger-rows.json>]',
    );
    process.exit(1);
  }

  try {
    const reviewerRaw = readJsonFile(reviewerFile, 'reviewer file');
    if (!isReviewerInput(reviewerRaw)) {
      throw new Error('reviewer file: invalid reviewer JSON shape');
    }

    let priorFindings: Finding[] | undefined;
    if (priorFile) {
      const priorRaw = readJsonFile(priorFile, 'prior file');
      if (!isFindingArray(priorRaw)) {
        throw new Error('prior file: expected JSON array');
      }
      priorFindings = priorRaw;
    }

    const result = aggregateReview({
      reviewer: reviewerRaw,
      issueRef,
      priorFindings,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
