import type { HookSource } from './hook-sources.ts';

// Issue #912 (ADR-044) — the comparison half of the widened plugin-drift signal. Asserts an
// ordering between registered PreToolUse sources ONLY where a commit-graph ancestry proves one;
// every other case renders a named, distinct, non-clean state rather than being collapsed into
// "no drift" (the binding constraint carried from the issue's third correction). Never reads
// settings, never decides which source is "the" enforcing one — `hook-sources.ts` does that.

export type OrderingOutcomeKind = 'strict' | 'version-differs-unproven' | 'no-baseline';

export type SourceRelation = 'older' | 'newer' | 'identical' | 'diverged';

export type OrderedSource = {
  layer: number;
  label: string;
  outcome: OrderingOutcomeKind;
  /** Only set when `outcome === 'strict'`. */
  relation_to_origin_main: SourceRelation | null;
  /** Hook-touching commits between this source's sha and `origin/main`. Only set for a resolved
   * `'older'` or `'identical'` (0) relation — `'newer'`/`'diverged'` don't have a meaningful
   * "behind" count in this direction. */
  hook_commits_behind: number | null;
};

export type VetoPair = {
  older_layer: number;
  older_label: string;
  newer_layer: number;
  newer_label: string;
  hook_commits_behind: number | null;
};

export type OrderingResult = {
  ordering_available: boolean;
  unavailable_reason: string | null;
  sources: OrderedSource[];
  veto_pairs: VetoPair[];
};

/** Injected git access — every method is a pure question about a resolvable commit SHA, so the
 * red/green fixtures never touch `~/.claude` or the main clone (DIP, same idiom `computePluginDrift`
 * already uses). `isVerifiedBlackholeClone`/`originMainSha` name the environment explicitly:
 * finding A-1 (both adversarial critics) — a consumer repo has neither blackhole's commit history
 * nor a blackhole `origin/main`, so ordering there must render unavailable, never silently guess. */
export type GitResolver = {
  isVerifiedBlackholeClone: () => boolean;
  originMainSha: () => string | null;
  shaResolves: (sha: string) => boolean;
  isAncestor: (ancestorSha: string, descendantSha: string) => boolean;
  hookCommitsBehindOriginMain: (sha: string) => number;
};

// `base` relative to `other`: 'older' when base is a strict ancestor of other, 'newer' when the
// reverse, 'identical' for equal shas, 'diverged' when neither is an ancestor of the other.
function relate(base: string, other: string, resolver: GitResolver): SourceRelation {
  if (base === other) return 'identical';
  const baseIsAncestor = resolver.isAncestor(base, other);
  const otherIsAncestor = resolver.isAncestor(other, base);
  if (baseIsAncestor && !otherIsAncestor) return 'older';
  if (otherIsAncestor && !baseIsAncestor) return 'newer';
  return 'diverged';
}

function classifySource(source: HookSource, originMain: string, resolver: GitResolver): OrderedSource {
  const base: OrderedSource = {
    layer: source.layer,
    label: source.label,
    outcome: 'no-baseline',
    relation_to_origin_main: null,
    hook_commits_behind: null,
  };

  // A foreign or absent source has no baseline to order against, ever — not even after content
  // matches, since provenance is what is missing, not content (green-state fixture requirement).
  if (source.origin_kind === 'foreign' || !source.present) return base;

  if (!source.commit_sha) {
    // Present with a version string but no sha at all: unproven, never no-baseline (a version
    // string IS a claim about identity, just an unorderable one).
    if (source.version) return { ...base, outcome: 'version-differs-unproven' };
    return base;
  }

  if (!resolver.shaResolves(source.commit_sha)) {
    return { ...base, outcome: 'version-differs-unproven' };
  }

  const relation = relate(source.commit_sha, originMain, resolver);
  const behind =
    relation === 'older'
      ? resolver.hookCommitsBehindOriginMain(source.commit_sha)
      : relation === 'identical'
        ? 0
        : null;
  return { layer: source.layer, label: source.label, outcome: 'strict', relation_to_origin_main: relation, hook_commits_behind: behind };
}

/** Given enumerated `HookSource[]` and an injected git resolver, computes each source's
 * provable relation to `origin/main` and every pairwise veto relationship among strictly-ordered
 * sources. Three rendered outcomes per source — `strict` (incl. `diverged`), `version-differs-
 * unproven`, `no-baseline` — none collapsed into a fourth "clean" bucket by this module; the
 * renderer decides what counts as clean. */
export function orderHookSources(sources: HookSource[], resolver: GitResolver): OrderingResult {
  const originMain = resolver.isVerifiedBlackholeClone() ? resolver.originMainSha() : null;
  if (originMain === null) {
    return {
      ordering_available: false,
      unavailable_reason: resolver.isVerifiedBlackholeClone()
        ? 'origin/main does not resolve in this clone\'s object store'
        : 'not a verified blackhole clone — commit-graph ancestry requires blackhole\'s own object store and origin/main',
      sources: sources.map((s) => ({
        layer: s.layer,
        label: s.label,
        outcome: 'no-baseline' as const,
        relation_to_origin_main: null,
        hook_commits_behind: null,
      })),
      veto_pairs: [],
    };
  }

  const ordered = sources.map((s) => classifySource(s, originMain, resolver));

  const vetoPairs: VetoPair[] = [];
  const strict = sources
    .map((source, i) => ({ source, ordering: ordered[i] }))
    .filter((x) => x.ordering.outcome === 'strict' && x.source.commit_sha);

  for (let i = 0; i < strict.length; i++) {
    for (let j = i + 1; j < strict.length; j++) {
      const a = strict[i];
      const b = strict[j];
      const shaA = a.source.commit_sha as string;
      const shaB = b.source.commit_sha as string;
      if (shaA === shaB) continue; // identical content-identity — no veto-power differential
      const relation = relate(shaA, shaB, resolver);
      if (relation === 'older') {
        vetoPairs.push({
          older_layer: a.source.layer,
          older_label: a.source.label,
          newer_layer: b.source.layer,
          newer_label: b.source.label,
          hook_commits_behind: resolver.hookCommitsBehindOriginMain(shaA),
        });
      } else if (relation === 'newer') {
        vetoPairs.push({
          older_layer: b.source.layer,
          older_label: b.source.label,
          newer_layer: a.source.layer,
          newer_label: a.source.label,
          hook_commits_behind: resolver.hookCommitsBehindOriginMain(shaB),
        });
      }
      // 'diverged' — no ordering-based veto claim between this pair; each side's own
      // relation_to_origin_main already discloses its individual staleness.
    }
  }

  return { ordering_available: true, unavailable_reason: null, sources: ordered, veto_pairs: vetoPairs };
}
