import * as fs from 'fs';
import * as path from 'path';

// `scripts/detect-frontend.sh` is the single home of the frontend keyword set (UI file extensions,
// UI directories, root index.html, bundler/CSS config names). This module reads that file instead
// of restating the list, so the on-demand audit module 14's "diff is frontend-touching" predicate
// cannot drift from the script that decides whether the *project* is a frontend. The package.json
// framework-dependency step has no path form and stays project-level only.
export const DETECT_FRONTEND_SCRIPT = path.join(import.meta.dirname, '..', 'detect-frontend.sh');

export type FrontendPathSet = { extensions: string[]; uiDirs: string[]; rootFiles: string[]; configNames: string[] };

const words = (list: string): string[] => list.split(/\s+/).filter(Boolean);

export const parseFrontendPathSet = (script: string): FrontendPathSet => {
  const forList = (loopVar: string): string[] => {
    const m = new RegExp(`for ${loopVar} in ([^;]+); do`).exec(script);
    return m ? words(m[1]) : [];
  };
  return {
    extensions: [...script.matchAll(/-name '\*\.(\w+)'/g)].map((m) => m[1]),
    uiDirs: forList('ui_dir'),
    rootFiles: [...script.matchAll(/\[\[ -f ([\w./-]+) \]\] && emit_yes/g)].map((m) => m[1]),
    configNames: forList('cfg'),
  };
};

export const loadFrontendPathSet = (scriptPath = DETECT_FRONTEND_SCRIPT): FrontendPathSet => {
  const set = parseFrontendPathSet(fs.readFileSync(scriptPath, 'utf-8'));
  if (!set.extensions.length || !set.uiDirs.length || !set.rootFiles.length || !set.configNames.length) {
    throw new Error(`frontend-paths: could not read every keyword group from ${scriptPath} (extensions, ui_dir, index file, cfg)`);
  }
  return set;
};

/** True when a repo-relative changed path belongs to the frontend keyword set. */
export const isFrontendPath = (file: string, set: FrontendPathSet = loadFrontendPathSet()): boolean => {
  const ext = path.extname(file).slice(1);
  const base = path.basename(file);
  return (
    set.extensions.includes(ext) ||
    set.uiDirs.some((d) => file === d || file.startsWith(`${d}/`)) ||
    set.rootFiles.includes(file) ||
    set.configNames.includes(base)
  );
};
