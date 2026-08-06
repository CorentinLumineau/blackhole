#!/usr/bin/env bun
'use strict';

/**
 * hook-event-log.js — the PreToolUse hooks' boundary with everything outside the process: the
 * stdin payload coming in, the harness-facing decision going out, and the durable record of every
 * non-allow decision under `<main-clone>/.blackhole/hook-events/`.
 *
 * The durable record is the point of the whole gate. An unattended worker cannot be relied on to
 * report that it was refused, so the refusal is written by non-agent code and read by the
 * orchestrator's Triage step (orchestrator-runtime.md § Triage 1b) into findings-ledger.json as
 * V-HOOK-01 / V-HOOK-02. Recording is best-effort (a recording failure never converts a refusal
 * into an allow); the *decision* never is.
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
 * from a transient argv into a durable file. */
const SECRET_LITERAL = /\b(password|passwd|api[_-]?key|secret|token)(\s*[=:]\s*)(['"]?)[^'"\s]{4,}\3/gi;
const MAX_DETAIL_CHARS = 300;

const redact = (text) =>
  String(text === undefined || text === null ? '' : text)
    .replace(SECRET_LITERAL, (_match, key, separator, quote) => `${key}${separator}${quote}***${quote}`)
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

const readHookInput = () => {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf-8') || '{}');
  } catch {
    return {};
  }
};

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

/** BLOCK tier — record the refusal, then refuse. Exit 2 is the harness's deny signal. */
const denyAndRecord = (event) => {
  recordEvent({ ...event, decision: 'deny', tier: 'block' });
  emit(
    {
      decision: 'deny',
      reason: event.reason,
      systemMessage: `blackhole PreToolUse: denied — ${event.reason} [${event.pattern_id}]`,
    },
    2,
  );
};

/** WARN tier — allowed, but recorded; the orchestrator still ingests it as V-HOOK-02. */
const warnAndRecord = (event) => {
  recordEvent({ ...event, decision: 'allow', tier: 'warn' });
  emit(
    {
      systemMessage: `blackhole PreToolUse: ${event.reason} [${event.pattern_id}] — allowed and recorded for review`,
    },
    0,
  );
};

/** No pattern matched — allow with no output and no record. */
const allowSilently = () => process.exit(0);

/** Pattern data could not be loaded, so safe and dangerous are indistinguishable: refuse. Still
 * recorded, because a silent refusal is the failure mode this gate exists to prevent. */
const failClosed = ({ hook, tool, error }) => {
  console.error(`[blackhole-hook] ${hook}: pattern data could not be loaded — ${error.message}`);
  denyAndRecord({
    hook,
    tool,
    pattern_id: 'pattern-load-failure',
    reason: `${hook}: pattern data could not be loaded, refusing the call`,
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
