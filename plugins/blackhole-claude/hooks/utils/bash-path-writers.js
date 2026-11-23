'use strict';

/**
 * bash-path-writers.js — the write targets of commands that create, remove, extract or download
 * files without a redirect: `rm`, `touch`, `chmod`, `mkdir`, `rename`, `tar`, `unzip`, `curl`,
 * `wget`, `patch`, `find -delete`, and whether an `xargs` or `find -exec` feeds a writer targets
 * the command string does not show. `bash-write-target-guard.js` judges every target
 * this module returns exactly like its own; this module only reads the operands.
 *
 * Each target carries a `shape`:
 *  - `FILE_WRITE` for an option that names the one file the command opens (`curl -o F`,
 *    `wget -O F`, `tar -cf F`), the same file a redirect would open;
 *  - `PATH_OP` for a path a command removes, creates or changes in place (`rm`, `touch`, `chmod`,
 *    `mkdir`, `find -delete`): allowed in a trusted extra root (the scratchpad), never in the state
 *    dir;
 *  - none for a directory a command extracts or downloads into (`tar -C`, `unzip -d`, `wget -P`,
 *    `patch -d`, a `git -C` base): such a target is judged like a `cp -r` destination, allowed
 *    inside the assigned worktree and blocked everywhere else, the scratchpad and the state dir
 *    included, since what lands under it is named by the archive or the server, not the command.
 *
 * The guard's helpers are passed in (`h`) rather than required, so this module does not depend
 * back on the guard that requires it.
 */

const { FILE_WRITE } = require('./state-dir-write-shape');

/** Shape tag for a path a command removes, creates or changes in place. */
const PATH_OP = 'path-op';

/** A target no literal check can resolve (the guard's `UNRESOLVABLE_TARGET`). */
const UNRESOLVABLE = '$UNRESOLVABLE';

/**
 * getopt-style parse. `spec.short` holds the short letters that take a value (the rest of the
 * cluster, or the next word), `spec.long` the long options that take the next word when written
 * without `=`, `spec.flags` the long options that take none (or only an `=VALUE`), and
 * `spec.exact` is true for a command that accepts no abbreviation (curl). Options may follow
 * operands (GNU permutation). An exact name wins over an abbreviation; an abbreviation that may
 * name a value option takes the next word.
 *
 * Fail closed in both directions a misread could hide a target:
 *  - a value taken from the next word that itself starts with `-` is also read as an option
 *    (its targets are added) and the parse is `uncertain`, so `--head -o F` judges F;
 *  - an unknown long option without `=` may take a value, which would then be read as an
 *    operand; for a command whose targets include an operand picked by position
 *    (`spec.positional`, i.e. patch), that makes the parse `uncertain`. Elsewhere every operand is
 *    a target or never one, so the misread only adds or drops a non-target.
 * `h.isLongOptionPrefix` is the guard's own abbreviation rule.
 */
const parseGetopt = (args, spec, h) => {
  const positional = [];
  const opts = [];
  let uncertain = false;
  const takeNext = (i) => {
    const next = args[i + 1];
    if (next === undefined) return { value: UNRESOLVABLE, consumed: false };
    // A value that looks like an option is kept as a value and also parsed as an option.
    if (next.length > 1 && next.startsWith('-')) {
      uncertain = true;
      return { value: next, consumed: false };
    }
    return { value: next, consumed: true };
  };
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const word = eq === -1 ? t : t.slice(0, eq);
      const longs = spec.long || [];
      const flags = spec.flags || [];
      const match = (list) => (spec.exact ? list.filter((n) => n === word) : list.filter((n) => h.isLongOptionPrefix(word, n)));
      const valueNames = longs.includes(word) ? [word] : flags.includes(word) ? [] : match(longs);
      const flagNames = flags.includes(word) ? [word] : longs.includes(word) ? [] : match(flags);
      if (eq !== -1) opts.push({ names: [word, ...valueNames, ...flagNames], value: t.slice(eq + 1) });
      else if (valueNames.length > 0) {
        const { value, consumed } = takeNext(i);
        opts.push({ names: valueNames, value });
        if (consumed) i++;
      } else {
        if (flagNames.length === 0 && spec.positional) uncertain = true;
        opts.push({ names: [word, ...flagNames], value: null });
      }
    } else if (t.length > 1 && t.startsWith('-')) {
      for (let c = 1; c < t.length; c++) {
        const name = `-${t[c]}`;
        if ((spec.short || '').includes(t[c])) {
          if (c + 1 < t.length) opts.push({ names: [name], value: t.slice(c + 1) });
          else {
            const { value, consumed } = takeNext(i);
            opts.push({ names: [name], value });
            if (consumed) i++;
          }
          break;
        }
        opts.push({ names: [name], value: null });
      }
    } else positional.push(t);
  }
  const has = (...names) => opts.some((o) => o.names.some((n) => names.includes(n)));
  const values = (...names) => opts.filter((o) => o.value !== null && o.names.some((n) => names.includes(n))).map((o) => o.value);
  return { positional, has, values, uncertain };
};

/** Commands whose every operand is a path they remove, create or change in place, with the
 * options of each that take a value. `rename` computes its destinations from an expression, so
 * its operands are checked and the clause also warns. */
const PATH_OP_COMMANDS = {
  rm: {},
  rmdir: {},
  unlink: {},
  shred: { short: 'ns', long: ['--iterations', '--size', '--random-source'] },
  touch: { short: 'drt', long: ['--date', '--reference', '--time'] },
  mkdir: { short: 'm', long: ['--mode', '--context'] },
  chmod: { long: ['--reference'] },
  chown: { long: ['--from', '--reference'] },
  chgrp: { long: ['--reference'] },
  rename: {},
};

/** Every command this module or the guard knows writes, for `xargs`/`find -exec`. */
const WRITER_NAMES = new Set([
  ...Object.keys(PATH_OP_COMMANDS),
  'cp', 'mv', 'install', 'ln', 'truncate', 'dd', 'rsync', 'tee', 'sed', 'tar', 'unzip', 'curl', 'wget',
  'patch', 'git', 'yq', 'sort', 'uniq', 'perl', 'python', 'python3', 'node', 'bun', 'ruby', 'awk',
  'sh', 'bash', 'dash', 'zsh', 'ksh', 'eval', 'xargs', 'find',
]);

/** Clause heads whose later words are text, patterns or subcommands, never a command to run:
 * `echo rm /x`, `grep touch /etc/x` and `git rm x` name no `rm` or `touch` to judge here (`git` is
 * judged by the guard's own git finder). */
const TEXT_HEADS = new Set(['echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'git', 'gh', 'man', 'which', 'type', 'whatis', 'apropos', 'help']);

const tarTargets = (args, h) => {
  // Old-style `tar xzf A -C D`: the first word is a cluster without its dash, and each of its
  // value letters takes the next word in order.
  let words = args;
  if (args.length > 0 && /^[A-Za-z]+$/.test(args[0]) && /[ctxruA]/.test(args[0])) {
    const expanded = [];
    let next = 1;
    for (const letter of args[0]) {
      expanded.push(`-${letter}`);
      if ('bCfFgHIKLNTVX'.includes(letter) && next < args.length) expanded.push(args[next++]);
    }
    words = [...expanded, ...args.slice(next)];
  }
  const o = parseGetopt(words, {
    short: 'bCfFgHIKLNTVX',
    flags: ['--checkpoint', '--occurrence', '--extract', '--get', '--create', '--append', '--update', '--catenate', '--concatenate', '--delete', '--list', '--diff', '--compare', '--absolute-names', '--verbose', '--gzip', '--gunzip', '--bzip2', '--xz', '--zstd', '--lzma', '--auto-compress', '--keep-old-files', '--overwrite', '--no-same-owner', '--same-permissions', '--preserve-permissions', '--strip', '--totals', '--dereference', '--recursion', '--no-recursion', '--one-file-system', '--sparse', '--wildcards', '--anchored', '--ignore-case', '--null', '--verify', '--to-stdout', '--touch', '--unlink-first', '--recursive-unlink', '--remove-files', '--show-transformed-names', '--backup', '--one-top-level', '--exclude-vcs', '--exclude-backups', '--exclude-caches'],
    long: ['--directory', '--file', '--files-from', '--exclude', '--exclude-from', '--blocking-factor', '--format', '--group', '--owner', '--mode', '--transform', '--xform', '--to-command', '--use-compress-program', '--listed-incremental', '--newer', '--after-date', '--label', '--info-script', '--new-volume-script', '--rsh-command', '--rmt-command', '--index-file', '--suffix', '--strip-components', '--checkpoint-action', '--mtime', '--level', '--record-size', '--tape-length', '--occurrence', '--quoting-style', '--warning'],
  }, h);
  const targets = [];
  let unresolvable = o.uncertain;
  if (o.has('-c', '-r', '-u', '-A', '--create', '--append', '--update', '--catenate', '--concatenate', '--delete')) {
    for (const f of o.values('-f', '--file')) if (f !== '-') targets.push({ target: f, shape: FILE_WRITE });
  }
  if (o.has('-x', '--extract', '--get')) {
    // `-C a -C b` extracts into `a/b`: each directory and the path they join to are checked.
    const dirs = o.values('-C', '--directory');
    for (let k = 0; k < dirs.length; k++) targets.push({ target: dirs[k] }, { target: dirs.slice(0, k + 1).join('/') });
    if (dirs.length === 0) targets.push({ target: '.' });
    // Absolute or `..` member names, or members piped to a command, land where the archive says.
    if (o.has('-P', '--absolute-names', '--to-command')) unresolvable = true;
  }
  return { targets, unresolvable };
};

const unzipTargets = (args, h) => {
  const o = parseGetopt(args, { short: 'dP' }, h);
  // `-l`/`-v`/`-t`/`-Z` list or test and `-p`/`-c` print to stdout; nothing is extracted.
  if (o.has('-l', '-v', '-t', '-Z', '-p', '-c', '-z')) return { targets: [], unresolvable: false };
  const dirs = o.values('-d');
  return { targets: (dirs.length > 0 ? dirs : ['.']).map((target) => ({ target })), unresolvable: o.uncertain || o.has('-:') };
};

const curlTargets = (args, h) => {
  const o = parseGetopt(args, {
    short: 'AbcCdDeEFHKmoPQrtTuUwxXyYz',
    exact: true,
    flags: ['--head', '--silent', '--show-error', '--location', '--fail', '--insecure', '--verbose', '--include', '--compressed', '--remote-name', '--remote-name-all', '--remote-header-name', '--create-dirs', '--progress-bar', '--globoff', '--get'],
    long: ['--output', '--output-dir', '--dump-header', '--cookie-jar', '--trace', '--trace-ascii', '--stderr', '--libcurl', '--etag-save', '--hsts', '--alt-svc', '--config', '--header', '--data', '--data-binary', '--data-raw', '--data-urlencode', '--form', '--user', '--user-agent', '--referer', '--request', '--cookie', '--proxy', '--max-time', '--connect-timeout', '--retry', '--write-out', '--upload-file', '--url', '--cacert', '--cert', '--key', '--range'],
  }, h);
  const files = o.values('-o', '--output', '-D', '--dump-header', '-c', '--cookie-jar', '--trace', '--trace-ascii', '--stderr', '--libcurl', '--etag-save', '--hsts', '--alt-svc');
  const targets = files.filter((f) => f !== '-').map((target) => ({ target, shape: FILE_WRITE }));
  const dirs = o.values('--output-dir');
  targets.push(...dirs.map((target) => ({ target })));
  if (dirs.length === 0 && o.has('-O', '--remote-name', '--remote-name-all', '-J', '--remote-header-name')) targets.push({ target: '.' });
  return { targets, unresolvable: o.uncertain || o.has('-K', '--config') };
};

const wgetTargets = (args, h) => {
  const o = parseGetopt(args, {
    short: 'eoaiBtOTwQPlARDXIU',
    flags: ['--quiet', '--verbose', '--no-verbose', '--continue', '--timestamping', '--recursive', '--mirror', '--no-parent', '--page-requisites', '--convert-links', '--no-clobber', '--no-check-certificate', '--server-response', '--spider', '--background', '--force-directories', '--no-directories', '--content-disposition', '--show-progress', '--no-host-directories'],
    long: ['--output-document', '--output-file', '--append-output', '--directory-prefix', '--execute', '--input-file', '--base', '--tries', '--timeout', '--wait', '--quota', '--level', '--accept', '--reject', '--domains', '--exclude-directories', '--include-directories', '--user-agent', '--load-cookies', '--save-cookies', '--post-file', '--post-data', '--header', '--user', '--password', '--referer', '--rejected-log', '--warc-file', '--config'],
  }, h);
  const files = o.values('-O', '--output-document', '-o', '--output-file', '-a', '--append-output', '--save-cookies', '--rejected-log');
  const targets = files.filter((f) => f !== '-').map((target) => ({ target, shape: FILE_WRITE }));
  const dirs = o.values('-P', '--directory-prefix');
  targets.push(...dirs.map((target) => ({ target })));
  // Without -O or -P, wget saves into the working directory.
  if (dirs.length === 0 && o.values('-O', '--output-document').length === 0) targets.push({ target: '.' });
  for (const prefix of o.values('--warc-file')) targets.push({ target: prefix });
  return { targets, unresolvable: o.uncertain || o.has('-e', '--execute', '--config') };
};

const patchTargets = (args, h) => {
  const o = parseGetopt(args, {
    short: 'BDdFgioprVYz',
    positional: true,
    flags: ['--backup', '--batch', '--forward', '--force', '--silent', '--quiet', '--verbose', '--dry-run', '--reverse', '--unified', '--context', '--normal', '--ed', '--ignore-whitespace', '--remove-empty-files', '--posix', '--binary', '--merge', '--no-backup-if-mismatch', '--backup-if-mismatch', '--set-time', '--set-utc'],
    long: ['--prefix', '--ifdef', '--directory', '--fuzz', '--get', '--input', '--output', '--strip', '--reject-file', '--version-control', '--basename-prefix', '--suffix', '--quoting-style'],
  }, h);
  const dirs = o.values('-d', '--directory');
  const base = dirs.length > 0 ? dirs[dirs.length - 1] : null;
  const within = (p) => (base === null || p.startsWith('/') ? p : `${base}/${p}`);
  const targets = [...dirs, ...(dirs.length === 0 ? ['.'] : [])].map((target) => ({ target }));
  for (const file of [...o.positional.slice(0, 1), ...o.values('-o', '--output', '-r', '--reject-file')]) {
    if (file !== '-') targets.push({ target: within(file) });
  }
  // A backup prefix or suffix may name another directory.
  return { targets, unresolvable: o.uncertain || o.has('-B', '--prefix', '-Y', '--basename-prefix', '-z', '--suffix') };
};

/** `find PATH… EXPR`: `-delete` and a writer run by `-exec` act on what it finds under its start
 * paths, and `-fprint F` writes F. A writer run by `-exec` receives names the command string does
 * not show, so the clause also warns. */
const findTargets = (args) => {
  let i = 0;
  while (i < args.length && /^-[HLP]$/.test(args[i])) i++;
  const starts = [];
  while (i < args.length && !/^[-(!)]/.test(args[i])) starts.push(args[i++]);
  const targets = [];
  let acts = false;
  let unresolvable = false;
  for (; i < args.length; i++) {
    const t = args[i];
    if (t === '-delete') acts = true;
    else if (['-fprint', '-fprint0', '-fls', '-fprintf'].includes(t) && i + 1 < args.length) {
      targets.push({ target: args[++i], shape: FILE_WRITE });
    } else if (['-exec', '-execdir', '-ok', '-okdir'].includes(t) && i + 1 < args.length) {
      const name = args[i + 1].replace(/['"\\]/g, '');
      if (WRITER_NAMES.has(name.slice(name.lastIndexOf('/') + 1))) acts = unresolvable = true;
    }
  }
  if (acts) targets.push(...(starts.length > 0 ? starts : ['.']).map((target) => ({ target, shape: PATH_OP })));
  return { targets, unresolvable };
};

/** xargs options that take the next word as their value. */
const XARGS_VALUE_OPTIONS = new Set([
  '-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a', '--arg-file', '--delimiter', '--max-args', '--max-procs',
  '--max-lines', '--max-chars', '--replace', '--eof', '--process-slot-var',
]);

/** Index of the command xargs runs: the first word after xargs's own options. */
const xargsCommandIndex = (tokens, from) => {
  let i = from;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    if (tokens[i] === '--') return i + 1;
    i += XARGS_VALUE_OPTIONS.has(tokens[i]) ? 2 : 1;
  }
  return i;
};

/** Wrappers that run the rest of their words as a command (`xargs sudo rm`). */
const RUN_WRAPPERS = new Set(['sudo', 'doas', 'env', 'nice', 'nohup', 'timeout', 'command', 'exec', 'stdbuf', 'ionice', 'time', 'chronic']);

/** True when the command at `tokens[idx]` is a writer, or a wrapper whose later words name one. */
const runsWriter = (tokens, idx, h) => {
  if (idx >= tokens.length) return false;
  const name = h.commandName(tokens[idx]);
  if (WRITER_NAMES.has(name)) return true;
  return RUN_WRAPPERS.has(name) && tokens.slice(idx + 1).some((t) => WRITER_NAMES.has(h.commandName(t)));
};

const ARGUMENT_WRITERS = [
  ['tar', tarTargets],
  ['unzip', unzipTargets],
  ['curl', curlTargets],
  ['wget', wgetTargets],
  ['patch', patchTargets],
  ['find', findTargets],
];

/**
 * The targets of every path writer in one clause, as `{ target, shape }` with `target` a word as
 * written, and whether a writer's targets cannot be read from the command string. `h` carries the
 * guard's `findCommand(tokens, name)`, `argsAfter(tokens, idx)` (operands with redirect words
 * dropped), `targetWord(word)`, `commandName(word)` and `isLongOptionPrefix(word, name)`.
 */
const findPathWriterTargets = (tokens, h) => {
  const targets = [];
  let unresolvable = false;
  const head = tokens.find((t) => !/^[A-Za-z_]\w*=/.test(t));
  if (head !== undefined && TEXT_HEADS.has(h.commandName(head))) return { targets, unresolvable };
  for (const [name, spec] of Object.entries(PATH_OP_COMMANDS)) {
    const idx = h.findCommand(tokens, name);
    if (idx === -1) continue;
    const { positional, uncertain } = parseGetopt(h.argsAfter(tokens, idx), spec, h);
    targets.push(...positional.map((word) => ({ target: h.targetWord(word), shape: PATH_OP })));
    if (name === 'rename' || uncertain) unresolvable = true;
  }
  for (const [name, extract] of ARGUMENT_WRITERS) {
    const idx = h.findCommand(tokens, name);
    if (idx === -1) continue;
    const found = extract(h.argsAfter(tokens, idx), h);
    targets.push(...found.targets.map(({ target, shape }) => ({ target: target === UNRESOLVABLE ? target : h.targetWord(target), shape })));
    if (found.unresolvable) unresolvable = true;
  }
  // `xargs` hands the command it runs operands read from stdin.
  const xargs = h.findCommand(tokens, 'xargs');
  if (xargs !== -1 && runsWriter(tokens, xargsCommandIndex(tokens, xargs + 1), h)) unresolvable = true;
  return { targets, unresolvable };
};

module.exports = { findPathWriterTargets, PATH_OP };
