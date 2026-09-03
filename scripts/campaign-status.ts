import * as fs from 'fs';
import * as path from 'path';
import { readScope } from './forge-scope.ts';
import { parseStatusArgs } from './lib/campaign-status/cli.ts';
import { formatDashboard, renderConfigSummary } from './lib/campaign-status/dashboard.ts';
import { fetchForgeCounts } from './lib/campaign-status/forge.ts';
import { loadCampaignState } from './lib/campaign-status/state.ts';
import { readJsonFile } from './lib/fs.ts';
import type { PluginDriftSignal } from './plugin-drift-signal.ts';

export { parseCheckpointFrontmatter } from './lib/campaign-status/checkpoint.ts';
export {
  computeWaves,
  countLedgerByStatus,
  discoveryFilings,
  DONE_STATUSES,
  groupIssuesByPhase,
  renderRouteChain,
} from './lib/campaign-status/queue.ts';
export { formatDashboard, formatScopeLabel, renderConfigSummary } from './lib/campaign-status/dashboard.ts';
export { fetchForgeCounts } from './lib/campaign-status/forge.ts';
export { loadCampaignState } from './lib/campaign-status/state.ts';
export { parseStatusArgs } from './lib/campaign-status/cli.ts';
export type {
  CheckpointMeta,
  ConfigSummaryInput,
  ForgeCounts,
  LedgerFinding,
  LedgerJson,
  QueueIssue,
  QueueJson,
  Route,
  StatusArgs,
  StatusMode,
} from './lib/campaign-status/types.ts';

// Issue #800 (ADR-030) — dashboard surfacing for the advisory plugin-cache drift signal
// (mechanism 2 of the composite fix; mechanism 1 is `src/agents/reviewer.md`'s V-PLUGIN-01 PR
// gate). Warns only on a confirmed content mismatch — a signal that hasn't been written yet, or
// reports no installed cache, or reports a match, all render silently, matching
// `.blackhole/plugin-drift.json`'s `hooks_hash_match: false` as the sole warning condition.
export function renderPluginDriftWarning(signal: PluginDriftSignal | null): string {
  if (!signal || signal.hooks_hash_match !== false) return '';
  return (
    '⚠ Plugin cache drift: the installed Claude Code plugin cache\'s hooks/ content differs ' +
    'from this repo\'s build output (.blackhole/plugin-drift.json). See ' +
    'src/references/blackhole-state.md § Plugin-Drift Signal for the refresh path.'
  );
}

function main() {
  const { mode, campaignDir, skipGh } = parseStatusArgs(process.argv.slice(2));

  const { config, queue, ledger, checkpoint, checkpointBody } =
    loadCampaignState(campaignDir);

  // The routine-resume confirmation gate (coordinator.md § Bootstrap preflight) prints only
  // this — no forge call, no queue/ledger rendering.
  if (mode === 'config-summary') {
    console.log(renderConfigSummary(config));
    return;
  }

  const scope = readScope(config);

  const forge = skipGh
    ? { openIssues: 0, openPrs: 0, ok: false, error: 'skipped' }
    : fetchForgeCounts(scope, config.repo ?? '');

  const dashboard = formatDashboard({
    scope,
    checkpoint,
    queue,
    ledger,
    forge,
    checkpointBody,
  });

  console.log(dashboard);

  const driftPath = path.join(campaignDir, 'plugin-drift.json');
  if (fs.existsSync(driftPath)) {
    const warning = renderPluginDriftWarning(readJsonFile(driftPath, driftPath) as PluginDriftSignal);
    if (warning) console.log(warning);
  }
}

if (import.meta.main) {
  main();
}
