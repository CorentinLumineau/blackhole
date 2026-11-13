import { SECTION_CAP } from './dashboard.ts';
import { classPreview } from './blocked-classes.ts';
import { elseClasses, inProgressItems, ownerDetail, readyToMergeDetail } from './report.ts';
import type { BlockedClass, ReadyToMergeItem, StatusItem, StatusReport, StatusStateKind } from './types.ts';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML element content and quoted attributes. Every value from state goes through this. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// Plain-text campaign name for the <title> and header: the repo, else the scope.
function campaignName(report: StatusReport): string {
  const { repo, scope } = report.campaign;
  if (repo) return repo;
  if (scope.milestone) return `milestone ${scope.milestone}`;
  if (scope.labels.length) return `labels ${scope.labels.join(', ')}`;
  return 'all open issues';
}

const empty = (text: string): string => `<p class="empty">${escapeHtml(text)}</p>`;

// The only links on the page. A URL that is not http(s) is dropped, never rendered as an href.
const isHttpUrl = (url: string): boolean => /^https?:\/\//i.test(url);

const link = (href: string, label: string): string =>
  `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;

function itemLi(item: StatusItem, detail: string = item.next_step): string {
  const meta = [item.phase, item.pr != null ? `PR #${item.pr}` : null].filter(Boolean).join(' · ');
  const open = item.pr_url && isHttpUrl(item.pr_url) ? ` ${link(item.pr_url, 'Open PR ↗')}` : '';
  return [
    '<li>',
    `<span class="num">#${escapeHtml(item.issue)}</span> ${escapeHtml(item.title)}`,
    meta ? ` <span class="meta">${escapeHtml(meta)}</span>` : '',
    open,
    `<div class="next">${escapeHtml(detail)}</div>`,
    '</li>',
  ].join('');
}

const itemList = (items: StatusItem[], none: string, detail?: (i: StatusItem) => string): string =>
  items.length ? `<ul class="items">${items.map((i) => itemLi(i, detail?.(i))).join('')}</ul>` : empty(none);

const lineList = (lines: string[]): string =>
  `<ul class="lines">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;

function section(title: string, body: string, count?: number): string {
  const badge = count != null ? ` <span class="count">${escapeHtml(count)}</span>` : '';
  return `<section><h2>${escapeHtml(title)}${badge}</h2>${body}</section>`;
}

const STATE_LABEL: Record<StatusStateKind, { mark: string; label: string }> = {
  running: { mark: '●', label: 'RUNNING' },
  waiting_on_you: { mark: '■', label: 'WAITING ON YOU' },
  idle: { mark: '◐', label: 'IDLE' },
  done: { mark: '✓', label: 'DONE' },
  stale: { mark: '⚠', label: 'STALE' },
};

function agoText(lastIso: string, nowIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(lastIso)) / 60_000));
  if (Number.isNaN(minutes)) return lastIso;
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

// "2026-11-12 11:56 UTC" from an ISO timestamp.
const utcText = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
};

function banner(r: StatusReport, name: string): string {
  const { state } = r;
  const { mark, label } = STATE_LABEL[state.kind];
  const activity = state.last_activity_at
    ? `Last activity: ${agoText(state.last_activity_at, r.generated_at)} (${utcText(state.last_activity_at)})`
    : 'Last activity: unknown';
  return [
    `<header class="banner state-${state.kind.replaceAll('_', '-')}">`,
    `<h1>Blackhole — ${escapeHtml(name)} · Turn ${escapeHtml(r.checkpoint.turn ?? '—')}</h1>`,
    `<p class="state"><span class="mark" aria-hidden="true">${mark}</span> ${label} — ${escapeHtml(state.reason)}</p>`,
    `<p>${escapeHtml(activity)}</p>`,
    `<p>Your next action: ${escapeHtml(state.next_action)}</p>`,
    '</header>',
  ].join('');
}

function readyLi(r: StatusReport, item: ReadyToMergeItem): string {
  const ref = `${r.campaign.repo ?? ''}#${item.pr}`;
  const links = isHttpUrl(item.pr_url)
    ? ` ${link(item.pr_url, 'Open PR ↗')} ${link(`${item.pr_url}/files`, 'Files changed ↗')}`
    : '';
  return [
    '<li>',
    `<span class="num">${escapeHtml(ref)}</span>${links}`,
    `<div>${escapeHtml(item.title)} <span class="meta">#${escapeHtml(item.issue)}</span></div>`,
    `<div class="next">${escapeHtml(readyToMergeDetail(item))}</div>`,
    '</li>',
  ].join('');
}

function progressSection(r: StatusReport): string {
  const items = inProgressItems(r);
  return section('In progress', itemList(items, 'No issue is being planned, implemented or reviewed.'), items.length);
}

function ownerSection(r: StatusReport): string {
  const rows = [
    ...r.ready_to_merge.map((i) => readyLi(r, i)),
    ...r.waiting_on_owner.map((i) => itemLi(i, ownerDetail(i))),
  ];
  const body = rows.length ? `<ul class="items">${rows.join('')}</ul>` : empty('Nothing is waiting on you.');
  return section('Waiting on you', body, rows.length);
}

// One visible line per class: the summary shows the count and the first few issue numbers; the full list sits
// inside the native <details>, folded. No class is open by default, so another lane's items stay out of sight.
function classLi(c: BlockedClass): string {
  const preview = classPreview(c.issues, c.count);
  const first = preview.first.map((i) => `#${escapeHtml(i.issue)}`).join(', ');
  const more = preview.more > 0 ? ` and ${escapeHtml(preview.more)} more` : '';
  return (
    `<li><details class="cls"${c.attention ? ' open' : ''}><summary><span class="wait">${escapeHtml(c.label)}</span> ` +
    `<span class="count">${escapeHtml(c.count)}</span> <span class="meta">${first}${more}</span></summary>` +
    `<ul class="items">${c.issues.map((i) => itemLi(i, i.notes?.trim() || i.next_step)).join('')}</ul></details></li>`
  );
}

function elseSection(r: StatusReport): string {
  const classes = elseClasses(r);
  const count = classes.reduce((n, c) => n + c.count, 0);
  if (count === 0) return section('Waiting on something else', empty('Nothing else is blocked.'), 0);
  return section('Waiting on something else', `<ul class="groups">${classes.map(classLi).join('')}</ul>`, count);
}

const numberedLine = (i: StatusItem): string => `<li><span class="num">#${escapeHtml(i.issue)}</span> ${escapeHtml(i.title)}</li>`;

function upNextSection(r: StatusReport): string {
  if (r.ready.length === 0) return section('Up next', empty('The ready set is empty.'), 0);
  const more = r.ready.length - SECTION_CAP;
  const rows = r.ready.slice(0, SECTION_CAP).map(numberedLine).join('');
  const tail = more > 0 ? `<li class="meta">+${escapeHtml(more)} more</li>` : '';
  return section('Up next', `<ul class="lines">${rows}${tail}</ul>`, r.ready.length);
}

function doneSection(r: StatusReport): string {
  const body = r.recently_done.length
    ? `<ul class="lines">${r.recently_done.map(numberedLine).join('')}</ul>`
    : empty('Nothing has merged yet.');
  return section('Recently done', body, r.recently_done.length);
}

function hostSection(r: StatusReport): string {
  const forge = r.forge.ok
    ? `Forge: ${r.forge.openIssues} open issues · ${r.forge.openPrs} open PRs`
    : `Forge: unavailable (${r.forge.error ?? 'request failed'})`;
  const lines = [forge, `Queue health: ${r.queue_health}`, r.host.pace ?? 'Pace: no record yet', ...r.host.notes];
  return section('Host and environment', lineList(lines));
}

function eventsSection(r: StatusReport): string {
  const { notes, active_workers } = r.checkpoint;
  if (notes.length === 0 && active_workers.length === 0) {
    return section('Recent events', empty('The checkpoint has no notes yet.'));
  }
  const body = [
    notes.length ? `<h3>Notes</h3>${lineList(notes)}` : '',
    active_workers.length ? `<h3>Active workers</h3>${lineList(active_workers)}` : '',
  ].join('');
  return section('Recent events', body);
}

function findingsSection(r: StatusReport): string {
  if (r.ledger_open.length === 0) return section('Open findings', empty('No open findings.'), 0);
  const rows = r.ledger_open.map(
    (f) =>
      `<li><span class="sev sev-${escapeHtml((f.severity ?? '').toLowerCase())}">${escapeHtml(f.severity ?? '?')}</span>` +
      ` <code>${escapeHtml(f.vcode ?? '')}</code> ${escapeHtml(f.summary)}` +
      `${f.issue_ref != null ? ` <span class="meta">#${escapeHtml(f.issue_ref)}</span>` : ''}</li>`,
  );
  return section('Open findings', `<ul class="lines">${rows.join('')}</ul>`, r.ledger_open.length);
}

const STYLE = `
:root {
  --bg: #f7f7f5; --surface: #ffffff; --text: #1d1d1b; --muted: #5f5f5a; --border: #e2e1dc;
  --accent: #2f5bd3; --warn: #a15c00; --block: #b3261e; --ok: #2e7d32;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615; --surface: #1f1f1d; --text: #ecebe6; --muted: #a3a29b; --border: #33322f;
    --accent: #8ab0ff; --warn: #f0b35a; --block: #ff8a80; --ok: #81c784;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 16px; }
header h1 { font-size: 1.35rem; margin: 0 0 4px; overflow-wrap: anywhere; }
header p { margin: 2px 0 0; overflow-wrap: anywhere; }
.banner { background: var(--surface); border: 1px solid var(--border); border-left: 6px solid var(--muted);
  border-radius: 6px; padding: 12px 14px; }
.banner .state { font-size: 1.15rem; font-weight: 700; }
.state-running { border-left-color: var(--ok); } .state-running .state { color: var(--ok); }
.state-waiting-on-you { border-left-color: var(--accent); } .state-waiting-on-you .state { color: var(--accent); }
.state-stale { border-left-color: var(--block); } .state-stale .state { color: var(--block); }
.state-done { border-left-color: var(--ok); } .state-done .state { color: var(--ok); }
.state-idle { border-left-color: var(--warn); } .state-idle .state { color: var(--warn); }
details { margin-top: 16px; border-top: 1px solid var(--border); padding-top: 8px; }
summary { cursor: pointer; font-weight: 600; padding: 6px 0; }
details.cls { margin-top: 0; border-top: 0; padding-top: 0; }
details.cls > ul { margin-left: 12px; }
li > ul { margin: 4px 0 0 12px; }
section { background: var(--surface); border-top: 1px solid var(--border); padding: 12px 0 4px; margin-top: 12px; }
h2 { font-size: 1.05rem; margin: 0 0 8px; }
h3 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 12px 0 4px; }
ul { list-style: none; margin: 0; padding: 0; }
li { padding: 6px 0; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
li:last-child { border-bottom: 0; }
.num, .wait { font-weight: 600; }
.meta, .nums { color: var(--muted); font-size: 0.88rem; }
.next { color: var(--accent); font-size: 0.9rem; }
.count { display: inline-block; min-width: 1.6em; padding: 0 6px; border-radius: 9px; text-align: center;
  font-size: 0.8rem; background: var(--border); color: var(--text); }
.tag { font-size: 0.75rem; color: var(--warn); font-weight: 600; }
.sev { font-size: 0.75rem; font-weight: 700; }
.sev-block { color: var(--block); } .sev-warn { color: var(--warn); }
.empty { color: var(--muted); font-style: italic; margin: 4px 0; }
code { font-size: 0.85em; }
a { color: var(--accent); margin-left: 8px; }
`;

/** Self-contained status page: inline CSS, no script, nothing loaded from the network; the only links are the
 * forge PR anchors in "Waiting on you" (`target=_blank rel=noopener`, http(s) only). */
export function renderStatusHtml(report: StatusReport): string {
  const name = campaignName(report);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Blackhole status — ${escapeHtml(name)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    '<main>',
    banner(report, name),
    progressSection(report),
    ownerSection(report),
    elseSection(report),
    upNextSection(report),
    doneSection(report),
    '<details><summary>Details</summary>',
    hostSection(report),
    eventsSection(report),
    findingsSection(report),
    '</details>',
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
