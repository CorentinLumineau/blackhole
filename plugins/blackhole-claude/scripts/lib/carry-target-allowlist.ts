import * as path from 'path';

/**
 * Legal carry targets (issue #784 AC1). Bounding a manifest entry's `target_path` at `repoRoot`
 * (PR #783 / issue #752) closes traversal *outside* the repo but leaves every in-repo path
 * writable — `package.json`, `.github/workflows/*.yml`, and `.git/hooks/pre-commit` all pass
 * containment and reach an unconditional write, and each is executed by the campaign or CI
 * immediately after the carry step. `artifact-contract.md`'s route→artifact table shows every
 * route ever declares only two target families — `documentation/**` and the root-level
 * `ARCHITECTURE.md` `## Active Constraints` append — so this allowlist is exhaustive against
 * current usage, not a guess.
 *
 * Named glob-array constant + boolean predicate, no glob library — same shape as
 * `OPS_TOUCH_PATH_GLOBS` / `touchPathsHitOpsSurface()` in `ops-touch-paths.ts` (V-INT-01).
 */
export const CARRY_TARGET_ALLOWLIST = ['documentation/**', 'ARCHITECTURE.md'] as const;

export function isCarryTargetAllowed(targetPath: string): boolean {
  // Traversal bypass: a target_path like `documentation/../package.json` starts with the literal
  // prefix `documentation/`, so a raw-string prefix test admits it, then resolves to
  // `<repoRoot>/package.json` — genuinely inside repoRoot, so isWithinRoot's resolved-path
  // containment check admits it too. Both gates reasoned about a different notion of the same
  // path (raw string vs. resolved path); `path.posix.normalize` collapses `..` segments before
  // this predicate answers, closing that mismatch without rejecting `..` outright (a legitimate
  // `documentation/a/../b.md` must still resolve to an allowed target).
  const normalized = path.posix.normalize(targetPath.replace(/\\/g, '/'));
  return normalized === 'ARCHITECTURE.md' || normalized.startsWith('documentation/');
}
