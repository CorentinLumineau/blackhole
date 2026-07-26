import { readScope } from './forge-scope.ts';
import { parseStatusArgs } from './lib/campaign-status/cli.ts';
import { formatDashboard, renderConfigSummary } from './lib/campaign-status/dashboard.ts';
import { fetchForgeCounts } from './lib/campaign-status/forge.ts';
import { loadCampaignState } from './lib/campaign-status/state.ts';

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
}

if (import.meta.main) {
  main();
}
