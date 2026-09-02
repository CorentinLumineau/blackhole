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
  /\b((?:[A-Za-z][A-Za-z0-9]*_)*?(?:password|passwd|api[_-]?key|secret|token|access[_-]?key)(?:_[A-Za-z0-9]+)*)(\s*[=:]\s*)(['"]?)[^'"\s]{4,}\3/gi;
const SECRET_SPACE =
  /\b(--?(?:password|passwd|api[_-]?key|secret|token|access[_-]?key|with-token)|Bearer)\s+(['"]?)[^'"\s]{4,}\2/gi;
const MAX_DETAIL_CHARS = 300;

const redact = (text) =>
  String(text === undefined || text === null ? '' : text)
    .replace(SECRET_KV, (_match, key, separator, quote) => `${key}${separator}${quote}***${quote}`)
    .replace(SECRET_SPACE, (_match, flag, quote) => `${flag} ${quote}***${quote}`)
    .slice(0, MAX_DETAIL_CHARS);

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
 * linked worktree, so every worker's events land in the one directory the orchestrator polls. */
const mainCloneRoot = (cwd = process.cwd()) => {
  try {
    return path.dirname(path.resolve(cwd, git(['rev-parse', '--git-common-dir'], cwd)));
  } catch {
    return null;
  }
};

/** Realpath of the nearest existing ancestor of `p` — `p` itself if it already exists (following
 * it through if it is itself a symlink), otherwise the nearest parent that does. Containment has
 * to be decided on resolved paths (temp dirs and home directories are routinely symlinks), and
 * that includes the leaf: `ln -s ~/.ssh/authorized_keys ./notes.txt` then a Write to `notes.txt`
 * must resolve through that symlink too, not just through a symlinked ancestor directory — passing
 * the target path itself (not its dirname) is what makes `fs.realpathSync` see it. Shared by
 * `validate-file-changes.js`'s leaf-containment check and `allWorktreeRoots`'s root filter below
 * (#510) — one resolution path for both sides of every containment comparison (`V-INT-02`). */
const resolveExistingAncestor = (p) => {
  let current = path.resolve(p);
  for (;;) {
    try {
      return fs.realpathSync(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
};

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

const isAcceptableScratchpadDir = (value) => {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) return false;
  const resolved = path.resolve(value);
  const segments = resolved.split(path.sep).filter(Boolean);
  if (segments.length < 2) return false;
  if (BARE_TEMP_DIRS.has(resolveExistingAncestor(value))) return false;
  const home = process.env.HOME;
  if (home && resolved === path.resolve(home)) return false;
  return true;
};

/** Reads and validates `scratchpad_dir` from `<mainClone>/.blackhole/config.json`. Returns null —
 * never throws, never falls back to an unvalidated value — on every degradation: file absent,
 * unreadable, malformed JSON, key absent, or a value `isAcceptableScratchpadDir` rejects. Callers
 * treat null exactly like "no configured scratchpad" and narrow to main-clone-only containment;
 * failing OPEN here (trusting an unreadable or overly-broad config) would silently re-widen the
 * allow-list #510/F-00088 exists to narrow. */
const readScratchpadDir = (mainClone) => {
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

/** Worktree roots this repo family's containment check trusts, resolved from `cwd` for the same
 * reason `worktreeRoot`/`mainCloneRoot` are (#507). NOT every worktree `git worktree list
 * --porcelain` reports — `git worktree add` is ungated (no bash-pattern blocks it), so trusting
 * every *registered* worktree unconditionally let one such call permanently widen the
 * Write/Edit containment allow-list to an arbitrary directory (#510/F-00088). Narrowed here to
 * worktrees nested under the main clone, or nested under a validated `scratchpad_dir` from
 * `<mainClone>/.blackhole/config.json` — the documented location for worker worktrees (e.g.
 * `/tmp/blackhole-campaign/wt-42`). `validate-file-changes.js`'s containment check treats a
 * target as in-bounds when it falls under ANY of these roots, not just whichever one the hook
 * process happens to be sitting in. Null outside a git context, mirroring the other two
 * resolvers above; an empty (but non-null) array means git resolved fine but no root passed the
 * filter, which correctly denies rather than falling open. */
const allWorktreeRoots = (cwd = process.cwd()) => {
  try {
    const listing = git(['worktree', 'list', '--porcelain'], cwd);
    const roots = listing
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length));
    if (roots.length === 0) return null;
    const mainClone = mainCloneRoot(cwd);
    if (!mainClone) return null;
    const scratchpadDir = readScratchpadDir(mainClone);
    return roots.filter(
      (root) => isUnderRoot(root, mainClone) || (scratchpadDir !== null && isUnderRoot(root, scratchpadDir)),
    );
  } catch {
    return null;
  }
};

/** Parses the hook-shaped JSON payload on stdin. Throws on malformed/unreadable input rather than
 * swallowing the failure into `{}` — an empty object reads as "no command, no file_path", which
 * both validators treat as a silent allow with zero record. That is exactly the failure mode this
 * gate exists to prevent, so callers wrap this the same way they wrap pattern-load failures: catch
 * and turn it into `failClosed`, never let it fall through to an allow. */
const readHookInput = () => JSON.parse(fs.readFileSync(0, 'utf-8') || '{}');

/** `BLACKHOLE_ASSIGNED_WORKTREE` narrows Write/Edit containment to a single assigned worktree
 * when set by the orchestrator at implementer spawn (#620). Unset, empty, unresolvable, or not a
 * registered member of `allWorktreeRoots(cwd)` → null (stderr notice, fail-open to today's
 * all-roots containment). Mirrors the `BLACKHOLE_HOOK_EVENT_DIR` override shape from #604. */
const readAssignedWorktreeRoot = (cwd = process.cwd()) => {
  const raw = process.env.BLACKHOLE_ASSIGNED_WORKTREE;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const resolved = path.resolve(raw.trim());
  const familyRoots = allWorktreeRoots(cwd);
  if (!familyRoots) {
    console.error(
      `[blackhole-hook] BLACKHOLE_ASSIGNED_WORKTREE set but no git context — falling back to all-worktree containment`,
    );
    return null;
  }
  const realResolved = resolveExistingAncestor(resolved);
  const match = familyRoots.find((root) => resolveExistingAncestor(root) === realResolved);
  if (!match) {
    console.error(
      `[blackhole-hook] BLACKHOLE_ASSIGNED_WORKTREE ${JSON.stringify(resolved)} is not a registered family worktree — falling back to all-worktree containment`,
    );
    return null;
  }
  return realResolved;
};

/** `BLACKHOLE_HOOK_EVENT_DIR` makes the durable-record sink explicit and inspectable instead of
 * solely inferred from `cwd`'s git resolution (#604): when set, it is the sink outright and
 * `mainCloneRoot` is never consulted, so no git context is required at all. Unset (the harness's
 * normal path), behavior is byte-for-byte the pre-existing `mainCloneRoot(cwd)` resolution below. */
const recordEvent = (event) => {
  const cwd = event.cwd || process.cwd();
  const override = process.env.BLACKHOLE_HOOK_EVENT_DIR;
  let dir;
  if (override) {
    dir = override;
  } else {
    const destRoot = mainCloneRoot(cwd);
    if (!destRoot) {
      console.error(`[blackhole-hook] no git context — ${event.tier} event not recorded (${event.pattern_id})`);
      return;
    }
    dir = path.join(destRoot, '.blackhole', 'hook-events');
  }
  const payload = {
    version: 1,
    recorded_at: new Date().toISOString(),
    hook: event.hook,
    tool: event.tool,
    decision: event.decision,
    tier: event.tier,
    pattern_id: event.pattern_id,
    reason: redact(event.reason),
    worktree: worktreeRoot(cwd),
    detail: redact(event.detail),
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const unique = `${payload.recorded_at.replace(/[:.]/g, '-')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(path.join(dir, `${unique}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  } catch (err) {
    console.error(`[blackhole-hook] could not record ${event.tier} event (${event.pattern_id}): ${err.message}`);
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

/** WARN tier — allowed, but recorded; the orchestrator still ingests it as V-HOOK-02. Same
 * `hookSpecificOutput.permissionDecision` shape as the deny case for consistency; `systemMessage`
 * is kept alongside it for transcript visibility, which is a separate, additive field. */
const warnAndRecord = (event) => {
  recordEvent({ ...event, decision: 'allow', tier: 'warn' });
  const reason = `${event.reason} [${event.pattern_id}] — allowed and recorded for review`;
  emit(
    {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: reason,
      },
      systemMessage: `blackhole PreToolUse: ${reason}`,
    },
    0,
  );
};

/** No pattern matched — allow with no output and no record. */
const allowSilently = () => process.exit(0);

/** Pattern data or hook input could not be loaded, so safe and dangerous are indistinguishable:
 * refuse. Still recorded, because a silent refusal is the failure mode this gate exists to
 * prevent. Same helper for both failure sites — pattern load (main() below) and stdin parse
 * (readHookInput's caller, above) — distinguished only by `patternId`/`label` so the record and
 * the stderr message say which one actually failed. */
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
  worktreeRoot,
  mainCloneRoot,
  allWorktreeRoots,
  resolveExistingAncestor,
  isUnderRoot,
  isAcceptableScratchpadDir,
  readScratchpadDir,
  readAssignedWorktreeRoot,
  readHookInput,
  recordEvent,
  denyAndRecord,
  warnAndRecord,
  allowSilently,
  failClosed,
};
