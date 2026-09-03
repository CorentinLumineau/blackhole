import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { makeTempDir } from '../fs.ts';
import {
  extractCreatedDate,
  mergeReadinessForReviewPromotion,
  reviewArtifactContentMatchesLedger,
} from './review-artifact.ts';
import type { LedgerFile } from '../promote-review-artifact.ts';
import { reviewTargetPath } from '../concern-slug.ts';

// Issue #806 — `manifestHasReviewRoute` was circular by construction (it trusted a manifest
// entry written by the same party the check exists to verify). This suite replaces the removed
// manifest leg with a content-verification leg: re-render the expected review markdown from the
// live findings ledger (`renderReviewMarkdown`, a pure function the promoter does not control)
// and diff it against the committed file.

const fixturesDir = path.resolve(import.meta.dirname, '../../../fixtures/staging');

const ledger = JSON.parse(
  fs.readFileSync(path.join(fixturesDir, 'review-ledger-sample.json'), 'utf-8'),
) as LedgerFile;

const correctMarkdown = fs.readFileSync(path.join(fixturesDir, 'review-artifact-correct.md'), 'utf-8');
const driftedMarkdown = fs.readFileSync(path.join(fixturesDir, 'review-artifact-drifted.md'), 'utf-8');

const issueTitle = 'Fix review-artifact merge gate content check';
const issueNumber = 900;
const targetPath = reviewTargetPath(issueTitle, issueNumber);

const baseOpts = {
  issueTitle,
  issueNumber,
  prNumber: 901,
  branchName: 'blackhole/issue-900',
  headSha: 'abc1234def5678900000000000000000000000',
  ledger,
};

let repoRoot: string;

// Writes `content` at `<repoRoot>/documentation/reviews/<slug>.md` — the same path
// `reviewTargetPath` computes, so `reviewArtifactContentMatchesLedger` finds it via `repoRoot`.
function commitArtifact(content: string): void {
  const full = path.join(repoRoot, targetPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  repoRoot = makeTempDir('review-artifact-check');
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe('extractCreatedDate', () => {
  test('extracts the created: frontmatter value', () => {
    expect(extractCreatedDate(correctMarkdown)).toBe('2026-08-05');
  });

  test('returns undefined when no created: line is present', () => {
    expect(extractCreatedDate('# no frontmatter here')).toBeUndefined();
  });
});

describe('reviewArtifactContentMatchesLedger', () => {
  test('passes when committed content byte-for-byte matches the ledger re-render (AC2, AC6)', () => {
    commitArtifact(correctMarkdown);
    const result = reviewArtifactContentMatchesLedger({ ...baseOpts, repoRoot });
    expect(result.ok).toBe(true);
  });

  test('is insensitive to the check own invocation date (AC3, cross-midnight)', () => {
    commitArtifact(correctMarkdown);
    // The fixture is dated 2026-08-05; the real invocation date is whatever `today` resolves to
    // when this suite runs. Proves the re-render pins `today` from the committed file's own
    // `created:` line rather than `new Date()`, so promotion and verification landing on
    // different calendar days never causes a spurious mismatch.
    expect(new Date().toISOString().slice(0, 10)).not.toBe('2026-08-05');
    const result = reviewArtifactContentMatchesLedger({ ...baseOpts, repoRoot });
    expect(result.ok).toBe(true);
  });

  test('fails with a reason naming the target path when the file is missing', () => {
    const result = reviewArtifactContentMatchesLedger({ ...baseOpts, repoRoot });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(targetPath);
  });

  test('fails when the ledger carries a finding not reflected in committed content', () => {
    commitArtifact(correctMarkdown);
    const ledgerWithExtraFinding: LedgerFile = {
      findings: [
        ...ledger.findings,
        {
          id: 'F-00902',
          vcode: 'V-SEC-01',
          severity: 'BLOCK',
          phase: 'review',
          issue_ref: issueNumber,
          pr_ref: 901,
          file: 'scripts/lib/example.ts',
          line: 99,
          summary: 'Newly discovered injection risk',
          status: 'open',
        },
      ],
    };
    const result = reviewArtifactContentMatchesLedger({
      ...baseOpts,
      ledger: ledgerWithExtraFinding,
      repoRoot,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(targetPath);
  });

  test('fails on PR #773 shape: committed content claims LGTM while the ledger has an unresolved BLOCK (AC5)', () => {
    commitArtifact(driftedMarkdown);
    const result = reviewArtifactContentMatchesLedger({ ...baseOpts, repoRoot });
    expect(result.ok).toBe(false);
  });

  test('fails when the committed content drops the ### Deferred section the ledger still requires (AC5)', () => {
    const withoutDeferredSection = correctMarkdown.replace(/\n### Deferred[\s\S]*$/, '\n');
    commitArtifact(withoutDeferredSection);
    const result = reviewArtifactContentMatchesLedger({ ...baseOpts, repoRoot });
    expect(result.ok).toBe(false);
  });
});

describe('mergeReadinessForReviewPromotion', () => {
  test('governance off short-circuits to ok:true without reading the ledger or filesystem', () => {
    const result = mergeReadinessForReviewPromotion({
      ...baseOpts,
      prDiffPaths: [],
      config: { enabled: false, write_governance: true },
      repoRoot,
    });
    expect(result.ok).toBe(true);
  });

  test('ok:true for a correctly-promoted artifact with no staged manifest of any kind present (AC1, AC6)', () => {
    commitArtifact(correctMarkdown);
    // No `.blackhole/staged/<n>/manifest.json` is written anywhere under repoRoot — the removed
    // manifest leg cannot be silently reintroduced through an implicit default.
    expect(fs.existsSync(path.join(repoRoot, '.blackhole'))).toBe(false);
    const result = mergeReadinessForReviewPromotion({
      ...baseOpts,
      prDiffPaths: [targetPath],
      config: { enabled: true, write_governance: true },
      repoRoot,
    });
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  test('ok:false when the PR diff omits the target path entirely', () => {
    const result = mergeReadinessForReviewPromotion({
      ...baseOpts,
      prDiffPaths: [],
      config: { enabled: true, write_governance: true },
      repoRoot,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes(targetPath))).toBe(true);
  });

  test('does not double-report a missing file as both presence and content failures', () => {
    const result = mergeReadinessForReviewPromotion({
      ...baseOpts,
      prDiffPaths: [],
      config: { enabled: true, write_governance: true },
      repoRoot,
    });
    expect(result.reasons).toHaveLength(1);
  });

  test('ok:false end-to-end for the drifted PR #773 shape even though the file is present in the diff', () => {
    commitArtifact(driftedMarkdown);
    const result = mergeReadinessForReviewPromotion({
      ...baseOpts,
      prDiffPaths: [targetPath],
      config: { enabled: true, write_governance: true },
      repoRoot,
    });
    expect(result.ok).toBe(false);
  });
});
