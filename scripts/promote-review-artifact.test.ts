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
  });
});
