import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { aggregateReview, paretoPriority, type Finding } from './review-aggregate';

const root = path.resolve(import.meta.dirname, '..');
const scriptPath = path.join(root, 'scripts/review-aggregate.ts');

const baseFinding = (overrides: Partial<Finding> = {}): Finding => ({
  vcode: 'V-KISS-03',
  severity: 'WARN',
  file: 'src/a.ts',
  line: 10,
  summary: 'issue',
  ...overrides,
});

async function runReviewAggregateCli(args: string[]) {
  const proc = Bun.spawn({
    cmd: ['bun', 'run', scriptPath, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: root,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe('aggregateReview', () => {
  test('empty findings → lgtm true, approved', () => {
    const result = aggregateReview({
      reviewer: { status: 'complete', findings: [] },
      issueRef: '46',
    });
    expect(result.status).toBe('approved');
    expect(result.lgtm).toBe(true);
    expect(result.blockers_count).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.pareto_candidates).toEqual([]);
  });

  test('BLOCK finding → lgtm false, changes_requested', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ severity: 'BLOCK', vcode: 'V-SCOPE-02' })],
      },
      issueRef: '46',
    });
    expect(result.status).toBe('changes_requested');
    expect(result.lgtm).toBe(false);
    expect(result.blockers_count).toBe(1);
    expect(result.findings).toHaveLength(1);
  });

  test('V-DOCSYNC-01 BLOCK finding → dedups and gates like any other BLOCK vcode', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ severity: 'BLOCK', vcode: 'V-DOCSYNC-01' })],
      },
      issueRef: '46',
    });
    expect(result.status).toBe('changes_requested');
    expect(result.lgtm).toBe(false);
    expect(result.blockers_count).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].vcode).toBe('V-DOCSYNC-01');
  });

  test('dedup keeps highest severity for same key', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [
          baseFinding({ severity: 'WARN', summary: 'low' }),
          baseFinding({ severity: 'BLOCK', summary: 'high' }),
        ],
      },
      issueRef: '46',
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('BLOCK');
    expect(result.findings[0].summary).toBe('high');
    expect(result.blockers_count).toBe(1);
  });

  test('dedup merges prior findings with reviewer output', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ line: 20, severity: 'WARN' })],
      },
      issueRef: '46',
      priorFindings: [baseFinding({ line: 10, severity: 'BLOCK' })],
    });
    expect(result.findings).toHaveLength(2);
    expect(result.blockers_count).toBe(1);
  });

  test('pareto_candidates sorted by priority descending', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [
          baseFinding({
            vcode: 'V-PARETO-02',
            severity: 'WARN',
            file: 'low.ts',
            line: 1,
            summary: 'low priority',
            gain: 3,
            effort: 8,
          }),
          baseFinding({
            vcode: 'V-PARETO-02',
            severity: 'WARN',
            file: 'high.ts',
            line: 2,
            summary: 'high priority',
            gain: 9,
            effort: 2,
          }),
        ],
      },
      issueRef: '46',
    });
    expect(result.pareto_candidates).toHaveLength(2);
    expect(result.pareto_candidates[0].summary).toBe('high priority');
    expect(result.pareto_candidates[0].priority).toBe(81);
    expect(result.pareto_candidates[1].priority).toBe(9);
  });

  test('V-ADA-01 findings on same file, different issue_ref → not deduped by aggregator', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [
          baseFinding({ vcode: 'V-ADA-01', severity: 'WARN', issue_ref: '47' }),
        ],
      },
      issueRef: '46',
      priorFindings: [
        baseFinding({ vcode: 'V-ADA-01', severity: 'WARN', issue_ref: '46' }),
      ],
    });
    expect(result.findings).toHaveLength(2);
  });

  test('reviewer status error → aggregate error', () => {
    const result = aggregateReview({
      reviewer: { status: 'error', error: 'audit failed', findings: [] },
      issueRef: '46',
    });
    expect(result.status).toBe('error');
    expect(result.lgtm).toBe(false);
    expect(result.error).toBe('audit failed');
    expect(result.findings).toEqual([]);
  });
});

describe('paretoPriority', () => {
  test('computes gain * (11 - effort)', () => {
    expect(paretoPriority(7, 2)).toBe(63);
  });
});

describe('confidence gate', () => {
  test('confidence < 50 → finding dropped entirely', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ severity: 'BLOCK', confidence: 49 })],
      },
      issueRef: '46',
    });
    expect(result.findings).toHaveLength(0);
    expect(result.blockers_count).toBe(0);
  });

  test('confidence in [50, 80) with severity BLOCK → downgraded to WARN with caveat', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ severity: 'BLOCK', confidence: 65 })],
      },
      issueRef: '46',
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('WARN');
    expect(result.findings[0].summary).toMatch(/confidence/i);
    expect(result.blockers_count).toBe(0);
  });

  test('confidence in [50, 80) with severity WARN → stays WARN, caveat added', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ severity: 'WARN', confidence: 55, summary: 'low priority issue' })],
      },
      issueRef: '46',
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('WARN');
    expect(result.findings[0].summary).toMatch(/confidence/i);
    expect(result.findings[0].summary).toContain('low priority issue');
  });

  test('confidence > 80 → passthrough unchanged, no caveat', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ severity: 'BLOCK', confidence: 81, summary: 'high confidence issue' })],
      },
      issueRef: '46',
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('BLOCK');
    expect(result.findings[0].summary).toBe('high confidence issue');
    expect(result.blockers_count).toBe(1);
  });

  test('confidence absent (undefined) → full-confidence passthrough, unchanged behavior', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ severity: 'BLOCK', summary: 'no confidence field' })],
      },
      issueRef: '46',
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('BLOCK');
    expect(result.findings[0].summary).toBe('no confidence field');
    expect(result.blockers_count).toBe(1);
  });

  test('finding with locations array (2+ entries) → dedup keys off top-level file/line only, locations preserved', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [
          baseFinding({
            severity: 'WARN',
            file: 'src/primary.ts',
            line: 5,
            locations: [
              { file: 'src/primary.ts', line: 5 },
              { file: 'src/other.ts', line: 22 },
            ],
          }),
        ],
      },
      issueRef: '46',
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe('src/primary.ts');
    expect(result.findings[0].line).toBe(5);
    expect(result.findings[0].locations).toEqual([
      { file: 'src/primary.ts', line: 5 },
      { file: 'src/other.ts', line: 22 },
    ]);
  });

  test('existing V-PARETO-02 pareto-candidate tests continue to pass unmodified (no confidence field)', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [
          baseFinding({
            vcode: 'V-PARETO-02',
            severity: 'WARN',
            file: 'low.ts',
            line: 1,
            summary: 'low priority',
            gain: 3,
            effort: 8,
          }),
          baseFinding({
            vcode: 'V-PARETO-02',
            severity: 'WARN',
            file: 'high.ts',
            line: 2,
            summary: 'high priority',
            gain: 9,
            effort: 2,
          }),
        ],
      },
      issueRef: '46',
    });
    expect(result.pareto_candidates).toHaveLength(2);
    expect(result.pareto_candidates[0].summary).toBe('high priority');
    expect(result.pareto_candidates[0].priority).toBe(81);
    expect(result.pareto_candidates[1].priority).toBe(9);
  });
});

describe('confidence band boundary (round-1 review fix — passthrough is strictly > 80)', () => {
  test('confidence exactly 80 → downgraded BLOCK→WARN with caveat (band is inclusive 50-80)', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ severity: 'BLOCK', confidence: 80, summary: 'boundary issue' })],
      },
      issueRef: '46',
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('WARN');
    expect(result.findings[0].summary).toMatch(/confidence 80/);
    expect(result.blockers_count).toBe(0);
  });

  test('confidence 81 → passthrough unchanged, no caveat', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ severity: 'BLOCK', confidence: 81, summary: 'clean pass' })],
      },
      issueRef: '46',
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('BLOCK');
    expect(result.findings[0].summary).toBe('clean pass');
    expect(result.blockers_count).toBe(1);
  });
});

describe('confidence gate idempotency (round-1 review fix — re-running must not double-append caveat)', () => {
  test('aggregating twice over already-gated priorFindings produces identical output', () => {
    const first = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ severity: 'BLOCK', confidence: 65, summary: 'flaky check' })],
      },
      issueRef: '46',
    });

    expect(first.findings).toHaveLength(1);
    expect(first.findings[0].severity).toBe('WARN');

    const second = aggregateReview({
      reviewer: { status: 'complete', findings: [] },
      issueRef: '46',
      priorFindings: first.findings,
    });

    expect(second.findings).toEqual(first.findings);

    const caveatOccurrences = (
      second.findings[0].summary.match(/low-confidence finding: verify before acting/g) ?? []
    ).length;
    expect(caveatOccurrences).toBe(1);
  });

  test('re-running a third time over the already-gated findings is still a no-op', () => {
    const first = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ severity: 'WARN', confidence: 55, summary: 'stable check' })],
      },
      issueRef: '46',
    });

    const second = aggregateReview({
      reviewer: { status: 'complete', findings: [] },
      issueRef: '46',
      priorFindings: first.findings,
    });

    const third = aggregateReview({
      reviewer: { status: 'complete', findings: [] },
      issueRef: '46',
      priorFindings: second.findings,
    });

    expect(third.findings).toEqual(first.findings);
  });
});

describe('confidence caveat interpolates actual confidence value (round-1 review fix)', () => {
  test('caveat text embeds the finding\'s own confidence value, not a static range', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ severity: 'BLOCK', confidence: 62, summary: 'interpolation check' })],
      },
      issueRef: '46',
    });
    expect(result.findings[0].summary).toContain('confidence 62');
    expect(result.findings[0].summary).not.toContain('confidence 50-80');
  });
});

describe('confidence bounds clamping/validation (round-1 review fix)', () => {
  test('confidence below 0 clamps to 0 → sub-50 band, dropped entirely', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ severity: 'BLOCK', confidence: -20 })],
      },
      issueRef: '46',
    });
    expect(result.findings).toHaveLength(0);
    expect(result.blockers_count).toBe(0);
  });

  test('confidence above 100 clamps to 100 → passthrough unchanged', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [baseFinding({ severity: 'BLOCK', confidence: 150, summary: 'clamped high' })],
      },
      issueRef: '46',
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('BLOCK');
    expect(result.findings[0].summary).toBe('clamped high');
    expect(result.blockers_count).toBe(1);
  });

  test('non-number confidence is treated as absent → full-confidence passthrough', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [
          baseFinding({
            severity: 'BLOCK',
            confidence: 'high' as unknown as number,
            summary: 'non-numeric confidence',
          }),
        ],
      },
      issueRef: '46',
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('BLOCK');
    expect(result.findings[0].summary).toBe('non-numeric confidence');
    expect(result.blockers_count).toBe(1);
  });
});

describe('recheck-aware dedup and lgtm (issue #485)', () => {
  test('same-key collision with a recheck-fixed prior finding never merges — new finding survives as its own row (issue #485)', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [
          baseFinding({
            vcode: 'V-SEC-02',
            severity: 'BLOCK',
            file: 'src/a.ts',
            line: 42,
            summary: 'regression: command-substitution spellings evade blockPatterns',
          }),
        ],
        recheck: [
          {
            finding_id: 'F-00046',
            verdict: 'fixed',
            evidence: 'commit 94ca81a addressed the round-1 finding',
          },
        ],
      },
      issueRef: '470',
      priorFindings: [
        baseFinding({
          id: 'F-00046',
          vcode: 'V-SEC-02',
          severity: 'BLOCK',
          file: 'src/a.ts',
          line: 42,
          issue_ref: '470',
          summary: 'evaded by four idiomatic spellings of its own headline case',
        }),
      ],
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].summary).toBe(
      'regression: command-substitution spellings evade blockPatterns',
    );
    expect(result.blockers_count).toBe(1);
  });

  test('all recheck-named prior findings resolved and reviewer reports none → lgtm true, zero blockers (issue #485)', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [],
        recheck: [
          { finding_id: 'F-00046', verdict: 'fixed', evidence: 'fixed in 94ca81a' },
          { finding_id: 'F-00058', verdict: 'fixed', evidence: 'fixed in 94ca81a' },
        ],
      },
      issueRef: '470',
      priorFindings: [
        baseFinding({ id: 'F-00046', severity: 'BLOCK', file: 'src/a.ts', line: 42 }),
        baseFinding({ id: 'F-00058', severity: 'BLOCK', file: 'src/b.ts', line: 7 }),
      ],
    });

    expect(result.blockers_count).toBe(0);
    expect(result.lgtm).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  test('recheck entry names a finding_id with no matching prior id → surfaced in unresolved_recheck, lgtm forced false (issue #485)', () => {
    const result = aggregateReview({
      reviewer: {
        status: 'complete',
        findings: [],
        recheck: [
          { finding_id: 'F-99999', verdict: 'fixed', evidence: 'claimed fixed, no linkage' },
        ],
      },
      issueRef: '470',
      priorFindings: [],
    });

    expect(result.unresolved_recheck).toHaveLength(1);
    expect(result.unresolved_recheck[0].finding_id).toBe('F-99999');
    expect(result.lgtm).toBe(false);
  });
});

describe('review-aggregate CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-aggregate-cli-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('unresolved recheck entry prints the fail-loud stderr line (issue #485)', async () => {
    const reviewerFile = path.join(tmpDir, 'reviewer.json');
    const priorFile = path.join(tmpDir, 'prior.json');
    fs.writeFileSync(
      reviewerFile,
      JSON.stringify({
        status: 'complete',
        findings: [],
        recheck: [
          { finding_id: 'F-99999', verdict: 'fixed', evidence: 'claimed fixed, no linkage' },
        ],
      }),
      'utf-8',
    );
    fs.writeFileSync(priorFile, JSON.stringify([]), 'utf-8');

    const result = await runReviewAggregateCli([
      '--reviewer-file',
      reviewerFile,
      '--issue-ref',
      '470',
      '--prior-file',
      priorFile,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      '1 unresolved_recheck entry — see the "unresolved_recheck" field in stdout output',
    );
    const parsed = JSON.parse(result.stdout);
    expect(parsed.unresolved_recheck).toHaveLength(1);
    expect(parsed.lgtm).toBe(false);
  });

  test('resolved recheck entry prints no fail-loud stderr line', async () => {
    const reviewerFile = path.join(tmpDir, 'reviewer.json');
    const priorFile = path.join(tmpDir, 'prior.json');
    fs.writeFileSync(
      reviewerFile,
      JSON.stringify({
        status: 'complete',
        findings: [],
        recheck: [{ finding_id: 'F-00046', verdict: 'fixed', evidence: 'fixed in 94ca81a' }],
      }),
      'utf-8',
    );
    fs.writeFileSync(
      priorFile,
      JSON.stringify([
        {
          id: 'F-00046',
          vcode: 'V-SEC-02',
          severity: 'BLOCK',
          file: 'src/a.ts',
          line: 42,
          summary: 'prior finding',
        },
      ]),
      'utf-8',
    );

    const result = await runReviewAggregateCli([
      '--reviewer-file',
      reviewerFile,
      '--issue-ref',
      '470',
      '--prior-file',
      priorFile,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe('');
    const parsed = JSON.parse(result.stdout);
    expect(parsed.unresolved_recheck).toHaveLength(0);
  });
});
