import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readScope } from './forge-scope.ts';
import { parseStatusArgs } from './lib/campaign-status/cli.ts';
import { readLaneConfig } from './lib/lane.ts';
import { formatDashboard, renderConfigSummary } from './lib/campaign-status/dashboard.ts';
import { buildBudgetPanel, givenBudgetPanel, readBudgetPanel, resolveBudgetSettings } from './lib/campaign-status/budget.ts';
import { adjustPacing, applyOverrides, floorBudget, localUtcOffsetMinutes, readPacing, resolveCatchup } from './lib/catchup.ts';
import { DEFAULT_USAGE_BUDGET } from './lib/usage-budget.ts';
import { isSleepMode, readPendingDecisions } from './lib/campaign-status/pending-decisions.ts';
import { buildDocCarry, type DocCarryIssue, type DocCarryRead, type PendingRead } from './lib/campaign-status/run-state.ts';
import { loadManifest, type Manifest } from './lib/carry-staged-artifacts.ts';
import { latestRoute, promisedRoutes } from './lib/route-artifacts.ts';
import { resolveHost, usageSourceFor } from './lib/usage-source.ts';
import { collectDenyCounts } from './lib/campaign-status/deny-counts.ts';
import { crossRepoBlockersOf, fetchForgeCounts, fetchMergedPrs, readOpenIssues } from './lib/campaign-status/forge.ts';
import { readPrLanding } from './lib/forge-adapter/pr-landing.ts';
import { DONE_STATUSES } from './lib/campaign-status/queue.ts';
import { writeStatusData } from './lib/campaign-status/data.ts';
import { fetchPrSignals } from './lib/campaign-status/pr-signals.ts';
import { renderStatusHtml } from './lib/campaign-status/html.ts';
import { readPublishState, readStatusAlerts, statusPageEnabled } from './lib/campaign-status/staleness.ts';
import { buildLaunchSummary, gateCards, renderLaunchSummary, type CatchupInput } from './lib/campaign-status/launch-summary.ts';
import { detectForCampaign } from './peer-campaigns.ts';
import type { StatusArtifact, StatusPageInput } from './lib/campaign-status/status-page-row.ts';
import type { RateLimits } from './lib/rate-limit-cache.ts';
import { parseUsage } from './usage-budget.ts';
import { buildStatusReport } from './lib/campaign-status/report.ts';
import { CampaignNotFoundError, loadCampaignState } from './lib/campaign-status/state.ts';
import { readJsonFile } from './lib/fs.ts';
import { createForgeAdapter } from './lib/forge-adapter/index.ts';
import type { ForgeAdapter } from './lib/forge-adapter/types.ts';
import { isForgeType, resolveForgeForRepo } from './lib/forge-detection.ts';
import { formatPaceLine, readLatestPaceRecord } from './lib/pace-log.ts';
import { USAGE_HISTORY_FILE } from './lib/usage-history.ts';
import { forgeDeclaredCrossRepo } from './lib/pr-dependencies.ts';
import type { PluginDriftSignal, PluginDriftSource } from './plugin-drift-signal.ts';
import type { CatchupArgs, StatusReport } from './lib/campaign-status/types.ts';
import { pluginVersionWarning, readPluginVersion, readPluginVersionCheck } from './lib/plugin-drift.ts';
import { projectIdentity } from './project-identity.ts';

const PLUGIN_ROOT = path.join(import.meta.dir, '..');

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

/** The open PRs the board shows: those queue entries name while in flight, then the ones no entry names. */
const boardPrs = (queue: { issues?: Record<string, { status?: string; pr?: number | null }> }, openPrList: Array<{ number: number }> | undefined): number[] => {
  const open = new Set((openPrList ?? []).map((p) => p.number));
  const named = Object.values(queue.issues ?? {}).filter((i) => i.status === 'in-flight' && i.pr != null).map((i) => i.pr as number);
  return [...new Set([...named.filter((n) => open.has(n)), ...open])];
};

/** Queue issues not yet merged or closed: the ones a cross-repo dependency can still hold up. */
const openQueueIssues = (queue: { issues?: Record<string, { status?: string }> }): Set<number> =>
  new Set(
    Object.entries(queue.issues ?? {})
      .filter(([, i]) => !DONE_STATUSES.includes(i.status ?? ''))
      .map(([n]) => Number(n)),
  );

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
  /** Unmet cross-repo dependencies of open queue issues; undefined when the forge was not read. */
  crossRepoBlockers?: ReturnType<typeof crossRepoBlockersOf>;
}> {
  const state = loadCampaignState(campaignDir);
  const { config, queue, ledger, checkpoint, checkpointBody, decisions } = state;
  const scope = readScope(config);
  const resolved = resolveForgeForRepo(path.dirname(path.resolve(campaignDir)), config.forge);
  const forgeType = resolved.ok ? resolved.forge : config.forge && isForgeType(config.forge) ? config.forge : 'github';
  const source = skipGh || !config.repo ? null : (adapter ?? createForgeAdapter({ repo: config.repo, forge: forgeType }));
  // One open-issue read per run, shared by the counts and the cross-repo blockers.
  const openIssues = source ? await readOpenIssues(source) : null;
  const forge = source && openIssues
    ? await fetchForgeCounts(scope, source, openIssues)
    : { openIssues: 0, openPrs: 0, ok: false, error: skipGh ? 'skipped' : 'no repo in config.json' };
  const prSignals = source && forge.ok ? await fetchPrSignals(source, boardPrs(queue, forge.openPrList)) : null;
  const mergedPrs = source && forge.ok ? await fetchMergedPrs(source) : null;
  const crossRepoBlockers = openIssues
    ? crossRepoBlockersOf(openIssues, openQueueIssues(queue), (repo, n) => readPrLanding(forgeType, repo, n), forgeDeclaredCrossRepo(queue.issues ?? {}))
    : undefined;
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
    pluginVersion: readPluginVersion(PLUGIN_ROOT),
    denyCounts: collectDenyCounts(campaignDir, queue.campaign_started_at ?? null),
    budget: readBudgetPanel(config as Record<string, unknown>, resolveHost(campaignDir, process.env), undefined, path.join(campaignDir, USAGE_HISTORY_FILE)),
    runContext: readJsonOrNull(path.join(campaignDir, 'run-context.json')),
    pending: readPending(campaignDir),
    docCarry: readDocCarry(campaignDir, config as Record<string, any>, queue, ledger),
  });
  return { report, state, host, crossRepoBlockers };
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

/** Doc carry totals from each issue's route and `staged/<n>/manifest.json`; null when docs governance is off (gate as `route-artifacts.ts`). */
function readDocCarry(campaignDir: string, config: Record<string, any>, queue: QueueJson, ledger: LedgerJson): DocCarryRead {
  const docs = config.docs_governance;
  if (docs?.enabled !== true || docs?.write_governance === false) return null;
  try {
    const repoRoot = path.dirname(campaignDir);
    const issues: DocCarryIssue[] = [];
    for (const [key, q] of Object.entries(queue.issues ?? {})) {
      const n = Number(key);
      const done = DONE_STATUSES.includes(q?.status ?? '');
      const route = latestRoute(ledger as never, queue as never, n);
      const base = { issue: n, done, phase: q?.phase, promised: route ? promisedRoutes(route) : [] };
      let manifest: Manifest | null = null;
      try {
        manifest = loadManifest(path.join(campaignDir, 'staged', key, 'manifest.json'));
      } catch {
        if (!done) issues.push({ ...base, manifest: null, unreadable: true });
        continue;
      }
      if (route === null && !manifest) {
        if (!done) issues.push({ ...base, manifest: null, unrouted: true });
        continue;
      }
      issues.push({ ...base, manifest });
    }
    return buildDocCarry({ enabled: true, issues, isCarried: (t) => fs.existsSync(path.join(repoRoot, t)) });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** `pending-decisions.json` for the page: a malformed file is shown as unreadable, never as none parked. */
function readPending(campaignDir: string): PendingRead {
  try {
    return readPendingDecisions(campaignDir).decisions;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

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

/** The launch gate's print-only mode: sleep mode is on (`isSleepMode`), or the run context reports no question channel. */
function readPrintOnly(campaignDir: string, config: Record<string, unknown>): boolean {
  const route = (readJsonOrNull(path.join(campaignDir, 'run-context.json')) ?? {}) as { route?: { question_channel?: unknown } };
  return isSleepMode(config) || route.route?.question_channel === 'none';
}

/**
 * `--summary`: the launch gate's eight rows and question cards. The Budget row reads the same
 * `BudgetPanel` the status page shows: built from `--usage` (restricted to `usage_budget.windows`)
 * when given, else from the host's usage source at `--now`, as `report.budget` is.
 */
/**
 * The catchup launch inputs: the preset with this invocation's overrides applied, the pace reading
 * through the provider chain (`--usage-file` first), and the floor budget the Budget row judges by.
 * An invalid `catchup` block becomes `{ invalid }`, shown on the Pacing row; a bad override exits 2.
 */
function readCatchup(config: Record<string, unknown>, host: ReturnType<typeof resolveHost>, flags: CatchupArgs, nowS: number) {
  let preset;
  try {
    preset = resolveCatchup(config);
  } catch (error) {
    return { input: { invalid: error instanceof Error ? error.message : String(error) } as CatchupInput, budget: null, pacing: null, preset: null };
  }
  try {
    preset = applyOverrides(preset, { floor_pct: flags.floorPct ?? undefined, no_spawn_at: flags.noSpawnAt ?? undefined, stop_workers_at: flags.stopWorkersAt ?? undefined, lane: flags.lane ?? undefined });
    const source = usageSourceFor(host, config, { usageFile: flags.usageFile ?? undefined });
    const reading = source.read(nowS);
    const pacing = readPacing(source.report(nowS), preset, nowS, localUtcOffsetMinutes(nowS));
    const floorPct = flags.floorPct ?? pacing.floor_pct;
    const settings = resolveBudgetSettings(config);
    const budget = floorBudget(settings.invalid === null ? settings.budget : DEFAULT_USAGE_BUDGET, preset, floorPct ?? 100);
    const panel = buildBudgetPanel({ limits: reading.limits, reason: reading.reason, ageSeconds: 0, now: nowS, config, source: reading.source, budget });
    return { input: { preset, floorPct, pacing, budget } as CatchupInput, budget: panel, pacing: adjustPacing(pacing, floorPct), preset };
  } catch (error) {
    console.error(`status --summary: ${error instanceof Error ? error.message : String(error)}`);
    return process.exit(2);
  }
}

/**
 * `--summary`: the launch gate's rows and question cards (eight for `run`, nine with Pacing for
 * `--mode catchup`). The Budget row reads the same `BudgetPanel` the status page shows: built from
 * `--usage` (restricted to `usage_budget.windows`) when given, else from the host's usage source at
 * `--now`, as `report.budget` is. A catchup reads `--usage-file` through the same source chain.
 */
/** Peer detection for the Peers row (ADR-057); undefined outside a git clone or on a read error, so the row shows the configured role. */
function readPeers(campaignDir: string) {
  try {
    return detectForCampaign(campaignDir) ?? undefined;
  } catch (error) {
    console.error(`status --summary: peer detection skipped: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function printLaunchSummary(campaignDir: string, skipGh: boolean, usageJson: string | null, now: number | null, asJson: boolean, catchupFlags: CatchupArgs | null) {
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
  const host = resolveHost(campaignDir, process.env);
  const catchup = catchupFlags ? readCatchup(config, host, catchupFlags, nowS) : null;
  const rows = buildLaunchSummary({
    report: collected.report,
    config,
    budget: catchup?.budget ?? (usage ? givenBudgetPanel(usage, config, nowS) : readBudgetPanel(config, host, nowS, path.join(campaignDir, USAGE_HISTORY_FILE))),
    statusPage: readStatusPageInput(campaignDir, collected.state.config, nowIso),
    catchup: catchup?.input,
    peers: readPeers(campaignDir),
  });
  const versionWarning = pluginVersionWarning(
    readPluginVersionCheck({ running: readPluginVersion(PLUGIN_ROOT), homeDir: os.homedir(), pluginName: projectIdentity.name }),
  );
  const warnings = versionWarning ? [versionWarning] : [];
  if (asJson) {
    const pacing = catchup?.pacing ? { pacing: { ...catchup.pacing, preset: catchup.preset } } : {};
    console.log(JSON.stringify({ rows, cards: gateCards(rows, { printOnly: readPrintOnly(campaignDir, config) }), warnings, ...pacing }, null, 2));
    return;
  }
  console.log(renderLaunchSummary(rows, warnings));
}

async function main() {
  let args: ReturnType<typeof parseStatusArgs>;
  try {
    args = parseStatusArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`status: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const { mode, campaignDir, skipGh, outPath, dataDir, usage, now, summaryJson, catchup } = args;

  if (mode === 'summary') return printLaunchSummary(campaignDir, skipGh, usage, now, summaryJson, catchup);

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
  const { report, state, host, crossRepoBlockers } = collected;

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
    crossRepoBlockers,
    lane: readLaneConfig(state.config as { catchup?: unknown }).lane,
  });

  for (const alert of readStatusAlerts(campaignDir, state, report.generated_at)) console.log(alert.message);
  console.log(dashboard);
  if (host.pace) console.log(host.pace);
  if (host.drift) console.log(host.drift);
}

if (import.meta.main) {
  await main();
}
