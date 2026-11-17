import * as fs from 'fs';
import * as path from 'path';
import { readScope } from './forge-scope.ts';
import { parseStatusArgs } from './lib/campaign-status/cli.ts';
import { formatDashboard, renderConfigSummary } from './lib/campaign-status/dashboard.ts';
import { collectDenyCounts } from './lib/campaign-status/deny-counts.ts';
import { fetchForgeCounts, fetchMergedPrs } from './lib/campaign-status/forge.ts';
import { writeStatusData } from './lib/campaign-status/data.ts';
import { fetchPrSignals } from './lib/campaign-status/pr-signals.ts';
import { renderStatusHtml } from './lib/campaign-status/html.ts';
import { readPublishState, readStatusAlerts, statusPageEnabled } from './lib/campaign-status/staleness.ts';
import { buildBudgetView } from './lib/campaign-status/budget.ts';
import { buildLaunchSummary, gateCards, renderLaunchSummary, type StatusArtifact, type StatusPageInput } from './lib/campaign-status/launch-summary.ts';
import type { RateLimits } from './lib/pace-gate.ts';
import { parseUsage } from './usage-budget.ts';
import { buildStatusReport } from './lib/campaign-status/report.ts';
import { CampaignNotFoundError, loadCampaignState } from './lib/campaign-status/state.ts';
import { readJsonFile } from './lib/fs.ts';
import { createForgeAdapter } from './lib/forge-adapter/index.ts';
import type { ForgeAdapter } from './lib/forge-adapter/types.ts';
import { isForgeType, resolveForgeForRepo } from './lib/forge-detection.ts';
import { formatPaceLine, readLatestPaceRecord } from './lib/pace-log.ts';
import type { PluginDriftSignal, PluginDriftSource } from './plugin-drift-signal.ts';
import type { StatusReport } from './lib/campaign-status/types.ts';

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
export { buildStatusReport } from './lib/campaign-status/report.ts';
export { escapeHtml, renderStatusHtml } from './lib/campaign-status/html.ts';
export { parseStatusArgs } from './lib/campaign-status/cli.ts';
export type {
  ReadyToMergeItem,
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
  StatusReport,
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

// ADR-044 § A-5 — the disclosure is unconditional: it appears whether the render is a warning
// OR a fully clean signal. A clean render is exactly the case that needs qualifying (a fifth,
// unscanned enforcement source can still be silently vetoing) — attaching the note only to the
// warning path would repeat this issue's own founding error, a render asserting more confidence
// than its evidence supports. `signal.scan_boundary` (not a restated copy) is the one canonical
// text (`SCAN_BOUNDARY_NOTE`, `plugin-drift-signal.ts`) so the JSON field and this line can never
// drift apart (V-DOC-05).
export function renderPluginDriftWarning(signal: PluginDriftSignal | null): string {
  if (!signal) return '';
  const nonClean = signal.sources.filter((s) => !isCleanSource(s));
  const lines: string[] = [];

  if (nonClean.length === 0 && signal.veto_pairs.length === 0) {
    lines.push('✓ Plugin cache: every registered source within scan boundary is clean.');
  } else {
    lines.push(
      '⚠ Plugin cache drift: at least one registered PreToolUse source is unverified or differs ' +
        'from this repo\'s build output (.blackhole/plugin-drift.json). See ' +
        'src/references/blackhole-state.md § Plugin-Drift Signal for the refresh path.',
    );
    for (const s of nonClean) {
      lines.push(`  - layer ${s.layer} (${s.label}): ${describeSourceState(s)}`);
    }
    for (const pair of signal.veto_pairs) {
      lines.push(
        `  - veto: layer ${pair.older_layer} (${pair.older_label}) is ${pair.hook_commits_behind ?? '?'} hook-touching ` +
          `commit(s) behind layer ${pair.newer_layer} (${pair.newer_label}) and can still override it (deny-wins)`,
      );
    }
  }
  lines.push(signal.scan_boundary);
  return lines.join('\n');
}

// Pace and plugin-drift lines, read once and shared by the text dashboard and the report modes.
function readHostLines(campaignDir: string): { pace: string | null; drift: string | null } {
  const latestPace = readLatestPaceRecord(path.join(campaignDir, 'pace-log.jsonl'));
  const driftPath = path.join(campaignDir, 'plugin-drift.json');
  const drift = fs.existsSync(driftPath)
    ? renderPluginDriftWarning(readJsonFile(driftPath, driftPath) as PluginDriftSignal) || null
    : null;
  return { pace: latestPace ? formatPaceLine(latestPace) : null, drift };
}

/** The plugin's own version: its `.claude-plugin/plugin.json`, else its `package.json`; null when neither reads. */
export function readPluginVersion(pluginRoot: string = path.join(import.meta.dir, '..')): string | null {
  for (const file of [path.join(pluginRoot, '.claude-plugin', 'plugin.json'), path.join(pluginRoot, 'package.json')]) {
    try {
      const version = (readJsonFile(file, file) as { version?: unknown }).version;
      if (typeof version === 'string' && version) return version;
    } catch {
      // Try the next file.
    }
  }
  return null;
}

/** The open PRs the board shows: those queue entries name while in flight, then the ones no entry names. */
const boardPrs = (queue: { issues?: Record<string, { status?: string; pr?: number | null }> }, openPrList: Array<{ number: number }> | undefined): number[] => {
  const open = new Set((openPrList ?? []).map((p) => p.number));
  const named = Object.values(queue.issues ?? {}).filter((i) => i.status === 'in-flight' && i.pr != null).map((i) => i.pr as number);
  return [...new Set([...named.filter((n) => open.has(n)), ...open])];
};

/**
 * Loads the campaign and builds the one `StatusReport` every mode prints. `skipGh` makes no forge
 * call at all; otherwise, through the adapter of the configured forge (GitHub, Gitea or GitLab),
 * the forge counts, then the review/CI/conflict signal of each open PR the board shows
 * (`PR_SIGNAL_CAP` at most) and the merged PRs, are read. `adapter` replaces the configured forge's
 * own, for a test.
 */
export async function collectStatusReport(
  campaignDir: string,
  skipGh: boolean,
  generatedAt: string = new Date().toISOString(),
  adapter?: ForgeAdapter,
): Promise<{
  report: StatusReport;
  state: ReturnType<typeof loadCampaignState>;
  host: { pace: string | null; drift: string | null };
}> {
  const state = loadCampaignState(campaignDir);
  const { config, queue, ledger, checkpoint, checkpointBody, decisions } = state;
  const scope = readScope(config);
  const resolved = resolveForgeForRepo(path.dirname(path.resolve(campaignDir)), config.forge);
  const forgeType = resolved.ok ? resolved.forge : config.forge && isForgeType(config.forge) ? config.forge : 'github';
  const source = skipGh || !config.repo ? null : (adapter ?? createForgeAdapter({ repo: config.repo, forge: forgeType }));
  const forge = source
    ? await fetchForgeCounts(scope, source)
    : { openIssues: 0, openPrs: 0, ok: false, error: skipGh ? 'skipped' : 'no repo in config.json' };
  const prSignals = source && forge.ok ? await fetchPrSignals(source, boardPrs(queue, forge.openPrList)) : null;
  const mergedPrs = source && forge.ok ? await fetchMergedPrs(source) : null;
  const host = readHostLines(campaignDir);
  const report = buildStatusReport({
    config,
    forgeWeb: resolved.ok ? { forge: resolved.forge, host: resolved.host } : undefined,
    queue,
    ledger,
    checkpoint,
    checkpointBody,
    forge,
    paceLine: host.pace,
    hostNotes: host.drift ? host.drift.split('\n') : [],
    generatedAt,
    publish: readPublishState(campaignDir),
    decisions,
    prSignals,
    mergedPrs,
    pluginVersion: readPluginVersion(),
    denyCounts: collectDenyCounts(campaignDir, queue.campaign_started_at ?? null),
  });
  return { report, state, host };
}

/** The shipped status-page template's `bh-template-version`, or null when it cannot be read. */
export function readTemplateVersion(pluginRoot: string = path.join(import.meta.dir, '..')): number | null {
  try {
    const html = fs.readFileSync(path.join(pluginRoot, 'templates', 'status-dashboard', 'index.html'), 'utf-8');
    const match = /<meta name="bh-template-version" content="(\d+)">/.exec(html);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

const readJsonOrNull = (file: string): unknown => {
  try {
    return fs.existsSync(file) ? readJsonFile(file, file) : null;
  } catch {
    return null;
  }
};

/** The Status page row's inputs: config, host, `status-artifact.json` and the shipped template version. */
function readStatusPageInput(campaignDir: string, config: Parameters<typeof statusPageEnabled>[0], nowIso: string): StatusPageInput {
  const artifact = readJsonOrNull(path.join(campaignDir, 'status-artifact.json'));
  return {
    enabled: statusPageEnabled(config),
    publishExpected: readPublishState(campaignDir).publishExpected,
    artifact: artifact && typeof artifact === 'object' && !Array.isArray(artifact) ? (artifact as StatusArtifact) : null,
    templateVersion: readTemplateVersion(),
    nowIso,
  };
}

/** Print-only mode (`launch-gate.md`): sleep mode is on, or the run context reports no question channel. */
function readPrintOnly(campaignDir: string, config: Record<string, unknown>): boolean {
  const sleep = (config.sleep_mode ?? {}) as { enabled?: unknown };
  const route = (readJsonOrNull(path.join(campaignDir, 'run-context.json')) ?? {}) as { route?: { question_channel?: unknown } };
  return sleep.enabled === true || route.route?.question_channel === 'none';
}

/** `--summary`: the launch gate's seven rows and question cards (`launch-gate.md`). */
async function printLaunchSummary(campaignDir: string, skipGh: boolean, usageJson: string | null, now: number | null, asJson: boolean) {
  let usage: RateLimits | null = null;
  if (usageJson !== null) {
    try {
      usage = parseUsage(usageJson);
    } catch (error) {
      console.error(`status --summary: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    }
  }
  const nowS = now ?? Math.floor(Date.now() / 1000);
  const nowIso = new Date(nowS * 1000).toISOString();
  let collected: Awaited<ReturnType<typeof collectStatusReport>>;
  try {
    collected = await collectStatusReport(campaignDir, skipGh, nowIso);
  } catch (error) {
    if (error instanceof CampaignNotFoundError) return console.log(error.message);
    throw error;
  }
  const config = collected.state.config as Record<string, unknown>;
  const rows = buildLaunchSummary({
    report: collected.report,
    config,
    budget: buildBudgetView({ config, usage, now: nowS }),
    statusPage: readStatusPageInput(campaignDir, collected.state.config, nowIso),
  });
  if (asJson) {
    console.log(JSON.stringify({ rows, cards: gateCards(rows, { printOnly: readPrintOnly(campaignDir, config) }) }, null, 2));
    return;
  }
  console.log(renderLaunchSummary(rows));
}

async function main() {
  const { mode, campaignDir, skipGh, outPath, dataDir, usage, now, summaryJson } = parseStatusArgs(process.argv.slice(2));

  if (mode === 'summary') return printLaunchSummary(campaignDir, skipGh, usage, now, summaryJson);

  if (mode === 'config-summary') {
    // The routine-resume confirmation gate (coordinator.md § Bootstrap preflight) prints only
    // this — no forge call, no queue/ledger rendering.
    let config: ReturnType<typeof loadCampaignState>['config'];
    try {
      config = loadCampaignState(campaignDir).config;
    } catch (error) {
      if (error instanceof CampaignNotFoundError) return console.log(error.message);
      throw error;
    }
    console.log(renderConfigSummary(config));
    return;
  }

  let collected: Awaited<ReturnType<typeof collectStatusReport>>;
  try {
    collected = await collectStatusReport(campaignDir, skipGh);
  } catch (error) {
    // "No campaign here" is a normal, expected state (fresh checkout, wrong --campaign-dir) —
    // print the message and exit 0 (falling off main() already does; no process.exit needed).
    // Anything else (e.g. a corrupt config.json) rethrows uncaught, preserving today's
    // crash-with-stack-trace behavior — AC 2 requires the two cases stay distinguishable.
    if (error instanceof CampaignNotFoundError) {
      console.log(error.message);
      return;
    }
    throw error;
  }
  const { report, state, host } = collected;

  if (mode === 'json' || mode === 'html' || mode === 'data') {
    // stdout carries the JSON, the page path or the row files, so the loud lines go to stderr.
    if (mode !== 'json') for (const alert of report.alerts) console.error(alert.message);
    if (mode === 'json') {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    if (mode === 'data') {
      for (const file of writeStatusData(dataDir as string, report)) console.log(file);
      return;
    }
    const target = outPath ?? path.join(campaignDir, '.tmp', 'status.html');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, renderStatusHtml(report));
    fs.renameSync(`${target}.tmp`, target);
    console.log(target);
    return;
  }

  const dashboard = formatDashboard({
    scope: readScope(state.config),
    checkpoint: state.checkpoint,
    queue: state.queue,
    ledger: state.ledger,
    forge: report.forge,
    checkpointBody: state.checkpointBody,
    view: report,
  });

  for (const alert of readStatusAlerts(campaignDir, state, report.generated_at)) console.log(alert.message);
  console.log(dashboard);
  if (host.pace) console.log(host.pace);
  if (host.drift) console.log(host.drift);
}

if (import.meta.main) {
  await main();
}
