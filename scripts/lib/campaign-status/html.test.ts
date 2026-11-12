import { describe, expect, test } from 'bun:test';
import { escapeHtml, renderStatusHtml } from './html.ts';
import { buildStatusReport } from './report.ts';
import type { QueueJson, StatusReport } from './types.ts';

const HOSTILE = `<script>alert("x")</script><img src=x onerror=alert(1)> & 'quote'`;

function report(queue: QueueJson, extra: Partial<Parameters<typeof buildStatusReport>[0]> = {}): StatusReport {
  return buildStatusReport({
    config: { repo: 'acme/widgets', scope_milestone: 'v1.0' },
    queue,
    ledger: {
      findings: [{ id: 'F-1', vcode: 'V-SEC-04', severity: 'BLOCK', status: 'open', summary: HOSTILE, issue_ref: 3 }],
    },
    checkpoint: { orchestrator_turn_id: 7, refreshed_at: '2026-11-11T10:00:00.000Z' },
    checkpointBody: `---\norchestrator_turn_id: 7\n---\n\n## Notes\n\nMerged #2 ${HOSTILE}\n`,
    forge: { openIssues: 3, openPrs: 1, ok: true },
    paceLine: 'pace: GO (session 12%)',
    hostNotes: ['⚠ Plugin cache drift: layer 2'],
    generatedAt: '2026-11-11T12:00:00.000Z',
    ...extra,
  });
}

const QUEUE: QueueJson = {
  issues: {
    '1': { title: HOSTILE, status: 'blocked', phase: 'plan', notes: 'awaiting-plan-approval' },
    '2': { title: 'motion', status: 'in-flight', phase: 'implement', pr: 9 },
    '3': { title: 'dep', status: 'blocked', phase: 'handle', depends_on: [2] },
  },
};

const QUEUE_BENIGN: QueueJson = {
  issues: {
    '1': { title: 'gate', status: 'blocked', phase: 'plan', notes: 'awaiting-plan-approval' },
    '2': { title: 'motion', status: 'in-flight', phase: 'review', pr: 9 },
    '3': { title: 'dep', status: 'blocked', phase: 'handle', depends_on: [2] },
    '4': { title: 'next', status: 'ready', phase: 'handle' },
  },
};

describe('escapeHtml', () => {
  test('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('renderStatusHtml — hostile state is escaped', () => {
  const html = renderStatusHtml(report(QUEUE));

  test('no raw markup from an issue title, ledger summary or checkpoint note survives', () => {
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('&amp; &#39;quote&#39;');
  });

  test('a hostile repo name cannot break out of the <title>', () => {
    const page = renderStatusHtml(report(QUEUE, { config: { repo: '</title><script>x</script>' } }));
    expect(page).toContain('<title>Blackhole status — &lt;/title&gt;&lt;script&gt;x&lt;/script&gt;</title>');
    expect(page).not.toContain('<script>');
  });
});

describe('renderStatusHtml — self-contained page', () => {
  const html = renderStatusHtml(report(QUEUE));

  test('loads nothing from the network', () => {
    // Benign state: hostile text is escaped but stays readable (e.g. ` src=x`), which would
    // false-match the attribute scan below.
    const benign = renderStatusHtml(
      buildStatusReport({
        config: { repo: 'acme/widgets' },
        queue: QUEUE_BENIGN,
        ledger: { findings: [{ id: 'F-1', vcode: 'V-X', severity: 'WARN', status: 'open', summary: 's' }] },
        checkpoint: { orchestrator_turn_id: 1 },
        checkpointBody: '## Notes\n\nmerged #2\n',
        forge: { openIssues: 0, openPrs: 0, ok: false, error: 'skipped' },
        paceLine: 'pace: GO',
        hostNotes: ['note'],
        generatedAt: '2026-11-11T12:00:00.000Z',
      }),
    );
    expect(benign).not.toMatch(/https?:\/\//i);
    expect(benign).not.toMatch(/\s(src|href|srcset|action|poster|data)\s*=/i);
    expect(benign).not.toMatch(/@import|url\s*\(/i);
    expect(benign).not.toMatch(/<(script|link|iframe|object|embed|img)\b/i);
    // Hostile state: no tag survives escaping, so nothing can load.
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/@import|url\s*\(/i);
    expect(html).not.toMatch(/<(script|link|iframe|object|embed|img)\b/i);
  });

  test('a title naming the campaign, inline CSS with theme tokens and a dark-mode block', () => {
    expect(html).toStartWith('<!doctype html>');
    expect(html).toContain('<title>Blackhole status — acme/widgets</title>');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toMatch(/<style>[\s\S]*:root\s*\{[\s\S]*--bg:/);
    expect(html).toContain('@media (prefers-color-scheme: dark)');
  });

  test('sections appear in the required order, after the banner, with details last', () => {
    const order = ['In progress', 'Waiting on you', 'Waiting on something else', 'Up next', 'Recently done', 'Host and environment', 'Recent events'].map((h) =>
      html.indexOf(`<h2>${h}`),
    );
    expect(html.indexOf('class="banner')).toBeLessThan(order[0]);
    expect(html.indexOf('<details>')).toBeGreaterThan(order[4]);
    expect(html.indexOf('<details>')).toBeLessThan(order[5]);
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('owner gates show their next step; other blocked groups show their count and issue numbers', () => {
    expect(html).toContain('Owner: approve the plan');
    expect(html).toMatch(/Dependency \/ upstream[\s\S]{0,80}>1<[\s\S]{0,200}#3/);
    expect(html).toContain('#9');
  });

  test('host notes and pace line are shown', () => {
    expect(html).toContain('pace: GO (session 12%)');
    expect(html).toContain('Plugin cache drift');
  });

  test('empty campaign still renders every section with an empty-state line', () => {
    const page = renderStatusHtml(report({ issues: {} }, { config: {}, checkpointBody: '', paceLine: null, hostNotes: [] }));
    expect(page).toContain('<title>Blackhole status — all open issues</title>');
    expect((page.match(/class="empty"/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

describe('renderStatusHtml — Ready to merge', () => {
  const READY: QueueJson = {
    issues: { '7': { title: HOSTILE, status: 'in-flight', phase: 'review', pr: 21, notes: 'delivered-at-LGTM (leave-open)' } },
  };
  const html = renderStatusHtml(report(READY));

  test('lists the PR with count badge, PR and Files links, title and verdict line', () => {
    expect(html).toMatch(/<h2>Waiting on you <span class="count">1<\/span><\/h2>/);
    expect(html).toContain('acme/widgets#21');
    expect(html).toContain('<a href="https://github.com/acme/widgets/pull/21" target="_blank" rel="noopener">Open PR ↗</a>');
    expect(html).toContain('<a href="https://github.com/acme/widgets/pull/21/files" target="_blank" rel="noopener">Files changed ↗</a>');
    expect(html).toContain('LGTM · CI green · no conflict');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('it sits in Waiting on you, above Up next', () => {
    expect(html.indexOf('<h2>Waiting on you')).toBeLessThan(html.indexOf('acme/widgets#21'));
    expect(html.indexOf('acme/widgets#21')).toBeLessThan(html.indexOf('<h2>Up next'));
  });

  test('anchors are the only links: nothing else loads from the network', () => {
    // Benign title: hostile text is escaped but stays readable (` src=x`) and would false-match the scan.
    const benign: QueueJson = { issues: { '7': { ...READY.issues!['7'], title: 'plain' } } };
    const rest = renderStatusHtml(report(benign, { ledger: { findings: [] }, checkpointBody: '' })).replace(/<a href="[^"]*"[^>]*>[^<]*<\/a>/g, '');
    expect(rest).not.toMatch(/https?:\/\//i);
    expect(rest).not.toMatch(/\s(src|href|srcset|action|poster|data)\s*=/i);
    expect(rest).not.toMatch(/<(script|link|iframe|object|embed|img)\b/i);
  });

  test('empty state', () => {
    expect(renderStatusHtml(report({ issues: {} }))).toContain('Nothing is waiting on you.');
  });

  test('a non-http(s) or hostile pr_url is never rendered as a link; href values are escaped', () => {
    const base = report(READY);
    const mk = (pr_url: string) => renderStatusHtml({ ...base, ready_to_merge: [{ ...base.ready_to_merge[0], pr_url }] });
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x/y', '//evil/x']) {
      const page = mk(bad);
      expect(page).not.toMatch(/<a href/i);
      expect(page).not.toContain('Open PR');
    }
    const quoted = mk('https://github.com/a/b/pull/1"><script>x</script>');
    expect(quoted).not.toContain('<script>');
    expect(quoted).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('renderStatusHtml — state banner', () => {
  const NOW = '2026-11-12T12:00:00.000Z';
  const page = (queue: QueueJson, extra: Partial<Parameters<typeof buildStatusReport>[0]> = {}) =>
    renderStatusHtml(
      report(queue, {
        generatedAt: NOW,
        checkpoint: { orchestrator_turn_id: 151, refreshed_at: '2026-11-12T11:56:00.000Z' },
        ...extra,
      }),
    );
  const mainStart = (html: string) => html.slice(html.indexOf('<main>'), html.indexOf('<main>') + 900);

  test('is the first thing in <main>: turn, state, last activity relative and UTC, next action', () => {
    const html = page(
      { refreshed_at: '2026-11-12T11:55:00.000Z', issues: { '2': { title: 'm', status: 'in-flight', phase: 'implement' } } },
      { checkpointBody: '## In-flight workers\n\n- implementer on #2\n- reviewer on #3\n' },
    );
    const top = mainStart(html);
    expect(top).toContain('class="banner state-running"');
    expect(top).toContain('Turn 151');
    expect(top).toContain('acme/widgets');
    expect(top).toContain('RUNNING');
    expect(top).toContain('2 workers active');
    expect(top).toContain('Last activity: 4 min ago (2026-11-12 11:56 UTC)');
    expect(top).toContain('Your next action: Nothing — the campaign is running on its own.');
  });

  test('WAITING ON YOU shows the owner next action', () => {
    const html = page({ issues: { '1': { title: 'gate', status: 'blocked', phase: 'plan', notes: 'awaiting-plan-approval' } } });
    expect(mainStart(html)).toContain('WAITING ON YOU');
    expect(mainStart(html)).toContain('Your next action: Owner: approve the plan (#1)');
  });

  test('STALE overrides RUNNING and says the state is old', () => {
    const html = page(
      { refreshed_at: '2026-11-11T19:00:00.000Z', issues: { '2': { title: 'm', status: 'in-flight', phase: 'implement' } } },
      { checkpoint: { orchestrator_turn_id: 151, refreshed_at: '2026-11-11T18:00:00.000Z' } },
    );
    const top = mainStart(html);
    expect(top).toContain('state-stale');
    expect(top).toContain('STALE');
    expect(top).not.toContain('RUNNING —');
    expect(top).toContain('state last written 17h ago, so what follows may be out of date');
  });

  test('every state kind gets a class that the stylesheet defines', () => {
    const cases: Array<[string, QueueJson, Partial<Parameters<typeof buildStatusReport>[0]>]> = [
      ['state-running', { issues: { '2': { title: 'm', status: 'in-flight', phase: 'plan' } } }, {}],
      ['state-waiting-on-you', { issues: { '1': { title: 'g', status: 'blocked', phase: 'plan', notes: 'awaiting-plan-approval' } } }, {}],
      ['state-idle', { issues: { '4': { title: 'n', status: 'ready' } } }, {}],
      ['state-done', { issues: { '4': { title: 'n', status: 'merged', pr: 1 } } }, {}],
      ['state-stale', { issues: { '2': { title: 'm', status: 'in-flight' } } }, { checkpoint: { orchestrator_turn_id: 1, refreshed_at: '2026-11-01T00:00:00.000Z' } }],
    ];
    for (const [cls, queue, extra] of cases) {
      const html = page(queue, extra);
      expect(html).toContain(`class="banner ${cls}"`);
      expect(html).toContain(`.${cls} `);
    }
  });

  test('the last-activity UTC time is formatted from the parsed date', () => {
    const html = page({ issues: {} }, { checkpoint: { orchestrator_turn_id: 1, refreshed_at: '2026-11-12T11:56:00+02:00' } });
    expect(html).toContain('(2026-11-12 09:56 UTC)');
  });

  test('IDLE and DONE render their own banners', () => {
    expect(mainStart(page({ issues: { '4': { title: 'n', status: 'ready', phase: 'handle' } } }))).toContain('IDLE');
    expect(mainStart(page({ issues: { '4': { title: 'n', status: 'merged', pr: 1 } } }))).toContain('DONE');
  });

  test('a hostile repo name or note cannot break out of the banner', () => {
    const html = page(
      { issues: { '1': { title: 'g', status: 'blocked', phase: 'plan', notes: 'awaiting-plan-approval' } } },
      { config: { repo: '<script>x</script>' } },
    );
    expect(html).not.toContain('<script>');
  });
});

describe('renderStatusHtml — section content', () => {
  const Q: QueueJson = {
    issues: {
      '1': { title: 'gate', status: 'blocked', phase: 'plan', notes: 'awaiting-plan-approval' },
      '2': { title: 'motion', status: 'in-flight', phase: 'implement', pr: 9 },
      '3': { title: 'rev', status: 'in-flight', phase: 'review', pr: 10 },
      '4': { title: 'next', status: 'ready', phase: 'handle' },
      '5': { title: 'odd', status: 'blocked', phase: 'handle', notes: 'needs vendor answer <b>x</b>' },
      '6': { title: 'old', status: 'merged', pr: 50 },
    },
  };
  const html = renderStatusHtml(report(Q));
  const between = (a: string, b: string) => html.slice(html.indexOf(a), html.indexOf(b));

  test('In progress lists in-flight and in-review issues with their next step', () => {
    const s = between('<h2>In progress', '<h2>Waiting on you');
    expect(s).toContain('#2');
    expect(s).toContain('#3');
    expect(s).toContain('Implement: update PR #9');
  });

  test('Waiting on you lists the owner gate', () => {
    expect(between('<h2>Waiting on you', '<h2>Waiting on something else')).toContain('Owner: approve the plan');
  });

  test('Waiting on something else shows the note of an `other` blocked item, escaped', () => {
    const s = between('<h2>Waiting on something else', '<h2>Up next');
    expect(s).toContain('#5');
    expect(s).toContain('needs vendor answer &lt;b&gt;x&lt;/b&gt;');
    expect(s).not.toContain('awaiting-plan-approval');
  });

  test('Up next lists the ready set and Recently done the merged items', () => {
    expect(between('<h2>Up next', '<h2>Recently done')).toContain('#4');
    expect(between('<h2>Recently done', '<details>')).toContain('#6');
  });

  test('details is a native element and the page still ships no script', () => {
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>Details</summary>');
    expect(html).not.toMatch(/<script/i);
  });
});

describe('renderStatusHtml — owner items and workers', () => {
  const NOTE = 'PR #4872 (MCP-8 write path) needs your approving review; standing auth does not cover it';
  const q: QueueJson = {
    issues: { '4206': { title: 'MCP-8', status: 'blocked', phase: 'review', pr: 4872, notes: `awaiting-owner-review: ${NOTE}` } },
  };

  test('an owner item shows its note as the detail, not the generic gate line', () => {
    const html = renderStatusHtml(report(q, { generatedAt: '2026-11-11T12:00:00.000Z' }));
    const owner = html.slice(html.indexOf('<h2>Waiting on you'), html.indexOf('<h2>Waiting on something else'));
    expect(owner).toContain('needs your approving review');
    expect(owner).not.toContain('Owner: clear awaiting-owner-review');
    expect(html).toContain(`Your next action: ${NOTE} (#4206)`);
  });

  test('a bare `none` under In-flight workers shows no worker line in Details', () => {
    const html = renderStatusHtml(report(q, { checkpointBody: '## In-flight workers\n\nnone\n' }));
    expect(html).not.toContain('Active workers');
    expect(html).not.toContain('RUNNING');
  });
});

describe('renderStatusHtml — Waiting on something else is grouped by reason class', () => {
  const lane = { status: 'blocked', labels: ['in-progress:cursor'], notes: 'cursor lane: not ours, skipped' };
  const issues: QueueJson['issues'] = {};
  for (let n = 100; n < 110; n++) issues[String(n)] = { ...lane, title: `cursor ${n}` };
  for (let n = 200; n < 204; n++) issues[String(n)] = { title: `track ${n}`, status: 'blocked', notes: 'tracking issue, stays open' };
  issues['300'] = { title: 'hostile <b>x</b>', status: 'blocked', notes: '<script>alert(1)</script>' };
  issues['301'] = { title: 'dep', status: 'blocked', notes: 'upstream: waits for a release' };
  issues['302'] = { title: 'seq', status: 'blocked', notes: 'phases run in sequence' };
  const html = renderStatusHtml(report({ issues }));
  const s = html.slice(html.indexOf('<h2>Waiting on something else'), html.indexOf('<h2>Up next'));

  test('one visible summary line per class, 5 at most, before any details is opened', () => {
    const summaries = s.match(/<summary[^>]*>[\s\S]*?<\/summary>/g) ?? [];
    expect(summaries).toHaveLength(5);
    expect(s.match(/<details/g)).toHaveLength(5);
    expect(s).not.toMatch(/<details[^>]* open/);
  });

  test('each summary carries the class label, its count and only the first 3 items', () => {
    const lane = (s.match(/<summary[^>]*>[\s\S]*?<\/summary>/g) ?? []).find((x) => x.includes('Another lane')) ?? '';
    expect(lane).toContain('>10<');
    expect(lane).toContain('#100');
    expect(lane).toContain('#102');
    expect(lane).not.toContain('#103');
    expect(lane).toContain('7 more');
  });

  test('the full list is inside the details, so no item is dropped', () => {
    for (let n = 100; n < 110; n++) expect(s).toContain(`#${n}`);
    for (let n = 200; n < 204; n++) expect(s).toContain(`#${n}`);
    expect(s).toContain('#300');
  });

  test('all values are escaped and no script is added', () => {
    expect(s).not.toContain('<script>');
    expect(s).not.toContain('<b>x</b>');
    expect(s).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/<script/i);
  });
});
