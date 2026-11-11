import type { ReadyToMergeItem, StatusItem, StatusReport } from './types.ts';

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

function itemLi(item: StatusItem): string {
  const meta = [item.phase, item.pr != null ? `PR #${item.pr}` : null].filter(Boolean).join(' · ');
  return [
    '<li>',
    `<span class="num">#${escapeHtml(item.issue)}</span> ${escapeHtml(item.title)}`,
    meta ? ` <span class="meta">${escapeHtml(meta)}</span>` : '',
    `<div class="next">${escapeHtml(item.next_step)}</div>`,
    '</li>',
  ].join('');
}

const itemList = (items: StatusItem[], none: string): string =>
  items.length ? `<ul class="items">${items.map(itemLi).join('')}</ul>` : empty(none);

const lineList = (lines: string[]): string =>
  `<ul class="lines">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;

function section(title: string, body: string, count?: number): string {
  const badge = count != null ? ` <span class="count">${escapeHtml(count)}</span>` : '';
  return `<section><h2>${escapeHtml(title)}${badge}</h2>${body}</section>`;
}

// The only links on the page. A URL that is not http(s) is dropped, never rendered as an href.
const isHttpUrl = (url: string): boolean => /^https?:\/\//i.test(url);

function readyLi(r: StatusReport, item: ReadyToMergeItem): string {
  const ref = `${r.campaign.repo ?? ''}#${item.pr}`;
  const link = (href: string, label: string) =>
    `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
  const links = isHttpUrl(item.pr_url)
    ? ` ${link(item.pr_url, 'Open PR ↗')} ${link(`${item.pr_url}/files`, 'Files changed ↗')}`
    : '';
  return [
    '<li>',
    `<span class="num">${escapeHtml(ref)}</span>${links}`,
    `<div>${escapeHtml(item.title)} <span class="meta">#${escapeHtml(item.issue)}</span></div>`,
    '<div class="next">LGTM · CI green · no conflict</div>',
    '</li>',
  ].join('');
}

function readySection(r: StatusReport): string {
  const body = r.ready_to_merge.length
    ? `<ul class="items">${r.ready_to_merge.map((i) => readyLi(r, i)).join('')}</ul>`
    : empty('Nothing is ready to merge yet.');
  return section('Ready to merge', body, r.ready_to_merge.length);
}

function ownerSection(r: StatusReport): string {
  return section('Waiting on the owner', itemList(r.waiting_on_owner, 'Nothing is waiting on you.'), r.waiting_on_owner.length);
}

function motionSection(r: StatusReport): string {
  const parts = [
    '<h3>In flight</h3>',
    itemList(r.in_flight, 'No issue is being planned or implemented.'),
    '<h3>In review</h3>',
    itemList(r.in_review, 'No PR is in review.'),
    '<h3>Ready next</h3>',
    r.ready.length
      ? `<p class="nums">${r.ready.map((i) => `#${escapeHtml(i.issue)}`).join(', ')}</p>`
      : empty('The ready set is empty.'),
  ];
  return section('In motion', parts.join(''), r.in_flight.length + r.in_review.length);
}

function blockedSection(r: StatusReport): string {
  if (r.blocked.length === 0) return section('Blocked', empty('Nothing is blocked.'), 0);
  const rows = r.blocked.map(
    (g) =>
      `<li><span class="wait">${escapeHtml(g.waits_on)}</span>${g.owner ? ' <span class="tag">owner</span>' : ''}` +
      ` <span class="count">${escapeHtml(g.count)}</span>` +
      `<div class="nums">${g.issues.map((i) => `#${escapeHtml(i.issue)} ${escapeHtml(i.title)}`).join(' · ')}</div></li>`,
  );
  return section('Blocked', `<ul class="groups">${rows.join('')}</ul>`, r.counts.queue.blocked);
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
header p { margin: 0; color: var(--muted); font-size: 0.9rem; }
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
 * forge PR anchors in "Ready to merge" (`target=_blank rel=noopener`, http(s) only). */
export function renderStatusHtml(report: StatusReport): string {
  const name = campaignName(report);
  const q = report.counts.queue;
  const l = report.counts.ledger;
  const summary =
    `Turn ${report.checkpoint.turn ?? '—'} · checkpoint ${report.checkpoint.refreshed_at ?? '—'} · ` +
    `${q.active} active · ${q.in_flight} in flight · ${q.blocked} blocked · ${q.ready} ready · ${q.done} done · ` +
    `ledger ${l.open} open (BLOCK ${l.block}) · generated ${report.generated_at}`;
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
    `<header><h1>Blackhole status — ${escapeHtml(name)}</h1><p>${escapeHtml(summary)}</p></header>`,
    readySection(report),
    ownerSection(report),
    motionSection(report),
    blockedSection(report),
    hostSection(report),
    eventsSection(report),
    findingsSection(report),
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
