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

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** Worktree root of the calling process, or null outside a git context. */
const worktreeRoot = () => {
  try {
    return git(['rev-parse', '--show-toplevel']);
  } catch {
    return null;
  }
};

/** Main clone root. `--git-common-dir` points at the shared .git even from a linked worktree, so
 * every worker's events land in the one directory the orchestrator polls. */
const mainCloneRoot = () => {
  try {
    return path.dirname(path.resolve(process.cwd(), git(['rev-parse', '--git-common-dir'])));
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

const recordEvent = (event) => {
  const destRoot = mainCloneRoot();
  if (!destRoot) {
    console.error(`[blackhole-hook] no git context — ${event.tier} event not recorded (${event.pattern_id})`);
    return;
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
    worktree: worktreeRoot(),
    detail: redact(event.detail),
  };
  try {
    const dir = path.join(destRoot, '.blackhole', 'hook-events');
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
const failClosed = ({ hook, tool, error, patternId = 'pattern-load-failure', label = 'pattern data' }) => {
  console.error(`[blackhole-hook] ${hook}: ${label} could not be loaded — ${error.message}`);
  denyAndRecord({
    hook,
    tool,
    pattern_id: patternId,
    reason: `${hook}: ${label} could not be loaded, refusing the call`,
    detail: error.message,
  });
};

module.exports = {
  redact,
  worktreeRoot,
  mainCloneRoot,
  readHookInput,
  recordEvent,
  denyAndRecord,
  warnAndRecord,
  allowSilently,
  failClosed,
};
