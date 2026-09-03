import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { renderReviewMarkdown, selectReviewFindings } from './lib/promote-review-artifact.ts';

const root = path.resolve(import.meta.dirname, '..');
const fixtureLedger = JSON.parse(
  fs.readFileSync(
    path.join(root, 'fixtures/promote-review-artifact/multi-iteration-ledger.json'),
    'utf-8',
  ),
);
const deferredOnlyLedger = JSON.parse(
  fs.readFileSync(
    path.join(root, 'fixtures/promote-review-artifact/deferred-only-ledger.json'),
    'utf-8',
  ),
);
const deferredMultiLedger = JSON.parse(
  fs.readFileSync(
    path.join(root, 'fixtures/promote-review-artifact/deferred-multi-ledger.json'),
    'utf-8',
  ),
);
const openWarnLedger = JSON.parse(
  fs.readFileSync(
    path.join(root, 'fixtures/promote-review-artifact/open-warn-ledger.json'),
    'utf-8',
  ),
);

describe('selectReviewFindings', () => {
  test('omits recheck-fixed and fixed-in-pr rows; retains not_fixed', () => {
    const selected = selectReviewFindings(fixtureLedger, 445, 901);
    const ids = selected.map((f) => f.id).sort();
    expect(ids).toEqual(['F-00002']);
  });
});

describe('renderReviewMarkdown', () => {
  test('renders review frontmatter and findings table', () => {
    const out = renderReviewMarkdown({
      issueNumber: 445,
      issueTitle: 'Durable plan and review artifact promotion',
      prNumber: 901,
      branchName: 'blackhole/issue-445',
      headSha: 'deadbeefcafebabe',
      ledger: fixtureLedger,
      today: '2026-08-12',
    });

    expect(out.markdown).toContain('type: review');
    expect(out.markdown).toContain('**Verdict: CHANGES REQUESTED**');
    expect(out.markdown).toContain('V-DRY-01');
    expect(out.markdown).not.toContain('V-KISS-03');
    expect(out.targetPath).toContain('documentation/reviews/review-');
    expect(out.indexRow).toContain('| reviews/');
  });

  test('a single deferred row does not flip the verdict to CHANGES REQUESTED', () => {
    const out = renderReviewMarkdown({
      issueNumber: 706,
      issueTitle: 'Deferred-only ledger regression',
      prNumber: 732,
      branchName: 'blackhole/issue-706',
      headSha: 'deadbeefcafebabe',
      ledger: deferredOnlyLedger,
      today: '2026-08-12',
    });

    expect(out.verdict).toBe('LGTM');
    expect(out.markdown).toContain('V-GROUND-01');
  });

  test('multiple deferred rows do not flip the verdict; each stays visible in disclosure', () => {
    const out = renderReviewMarkdown({
      issueNumber: 717,
      issueTitle: 'Deferred-multi ledger regression',
      prNumber: 750,
      branchName: 'blackhole/issue-717',
      headSha: 'deadbeefcafebabe',
      ledger: deferredMultiLedger,
      today: '2026-08-12',
    });

    expect(out.verdict).toBe('LGTM');
    expect(out.markdown).toContain('scripts/lib/promote-review-artifact.ts:30');
    expect(out.markdown).toContain('scripts/lib/concern-slug.ts:8');
  });

  test('an open WARN with zero BLOCK renders LGTM but stays visible in disclosure (issue #757)', () => {
    const out = renderReviewMarkdown({
      issueNumber: 747,
      issueTitle: 'Open-warn verdict regression',
      prNumber: 753,
      branchName: 'blackhole/issue-747',
      headSha: 'deadbeefcafebabe',
      ledger: openWarnLedger,
      today: '2026-08-12',
    });

    expect(out.verdict).toBe('LGTM');
    expect(out.markdown).toContain('**Verdict: LGTM** — 0 BLOCK, 1 WARN at merge-readiness.');
    expect(out.markdown).toContain('V-DOC-01');
    expect(out.markdown).toContain('### Deferred (not counted toward verdict)');
    expect(out.markdown).toContain('V-DOC-06');
  });
});

describe('promote-review-artifact CLI', () => {
  test('exits 0 on fixture input', async () => {
    const outDir = fs.mkdtempSync(path.join(root, 'fixtures/promote-review-artifact/out-'));
    const proc = Bun.spawn(
      [
        'bun',
        'run',
        path.join(root, 'scripts/promote-review-artifact.ts'),
        '--ledger',
        path.join(root, 'fixtures/promote-review-artifact/multi-iteration-ledger.json'),
        '--issue',
        '445',
        '--title',
        'Durable plan and review artifact promotion',
        '--pr',
        '901',
        '--branch',
        'blackhole/issue-445',
        '--head',
        'deadbeefcafebabe',
        '--out-dir',
        outDir,
      ],
      { cwd: root, stdout: 'pipe', stderr: 'pipe' },
    );
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(outDir, 'review.md'))).toBe(true);
    fs.rmSync(outDir, { recursive: true, force: true });
  });
});
