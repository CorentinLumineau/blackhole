#!/usr/bin/env bun
'use strict';

/**
 * bash-write-target-guard.js — dynamic PreToolUse check extending #620's assigned-worktree
 * containment to Bash file-write commands (issue #804, ADR-029).
 *
 * #620 shipped `BLACKHOLE_ASSIGNED_WORKTREE` containment for the `Write`/`Edit` tools
 * (`validate-file-changes.js`), but a worker that writes via `Bash` (`sed -i`, heredocs,
 * `cat >`, `tee`, `cp`/`mv`) sailed straight past it — exactly the shape of #804's incident. This
 * module extracts common file-write-target shapes from a Bash command string and applies the
 * same `readAssignedWorktreeRoot`/`isUnderRoot` containment check `validate-file-changes.js`
 * already uses (`V-INT-02` — never re-derived), rather than a second containment mechanism.
 *
 * Two tiers, matching this hook's own two-tier vocabulary (`validate-bash-command.js`'s module
 * docstring):
 *  - a **resolvable** target (a literal path this module can compute without executing anything)
 *    that resolves outside the assigned root → `block` (`bash-outside-assigned-worktree`).
 *  - a **write-shaped-but-unresolvable** command — a dynamic target (`$VAR`, `$(cmd)`, a glob),
 *    or a command whose write behavior cannot be determined by inspecting the command string at
 *    all (`python3 -c`, `perl -i`, `awk`) → `warn` and record
 *    (`bash-write-target-unresolvable`), never a silent allow (ADR-029's accepted residual risk:
 *    command-string parsing cannot enumerate every write idiom).
 *
 * The check runs whenever `readAssignedWorktreeRoot` resolves a root — the declared
 * `BLACKHOLE_ASSIGNED_WORKTREE`, or the cwd-derived tier, so any session whose cwd is a linked
 * worktree is covered, interactive ones included. A null root returns null before any parsing.
 *
 * Read-only sources are never evaluated: `cp` extracts only the destination (last positional
 * argument) as a write target, exactly like `validate-file-changes.js` only ever evaluates a
 * write's own target — a source outside the assigned root (the ordinary shape of reading a shared
 * reference file) must never itself trigger a deny. `mv` is the exception: it unlinks its
 * sources, so every positional argument is a write target (see `findCopyMoveTargets`).
 */

const path = require('path');
const { computeMaskedSpans } = require('./bash-context');
const { skipQuotedSpan, isRedirectAmpersand } = require('./shell-lexer');
const { readAssignedWorktreeRoot, isUnderRoot } = require('./hook-event-log');
const { isLiteralPathArg } = require('./worktree-removal-guard');

/** Command words whose write behavior cannot be resolved by static inspection of the command
 * string at all — the residual gap ADR-029 accepts and downgrades to WARN rather than a silent
 * allow. `requiresFlag`, when set, narrows the match to invocations carrying that flag (a bare
 * `awk` invocation is unresolvable outright; a bare `python3`/`perl` invocation with
 * no `-c`/`-i` is not write-shaped at all and is left alone). */
const UNRESOLVABLE_WRITE_COMMANDS = [
  { name: 'python3', requiresFlag: '-c' },
  { name: 'python', requiresFlag: '-c' },
  { name: 'perl', requiresFlag: /^-[a-zA-Z]*i/ },
  { name: 'awk', requiresFlag: null },
];

/** Replaces every masked character (a `#` comment, a heredoc body, or a print-only-sink's quoted
 * literal text — see `bash-context.js`'s module docstring) with a space, preserving string
 * length/positions so the result can be scanned for real command syntax with plain
 * regexes/tokenizers. Reuses `computeMaskedSpans` rather than re-deriving which spans are
 * "described, not executed" text (`V-INT-02`) — this is the mechanism that keeps a heredoc body's
 * decoy `>` target, or an echo/printf argument's literal `>` text, from ever being scanned as a
 * real write target. */
const buildVisibleCommand = (command, masked) =>
  command
    .split('')
    .map((ch, i) => (masked[i] ? ' ' : ch))
    .join('');

/** Strips one matching pair of surrounding quotes (`'...'` or `"..."`), if present. */
const stripQuotes = (token) => {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return token.slice(1, -1);
    }
  }
  return token;
};

/** Quote-aware whitespace tokenizer over an already-visible (masked spans blanked) substring —
 * a quoted span (e.g. a sed script `'s/a/b/'`) is kept as one token, quotes intact, so
 * `stripQuotes` can later decide whether to unwrap it. */
const tokenize = (text) => {
  const tokens = [];
  let current = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t') {
      if (current) {
        tokens.push(current);
        current = '';
      }
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = skipQuotedSpan(text, i, n);
      current += text.slice(i, end);
      i = end;
      continue;
    }
    current += ch;
    i++;
  }
  if (current) tokens.push(current);
  return tokens;
};

/** Splits a visible (masked spans already blanked) command into clauses at top-level `;`, `|`,
 * newline, and `&` — except an `&` immediately adjacent to a `>` (the `&>`/`&>>` combined
 * stdout+stderr redirect operator, or a `>&`/`N>&` fd-duplication form), which belongs to a
 * redirect operator, never a clause separator. Quoted spans are walked whole so a separator
 * character inside a quote is never mistaken for a real one. Each clause is scanned independently
 * for its own leading command word (`tee`, `sed`, `cp`, `mv`, or an unresolvable-write command) so
 * a chained command's later clause is never mistaken for the first clause's own arguments.
 *
 * QUOTE POLICY: this splitter is quote-AWARE by requirement — `skipQuotedSpan` walks a quoted
 * span whole, so a separator character sitting inside a quoted argument is never mistaken for a
 * real clause boundary. This is load-bearing for this guard's own threat model: a quote-unaware
 * splitter turns `sed -i 's/a;b/c/' <main-clone-path>` from one clause (real target: the main
 * clone) into two, the second of which extracts no write target at all — deny becomes allow, the
 * F-00034 incident class. Pinned by
 * `scripts/hooks-validate-bash.test.ts`'s `#804: 'sed -i' whose script contains a quoted ';'
 * still resolves its real target (quote-policy pin)` case. Do not make this quote-unaware to
 * match `worktree-removal-guard.js`'s `findClauseStartIndices` — that guard needs the opposite
 * policy for its own, equally load-bearing reason (see that function's own `QUOTE POLICY:` note).
 */
const splitClauses = (visible) => {
  const clauses = [];
  let current = '';
  let i = 0;
  const n = visible.length;
  while (i < n) {
    const ch = visible[i];
    if (ch === "'" || ch === '"') {
      const end = skipQuotedSpan(visible, i, n);
      current += visible.slice(i, end);
      i = end;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '\n') {
      clauses.push(current);
      current = '';
      i++;
      continue;
    }
    if (ch === '&') {
      if (isRedirectAmpersand(visible, i)) {
        current += ch;
        i++;
        continue;
      }
      clauses.push(current);
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  clauses.push(current);
  return clauses;
};

/** True when `token` names `command` — either exactly, or as the final path segment of an
 * absolute/relative invocation (`/usr/bin/sed` still names `sed`). */
const isCommandToken = (token, command) => token === command || token.endsWith(`/${command}`);

/** True when a fd-duplication argument (`&1`, `&2`, ...) rather than a real file path — the one
 * shape `>`/`>>`/`&>` legitimately precede without naming a file (`2>&1`, `>&2`). */
const isFdDuplicationTarget = (token) => /^&\d+$/.test(token);

const REDIRECT_RE = /(&>>|&>|>>|>&|>\||>)\s*(\S+)?/g;

/** After a `>&` operator, a digit or `-` is fd duplication/close (`>&2`, `>&-`); anything else is a
 * file path (`>&file` is `&>file`). */
const isFdDupOperand = (token) => /^(\d+|-)(?:[;&|)]|$)/.test(token);

/** Every redirect-shaped write target in the full visible command — `>`, `>>`, `&>`, `&>>`
 * followed by a real file argument. Never a bare fd-duplication target (`&1`, `&2`) or a dangling
 * operator with nothing after it. Scanned across the whole command, not per clause: a redirect
 * operator's target binds to the nearest preceding command regardless of clause boundaries, so no
 * clause-scoping is needed here (unlike the command-argument scans below, which must not read
 * past their own clause). */
const findRedirectTargets = (visible) => {
  const targets = [];
  REDIRECT_RE.lastIndex = 0;
  let match = REDIRECT_RE.exec(visible);
  while (match !== null) {
    const raw = match[2];
    const isFdDup = match[1] === '>&' ? raw && isFdDupOperand(raw) : raw && isFdDuplicationTarget(raw);
    if (raw && !isFdDup) {
      targets.push(stripQuotes(raw));
    }
    match = REDIRECT_RE.exec(visible);
  }
  return targets;
};

/** Every token in `tokens` starting at `startIdx` up to (not including) the first shell-redirect
 * or pipe operator token (`<...`, `>...`, `&...`) — the point where a command's own positional
 * arguments end and shell syntax begins. `tee`'s here-string input (`<<< "x"`) is exactly this
 * shape: the tokenizer sees `<<<` and `"x"` as separate tokens, and stopping at the first token
 * starting with `<` excludes both from tee's own argument list. */
const positionalArgsBeforeRedirect = (tokens, startIdx) => {
  const args = [];
  for (let i = startIdx; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith('<') || token.startsWith('>') || token.startsWith('&')) break;
    args.push(token);
  }
  return args;
};

/** `tee [-a|--append] <target...>` write targets in one clause — every non-flag positional
 * argument after the command word, up to the first redirect/pipe. */
const findTeeTargets = (tokens) => {
  const cmdIdx = tokens.findIndex((t) => isCommandToken(t, 'tee'));
  if (cmdIdx === -1) return [];
  return positionalArgsBeforeRedirect(tokens, cmdIdx + 1)
    .filter((t) => !t.startsWith('-'))
    .map(stripQuotes);
};

/** `sed -i[.suffix]|--in-place[=suffix] <script> <target...>` write targets in one clause — only
 * when an in-place flag is present (a plain `sed 's/a/b/' file` prints to stdout and writes
 * nothing). The first non-flag positional argument is the script; every non-flag positional
 * argument after that is a target file (`sed -i 's/a/b/' f1 f2` edits both in place). */
const findSedTargets = (tokens) => {
  const cmdIdx = tokens.findIndex((t) => isCommandToken(t, 'sed'));
  if (cmdIdx === -1) return [];
  const args = positionalArgsBeforeRedirect(tokens, cmdIdx + 1);
  const inPlace = args.some((t) => t === '-i' || t.startsWith('-i.') || t.startsWith('--in-place'));
  if (!inPlace) return [];
  const positional = args.filter((t) => !t.startsWith('-'));
  return positional.slice(1).map(stripQuotes);
};

/** Destination directory named by `-t DIR`, `-tDIR`, a short cluster ending in `t` (`-pt DIR`),
 * `--target-directory=DIR` or `--target-directory DIR`, plus the remaining non-flag arguments
 * (sources). `dir` is null when no target-directory option is present. */
const splitTargetDirectory = (args) => {
  let dir = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t.startsWith('--target-directory=')) dir = t.slice('--target-directory='.length);
    else if (t === '--target-directory' || /^-[a-zA-Z]*t$/.test(t)) dir = args[++i] ?? dir;
    else if (/^-t.+/.test(t)) dir = t.slice(2);
    else if (!t.startsWith('-')) rest.push(t);
  }
  return { dir, rest };
};

/** `truncate` options that consume the following token as their value, so it is not a file. */
const TRUNCATE_VALUE_OPTIONS = new Set(['-s', '--size', '-r', '--reference']);

/** Every non-option positional of `truncate` is a file it truncates or creates; the values of
 * `-s`/`-r` (and their `--size=`/`--reference=`/`-s0` attached forms) are skipped. */
const truncateTargets = (args) => {
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (TRUNCATE_VALUE_OPTIONS.has(t)) i++;
    else if (t === '--') files.push(...args.slice(i + 1).map(stripQuotes));
    else if (!t.startsWith('-')) files.push(stripQuotes(t));
    if (t === '--') break;
  }
  return files;
};

/** A target no literal check can resolve; routes the clause to the `warn` tier. */
const UNRESOLVABLE_TARGET = '$UNRESOLVABLE';

const isRemoteRsyncPath = (t) => /^(rsync:\/\/|[^/]*:)/.test(t);

/** `rsync` destination: the last positional, a `host:path` or `rsync://` one being remote and not
 * a local write. rsync accepts options after the destination, and an option's value cannot be told
 * from a positional, so once an option follows the first positional the destination is
 * uncertain: every positional except the first source is checked and the clause also warns. */
const rsyncTargets = (args) => {
  const dashIdx = args.indexOf('--');
  const head = dashIdx === -1 ? args : args.slice(0, dashIdx);
  const tail = dashIdx === -1 ? [] : args.slice(dashIdx + 1);
  const firstPos = head.findIndex((t) => !t.startsWith('-'));
  const optionAfterPositional = firstPos !== -1 && head.slice(firstPos + 1).some((t) => t.startsWith('-'));
  const positional = [...head.filter((t) => !t.startsWith('-')), ...tail].map(stripQuotes);
  if (positional.length < 2) return [];
  if (optionAfterPositional) {
    return [...positional.slice(1).filter((t) => !isRemoteRsyncPath(t)), UNRESOLVABLE_TARGET];
  }
  const dest = positional[positional.length - 1];
  return isRemoteRsyncPath(dest) ? [] : [dest];
};

/** `cp`/`mv`/`install`/`ln <source...> <dest>` write targets in one clause. Without a
 * target-directory option the last positional argument is the destination; with one, that
 * directory is the destination and every positional is a source. `mv` also unlinks its sources,
 * so all of its positional arguments count. Fewer than two positional arguments and no
 * target-directory means there is no destination to evaluate (`cp --help`, a malformed call). */
const findCopyMoveTargets = (tokens) => {
  for (const name of ['cp', 'mv', 'install', 'ln', 'truncate', 'dd', 'rsync']) {
    const cmdIdx = tokens.findIndex((t) => isCommandToken(t, name));
    if (cmdIdx === -1) continue;
    const args = positionalArgsBeforeRedirect(tokens, cmdIdx + 1);
    if (name === 'dd') return args.filter((t) => t.startsWith('of=')).map((t) => stripQuotes(t.slice(3)));
    if (name === 'truncate') return truncateTargets(args);
    if (name === 'rsync') return rsyncTargets(args);
    // `install -d`/`--directory` creates every positional as a directory: all are write targets.
    if (name === 'install' && args.some((t) => t === '--directory' || /^-[a-zA-Z]*d[a-zA-Z]*$/.test(t))) {
      return args.filter((t) => !t.startsWith('-')).map(stripQuotes);
    }
    const { dir, rest } = splitTargetDirectory(args);
    if (dir === null && rest.length < 2) continue;
    const written = dir !== null ? [dir] : [rest[rest.length - 1]];
    if (name === 'mv') written.push(...rest);
    return written.map(stripQuotes);
  }
  return [];
};

/** True when `word` (the part of a `--long` token before any `=`) names `name` the way getopt_long
 * and git's parse-options accept it: exactly, or as an abbreviation of at least `--` plus one
 * letter. An ambiguous abbreviation is counted too — over-matching only adds a target. */
const isLongOptionPrefix = (word, name) => word.length >= 3 && name.startsWith(word);

/** The value of a long option `--name=VALUE` or `--name VALUE` (or any abbreviation of `--name`)
 * at `args[i]`, with the index of the last token it consumed; null when `args[i]` is not that
 * option. */
const longOptionValue = (args, i, name) => {
  const t = args[i];
  if (!t.startsWith('--')) return null;
  const eq = t.indexOf('=');
  if (!isLongOptionPrefix(eq === -1 ? t : t.slice(0, eq), name)) return null;
  if (eq !== -1) return { value: t.slice(eq + 1), last: i };
  return { value: args[i + 1] ?? UNRESOLVABLE_TARGET, last: i + 1 };
};

/** `sort` short options that take a value (`-k`, `-t`, `-S`, `-T`, `-o`). */
const SORT_VALUE_SHORT = new Set(['k', 't', 'S', 'T', 'o']);

/** `sort -o FILE` / `-oFILE` / a cluster ending in `o` (`-ro FILE`) / `--output[=]FILE` write
 * targets. GNU sort permutes options, so the option counts wherever it sits. A short cluster is
 * walked getopt-style: the first value-taking letter consumes the rest of the cluster or the next
 * token, so `-k1o` is a key spec, never an output. */
const sortTargets = (args) => {
  const targets = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === '--') break;
    const long = longOptionValue(args, i, '--output');
    if (long) {
      targets.push(stripQuotes(long.value));
      i = long.last;
      continue;
    }
    if (!/^-[^-]/.test(t)) continue;
    for (let c = 1; c < t.length; c++) {
      if (!SORT_VALUE_SHORT.has(t[c])) continue;
      const attached = t.slice(c + 1);
      const value = attached || args[++i] || UNRESOLVABLE_TARGET;
      if (t[c] === 'o') targets.push(stripQuotes(value));
      break;
    }
  }
  return targets;
};

/** `uniq` short options whose value is the next token when not attached. */
const UNIQ_VALUE_SHORT = /^-[a-zA-Z]*[fsw]$/;
const UNIQ_VALUE_LONG = ['--skip-fields', '--skip-chars', '--check-chars'];

/** True when `t` takes the next token as its value: a short cluster ending in `-f`/`-s`/`-w`, or a
 * `=`-less abbreviation of a value-taking long option. */
const isUniqValueOption = (t) =>
  UNIQ_VALUE_SHORT.test(t) || (t.startsWith('--') && !t.includes('=') && UNIQ_VALUE_LONG.some((n) => isLongOptionPrefix(t, n)));

/** `uniq [OPTION]... [INPUT [OUTPUT]]` writes its second operand; `-` means stdout. */
const uniqTargets = (args) => {
  const operands = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (isUniqValueOption(t)) i++;
    else if (t === '-' || !t.startsWith('-')) operands.push(t);
  }
  const out = operands[1];
  return out === undefined || out === '-' ? [] : [stripQuotes(out)];
};

/** git global options that take the next token as their value when not written `--name=value`. */
const GIT_VALUE_GLOBALS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--attr-source']);

/** Walks git's global options (everything before the subcommand) and returns the directories a
 * relative output path may resolve against, plus the subcommand index. Each `-C DIR` moves the
 * working directory relative to the previous one; `--git-dir`/`--work-tree` can make git resolve
 * relative paths elsewhere, so their directories become extra candidate bases (every candidate
 * is checked — over-matching only adds a target). Segments are joined once at the end, keeping
 * the walk linear in the number of `-C` options. */
const gitGlobalBases = (args) => {
  let segments = [];
  const extra = [];
  let i = 0;
  for (; i < args.length && args[i].startsWith('-') && args[i] !== '--'; i++) {
    const t = args[i];
    const eq = t.indexOf('=');
    const name = t.startsWith('--') && eq !== -1 ? t.slice(0, eq) : t;
    if (!GIT_VALUE_GLOBALS.has(name)) continue;
    const value = stripQuotes(eq !== -1 && t.startsWith('--') ? t.slice(eq + 1) : (args[++i] ?? UNRESOLVABLE_TARGET));
    if (name === '-C' && value) {
      if (path.isAbsolute(value)) segments = [value];
      else segments.push(value);
    } else if (name === '--git-dir' || name === '--work-tree') {
      extra.push({ name, value });
    }
  }
  const cwdBase = segments.length > 0 ? path.join(...segments) : '';
  const bases = [cwdBase];
  for (const { name, value } of extra) {
    const dir = path.isAbsolute(value) || !cwdBase ? value : path.join(cwdBase, value);
    bases.push(dir);
    // A git dir is usually `<work tree>/.git`, so its parent is a likely work tree too.
    if (name === '--git-dir') bases.push(path.dirname(dir));
  }
  return { bases, subIdx: i };
};

/** `format-patch -o DIR` / `-oDIR` / `--output-directory[=]DIR` (or an abbreviation) value at
 * `args[i]`, with the index of the last token it consumed; null when `args[i]` is not that option. */
const formatPatchDirValue = (args, i) => {
  const t = args[i];
  if (t === '-o') return { value: args[i + 1] ?? UNRESOLVABLE_TARGET, last: i + 1 };
  if (/^-o./.test(t)) return { value: t.slice(2), last: i };
  return longOptionValue(args, i, '--output-directory');
};

/** `git … --output[=]FILE` (the diff family: `diff`, `log -p`, `show`, `format-patch`) and
 * `git format-patch -o DIR` write targets. git resolves a relative path against its working
 * directory, so each relative target is checked under every base `gitGlobalBases` returns (a
 * dynamic base makes the joined target dynamic, i.e. WARN). */
const gitOutputTargets = (args) => {
  const { bases, subIdx } = gitGlobalBases(args);
  const isFormatPatch = args[subIdx] === 'format-patch';
  const values = [];
  for (let i = subIdx + 1; i < args.length; i++) {
    if (args[i] === '--') break;
    const opt = (isFormatPatch && formatPatchDirValue(args, i)) || longOptionValue(args, i, '--output');
    if (opt) {
      values.push(stripQuotes(opt.value));
      i = opt.last;
    }
  }
  const targets = [];
  for (const value of values) {
    if (path.isAbsolute(value) || value === UNRESOLVABLE_TARGET) targets.push(value);
    else for (const base of bases) targets.push(base ? path.join(base, value) : value);
  }
  return targets;
};

/** `yq -i|--inplace` rewrites its file operands. The expression operand cannot be told from a
 * file without parsing yq's own flag set, so every operand is checked: an expression resolves to
 * an in-root relative path (harmless) or, when dynamic, to the warn tier. */
const yqTargets = (args) => {
  const inPlace = args.some((t) => {
    if (t.startsWith('--')) return isLongOptionPrefix(t.split('=')[0], '--inplace');
    // A short cluster carrying `i` (`-i`, `-Pi`); checked without a backtracking regex.
    return t.startsWith('-') && t.includes('i') && /^-[a-zA-Z]+$/.test(t);
  });
  if (!inPlace) return [];
  return args.filter((t) => !t.startsWith('-')).map(stripQuotes);
};

/** Commands that look read-only but write a file through an option or operand (#1184). */
const OPTION_WRITE_COMMANDS = [
  ['sort', sortTargets],
  ['uniq', uniqTargets],
  ['git', gitOutputTargets],
  ['yq', yqTargets],
];

/** Write targets of every option-writing command in one clause. Like the tee/sed/cp finders, the
 * command word is found anywhere in the clause, so a wrapper with its own value (`nice -n 5`,
 * `timeout 5`, `env X=1`) never hides it; a command name that is merely an argument
 * (`grep uniq a b`) is over-matched, which only ever adds a target. */
const findOptionWriteTargets = (tokens) => {
  const targets = [];
  for (const [name, extract] of OPTION_WRITE_COMMANDS) {
    const cmdIdx = tokens.findIndex((t) => isCommandToken(t, name));
    if (cmdIdx !== -1) targets.push(...extract(positionalArgsBeforeRedirect(tokens, cmdIdx + 1)));
  }
  return targets;
};

const SHELL_NAMES = ['sh', 'bash', 'dash', 'zsh', 'ksh'];

/** Shell options whose value is the next token (`-o pipefail`, `+O extglob`, `--rcfile f`). */
const isShellValueOption = (t) => /^[-+][a-zA-Z]*[oO]$/.test(t) || t === '--rcfile' || t === '--init-file';

/** True when a shell invoked with `args` reads its script from stdin: `-s` is given, or no script
 * operand follows the options, and no `-c` supplies the script inline. */
const shellReadsStdinScript = (args) => {
  let stdinFlag = false;
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === '--' || t === '-') return !args.slice(i + 1).length || stdinFlag || t === '-';
    if (isShellValueOption(t)) {
      i++;
      continue;
    }
    if (/^-[a-zA-Z]+$/.test(t)) {
      if (t.includes('c')) return false;
      if (t.includes('s')) stdinFlag = true;
      continue;
    }
    if (t.startsWith('-') || t.startsWith('+')) continue;
    return stdinFlag;
  }
  return true;
};

/** A single `|` (or `|&`) pipe — never the `||` operator — and the clause text it feeds. */
const PIPE_INTO_RE = /(?<!\|)\|&?(?!\|)([^;|&\n]*)/g;

/** True when a pipe feeds a shell that reads its script from stdin (`… | sh`, `… | bash -s`): the
 * piped text runs as commands this module never sees, so the call is unresolvable. A shell given
 * a script file or `-c` reads its commands from there, not from the pipe. */
const hasPipedShellScript = (visible) => {
  PIPE_INTO_RE.lastIndex = 0;
  let match = PIPE_INTO_RE.exec(visible);
  while (match !== null) {
    const tokens = tokenize(match[1]);
    // Found anywhere in the piped clause, like the other finders, so a wrapper (`env bash`,
    // `sudo sh`) cannot hide it.
    const shellIdx = tokens.findIndex((t) => SHELL_NAMES.some((name) => isCommandToken(t, name)));
    if (shellIdx !== -1 && shellReadsStdinScript(positionalArgsBeforeRedirect(tokens, shellIdx + 1))) return true;
    match = PIPE_INTO_RE.exec(visible);
  }
  return false;
};

/** `isLiteralPathArg` (from `worktree-removal-guard.js`) excludes shell metacharacters that make a
 * target dynamic (`$`, `` ` ``, `*`, `?`, `[`, `]`, `{`, `}`) but not bash tilde (`~`) expansion —
 * a target like `~/foo.txt` passes it as "literal," yet `path.resolve(cwd, target)` never performs
 * that expansion (it is a shell-level substitution, not a filesystem one), so the resolved path
 * becomes a nonexistent `<cwd>/~/foo.txt`. `isUnderRoot`'s ancestor-walk then climbs that path back
 * up through ENOENT until it lands on the assigned root itself, which trivially reads as "in
 * bounds" — a silent allow for a command that actually writes against the real `$HOME` at runtime.
 * This module cannot reliably resolve `$HOME` for the shell that will eventually run the command
 * (a worktree-spawned implementer's environment is not guaranteed to match), so a `~`-prefixed
 * target is routed to the `warn`/`bash-write-target-unresolvable` tier instead — the same treatment
 * already given to `python3 -c`/`awk`/etc. Scoped to this module's own new usage only:
 * `worktree-removal-guard.js`'s pre-existing `isLiteralPathArg` call is unaffected (see that
 * module's own containment check, which fails closed on an unresolvable path rather than allowing
 * it — a different, non-silent-allow failure mode, tracked separately rather than fixed here). */
const isResolvableLiteralTarget = (raw) => isLiteralPathArg(raw) && !raw.startsWith('~');

/** Any input redirect (`< f`, `2< f`, `<&`) or `exec` can put a file on the session's stdout or
 * stderr — directly, or via a later dup such as `1>&0` — after which writing `/dev/stdout` or
 * `/dev/stderr` reopens that file for writing. Input redirects are never scanned as write targets,
 * so their presence alone withdraws the stdout/stderr exemption. */
const MAY_REBIND_STREAM_FD_RE = /<|\bexec\b/;

/** A redirect target is captured up to the next whitespace, so `2>/dev/null;` or `>/dev/null&&`
 * arrive with the following operator glued on; the operator starts a clause scanned on its own. */
const stripTrailingOperator = (target) => target.replace(/[;&|].*$/, '');

/** True when `target` is a stream device that writes no file: `/dev/null` discards, `/dev/tty` is
 * the controlling terminal, and `/dev/stdout`/`/dev/stderr` reach the session's own streams unless
 * the command may rebind them (`MAY_REBIND_STREAM_FD_RE`). `/dev/fd/N` is never exempt: opening it
 * reopens whatever file fd N holds, including one opened read-only. */
const isStreamDeviceTarget = (rawTarget, visible) => {
  const target = stripTrailingOperator(rawTarget);
  if (target === '/dev/null' || target === '/dev/tty') return true;
  return (target === '/dev/stdout' || target === '/dev/stderr') && !MAY_REBIND_STREAM_FD_RE.test(visible);
};

/** True when one clause's leading command word is a write-shaped command this module cannot
 * resolve statically (see `UNRESOLVABLE_WRITE_COMMANDS`'s docstring). */
const hasUnresolvableCommand = (tokens) => {
  if (tokens.length === 0) return false;
  const head = tokens[0];
  for (const { name, requiresFlag } of UNRESOLVABLE_WRITE_COMMANDS) {
    if (!isCommandToken(head, name)) continue;
    if (!requiresFlag) return true;
    const matcher =
      requiresFlag instanceof RegExp ? (t) => requiresFlag.test(t) : (t) => t === requiresFlag;
    if (tokens.slice(1).some(matcher)) return true;
  }
  return false;
};

/**
 * Entry point for `validate-bash-command.js`. Returns null when `readAssignedWorktreeRoot(cwd)`
 * resolves no root (the env var is unset/invalid and cwd is not a linked worktree) or when nothing
 * write-shaped is found. Otherwise returns `{ tier: 'block', pattern_id, reason }` for the first
 * resolvable target found outside the assigned root, or `{ tier: 'warn', pattern_id, reason }`
 * when every resolvable target is in-bounds but a dynamic target or an unresolvable command was
 * also present — never both in the same result (a confirmed out-of-bounds write is the more
 * actionable signal).
 */
const evaluateBashWriteTargets = (command, cwd) => {
  const assignedRoot = readAssignedWorktreeRoot(cwd);
  if (!assignedRoot) return null;

  const masked = computeMaskedSpans(command);
  const visible = buildVisibleCommand(command, masked);

  const literalTargets = [];
  let unresolvable = false;

  for (const raw of findRedirectTargets(visible)) {
    if (isResolvableLiteralTarget(raw)) literalTargets.push(raw);
    else unresolvable = true;
  }

  for (const clause of splitClauses(visible)) {
    const tokens = tokenize(clause);
    if (tokens.length === 0) continue;

    for (const raw of [...findTeeTargets(tokens), ...findSedTargets(tokens), ...findCopyMoveTargets(tokens),
      ...findOptionWriteTargets(tokens),
    ]) {
      if (isResolvableLiteralTarget(raw)) literalTargets.push(raw);
      else unresolvable = true;
    }

    if (hasUnresolvableCommand(tokens)) unresolvable = true;
  }

  if (hasPipedShellScript(visible)) unresolvable = true;

  for (const target of literalTargets) {
    if (isStreamDeviceTarget(target, visible)) continue;
    const resolvedPath = path.isAbsolute(target) ? target : path.resolve(cwd, target);
    if (!isUnderRoot(resolvedPath, assignedRoot)) {
      return {
        tier: 'block',
        pattern_id: 'bash-outside-assigned-worktree',
        reason:
          `Bash write target resolves outside the assigned worktree root (${assignedRoot}): ${resolvedPath}. ` +
          `Remedy: write inside ${assignedRoot} instead (e.g. ${path.join(assignedRoot, path.basename(resolvedPath))}) ` +
          `and use a literal absolute path, or the Write/Edit tools.`,
      };
    }
  }

  if (unresolvable) {
    return {
      tier: 'warn',
      pattern_id: 'bash-write-target-unresolvable',
      reason:
        // The event log keeps only the first 300 characters of a reason (MAX_DETAIL_CHARS in
        // hook-event-log.js), so the verdict comes first and the list of causes after it.
        'Bash command looks write-shaped but its target could not be resolved by static ' +
        'inspection — cannot verify assigned-worktree containment (not confirmed unsafe). Cause: ' +
        'a dynamic argument, a script piped into a shell, or a command like python3 -c/perl -i/awk ' +
        'whose writes the command string does not show. Remedy: use a literal absolute path under ' +
        'the assigned worktree, or the Write/Edit tools.',
    };
  }

  return null;
};

module.exports = {
  evaluateBashWriteTargets,
};
