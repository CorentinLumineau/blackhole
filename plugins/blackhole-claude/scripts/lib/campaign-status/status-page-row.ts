import type { GateOption, LaunchRow } from './launch-summary.ts';

// The launch summary's Status page row: whether the stored page opens from this account (its
// `last_probe`), and whether its template is behind the shipped one. Pure.

/** A probe younger than this counts as current; older, the page is probed again (and `status-probe.ts` rewrites it). */
export const PROBE_FRESH_MINUTES = 10;

/** `status-artifact.json`'s `last_probe`. */
export type ProbeRecord = { at: string; ok: boolean; url: string; reason?: string };
export type StatusArtifact = { url?: string; kind?: string; template_version?: number; last_probe?: ProbeRecord };

export type StatusPageInput = {
  /** `status_page.enabled` (default true). */
  enabled: boolean;
  /** Whether this host publishes the page as an artifact. */
  publishExpected: boolean;
  /** `status-artifact.json`, or null when absent. */
  artifact: StatusArtifact | null;
  /** The shipped template's `bh-template-version`, or null when unreadable. */
  templateVersion: number | null;
  nowIso: string;
};

const REUSE: GateOption = { label: 'Reuse another', description: 'Pick an existing artifact from Artifact list and store its URL.' };
const PUBLISH: GateOption = { label: 'Publish new', description: 'Publish a new status page and store its URL.' };
const REFRESH: GateOption = { label: 'Refresh template', description: 'Rewrite the page with the current template, keeping hand edits.' };
const accept = (description: string): GateOption => ({ label: 'Accept', description });

/** The Status page row for the stored page's state (seven states: off, no host page, never published, reachable, unreachable, not probed, stale template). */
export function statusPageRow(p: StatusPageInput): LaunchRow {
  const base = { key: 'status_page' as const, label: 'Status page', header: 'Status page', adjustable: true };
  if (!p.enabled) {
    return { ...base, value: 'off (status_page.enabled is false)', consequence: 'No page is published; follow the run with bun run status.' };
  }
  if (!p.publishExpected) {
    return { ...base, adjustable: false, value: 'none on this host', consequence: 'This host has no artifact tool; follow the run with bun run status.' };
  }
  if (!p.artifact?.url) {
    return { ...base, value: 'never published', consequence: 'A new page is published before the first spawn.', options: [accept('Publish a new page before the first spawn.'), REUSE] };
  }
  const { url, template_version: stored, last_probe: probe } = p.artifact;
  const staleTemplate = p.templateVersion !== null && typeof stored === 'number' && stored < p.templateVersion;
  const template = typeof stored === 'number' ? `template v${stored}${staleTemplate ? `, refresh template to v${p.templateVersion}` : ''}` : 'template unknown';
  // Whole seconds on both sides: the summary's clock is whole seconds, a recorded probe carries milliseconds.
  const wholeSecondMs = (iso: string) => Math.floor(Date.parse(iso) / 1000) * 1000;
  const ageMin = probe ? (wholeSecondMs(p.nowIso) - wholeSecondMs(probe.at)) / 60_000 : NaN;
  const current = probe !== undefined && probe.url === url && ageMin >= 0 && ageMin < PROBE_FRESH_MINUTES;
  const extra = staleTemplate ? [REFRESH] : [];
  if (current && !probe.ok) {
    return {
      ...base,
      value: `${url} · NOT reachable: ${probe.reason ?? 'no reason recorded'} · ${template}`,
      consequence: 'The stored page does not open from this account: reuse another artifact or publish a new one.',
      options: [REUSE, PUBLISH],
    };
  }
  if (current) {
    return {
      ...base,
      value: `${url} · reachable (probed ${Math.floor(ageMin)} min ago) · ${template}`,
      consequence: 'The stored page opens from this account and is refreshed at every checkpoint.',
      options: [accept('Keep refreshing the stored page.'), REUSE, PUBLISH, ...extra],
    };
  }
  return {
    ...base,
    value: `${url} · not probed · ${template}`,
    consequence: 'Probe the stored page (ArtifactData list of datasets) and re-run the summary before the first spawn.',
    options: [accept('Keep the stored page once the probe passes.'), REUSE, PUBLISH, ...extra],
    probe_needed: { url },
  };
}
