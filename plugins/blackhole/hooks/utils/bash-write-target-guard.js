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
 *    all (`python3 -c`, `perl -i`, `awk`, `dd`, `rsync`) → `warn` and record
 *    (`bash-write-target-unresolvable`), never a silent allow (ADR-029's accepted residual risk:
 *    command-string parsing cannot enumerate every write idiom).
 *
 * `BLACKHOLE_ASSIGNED_WORKTREE` unset (the routine case outside a campaign implementer spawn) →
 * `readAssignedWorktreeRoot` returns null and this module returns null immediately, before any
 * parsing — byte-identical to today for every session that never set the env var (#620's own
 * fail-open contract, not a regression this module introduces).
 *
 * Read-only sources are never evaluated: `cp`/`mv` extract only the destination (last positional
 * argument) as a write target, exactly like `validate-file-changes.js` only ever evaluates a
 * write's own target — a source file that happens to live outside the assigned root (the
 * ordinary shape of reading a shared reference file) must never itself trigger a deny.
 */

const path = require('path');
const { computeMaskedSpans } = require('./bash-context');
const { readAssignedWorktreeRoot, isUnderRoot } = require('./hook-event-log');
const { isLiteralPathArg } = require('./worktree-removal-guard');

/** Command words whose write behavior cannot be resolved by static inspection of the command
 * string at all — the residual gap ADR-029 accepts and downgrades to WARN rather than a silent
 * allow. `requiresFlag`, when set, narrows the match to invocations carrying that flag (a bare
 * `awk`/`dd`/`rsync` invocation is unresolvable outright; a bare `python3`/`perl` invocation with
 * no `-c`/`-i` is not write-shaped at all and is left alone). */
const UNRESOLVABLE_WRITE_COMMANDS = [
  { name: 'python3', requiresFlag: '-c' },
  { name: 'python', requiresFlag: '-c' },
  { name: 'perl', requiresFlag: /^-[a-zA-Z]*i/ },
  { name: 'awk', requiresFlag: null },
  { name: 'dd', requiresFlag: null },
  { name: 'rsync', requiresFlag: null },
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
      const quote = ch;
      let j = i + 1;
      while (j < n && text[j] !== quote) {
        if (quote === '"' && text[j] === '\\' && j + 1 < n) j += 2;
        else j++;
      }
      const end = j < n ? j + 1 : j;
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
 * a chained command's later clause is never mistaken for the first clause's own arguments. */
const splitClauses = (visible) => {
  const clauses = [];
  let current = '';
  let i = 0;
  const n = visible.length;
  while (i < n) {
    const ch = visible[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      while (j < n && visible[j] !== quote) {
        if (quote === '"' && visible[j] === '\\' && j + 1 < n) j += 2;
        else j++;
      }
      const end = j < n ? j + 1 : j;
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
      const prev = i > 0 ? visible[i - 1] : '';
      const next = i + 1 < n ? visible[i + 1] : '';
      if (prev === '>' || next === '>') {
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

const REDIRECT_RE = /(&>>|&>|>>|>)\s*(\S+)?/g;

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
    if (raw && !isFdDuplicationTarget(raw)) {
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

/** `cp`/`mv <source...> <dest>` write target in one clause — only the last positional argument
 * (the destination) is a write target; every earlier positional argument is a read-only source
 * and must never itself be evaluated (see module docstring). Fewer than two positional arguments
 * means there is no destination to evaluate (`cp --help`, a malformed invocation, etc). */
const findCopyMoveTargets = (tokens) => {
  for (const name of ['cp', 'mv']) {
    const cmdIdx = tokens.findIndex((t) => isCommandToken(t, name));
    if (cmdIdx === -1) continue;
    const positional = positionalArgsBeforeRedirect(tokens, cmdIdx + 1).filter((t) => !t.startsWith('-'));
    if (positional.length < 2) continue;
    return [stripQuotes(positional[positional.length - 1])];
  }
  return [];
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
 * Entry point for `validate-bash-command.js`. Returns null when `BLACKHOLE_ASSIGNED_WORKTREE` is
 * unset/invalid (fail-open, byte-identical to today — #620's own contract) or when nothing
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

    for (const raw of [...findTeeTargets(tokens), ...findSedTargets(tokens), ...findCopyMoveTargets(tokens)]) {
      if (isResolvableLiteralTarget(raw)) literalTargets.push(raw);
      else unresolvable = true;
    }

    if (hasUnresolvableCommand(tokens)) unresolvable = true;
  }

  for (const target of literalTargets) {
    const resolvedPath = path.isAbsolute(target) ? target : path.resolve(cwd, target);
    if (!isUnderRoot(resolvedPath, assignedRoot)) {
      return {
        tier: 'block',
        pattern_id: 'bash-outside-assigned-worktree',
        reason: `Bash write target resolves outside the assigned worktree root (${assignedRoot}): ${resolvedPath}`,
      };
    }
  }

  if (unresolvable) {
    return {
      tier: 'warn',
      pattern_id: 'bash-write-target-unresolvable',
      reason:
        'Bash command looks write-shaped but its target could not be resolved by static ' +
        'inspection (a dynamic argument, or a command like python3 -c/perl -i/awk/dd/rsync whose ' +
        'write behavior cannot be determined from the command string alone) — cannot verify ' +
        'assigned-worktree containment',
    };
  }

  return null;
};

module.exports = {
  evaluateBashWriteTargets,
};
