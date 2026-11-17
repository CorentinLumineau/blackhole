import { describe, expect, test } from 'bun:test';
import { statusPageRow, PROBE_FRESH_MINUTES, type StatusPageInput } from './status-page-row.ts';

const NOW_ISO = '2026-11-13T09:30:00.000Z';
const URL = 'https://claude.ai/code/artifact/abc';
const PAGE: StatusPageInput = {
  enabled: true,
  publishExpected: true,
  artifact: { url: URL, kind: 'data', template_version: 4, last_probe: { at: '2026-11-13T09:25:00.000Z', ok: true, url: URL } },
  templateVersion: 4,
  nowIso: NOW_ISO,
};

test('a probe counts as fresh under 10 minutes', () => {
  expect(PROBE_FRESH_MINUTES).toBe(10);
});

describe('the Status page row', () => {
  const at = (minutesAgo: number) => new Date(Date.parse(NOW_ISO) - minutesAgo * 60_000).toISOString();
  const page = (over: Partial<StatusPageInput>): StatusPageInput => ({ ...PAGE, ...over });

  test('disabled', () => {
    const row = statusPageRow(page({ enabled: false }));
    expect(row.value).toBe('off (status_page.enabled is false)');
    expect(row.consequence).toBe('No page is published; follow the run with bun run status.');
    expect(row.probe_needed).toBeUndefined();
  });

  test('the host publishes none', () => {
    const row = statusPageRow(page({ publishExpected: false }));
    expect(row.value).toBe('none on this host');
    expect(row.consequence).toBe('This host has no artifact tool; follow the run with bun run status.');
    expect(row.adjustable).toBe(false);
  });

  test('never published', () => {
    const row = statusPageRow(page({ artifact: null }));
    expect(row.value).toBe('never published');
    expect(row.consequence).toBe('A new page is published before the first spawn.');
    expect(row.probe_needed).toBeUndefined();
  });

  test('probe ok and fresh (under 10 min)', () => {
    const row = statusPageRow(page({ artifact: { url: URL, template_version: 4, last_probe: { at: at(9), ok: true, url: URL } } }));
    expect(row.value).toBe(`${URL} · reachable (probed 9 min ago) · template v4`);
    expect(row.consequence).toBe('The stored page opens from this account and is refreshed at every checkpoint.');
    expect(row.options?.map((o) => o.label)).toEqual(['Accept', 'Reuse another', 'Publish new']);
    expect(row.probe_needed).toBeUndefined();
  });

  test('a probe recorded within the same second as a whole-second summary clock counts as fresh', () => {
    // The summary floors its clock to whole seconds; status-probe.ts records milliseconds.
    const sameSecond = new Date(Date.parse(NOW_ISO) + 400).toISOString();
    const row = statusPageRow(page({ artifact: { url: URL, template_version: 4, last_probe: { at: sameSecond, ok: true, url: URL } } }));
    expect(row.value).toBe(`${URL} · reachable (probed 0 min ago) · template v4`);
    expect(row.probe_needed).toBeUndefined();
  });

  test('a probe dated a whole second or more after the clock is not fresh', () => {
    const later = new Date(Date.parse(NOW_ISO) + 1_400).toISOString();
    const row = statusPageRow(page({ artifact: { url: URL, template_version: 4, last_probe: { at: later, ok: true, url: URL } } }));
    expect(row.value).toBe(`${URL} · not probed · template v4`);
    expect(row.probe_needed).toEqual({ url: URL });
  });

  test('probe failed: offers reuse-another or publish-new', () => {
    const row = statusPageRow(page({ artifact: { url: URL, template_version: 4, last_probe: { at: at(2), ok: false, url: URL, reason: 'not found' } } }));
    expect(row.value).toBe(`${URL} · NOT reachable: not found · template v4`);
    expect(row.consequence).toBe('The stored page does not open from this account: reuse another artifact or publish a new one.');
    expect(row.options?.map((o) => o.label)).toEqual(['Reuse another', 'Publish new']);
  });

  test('not probed: carries probe_needed.url (no probe, an old probe, or a probe of another URL)', () => {
    for (const last_probe of [undefined, { at: at(11), ok: true, url: URL }, { at: at(1), ok: true, url: 'https://claude.ai/code/artifact/other' }]) {
      const row = statusPageRow(page({ artifact: { url: URL, template_version: 4, last_probe } }));
      expect(row.value).toBe(`${URL} · not probed · template v4`);
      expect(row.probe_needed).toEqual({ url: URL });
      expect(row.consequence).toBe('Probe the stored page (ArtifactData list of datasets) and re-run the summary before the first spawn.');
    }
  });

  test("stale template: adds 'refresh template'", () => {
    const row = statusPageRow(page({ artifact: { url: URL, template_version: 3, last_probe: { at: at(1), ok: true, url: URL } } }));
    expect(row.value).toBe(`${URL} · reachable (probed 1 min ago) · template v3, refresh template to v4`);
    expect(row.options?.map((o) => o.label)).toEqual(['Accept', 'Reuse another', 'Publish new', 'Refresh template']);
  });
});

