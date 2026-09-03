import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { walkFilesAbs } from './fs.ts';

// Issue #800 (ADR-030) — computePluginDrift: pure, path-injected drift detector between the
// installed Claude Code plugin cache copy of blackhole's hooks/ tree and the repo's own build
// target (`.claude/hooks/`). Exists because Claude Code's plugin cache is version-keyed, not
// content-addressed (`.blackhole/plans/issue-800-research.md`) — three merged hook security
// fixes (#761/#774/#777) shipped inert while the installed and repo copies reported the
// identical version string, so a version-string comparison alone cannot detect this class of
// drift. Paths are passed in rather than resolved here, so tests point both at fixture
// directories without touching the real `~/.claude/plugins/cache` (injected fs/paths per the
// plan's TDD requirement).

export type PluginDriftResult = {
  installed_present: boolean;
  hooks_hash_match: boolean | null;
};

// sha256 over the sorted (relative-path, content) pairs of every file under `dir` — order-
// independent of filesystem readdir ordering, and sensitive to both a file's content and its
// relative location (a rename/relocation is a mismatch, not a false match). Reuses
// `walkFilesAbs` (V-INT-02) rather than a second recursive-directory-walk implementation.
export const hashDirectory = (dir: string): string => {
  const hash = createHash('sha256');
  const relPaths = walkFilesAbs(dir)
    .map((abs) => path.relative(dir, abs).split(path.sep).join('/'))
    .sort();
  for (const relPath of relPaths) {
    hash.update(relPath);
    hash.update(fs.readFileSync(path.join(dir, relPath)));
  }
  return hash.digest('hex');
};

// `installedHooksDir` is the resolved, version-substituted installed cache path (e.g.
// `~/.claude/plugins/cache/blackhole-marketplace/blackhole/0.21.0/hooks`); `repoHooksDir` is
// the repo's own build target (`.claude/hooks/`). An absent installed directory is a distinct,
// first-class outcome (`installed_present: false`, `hooks_hash_match: null`) — never silently
// defaulted to a match, which is exactly the false-confidence failure mode this signal exists
// to prevent.
export const computePluginDrift = (installedHooksDir: string, repoHooksDir: string): PluginDriftResult => {
  if (!fs.existsSync(installedHooksDir)) {
    return { installed_present: false, hooks_hash_match: null };
  }
  return {
    installed_present: true,
    hooks_hash_match: hashDirectory(installedHooksDir) === hashDirectory(repoHooksDir),
  };
};
