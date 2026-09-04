import { readJsonFile } from './lib/fs.ts';

export type Finding = {
  id?: string;
  vcode: string;
  severity: string;
  file: string;
  line: number;
  summary: string;
  issue_ref?: number;
  pr_ref?: number | null;
  gain?: number;
  effort?: number;
  confidence?: number;
  locations?: { file: string; line: number }[];
};

export type RecheckEntry = {
  finding_id: string;
  verdict: 'fixed' | 'not_fixed';
  evidence: string;
};

// Sibling shape to RecheckEntry, distinct meaning (issue #439, V-SEC-07): a recheck
// verdict resolves whether a *prior, already-ledgered* finding was fixed by a later
// commit; a verification verdict resolves whether a security-mode primary reviewer's
// *fresh, same-pass* finding survives an independent second reviewer's attempt to
// disprove it. Kept as its own type — not a repurposing of RecheckEntry, which already
// has a fixed meaning tied to fix-verification (review-core.md § Recheck mode).
export type VerificationEntry = {
  finding_id: string;
  verdict: 'confirmed' | 'refuted';
  evidence: string;
};

export type UnresolvedRecheckEntry = {
  finding_id: string;
  verdict: string;
  reason: string;
};

export type ReviewerInput = {
  status: 'complete' | 'error';
  findings: Finding[];
  recheck?: RecheckEntry[];
  // Present only on the raw JSON a verification spawn (review-core.md § Independent
  // security verification) returns — never on a primary reviewer's own output. Read by
  // the orchestrator and passed to aggregateReview's separate `verification` input
  // below, not consumed from this field directly by aggregateReview itself.
  verification?: VerificationEntry[];
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
  unresolved_recheck: UnresolvedRecheckEntry[];
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

function stampIssueRef(findings: Finding[], issueRef: number): Finding[] {
  return findings.map((finding) => ({
    ...finding,
    issue_ref: finding.issue_ref ?? issueRef,
  }));
}

// Mirrors stampIssueRef's "own value wins" shape — see that function's own comment for the
// dedup-key rationale this stamping order preserves.
function stampPrRef(findings: Finding[], prRef: number | null): Finding[] {
  return findings.map((finding) => ({
    ...finding,
    pr_ref: finding.pr_ref ?? prRef,
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

/**
 * Excludes a prior finding from the collision set when the reviewer's
 * `recheck[]` names it `verdict: fixed` via the ledger `id` — the same
 * "recognize a prior pass's artifact, don't re-collide with it" idempotency
 * pattern as `LOW_CONFIDENCE_CAVEAT_RE` above, applied to a second signal.
 * Exclusion happens before dedup and before the LGTM computation, so a
 * recheck-fixed finding never collides with or suppresses a fresh one at the
 * same file:line. A `recheck` entry whose `finding_id` matches no prior
 * finding's `id` is fail-loud, not silently dropped: it is returned in
 * `unresolved`, and the caller forces `lgtm: false` when `unresolved` is
 * non-empty — an unresolvable linkage must escalate, never pass silently.
 */
function resolveRecheckExclusions(
  prior: Finding[],
  recheck: RecheckEntry[],
): { resolvedPrior: Finding[]; unresolved: UnresolvedRecheckEntry[] } {
  const fixedIds = new Set(
    recheck.filter((r) => r.verdict === 'fixed').map((r) => r.finding_id),
  );
  const matchedIds = new Set(
    prior.filter((f) => f.id && fixedIds.has(f.id)).map((f) => f.id!),
  );
  const unresolved = [...fixedIds]
    .filter((id) => !matchedIds.has(id))
    .map((finding_id) => ({
      finding_id,
      verdict: 'fixed',
      reason: 'no prior finding matched finding_id — linkage could not be resolved',
    }));
  const resolvedPrior = prior.filter((f) => !f.id || !matchedIds.has(f.id));
  return { resolvedPrior, unresolved };
}

/**
 * Downgrades a primary finding when the independent verification spawn (V-SEC-07,
 * issue #439) returns `verdict: 'refuted'` for its `finding_id` — mirrors
 * `resolveRecheckExclusions`'s pre-dedup special-casing of a named `finding_id`, but
 * downgrades rather than excludes: an independently-unreproducible finding stays
 * visible at `WARN` (a paper trail) instead of vanishing, since "could not reproduce"
 * is weaker evidence than "confirmed fixed in a later commit" (recheck's own exclusion
 * case). Only `BLOCK` findings are downgraded (to `WARN`, same one-tier step
 * `applyConfidenceGate` already uses below) — a `confirmed` verdict, or an unmatched
 * `finding_id`, is a no-op.
 */
function applyVerificationDowngrades(
  findings: Finding[],
  verification: VerificationEntry[],
): Finding[] {
  const refutedIds = new Set(
    verification.filter((v) => v.verdict === 'refuted').map((v) => v.finding_id),
  );
  if (refutedIds.size === 0) {
    return findings;
  }
  return findings.map((finding) =>
    finding.severity === 'BLOCK' && finding.id !== undefined && refutedIds.has(finding.id)
      ? { ...finding, severity: 'WARN' }
      : finding,
  );
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
  issueRef: number;
  prRef?: number | null;
  priorFindings?: Finding[];
  // The independent verification spawn's own `verification[]` array (issue #439,
  // V-SEC-07), extracted by the caller from that separate spawn's returned JSON — not
  // read from `input.reviewer.verification`, which is reserved for the raw shape of
  // that spawn's own output, never the primary reviewer's.
  verification?: VerificationEntry[];
}): AggregateOutput {
  if (input.reviewer.status === 'error') {
    return {
      status: 'error',
      findings: [],
      blockers_count: 0,
      lgtm: false,
      pareto_candidates: [],
      unresolved_recheck: [],
      error: input.reviewer.error ?? 'reviewer error',
    };
  }

  const stampedIssueRef = stampIssueRef(input.reviewer.findings, input.issueRef);
  const stamped = stampPrRef(stampedIssueRef, input.prRef ?? null);
  const verified = input.verification?.length
    ? applyVerificationDowngrades(stamped, input.verification)
    : stamped;
  const prior = input.priorFindings ?? [];
  const { resolvedPrior, unresolved } = resolveRecheckExclusions(
    prior,
    input.reviewer.recheck ?? [],
  );
  const gated = applyConfidenceGate([...resolvedPrior, ...verified]);
  const deduped = dedupeFindings(gated);
  const findings = sortFindings(deduped);
  const blockers_count = findings.filter((f) => f.severity === 'BLOCK').length;
  const lgtm =
    input.reviewer.status === 'complete' && blockers_count === 0 && unresolved.length === 0;
  const status = lgtm ? 'approved' : 'changes_requested';

  return {
    status,
    findings,
    blockers_count,
    lgtm,
    pareto_candidates: buildParetoCandidates(findings),
    unresolved_recheck: unresolved,
  };
}

function parseArgs(argv: string[]): {
  reviewerFile?: string;
  issueRef?: string;
  prRef?: string;
  priorFile?: string;
  verificationFile?: string;
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
    } else if (arg === '--verification-file' && argv[i + 1]) {
      out.verificationFile = argv[++i];
    }
  }
  return out;
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

function isVerificationEntryArray(value: unknown): value is VerificationEntry[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      if (typeof entry !== 'object' || entry === null) return false;
      const obj = entry as Record<string, unknown>;
      return (
        typeof obj.finding_id === 'string' &&
        (obj.verdict === 'confirmed' || obj.verdict === 'refuted')
      );
    })
  );
}

if (import.meta.main) {
  const { reviewerFile, issueRef, prRef, priorFile, verificationFile } = parseArgs(process.argv);

  if (!reviewerFile || !issueRef) {
    console.error(
      'Usage: bun run scripts/review-aggregate.ts --reviewer-file <path> --issue-ref <N> [--pr-ref <P>] [--prior-file <ledger-rows.json>] [--verification-file <verification-entries.json>]',
    );
    process.exit(1);
  }

  const issueRefNum = Number(issueRef);
  if (!Number.isInteger(issueRefNum)) {
    console.error(`--issue-ref must be an integer, got: ${issueRef}`);
    process.exit(1);
  }

  let prRefNum: number | null = null;
  if (prRef !== undefined) {
    prRefNum = Number(prRef);
    if (!Number.isInteger(prRefNum)) {
      console.error(`--pr-ref must be an integer, got: ${prRef}`);
      process.exit(1);
    }
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

    let verification: VerificationEntry[] | undefined;
    if (verificationFile) {
      const verificationRaw = readJsonFile(verificationFile, 'verification file');
      if (!isVerificationEntryArray(verificationRaw)) {
        throw new Error(
          'verification file: expected JSON array of { finding_id, verdict, evidence }',
        );
      }
      verification = verificationRaw;
    }

    const result = aggregateReview({
      reviewer: reviewerRaw,
      issueRef: issueRefNum,
      prRef: prRefNum,
      priorFindings,
      verification,
    });
    if (result.unresolved_recheck.length > 0) {
      console.error(
        `${result.unresolved_recheck.length} unresolved_recheck entr${result.unresolved_recheck.length === 1 ? 'y' : 'ies'} — see the "unresolved_recheck" field in stdout output`,
      );
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
