import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { fixtureReport } from './data-fixture.ts';
import { buildStatusData, STATUS_DATASET_IDS, type StatusDatasetId } from './data.ts';
import { isStateStale, STALE_AFTER_HOURS } from './staleness.ts';

const TEMPLATE = fs.readFileSync(path.join(import.meta.dir, '../../../templates/status-dashboard/index.html'), 'utf8');

/** The staleness functions are the template's own text between two markers; the test runs that text, not a copy. */
function loadStalenessFns(): {
  bhState: (summary: Record<string, unknown> | null, nowMs: number) => { kind: string; stale: boolean; ageMs: number | null };
  bhAgo: (ageMs: number) => string;
} {
  const m = TEMPLATE.match(/\/\* bh-stale:start \*\/([\s\S]*?)\/\* bh-stale:end \*\//);
  if (!m) throw new Error('template has no bh-stale markers');
  return new Function(`${m[1]}; return { bhState, bhAgo };`)();
}

describe('status dashboard template — the Data type page contract', () => {
  test('opens with the one-writer meta line', () => {
    expect(TEMPLATE.trimStart().startsWith('<meta name="dash-one-writer">')).toBe(true);
  });

  test('carries an integer template version marker', () => {
    expect(TEMPLATE).toMatch(/<meta name="bh-template-version" content="\d+">/);
  });

  test('writes values with textContent only: no innerHTML, no inline handlers', () => {
    expect(TEMPLATE).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|\.html\(/);
    expect(TEMPLATE).not.toMatch(/\son[a-z]+\s*=/i);
    expect(TEMPLATE).toContain('textContent');
  });

  test('loads nothing from the network', () => {
    expect(TEMPLATE).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(TEMPLATE).not.toMatch(/<link[^>]*\shref=/i);
    expect(TEMPLATE).not.toMatch(/\b(fetch|XMLHttpRequest|localStorage|sessionStorage)\b|@import/);
  });

  test('uses theme tokens only: no hex or rgb colors', () => {
    expect(TEMPLATE).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![^<]*>)/);
    expect(TEMPLATE).not.toMatch(/\brgba?\(/);
  });

  test('reads every dataset the plugin writes and no other', () => {
    const used = new Set<string>();
    for (const m of TEMPLATE.matchAll(/data-source="([^"]+)"/g)) for (const id of m[1].split(/\s+/)) used.add(id);
    for (const m of TEMPLATE.matchAll(/dash\.data\('([^']+)'\)/g)) used.add(m[1]);
    const calcs = new Set([...TEMPLATE.matchAll(/dash\.calc\('([^']+)'/g)].map((m) => m[1]));
    expect([...used].filter((id) => !calcs.has(id)).sort()).toEqual([...STATUS_DATASET_IDS].sort());
  });

  test('links are http(s) only', () => {
    expect(TEMPLATE).toMatch(/\^https\?:/);
  });

  test('holds the sections of the approved layout, with the counts folded in a closed details', () => {
    for (const id of ['state', 'in-progress', 'waiting-on-you', 'waiting-else', 'up-next', 'recently-done', 'details']) {
      expect(TEMPLATE).toContain(`id="${id}"`);
    }
    expect(TEMPLATE).toMatch(/<details[^>]*id="details"(?![^>]*\bopen\b)/);
  });

  test('has no second staleness constant: the threshold comes from the summary row', () => {
    expect(TEMPLATE).toContain('stale_after_hours');
    expect(TEMPLATE).not.toMatch(/STALE_AFTER|\b(?:2|3|4|6|12|24)\s*\*\s*3600/);
  });
});

describe('status dashboard template — client-side staleness', () => {
  const { bhState, bhAgo } = loadStalenessFns();
  const HOUR = 3_600_000;
  const last = Date.parse('2026-11-11T10:00:00.000Z');
  const row = (over: Record<string, unknown> = {}) => ({
    state_kind: 'running',
    last_activity_at: '2026-11-11T10:00:00.000Z',
    stale_after_hours: STALE_AFTER_HOURS,
    ...over,
  });

  test('a fresh state keeps its own kind', () => {
    expect(bhState(row(), last + 10 * 60_000)).toMatchObject({ kind: 'running', stale: false });
  });

  test('older than the threshold at open time shows STALE whatever state_kind says', () => {
    for (const kind of ['running', 'waiting_on_you', 'idle', 'done']) {
      const s = bhState(row({ state_kind: kind }), last + STALE_AFTER_HOURS * HOUR + 60_000);
      expect(s).toMatchObject({ kind: 'stale', stale: true });
    }
  });

  test('exactly the threshold is not stale, one minute more is', () => {
    expect(bhState(row(), last + STALE_AFTER_HOURS * HOUR).stale).toBe(false);
    expect(bhState(row(), last + STALE_AFTER_HOURS * HOUR + 60_000).stale).toBe(true);
  });

  test('uses the threshold carried in the row, not a constant of its own', () => {
    expect(bhState(row({ stale_after_hours: 10 }), last + 5 * HOUR).stale).toBe(false);
    expect(bhState(row({ stale_after_hours: 1 }), last + 2 * HOUR).stale).toBe(true);
  });

  test('an unknown last activity is stale, like the server-side check', () => {
    expect(bhState(row({ last_activity_at: null }), last).stale).toBe(true);
    expect(isStateStale(null)).toBe(true);
    expect(bhState(null, last).stale).toBe(true);
  });

  test('agrees with isStateStale on whole-hour ages around the threshold', () => {
    for (const hours of [0, 1, STALE_AFTER_HOURS, STALE_AFTER_HOURS + 1, 30]) {
      expect(bhState(row(), last + hours * HOUR).stale).toBe(isStateStale(hours));
    }
  });

  test('relative age text', () => {
    expect(bhAgo(5 * 60_000)).toBe('5 min ago');
    expect(bhAgo(3 * HOUR)).toBe('3 h ago');
    expect(bhAgo(72 * HOUR)).toBe('3 d ago');
    expect(bhAgo(-5000)).toBe('0 min ago');
  });
});

describe('status dashboard template — every field it reads is a field the plugin writes', () => {
  const data = buildStatusData(fixtureReport());
  const fieldsOf = (id: string): Set<string> => new Set(data[id as StatusDatasetId]?.flatMap((row) => Object.keys(row)));
  const isDataset = (id: string): boolean => (STATUS_DATASET_IDS as readonly string[]).includes(id);
  const script = TEMPLATE.slice(TEMPLATE.indexOf('<script>'));

  test('the fixture populates every dataset, so a missing field is a real gap', () => {
    for (const id of STATUS_DATASET_IDS) expect(data[id].length).toBeGreaterThan(0);
  });

  test('every data-source + data-field pair in the HTML names an emitted column', () => {
    const pairs = [...TEMPLATE.matchAll(/<[^>]*\bdata-source="([^"]+)"[^>]*\bdata-field="([^"]+)"/g)];
    expect(pairs.length).toBeGreaterThan(10);
    for (const [, source, field] of pairs) {
      expect(isDataset(source) ? fieldsOf(source).has(field) : false).toBe(true);
    }
  });

  test('every { source, field } mark built in the script names an emitted column', () => {
    const marks = [...script.matchAll(/source:\s*'([a-z_]+)',\s*field:\s*'([a-z_]+)'/g)];
    expect(marks.length).toBeGreaterThan(5);
    for (const [, source, field] of marks) expect(fieldsOf(source).has(field)).toBe(true);
    const all = new Set(STATUS_DATASET_IDS.flatMap((id) => [...fieldsOf(id)]));
    const literals = [...script.matchAll(/field:\s*'([a-z_]+)'/g)];
    expect(literals.length).toBeGreaterThan(10);
    for (const [, field] of literals) expect(all.has(field)).toBe(true);
  });

  test('every row field a drawing or calc reads exists in its datasets', () => {
    const chunks = script.split(/(?=dash\.(?:draw|calc)\(')/).slice(1);
    let reads = 0;
    for (const chunk of chunks) {
      const [, kind, name] = chunk.match(/^dash\.(draw|calc)\('([a-z_]+)'/)!;
      const sources =
        kind === 'calc'
          ? [...(chunk.match(/inputs:\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
          : [...(TEMPLATE.match(new RegExp(`data-draw="${name}"[^>]*data-source="([^"]+)"`))?.[1] ?? '').split(/\s+/)];
      const known = new Set(sources.filter(isDataset).flatMap((id) => [...fieldsOf(id)]));
      if (known.size === 0) continue;
      const vars = kind === 'calc' ? 's|c' : 'r|c|it';
      for (const m of chunk.matchAll(new RegExp(`\\b(?:${vars})\\.([a-z_]+)\\b`, 'g'))) {
        reads++;
        expect(`${name}.${m[1]}:${known.has(m[1])}`).toBe(`${name}.${m[1]}:true`);
      }
    }
    expect(reads).toBeGreaterThan(15);
  });

  test('the staleness block reads only summary columns', () => {
    const block = TEMPLATE.match(/\/\* bh-stale:start \*\/([\s\S]*?)\/\* bh-stale:end \*\//)![1];
    const fields = [...block.matchAll(/summary(?: &&|\)?)?\.([a-z_]+)/g)].map((m) => m[1]);
    expect(fields.length).toBeGreaterThan(2);
    for (const f of fields) expect(fieldsOf('summary').has(f)).toBe(true);
  });
});
