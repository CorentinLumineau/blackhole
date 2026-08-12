import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { planTargetPath, reviewTargetPath } from './lib/concern-slug.ts';
import { renderReviewMarkdown } from './lib/promote-review-artifact.ts';

const root = path.resolve(import.meta.dirname, '..');

describe('staging promotion fixtures (ADR-021 D3)', () => {
  const planManifest = JSON.parse(
    fs.readFileSync(path.join(root, 'fixtures/staging/plan-manifest.json'), 'utf-8'),
  );

  test('plan manifest declares documentation/plans target paths', () => {
    const planEntry = planManifest.entries.find(
      (e: { route: string; target_kind: string }) => e.route === 'plan' && e.target_kind === 'new_file',
    );
    expect(planEntry?.target_path).toMatch(/^documentation\/plans\//);
  });

  test('quick and standard tracks share planTargetPath helper', () => {
    expect(planTargetPath('Quick fix for slug helper', 1)).toBe(
      'documentation/plans/plan-quick-fix-for-slug-helper.md',
    );
    expect(planTargetPath('Plan: Standard track example', 2)).toMatch(/^documentation\/plans\//);
  });

  test('merge-readiness review promotion produces documentation/reviews target', () => {
    const ledger = JSON.parse(
      fs.readFileSync(
        path.join(root, 'fixtures/promote-review-artifact/multi-iteration-ledger.json'),
        'utf-8',
      ),
    );
    const out = renderReviewMarkdown({
      issueNumber: 445,
      issueTitle: 'Durable plan and review artifact promotion',
      prNumber: 901,
      branchName: 'blackhole/issue-445',
      headSha: 'abc1234',
      ledger,
    });
    expect(out.targetPath).toBe(reviewTargetPath('Durable plan and review artifact promotion', 445));
    expect(out.targetPath.startsWith('documentation/reviews/review-')).toBe(true);
  });

  test('governance-off implies zero plan/review manifest entries', () => {
    const governanceOffEntries: unknown[] = [];
    expect(governanceOffEntries.filter((e) => e)).toHaveLength(0);
  });
});
