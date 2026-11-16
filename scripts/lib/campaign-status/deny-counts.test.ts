import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderDenyCountsSection } from './dashboard.ts';
import { fixtureReport } from './data-fixture.ts';
import { renderStatusHtml } from './html.ts';
import { collectDenyCounts, DENY_COUNTS_TOP, topDenyCounts } from './deny-counts.ts';

let campaignDir: string;

const write = (dir: string, name: string, body: unknown) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
};
const event = (tier: string, pattern_id: string, recorded_at = '2026-11-10T10:00:00.000Z') => ({ tier, pattern_id, recorded_at });

beforeEach(() => {
  campaignDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deny-counts-'));
});
afterEach(() => {
  fs.rmSync(campaignDir, { recursive: true, force: true });
});

describe('collectDenyCounts', () => {
  it('returns [] when no hook-event directory exists', () => {
    expect(collectDenyCounts(campaignDir, null)).toEqual([]);
  });

  it('counts block as deny and warn as warn per pattern_id, live and archived, ignoring other tiers and bad files', () => {
    const live = path.join(campaignDir, 'hook-events');
    write(live, 'a.json', event('block', 'rm-rf'));
    write(live, 'b.json', event('block', 'rm-rf'));
    write(live, 'c.json', event('warn', 'rm-rf'));
    write(live, 'd.json', event('warn', 'secret-arg'));
    write(live, 'e.json', event('defer', 'sibling'));
    write(live, 'f.json', event('error', 'hook-crash'));
    write(live, 'g.json', '{not json');
    write(live, 'notes.txt', 'ignored');
    write(path.join(campaignDir, 'archive', 'hook-events-100'), 'h.json', event('block', 'rm-rf'));
    write(path.join(campaignDir, 'archive', 'hook-events-rotated-200'), 'i.json', event('block', 'secret-arg'));
    write(path.join(campaignDir, 'archive', 'findings-ledger-1'), 'j.json', event('block', 'wrong-dir'));

    expect(collectDenyCounts(campaignDir, null)).toEqual([
      { pattern_id: 'rm-rf', deny: 3, warn: 1 },
      { pattern_id: 'secret-arg', deny: 1, warn: 1 },
    ]);
  });

  it('drops events recorded before the campaign start but keeps events with no timestamp', () => {
    const live = path.join(campaignDir, 'hook-events');
    write(live, 'old.json', event('block', 'rm-rf', '2026-10-01T00:00:00.000Z'));
    write(live, 'new.json', event('block', 'rm-rf', '2026-11-10T00:00:00.000Z'));
    write(live, 'bare.json', { tier: 'warn', pattern_id: 'rm-rf' });

    expect(collectDenyCounts(campaignDir, '2026-11-01T00:00:00.000Z')).toEqual([{ pattern_id: 'rm-rf', deny: 1, warn: 1 }]);
  });

  it('files an event with no pattern_id under "unknown", matching hook-event triage', () => {
    write(path.join(campaignDir, 'hook-events'), 'x.json', { tier: 'block' });
    expect(collectDenyCounts(campaignDir, null)).toEqual([{ pattern_id: 'unknown', deny: 1, warn: 0 }]);
  });

  it('orders by total desc, then deny desc, then pattern_id', () => {
    const live = path.join(campaignDir, 'hook-events');
    write(live, '1.json', event('warn', 'b-rule'));
    write(live, '2.json', event('warn', 'b-rule'));
    write(live, '3.json', event('block', 'a-rule'));
    write(live, '4.json', event('warn', 'a-rule'));
    write(live, '5.json', event('block', 'c-rule'));
    write(live, '6.json', event('block', 'c-rule'));
    expect(collectDenyCounts(campaignDir, null).map((r) => r.pattern_id)).toEqual(['c-rule', 'a-rule', 'b-rule']);
  });
});

describe('topDenyCounts', () => {
  it('keeps the first five rows', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ pattern_id: `r${i}`, deny: 8 - i, warn: 0 }));
    expect(DENY_COUNTS_TOP).toBe(5);
    expect(topDenyCounts(rows).map((r) => r.pattern_id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });
});

describe('hook denials in the dashboard and the page', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ pattern_id: `rule-${i}`, deny: 7 - i, warn: i }));

  it('prints the top 5 rules with deny and warn counts in the text dashboard', () => {
    const text = renderDenyCountsSection(rows).join('\n');
    expect(text).toContain('### Hook denials');
    expect(text).toContain('- `rule-0` — 7 deny · 0 warn');
    expect(text).toContain('`rule-4`');
    expect(text).not.toContain('rule-5');
  });

  it('says "no hook denials recorded" when there are none, in text and on the page', () => {
    expect(renderDenyCountsSection([]).join('\n')).toContain('no hook denials recorded');
    expect(renderStatusHtml(fixtureReport())).toContain('no hook denials recorded');
  });

  it('lists the top 5 on the page', () => {
    const html = renderStatusHtml({ ...fixtureReport(), deny_counts: rows });
    expect(html).toContain('<code>rule-0</code>');
    expect(html).toContain('7 deny · 0 warn');
    expect(html).toContain('<code>rule-4</code>');
    expect(html).not.toContain('rule-5');
  });
});
