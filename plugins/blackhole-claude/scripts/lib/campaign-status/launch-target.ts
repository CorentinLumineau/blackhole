import { repoPathFromOrigin } from '../forge-detection.ts';
import type { GateOption } from './types.ts';

// The launch target: which repository and campaign directory a `run` or `catchup` start resolved
// to. A start with no scope argument resolves from the working directory, so the target is printed
// first and, when the session's stated target names another repository, asked about before any
// config write (`launch-gate.md` § Target check). Pure: `campaign-status.ts target` does the I/O.

export type LaunchTarget = {
  /** `owner/repo` (the whole path for a nested group), or null when neither config.json nor the origin remote names one. */
  repo: string | null;
  /** Absolute campaign directory (`<repo root>/.blackhole`). */
  campaignDir: string;
  /** Where `repo` came from. */
  source: 'config' | 'origin' | 'none';
};

export type TargetQuestion = { row: 'target'; header: 'Target'; question: string; multiSelect: false; options: GateOption[] };
export type TargetCard = { questions: [TargetQuestion] };

export function resolveLaunchTarget(input: { campaignDir: string; configRepo: string | undefined; originUrl: string | null }): LaunchTarget {
  if (input.configRepo) return { repo: input.configRepo, campaignDir: input.campaignDir, source: 'config' };
  const fromOrigin = repoPathFromOrigin(input.originUrl)?.path;
  return fromOrigin ? { repo: fromOrigin, campaignDir: input.campaignDir, source: 'origin' } : { repo: null, campaignDir: input.campaignDir, source: 'none' };
}

/** A stated target as a lower-case repository path: an origin URL's path after the host, else the text itself. */
const statedPath = (stated: string): string =>
  (repoPathFromOrigin(stated)?.path ?? stated.trim().replace(/\/+$/, '').replace(/\.git$/i, '')).toLowerCase();

/**
 * Whether the repository a session's stated intent names (a bare repo name, a repository path or a
 * URL) is the resolved one. A bare name matches the last path segment; anything with a `/` must
 * equal the whole path (GitLab nested groups included); case is ignored. With no resolved
 * repository nothing can be confirmed, so it never matches.
 */
export function statedTargetMatches(stated: string, target: LaunchTarget): boolean {
  if (!target.repo) return false;
  const resolved = target.repo.toLowerCase();
  const wanted = statedPath(stated);
  return wanted.includes('/') ? wanted === resolved : wanted === resolved.split('/').pop();
}

const repoText = (t: LaunchTarget): string => t.repo ?? 'no repo';

/** The launch summary's heading: the resolved repository and the absolute campaign directory. */
export const targetHeading = (t: LaunchTarget): string => `## Launch summary — ${repoText(t)} · ${t.campaignDir}`;

/** The first line a start prints, before any write. */
export const targetLine = (t: LaunchTarget): string => `Target: ${repoText(t)} · ${t.campaignDir}`;

/** The one question a stated-target mismatch asks: Continue here or Stop, never Accept. */
export function targetCard(t: LaunchTarget, stated: string): TargetCard {
  return {
    questions: [
      {
        row: 'target',
        header: 'Target',
        question: `This session names ${stated}, but the campaign resolved to ${repoText(t)} (${t.campaignDir}). Run it here?`,
        multiSelect: false,
        options: [
          { label: 'Continue here', description: `Run the campaign on ${repoText(t)}; recorded as your decision.` },
          { label: 'Stop', description: 'End this start before any config write; re-run it from the intended repository.' },
        ],
      },
    ],
  };
}
