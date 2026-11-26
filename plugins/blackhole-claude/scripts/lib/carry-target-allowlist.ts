import * as path from 'path';
import { planPackageRoot } from './stack-parent.ts';

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

/**
 * A caller-supplied package root as a safe repo-relative directory, or '' when it is absent or
 * unsafe. Reuses the plan `package_root` sanitizer (`planPackageRoot`, V-INT-02) and additionally
 * refuses a newline (it would forge a second frontmatter key) and the `.git` / `.github` trees,
 * whose writes the campaign or CI executes.
 */
const safePackageRoot = (value: string | undefined): string => {
  if (!value || /[\r\n\\]/.test(value)) return '';
  // `planPackageRoot` rejects a leading `/` before it strips `./`, so `.//.git` survives as
  // `/.git`; the structural checks below run on the stripped result and refuse every such form.
  const stripped = planPackageRoot(`---\npackage_root: ${value}\n---\n`) || '.';
  const root = path.posix.normalize(stripped);
  if (root === '.' || path.posix.isAbsolute(stripped) || stripped.includes('//')) return '';
  const forbidden = (segment: string): boolean => segment === '' || segment === '..' || /^\.git(hub)?$/i.test(segment);
  return root.split('/').some(forbidden) ? '' : root;
};

/**
 * `packageRoot` (a monorepo plan's `package_root`) additionally admits that package's own
 * `documentation/**` and `ARCHITECTURE.md`; without a safe one the set is exactly the two
 * root families above.
 */
export function isCarryTargetAllowed(targetPath: string, packageRoot?: string): boolean {
  // Traversal bypass: a target_path like `documentation/../package.json` starts with the literal
  // prefix `documentation/`, so a raw-string prefix test admits it, then resolves to
  // `<repoRoot>/package.json` — genuinely inside repoRoot, so isWithinRoot's resolved-path
  // containment check admits it too. Both gates reasoned about a different notion of the same
  // path (raw string vs. resolved path); `path.posix.normalize` collapses `..` segments before
  // this predicate answers, closing that mismatch without rejecting `..` outright (a legitimate
  // `documentation/a/../b.md` must still resolve to an allowed target).
  const normalized = path.posix.normalize(targetPath.replace(/\\/g, '/'));
  if (normalized === 'ARCHITECTURE.md' || normalized.startsWith('documentation/')) return true;
  const root = safePackageRoot(packageRoot);
  return root !== '' && (normalized === `${root}/ARCHITECTURE.md` || normalized.startsWith(`${root}/documentation/`));
}
