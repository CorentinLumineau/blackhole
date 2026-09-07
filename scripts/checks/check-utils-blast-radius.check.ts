import { root, read, type CheckResult } from './check-utils.ts';
import { listTrackedFiles } from './control-char.check.ts';
import { findRowCountMismatch } from './ground-truth.check.ts';

// V-BLASTRADIUS-01 (BLOCK, issue #960): check-utils.ts's header comment states a hand-maintained
// "N direct consumers" count that drifted stale six times (#410, #462, #498, #570, #882, #945),
// each time caught only by a human noticing during an unrelated PR — never by a mechanical gate.
// This check makes the drift structurally impossible to ship silently: the declared header count
// is compared against a live, independently-scanned git-tracked-file import count on every
// `bun run verify`.
//
// Scope (what this scans, and what it cannot see): every git-tracked file under `scripts/`
// (`listTrackedFiles`, reused from control-char.check.ts — V-INT-02) whose path ends in `.ts`,
// excluding `check-utils.ts` itself, is scanned for a `from '<...>check-utils(.ts)?'` import —
// the same substring-match semantics as `documentation/reference/check-utils-blast-radius.md`'s
// § Maintenance `rg "from ['\"].*check-utils"` command #2 (the "every scripts/ file" superset,
// not the narrower *.check.ts-only or read-symbol-only subsets #1/#3). Untracked files (build
// scratch, gitignored output) are invisible to `git ls-files` and are deliberately excluded — a
// generated file is not a source-level consumer this drift check is about.
//
// Not circular (V-UNFALSIFIABLE-01 d): the "actual" side is a fresh git-tracked-file scan +
// regex match, independent of the declared header literal it is compared against — never
// re-derived from the same comment it checks.

/** Extracts N from a `// Dependency blast-radius (N direct consumers...` header comment.
 * Returns null when no such count is present — the absent-input case this check must fail
 * loudly on, not silently pass (V-UNFALSIFIABLE-01 c). */
export const parseDeclaredBlastRadiusCount = (headerContent: string): number | null => {
  const match = headerContent.match(/Dependency blast-radius \((\d+) direct consumers/);
  return match ? Number(match[1]) : null;
};

/** Same substring-match semantics as the blast-radius doc's own `rg "from ['\"].*check-utils"`
 * command — any relative import path ending in `check-utils` or `check-utils.ts`. */
export const hasCheckUtilsImport = (content: string): boolean =>
  /from\s+['"][^'"]*check-utils(?:\.ts)?['"]/.test(content);

/** Pure filter over `hasCheckUtilsImport(readFn(f))` — injectable for fixture testing without
 * touching the filesystem. */
export const findCheckUtilsConsumers = (candidateFiles: string[], readFn: (rel: string) => string): string[] =>
  candidateFiles.filter((f) => hasCheckUtilsImport(readFn(f)));

/** Pure decision logic, isolated from the real `read`/`listTrackedFiles` I/O below so the
 * absent-declared-count failure path is independently testable (V-UNFALSIFIABLE-01 c) without a
 * fixture that mutates the real check-utils.ts header. `declared === null` and a count mismatch
 * both fail loudly (`ok: false` with a concrete `detail`) — this check never silently passes on
 * missing input. */
export const buildBlastRadiusResult = (declared: number | null, actualConsumerCount: number): CheckResult => {
  if (declared === null) {
    return {
      id: 'V-BLASTRADIUS-01',
      ok: false,
      detail:
        "scripts/checks/check-utils.ts header is missing a '// Dependency blast-radius (N direct consumers...' declared count",
    };
  }

  const mismatch = findRowCountMismatch('scripts/checks/check-utils.ts header consumer count', declared, actualConsumerCount);
  return mismatch ? { id: 'V-BLASTRADIUS-01', ok: false, detail: mismatch } : { id: 'V-BLASTRADIUS-01', ok: true };
};

const checkCheckUtilsBlastRadius = (): CheckResult => {
  const header = read('scripts/checks/check-utils.ts');
  const declared = parseDeclaredBlastRadiusCount(header);

  const candidates = listTrackedFiles(root).filter(
    (f) => f.startsWith('scripts/') && f.endsWith('.ts') && f !== 'scripts/checks/check-utils.ts'
  );
  const consumers = findCheckUtilsConsumers(candidates, read);

  return buildBlastRadiusResult(declared, consumers.length);
};

export const runChecks = (): CheckResult[] => [checkCheckUtilsBlastRadius()];
