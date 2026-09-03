import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computePluginDrift, type PluginDriftResult } from './lib/plugin-drift.ts';
import { root } from './checks/check-utils.ts';
import { projectIdentity } from './project-identity.ts';

// Issue #800 (ADR-030) — session-start advisory half of the plugin-cache drift detection. The
// reviewer's V-PLUGIN-01 gate (mechanism 1, `src/agents/reviewer.md`) blocks a PR that skips the
// required version bump; this signal (mechanism 2) covers the residual gap mechanism 1 cannot
// see — a PR correctly bumps the version, but nobody ever runs the manual republish+reinstall
// step afterward (`.blackhole/plans/issue-800-research.md` § Assumption Audit). Mirrors
// `doc-health-signal.ts`'s existence-gated/atomic-write idiom (V-INT-02).

// CLAUDE.md's documented install command (`/plugin marketplace add
// https://github.com/CorentinLumineau/blackhole` then `/plugin install
// blackhole@blackhole-marketplace`) — not derivable from package.json, so named here.
const MARKETPLACE_NAME = 'blackhole-marketplace';

export type PluginDriftSignal = PluginDriftResult & {
  version: 1;
  refreshed_at: string;
  installed_version: string;
};

export const computeSignal = (
  installedHooksDir: string,
  repoHooksDir: string,
  installedVersion: string,
  now: Date = new Date(),
): PluginDriftSignal => ({
  version: 1,
  refreshed_at: now.toISOString(),
  installed_version: installedVersion,
  ...computePluginDrift(installedHooksDir, repoHooksDir),
});

// Same lightweight tmp+rename idiom as doc-health-signal.ts:writeDocHealthSignalAtomic —
// deliberately not the heavier state-write-guard.ts, since this file is fully recomputed from
// source every turn and never read as authoritative campaign state (`blackhole-state.md` §
// Write protocol scopes that guard to queue.json/findings-ledger.json only).
export const writePluginDriftSignalAtomic = (campaignDir: string, signal: PluginDriftSignal): void => {
  fs.mkdirSync(campaignDir, { recursive: true });
  const target = path.join(campaignDir, 'plugin-drift.json');
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(signal, null, 2)}\n`);
  fs.renameSync(tmp, target);
};

function main(): void {
  const version = projectIdentity.version;
  const installedHooksDir = path.join(
    os.homedir(),
    '.claude',
    'plugins',
    'cache',
    MARKETPLACE_NAME,
    projectIdentity.name,
    version,
    'hooks',
  );
  const repoHooksDir = path.join(root, '.claude', 'hooks');
  const campaignDir = path.join(root, '.blackhole');
  const signal = computeSignal(installedHooksDir, repoHooksDir, version);
  writePluginDriftSignalAtomic(campaignDir, signal);
  console.log(`installed_present=${signal.installed_present} hooks_hash_match=${signal.hooks_hash_match}`);
}

if (import.meta.main) {
  main();
}
