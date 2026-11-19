'use strict';

/**
 * Where a Bash `cp`/`mv`/`install`/`rsync`/`ln` write actually lands once its destination is inside
 * the campaign state dir (`hook-event-log.js` `campaignStateRoot`). The destination path alone is
 * not enough: a link planted in an allowed directory points a later write at `config.json` or the
 * hook event log, and a directory destination lands each source under its own name. The protocol
 * only ever writes regular files there, so a link created in the state dir is refused outright,
 * and a directory destination is judged per source entry.
 */

const fs = require('fs');
const path = require('path');
const { isStateDirTrustedPath } = require('./hook-event-log');

const DYNAMIC_SOURCE_RE = /[$*?[`~{]/;

const hasShortFlag = (flags, letters) => flags.some((f) => /^-[^-]/.test(f) && [...f.slice(1)].some((c) => letters.includes(c)));
const hasLongFlag = (flags, ...names) =>
  flags.some((f) => {
    const word = f.split('=')[0];
    return word.startsWith('--') && word.length >= 3 && names.some((name) => name.startsWith(word));
  });

/** True when the command creates a new link (hard or symbolic) at the destination. */
const createsLink = ({ name, flags }) =>
  name === 'ln' || (name === 'cp' && (hasShortFlag(flags, 'sl') || hasLongFlag(flags, '--symbolic-link', '--link')));

/** True when the command moves or copies a link as a link, not the file it points at. */
const keepsLinks = ({ name, flags }) =>
  name === 'mv' ||
  (name === 'cp' && (hasShortFlag(flags, 'aPdrR') || hasLongFlag(flags, '--archive', '--no-dereference', '--recursive'))) ||
  (name === 'rsync' && (hasShortFlag(flags, 'al') || hasLongFlag(flags, '--archive', '--links')));

const isLink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

const isDirectory = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Names a source puts under a directory destination: its basename, or its entries when it is
 * written `dir/.` or `dir/` (copy the contents). */
const sourceEntryNames = (resolvedSource, written) => {
  if (/(^|\/)\.$|\/$/.test(written) && isDirectory(resolvedSource)) {
    try {
      return fs.readdirSync(resolvedSource);
    } catch {
      return [];
    }
  }
  return [path.basename(resolvedSource)];
};

/**
 * `'unsafe'` when the write could reach a protected path or plant a link, `'unknown'` when a
 * source cannot be resolved statically, `'ok'` otherwise. `meta` is `{ name, flags, sources }`
 * from the guard's copy/move parsing, `dest` the resolved destination, `dir` the directory the
 * command's relative arguments resolve against.
 */
const judgeStateDestination = (meta, dest, dir, stateRoot) => {
  if (!meta) return 'ok';
  if (createsLink(meta)) return 'unsafe';
  const sources = meta.sources.map((written) => ({ written, resolved: path.resolve(dir, written.replace(/^['"]|['"]$/g, '')) }));
  if (keepsLinks(meta) && sources.some((s) => isLink(s.resolved))) return 'unsafe';
  const noJoin = hasShortFlag(meta.flags, 'T') || hasLongFlag(meta.flags, '--no-target-directory');
  if (noJoin || !['cp', 'mv', 'install', 'rsync'].includes(meta.name) || !isDirectory(dest)) return 'ok';
  let verdict = 'ok';
  for (const { written, resolved } of sources) {
    if (DYNAMIC_SOURCE_RE.test(written)) {
      verdict = 'unknown';
      continue;
    }
    for (const entryName of sourceEntryNames(resolved, written)) {
      const entry = path.join(dest, entryName);
      if (isLink(entry) || fs.existsSync(entry)) {
        let target;
        try {
          target = fs.realpathSync(entry);
        } catch {
          return 'unsafe';
        }
        if (!isStateDirTrustedPath(target, stateRoot)) return 'unsafe';
      }
    }
  }
  return verdict;
};

module.exports = { judgeStateDestination };
