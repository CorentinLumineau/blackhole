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
 *    that resolves outside the assigned root → `block` (`bash-outside-assigned-worktree`). A
 *    target in the campaign state dir (`campaignStateRoot`) is exempt only when written in one of
 *    the shapes `state-dir-write-shape.js` allows; so is a target in an extra root from
 *    `trustedWriteRoots` (the validated scratchpad, declared cross-repo campaign worktrees).
 *    A settings file listing those roots is never a permitted target (`bash-settings-roots-write`).
 *  - a **write-shaped-but-unresolvable** command — a dynamic target (`$VAR`, `$(cmd)`, a glob),
 *    or a command whose write behavior cannot be determined by inspecting the command string at
 *    all (`python3 -c`, `perl -i`, `awk`) → `warn` and record
 *    (`bash-write-target-unresolvable`), never a silent allow (ADR-029's accepted residual risk:
 *    command-string parsing cannot enumerate every write idiom). A variable-built target is never
 *    expanded: it is always this one warn-and-record tier, whatever path it would resolve to.
 *
 * The check runs whenever `readAssignedWorktreeRoot` resolves a root — the declared
 * `BLACKHOLE_ASSIGNED_WORKTREE`, or the cwd-derived tier, so any session whose cwd is a linked
 * worktree is covered, interactive ones included. A null root returns null before any parsing.
 *
 * Read-only sources are never evaluated: `cp` extracts only the destination (last positional
 * argument) as a write target, exactly like `validate-file-changes.js` only ever evaluates a
 * write's own target — a source outside the assigned root (the ordinary shape of reading a shared
 * reference file) must never itself trigger a deny. `mv` is the exception: it unlinks its
 * sources, so every positional argument is a write target (see `findCopyMoveWrites`).
 */

const path = require('path');
const { computeMaskedSpans, computeHeredocBodyMask } = require('./bash-context');
const { skipQuotedSpan, isRedirectAmpersand, decodeAnsiC, shellWordEnd } = require('./shell-lexer');
const {
  readAssignedWorktreeRoot,
  mainCloneRoot,
  isUnderRoot,
  resolveExistingAncestor,
  campaignStateRoot,
  trustedWriteRoots,
  isTrustedExtraPath,
  settingsFileCandidates,
  isSettingsFilePath,
} = require('./hook-event-log');
const { FILE_WRITE, isTrustedShapedWrite, isTrustedStateWrite } = require('./state-dir-write-shape');
const { isLiteralPathArg, extractCdTargetText, normalizeShellWord, MAX_CWD_CANDIDATES } = require('./worktree-removal-guard');

/** Command words whose write behavior cannot be resolved by static inspection of the command
 * string at all — the residual gap ADR-029 accepts and downgrades to WARN rather than a silent
 * allow. A bare `awk` invocation is unresolvable outright; interpreters are matched by
 * `INTERPRETERS` below, which looks at their inline script. */
const UNRESOLVABLE_WRITE_COMMANDS = ['awk'];

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

/** Removes every backslash-newline pair the shell removes before it splits words: outside single
 * quotes, and not where the backslash is itself escaped (`\\<newline>` keeps the newline). A
 * continued line is one line to bash, so `cat x >\<newline>/etc/x` writes `/etc/x`; without the
 * join the newline would end the clause and the target would be lost. One linear pass. */
const joinLineContinuations = (text) => {
  if (!text.includes('\\\n')) return text;
  let out = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      out += ch;
    } else if (ch === '\\') {
      if (text[i + 1] !== '\n') out += ch + (text[i + 1] ?? '');
      i++;
    } else {
      if (ch === "'" && !inDouble) inSingle = true;
      else if (ch === '"') inDouble = !inDouble;
      out += ch;
    }
  }
  return out;
};

/** The command as the scanners below read it. Masked spans are found on the original text and
 * continuations joined afterwards, so a heredoc body or comment ending in `\` stays inert. When the
 * command has a continuation, a second view joins first and masks afterwards: that is the only
 * order that finds where a heredoc body starts when its operator line is continued
 * (`cat <<EOF >\<newline>/etc/x`). Each view is checked, so neither order can hide a target. */
const visibleViews = (command) => {
  const views = [joinLineContinuations(buildVisibleCommand(command, maskedSpans(command)))];
  const joined = joinLineContinuations(command);
  if (joined !== command) views.push(buildVisibleCommand(joined, maskedSpans(joined)));
  return views;
};

/** `computeMaskedSpans`, except that a substitution placeholder always stays visible: its body
 * runs even inside a print-only argument (`echo "$(…)"`), so the clause it sits in must see it. */
const maskedSpans = (command) => {
  const masked = computeMaskedSpans(command);
  for (const m of command.matchAll(PLACEHOLDER_RE)) masked.fill(false, m.index, m.index + m[0].length);
  return masked;
};

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

/** `stripQuotes` for a write-target word. A word holding a backslash keeps its quotes, so
 * `unescapeTarget` reads it once, by the rule of the quote the backslash sits in (inside `"…"`
 * bash keeps a backslash before an ordinary character). */
const stripTargetQuotes = (token) => (token.includes('\\') ? token : stripQuotes(token));

/** True when a quote opens in `token` and never closes: a word cut out of text that was itself
 * quoted (`'echo a > /x'` read from inside), whose quote removal would be a guess. */
const hasUnterminatedQuote = (token) => {
  let open = null;
  for (const ch of token) {
    if (open) {
      if (ch === open) open = null;
    } else if (ch === "'" || ch === '"') open = ch;
  }
  return open !== null;
};

/** `stripTargetQuotes` for a write-target operand, except that a word spelled with adjacent quote
 * segments (`'/dir/'file`), which `stripQuotes` cannot unwrap, is decoded the way the shell joins
 * it and handed on as the literal path, so it reaches the containment check. `quoteSplit` keeps
 * such a name at the warn tier inside the root: no spelling of it is allowed that was not allowed
 * before. A word that cannot be read statically stays as written. */
const targetWord = (token) => {
  const word = stripTargetQuotes(token);
  if (token.includes('\\') || !/['"]/.test(word) || hasUnterminatedQuote(token)) return word;
  const { text, dynamic } = normalizeShellWord(token);
  return dynamic ? word : { literal: text, quoteSplit: true };
};

/** A write target whose text is already the literal path: `unescapeTarget` must not read it again,
 * or a quote or backslash that is part of the name would be taken for shell syntax. */
const literalTarget = (literal) => ({ literal });

/** The literal text of a word as the shell passes it on, or the word as written when it cannot be
 * read statically (so it stays unresolvable). Adjacent quoted and unquoted segments
 * (`"/etc/"'a"b'`) are joined as the shell joins them, so no quote character is left to hide the
 * directory the word starts with. */
const literalWord = (token) => {
  if (!/[\\'"]/.test(token)) return token;
  const { text, dynamic } = normalizeShellWord(token);
  return dynamic ? token : text;
};

/** Quote-aware whitespace tokenizer over an already-visible (masked spans blanked) substring —
 * a quoted span (e.g. a sed script `'s/a/b/'`) is kept as one token, quotes intact, so
 * `stripQuotes` can later decide whether to unwrap it. A backslash-escaped character (`x\ y`)
 * never splits a word. */
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
    if (ch === '\\' && i + 1 < n) {
      // An escaped character, space included, stays in the word: `x\ y` is one word.
      current += text.slice(i, i + 2);
      i += 2;
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
const clauseRanges = (visible) => {
  const ranges = [];
  let start = 0;
  let i = 0;
  const n = visible.length;
  while (i < n) {
    const ch = visible[i];
    if (ch === "'" || ch === '"') {
      i = skipQuotedSpan(visible, i, n);
      continue;
    }
    const isSeparator =
      ch === ';' || (ch === '|' && visible[i - 1] !== '>') || ch === '\n' || (ch === '&' && !isRedirectAmpersand(visible, i));
    if (isSeparator) {
      ranges.push([start, i]);
      start = i + 1;
    }
    i++;
  }
  ranges.push([start, n]);
  return ranges;
};

const splitClauses = (visible) => clauseRanges(visible).map(([start, end]) => visible.slice(start, end));

/** Words after which the next word is again a command: wrappers that run the rest of the clause
 * (`sudo`, `env`, `timeout 5`, …) and the keywords a command may follow (`then`, `do`, `!`, …). */
const COMMAND_PREFIXES = new Set([
  'sudo', 'doas', 'env', 'nice', 'nohup', 'timeout', 'command', 'exec', 'time', 'stdbuf', 'ionice',
  'builtin', 'xargs', 'chronic', 'unbuffer', 'if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{',
]);

/** Wrapper options whose value is the next word (`sudo -u bob`, `nice -n 5`, `env -C dir`). */
const PREFIX_VALUE_OPTIONS = new Set(['-u', '-g', '-n', '-C', '-k', '-p', '-I', '-L', '-P', '-o', '-e']);

/** Indices of the words in a clause that run as commands: the first word after any `NAME=value`
 * assignments, and the word after each wrapper or keyword together with its options. */
const commandPositions = (tokens) => {
  const positions = new Set();
  let i = 0;
  while (i < tokens.length) {
    while (i < tokens.length && /^[A-Za-z_]\w*=/.test(tokens[i])) i++;
    if (i >= tokens.length) break;
    positions.add(i);
    const prefix = commandName(tokens[i]);
    if (!COMMAND_PREFIXES.has(prefix)) break;
    i++;
    while (i < tokens.length && (tokens[i].startsWith('-') || /^\d+(?:\.\d+)?[smhd]?$/.test(tokens[i]))) {
      i += PREFIX_VALUE_OPTIONS.has(tokens[i]) ? 2 : 1;
    }
    // `env` reads NAME=VALUE operands after quote removal, so `env "A=1" 'tee'` runs `tee`.
    if (prefix === 'env') while (i < tokens.length && tokens[i].includes('=')) i++;
  }
  return positions;
};

/** Index of the first word in `tokens` that runs a command `isName` accepts, or -1. A bare word
 * counts anywhere in the clause, so a wrapper this module does not know (`find -exec cp …`) never
 * hides it. A quoted or escaped spelling (`'sed'`, `\cp`, `$'tee'`) counts only where a command
 * runs, so a quoted grep pattern (`grep -rn "tee" .`) is not mistaken for one. */
const findCommandIndex = (tokens, isName) => {
  const positions = commandPositions(tokens);
  return tokens.findIndex((t, i) => isName(t.slice(t.lastIndexOf('/') + 1)) || (positions.has(i) && isName(commandName(t))));
};

/** `findCommandIndex` for one command name. */
const findCommand = (tokens, name) => findCommandIndex(tokens, (n) => n === name);

/** True when a fd-duplication argument (`&1`, `&2`, ...) rather than a real file path — the one
 * shape `>`/`>>`/`&>` legitimately precede without naming a file (`2>&1`, `>&2`). */
const isFdDuplicationTarget = (token) => /^&\d+$/.test(token);

/** Whole-command signals that quoted text may be executed as shell (or smuggles a quote the
 * span walker would misread). Any hit disables `maskRedirectNoise` entirely: masking is only safe
 * when no quoted span can be command text. A shell name's path prefix stops at the next anchor
 * character: `\S*` would rescan the whole run from every `;` in it (quadratic on a long sed or
 * grep script), and the narrower class matches the same commands, since any anchor character a
 * prefix crosses is itself a start the match can begin from. */
const SHELL_EXEC_RE = new RegExp(
  [
    '(?:^|[\\s;&|(`])(?:[^\\s;&|(`]*/)?(?:bash|sh|zsh|dash|ksh|eval|source|trap|alias|watch|at|parallel|xargs)(?=$|[\\s;&|)])',
    '(?:^|\\s)-c(?=$|\\s)',
    'BASH_ENV=|PROMPT_COMMAND=',
    '<<<',
    '\\b(?:perl|ruby|node|bun|php|lua|python[0-9.]*)\\b[^;|&\\n]*\\s-[a-zA-Z]*[ecr]\\b',
  ].join('|'),
);

/** Constructs inside which bash nests or reinterprets quotes, so this module's flat quote pairing
 * cannot be trusted anywhere in the command: command/process substitution, parameter expansion,
 * escapes, `$'..'`/`$".."` strings and here-strings. */
const QUOTE_REINTERPRETING_RE = /\$\(|`|\$\{|\\|\$['"]|<<<|<\(|>\(/;

/** The only commands whose quoted spans `maskRedirectNoise` may blank (the reported false positives
 * are grep and sed). An allowlist, because the commands that execute or write from a quoted
 * argument cannot be enumerated; every other clause keeps its quoted spans visible. */
const INERT_GREP_COMMANDS = new Set(['grep', 'egrep', 'fgrep', 'rg']);

/** rg options that run a decompressor/preprocessor, plus any unique prefix of them. */
const RG_COMMAND_OPTIONS = ['--pre', '--pre-glob', '--hostname-bin', '--search-zip'];

/** `-f`/`--file` (a pattern file) and, for rg, a decompressor/preprocessor option disqualify a
 * clause; neither runs a command in grep, but the rule is kept simple and read-only. */
const hasDisqualifyingOption = (head, args) =>
  args.some((t) => {
    if (/^-[a-zA-Z]*f/.test(t) || t === '--file' || t.startsWith('--file=')) return true;
    if (head !== 'rg') return false;
    if (/^-[a-zA-Z]*z/.test(t)) return true;
    const name = t.startsWith('--') ? t.split('=')[0] : '';
    return name.length > 2 && RG_COMMAND_OPTIONS.some((opt) => opt.startsWith(name));
  });

/** A sed script made only of `s<d>re<d>repl<d>flags` commands whose flags cannot be `e` or `w`. */
const SED_SUBST_SCRIPT_RE = /^(?:s([^\w\s\\;])(?:(?!\1)[^\n])*\1(?:(?!\1)[^\n])*\1[gIiMmp0-9]*(?:;|$))+$/;
const SED_PLAIN_OPTION_RE = /^(?:-[nEr]+|-i|-i\.\w+|--in-place(?:=\S+)?|--quiet|--regexp-extended)$/;

/** sed is inert for masking only with exactly one quoted script that is pure `s///` (no `e`/`w`
 * command or flag) and no `-f`/`-s`/`-e` option. `-i` is allowed: its write target is resolved by
 * `findSedTargets`, not by the redirect scan. */
const isInertSed = (args) => {
  const scripts = args.filter((t) => t[0] === "'" || t[0] === '"');
  if (scripts.length !== 1) return false;
  if (!SED_SUBST_SCRIPT_RE.test(stripQuotes(scripts[0]))) return false;
  return args.every((t) => t === scripts[0] || SED_PLAIN_OPTION_RE.test(t) || !t.startsWith('-'));
};

/** An unquoted `(`, `)`, `{` or `}` in a token makes the clause a function definition or a group,
 * not a filter invocation: `grep () ( ... )` redefines the word instead of running it. */
const hasUnquotedGrouping = (token) => /[(){}]/.test(token.replace(/'[^']*'|"[^"]*"/g, ''));

/** True when a clause's command word is a bare, unquoted, unprefixed grep-family command or a pure
 * `s///` sed. A leading `VAR=val`, a path (`./grep`, `/tmp/grep`) or any quoting disqualifies it:
 * the word may then name something else than the filter. */
const isInertClause = (tokens) => {
  if (tokens.length === 0 || tokens.some(hasUnquotedGrouping) || !/^[A-Za-z]+$/.test(tokens[0])) return false;
  const head = tokens[0];
  const args = tokens.slice(1);
  if (INERT_GREP_COMMANDS.has(head)) return !hasDisqualifyingOption(head, args);
  return head === 'sed' && isInertSed(args);
};

/** Read-only filters that may sit beside an inert grep/sed clause without turning masking off. */
const PASSIVE_FILTER_COMMANDS = new Set(['wc', 'head', 'tail', 'sort', 'cat', 'uniq', 'cut']);
const SORT_PLAIN_OPTION_RE = /^-[nrufbdiMhVgs]+$/;

/** True for a bare allowlisted filter clause that cannot write: no redirect operator in any token,
 * `sort` without an output/compress option, `uniq` with at most one positional argument (the
 * second names an output file). */
const isPassiveFilterClause = (tokens) => {
  if (tokens.length === 0 || tokens.some(hasUnquotedGrouping) || !PASSIVE_FILTER_COMMANDS.has(tokens[0])) return false;
  const args = tokens.slice(1);
  if (args.some((t) => /[<>]/.test(t))) return false;
  if (tokens[0] === 'sort') return args.every((t) => !t.startsWith('-') || SORT_PLAIN_OPTION_RE.test(t));
  if (tokens[0] === 'uniq') return args.filter((t) => !t.startsWith('-')).length <= 1;
  return true;
};

/** Masking is safe only when every clause of the command is a passive filter: any other statement
 * (assignment, `unset`, `printf -v`, `read`, `cd`, ...) may rebind what a bare `grep`/`sed` word
 * runs, so it disables masking for the whole command. Empty clauses (`&&`, `||`) are neutral. */
const isEveryClausePassive = (visible) =>
  clauseRanges(visible).every(([start, end]) => {
    const text = visible.slice(start, end);
    if (text.trim() === '') return true;
    const tokens = tokenize(text);
    return isInertClause(tokens) || isPassiveFilterClause(tokens);
  });

const REDIRECT_OPERATOR_TAIL_RE = /(?:&>>|&>|>>|>&|>\||>)\s*$/;

/** A quoted span `text[start..end)` is inert text (cannot hide a write target) unless it is a
 * redirect's own target (`> "/x"`), unterminated, contains another quote character, or is a
 * double-quoted span carrying a command substitution (`"$(echo x > /etc/y)"`). */
const isInertQuotedSpan = (text, start, end) => {
  const span = text.slice(start, end);
  if (span.length < 2 || span[span.length - 1] !== span[0]) return false;
  if (/['"]/.test(span.slice(1, -1))) return false;
  if (REDIRECT_OPERATOR_TAIL_RE.test(text.slice(0, start))) return false;
  return !(span[0] === '"' && (span.includes('$(') || span.includes('`')));
};

/** True when masking may run on `visible`: nothing in it executes quoted text or nests quotes, and
 * every clause is a passive filter (`isEveryClausePassive`). A substitution body runs in the outer
 * shell, so the verdict is the AND of this over the command and every body (`evaluateBashWriteTargets`),
 * never a body's alone: a rebinding statement outside the body still changes what its `grep` runs. */
const maskingAllowed = (visible) =>
  !SHELL_EXEC_RE.test(visible) && !QUOTE_REINTERPRETING_RE.test(visible) && isEveryClausePassive(visible);

/** Copy of `visible` with the contents of inert quoted spans blanked (`grep 'a>b'`), for the
 * whole-command `REDIRECT_RE` scan only; positions are preserved. Fails closed: spans are blanked
 * only inside a clause whose command is an inert filter, and only when `allowed` (`maskingAllowed`,
 * decided once for the whole command and its substitution bodies); otherwise `visible` is returned
 * unchanged (base behaviour), so masking can never turn a deny into an allow. Unquoted text is never masked: an unquoted
 * `sed s/<A>/x/` really is a redirect in bash. */
const maskRedirectNoise = (visible, allowed) => {
  if (!allowed) return visible;
  const chars = visible.split('');
  for (const [start, end] of clauseRanges(visible)) {
    const text = visible.slice(start, end);
    if (!isInertClause(tokenize(text))) continue;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch !== "'" && ch !== '"') {
        i++;
        continue;
      }
      const spanEnd = skipQuotedSpan(text, i, text.length);
      if (isInertQuotedSpan(text, i, spanEnd)) {
        for (let k = start + i + 1; k < start + spanEnd - 1; k++) chars[k] = ' ';
      }
      i = spanEnd;
    }
  }
  return chars.join('');
};

const REDIRECT_RE = /(&>>|&>|>>|>&|>\||>)\s*/g;

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
    // The target is one shell word: it ends at an unquoted `;`, `&` or `|`, never inside quotes.
    const end = shellWordEnd(visible, REDIRECT_RE.lastIndex);
    const raw = visible.slice(REDIRECT_RE.lastIndex, end) || undefined;
    REDIRECT_RE.lastIndex = end;
    const isFdDup = match[1] === '>&' ? raw && isFdDupOperand(raw) : raw && isFdDuplicationTarget(raw);
    if (raw && !isFdDup) {
      targets.push(targetWord(raw));
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
    args.push(asStaticWord(token));
  }
  return args;
};

/** `positionalArgsBeforeRedirect`, except that a redirect word (`2>/dev/null`, `2>&1`, `&>f`) or an
 * operator-only one (`2>`, `<<<`) and the word it takes are dropped and scanning goes on, so an
 * operand after a mid-command redirect is still seen. The redirect target itself is judged by
 * `findRedirectTargets`. */
const positionalArgsSkippingRedirects = (tokens, startIdx) => {
  const args = [];
  let skipNext = false;
  for (let i = startIdx; i < tokens.length; i++) {
    const token = tokens[i];
    if (skipNext || REDIRECT_WORD_RE.test(token)) {
      skipNext = !skipNext && REDIRECT_ONLY_WORD_RE.test(token);
      continue;
    }
    args.push(asStaticWord(token));
  }
  return args;
};

/** A word spelled with quotes or escapes (`'-i'`, `"format-patch"`, `\-o`, `'of=/x'`) is the
 * word the command receives, so it is read in its unquoted form. A word whose quotes protect
 * something the shell would otherwise act on (`--format="{x,y}"`, `--expression='$w f'`) is kept
 * exactly as written, so later checks still see those characters as quoted. */
const asStaticWord = (token) => {
  if (!/['"\\]/.test(token)) return token;
  const { text, dynamic } = normalizeShellWord(token);
  return !dynamic && /^[\w.,:+=@%/-]+$/.test(text) ? text : token;
};

/** `tee [-a|--append] <target...>` write targets in one clause — every non-flag positional
 * argument after the command word, up to the first redirect/pipe. */
const findTeeTargets = (tokens) => {
  const cmdIdx = findCommand(tokens, 'tee');
  if (cmdIdx === -1) return [];
  return positionalArgsSkippingRedirects(tokens, cmdIdx + 1)
    .filter((t) => !t.startsWith('-'))
    .map(targetWord);
};

/** sed short options that take a value: the script (`-e`), a script file (`-f`), a line length. */
const SED_VALUE_SHORT = new Set(['e', 'f', 'l']);
const SED_VALUE_LONG = ['--expression', '--file', '--line-length'];

/** True when a sed script word reaches sed exactly as written: one single-quoted span with no
 * other quote, one double-quoted span with nothing the shell expands or unescapes, or a bare word
 * with no quote, escape, expansion or glued redirect. Any other word (`$'..'`, `'a'w' b'`,
 * `'s/x/w '/etc/x`, `w\ /etc/x`, `'..'<f`) is rebuilt by the shell in ways this module does not
 * model, so its writes cannot be read from it. */
const isCleanSedWord = (word) => {
  const inner = word.slice(1, -1);
  if (word.length >= 2 && word[0] === "'" && word.endsWith("'")) return !inner.includes("'");
  if (word.length >= 2 && word[0] === '"' && word.endsWith('"')) return !/["\\$`]/.test(inner);
  return !/['"\\$`<>]/.test(word);
};

/** Splits sed's arguments getopt-style into its script (every `-e`/`--expression` joined by
 * newlines, as sed joins them, else the first operand), its file operands and whether it edits in
 * place (`-i[SUFFIX]` alone or ending a short cluster such as `-ni`, or `--in-place[=SUFFIX]`).
 * A `-f`/`--file` script source also means no operand is the script. `unclean` is set when a
 * script word is not `isCleanSedWord`. */
const parseSedArgs = (args) => {
  const scripts = [];
  const operands = [];
  let inPlace = false;
  let hasScriptSource = false;
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const word = eq === -1 ? t : t.slice(0, eq);
      if (isLongOptionPrefix(word, '--in-place')) inPlace = true;
      const name = SED_VALUE_LONG.find((n) => isLongOptionPrefix(word, n));
      if (!name) continue;
      const value = eq === -1 ? (args[++i] ?? '') : t.slice(eq + 1);
      if (name === '--expression') scripts.push(value);
      if (name !== '--line-length') hasScriptSource = true;
      continue;
    }
    if (t.length < 2 || t[0] !== '-') {
      operands.push(t);
      continue;
    }
    for (let c = 1; c < t.length; c++) {
      if (t[c] === 'i') {
        inPlace = true;
        break;
      }
      if (!SED_VALUE_SHORT.has(t[c])) continue;
      const value = t.slice(c + 1) || (args[++i] ?? '');
      if (t[c] === 'e') scripts.push(value);
      if (t[c] !== 'l') hasScriptSource = true;
      break;
    }
  }
  if (!hasScriptSource && operands.length > 0) scripts.push(operands.shift());
  const unclean = scripts.some((w) => !isCleanSedWord(w));
  return { script: scripts.map(literalWord).join('\n'), files: operands.map(targetWord), inPlace, unclean };
};

/** sed commands that take no argument (`l`, `q`, `Q`, `L` take an optional number). */
const SED_PLAIN_COMMANDS = new Set('=dDgGhHnNpPxzFlqQL{}');

/**
 * Files a sed script writes (`w FILE`, `W FILE`, the `s///w FILE` flag) and whether it runs a
 * shell command (the `e` command or `s///e` flag). A single forward pass over GNU sed's grammar:
 * addresses, then one command, whose argument is skipped by its own rule — a regex or replacement
 * to its unescaped delimiter, a file name or `a`/`i`/`c` text to the end of the line, a label to
 * `;` or the end of the line. An unknown command ends the scan, since sed refuses the script.
 */
const parseSedScript = (script) => {
  const files = [];
  let exec = false;
  const n = script.length;
  let i = 0;
  /** Moves `i` past the next unescaped `delim`. */
  const skipDelimited = (delim) => {
    while (i < n && script[i] !== delim) i += script[i] === '\\' ? 2 : 1;
    i++;
  };
  /** Returns the text up to the end of the line, and moves `i` there. */
  const restOfLine = () => {
    const end = script.indexOf('\n', i);
    const stop = end === -1 ? n : end;
    const text = script.slice(i, stop);
    i = stop;
    return text;
  };
  const skipAddress = () => {
    const c = script[i];
    if (c === '/' || c === '\\') {
      const delim = c === '/' ? '/' : script[i + 1];
      i += c === '/' ? 1 : 2;
      skipDelimited(delim);
      while (script[i] === 'I' || script[i] === 'M') i++;
    } else {
      while (i < n && /[0-9$+~]/.test(script[i])) i++;
    }
  };
  while (i < n) {
    const ch = script[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === ';') {
      i++;
      continue;
    }
    if (ch === '#') {
      restOfLine();
      continue;
    }
    skipAddress();
    while (script[i] === ' ' || script[i] === '\t') i++;
    if (script[i] === ',') {
      i++;
      while (script[i] === ' ' || script[i] === '\t') i++;
      skipAddress();
    }
    while (script[i] === ' ' || script[i] === '\t' || script[i] === '!') i++;
    const command = script[i++];
    if (command === undefined) break;
    if (SED_PLAIN_COMMANDS.has(command)) {
      while (i < n && /[0-9 \t]/.test(script[i])) i++;
    } else if (command === 's' || command === 'y') {
      const delim = script[i++];
      skipDelimited(delim);
      skipDelimited(delim);
      while (command === 's' && i < n && /[gpiImMe0-9w]/.test(script[i])) {
        const flag = script[i++];
        if (flag === 'e') exec = true;
        if (flag === 'w') {
          files.push(restOfLine().trim());
          break;
        }
      }
    } else if (command === 'w' || command === 'W') {
      files.push(restOfLine().trim());
    } else if (command === 'e') {
      exec = true;
      restOfLine();
    } else if (command === 'r' || command === 'R') {
      restOfLine();
    } else if (command === 'a' || command === 'i' || command === 'c') {
      // Text runs to the first newline that is not escaped by a backslash.
      while (i < n && script[i] !== '\n') i += script[i] === '\\' ? 2 : 1;
    } else if (command === 'b' || command === 't' || command === 'T' || command === ':' || command === 'v') {
      while (i < n && script[i] !== ';' && script[i] !== '\n') i++;
    } else {
      break;
    }
  }
  return { files: files.filter(Boolean), exec };
};

/** Write targets of `sed` in one clause: the file operands when it edits in place, every file its
 * script writes, and an unresolvable target when the script runs a shell command or a script word
 * is not clean (its real text is not the text this module reads). */
const findSedTargets = (tokens) => {
  const cmdIdx = findCommand(tokens, 'sed');
  if (cmdIdx === -1) return [];
  const { script, files, inPlace, unclean } = parseSedArgs(positionalArgsSkippingRedirects(tokens, cmdIdx + 1));
  const written = parseSedScript(script);
  return [
    ...(inPlace ? files : []),
    ...written.files.map(literalTarget),
    ...(written.exec || unclean ? [UNRESOLVABLE_TARGET] : []),
  ];
};

/** Per command, the short option letters that take no value and those that take one (`-m MODE`,
 * `-t DIR`, `-S SUFFIX`), and the long options that take their value as the next word. A long
 * option written `--name=VALUE` needs no entry. */
const COPY_OPTIONS = {
  cp: { flags: 'abcdfHiLlnPpRrsTuvxZ', values: 'tS', long: ['--suffix', '--no-preserve', '--sparse'] },
  mv: { flags: 'bfinTuvZ', values: 'tS', long: ['--suffix'] },
  install: { flags: 'bCcdDpsTvZ', values: 'mogtS', long: ['--suffix', '--mode', '--owner', '--group', '--strip-program'] },
  ln: { flags: 'bdfFiLnPrsTv', values: 'tS', long: ['--suffix'] },
};
const COPY_LONG_FLAGS = new Set([
  '--force', '--interactive', '--no-clobber', '--preserve', '--verbose', '--recursive', '--archive', '--link',
  '--symbolic-link', '--symbolic', '--update', '--backup', '--parents', '--dereference', '--no-dereference',
  '--no-target-directory', '--directory', '--compare', '--preserve-timestamps', '--help', '--version',
  '--remove-destination', '--reflink', '--one-file-system', '--strip-trailing-slashes', '--attributes-only',
  '--copy-contents', '--keep-directory-symlink', '--debug', '--context', '--relative', '--logical', '--physical',
  '--no-copy', '--exchange', '--preserve-context', '--strip',
]);

/** The operands of a `cp`/`mv`/`install`/`ln` call: the destination directory named by `-t DIR`,
 * `-tDIR`, a short cluster ending in `t` (`-pt DIR`), `--target-directory[=]DIR` or an abbreviation
 * of it (null when none), and the positional words. GNU getopt permutes options, so an option
 * after the destination still counts: a value option consumes its value, a flag consumes nothing.
 * `ambiguous` is true when an option is not one this table knows: its value, if it takes one,
 * cannot be told from a positional. */
const copyOperands = (name, args) => {
  const known = COPY_OPTIONS[name];
  let dir = null;
  let ambiguous = false;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    const target = longOptionValue(args, i, '--target-directory');
    if (target) {
      dir = target.value;
      i = target.last;
    } else if (t.startsWith('--')) {
      if (t.includes('=') || COPY_LONG_FLAGS.has(t)) continue;
      if (known.long.includes(t)) i++;
      else ambiguous = true;
    } else if (t.length > 1 && t.startsWith('-')) {
      for (let c = 1; c < t.length; c++) {
        if (known.values.includes(t[c])) {
          const value = t.slice(c + 1) || (args[++i] ?? UNRESOLVABLE_TARGET);
          if (t[c] === 't') dir = value;
          break;
        }
        if (!known.flags.includes(t[c])) ambiguous = true;
      }
    } else positional.push(t);
  }
  return { dir, positional, ambiguous };
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
    else if (t === '--') files.push(...args.slice(i + 1).map(targetWord));
    else if (!t.startsWith('-')) files.push(targetWord(t));
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
  const words = [...head.filter((t) => !t.startsWith('-')), ...tail];
  const positional = words.map(stripTargetQuotes);
  if (positional.length < 2) return [];
  if (optionAfterPositional) {
    return [...words.slice(1).filter((_, i) => !isRemoteRsyncPath(positional[i + 1])).map(targetWord), UNRESOLVABLE_TARGET];
  }
  return isRemoteRsyncPath(positional[positional.length - 1]) ? [] : [targetWord(words[words.length - 1])];
};

/** `cp`/`mv`/`install`/`ln <source...> <dest>` write targets in one clause. Without a
 * target-directory option the last positional argument is the destination; with one, that
 * directory is the destination and every positional is a source. `mv` also unlinks its sources,
 * so all of its positional arguments count. Fewer than two positional arguments and no
 * target-directory means there is no destination to evaluate (`cp --help`, a malformed call). */
const findCopyMoveWrites = (tokens) => {
  for (const name of ['cp', 'mv', 'install', 'ln', 'truncate', 'dd', 'rsync']) {
    const cmdIdx = findCommand(tokens, name);
    if (cmdIdx === -1) continue;
    const args = positionalArgsSkippingRedirects(tokens, cmdIdx + 1);
    const plain = (targets) => targets.map((target) => ({ target }));
    if (name === 'dd') {
      return plain(
        args.flatMap((t) => {
          if (t.startsWith('of=')) return [literalTarget(literalWord(t.slice(3)))];
          const word = literalWord(t);
          return word.startsWith('of=') ? [literalTarget(word.slice(3))] : [];
        }),
      );
    }
    if (name === 'truncate') return plain(truncateTargets(args));
    if (name === 'rsync') return plain(rsyncTargets(args));
    // `install -d`/`--directory` creates every positional as a directory: all are write targets.
    if (name === 'install' && args.some((t) => t === '--directory' || /^-[a-zA-Z]*d[a-zA-Z]*$/.test(t))) {
      return plain(args.filter((t) => !t.startsWith('-')).map(targetWord));
    }
    const { dir, positional: rest, ambiguous } = copyOperands(name, args);
    if (dir === null && rest.length < 2) continue;
    // An option this module does not know may take a value that looks like a positional, so the
    // destination is uncertain: every positional except the first source is checked and the
    // clause also warns (the `rsyncTargets` rule). `mv` and `-t DIR` calls check them all.
    if (ambiguous) {
      const sources = name === 'mv' || dir !== null ? rest : rest.slice(1);
      return [...(dir !== null ? [dir] : []), ...sources, UNRESOLVABLE_TARGET].map((t) => ({ target: targetWord(t) }));
    }
    // `shape` lets a cp/mv/install target qualify for state-dir trust (`isTrustedStateWrite`).
    const shape = name === 'ln' ? undefined : { name, args };
    const written = [{ target: targetWord(dir !== null ? dir : rest[rest.length - 1]), shape }];
    if (name === 'mv') written.push(...(dir !== null ? rest : rest.slice(0, -1)).map((t) => ({ target: targetWord(t), shape })));
    return written;
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
      targets.push(targetWord(long.value));
      i = long.last;
      continue;
    }
    if (!/^-[^-]/.test(t)) continue;
    for (let c = 1; c < t.length; c++) {
      if (!SORT_VALUE_SHORT.has(t[c])) continue;
      const attached = t.slice(c + 1);
      const value = attached || args[++i] || UNRESOLVABLE_TARGET;
      if (t[c] === 'o') targets.push(targetWord(value));
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
  return out === undefined || out === '-' ? [] : [targetWord(out)];
};

/** git global options that take the next token as their value when not written `--name=value`. */
const GIT_VALUE_GLOBALS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--attr-source']);

/** Config keys through which `git -c KEY=VALUE` (or `--config-env=KEY=ENVVAR`) makes git run a
 * command or a different subcommand, or read more config that may: an alias (`alias.d=!cmd`, or
 * `alias.fp=format-patch -o DIR`), a pager, editor, ssh, proxy, fsmonitor or askpass command, a
 * hooks path, an included config file, an external diff, textconv, merge driver or tool command, a
 * filter driver, a remote's upload/receive program, a gpg program or key command, a credential
 * helper, a sendemail command or SMTP server program, a pack-objects hook, a man or web browser
 * viewer, an instaweb server, or a protocol allow rule (`ext::` runs a command). Case-insensitive,
 * like git's own keys. */
const GIT_EXEC_CONFIG_RE = new RegExp(
  [
    '^(?:alias|pager|filter|credential)\\.',
    '^core\\.(?:pager|editor|sshcommand|fsmonitor|hookspath|askpass|alternaterefscommand|gitproxy)$',
    '^sequence\\.editor$',
    '^(?:include\\.path|includeif\\..+\\.path)$',
    '^diff\\.(?:.+\\.)?(?:external|textconv|command)$',
    '^(?:merge\\..+\\.driver|(?:diff|merge)tool\\..+\\.cmd)$',
    '^remote\\..+\\.(?:uploadpack|receivepack)$',
    '^gpg\\.(?:.+\\.)?program$|^gpg\\.ssh\\.defaultkeycommand$',
    '^sendemail\\.(?:.+\\.)?(?:[a-z]*cmd|smtpserver)$',
    '^protocol\\.(?:.+\\.)?allow$',
    '^uploadpack\\.packobjectshook$',
    '^(?:man|browser)\\..+\\.(?:cmd|path)$|^man\\.viewer$|^web\\.browser$',
    '^instaweb\\.httpd$',
  ].join('|'),
  'i',
);

/** A backslash, `$` or backtick in a `-c` word: the shell unescapes or expands it (`core.pa\\ger`,
 * `$'core.pager'`, `"$K"`, `\\!x`) before git reads it, so the text in the string is not the text
 * git applies. */
const SHELL_REWRITTEN_RE = /[\\$`]/;

/** True when `text` holds an unquoted, unescaped brace expansion (`{a,b}`): the shell turns it
 * into several words (`git {-c,alias.x=!cmd} x` becomes `git -c alias.x=!cmd x`), so no word read
 * from the string is one git sees. Escapes and quoted spans are dropped first; each `[^{}]*` run
 * stops at the next brace, so the scan stays linear. */
const hasBraceExpansion = (text) =>
  /\{[^{}]*,[^{}]*\}/.test(text.replace(/\\[\s\S]/g, '').replace(/'[^']*'|"(?:[^"\\]|\\[\s\S])*"/g, ''));

/** `KEY` and `VALUE` of a `-c`/`--config-env` setting, with the shell's quote characters removed
 * (`"alias.d"='!x'` sets `alias.d`), and whether the shell rewrites either half
 * (`SHELL_REWRITTEN_RE`), which makes that half unknown. */
const splitGitSetting = (setting) => {
  const eq = setting.indexOf('=');
  const rawKey = eq === -1 ? setting : setting.slice(0, eq);
  const rawValue = eq === -1 ? '' : setting.slice(eq + 1);
  const unquote = (text) => text.replace(/['"]/g, '');
  return {
    key: unquote(rawKey),
    value: unquote(rawValue),
    dynamicKey: SHELL_REWRITTEN_RE.test(rawKey),
    dynamicValue: SHELL_REWRITTEN_RE.test(rawValue),
  };
};

/** True when a setting may make git run a command: a key the shell rewrites (it may name any key),
 * one of `GIT_EXEC_CONFIG_RE`'s keys, or a submodule update mode that is (or may be) a `!command`. */
const isGitExecConfig = ({ key, value, dynamicKey, dynamicValue }) =>
  dynamicKey ||
  GIT_EXEC_CONFIG_RE.test(key) ||
  (/^submodule\..+\.update$/i.test(key) && (dynamicValue || value.startsWith('!')));

/** Environment variables through which git reads extra config, runs a command (its own `GIT_*`
 * ones and the generic `PAGER`, `EDITOR`, `VISUAL`, `SSH_ASKPASS`), loads its subcommands from
 * another directory (`GIT_EXEC_PATH`) or allows the command-running `ext::` transport
 * (`GIT_ALLOW_PROTOCOL`). */
const GIT_EXEC_ENV_RE =
  /(?:^|[\s;&|(])(?:export\s+)?(?:GIT_(?:CONFIG\w*|PAGER|EXTERNAL_DIFF|SSH|SSH_COMMAND|EDITOR|SEQUENCE_EDITOR|ASKPASS|PROXY_COMMAND|EXEC_PATH|ALLOW_PROTOCOL)|PAGER|EDITOR|VISUAL|SSH_ASKPASS)=/;

/** Walks git's global options (everything before the subcommand) and returns the directories a
 * relative output path may resolve against, the subcommand index, and whether a `-c` setting makes
 * git run a command the string does not show (`execConfig`). Each `-C DIR` moves the
 * working directory relative to the previous one; `--git-dir`/`--work-tree` can make git resolve
 * relative paths elsewhere, so their directories become extra candidate bases (every candidate
 * is checked — over-matching only adds a target). Segments are joined once at the end, keeping
 * the walk linear in the number of `-C` options. */
const gitGlobalBases = (args) => {
  let segments = [];
  let execConfig = false;
  let outputDirectory = null;
  const extra = [];
  let i = 0;
  for (; i < args.length && args[i].startsWith('-') && args[i] !== '--'; i++) {
    const t = args[i];
    const eq = t.indexOf('=');
    const name = t.startsWith('--') && eq !== -1 ? t.slice(0, eq) : t;
    if (!GIT_VALUE_GLOBALS.has(name)) continue;
    const rawValue = eq !== -1 && t.startsWith('--') ? t.slice(eq + 1) : (args[++i] ?? UNRESOLVABLE_TARGET);
    const value = stripQuotes(rawValue);
    if (name === '-c' || name === '--config-env') {
      const setting = splitGitSetting(value);
      if (isGitExecConfig(setting)) execConfig = true;
      if (setting.key.toLowerCase() === 'format.outputdirectory') {
        // `--config-env` names an environment variable, not the directory.
        outputDirectory = name === '-c' && !setting.dynamicValue ? setting.value : UNRESOLVABLE_TARGET;
      }
    }
    const dirValue = literalWord(rawValue);
    if (name === '-C' && dirValue) {
      if (path.isAbsolute(dirValue)) segments = [dirValue];
      else segments.push(dirValue);
    } else if (name === '--git-dir' || name === '--work-tree') {
      extra.push({ name, value: dirValue });
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
  return { bases, subIdx: i, execConfig, outputDirectory };
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
 * dynamic base makes the joined target dynamic, i.e. WARN). `format-patch` without `-o` or
 * `--stdout` writes its patches into `format.outputDirectory` (when `-c` sets it) or the working
 * directory itself, so that is a target too. A
 * `-c` setting that runs a command makes the call unresolvable. */
const gitOutputTargets = (args) => {
  if (hasBraceExpansion(args.join(' '))) return [UNRESOLVABLE_TARGET];
  const { bases, subIdx, execConfig, outputDirectory } = gitGlobalBases(args);
  const isFormatPatch = args[subIdx] === 'format-patch';
  const values = execConfig ? [UNRESOLVABLE_TARGET] : [];
  for (let i = subIdx + 1; i < args.length; i++) {
    if (args[i] === '--') break;
    const opt = (isFormatPatch && formatPatchDirValue(args, i)) || longOptionValue(args, i, '--output');
    if (opt) {
      values.push(literalWord(opt.value));
      i = opt.last;
    }
  }
  const toStdout = args.slice(subIdx + 1).some((t) => t.startsWith('--') && isLongOptionPrefix(t, '--stdout'));
  // Without -o, format-patch writes into `format.outputDirectory` when set, else the working dir.
  if (isFormatPatch && !toStdout && !values.some((v) => v !== UNRESOLVABLE_TARGET)) values.push(outputDirectory || '.');
  const targets = [];
  for (const value of values) {
    if (path.isAbsolute(value) || value === UNRESOLVABLE_TARGET) targets.push(literalTarget(value));
    else for (const base of bases) targets.push(literalTarget(base ? path.join(base, value) : value));
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
  return args.filter((t) => !t.startsWith('-')).map(targetWord);
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
    const cmdIdx = findCommand(tokens, name);
    if (cmdIdx !== -1) targets.push(...extract(positionalArgsSkippingRedirects(tokens, cmdIdx + 1)));
  }
  return targets;
};

/** Builtins whose operands are assignments (`export "GIT_TRACE=/x"`). */
const DECLARERS = new Set(['export', 'declare', 'typeset', 'local', 'readonly']);

/** Declarers whose `-n` makes a nameref (`declare -n R=GIT_TRACE`); `export -n` un-exports. */
const NAMEREF_DECLARERS = new Set(['declare', 'typeset', 'local']);

/** A trace variable git reads, case-sensitively. */
const TRACE_NAME_RE = /^GIT_TRACE\w*$/;

/** Raw text that makes a word opaque: its expansion cannot be read from the command string. */
const OPAQUE_RE = /[$`\\{}]/;

/** A plain unquoted `NAME=VALUE` or `NAME+=VALUE` word: its name and its raw value. */
const PLAIN_ASSIGNMENT_RE = /^([A-Za-z_]\w*)\+?=([\s\S]*)$/;

/** A word that is a redirect (`>`, `2>&1`, `<<<`, `&>f`, `{fd}>f`), and one whose target is the
 * next word. The operator set is bash's REDIRECTION grammar: an optional fd number, `&` or
 * `{varname}` prefix, then `<`, `>`, `>>`, `<>`, `<<`, `<<<`, `>|`, `<<-`, `<&` or `>&`. A spaced
 * operator this misses turns its target word into an operand, and for cp/install/ln/rsync the
 * last operand is the destination, so the real destination would go unjudged. */
const REDIRECT_PREFIX = String.raw`(?:[0-9&]*|\{[A-Za-z_]\w*\})`;
const REDIRECT_WORD_RE = new RegExp(String.raw`^${REDIRECT_PREFIX}[<>]`);
const REDIRECT_ONLY_WORD_RE = new RegExp(String.raw`^${REDIRECT_PREFIX}(?:[<>]+|>\||<<-|>&|<&)$`);

/** Net `(` minus `)` and the backtick count outside quotes in `word`, escaped ones excluded:
 * how far the word opens a `$(`, `(` or backtick that later words of the clause continue. */
const openingDelta = (word) => {
  let parens = 0;
  let ticks = 0;
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    if (c === '\\') i++;
    else if (c === "'" || c === '"') i = skipQuotedSpan(word, i, word.length) - 1;
    else if (c === '(') parens++;
    else if (c === ')') parens--;
    else if (c === '`') ticks++;
  }
  return { parens, ticks };
};

/** Index of the clause's command word for the trace scan: `k` (from `skipCompoundWords`) moved
 * past a `case WORD in` head, a `function NAME` head and, inside a `case`, a `PATTERN)` word. */
const traceCommandStart = (tokens, k, inCase) => {
  let i = k;
  if (tokens[i - 1] === 'case' && tokens[i + 1] === 'in') i += 2;
  if (tokens[i] === 'function') i += 2;
  if ((inCase || i > k) && /\)$/.test(tokens[i] ?? '')) i++;
  return i;
};

/**
 * Trace-file writes (`GIT_TRACE*`) in one clause, by the guard contract in
 * `documentation/investigations/issue-1246-guard-contract.md`. A word is exact when its raw text
 * holds none of `$`, backtick, `\`, `{` or `}`, so its quote removal (`normalizeShellWord`) is
 * what bash produces; any other word is opaque. A slot word is one the shell or `env` reads as
 * `NAME=VALUE`: a command-position word, an `env` operand before its command, a declarer operand.
 * An exact trace assignment (a plain one anywhere, a quoted one in a slot) yields its absolute
 * value as a target; git ignores a relative value. A slot word whose name or value cannot be read
 * exactly, an `env` option that is not an exact spelling (every `-S` included), a bare or opaque
 * declarer operand, and a nameref declarer make the clause unresolvable. `allexport` reports a
 * `set`/`shopt` that may turn on allexport; the caller weighs it against the whole command.
 */
const findGitTraceTargets = (tokens, k, inCase) => {
  const targets = [];
  let unresolvable = false;
  let allexport = false;
  const start = traceCommandStart(tokens, k, inCase);
  const positions = new Set([...commandPositions(tokens.slice(start))].map((p) => p + start));
  // `value` is the exact text of a trace value, or null when it cannot be read exactly.
  const judge = (value) => {
    if (value === null || /[*?[\]]/.test(value) || value.startsWith('~')) unresolvable = true;
    else if (path.isAbsolute(value)) targets.push(value);
  };
  const slot = (word, exact, text, plain) => {
    if (plain) return; // already judged as a plain assignment
    if (!exact) unresolvable ||= word.includes('=');
    else if (/^GIT_TRACE\w*\+?=/.test(text)) judge(text.slice(text.indexOf('=') + 1));
  };
  let run = null; // `env`, a declarer, `set` or `shopt`, whose operands follow
  let [skipNext, parens, ticks, shoptO, halted] = [false, 0, 0, false, false];
  tokens.forEach((word, i) => {
    const exact = !OPAQUE_RE.test(word);
    const text = exact ? normalizeShellWord(word).text : null;
    const plain = PLAIN_ASSIGNMENT_RE.exec(word);
    if (plain && TRACE_NAME_RE.test(plain[1])) judge(OPAQUE_RE.test(plain[2]) ? null : normalizeShellWord(plain[2]).text);
    const continued = parens > 0 || ticks % 2 === 1;
    const delta = openingDelta(word);
    [parens, ticks] = [Math.max(0, parens + delta.parens), ticks + delta.ticks];
    if (continued || halted || i < start) return;
    if (skipNext || REDIRECT_WORD_RE.test(word)) {
      skipNext = !skipNext && REDIRECT_ONLY_WORD_RE.test(word);
      return;
    }
    let command = positions.has(i);
    if (run === 'env') {
      if (!exact || text.startsWith('-')) {
        const option = exact ? envValueOption(text) : undefined;
        if (option) skipNext = option.value === null;
        else [unresolvable, halted] = [true, true]; // the rest of `env` cannot be read
        return;
      }
      if (text.includes('=')) return slot(word, exact, text, plain);
      command = true; // env's command
    } else if (run && !command) {
      if (run === 'set') allexport ||= !exact || /^-[a-zA-Z]*a/.test(text) || text === 'allexport';
      else if (run === 'shopt') {
        shoptO ||= exact && /^-[a-z]*o/.test(text);
        allexport ||= shoptO && text === 'allexport';
      } else if (exact && text.startsWith('-')) unresolvable ||= NAMEREF_DECLARERS.has(run) && /^-[a-zA-Z]*n/.test(text);
      else if (!exact && !plain) unresolvable = true;
      else {
        slot(word, exact, text, plain);
        unresolvable ||= exact && TRACE_NAME_RE.test(text);
      }
      return;
    }
    if (!command) return;
    const name = commandName(word);
    run = name === 'env' || name === 'set' || name === 'shopt' || DECLARERS.has(name) ? name : null;
    if (!run) slot(word, exact, text, plain);
  });
  return { targets, unresolvable, allexport };
};

/** Every `env` option word GNU env accepts, spelled exactly: a cluster of the no-value letters
 * `i`, `0`, `v`, optionally ending in a value letter `u`, `C` or `a` with its value glued
 * (`-iuNAME`) or as the next word; a bare `-`; `--`; and the full long names, the value-taking
 * ones also with `=VALUE`. `-S` and its long form are deliberately absent: the string is never read,
 * so every spelling of it is an unknown option. */
const ENV_OPTION_RE =
  /^(?:-[i0v]*(?:([uCa])([\s\S]*))?|--|--(?:ignore-environment|null|debug|help|version|list-signal-handling)|--(?:default-signal|ignore-signal|block-signal)(?:=[\s\S]*)?|--(unset|chdir|argv0)(?:=([\s\S]*))?)$/;

/** The value an exact `env` option word (`ENV_OPTION_RE`) takes: `{ value }`, null when the value
 * is the next word, the glued or `=` text otherwise, `''` for an option with no value; undefined
 * for a word that is not an exact option. */
const envValueOption = (option) => {
  const match = ENV_OPTION_RE.exec(option);
  if (!match) return undefined;
  const [, short, glued, long, longValue] = match;
  if (short) return { value: glued || null };
  if (long) return { value: longValue ?? null };
  return { value: '' };
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

/** A single `|` (or `|&`) pipe — never the `||` operator — and the clause text it feeds; a newline
 * after the pipe continues the command, so the clause starts on the next line. */
const PIPE_INTO_RE = /(?<!\|)\|&?(?!\|)\s*([^;|&\n]*)/g;

/** True when a pipe feeds a shell or an interpreter that reads its script from stdin (`… | sh`,
 * `… | bash -s`, `… | node`, `… | python3 -`): the piped text runs as code this module never
 * sees, so the call is unresolvable. One given a script file, `-c`/`-e` or a module reads its code
 * from there, not from the pipe. */
const hasPipedScript = (visible) => {
  PIPE_INTO_RE.lastIndex = 0;
  let match = PIPE_INTO_RE.exec(visible);
  while (match !== null) {
    const tokens = tokenize(match[1]);
    // A bare grep-family filter only matches text, so `ps | grep bash` names no shell.
    if (isInertClause(tokens)) {
      match = PIPE_INTO_RE.exec(visible);
      continue;
    }
    // Found anywhere in the piped clause, like the other finders, so a wrapper (`env bash`,
    // `sudo sh`) cannot hide it.
    const shellIdx = findCommandIndex(tokens, (name) => SHELL_NAMES.includes(name));
    if (shellIdx !== -1 && shellReadsStdinScript(positionalArgsBeforeRedirect(tokens, shellIdx + 1))) return true;
    const interpreter = findInterpreter(tokens);
    if (interpreter && interpreterReadsStdinScript(interpreter.entry, positionalArgsBeforeRedirect(tokens, interpreter.idx + 1))) {
      return true;
    }
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
const isResolvableLiteralTarget = (raw, decoded = false) =>
  // A decoded name is the exact path the command writes, so a quote in it is a character of the
  // name, not syntax: it goes on to containment instead of being treated as unreadable.
  isLiteralPathArg(decoded ? raw.replace(/['"]/g, '') : raw) && !raw.startsWith('~');

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

/** True when a path holding a backslash leaves `realRoot`. `isUnderRoot` resolves through
 * `fs.realpathSync`, which Bun runs with `\\` as a separator, so `<root parent>/\\wt` reads as
 * `<root parent>/wt` while the shell writes a file literally named `\\wt`. The path is therefore
 * resolved only up to its first backslash component (real path, so a symlinked spelling of the
 * root still counts as inside); the rest is appended as written. Only a backslash path is checked
 * this way, every other target keeps going through `isUnderRoot` alone. */
const escapesRootLexically = (resolvedPath, realRoot) => {
  const segments = resolvedPath.split(path.sep);
  const cut = segments.findIndex((segment) => segment.includes('\\'));
  if (cut === -1) return false;
  const prefix = segments.slice(0, cut).join(path.sep) || path.sep;
  const effective = path.join(resolveExistingAncestor(prefix), ...segments.slice(cut));
  return effective !== realRoot && !effective.startsWith(realRoot + path.sep);
};

/** A target that starts `/#` or carries regex metacharacters is probably a sed/regex fragment
 * (`s/<A>/#1174/g` read as `/#1174/g`), not a path the author meant to write. */
const looksLikeRegexFragment = (target) => target.startsWith('/#') || /[\\^$*+?()[\]{}|]/.test(target);

/** Calls in a JS one-liner that write, delete, move or link a file, or run a command (through
 * `child_process`, `Bun.spawn` or `Bun.$`). Whole words or distinctive stems only, so
 * `process.stdout.write`, `process.execPath` and `/re/.exec` do not match. RegExp `exec` is not a
 * command: `child_process` must be named to reach `exec`. `Bun.$` counts wherever it appears, since
 * it can be tagged after a space or through an alias (`const sh = Bun.$`). A `.write`/`.writer`
 * method on anything but stdout/stderr (`Bun.file(p).write`, `Bun.file(p).writer()`) counts.
 * Literal alternations and one bounded lookbehind, linear time. */
const JS_WRITE_CALL_RE =
  /writefile|writesync|createwritestream|bun\.write|(?<!std(?:out|err))\.writer?\b|appendfile|unlink|rename|truncate|symlink|\blink(?:sync)?\b|mkdir|mkdtemp|rmdir|copyfile|\b(?:cp|rm)(?:sync)?\b|chmod|chown|utime|child_process|\b(?:open|opensync|spawn|spawnsync|fork|eval)\b|bun\.\$|\$`/i;

/** The same for Perl and Ruby, where `open`, `system`, `exec`, `spawn`, backticks, `qx` and `%x`
 * run commands or open files for writing, and a `.write`/`.binwrite` method on anything but
 * stdout/stderr (`File.binwrite`, `Pathname#write`) writes a file. */
const PERL_RUBY_WRITE_CALL_RE =
  /file\.(?:write|delete|new|open|rename|unlink|symlink|link|truncate)|io\.(?:write|popen)|(?<!std(?:out|err))\.(?:bin)?write\b|fileutils|syswrite|sysopen|dbmopen|unlink|rename|truncate|symlink|\blink\b|mkdir|rmdir|chmod|chown|utime|\b(?:open|popen|exec|system|spawn|fork|eval|qx)\b|`|%x/i;

/** Interpreters whose inline script (`-e`, `-c`, …) this module cannot parse. Every argument after
 * the interpreter word is checked, so a value-taking option ahead of the script cannot hide it.
 * `always` flags warn whatever the script says: python `-c` (Python reads and writes files
 * through the same `open`), and perl/ruby `-i`, which edit their file operands in place. */
const INTERPRETERS = [
  {
    name: /^(?:node(?:js)?[0-9.]*|bun)$/,
    scriptFlag: (t) => /^-[a-zA-Z]*[ep]$/.test(t) || ['--eval', '--print'].some((n) => isLongOptionPrefix(t.split('=')[0], n)),
    valueOption: (t) =>
      /^(?:-[rC]|--(?:require|import|loader|experimental-loader|conditions|env-file|preload|cwd|config|title|input-type))$/.test(t),
    // `bun run -` runs stdin like `bun -`.
    runWord: true,
    writeCall: (script) => JS_WRITE_CALL_RE.test(script),
  },
  {
    name: /^(?:perl|ruby)[0-9.]*$/,
    scriptFlag: (t) => /^-[a-zA-Z]*[eE]/.test(t),
    always: (t) => /^-[a-zA-Z]*i/.test(t),
    valueOption: (t) => /^-[IMmrC]$/.test(t),
    writeCall: (script) => PERL_RUBY_WRITE_CALL_RE.test(script),
  },
  {
    name: /^(?:python|pypy|py)[0-9.]*$/,
    always: (t) => /^-[a-zA-Z]*c/.test(t),
    valueOption: (t) => /^-[WXQ]$|^--check-hash-based-pycs$/.test(t),
  },
];

/** Script operands that name stdin itself. */
const STDIN_SCRIPT_OPERANDS = new Set(['-', '/dev/stdin', '/dev/fd/0', '/proc/self/fd/0']);

/** True when an interpreter given `args` reads its script from stdin: an operand naming stdin
 * (`-`, `/dev/stdin`, …), or no operand at all. A value-taking option's value is skipped, so it is
 * not mistaken for a script file, and so are fd-prefixed redirects and bun's `run` word. The word
 * after `-e`/`-c` and the module after `-m` read as operands, so stdin is data. */
const interpreterReadsStdinScript = ({ valueOption, runWord }, args) => {
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (STDIN_SCRIPT_OPERANDS.has(t)) return true;
    if (/^\d+[<>]/.test(t)) {
      // An fd-prefixed redirect (`0<<'EOF'`, `0< f`) is shell syntax, not an operand.
      if (/^\d+[<>]+$/.test(t)) i++;
    } else if (valueOption(t)) i++;
    else if (runWord && i === 0 && t === 'run') continue;
    else if (!t.startsWith('-')) return false;
  }
  return true;
};

/** The interpreter entry a clause runs and the index of its command word, or null. */
const findInterpreter = (tokens) => {
  for (const entry of INTERPRETERS) {
    const idx = tokens.findIndex((t) => entry.name.test(commandName(t)));
    if (idx !== -1) return { entry, idx };
  }
  return null;
};

/** The command a word names once the shell has removed its quotes and escapes (`\node`,
 * `'node'`, `$'node'`, `/usr/bin/node` all name `node`). */
const commandName = (word) => {
  const bare = word.replace(/\$'((?:\\.|[^'\\])*)'/g, (_, body) => decodeAnsiC(body)).replace(/['"\\]/g, '');
  return bare.slice(bare.lastIndexOf('/') + 1);
};

/** Script text as the interpreter receives it: inside double quotes the shell drops the
 * backslash before `$`, `` ` ``, `"` and `\`, so `Bun.\$\`…\`` arrives as `` Bun.$`…` ``. */
const unescapeDoubleQuoted = (text) => text.replace(/\\([$`"\\])/g, '$1');

/** True when the clause's own command is a grep-family search (`grep …`, `git grep …`), so every
 * later word is a pattern, option or file. Only the head command counts: a `grep` that is an
 * argument (`find -name grep -exec perl …`, `sudo -u grep python3 …`) exempts nothing. */
const isGrepHeadClause = (tokens) =>
  INERT_GREP_COMMANDS.has(tokens[0]) || (tokens[0] === 'git' && tokens[1] === 'grep');

/** True when an interpreter in the clause runs an inline script that may write. In a grep clause
 * (`git grep -n perl -i`, `grep -e ruby`) an interpreter name is a search pattern, not a command. */
const hasInterpreterWrite = (tokens, heredocText) =>
  !isGrepHeadClause(tokens) &&
  INTERPRETERS.some((entry) => {
    const { name, scriptFlag, always, writeCall } = entry;
    const idx = tokens.findIndex((t) => name.test(commandName(t)));
    if (idx === -1) return false;
    const args = positionalArgsBeforeRedirect(tokens, idx + 1);
    if (always && args.some(always)) return true;
    if (scriptFlag && args.some(scriptFlag)) {
      return Boolean(writeCall && writeCall(unescapeDoubleQuoted(args.join(' '))));
    }
    const script = stdinRedirectScript(tokens, idx, heredocText);
    if (script === null || !interpreterReadsStdinScript(entry, args)) return false;
    if (script === STDIN_FROM_FILE) return true;
    // Python has no write-call check: its `open` reads and writes alike, as for `-c`.
    return !writeCall || writeCall(unescapeDoubleQuoted(script));
  });

/** `stdinRedirectScript`'s answer when stdin is a file, fd or process substitution
 * (`node < script.js`, `node <&3`): a script the command string does not show. */
const STDIN_FROM_FILE = Symbol('stdin from a file');

/** The script a heredoc (`<<`), here-string (`<<<`) or input file (`<`) in the clause feeds on
 * stdin, fd `0` named or not, or null when the clause has none. A redirect may precede the command
 * word (`< evil.js node`), so every token but the command word at `idx` is scanned. A heredoc
 * yields `heredocText`, every heredoc body in the command: checking more text than the clause's
 * own body only ever adds a warning. */
const stdinRedirectScript = (tokens, idx, heredocText) => {
  for (let i = 0; i < tokens.length; i++) {
    if (i === idx) continue;
    const here = /^0?<<<(.*)$/s.exec(tokens[i]);
    if (here) return [here[1], ...tokens.slice(i + 1)].join(' ');
    if (/^0?<</.test(tokens[i])) return heredocText;
    if (/^0?</.test(tokens[i])) return STDIN_FROM_FILE;
  }
  return null;
};

/** True when a clause is write-shaped but unresolvable: its leading command word is one of
 * `UNRESOLVABLE_WRITE_COMMANDS`, or an interpreter in it runs an inline or stdin script that may
 * write. */
const hasUnresolvableCommand = (tokens, heredocText) =>
  UNRESOLVABLE_WRITE_COMMANDS.includes(commandName(tokens[0])) || hasInterpreterWrite(tokens, heredocText);

/** The directory a `cd`/`pushd`/`popd` moves to from each of `dirs`, or null when its target
 * cannot be read statically (`cd "$D"`, `cd -`, a bare `cd` or `popd`, `cd ~`, a glob, `pushd +1`), or when a
 * `CDPATH` set in the command may redirect a relative target that does not start with `.`. */
const cdDestinations = (word, cdArgs, dirs, cdpath) => {
  if (word !== 'cd' && cdArgs.some((t) => /^[+-]/.test(t))) return null;
  const text = extractCdTargetText(cdArgs);
  if (text === null || !isResolvableLiteralTarget(text)) return null;
  if (cdpath && !path.isAbsolute(text) && !text.startsWith('.')) return null;
  return dirs.map((dir) => path.resolve(dir, text));
};

/** A substitution leaves a `$` word in the text around it, so the outer command reads it as
 * dynamic, carrying the index of the body it stands for between two control characters. */
const placeholder = (idx) => `$\u0001${idx}\u0001`;
const PLACEHOLDER_RE = /\$\u0001(\d+)\u0001/g;

/** Backtick body as the shell runs it: inside backticks `\\`, `` \` `` and `\$` lose their backslash. */
const unescapeBacktickBody = (raw) => raw.replace(/\\([\\`$])/g, '$1');

/** True when a `#` at `i` starts a comment: it begins a word. */
const startsComment = (text, i) => i === 0 || /[\s;&|()]/.test(text[i - 1]);

/**
 * Replaces each command or process substitution in `text` — `$(…)`, backticks, `<(…)`, `>(…)` —
 * with a placeholder, and appends its body to `bodies` with its own nested substitutions already
 * replaced the same way. One pass with a stack of open bodies, so each character is copied once
 * however deep the nesting; a backtick body is unescaped first and extracted again, and each
 * nesting level doubles its backslashes, so that rescan stays linear too. Single quotes, comments
 * and heredoc bodies are copied as they are. `$((…))` arithmetic reads as a body holding a
 * subshell, which runs nothing. An unclosed body is put back as written.
 */
const extractSubstitutions = (text, bodies) => {
  const heredoc = computeHeredocBodyMask(text);
  const frames = [{ out: '', opener: '', inDouble: false, depth: 0 }];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const frame = frames[frames.length - 1];
    const ch = text[i];
    let end = i + 1;
    if (heredoc[i]) {
      frame.out += ch;
    } else if (ch === '\\') {
      end = i + 2;
      frame.out += text.slice(i, end);
    } else if (!frame.inDouble && (ch === "'" || (ch === '#' && startsComment(text, i)))) {
      const eol = text.indexOf('\n', i);
      end = ch === "'" ? skipQuotedSpan(text, i, n) : eol === -1 ? n : eol;
      frame.out += text.slice(i, end);
    } else if (ch === '`') {
      let j = i + 1;
      while (j < n && text[j] !== '`') j += text[j] === '\\' ? 2 : 1;
      const body = extractSubstitutions(unescapeBacktickBody(text.slice(i + 1, Math.min(j, n))), bodies);
      frame.out += placeholder(bodies.push(body) - 1);
      end = j + 1;
    } else if (ch === '$' || (!frame.inDouble && (ch === '<' || ch === '>'))) {
      // The shell drops a backslash-newline before it reads the opener, so `$\\<newline>(` is `$(`.
      let open = i + 1;
      while (text[open] === '\\' && text[open + 1] === '\n') open += 2;
      if (text[open] === '(') {
        frames.push({ out: '', opener: ch + '(', inDouble: false, depth: 0 });
        end = open + 1;
      } else frame.out += ch;
    } else if (frames.length > 1 && !frame.inDouble && ch === ')' && frame.depth === 0) {
      frames.pop();
      frames[frames.length - 1].out += placeholder(bodies.push(frame.out) - 1);
    } else {
      if (!frame.inDouble && ch === '(') frame.depth++;
      if (!frame.inDouble && ch === ')') frame.depth--;
      if (ch === '"') frame.inDouble = !frame.inDouble;
      frame.out += ch;
    }
    i = end;
  }
  while (frames.length > 1) {
    const open = frames.pop();
    frames[frames.length - 1].out += open.opener + open.out;
  }
  return frames[0].out;
};

/** A write target as the command receives it: the shell drops a backslash before any character,
 * so `\\/etc/x` writes `/etc/x`. A dynamic word is kept as written, and its `$` makes it unresolvable. */
const unescapeTarget = (raw) => {
  if (!raw.includes('\\')) return raw;
  const { text, dynamic } = normalizeShellWord(raw);
  return dynamic ? raw : text;
};

/** The base a clause's relative targets resolve against when it runs `env -C DIR` (or
 * `--chdir=DIR`), which starts its command in DIR; null when the clause has no such option, and
 * `unknown` when a DIR cannot be read statically. Chained options resolve in order. */
const envChdirBase = (tokens, dirs) => {
  const idx = findCommand(tokens, 'env');
  if (idx === -1) return null;
  let base = null;
  for (let i = idx + 1; i < tokens.length; i++) {
    const t = tokens[i];
    let value;
    if (t === '-C' || t === '--chdir') value = tokens[++i];
    else if (t.startsWith('--chdir=')) value = t.slice('--chdir='.length);
    else if (/^-C./.test(t)) value = t.slice(2);
    else if (t === '-u' || t === '--unset') {
      i++;
      continue;
    } else if (t.startsWith('-') || /^\w+=/.test(t)) continue;
    else break;
    const text = value === undefined ? null : stripQuotes(value);
    if (text === null || !isResolvableLiteralTarget(text)) return { dirs: [], unknown: true };
    base = { dirs: (base ? base.dirs : dirs).map((dir) => path.resolve(dir, text)), unknown: false };
  }
  return base;
};

/** Words that open and close a compound command (`if … fi`, loops, `case … esac`, `{ … }`). */
const COMPOUND_OPENERS = new Set(['if', 'while', 'until', 'for', 'select', 'case', '{']);
const COMPOUND_CLOSERS = new Set(['fi', 'done', 'esac', '}']);

/** Index of the clause's command word past compound keywords and a function header (`f()`),
 * updating `compound` (open compound commands) and `cases` (open `case`s). A word such as
 * `then` or `y)` is not skipped: a `cd` past it is found as an argument-position `cd`, which only
 * ever adds a candidate, the same as any `cd` inside a compound command. */
const skipCompoundWords = (tokens, nest) => {
  let k = 0;
  while (k < tokens.length) {
    const word = tokens[k];
    if (COMPOUND_OPENERS.has(word)) {
      nest.compound++;
      if (word === 'case') nest.cases++;
    } else if (COMPOUND_CLOSERS.has(word)) {
      nest.compound = Math.max(0, nest.compound - 1);
      if (word === 'esac') nest.cases = Math.max(0, nest.cases - 1);
    } else if (!/^[\w.:-]+\(\)$/.test(word)) {
      break;
    }
    k++;
  }
  return k;
};

/** The directories the shell may stand in after a clause whose command starts at `tokens[k]`.
 * `union` adds a `cd`'s destination to the candidates instead of replacing them, for a `cd` that
 * may not run; a `cd` past the command word (`command cd`, `echo cd x`) may be an argument, so it
 * only ever adds. A `cd` whose target cannot be read makes the base `unknown`, so
 * later relative targets warn. */
const applyCd = (state, tokens, k, union, cdpath) => {
  const isCd = (t) => ['cd', 'pushd', 'popd'].includes(normalizeShellWord(t).text);
  const certain = k < tokens.length && isCd(tokens[k]);
  const idx = certain ? k : tokens.findIndex((t, i) => i > k && isCd(t));
  if (idx === -1) return state;
  const word = normalizeShellWord(tokens[idx]).text;
  const keep = union || !certain;
  const moved = cdDestinations(word, tokens.slice(idx + 1), state.dirs, cdpath);
  if (moved === null) return { dirs: keep ? state.dirs : [], unknown: true };
  const dirs = [...new Set(keep ? [...state.dirs, ...moved] : moved)];
  if (dirs.length > MAX_CWD_CANDIDATES) return { dirs: state.dirs, unknown: true };
  return { dirs, unknown: state.unknown };
};

/** Every directory any of `states` may stand in. */
const unionStates = (states) => ({
  dirs: [...new Set(states.flatMap((st) => st.dirs))],
  unknown: states.some((st) => st.unknown),
});

/** How the clause at `[start, end)` joins its neighbours: the operator before it (`and`, `or`,
 * `pipe`, `bg` or `seq` for `;`, a newline or the start) and whether it runs in a pipeline or in
 * the background, where a `cd` changes only a subshell's directory. */
const clauseLinks = (visible, start, end) => {
  const [b1, b2] = [visible[start - 1], visible[start - 2]];
  const before =
    b1 === '&' ? (b2 === '&' ? 'and' : b2 === '|' ? 'pipe' : 'bg') : b1 === '|' ? (b2 === '|' ? 'or' : 'pipe') : 'seq';
  const [a1, a2] = [visible[end], visible[end + 1]];
  const subshell = before === 'pipe' || (a1 === '|' && a2 !== '|') || (a1 === '&' && a2 !== '&');
  return { before, subshell };
};

/** Write targets in one view of the command, each with the directories a relative target
 * resolves against (`dirs`, and `unknown` when a `cd` hid one), and whether anything
 * write-shaped cannot be resolved. Clauses are walked in order so a `cd` moves the base of every
 * later clause it surely precedes; a `cd` that may not run (after `||`, inside a compound command
 * or function, or anywhere in an `&&` list once a `;` ends it) leaves every earlier base possible;
 * a subshell `( … )` restores the base it opened with. Each substitution placeholder
 * in a clause is handed to `onSubstitution` with the base its body runs in. */
const collectWriteSignals = (visible, heredocText, cwd, initialState, onSubstitution, maskAllowed) => {
  const literalTargets = [];
  let unresolvable = false;
  let state = initialState;
  const saved = [];
  let clauseBase = null; // set while a clause runs `env -C DIR`
  let allexport = false;
  const add = (raw, shape) => {
    const base = clauseBase || state;
    const target = typeof raw === 'object' ? raw.literal : unescapeTarget(raw);
    if (typeof raw === 'object' && raw.quoteSplit) unresolvable = true;
    const decoded = typeof raw === 'object' || (raw.includes('\\') && target !== raw);
    if (!isResolvableLiteralTarget(target, decoded)) unresolvable = true;
    else if (path.isAbsolute(target)) literalTargets.push({ target, dirs: [cwd], shape });
    else {
      literalTargets.push({ target, dirs: base.dirs, shape });
      if (base.unknown) unresolvable = true;
    }
  };

  const redirectView = maskRedirectNoise(visible, maskAllowed);
  // `list` holds the base after each clause of the current `&&`/`||` list: when a `;` or newline
  // ends it, any of them may be where the shell stands, since a later link may not have run.
  let list = [];
  const nest = { compound: 0, cases: 0 };
  let cdpath = false;
  for (const [start, end] of clauseRanges(visible)) {
    const links = clauseLinks(visible, start, end);
    if (visible.slice(start, end).trim() && (links.before === 'seq' || links.before === 'bg') && list.length > 0) {
      state = unionStates(list);
      list = [];
    }
    // Subshell parens around the clause are syntax, not part of its first or last word; inside a
    // `case`, a trailing `)` closes a pattern instead.
    const opening = visible.slice(start, end).match(/^[\s(]*/)[0];
    let to = end;
    while (to > start + opening.length && /[\s)]/.test(visible[to - 1])) to--;
    const from = start + opening.length;
    for (const [, idx] of visible.slice(from, to).matchAll(PLACEHOLDER_RE)) onSubstitution(Number(idx), state);
    const tokens = tokenize(visible.slice(from, to));
    const k = skipCompoundWords(tokens, nest);
    const inCase = nest.cases > 0;
    if (!inCase) for (let p = 0; p < opening.replace(/\s/g, '').length; p++) saved.push({ state, list }), (list = []);
    clauseBase = null; // a redirect is opened by the shell itself, before `env` changes directory
    findRedirectTargets(redirectView.slice(from, to)).forEach((t) => add(t, FILE_WRITE));
    clauseBase = tokens.length > 0 ? envChdirBase(tokens, state.dirs) : null;
    if (tokens.length > 0) {
      findTeeTargets(tokens).forEach((t) => add(t, FILE_WRITE));
      [...findSedTargets(tokens), ...findOptionWriteTargets(tokens)].forEach((t) => add(t));
      for (const { target, shape } of findCopyMoveWrites(tokens)) add(target, shape);
      // A trace value is the exact file name git opens, so it skips the shell-word checks.
      const trace = findGitTraceTargets(tokens, k, inCase);
      for (const target of trace.targets) literalTargets.push({ target, dirs: [cwd] });
      if (trace.unresolvable) unresolvable = true;
      if (trace.allexport) allexport = true;
      if (hasUnresolvableCommand(tokens, heredocText)) unresolvable = true;
      if (tokens.some((t) => t.startsWith('CDPATH='))) cdpath = true;
      // A pipeline element or background job runs in a subshell: its `cd` moves only that subshell,
      // which a `( … )` around it tracks and restores.
      if (!links.subshell || opening.includes('(')) state = applyCd(state, tokens, k, links.before === 'or' || nest.compound > 0, cdpath);
    }
    const closing = visible.slice(to, end).replace(/\s/g, '').length;
    if (!inCase) {
      for (let p = 0; p < closing && saved.length > 0; p++) ({ state, list } = saved.pop());
    }
    list.push(state);
  }

  if (hasPipedScript(visible)) unresolvable = true;
  // Under allexport a builtin that assigns (`read GIT_TRACE`, `printf -v GIT_TRACE`) also exports,
  // so a command that turns it on and mentions a trace name at all is unresolvable.
  if (allexport && /GIT_|TRACE/.test(visible.replace(/['"\\]/g, ''))) unresolvable = true;
  if (GIT_EXEC_ENV_RE.test(visible) && splitClauses(visible).some((c) => findCommand(tokenize(c), 'git') !== -1)) {
    unresolvable = true;
  }
  return { literalTargets, unresolvable };
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
const evaluateBashWriteTargets = (command, cwd, input = {}) => {
  const assignedRoot = readAssignedWorktreeRoot(cwd);
  if (!assignedRoot) return null;
  const stateRoot = campaignStateRoot(cwd);
  const mainClone = mainCloneRoot(cwd);
  const extraRoots = trustedWriteRoots(cwd, input, { mainClone, assignedRoot });
  const settingsFiles = settingsFileCandidates(cwd, mainClone);
  const isExtraPath = (p) => isTrustedExtraPath(p, extraRoots);

  const literalTargets = [];
  let unresolvable = false;

  // The command and each substitution body are scanned once, every body with the directories in
  // effect where its placeholder stands (`maskedSpans` keeps every placeholder visible).
  const bodies = [];
  const queue = [[extractSubstitutions(command, bodies), { dirs: [cwd], unknown: false }]];
  const queued = new Set();
  const enqueue = (idx, state) => {
    if (idx < bodies.length && !queued.has(idx)) {
      queued.add(idx);
      queue.push([bodies[idx], state]);
    }
  };
  const maskAllowed = [queue[0][0], ...bodies].every((text) => visibleViews(text).every(maskingAllowed));
  for (let q = 0; q < queue.length; q++) {
    const [text, state] = queue[q];
    const heredocMask = computeHeredocBodyMask(text);
    const heredocText = text.replace(/[\s\S]/g, (ch, i) => (heredocMask[i] ? ch : ' '));
    for (const visible of visibleViews(text)) {
      const signals = collectWriteSignals(visible, heredocText, cwd, state, enqueue, maskAllowed);
      for (const { target, dirs, shape } of signals.literalTargets) {
        for (const dir of dirs) literalTargets.push({ target, dir, visible, shape });
      }
      if (signals.unresolvable) unresolvable = true;
    }
  }

  for (const { target, dir, visible, shape } of literalTargets) {
    if (isStreamDeviceTarget(target, visible)) continue;
    const resolvedPath = path.resolve(dir, target);
    if (isSettingsFilePath(resolvedPath, settingsFiles)) {
      return {
        tier: 'block',
        pattern_id: 'bash-settings-roots-write',
        reason:
          `Bash write target is a Claude Code settings file that lists the directories campaign agents may write (permissions.additionalDirectories): ${resolvedPath}. ` +
          'Remedy: ask the owner to change it; a worker never edits it.',
      };
    }
    if (
      (!isUnderRoot(resolvedPath, assignedRoot) || escapesRootLexically(resolvedPath, assignedRoot)) &&
      !isTrustedStateWrite({ target, shape }, resolvedPath, dir, stateRoot) &&
      !isTrustedShapedWrite({ target, shape }, resolvedPath, dir, isExtraPath)
    ) {
      const hint = looksLikeRegexFragment(target)
        ? ' This looks like a sed/regex expression; quote it.'
        : '';
      return {
        tier: 'block',
        pattern_id: 'bash-outside-assigned-worktree',
        reason:
          `Bash write target resolves outside the assigned worktree root (${assignedRoot}): ${resolvedPath}. ` +
          `Remedy: write inside ${assignedRoot} instead (e.g. ${path.join(assignedRoot, path.basename(resolvedPath))}) ` +
          `and use a literal absolute path, or the Write/Edit tools.${hint}`,
      };
    }
    // A name that holds a quote is a legal file name, but it stays a warning inside the root: no
    // spelling of it is ever allowed that the guard did not allow before it decoded quotes.
    if (/['"]/.test(target)) unresolvable = true;
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
        'a dynamic argument, a script fed to a shell or interpreter on stdin, an interpreter one-liner (node -e, ' +
        'python -c, perl -i), a sed e command or an awk program, whose writes the command string ' +
        'does not show. Remedy: use a literal absolute path under the assigned worktree, or the ' +
        'Write/Edit tools.',
    };
  }

  return null;
};

module.exports = {
  evaluateBashWriteTargets,
};
