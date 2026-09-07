#!/usr/bin/env bun
'use strict';

/**
 * hook-event-rotation.js — self-triggered rotation for `.blackhole/hook-events/` in a session
 * where nothing else ever reads or prunes it (an interactive, non-campaign session: a live
 * campaign's own Triage step consumes and archives these files itself, and only ever runs when
 * `.blackhole/config.json` is present).
 *
 * The mechanism this module solves for is directory-**entry** count, not disk bytes: each event
 * file is a few hundred bytes to a couple of kilobytes, so even heavy daily use reaches only tens
 * of megabytes a year — never enough to matter as raw storage. What does matter is a flat
 * directory holding tens of thousands of small files, which degrades every future `readdirSync`
 * over it (this repo's own Triage step glob included, once a campaign eventually starts on this
 * machine). The sweep below is an age-only cutover, gated by a sentinel so the (comparatively
 * expensive) directory scan runs at most once per rotation interval rather than on every write —
 * `recordEvent` calls this on essentially every gated Bash/Write/Edit call in a co-installed
 * session, so a per-write scan would put permanent latency on the hottest hook path.
 *
 * Archives, never deletes: eligible files are renamed into a fresh
 * `.blackhole/archive/hook-events-rotated-<ts>/` directory, mirroring the archive-not-delete
 * shape this repo already uses for hook-event files elsewhere (`archiveConsumedFiles`). Deleting
 * instead would turn a rotation gated on a non-atomic "config.json absent" check into an
 * unrecoverable-data-loss race the moment a campaign bootstrap wins that race; archiving keeps
 * the same race benign and inspectable.
 *
 * The sentinel is written only once the sweep loop has finished, never before — a process
 * interrupted partway through a sweep leaves no sentinel behind, so the next call re-attempts
 * from scratch rather than believing the work already done.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_RETENTION_DAYS = 14;
const SENTINEL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SENTINEL_BASENAME = 'hook-events-rotation-sentinel';

/** Positive-integer days, or the default on anything else (unset, non-numeric, `0`, negative,
 * fractional) — an operator mistyping the override should degrade to "rotation still runs, on
 * the documented default," never throw and never silently disable rotation. */
const parseRetentionDays = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
};

/** `false` (not fresh — sweep) on every stat outcome except "exists and is younger than the
 * rotation interval": absent, unreadable, or genuinely stale all fold to the same "go sweep"
 * answer, since the cost of an unnecessary sweep (one readdir) is far cheaper than the cost of
 * never sweeping at all. */
const sentinelIsFresh = (sentinelPath, nowMs, statSync) => {
  try {
    return nowMs - statSync(sentinelPath).mtimeMs < SENTINEL_INTERVAL_MS;
  } catch {
    return false;
  }
};

/**
 * Sweeps `eventsDir` for `.json` files older than the retention window and archives them.
 * Gated by an O(1) sentinel-mtime check so the directory scan itself runs at most once per
 * `SENTINEL_INTERVAL_MS`. `deps` overrides the underlying fs calls and the clock — production
 * callers never pass it; tests use it to inject deterministic timestamps and to observe/force
 * individual operations without touching the real filesystem clock.
 */
const rotateHookEvents = (eventsDir, deps = {}) => {
  const {
    statSync = fs.statSync,
    readdirSync = fs.readdirSync,
    renameSync = fs.renameSync,
    mkdirSync = fs.mkdirSync,
    writeFileSync = fs.writeFileSync,
    now = () => Date.now(),
  } = deps;

  const sentinelPath = path.join(path.dirname(eventsDir), SENTINEL_BASENAME);
  const nowMs = now();

  if (sentinelIsFresh(sentinelPath, nowMs, statSync)) return;

  const retentionDays = parseRetentionDays(process.env.BLACKHOLE_HOOK_EVENT_RETENTION_DAYS);
  const cutoffMs = nowMs - retentionDays * DAY_MS;

  let filenames;
  try {
    filenames = readdirSync(eventsDir).filter((f) => f.endsWith('.json'));
  } catch {
    filenames = [];
  }

  // The archive directory is created lazily — only once, on the first file this sweep actually
  // needs to move — mirroring `archiveConsumedFiles`'s own "mkdirSync only when there is
  // something to move" shape. A failure creating it means nothing this sweep can be archived;
  // that failure is deliberately NOT caught here, so it propagates out of this call and the
  // sentinel write below never runs — the caller's own try/catch treats that exactly like any
  // other best-effort recording failure, and the next call retries the sweep from scratch.
  let archiveDir = null;

  for (const filename of filenames) {
    const filePath = path.join(eventsDir, filename);
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      // Vanished between readdir and stat — e.g. a concurrent Triage run already consumed it.
      continue;
    }
    if (stat.mtimeMs >= cutoffMs) continue;

    if (archiveDir === null) {
      archiveDir = path.join(path.dirname(eventsDir), 'archive', `hook-events-rotated-${nowMs}`);
      mkdirSync(archiveDir, { recursive: true });
    }

    try {
      renameSync(filePath, path.join(archiveDir, filename));
    } catch (err) {
      // A single file losing this race (renamed or deleted by a concurrent process between the
      // stat above and this rename) never stops the rest of the sweep.
      console.error(`[blackhole-hook] hook-event rotation: could not archive ${filename}: ${err.message}`);
    }
  }

  // Written unconditionally, even when zero files were eligible — the sentinel records "a sweep
  // ran," not "a sweep found something."
  writeFileSync(sentinelPath, '');
};

module.exports = {
  rotateHookEvents,
  parseRetentionDays,
  DEFAULT_RETENTION_DAYS,
  SENTINEL_BASENAME,
};
