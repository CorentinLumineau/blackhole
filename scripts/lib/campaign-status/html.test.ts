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

  test('sections appear in the required order', () => {
    const order = ['Waiting on the owner', 'In motion', 'Blocked', 'Host and environment', 'Recent events'].map((h) =>
      html.indexOf(`<h2>${h}`),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('blocked groups show their count and issue numbers', () => {
    expect(html).toContain('awaiting-plan-approval');
    expect(html).toMatch(/dependency[\s\S]{0,80}>1<[\s\S]{0,200}#3/);
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
