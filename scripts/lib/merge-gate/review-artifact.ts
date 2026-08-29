import * as fs from 'fs';
import { reviewTargetPath } from '../concern-slug.ts';

export type DocsGovernanceConfig = {
  enabled?: boolean;
  write_governance?: boolean;
};

export type StagingManifest = {
  issue?: number;
  entries?: Array<{ route?: string; target_path?: string }>;
};

export function writeGovernanceActive(config: DocsGovernanceConfig | undefined): boolean {
  return config?.enabled === true && config?.write_governance === true;
}

/** merge-gate.md §5 — review artifact must be on the PR before merge. */
export function reviewArtifactPresent(
  issueTitle: string,
  issueNumber: number,
  prDiffPaths: string[],
  config: DocsGovernanceConfig | undefined,
): boolean {
  if (!writeGovernanceActive(config)) return true;
  const expected = reviewTargetPath(issueTitle, issueNumber);
  return prDiffPaths.includes(expected);
}

/** ADR-021 D3 — staged manifest must declare route:review before merge step 2.5 completes. */
export function manifestHasReviewRoute(manifest: StagingManifest | null | undefined): boolean {
  return (manifest?.entries ?? []).some((entry) => entry.route === 'review');
}

export function readStagingManifest(manifestPath: string): StagingManifest | null {
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as StagingManifest;
}

export function mergeReadinessForReviewPromotion(opts: {
  issueTitle: string;
  issueNumber: number;
  prDiffPaths: string[];
  config: DocsGovernanceConfig | undefined;
  manifestPath: string;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!writeGovernanceActive(opts.config)) {
    return { ok: true, reasons };
  }

  const manifest = readStagingManifest(opts.manifestPath);
  if (!manifestHasReviewRoute(manifest)) {
    reasons.push('staged manifest missing route:review entry');
  }

  if (!reviewArtifactPresent(opts.issueTitle, opts.issueNumber, opts.prDiffPaths, opts.config)) {
    reasons.push(`PR missing ${reviewTargetPath(opts.issueTitle, opts.issueNumber)}`);
  }

  return { ok: reasons.length === 0, reasons };
}
