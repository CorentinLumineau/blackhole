import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  manifestHasReviewRoute,
  mergeReadinessForReviewPromotion,
  reviewArtifactPresent,
} from './lib/merge-gate/review-artifact.ts';
import { reviewTargetPath } from './lib/concern-slug.ts';

const root = path.resolve(import.meta.dirname, '..');

describe('reviewArtifactPresent', () => {
  test('passes when governance off', () => {
    expect(
      reviewArtifactPresent('Fix review promotion', 687, [], { enabled: false, write_governance: true }),
    ).toBe(true);
  });

  test('requires documentation/reviews path when governance on', () => {
    const title = 'Pattern B review promotion';
    const target = reviewTargetPath(title, 687);
    expect(reviewArtifactPresent(title, 687, ['src/foo.ts'], { enabled: true, write_governance: true })).toBe(
      false,
    );
    expect(reviewArtifactPresent(title, 687, [target], { enabled: true, write_governance: true })).toBe(true);
  });
});

describe('manifestHasReviewRoute', () => {
  test('detects route:review entries', () => {
    expect(manifestHasReviewRoute({ entries: [{ route: 'plan' }] })).toBe(false);
    expect(manifestHasReviewRoute({ entries: [{ route: 'review' }] })).toBe(true);
  });
});

describe('mergeReadinessForReviewPromotion', () => {
  const manifestWithReview = path.join(root, 'fixtures/staging/review-manifest.json');

  test('blocks when manifest lacks route:review under governance', () => {
    const title = 'Durable plan and review artifact promotion';
    const target = reviewTargetPath(title, 445);
    const tmp = fs.mkdtempSync(path.join(root, 'fixtures/staging/tmp-'));
    const emptyManifest = path.join(tmp, 'manifest.json');
    fs.writeFileSync(emptyManifest, JSON.stringify({ entries: [{ route: 'plan' }] }));

    const result = mergeReadinessForReviewPromotion({
      issueTitle: title,
      issueNumber: 445,
      prDiffPaths: [target],
      config: { enabled: true, write_governance: true },
      manifestPath: emptyManifest,
    });

    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('route:review'))).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('passes when manifest declares review and PR carries target', () => {
    const title = 'Durable plan and review artifact promotion';
    const target = reviewTargetPath(title, 445);

    const result = mergeReadinessForReviewPromotion({
      issueTitle: title,
      issueNumber: 445,
      prDiffPaths: [target],
      config: { enabled: true, write_governance: true },
      manifestPath: manifestWithReview,
    });

    expect(result.ok).toBe(true);
  });
});
