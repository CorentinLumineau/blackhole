import * as fs from 'fs';
import * as path from 'path';
import { readScope } from './forge-scope.ts';
import { parseStatusArgs } from './lib/campaign-status/cli.ts';
import { formatDashboard, renderConfigSummary } from './lib/campaign-status/dashboard.ts';
import { fetchForgeCounts } from './lib/campaign-status/forge.ts';
import { loadCampaignState } from './lib/campaign-status/state.ts';
import { readJsonFile } from './lib/fs.ts';
import type { PluginDriftSignal, PluginDriftSource } from './plugin-drift-signal.ts';

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

// Issue #912 (ADR-044) — widens dashboard surfacing for the advisory plugin-cache drift signal
// (mechanism 2 of ADR-030's composite fix; mechanism 1 is `src/agents/reviewer.md`'s V-PLUGIN-01
// PR gate) from a single hash-match boolean to one line per non-clean registered source, plus a
// line per `veto_pairs[]` entry. A foreign source of unverifiable provenance is NEVER clean —
// it renders in the green fixture as well as the red one (ADR-044 § Falsifiability) — so a fully
// silent render now means "every present source both resolves to a proven identity AND matches
// origin/main", strictly narrower than the old "hash comparison happened to match" bar.
function isCleanSource(s: PluginDriftSource): boolean {
  if (s.outcome === 'no-baseline') return !s.present; // an absent/unregistered layer is not drift
  if (s.outcome === 'version-differs-unproven') return false;
  return s.relation_to_origin_main === 'identical';
}

function describeSourceState(s: PluginDriftSource): string {
  if (s.outcome === 'no-baseline') return 'baseline: none (foreign or unverifiable provenance)';
  if (s.outcome === 'version-differs-unproven') return 'version differs from the repo build, ordering unproven';
  if (s.relation_to_origin_main === 'diverged') return 'diverged from origin/main';
  if (s.relation_to_origin_main === 'older') return `${s.hook_commits_behind ?? '?'} hook-touching commit(s) behind origin/main`;
  if (s.relation_to_origin_main === 'newer') return 'ahead of origin/main';
  return 'ordering unavailable';
}

export function renderPluginDriftWarning(signal: PluginDriftSignal | null): string {
  if (!signal) return '';
  const nonClean = signal.sources.filter((s) => !isCleanSource(s));
  if (nonClean.length === 0 && signal.veto_pairs.length === 0) return '';

  const lines = [
    '⚠ Plugin cache drift: at least one registered PreToolUse source is unverified or differs ' +
      'from this repo\'s build output (.blackhole/plugin-drift.json). See ' +
      'src/references/blackhole-state.md § Plugin-Drift Signal for the refresh path.',
  ];
  for (const s of nonClean) {
    lines.push(`  - layer ${s.layer} (${s.label}): ${describeSourceState(s)}`);
  }
  for (const pair of signal.veto_pairs) {
    lines.push(
      `  - veto: layer ${pair.older_layer} (${pair.older_label}) is ${pair.hook_commits_behind ?? '?'} hook-touching ` +
        `commit(s) behind layer ${pair.newer_layer} (${pair.newer_label}) and can still override it (deny-wins)`,
    );
  }
  return lines.join('\n');
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
