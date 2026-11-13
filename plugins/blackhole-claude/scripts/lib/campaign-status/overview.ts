import { checkpointSection, hasCheckpointSection } from './dashboard.ts';
import type { BlockedClass, BoardItem, ConfigSummaryInput, QueueDrift, StageCounts, StatusReport, Tone } from './types.ts';

// The header of the status page: the headline, what blocks the run, the quick links and the config
// the run works under. The orchestrator writes the headline and the blockers into the checkpoint
// (`checkpoint-protocol.md` § Checkpoint template); when it wrote none, both are generated from the
// same counts the page shows, and say so (`source: 'generated'`).

const EMPTY_MARKER = /^(none|\(none\)|-|n\/a|nothing)\.?$/i;

const sectionLines = (body: string | undefined, heading: string): string[] | null => {
  const section = checkpointSection(body, heading);
  if (section === null) return hasCheckpointSection(body, heading) ? [] : null;
  return section
    .split('\n')
    .map((l) => l.replace(/^[-*]\s+/, '').trim())
    .filter((l) => l !== '' && !EMPTY_MARKER.test(l));
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The checkpoint's `## Headline`, else one sentence built from the counts: done, on you, in review, blocked most by. */
export function buildHeadline(body: string | undefined, counts: StageCounts, topBlocked: BlockedClass | null): StatusReport['headline'] {
  const written = sectionLines(body, 'Headline')?.[0];
  if (written) return { text: written, source: 'checkpoint' };
  if (counts.total === 0) return { text: 'Nothing is queued yet.', source: 'generated' };
  const open = counts.total - counts.done - counts.parked;
  if (open === 0) return { text: `The campaign is done: ${plural(counts.done, 'item', 'items')} finished.`, source: 'generated' };
  const parts = [
    counts.on_you ? `${plural(counts.on_you, 'item waits', 'items wait')} on you` : null,
    counts.in_review ? `${counts.in_review} in review` : null,
    counts.blocked ? `${counts.blocked} blocked${topBlocked ? `, most by ${topBlocked.label.toLowerCase()}` : ''}` : null,
    counts.not_started ? `${counts.not_started} not started` : null,
  ].filter(Boolean);
  return { text: `${counts.done} of ${counts.total - counts.parked} done; ${parts.join(', ')}.`, source: 'generated' };
}

const BLOCKER_CARDS = 3;
const BLOCKER_CLASSES = 3;
const DRIFT_LISTED = 5;

/** One warning line when queue entries disagree with the forge: the page shows them as the forge has them. */
function driftBlockers(drift: QueueDrift[]): StatusReport['blockers'] {
  if (drift.length === 0) return [];
  const one = drift.length === 1;
  const listed = drift.slice(0, DRIFT_LISTED).map((d) => `#${d.pr}`).join(', ');
  const rest = drift.length > DRIFT_LISTED ? ` and ${drift.length - DRIFT_LISTED} more` : '';
  const text = `${plural(drift.length, 'queue entry says', 'queue entries say')} less than the forge: ${listed}${rest} ${one ? 'is' : 'are'} merged there. The next sync updates ${one ? 'it' : 'them'}`;
  return [{ text, tone: 'warn', source: 'generated' }];
}

/**
 * The checkpoint's `## Blocking the run` lines (an empty marker such as `none` means nothing blocks);
 * without the section: the failing or conflicting PRs, the largest blocked reason classes, and a line
 * when the forge was not read. A line for queue entries the forge contradicts follows either way.
 */
export function buildBlockers(
  body: string | undefined,
  board: BoardItem[],
  classes: BlockedClass[],
  forgeChecked: boolean,
  drift: QueueDrift[],
): StatusReport['blockers'] {
  const written = sectionLines(body, 'Blocking the run');
  if (written) return [...written.map((text) => ({ text, tone: '' as Tone, source: 'checkpoint' as const })), ...driftBlockers(drift)];
  const out: StatusReport['blockers'] = [];
  const bad = board.filter((c) => c.tone === 'bad' && c.stage !== 'done');
  for (const c of bad.slice(0, BLOCKER_CARDS)) out.push({ text: `#${c.ref} ${c.status}`, tone: 'bad', source: 'generated' });
  if (bad.length > BLOCKER_CARDS) out.push({ text: `${bad.length - BLOCKER_CARDS} more with a conflict, failing CI or a bad queue entry`, tone: 'bad', source: 'generated' });
  const real = classes.filter((c) => c.count > 0 && c.class !== 'unclassified' && c.class !== 'untracked_pr' && c.class !== 'another_lane');
  for (const c of [...real].sort((a, b) => b.count - a.count).slice(0, BLOCKER_CLASSES)) {
    out.push({ text: `${c.label}: ${plural(c.count, 'item', 'items')}`, tone: '', source: 'generated' });
  }
  if (!forgeChecked) out.push({ text: 'Forge not checked: review verdicts, CI and conflicts are not shown', tone: 'warn', source: 'generated' });
  return [...out, ...driftBlockers(drift)];
}

const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u);

/** Forge pages for the repo (when its URL can be built) and the configured `status_page.links`. */
export function buildLinks(repoUrl: string | null, forge: string, configured: ConfigSummaryInput['status_page']): StatusReport['links'] {
  const out: StatusReport['links'] = [];
  if (repoUrl) {
    out.push({ label: 'Open PRs', url: `${repoUrl}/pulls` }, { label: 'Issues', url: `${repoUrl}/issues` });
    if (forge === 'github' || forge === 'gitea') out.push({ label: 'CI runs', url: `${repoUrl}/actions` });
  }
  for (const l of configured?.links ?? []) {
    if (l && typeof l.label === 'string' && l.label.trim() && isHttp(l.url)) out.push({ label: l.label.trim(), url: l.url });
  }
  return out;
}

const scopeFilter = (c: ConfigSummaryInput): string => {
  if (c.scope_milestone) return `milestone ${c.scope_milestone}${c.scope_labels?.length ? ` and labels ${c.scope_labels.join(', ')}` : ''}`;
  if (c.scope_labels?.length) return `labels ${c.scope_labels.join(', ')}`;
  return 'all open issues';
};

/** The rules the run works under, read from `config.json`; defaults are the ones `config-template.md` documents. */
export function buildConfigRows(c: ConfigSummaryInput, pluginVersion: string | null): StatusReport['config_rows'] {
  const incident = c.incident_mode?.enabled ? `, ${c.incident_mode.parallel_max_override ?? 1} while the incident lasts` : '';
  const verification = [
    'LGTM, CI green and no conflict before a merge',
    c.display_targets?.length ? `visual evidence at ${c.display_targets.join(', ')} px` : null,
    c.resource_policy?.testlock_carveout?.allowed ? `test-lock carve-out${c.resource_policy.testlock_carveout.scope ? ` (${c.resource_policy.testlock_carveout.scope})` : ''}` : null,
  ].filter(Boolean).join('; ');
  return [
    { key: 'Merge mode', value: c.merge_mode ?? 'unset' },
    { key: 'Autonomy', value: c.autonomy?.mode ?? `gates below confidence ${c.autonomy?.confidence_threshold ?? 80}` },
    { key: 'Concurrency', value: `${c.parallel_max ?? 4} workers${incident}` },
    { key: 'Verification', value: verification },
    { key: 'Issue filter', value: scopeFilter(c) },
    { key: 'Kaizen', value: c.kaizen?.enabled ? 'on' : 'off' },
    { key: 'Plugin', value: pluginVersion ? `blackhole ${pluginVersion}` : 'version unknown' },
  ];
}
