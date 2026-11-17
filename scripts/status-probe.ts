import * as fs from 'fs';
import * as path from 'path';
import { parseFlags, unknownFlagKeys } from './lib/argv-flags.ts';
import { readJsonFile } from './lib/fs.ts';
import { PROBE_FRESH_MINUTES, type ProbeRecord, type StatusArtifact } from './lib/campaign-status/status-page-row.ts';

// Usage: bun run scripts/status-probe.ts record --ok|--fail [--reason <text>] [--url <url>]
//        [--campaign-dir <dir>] [--now <ISO8601>]
// Records the launch gate's status-page reachability probe (an `ArtifactData` list of the stored
// page's datasets) as `last_probe {at, ok, url, reason?}` in `.blackhole/status-artifact.json`, keeping every other
// key. `--url` defaults to the stored `url`. Exit 0 when written or left unchanged, 2 on a usage
// error or a missing, malformed or url-less file (never touched then).
const USAGE =
  'usage: status-probe.ts record --ok|--fail [--reason <text>] [--url <url>] [--campaign-dir <dir>] [--now <ISO8601>]';

type StoredArtifact = StatusArtifact & Record<string, unknown>;

/**
 * The artifact with `probe` recorded at `nowIso`. `changed: false` keeps an identical probe only while
 * the Status page row still counts it as fresh (`PROBE_FRESH_MINUTES`); an older one is rewritten,
 * or the launch gate would ask for a probe it then refuses to record.
 */
export function recordProbe(
  artifact: StoredArtifact,
  probe: Omit<ProbeRecord, 'at'>,
  nowIso: string,
): { changed: boolean; next: StoredArtifact } {
  const prior = artifact.last_probe;
  const age = prior ? Date.parse(nowIso) - Date.parse(prior.at) : NaN;
  const same = prior !== undefined && prior.ok === probe.ok && prior.url === probe.url && (prior.reason ?? null) === (probe.reason ?? null);
  if (same && age >= 0 && age < PROBE_FRESH_MINUTES * 60_000) return { changed: false, next: artifact };
  const last_probe: ProbeRecord = { at: nowIso, ok: probe.ok, url: probe.url, ...(probe.reason ? { reason: probe.reason } : {}) };
  return { changed: true, next: { ...artifact, last_probe } };
}

const fail = (message: string): never => {
  console.error(`status-probe: ${message}\n${USAGE}`);
  process.exit(2);
};

const main = (): void => {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'record') fail(`unknown command "${command ?? ''}"`);
  const flags = parseFlags(rest);
  const unknown = unknownFlagKeys(flags, ['ok', 'fail', 'reason', 'url', 'campaign-dir', 'now']);
  if (unknown.length) fail(`unknown flag(s): ${unknown.map((k) => `--${k}`).join(', ')}`);
  if ((flags.ok === true) === (flags.fail === true)) fail('pass exactly one of --ok or --fail');
  for (const key of ['reason', 'url', 'campaign-dir', 'now']) {
    if (flags[key] === true) fail(`--${key} needs a value`);
  }
  const nowIso = typeof flags.now === 'string' ? flags.now : new Date().toISOString();
  if (Number.isNaN(Date.parse(nowIso))) fail('--now must be an ISO8601 time');

  const file = path.join(typeof flags['campaign-dir'] === 'string' ? flags['campaign-dir'] : '.blackhole', 'status-artifact.json');
  if (!fs.existsSync(file)) fail(`${file} is absent: nothing was published to probe`);
  let artifact: unknown;
  try {
    artifact = readJsonFile(file, file);
  } catch (error) {
    fail(error instanceof Error ? error.message : `${file} is not valid JSON`);
  }
  if (typeof artifact !== 'object' || artifact === null || Array.isArray(artifact)) fail(`${file} must hold a JSON object`);
  const stored = artifact as StoredArtifact;
  const url = typeof flags.url === 'string' ? flags.url : stored.url;
  if (typeof url !== 'string' || !url) fail(`${file} has no url and no --url was given`);

  const reason = typeof flags.reason === 'string' ? flags.reason : undefined;
  const { changed, next } = recordProbe(stored, { ok: flags.ok === true, url: url as string, reason }, nowIso);
  if (!changed) {
    console.log(`status-probe: last_probe unchanged (${stored.last_probe?.at})`);
    return;
  }
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
  console.log(`status-probe: last_probe ${next.last_probe?.ok ? 'ok' : 'failed'} recorded in ${file}`);
};

if (import.meta.main) main();
