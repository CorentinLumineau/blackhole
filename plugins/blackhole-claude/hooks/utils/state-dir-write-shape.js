'use strict';

/**
 * The Bash write shapes that may land in the campaign state dir (`hook-event-log.js`
 * `campaignStateRoot`). Trust there is an allow-list, not a model of every writer: a target the
 * guard resolves under the state root is trusted only when it was written by
 *  1. a redirect or `tee` naming that file (`FILE_WRITE`), or
 *  2. `cp`, `mv` or `install` with exactly one source that is a regular file, to an explicit file
 *     destination, using only the flags in `ALLOWED_FLAGS` (a `mv` source must be in the state
 *     dir too).
 * Every other shape (a directory destination, a recursive or archive copy, rsync, link creation,
<<<<<<< HEAD
 * sed, dd, truncate, …) keeps the outside-assigned-worktree block. The extra roots from
 * `trustedWriteRoots` (scratchpad, declared cross-repo worktrees) use the same allow-list. The guard judges a path while
=======
 * sed, dd, truncate, …) keeps the outside-assigned-worktree block. The guard judges a path while
>>>>>>> origin/main
 * the shell picks the file actually written, so only shapes where the two are the same path earn
 * trust; `isStateDirTrustedPath` then judges that path and its leaf.
 */

const fs = require('fs');
const path = require('path');
const { isStateDirTrustedPath } = require('./hook-event-log');

/** Shape tag for a redirect or `tee` target: the shell opens exactly that file. */
const FILE_WRITE = 'file';

/** Path text the shell passes through unchanged and the guard reads as written: no expansion,
 * quote, glob, glued operator or whitespace, no `..` segment (resolved lexically here but through
 * symlinks by the kernel) and no trailing `/` or `/.` (a directory, not a file). */
const isPlainFilePath = (text) =>
  /^[\w.@%+,:=/-]+$/.test(text) && !text.split('/').includes('..') && !/(^|\/)\.?$/.test(text);

/** Flags that change neither which file is written nor how: per command, short letters (as a
 * cluster) and exact long names. `install -m` takes a mode, attached or as the next word. */
const ALLOWED_FLAGS = {
  cp: { short: 'finpv', long: ['--force', '--interactive', '--no-clobber', '--preserve', '--verbose'] },
  mv: { short: 'finv', long: ['--force', '--interactive', '--no-clobber', '--verbose'] },
  install: { short: 'pvC', long: ['--preserve-timestamps', '--verbose', '--compare'] },
};
const MODE_RE = /^[0-7]{3,4}$/;

/** The source and destination of a shape-2 call, or null when `args` uses any other flag or does
 * not name exactly one source and one destination. */
const parseSingleFileCopy = (name, args) => {
  const allowed = ALLOWED_FLAGS[name];
  if (!allowed) return null;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (!t.startsWith('-')) positional.push(t);
    else if (name === 'install' && t === '-m' && MODE_RE.test(args[i + 1] || '')) i++;
    else if (name === 'install' && (/^-m[0-7]{3,4}$/.test(t) || /^--mode=[0-7]{3,4}$/.test(t))) continue;
    else if (allowed.long.includes(t)) continue;
    else if (!/^-[a-zA-Z]+$/.test(t) || [...t.slice(1)].some((c) => !allowed.short.includes(c))) return null;
  }
  return positional.length === 2 ? { source: positional[0], dest: positional[1] } : null;
};

const lstatOrNull = (p) => {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
};

/** True when `meta` (`{ name, args }` from the guard's copy/move parsing) is shape 2 resolved
 * against `dir`: the source exists as a regular file and the destination is not an existing
 * directory. `mv` keeps its source's inode, and an earlier clause of the same command can swap a
 * worktree file for a link before it runs, so its source must itself be a trusted state-dir path. */
<<<<<<< HEAD
const isSingleFileCopy = (meta, dir, isTrusted) => {
=======
const isSingleFileCopy = (meta, dir, stateRoot) => {
>>>>>>> origin/main
  const parsed = parseSingleFileCopy(meta.name, meta.args);
  if (!parsed || !isPlainFilePath(parsed.source) || !isPlainFilePath(parsed.dest)) return false;
  const sourcePath = path.resolve(dir, parsed.source);
  const source = lstatOrNull(sourcePath);
  if (!source || !source.isFile()) return false;
<<<<<<< HEAD
  if (meta.name === 'mv' && !isTrusted(sourcePath)) return false;
=======
  if (meta.name === 'mv' && !isStateDirTrustedPath(sourcePath, stateRoot)) return false;
>>>>>>> origin/main
  const dest = lstatOrNull(path.resolve(dir, parsed.dest));
  return !dest || dest.isFile();
};

/** True when a write the guard resolved to `resolvedPath` (from `target` as written, relative to
<<<<<<< HEAD
 * `dir`) is an allowed shape and `isTrusted` trusts the path it lands on (and, for `mv`, its
 * source). Every trusted root with a path predicate of its own shares this allow-list. */
const isTrustedShapedWrite = ({ target, shape }, resolvedPath, dir, isTrusted) => {
  if (!shape || !isPlainFilePath(target) || !isTrusted(resolvedPath)) return false;
  return shape === FILE_WRITE || isSingleFileCopy(shape, dir, isTrusted);
};

/** `isTrustedShapedWrite` for the campaign state dir: a path `isStateDirTrustedPath` trusts. */
const isTrustedStateWrite = (write, resolvedPath, dir, stateRoot) =>
  isTrustedShapedWrite(write, resolvedPath, dir, (p) => isStateDirTrustedPath(p, stateRoot));

module.exports = { FILE_WRITE, isTrustedShapedWrite, isTrustedStateWrite };
=======
 * `dir`) is trusted in the state dir: an allowed shape, and a path `isStateDirTrustedPath` trusts. */
const isTrustedStateWrite = ({ target, shape }, resolvedPath, dir, stateRoot) => {
  if (!shape || !isPlainFilePath(target) || !isStateDirTrustedPath(resolvedPath, stateRoot)) return false;
  return shape === FILE_WRITE || isSingleFileCopy(shape, dir, stateRoot);
};

module.exports = { FILE_WRITE, isTrustedStateWrite };
>>>>>>> origin/main
