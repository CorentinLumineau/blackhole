#!/usr/bin/env bun
'use strict';

/**
 * hook-event-log.js — the PreToolUse hooks' boundary with everything outside the process: the
 * stdin payload coming in, the harness-facing decision going out, and the durable record of every
 * non-allow decision under `<main-clone>/.blackhole/hook-events/`.
 *
 * The durable record defeats an uncooperative-but-not-adversarial worker's *silence*: an
 * unattended worker cannot be relied on to mention in its own return JSON that a call was
 * refused, so the refusal is written by non-agent code and read by the orchestrator's Triage step
 * (orchestrator-runtime.md § Triage 1b) into findings-ledger.json as V-HOOK-01 / V-HOOK-02.
 * Recording is best-effort (a recording failure never converts a refusal into an allow); the
 * *decision* never is. This is NOT a filesystem-tamper guarantee — a worker with Bash access to
 * the main clone could still delete or overwrite its own event file before Triage ingests it;
 * closing that residual gap needs a channel the worker cannot reach, which is out of this issue's
 * scope. Triage globbing the directory before validating the worker's return JSON narrows the
 * window but does not close it.
 *
 * One file per event rather than one merged record: concurrent worktrees would otherwise race on
 * a read-modify-write of a shared file. Unique filenames remove the race with no coordination
 * machinery — the cost `.blackhole/resume-request.json` pays for its single-file shape.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { rotateHookEvents } = require('./hook-event-rotation');
const { isOrchestratorCaller, hasNoAgentType } = require('./campaign-scope');

/** Credential-shaped literals are masked before anything is written to disk. The warn tier exists
 * precisely because a command may carry a secret, and recording it verbatim would move that secret
 * from a transient argv into a durable file.
 *
 * Two shapes, because credentials show up both ways in real commands:
 *  - KV form (`KEY=value` / `KEY: value`): the keyword may be a whole SCREAMING_SNAKE_CASE
 *    identifier segment (`GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `MY_API_KEY`) — a plain `\b`
 *    boundary in front of the keyword misses these, since `_` is a word character and `\b` never
 *    fires between two word characters. The leading lazy non-capturing group folded into capture
 *    group 1 below absorbs any underscore-joined prefix segments instead, and the trailing
 *    underscore-joined group does the same after the keyword, so the whole name (not just the
 *    matched keyword) is preserved in the output.
 *  - Space form (`--token xyz`, `Bearer xyz`): no `=`/`:` joins the keyword to its value at all.
 */
const SECRET_KV =
  /\b((?:[A-Za-z][A-Za-z0-9]*_){0,8}?(?:password|passwd|api[_-]?key|secret|token|access[_-]?key)(?:_[A-Za-z0-9]+){0,8})(['"]?\s*[=:]\s*)(['"]?)[^'"\s]{4,}\3/gi;
const SECRET_SPACE =
  /(?<![\w-])(--?(?:password|passwd|api[_-]?key|secret|token|access[_-]?key|with-token)|Bearer)\s+(['"]?)[^'"\s]{4,}\2/gi;
/** Credentials with no keyword in front of them. Every quantifier is bounded or runs over a
 * character class its neighbour cannot also match, so none of these backtracks catastrophically.
 *  - Bare GitHub tokens keep their prefix (`ghp_***`) so a reader can tell what leaked.
 *  - AWS access key ids keep `AKIA`/`ASIA`.
 *  - URL userinfo masks only the password; the scheme and user stay readable.
 *  - `--password x` / `--password=x` at any length: SECRET_SPACE only fires from 4 chars up. */
const SECRET_GITHUB_TOKEN = /(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g;
const SECRET_AWS_KEY = /\b(AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])/g;
/** The password class admits `@`, so the greedy run backtracks to the LAST `@` before the first
 * `/` of the authority (`https://user:p@ss@host` masks `p@ss`). */
const SECRET_URL_USERINFO = /\b([a-z][a-z0-9+.-]{0,31}:\/\/)([^\s:/@'"]{1,256}):[^\s/'"]{1,256}@/gi;
/** A quoted `--password` value may hold spaces; it is consumed up to its closing quote. Runs
 * before the unquoted passes so a value such as `"two words"` is not half-matched by them. */
const SECRET_PASSWORD_QUOTED = /(--?(?:password|passwd))(\s{1,64}|=)(['"])[^'"]{1,512}\3/gi;
/** Glued `-p<value>` is a password only for the MySQL client family; elsewhere `-p` is a port or a
 * "parents" flag. Up to 16 argument tokens may sit between the command word and the flag (a repeated
 * command word ends the scan, which keeps a run of them linear), and a
 * bare `-p` (interactive prompt) has no value to mask. */
const SECRET_MYSQL_GLUED_P =
  /((?<![\w-])(?:mysqldump|mysql|mariadb)(?:\s+(?!(?:mysqldump|mysql|mariadb)\b)[^\s|;&]{1,256}){0,16}?\s+-p)(?:'[^']{1,256}'|"[^"]{1,256}"|[^'"\s]{1,256})/gi;
/** `Authorization: Basic <b64>` and `Authorization: token x` (`Bearer` is covered by SECRET_SPACE). */
const SECRET_AUTH_HEADER = /(\bAuthorization\s{0,64}:\s{0,64}(?:Basic|token)\s{1,64})[^'"\s]{1,2048}/gi;
/** `--user user:pass` (any command) and `curl ... -u user:pass`: only the password part is masked.
 * `-u` means user/uid on many other tools, so it is recognised only after a `curl` command word. */
const SECRET_USER_FLAG = /((?<![\w-])--user(?:\s{1,64}|=))(['"]?)([^'"\s:]{1,256}):[^'"\s]{1,256}\2/gi;
const SECRET_CURL_U_FLAG =
  /((?<![\w-])curl(?:\s+(?!curl\b)[^\s|;&]{1,256}){0,16}?\s+-u\s{0,64})(['"]?)([^'"\s:]{1,256}):[^'"\s]{1,256}\2/gi;
/** A quoted `KEY="a b"` / `"key": 'a b'` value is masked up to its closing quote of the same kind, so
 * spaces inside it do not end the match early. Runs before SECRET_KV. The keyword tail excludes
 * `_hint` (`"password_hint":"my first pet"` is prose, not a credential). */
const SECRET_KV_QUOTED =
  /\b((?:[A-Za-z][A-Za-z0-9]*_){0,8}?(?:password|passwd|api[_-]?key|secret|token|access[_-]?key)(?:_(?!hint\b)[A-Za-z0-9]+){0,8})(['"]?\s*[=:]\s*)(['"])[^'"]{1,512}\3/gi;
/** Quoted `--user "u:p w"` and `curl -u 'u:p w'`: only the password part is masked, up to the closing
 * quote. The unquoted forms below handle values without spaces. */
const SECRET_USER_FLAG_QUOTED = /((?<![\w-])--user(?:\s{1,64}|=))(['"])([^'"\s:]{1,256}):[^'"]{1,512}\2/gi;
const SECRET_CURL_U_FLAG_QUOTED =
  /((?<![\w-])curl(?:\s+(?!curl\b)[^\s|;&]{1,256}){0,16}?\s+-u\s{0,64})(['"])([^'"\s:]{1,256}):[^'"]{1,512}\2/gi;
/** Client password environment variables whose names carry no keyword SECRET_KV could match. */
const SECRET_CLIENT_ENV = /((?<![\w-])(?:PGPASSWORD|MYSQL_PWD)=)(?:(['"])[^'"]{1,512}\2|[^\s'"]{1,512})/g;
const SECRET_PASSWORD_FLAG = /(--?(?:password|passwd))(\s{1,64}|=)(['"]?)[^'"\s]+\3/gi;
const MAX_DETAIL_CHARS = 300;
/** `reason` must keep its trailing `Remedy:` clause, so it has a separate, larger cap than `detail`. */
const MAX_REASON_CHARS = 2000;
// Invariant: every regex pass sees at most this many chars, so redaction cost is O(1) in the input
// size, and no character past the window is ever emitted. The window does not keep a straddling
// secret out of the output on its own: each mask can be shorter than the value it replaces, so the
// final cap slice (MAX_DETAIL_CHARS or MAX_REASON_CHARS) can reach text near the window edge. A
// value cut by the edge is still masked when the part left inside the window meets its pattern's
// minimum length; a shorter cut fragment (e.g. under 4 chars for SECRET_KV) can be emitted unmasked.
const REDACT_WINDOW_CHARS = Math.max(MAX_DETAIL_CHARS * 8, MAX_REASON_CHARS);

/** Shared by the quoted and unquoted `--user` / `curl -u` passes: keeps the user, masks the password. */
const maskUserPassword = (_match, head, quote, user) => `${head}${quote}${user}:***${quote}`;

const redactTo = (max) => (text) =>
  String(text === undefined || text === null ? '' : text)
    .slice(0, REDACT_WINDOW_CHARS)
    .replace(SECRET_PASSWORD_QUOTED, (_match, flag, joiner, quote) => `${flag}${joiner}${quote}***${quote}`)
    .replace(SECRET_KV_QUOTED, (_match, key, separator, quote) => `${key}${separator}${quote}***${quote}`)
    .replace(SECRET_CLIENT_ENV, (_match, head, quote = '') => `${head}${quote}***${quote}`)
    .replace(SECRET_KV, (_match, key, separator, quote) => `${key}${separator}${quote}***${quote}`)
    .replace(SECRET_SPACE, (_match, flag, quote) => `${flag} ${quote}***${quote}`)
    .replace(SECRET_PASSWORD_FLAG, (_match, flag, joiner, quote) => `${flag}${joiner}${quote}***${quote}`)
    .replace(SECRET_GITHUB_TOKEN, (_match, prefix) => `${prefix}***`)
    .replace(SECRET_AWS_KEY, (_match, prefix) => `${prefix}***`)
    .replace(SECRET_MYSQL_GLUED_P, (_match, head) => `${head}***`)
    .replace(SECRET_AUTH_HEADER, (_match, head) => `${head}***`)
    .replace(SECRET_USER_FLAG_QUOTED, maskUserPassword)
    .replace(SECRET_CURL_U_FLAG_QUOTED, maskUserPassword)
    .replace(SECRET_USER_FLAG, maskUserPassword)
    .replace(SECRET_CURL_U_FLAG, maskUserPassword)
    .replace(SECRET_URL_USERINFO, (_match, scheme, user) => `${scheme}${user}:***@`)
    .slice(0, max);

const redact = redactTo(MAX_DETAIL_CHARS);
const redactReason = redactTo(MAX_REASON_CHARS);

/** `cwd` defaults to `process.cwd()` at every call site below rather than here, because the right
 * default is "the hook process's own cwd" ONLY when nothing better is known — and the PreToolUse
 * payload's own `cwd` field (the tool call's actual working directory) is better when present.
 * The hook process's `process.cwd()` reflects wherever the harness happened to spawn the hook
 * subprocess from, which is not necessarily where the tool call is targeting: a worker operating
 * in a linked worktree can still have its hook subprocess spawned with the main clone as cwd,
 * which used to make every one of that worker's own worktree writes look "outside" (#507,
 * F-00087). Callers resolve `input.cwd || process.cwd()` once in `main()` and thread it through. */
const git = (args, cwd) =>
  execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], cwd }).trim();

/** Worktree root of `cwd` (see the `git` docstring above for why `cwd` — not always
 * `process.cwd()` — is the right resolution point), or null outside a git context. */
const worktreeRoot = (cwd = process.cwd()) => {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd);
  } catch {
    return null;
  }
};

/** Main clone root, resolved from `cwd`. `--git-common-dir` points at the shared .git even from a
 * linked worktree, so every worker's events land in the one directory the orchestrator polls.
 *
 * Routine-vs-anomalous discrimination on failure mirrors `allWorktreeRoots` below exactly — see
 * that function's own docstring for why git's `fatal()` bucket collapses "no repository here"
 * and "a repository is here but broken" into the identical exit code and message, and why
 * `hasGitMarkerInAncestry` (not the failing call itself) is the only fact that can tell them
 * apart. Absent → routine, return `null`; present → anomalous, propagate the original error so
 * callers fail closed instead of silently dropping what depends on this root. */
const mainCloneRoot = (cwd = process.cwd()) => {
  let clone;
  try {
    clone = path.dirname(path.resolve(cwd, git(['rev-parse', '--git-common-dir'], cwd)));
  } catch (error) {
    if (!hasGitMarkerInAncestry(cwd)) return null;
    throw error;
  }
  // A `.git` pointer a worker forged inside its own worktree names a main clone it controls, whose
  // `.blackhole/config.json` and `.claude/settings*.json` would then be read as the campaign's.
  // The real main clone is never strictly inside the worktree that points at it.
  const top = nearestGitRoot(cwd);
  if (top && resolveExistingAncestor(clone) !== resolveExistingAncestor(top) && isUnderRoot(clone, top)) {
    throw new Error(`main clone ${clone} resolves inside the worktree ${top}: refusing a forged .git pointer`);
  }
  return clone;
};

/** Memo of one process's anchor lookups: a hook call is one short process and about six sites ask. */
const anchorCache = new Map();
const memoByEnvironment = (kind, cwd, compute) => {
  const key = [kind, cwd, process.env.CLAUDE_PROJECT_DIR, process.env.BLACKHOLE_SCRATCHPAD_DIR].join('\0');
  if (!anchorCache.has(key)) {
    let value = null;
    try {
      value = compute();
    } catch {
      value = null;
    }
    anchorCache.set(key, value);
  }
  return anchorCache.get(key);
};

/** The main clone of the harness project dir when that dir is one `isHarnessProjectDir` accepts,
 * else `null`. It does not look at `cwd`'s own git metadata, so it also names the real campaign
 * clone while `cwd` sits in a forged one. */
const harnessProjectClone = (cwd = process.cwd()) =>
  memoByEnvironment('project', cwd, () => {
    const project = process.env.CLAUDE_PROJECT_DIR;
    if (typeof project !== 'string' || !isHarnessProjectDir(project, cwd, [process.env.BLACKHOLE_SCRATCHPAD_DIR])) return null;
    const clone = mainCloneRoot(project);
    return clone ? resolveExistingAncestor(clone) : null;
  });

/** One stderr line per process when no anchor can be established, so a fallback never goes unseen. */
let anchorWarned = false;
const warnAnchorUnavailable = () => {
  if (anchorWarned) return;
  anchorWarned = true;
  const project = process.env.CLAUDE_PROJECT_DIR;
  const why = typeof project === 'string' && project.length > 0 ? 'CLAUDE_PROJECT_DIR is not a usable main clone' : 'CLAUDE_PROJECT_DIR is unset';
  console.error(
    `[blackhole-hook] main-clone-anchor-unavailable: ${why}; reading the campaign config from the git metadata in cwd, so a forged clone is not contained`,
  );
};

/** The registered campaign linked worktree a repository `cwd` sits in is nested inside, or `null`.
 * With no project dir to anchor on, this is the one signal that tells a repository a worker created
 * inside its worktree from the campaign clone: the clone is never inside a linked worktree, and the
 * enclosing worktree must pass `campaignWorktreeRoot` (back-linked from both ends, not too broad, a
 * repo with a campaign config), which a worker cannot forge from inside the tree it writes. Only
 * meaningful when `cwd`'s own clone and toplevel coincide (the main-clone shape a nested repo has).
 * Never throws; a filesystem or git failure reads as "not nested". Memoised per environment. */
const enclosingCampaignWorktree = (cwd = process.cwd()) =>
  memoByEnvironment('enclosing', cwd, () => {
    const top = nearestGitRoot(cwd);
    const clone = top && mainCloneRoot(cwd);
    if (!clone || resolveExistingAncestor(clone) !== resolveExistingAncestor(top)) return null;
    let dir = path.dirname(resolveExistingAncestor(top));
    for (let parent = path.dirname(dir); ; dir = parent, parent = path.dirname(dir)) {
      if (readPointerFile(path.join(dir, '.git')) !== null) {
        const worktree = campaignWorktreeRoot(dir);
        if (worktree) return worktree;
      }
      if (parent === dir) return null;
    }
  });

/** The campaign main clone, anchored to a source the worker cannot write: the harness project dir
 * (`CLAUDE_PROJECT_DIR`, set by the harness for every hook call). `mainCloneRoot(cwd)` derives the
 * clone from git metadata inside a tree the worker writes (its worktree's `.git` pointer, a planted
 * `.git`, a nested repository), so the clone it names is only a claim. Two cases:
 * - the project dir is accepted by `isHarnessProjectDir` and names a main clone (the anchor is
 *   established): the clone `cwd` names is trusted only when it is that same clone. A disagreement is
 *   a forged clone, and the result is `null`: the campaign config, the state dir, the configured
 *   scratchpad and the sibling-plugin defer then grant nothing, and the payload `scratchpad_dir`,
 *   `BLACKHOLE_SCRATCHPAD_DIR` and the user settings keep working.
 * - no anchor can be established (unset, relative, missing, a linked worktree, inside the worker's
 *   worktree or scratchpad, not a git clone): the pre-anchor decision holds, `mainCloneRoot(cwd)`,
 *   plus one stderr warning per process. A harness that does not hand a natively dispatched worker's
 *   hook a main-clone project dir must not lose every worker write, so this never adds a deny.
 * It never throws (a throw reaching `recordEvent` would turn a refusal into an allow). Memoised per
 * `(cwd, CLAUDE_PROJECT_DIR, BLACKHOLE_SCRATCHPAD_DIR)`. */
const anchoredMainClone = (cwd = process.cwd()) =>
  memoByEnvironment('anchored', cwd, () => {
    const fromProject = harnessProjectClone(cwd);
    if (!fromProject) {
      warnAnchorUnavailable();
      // A repository nested in a registered campaign worktree is a worker's own, never the campaign
      // clone, so what it claims grants nothing (the Bash guard's variant D, with no project dir).
      return enclosingCampaignWorktree(cwd) ? null : mainCloneRoot(cwd);
    }
    const fromCwd = mainCloneRoot(cwd);
    return fromCwd && resolveExistingAncestor(fromCwd) === fromProject ? fromProject : null;
  });

/** Realpath of the nearest existing ancestor of `p` — `p` itself if it already exists (following
 * it through if it is itself a symlink), otherwise the nearest parent that does. Containment has
 * to be decided on resolved paths (temp dirs and home directories are routinely symlinks), and
 * that includes the leaf: `ln -s ~/.ssh/authorized_keys ./notes.txt` then a Write to `notes.txt`
 * must resolve through that symlink too, not just through a symlinked ancestor directory — passing
 * the target path itself (not its dirname) is what makes `fs.realpathSync` see it. Shared by
 * `validate-file-changes.js`'s leaf-containment check and `allWorktreeRoots`'s root filter below
 * (#510) — one resolution path for both sides of every containment comparison (`V-INT-02`). */
const resolveExistingAncestor = (p) => {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync(resolved);
  } catch {
    // Existence is monotone along a path's prefixes, so the deepest resolvable prefix is found by
    // binary search: O(log depth) realpath calls of O(length) each. Walking every ancestor,
    // bottom-up or top-down, is quadratic in the depth (#1222).
    const { root } = path.parse(resolved);
    const segments = resolved.slice(root.length).split(path.sep).filter(Boolean);
    const prefix = (k) => root + segments.slice(0, k).join(path.sep);
    const tryRealpath = (k) => {
      try {
        return fs.realpathSync(prefix(k));
      } catch {
        return null;
      }
    };
    let existing = root;
    let lo = 1;
    let hi = segments.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const real = tryRealpath(mid);
      if (real === null) {
        hi = mid - 1;
      } else {
        existing = real;
        lo = mid + 1;
      }
    }
    return existing;
  }
};

/** True when a `.git` entry (directory for an ordinary clone, or a `gitdir:` file for a linked
 * worktree/submodule) exists anywhere in `cwd`'s ancestor chain — a fact read straight off the
 * filesystem, independent of anything git itself reports. `allWorktreeRoots` below trusts this,
 * not git's exit code or stderr text, to tell "no repository here at all" apart from "a
 * repository is here and something about reading it is broken" (issue #864): git's own fatal()
 * bucket produces the identical exit code and message for both, so no amount of enumerating
 * exit codes or message substrings can recover a distinction git itself never made on that path.
 * A positive, independently-computed fact is the only thing that can. */
/** The nearest ancestor of `cwd` (or `cwd` itself) holding a `.git` entry, or null. */
const nearestGitRoot = (cwd) => {
  let current = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

const hasGitMarkerInAncestry = (cwd) => nearestGitRoot(cwd) !== null;

/** True when `candidate` resolves inside (or as) `root`, both realpath'd through
 * `resolveExistingAncestor` first — the comparison must run on resolved paths on both sides, since
 * either one may traverse a symlink (`/tmp` itself is a symlink on some systems). */
const isUnderRoot = (candidate, root) => {
  const realCandidate = resolveExistingAncestor(candidate);
  const realRoot = resolveExistingAncestor(root);
  return realCandidate === realRoot || realCandidate.startsWith(realRoot + path.sep);
};

/** `scratchpad_dir` values broad enough to defeat the worktree-root filter below would silently
 * re-open the exact bypass the filter exists to close (#510/F-00088): `/`, the user's home
 * directory, or a bare system temp root (`/tmp`, `/var/tmp`, `os.tmpdir()`) all sit above
 * directories a worker does not control, so accepting one of them as `scratchpad_dir` is no
 * narrower than accepting every registered worktree unconditionally. Requires an absolute path
 * with at least two non-empty segments, distinct from $HOME and from the known bare temp roots.
 * `path.resolve` does not follow symlinks, so this set is built with `resolveExistingAncestor`
 * instead — a bare temp root reached only through a symlinked ancestor (darwin's `/var` →
 * `/private/var`, or any workstation-local alias) must still classify as broad. */
const BARE_TEMP_DIRS = new Set(['/tmp', '/var/tmp', os.tmpdir()].map((p) => resolveExistingAncestor(p)));

/** Breadth of one already-resolved reading of a candidate root: too few segments to name anything
 * a worker controls, a bare temp root, or $HOME (compared both lexically and through realpath,
 * since a home directory is itself routinely a symlink). */
const isTooBroadRoot = (candidate) => {
  if (candidate.split(path.sep).filter(Boolean).length < 2) return true;
  if (BARE_TEMP_DIRS.has(candidate)) return true;
  const home = process.env.HOME;
  return Boolean(home) && (candidate === path.resolve(home) || candidate === resolveExistingAncestor(home));
};

/** Breadth is judged on BOTH readings of `value` — the lexically resolved path and the
 * realpath-resolved one — and the value is accepted only when neither is broad. Containment
 * compares roots through `resolveExistingAncestor` (`isUnderRoot`), so a check reading only the
 * literal value decides breadth for a different directory than the one the root actually spans:
 * a narrow-looking `<scratch>/link` symlinked at $HOME passes lexically and then admits the whole
 * home subtree. Judging both readings keeps the breadth check and the containment comparison
 * talking about the same directory, on every leg that reaches this predicate. */
const isAcceptableScratchpadDir = (value) => {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) return false;
  return !isTooBroadRoot(path.resolve(value)) && !isTooBroadRoot(resolveExistingAncestor(value));
};

/** A scratchpad directory is admitted as a containment root only when it also exists on disk.
 * Containment comparisons run through `resolveExistingAncestor`, which walks up to the deepest
 * *existing* ancestor — so a stale or never-created value would be compared as (and therefore
 * trust every sibling under) that ancestor instead of itself, re-widening the allow-list
 * `isAcceptableScratchpadDir` exists to narrow. Applied to both scratchpad legs below — the
 * configured `scratchpad_dir` and the `BLACKHOLE_SCRATCHPAD_DIR` override — so neither can drift
 * into trusting a parent directory it never named. */
const isExistingDirectory = (value) => {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
};

/** Reads and validates `scratchpad_dir` from `<mainClone>/.blackhole/config.json`. Callers pass
 * `anchoredMainClone(cwd)`, never `mainCloneRoot(cwd)`: with an established anchor, a config in a
 * clone that disagrees with it is not a trust source. Returns null —
 * never throws, never falls back to an unvalidated value — on every degradation: file absent,
 * unreadable, malformed JSON, key absent, or a value `isAcceptableScratchpadDir` rejects. Callers
 * treat null exactly like "no configured scratchpad" and narrow to main-clone-only containment;
 * failing OPEN here (trusting an unreadable or overly-broad config) would silently re-widen the
 * allow-list #510/F-00088 exists to narrow. */
const readScratchpadDir = (mainClone) => {
  if (!mainClone) return null;
  let value;
  try {
    const raw = fs.readFileSync(path.join(mainClone, '.blackhole', 'config.json'), 'utf-8');
    value = JSON.parse(raw).scratchpad_dir;
  } catch {
    return null;
  }
  if (value === undefined) return null;
  if (!isAcceptableScratchpadDir(value)) {
    console.error(
      `[blackhole-hook] .blackhole/config.json scratchpad_dir ${JSON.stringify(value)} is too broad to trust for worktree containment — falling back to main-clone-only`,
    );
    return null;
  }
  return value;
};

/** Splits `git worktree list --porcelain` output into worktree paths. With `-z` every field
 * ends in NUL, so a path containing newlines cannot forge a second record. Git before 2.36 has no
 * `-z`; its line-delimited form can carry a forged record, which is still safe here because every
 * path outside the main clone must pass `isBackLinkedWorktree` (which also refuses any path
 * containing a newline). */
const parseWorktreeListing = (listing, nulDelimited) =>
  listing
    .split(nulDelimited ? '\0' : '\n')
    .filter((field) => field.startsWith('worktree '))
    .map((field) => field.slice('worktree '.length));

/** `git worktree list --porcelain`, NUL-delimited when this git supports `-z` (2.36+), otherwise
 * line-delimited. A git that rejects `-z` must not make every Write/Edit fail closed. When the
 * plain form fails too, the `-z` call's error is the one rethrown. */
const listWorktrees = (cwd) => {
  try {
    return { listing: git(['worktree', 'list', '--porcelain', '-z'], cwd), nulDelimited: true };
  } catch (error) {
    try {
      return { listing: git(['worktree', 'list', '--porcelain'], cwd), nulDelimited: false };
    } catch {
      throw error;
    }
  }
};

/** Reads a one-line pointer file (`<worktree>/.git` or `worktrees/<name>/gitdir`), or null when
 * it is absent, not a regular file, or not a single line. */
const readPointerFile = (file) => {
  try {
    if (!fs.lstatSync(file).isFile()) return null;
    const value = fs.readFileSync(file, 'utf-8').replace(/\r?\n$/, '');
    return value.length > 0 && !value.includes('\n') ? value : null;
  } catch {
    return null;
  }
};

const realpathOrNull = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};

/** True when `worktreePath` is a real linked worktree of the repository whose common dir is
 * `commonDir`, checked from both ends. A `worktrees/<name>/gitdir` entry is only a claim anyone
 * who can write under `.git` can make, so git listing a path proves nothing on its own:
 *  - the path must resolve to itself (no symlink swapped in after registration),
 *  - `<path>/.git` must be a gitdir file naming `<commonDir>/worktrees/<name>`, and
 *  - that directory's own `gitdir` file must name `<path>/.git` back.
 * A foreign repository listed through a forged entry has a `.git` directory, not a file pointing
 * here, so it fails; a deleted worktree has no `.git` file at all, so it fails too. */
const isBackLinkedWorktree = (worktreePath, commonDir) => {
  if (worktreePath.includes('\n') || realpathOrNull(worktreePath) !== path.resolve(worktreePath)) return false;
  const dotGit = path.join(worktreePath, '.git');
  const pointer = readPointerFile(dotGit);
  if (!pointer || !pointer.startsWith('gitdir: ')) return false;
  const adminDir = realpathOrNull(path.resolve(worktreePath, pointer.slice('gitdir: '.length)));
  const worktreesDir = realpathOrNull(path.join(commonDir, 'worktrees'));
  if (!adminDir || !worktreesDir || path.dirname(adminDir) !== worktreesDir) return false;
  const backPointer = readPointerFile(path.join(adminDir, 'gitdir'));
  return Boolean(backPointer) && realpathOrNull(path.resolve(adminDir, backPointer)) === realpathOrNull(dotGit);
};

/** A registered linked worktree outside the main clone is a containment root when it is
 * back-linked to this repository (`isBackLinkedWorktree`) and not too broad to bound anything
 * (`isAcceptableScratchpadDir`: never `/`, `$HOME` or a bare temp root) — #1226. */
const isTrustedLinkedWorktree = (worktreePath, commonDir) =>
  isBackLinkedWorktree(worktreePath, commonDir) && isAcceptableScratchpadDir(worktreePath);

/** Worktree roots this repo family's containment check trusts, resolved from `cwd` for the same
 * reason `worktreeRoot`/`mainCloneRoot` are (#507): every worktree `git worktree list
 * --porcelain` reports — the main clone, the worktrees nested under it, and every registered
 * linked worktree wherever it lives (#1226: a campaign worker's `/tmp/campaign/wt-<N>` sits under
 * neither the main clone nor a configured `scratchpad_dir`, and refusing it pushed the worker
 * onto an unguarded Bash heredoc). A linked worktree outside the main clone is admitted only via
 * `isTrustedLinkedWorktree`: it must be back-linked to this repository from both ends (a forged
 * `worktrees/<name>/gitdir`, a symlink swapped in, or a deleted directory all fail) and pass the
 * `isAcceptableScratchpadDir` breadth check. The listing is read with `-z` where git supports it
 * (see `listWorktrees`), so a newline in a worktree path cannot forge a record. This replaces #510's
 * narrowing to worktrees nested under the main clone or `scratchpad_dir`: that filter assumed
 * `git worktree add` was the only way to reach a new directory, but a worker whose cwd is the
 * main clone can already write to that directory through Bash, so it bounded nothing while
 * refusing real campaign worktrees — **plus the validated `scratchpad_dir` itself**, so a target
 * placed directly at the scratchpad root (a probe script, a shared coordination file) is in-bounds
 * rather than denied for sitting in none of the `wt-*` subdirectories: the directory already
 * passed the same `isAcceptableScratchpadDir` breadth check, and `isExistingDirectory` keeps a
 * never-created value from collapsing onto its parent. Being a member of this set, the scratchpad
 * root also satisfies
 * `readAssignedWorktreeRoot`'s membership test, so `BLACKHOLE_ASSIGNED_WORKTREE` may now name it
 * — an assignment that spans every worktree beneath it rather than narrowing to one. That grants
 * no permission the unset case does not already grant (an unrecognized value falls open to this
 * same full root set), but it does forfeit the single-worktree narrowing the override exists to
 * provide, so the orchestrator must keep assigning a specific worktree, never the scratchpad root
 * — **plus, unconditionally, `cwd`'s own resolved git toplevel**
 * (#729): a non-campaign interactive session sitting in any worktree of this repo family must be
 * able to Write/Edit within its own worktree even when that worktree is registered neither under
 * the main clone nor under `scratchpad_dir` (e.g. a worktree created via a bare `git worktree
 * add <elsewhere>`). This is no broader than the trust the no-git-context fallback in
 * `validate-file-changes.js` already extends to `cwd` unconditionally (#512); it matters for a
 * cwd worktree that `isTrustedLinkedWorktree` rejects (e.g. one too broad to admit on its own
 * for a session sitting elsewhere). Also admits `BLACKHOLE_SCRATCHPAD_DIR` (#729) — an
 * opt-in override for the Claude Code harness's own per-session scratchpad directory, which is
 * never a git worktree and so never appears in `git worktree list` output at all — validated
 * through the same `isAcceptableScratchpadDir` breadth check `scratchpad_dir` already uses
 * (V-INT-02) and the same `isExistingDirectory` guard, read once per call, admitted only when
 * explicitly set, valid and existing (no silent auto-detection of the harness's
 * undocumented-internal `/tmp/claude-<uid>/...` shape). Mirrors
 * the `BLACKHOLE_HOOK_EVENT_DIR` / `BLACKHOLE_ASSIGNED_WORKTREE` env-var precedent. Null outside
 * a git context, mirroring the other two resolvers above; an empty (but non-null) array means
 * git resolved fine but no root passed the filter, which correctly denies rather than falling
 * open. `validate-file-changes.js`'s containment check treats a target as in-bounds when it
 * falls under ANY of the roots returned here.
 *
 * Throws — does not return null — when `git worktree list` fails and `hasGitMarkerInAncestry(cwd)`
 * finds no `.git` anywhere above `cwd` (issue #864). A prior version of this function tried to
 * make that same call by inspecting the failure itself — exit code 128, "not a git repository" in
 * the (discarded) stderr — but git's own `fatal()` bucket collapses "no repository exists here"
 * and "a repository exists but its `.git/HEAD` is missing, or `.git/config` is malformed, or the
 * revision it needs can't be resolved" into the identical exit code and message: `is_git_
 * directory()` treats an unreadable HEAD as disqualifying, so there is no substring or exit code
 * that distinguishes routine absence from real corruption, because git itself never made that
 * distinction on this path. No enumeration of failure shapes can fix that. The fix instead checks
 * a fact independent of the failing call: does a `.git` entry exist anywhere in `cwd`'s ancestor
 * chain? Absent → routine, nothing to bound, return null (fail-open to the #512 cwd-bound path
 * below). Present → git is broken over a repository that is actually there, which is exactly the
 * anomalous case callers must fail closed on, so the original error propagates untouched.
 * Callers distinguish: catch the throw and fail closed (`failClosed`), the same posture already
 * used for a malformed hook payload or a pattern-load failure in this module — an unreadable
 * containment state must never fall back to the permissive cwd-bound path that null triggers
 * below. */
const allWorktreeRoots = (cwd = process.cwd()) => {
  let listed;
  try {
    listed = listWorktrees(cwd);
  } catch (error) {
    if (!hasGitMarkerInAncestry(cwd)) return null;
    throw error;
  }
  const roots = parseWorktreeListing(listed.listing, listed.nulDelimited);
  if (roots.length === 0) return null;
  const mainClone = mainCloneRoot(cwd);
  if (!mainClone) return null;
  const commonDir = path.resolve(cwd, git(['rev-parse', '--git-common-dir'], cwd));
  const scratchpadDir = readScratchpadDir(anchoredMainClone(cwd));
  const filtered = roots.filter(
    (root) => isUnderRoot(root, mainClone) || isTrustedLinkedWorktree(root, commonDir),
  );
  const withScratchpad =
    scratchpadDir !== null && isExistingDirectory(scratchpadDir) ? [...filtered, scratchpadDir] : filtered;

  const cwdRoot = worktreeRoot(cwd);
  const withCwd =
    cwdRoot && !withScratchpad.some((root) => resolveExistingAncestor(root) === resolveExistingAncestor(cwdRoot))
      ? [...withScratchpad, cwdRoot]
      : withScratchpad;

  const envScratchpad = process.env.BLACKHOLE_SCRATCHPAD_DIR;
  if (
    typeof envScratchpad === 'string' &&
    envScratchpad.length > 0 &&
    isAcceptableScratchpadDir(envScratchpad) &&
    isExistingDirectory(envScratchpad)
  ) {
    return [...withCwd, envScratchpad];
  }
  return withCwd;
};

/** Captured once per process by `readHookInput` below and read back by `recordEvent`'s payload
 * construction — module-scoped rather than threaded as a parameter through every `denyAndRecord`/
 * `warnAndRecord` call site (there are nine across the two validators), which would touch every
 * one of them for two fields neither validator's own decision logic ever inspects. Each hook
 * script is a fresh `bun run` subprocess handling exactly one stdin payload, so there is no
 * cross-request leakage to guard against. `null` until `readHookInput` runs (or when it never
 * successfully parses stdin — `hook-input-parse-failure`), which is the correct "not captured"
 * state for that path. */
let lastAgentContext = { agent_id: null, agent_type: null };

/** Anthropic's own PreToolUse schema (issue #907 design note, verified against the Claude Code
 * binary): `agent_id`/`agent_type` are present only when the hook fires from within a subagent,
 * absent on the main thread, and both `.optional()` with no published stability guarantee. Only a
 * string is ever accepted — anything else (missing, wrong type) becomes `null`, never passed
 * through raw, so a malformed or absent field always reads as "not captured" rather than leaking
 * an unexpected shape into a durable, dashboard-rendered record. `agent_type` is an
 * operator-chosen/harness-chosen label, not a verified role — recorded for observability only;
 * nothing in this module branches on either field's value. `utils/campaign-scope.js` reads
 * `agent_type` separately to decide which guards apply (ADR-047). */
const captureAgentContext = (input) => {
  lastAgentContext = {
    agent_id: typeof input.agent_id === 'string' ? input.agent_id : null,
    agent_type: typeof input.agent_type === 'string' ? input.agent_type : null,
  };
};

/** Parses the hook-shaped JSON payload on stdin. Throws on malformed/unreadable input rather than
 * swallowing the failure into `{}` — an empty object reads as "no command, no file_path", which
 * both validators treat as a silent allow with zero record. That is exactly the failure mode this
 * gate exists to prevent, so callers wrap this the same way they wrap pattern-load failures: catch
 * and turn it into `failClosed`, never let it fall through to an allow. */
const readHookInput = () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf-8') || '{}');
  captureAgentContext(input);
  return input;
};

/** `BLACKHOLE_ASSIGNED_WORKTREE` narrows Write/Edit containment to a single assigned worktree
 * when set by the orchestrator at implementer spawn (#620). Unset, empty, unresolvable, or not a
 * registered member of `allWorktreeRoots(cwd)` falls through to the cwd-derived tier below
 * (`readCwdDerivedAssignedRoot`, #907) rather than straight to the `allWorktreeRoots` fallback —
 * that tier's own docstring explains why it exists and what it returns. Mirrors the
 * `BLACKHOLE_HOOK_EVENT_DIR` override shape from #604.
 * Propagates `allWorktreeRoots`'s throw on an anomalous (non-"not a git repository") git failure
 * rather than catching it — this function does not itself swallow anything; the caller (same
 * `failClosed` posture as every other call site below) decides how to react. */
const readAssignedWorktreeRoot = (cwd = process.cwd()) => {
  const raw = process.env.BLACKHOLE_ASSIGNED_WORKTREE;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const resolved = path.resolve(raw.trim());
    const familyRoots = allWorktreeRoots(cwd);
    if (!familyRoots) {
      console.error(
        `[blackhole-hook] BLACKHOLE_ASSIGNED_WORKTREE set but no git context — falling back to cwd-derived containment`,
      );
    } else {
      const realResolved = resolveExistingAncestor(resolved);
      const match = familyRoots.find((root) => resolveExistingAncestor(root) === realResolved);
      if (match) return realResolved;
      console.error(
        `[blackhole-hook] BLACKHOLE_ASSIGNED_WORKTREE ${JSON.stringify(resolved)} is not a registered family worktree — falling back to cwd-derived containment`,
      );
    }
  }
  return readCwdDerivedAssignedRoot(cwd);
};

/** The realpath of the worktree a campaign worker's `cwd` sits in, or null when `cwd` is outside a
 * worktree or is the campaign's own main clone (the orchestrator's, `planner`'s, `investigator`'s
 * and `hunter`'s case). That is a linked worktree, and also a repository other than the harness
 * project's clone (a nested or foreign repo): a worker there is never the orchestrator, and
 * without this a nested repo would switch the Bash write guard off. With no usable harness project
 * dir the main-clone case is null unless the repository is nested inside a registered campaign
 * linked worktree (`enclosingCampaignWorktree`), in which case that worktree is the root; a nested
 * repo elsewhere cannot be told from the campaign clone (the residual the sandbox direction closes).
 * Shared by `readCwdDerivedAssignedRoot` and the Bash write guard's deferral fallback, so both
 * agree on what counts as a worker worktree. */
const readLinkedWorktreeRoot = (cwd) => {
  const cwdWorktree = worktreeRoot(cwd);
  if (!cwdWorktree) return null;
  const realCwdWorktree = resolveExistingAncestor(cwdWorktree);
  const mainClone = mainCloneRoot(cwd);
  if (!mainClone) return null;
  if (resolveExistingAncestor(mainClone) !== realCwdWorktree) return realCwdWorktree;
  const project = harnessProjectClone(cwd);
  if (project) return project !== realCwdWorktree ? realCwdWorktree : null;
  return enclosingCampaignWorktree(cwd);
};

/** cwd-derived containment tier (#907) — the channel `BLACKHOLE_ASSIGNED_WORKTREE` above actually
 * reaches under Pattern C (`orchestrator-dispatch.md`): a worker dispatched via the native
 * `Agent`/`Workflow` tool never receives an exported env var, confirmed by a zero-occurrence
 * `outside-assigned-worktree` event corpus. `input.cwd` is harness-supplied on the PreToolUse
 * payload rather than a field a worker's own tool-call arguments set — the same trust class
 * `validate-file-changes.js` already extends to it for the #507 leaf-containment fix, not a fresh
 * trust assumption. When `cwd` resolves to a linked (non-main) worktree, that worktree becomes
 * the sole assigned root — no declaration needed. A `cwd` resolving to the main clone itself (the
 * orchestrator's/`planner`'s/`investigator`'s/`hunter`'s legitimate case) returns null unchanged,
 * falling through to today's `allWorktreeRoots(cwd)` fallback exactly as before this tier
 * existed.
 *
 * The validated scratchpad root(s) — `<mainClone>/.blackhole/config.json`'s `scratchpad_dir` and
 * the opt-in `BLACKHOLE_SCRATCHPAD_DIR` override — are never dropped when this tier narrows
 * (#510/#729's invariant), the same two sources `allWorktreeRoots` itself unions in. A worker's
 * worktree is, by this campaign's own convention, always nested directly under the configured
 * `scratchpad_dir` (`wt-<issue>` under one scratchpad parent), so the common case collapses
 * cleanly to a single broader root: when the resolved worktree nests under a validated
 * scratchpad root, that broader root — not the narrower worktree — is returned as the sole
 * assigned root, since it already spans the worktree and is the one place a worker's
 * cross-worktree coordination writes (e.g. a shared file placed directly at the scratchpad root)
 * are expected to land. `BLACKHOLE_SCRATCHPAD_DIR` is documented as the harness's own
 * per-session scratchpad — a directory that is NOT expected to nest the worktree at all, so no
 * single string can represent "the worktree" and "the disjoint scratchpad" simultaneously; when
 * a scratchpad candidate is present (validated or not) but does not nest the worktree, this tier
 * defers entirely (returns null) rather than silently dropping it. The two callers then differ:
 * `validate-file-changes.js` falls back to `allWorktreeRoots(cwd)`, which already unions every
 * scratchpad source correctly, including rejecting an invalid one (reuse, not re-derivation,
 * `V-INT-02`); the Bash write guard keeps the linked worktree (`readLinkedWorktreeRoot`) as its
 * assigned root and admits the disjoint scratchpad through `trustedWriteRoots`. */
const readCwdDerivedAssignedRoot = (cwd) => {
  const realCwdWorktree = readLinkedWorktreeRoot(cwd);
  if (!realCwdWorktree) return null;

  const configScratchpad = readScratchpadDir(anchoredMainClone(cwd));
  const envScratchpad = process.env.BLACKHOLE_SCRATCHPAD_DIR;
  const envScratchpadDeclared = typeof envScratchpad === 'string' && envScratchpad.length > 0;
  const envScratchpadValid = envScratchpadDeclared && isAcceptableScratchpadDir(envScratchpad);
  const candidates = [configScratchpad, envScratchpadValid ? envScratchpad : null].filter(
    (candidate) => candidate !== null && isExistingDirectory(candidate),
  );

  const nesting = candidates.find((candidate) => isUnderRoot(realCwdWorktree, candidate));
  if (nesting) return resolveExistingAncestor(nesting);
  if (candidates.length > 0 || envScratchpadDeclared) return null;
  return realCwdWorktree;
};

/** `BLACKHOLE_HOOK_EVENT_DIR` makes the durable-record sink explicit and inspectable instead of
 * solely inferred from `cwd`'s git resolution (#604): when set, it is the sink outright and
 * `mainCloneRoot` is never consulted, so no git context is required at all. Unset (the harness's
 * normal path), behavior is byte-for-byte the pre-existing `mainCloneRoot(cwd)` resolution below
 * on every non-throwing path.
 *
 * `mainCloneRoot(cwd)` now throws instead of returning `null` on an anomalous (not merely
 * "outside any repository") git failure. This function's own `try/catch` around that call is
 * load-bearing, not incidental: `recordEvent` is called from `denyAndRecord` *before* `emit()`
 * runs, and `denyAndRecord` is itself the recovery path `failClosed` calls on a crash — so a
 * throw escaping here would propagate out of `denyAndRecord`, be caught by the validator's
 * top-level catch-all, get routed back through `failClosed` → `denyAndRecord` → this function a
 * second time, throw again with nothing left to catch it, and exit the process with a non-0/2
 * code that the harness wrapper (`claude-native-settings.ts`) treats as "validator could not
 * run" and converts to an ALLOW — turning an intended refusal into the exact bypass this module
 * exists to prevent. Recording must stay best-effort; the decision must never be (see the module
 * docstring at the top of this file).
 *
 * On the anomalous branch, before giving up, this falls back to `process.env.CLAUDE_PROJECT_DIR`
 * (accepted only when absolute and an existing directory — `isExistingDirectory` above, not
 * re-derived) as a git-independent sink: the same directory the generated hook wrapper
 * (`claude-native-settings.ts`) already writes its own `hook-exec-failure` records to, so Triage
 * already polls it. Deliberately does NOT fire on the routine "no git context" branch below —
 * behavior outside a repository stays byte-identical to today. Whether or not that fallback is
 * available (or, if available, actually succeeds at the write below), the anomalous branch always
 * emits one stderr line naming the underlying git error and which sink tier was used
 * (`fallback` or `dropped`) — a fallback write that succeeds silently would be exactly as
 * unobservable to an operator as today's silent drop, which defeats the point of fixing this. */
const recordEvent = (event) => {
  const cwd = event.cwd || process.cwd();
  const override = process.env.BLACKHOLE_HOOK_EVENT_DIR;
  let dir;
  // Set only on the ordinary main-clone-resolution branch below — never on the
  // `BLACKHOLE_HOOK_EVENT_DIR` override branch (an explicit sink is always a test/inspection
  // target, never the interactive session rotation exists for) and never on the anomalous
  // `CLAUDE_PROJECT_DIR` fallback branch (a git-broken repository is not the ordinary
  // "no campaign here" case this gate targets). Rotation runs only when this is non-null.
  let rotationRoot = null;
  if (override) {
    dir = override;
  } else {
    let destRoot;
    let anchored;
    let anomalous;
    try {
      anchored = anchoredMainClone(cwd);
      destRoot = harnessProjectClone(cwd) || mainCloneRoot(cwd);
    } catch (error) {
      anomalous = error;
    }
    if (anomalous) {
      const projectDir = process.env.CLAUDE_PROJECT_DIR;
      const fallbackAvailable =
        typeof projectDir === 'string' && path.isAbsolute(projectDir) && isExistingDirectory(projectDir);
      console.error(
        `[blackhole-hook] anomalous git failure resolving main-clone root — ${anomalous.message} (sink: ${
          fallbackAvailable ? `fallback → ${projectDir}` : 'dropped'
        })`,
      );
      if (!fallbackAvailable) return;
      dir = path.join(projectDir, '.blackhole', 'hook-events');
    } else if (!destRoot) {
      console.error(`[blackhole-hook] no git context — ${event.tier} event not recorded (${event.pattern_id})`);
      return;
    } else {
      dir = path.join(destRoot, '.blackhole', 'hook-events');
      rotationRoot = anchored;
    }
  }
  const payload = {
    version: 2,
    recorded_at: new Date().toISOString(),
    hook: event.hook,
    tool: event.tool,
    decision: event.decision,
    tier: event.tier,
    pattern_id: event.pattern_id,
    reason: redactReason(event.reason),
    worktree: worktreeRoot(cwd),
    detail: redact(event.detail),
    agent_id: lastAgentContext.agent_id,
    agent_type: lastAgentContext.agent_type,
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const unique = `${payload.recorded_at.replace(/[:.]/g, '-')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(path.join(dir, `${unique}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  } catch (err) {
    console.error(`[blackhole-hook] could not record ${event.tier} event (${event.pattern_id}): ${err.message}`);
    return;
  }
  // Best-effort, same posture as the write above: a rotation failure of any kind is logged and
  // dropped, never allowed to escape recordEvent and alter the caller's allow/deny decision.
  if (rotationRoot) {
    try {
      if (hasNoCampaignConfig(rotationRoot)) rotateHookEvents(dir);
    } catch (err) {
      console.error(`[blackhole-hook] hook-event rotation failed: ${err.message}`);
    }
  }
};

const emit = (payload, code) => {
  if (payload) console.log(JSON.stringify(payload));
  process.exit(code);
};

/** BLOCK tier — record the refusal, then refuse. Exit 2 is the harness's blocking-error signal for
 * PreToolUse: it feeds STDERR (not stdout) back to the calling model, so the reason is written
 * there — a bare exit 2 with nothing on stderr reads as an unexplained block, and an unattended
 * worker with no reason to learn from just retries the same call. The stdout JSON also carries the
 * decision under `hookSpecificOutput.permissionDecision`, the field the harness's structured
 * output contract reads; a top-level `decision` key is not that contract. */
const denyAndRecord = (event) => {
  recordEvent({ ...event, decision: 'deny', tier: 'block' });
  const reason = `blackhole PreToolUse: denied — ${event.reason} [${event.pattern_id}]`;
  console.error(reason);
  emit(
    {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    },
    2,
  );
};

/** WARN tier — recorded for review (the orchestrator ingests it as V-HOOK-02), then exits 0 with
 * no output, so the call goes through the session's normal permission flow. A warn is therefore
 * log-only: its reason (including any `Remedy:` clause) is never shown to the agent. Emitting a
 * `permissionDecision: 'allow'` here would both print into the session and auto-approve a call
 * this hook has flagged as risky; the record under `.blackhole/hook-events/` is the review
 * channel. */
const warnAndRecord = (event) => {
  recordEvent({ ...event, decision: 'allow', tier: 'warn' });
  process.exit(0);
};

/** No pattern matched — allow with no output and no record. */
const allowSilently = () => process.exit(0);

/** Pattern data or hook input could not be loaded, so safe and dangerous are indistinguishable:
 * refuse. Still recorded, because a silent refusal is the failure mode this gate exists to
 * prevent. Same helper for both failure sites — pattern load (main() below) and stdin parse
 * (readHookInput's caller, above) — distinguished only by `patternId`/`label` so the record and
 * the stderr message say which one actually failed. */
/** The campaign state dir (`<main clone>/.blackhole`) as a write root for campaign agents whose
 * assigned root is a linked worktree: the protocol has them write `plans/`, `staged/`, the queue
 * and ledger there, and no worktree root contains it. Returns its realpath, or `null` — and then
 * grants nothing — unless `mainClone` is given, `config.json` exists in it (a stray directory in
 * an unrelated repo earns no trust), and the realpath is not a broad root (a `.blackhole`
 * symlinked at $HOME or a temp root must not widen the guard). */
const stateRootOf = (mainClone) => {
  if (!mainClone) return null;
  const dir = path.join(mainClone, '.blackhole');
  if (!fs.existsSync(path.join(dir, 'config.json'))) return null;
  const real = resolveExistingAncestor(dir);
  return isTooBroadRoot(path.resolve(dir)) || isTooBroadRoot(real) ? null : real;
};

/** The state root of `cwd`'s campaign, read only from the anchored main clone (`anchoredMainClone`):
 * never from the worktree, nor from git metadata a worker can plant, so neither can mint trust. */
const campaignStateRoot = (cwd = process.cwd()) => stateRootOf(anchoredMainClone(cwd));

/** `segments` (relative to the state root) that name a path only the hook or the orchestrator may
 * write: the hook event log (`hook-events/`, `archive/hook-events-*`) — its deny records are the
 * audit trail — and `config.json`. Matched case-insensitively so a case-insensitive filesystem
 * cannot reach them through another spelling. */
const isProtectedStateSegments = (segments) => {
  const [first, second] = segments.map((segment) => segment.toLowerCase());
  return (
    first === 'config.json' ||
    first === 'hook-events' ||
    (first === 'archive' && typeof second === 'string' && second.startsWith('hook-events-'))
  );
};

const relativeSegments = (root, target) => path.relative(root, target).split(path.sep).filter(Boolean);

/** The state root and `archive/` are never a write target themselves: both sit directly above a
 * protected path, so a write naming either could land on one. A write names a file below them. */
const isStateContainerSegments = (segments) =>
  segments.length === 0 || (segments.length === 1 && segments[0].toLowerCase() === 'archive');

/** True when the leaf at `candidate` is absent or a regular file with no second hard link: a write
 * through a symlink or a hard link lands on another file, possibly `config.json` or the event log,
 * and an existing directory is not a file target. */
const isPlainLeaf = (candidate) => {
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch {
    return true;
  }
  return stat.isFile() && stat.nlink === 1;
};

/** `p` resolved the way the kernel will open it: the realpath of its deepest existing ancestor
 * joined with the segments that do not exist yet. */
const realpathWithTail = (p) => {
  const tail = [];
  let current = path.resolve(p);
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
};

/** True when `candidate` may be written under the trusted state root: no `..` segment, inside it
 * once resolved (`realpathWithTail`, so an alias through any symlink is judged where it lands),
 * not protected, not the state root or `archive/` itself, and with a plain leaf (`isPlainLeaf`). */
const isStateDirTrustedPath = (candidate, stateRoot) => {
  if (!stateRoot || candidate.split(path.sep).includes('..')) return false;
  const real = realpathWithTail(candidate);
  if (real !== stateRoot && !real.startsWith(stateRoot + path.sep)) return false;
  const segments = relativeSegments(stateRoot, real);
  return !isProtectedStateSegments(segments) && !isStateContainerSegments(segments) && isPlainLeaf(path.resolve(candidate));
};

/** Entries of `permissions.additionalDirectories` considered per call, so a long list cannot stall
 * the hook's deadline. */
const MAX_EXTRA_ROOT_CANDIDATES = 16;

/** The user, project and local settings files that carry `permissions.additionalDirectories` and that
 * a worker may never write: `~/.claude/settings.json`, and `.claude/settings.json` plus
 * `.claude/settings.local.json` under `CLAUDE_PROJECT_DIR` and under the main clone of `cwd` (never
 * the worker's own worktree copy, which a worker can edit). `mainClone` is `mainCloneRoot(cwd)`. */
const settingsFileCandidates = (cwd, mainClone = mainCloneRoot(cwd)) => {
  const projectDirs = [];
  const declared = process.env.CLAUDE_PROJECT_DIR;
  if (typeof declared === 'string' && path.isAbsolute(declared)) projectDirs.push(declared);
  if (mainClone) projectDirs.push(mainClone);
  const files = [path.join(os.homedir(), '.claude', 'settings.json')];
  for (const dir of projectDirs) {
    files.push(path.join(dir, '.claude', 'settings.json'), path.join(dir, '.claude', 'settings.local.json'));
  }
  return [...new Set(files)];
};

const readAdditionalDirectories = (file) => {
  try {
    const dirs = JSON.parse(fs.readFileSync(file, 'utf-8')).permissions.additionalDirectories;
    return Array.isArray(dirs) ? dirs.filter((dir) => typeof dir === 'string') : [];
  } catch {
    return [];
  }
};

/** The `permissions.additionalDirectories` entries of the settings `files`, `~/` expanded. */
const declaredDirectoryEntries = (files) =>
  files.flatMap(readAdditionalDirectories).map((dir) => (dir.startsWith('~/') ? path.join(os.homedir(), dir.slice(2)) : dir));

/** True when `candidate` resolves, through any symlink, to one of the settings `files`. An existing
 * target is compared by realpath (`resolveExistingAncestor`, linear in the path depth: this runs on
 * every write target, and a deep one must stay cheap). A target that does not exist yet can only
 * become a settings file under that file's own name, so the exact `realpathWithTail` comparison runs
 * only then, compared case-insensitively like the state-dir protected names. */
const isSettingsFilePath = (candidate, files) => {
  const existing = files.filter((file) => fs.existsSync(file));
  const real = resolveExistingAncestor(candidate);
  if (existing.some((file) => resolveExistingAncestor(file) === real)) return true;
  const name = path.basename(path.resolve(candidate));
  if (!files.some((file) => path.basename(file).toLowerCase() === name.toLowerCase())) return false;
  const full = realpathWithTail(candidate).toLowerCase();
  return files.some((file) => realpathWithTail(file).toLowerCase() === full);
};

/** True when a root would span something the guards protect: a main clone (so its tracked files),
 * a campaign state dir or a settings file, or lies inside a state dir or a `.git` dir. */
const overlapsProtectedPaths = (root, mainClones, settingsFiles) =>
  mainClones.some(
    (clone) =>
      isUnderRoot(clone, root) ||
      isUnderRoot(root, path.join(clone, '.blackhole')) ||
      isUnderRoot(root, path.join(clone, '.git')),
  ) ||
  settingsFiles.some((file) => isUnderRoot(file, root));

/** True when `project` (`CLAUDE_PROJECT_DIR`, set by the harness) may be read for roots: an existing
 * absolute directory the worker cannot write: not inside or equal to one of the writable `roots`
 * (assigned root, scratchpad and extra roots found so far), not strictly inside the nearest repo of
 * `cwd`, and not a linked worktree (its `.git` is a pointer file), which is where workers write. A
 * session in the main clone has that clone as its project dir, so the owner's project and local
 * settings still count there. */
const isHarnessProjectDir = (project, cwd, writableRoots) => {
  if (!path.isAbsolute(project) || !isExistingDirectory(project)) return false;
  if (readPointerFile(path.join(project, '.git')) !== null) return false;
  if (writableRoots.some((root) => root && isUnderRoot(project, root))) return false;
  const top = nearestGitRoot(cwd);
  return !(top && resolveExistingAncestor(project) !== resolveExistingAncestor(top) && isUnderRoot(project, top));
};

/** The realpath of a declared `additionalDirectories` entry when it is a registered, back-linked
 * linked worktree of a repo with a campaign config, else null. The cheap checks run before any git
 * call, so a plain directory or a main clone costs no process spawn. */
const campaignWorktreeRoot = (entry) => {
  if (!isAcceptableScratchpadDir(entry) || !isExistingDirectory(entry)) return null;
  const dir = path.resolve(entry);
  const pointer = readPointerFile(path.join(dir, '.git'));
  if (realpathOrNull(dir) !== dir || !pointer || !pointer.startsWith('gitdir: ')) return null;
  const top = worktreeRoot(dir);
  if (!top || realpathOrNull(top) !== dir) return null;
  const commonDir = path.resolve(dir, git(['rev-parse', '--git-common-dir'], dir));
  if (!isTrustedLinkedWorktree(dir, commonDir) || stateRootOf(mainCloneRoot(dir)) === null) return null;
  return dir;
};

/** Extra containment roots a campaign agent may write beyond its assigned worktree, the one place
 * both guards (`validate-file-changes.js`, `bash-write-target-guard.js`) read them from, so a root
 * is never trusted by one tool and refused by the other. Two sources, every candidate validated:
 *  1. the harness scratchpad: the payload's `scratchpad_dir`, the configured `scratchpad_dir` and
 *     `BLACKHOLE_SCRATCHPAD_DIR`, each an existing directory that is not broad
 *     (`isAcceptableScratchpadDir`);
 *  2. linked worktrees of other repos named in `permissions.additionalDirectories` of the user,
 *     project and local settings files (`settingsFileCandidates`): only a registered linked worktree
 *     (never a main clone, never a symlink) of a repo whose main clone holds `.blackhole/config.json`
 *     (`campaignStateRoot`), at most `MAX_EXTRA_ROOT_CANDIDATES` entries per call.
 * A root that spans a main clone, a campaign state dir or a settings file, or sits inside a state
 * dir, is dropped, so trusting it can never reach what those guard. Session-only `--add-dir`
 * directories are not in the payload or the settings files and stay uncovered. Returns realpaths;
 * an unreadable or malformed settings file contributes none. A git failure for one entry drops that
 * entry; the one for `cwd` itself propagates like every other resolver here. Callers judge a path
 * with `isTrustedExtraPath`; `mainClone` (`mainCloneRoot(cwd)`) and `assignedRoot` are passed by a
 * caller that already has them. Settings sources: the user file and the harness project dir's
 * files (`isHarnessProjectDir`); the main clone's own files stay write-protected but are not read. */
const trustedWriteRoots = (cwd = process.cwd(), input = {}, { mainClone = mainCloneRoot(cwd), assignedRoot = null } = {}) => {
  const settingsFiles = settingsFileCandidates(cwd, mainClone);
  const mainClones = mainClone ? [mainClone] : [];
  const roots = new Set();
  const admit = (dir, clones) => {
    const real = resolveExistingAncestor(dir);
    if (!overlapsProtectedPaths(real, clones, settingsFiles)) roots.add(real);
  };

  // Kept even when `admit` drops one for spanning a settings file: a worker can still write there.
  const scratchpadDirs = [];
  const scratchpads = [input && input.scratchpad_dir, readScratchpadDir(anchoredMainClone(cwd)), process.env.BLACKHOLE_SCRATCHPAD_DIR];
  for (const dir of scratchpads) {
    if (typeof dir === 'string' && isAcceptableScratchpadDir(dir) && isExistingDirectory(dir)) {
      scratchpadDirs.push(resolveExistingAncestor(dir));
      admit(dir, mainClones);
    }
  }

  // Trust sources are only the user's own settings file and the settings of the harness project
  // dir. Nothing here is derived from git metadata a worker can write (a forged `.git` pointer
  // names any clone), and a project dir the worker can write to is never a source.
  const considered = new Set();
  const considerDeclared = (files) => {
    for (const entry of declaredDirectoryEntries(files)) {
      if (considered.size >= MAX_EXTRA_ROOT_CANDIDATES) break;
      if (considered.has(entry)) continue;
      considered.add(entry);
      try {
        const dir = campaignWorktreeRoot(entry);
        if (dir) admit(dir, [...mainClones, mainCloneRoot(dir)]);
      } catch {
        // An entry git cannot resolve is dropped: narrower, never wider.
      }
    }
  };
  considerDeclared([path.join(os.homedir(), '.claude', 'settings.json')]);
  const project = process.env.CLAUDE_PROJECT_DIR;
  if (typeof project === 'string' && isHarnessProjectDir(project, cwd, [assignedRoot, ...scratchpadDirs, ...roots])) {
    considerDeclared([path.join(project, '.claude', 'settings.json'), path.join(project, '.claude', 'settings.local.json')]);
  }
  return [...roots];
};

/** The main clone a declared `additionalDirectories` entry names, or `null`: the entry itself when
 * it is a main clone (its `.git` is a directory, so never a linked worktree or a planted pointer
 * file), or the directory above a `.blackhole` the entry names or sits inside. Realpath. */
const declaredMainClone = (entry) => {
  if (!path.isAbsolute(entry) || !isExistingDirectory(entry)) return null;
  const real = resolveExistingAncestor(entry);
  const segments = real.split(path.sep);
  const at = segments.lastIndexOf('.blackhole');
  const clone = at > 0 ? segments.slice(0, at).join(path.sep) || path.sep : real;
  try {
    return fs.lstatSync(path.join(clone, '.git')).isDirectory() ? clone : null;
  } catch {
    return null;
  }
};

/** True when `cwd` is the harness project dir (`CLAUDE_PROJECT_DIR`, the session's own folder) or a
 * directory inside it whose nearest git root is the project dir or an ancestor of it: the main
 * session's position. Nothing nested between `cwd` and the project dir qualifies (a linked worktree,
 * a standalone repository, a planted `.git` file). An in-process teammate worker carries no
 * `agent_type` either, but runs in its assigned linked worktree, so it is refused. */
const isMainSessionCwd = (cwd) => {
  const project = process.env.CLAUDE_PROJECT_DIR;
  if (typeof project !== 'string' || !path.isAbsolute(project) || !isExistingDirectory(project)) return false;
  if (!isUnderRoot(cwd, project)) return false;
  const top = nearestGitRoot(cwd);
  return !top || isUnderRoot(project, top);
};

/** Campaign state dirs an orchestrator-class caller may write from any cwd, the one place both
 * guards read them from. The caller is an `orchestrator`/`coordinator` `agent_type`
 * (`isOrchestratorCaller`), or a payload with no `agent_type` whose `cwd` is the main session's
 * (`isMainSessionCwd`).
 * Two sources: the anchored own clone (`campaignStateRoot`), and the main clones the owner
 * declares in `permissions.additionalDirectories` of the user settings file and of the harness
 * project dir's settings (`isHarnessProjectDir`), each validated by `declaredMainClone` and
 * `stateRootOf` (a `.blackhole/config.json`, not a broad root), at most `MAX_EXTRA_ROOT_CANDIDATES`
 * entries. Nothing is derived from git metadata a worker can write. Callers judge a path with
 * `isStateDirTrustedPath`, so `config.json`, `hook-events/` and the state root stay protected.
 * Returns `[]` for every worker or unknown `agent_type`, for an in-process teammate, and whenever
 * `BLACKHOLE_ASSIGNED_WORKTREE` marks the process as a worker's, so no worker gains a write it lacked. */
const orchestratorStateRoots = (cwd = process.cwd(), input = {}, { assignedRoot = null } = {}) => {
  const agentType = input && input.agent_type;
  if (hasNoAgentType(agentType) ? !isMainSessionCwd(cwd) : !isOrchestratorCaller(agentType)) return [];
  const assigned = process.env.BLACKHOLE_ASSIGNED_WORKTREE;
  if (typeof assigned === 'string' && assigned.trim().length > 0) return [];
  const roots = new Set();
  const own = campaignStateRoot(cwd);
  if (own) roots.add(own);
  const considered = new Set();
  const considerDeclared = (files) => {
    for (const entry of declaredDirectoryEntries(files)) {
      if (considered.size >= MAX_EXTRA_ROOT_CANDIDATES) break;
      if (considered.has(entry)) continue;
      considered.add(entry);
      try {
        const root = stateRootOf(declaredMainClone(entry));
        if (root) roots.add(root);
      } catch {
        // An entry git or the filesystem cannot resolve is dropped: narrower, never wider.
      }
    }
  };
  considerDeclared([path.join(os.homedir(), '.claude', 'settings.json')]);
  const project = process.env.CLAUDE_PROJECT_DIR;
  if (typeof project === 'string' && isHarnessProjectDir(project, cwd, [assignedRoot, process.env.BLACKHOLE_SCRATCHPAD_DIR, ...roots])) {
    considerDeclared([path.join(project, '.claude', 'settings.json'), path.join(project, '.claude', 'settings.local.json')]);
  }
  return [...roots];
};

/** `trustedWriteRoots` deferred and computed at most once: the settings reads and git spawns it costs
 * are paid only by a call whose write target lies outside every root the caller already trusts.
 * `isTrustedExtraPath` takes the returned function in place of a root list. */
const lazyTrustedWriteRoots = (cwd, input, options) => {
  let roots = null;
  return () => {
    if (roots === null) roots = trustedWriteRoots(cwd, input, options);
    return roots;
  };
};

/** True when `candidate` is a markdown file directly inside Claude Code's own auto-memory directory,
 * `~/.claude/projects/<project>/memory/<name>.md`: harness state, not repository content, so a
 * campaign session may record a memory there. Narrow by construction: exactly three segments below
 * `~/.claude/projects` once every symlink is resolved (`realpathWithTail`), a `.md` leaf, and a plain
 * file (`isPlainLeaf`). Everything else under `~/.claude` (settings, plugins, rules, `CLAUDE.md`)
 * stays outside the guard's allowance. */
const isHarnessMemoryPath = (candidate) => {
  const projects = realpathWithTail(path.join(os.homedir(), '.claude', 'projects'));
  const real = realpathWithTail(candidate);
  if (!real.startsWith(projects + path.sep)) return false;
  const [project, dir, name, ...rest] = real.slice(projects.length + 1).split(path.sep);
  if (!project || dir !== 'memory' || !name || rest.length > 0 || !/^[^/]+\.md$/i.test(name)) return false;
  return isPlainLeaf(path.resolve(candidate));
};

/** True when `candidate` may be written under one of the `roots` `trustedWriteRoots` returned (a list,
 * or a `lazyTrustedWriteRoots` function resolved only when the harness-memory check does not decide), or is
 * a harness auto-memory file (`isHarnessMemoryPath`, which needs no root): no
 * `..` segment, inside a root once resolved (`realpathWithTail`, so an alias through any symlink is
 * judged where it lands), and a plain leaf (`isPlainLeaf`: a link or an existing directory is not a
 * file target). */
const isTrustedExtraPath = (candidate, roots) => {
  if (candidate.split(path.sep).includes('..')) return false;
  if (isHarnessMemoryPath(candidate)) return true;
  const list = typeof roots === 'function' ? roots() : roots;
  if (list.length === 0) return false;
  const real = realpathWithTail(candidate);
  return list.some((root) => real.startsWith(root + path.sep)) && isPlainLeaf(path.resolve(candidate));
};

/** True only when `<mainClone>/.blackhole/config.json` is absent (`ENOENT`) — the fail-closed
 * "no live campaign" read shared by `sibling-plugin-guard.js`'s defer gate and the hook-event
 * rotation gate `recordEvent` above wires up: present, or any other stat outcome (an unreadable
 * directory, a permission error), folds to `false`. Both callers treat `false` as their own
 * safer default — staying active in the defer guard's case, not sweeping in rotation's case —
 * so an ambiguous read never accidentally grants either mechanism a broader condition than
 * "genuinely, unambiguously no campaign here." */
const hasNoCampaignConfig = (mainClone) => {
  try {
    fs.statSync(path.join(mainClone, '.blackhole', 'config.json'));
    return false;
  } catch (error) {
    return Boolean(error && error.code === 'ENOENT');
  }
};

const failClosed = ({ hook, tool, error, patternId = 'pattern-load-failure', label = 'pattern data', cwd }) => {
  const failurePhrase =
    patternId === 'uncaught-validator-error'
      ? `${label} threw while running`
      : `${label} could not be loaded`;
  console.error(`[blackhole-hook] ${hook}: ${failurePhrase} — ${error.message}`);
  denyAndRecord({
    hook,
    tool,
    pattern_id: patternId,
    reason: `${hook}: ${failurePhrase}, refusing the call`,
    detail: error.message,
    cwd,
  });
};

module.exports = {
  redact,
  redactReason,
  SECRET_KV,
  worktreeRoot,
  mainCloneRoot,
  anchoredMainClone,
  campaignStateRoot,
  isStateDirTrustedPath,
  trustedWriteRoots,
  orchestratorStateRoots,
  lazyTrustedWriteRoots,
  isTrustedExtraPath,
  settingsFileCandidates,
  isSettingsFilePath,
  allWorktreeRoots,
  resolveExistingAncestor,
  isUnderRoot,
  isAcceptableScratchpadDir,
  readScratchpadDir,
  readAssignedWorktreeRoot,
  readLinkedWorktreeRoot,
  readHookInput,
  hasNoCampaignConfig,
  recordEvent,
  denyAndRecord,
  warnAndRecord,
  allowSilently,
  failClosed,
};
