import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import { walkMdFilesAbs } from '../lib/check-common.ts';
import { BUILD_INPUT_ONLY_DIRS } from '../lib/build/facts.ts';
import { INCLUDE_MARKER } from '../lib/build/content.ts';
import {
  AGENTS_BUILD_ROOT,
  AGENT_PLUGINS_DISTRIBUTION_ROOT,
  CLAUDE_DISTRIBUTION_ROOT,
  CLAUDE_NATIVE_ROOT,
  DISTRIBUTION_ROOT,
} from '../lib/build/paths.ts';

// ADR-034 (issue #719) — build-input-dirs.check.ts: V-INCLUDE-01 two-sided verification for the
// {{INCLUDE:<dir>/*}} build-time include-marker primitive (scripts/lib/build/content.ts
// `expandIncludes`). A `BUILD_INPUT_ONLY_DIRS` (facts.ts) entry is a `src/`-relative directory
// whose .md files are build inputs only — consumed by a shell file's {{INCLUDE:...}} marker and
// never mirrored into a compiled output tree. Two independently-fallible legs, per ADR-007's
// rejection of single-source derivation for a drift check:
//   Leg A: a declared entry must not appear in any of the 9 compiled reference trees (a leak —
//   compileFolder's exclusion failed, or someone hand-created it in a compiled tree).
//   Leg B: every {{INCLUDE:<dir>/*}} marker actually used in src/agents/**/src/references/**
//   must name a directory that is declared (an undeclared marker's directory would ship twice —
//   once inlined, once mirrored — since compileFolder has nothing to exclude it on).

// The 9 `src/references/**`-shaped compiled reference trees (ADR-034 Decision point 3), one per
// platform-target output shape from scripts/lib/build/targets.ts. Declared here — repo-root-
// relative — as this check's own independent scan side; never derived from BUILD_INPUT_ONLY_DIRS
// or from targets.ts's compile call sites.
export const REFERENCE_TREE_ROOTS = [
  'references',
  'skills/blackhole/references',
  '.cursor/skills/blackhole/references',
  path.join(CLAUDE_NATIVE_ROOT, 'skills', 'blackhole', 'references'),
  path.join(CLAUDE_DISTRIBUTION_ROOT, 'skills', 'blackhole', 'references'),
  path.join(AGENTS_BUILD_ROOT, 'skills', 'blackhole', 'references'),
  path.join(DISTRIBUTION_ROOT, 'skills', 'blackhole', 'references'),
  'codex-skills/blackhole/references',
  path.join(AGENT_PLUGINS_DISTRIBUTION_ROOT, 'skills', 'blackhole', 'references'),
];

// Leg A: for each declared dir (e.g. `references/reviewer-audits`), strip its `references/`
// prefix to get the basename a compiled tree would carry it under (a reference-tree root already
// *is* the compiled `references/` output), then check presence under every tree root.
export const findLeakedBuildInputDirs = (
  declaredDirs: string[],
  treeRoots: string[]
): string[] => {
  const leaks: string[] = [];
  for (const dir of declaredDirs) {
    const dirName = dir.startsWith('references/') ? dir.slice('references/'.length) : dir;
    for (const treeRoot of treeRoots) {
      if (fs.existsSync(path.join(treeRoot, dirName))) {
        leaks.push(`${dir} found under ${treeRoot}`);
      }
    }
  }
  return leaks;
};

// Leg B: any {{INCLUDE:<dir>/*}} marker whose <dir> is not in the declared set.
export const findUndeclaredIncludeMarkers = (
  files: { path: string; content: string }[],
  declaredDirs: string[]
): string[] => {
  const declared = new Set(declaredDirs);
  const undeclared: string[] = [];
  for (const { path: filePath, content } of files) {
    for (const match of content.matchAll(INCLUDE_MARKER)) {
      const dir = match[1];
      if (!declared.has(dir)) {
        undeclared.push(`${filePath} references undeclared include directory: ${dir}`);
      }
    }
  }
  return undeclared;
};

const checkBuildInputDirs = (): CheckResult => {
  const treeRoots = REFERENCE_TREE_ROOTS.map((rel) => path.join(root, rel));
  const leaks = findLeakedBuildInputDirs(BUILD_INPUT_ONLY_DIRS, treeRoots);

  const sourceFiles = [
    ...walkMdFilesAbs(path.join(root, 'src', 'agents')),
    ...walkMdFilesAbs(path.join(root, 'src', 'references')),
  ].map((f) => ({ path: path.relative(root, f), content: fs.readFileSync(f, 'utf-8') }));
  const undeclared = findUndeclaredIncludeMarkers(sourceFiles, BUILD_INPUT_ONLY_DIRS);

  const errors = [...leaks, ...undeclared];
  return errors.length
    ? { id: 'V-INCLUDE-01', ok: false, detail: errors.join('; ') }
    : { id: 'V-INCLUDE-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkBuildInputDirs()];
