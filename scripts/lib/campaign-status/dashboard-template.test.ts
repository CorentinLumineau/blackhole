import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { fixtureReport } from './data-fixture.ts';
import { buildStatusData, STATUS_DATASET_IDS, type StatusDatasetId } from './data.ts';
import { isStateStale, STALE_AFTER_HOURS } from './staleness.ts';

const TEMPLATE = fs.readFileSync(path.join(import.meta.dir, '../../../templates/status-dashboard/index.html'), 'utf8');

/** The staleness functions are the template's own text between two markers; the test runs that text, not a copy. */
function loadStalenessFns(): {
  bhState: (overview: Record<string, unknown> | null, nowMs: number) => { kind: string; stale: boolean; ageMs: number | null };
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

  test('colours are page tokens with fallbacks: a literal colour appears only as a var() fallback or a --cd-* token', () => {
    const style = TEMPLATE.match(/<style>([\s\S]*?)<\/style>/)![1];
    const stripped = style
      .replace(/var\(--[\w-]+,\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\)/g, '')
      .replace(/--cd-[\w-]+:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g, '');
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(stripped).not.toMatch(/\brgba?\(/);
    const outside = TEMPLATE.replace(/<style>[\s\S]*?<\/style>/, '');
    expect(outside).not.toMatch(/#[0-9a-fA-F]{6}\b|\brgba?\(/);
  });

  test('declares the light and the dark palette, the dark one for the media query and data-theme="dark"', () => {
    expect(TEMPLATE).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\) \.cd \{/);
    expect(TEMPLATE).toMatch(/:root\[data-theme="dark"\] \.cd \{/);
  });

  test('none of the decoration the owner rejected: pills, uppercase spaced labels, gradients, shadows, coloured edge borders, emoji', () => {
    expect(TEMPLATE).not.toMatch(/text-transform:\s*uppercase|letter-spacing/);
    expect(TEMPLATE).not.toMatch(/gradient\(|box-shadow|text-shadow/);
    // A one-side border is only ever the neutral 1px row line, never a coloured accent edge.
    const edges = [...TEMPLATE.matchAll(/border-(?:left|top|right|bottom)\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(edges.filter((e) => e !== '1px solid var(--cd-line)')).toEqual([]);
    expect(TEMPLATE).not.toMatch(/border-radius:\s*(999|50%)/);
    expect(TEMPLATE).not.toMatch(/\p{Emoji_Presentation}/u);
  });

  test('controls are real buttons and links, keyboard-reachable, with a visible focus ring', () => {
    expect(TEMPLATE).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid/);
    expect(TEMPLATE).toContain("mk('button'");
    expect(TEMPLATE).toContain("b.type = 'button'");
    expect(TEMPLATE).toContain('aria-pressed');
    expect(TEMPLATE).not.toMatch(/tabIndex|tabindex/);
    expect(TEMPLATE).toMatch(/a\.target = '_blank'; a\.rel = 'noopener'/);
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

  test('holds the sections of the approved layout, top to bottom', () => {
    const ids = ['state', 'your-move', 'blocking', 'board', 'streams', 'scope', 'config', 'decisions'];
    const at = ids.map((id) => TEMPLATE.indexOf(`id="${id}"`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test('the board has five columns, four cards each, the rest in a native details', () => {
    expect([...TEMPLATE.matchAll(/\{ key: '(\w+)', label: '([^']+)'/g)].map((m) => m[2])).toEqual(['in review', 'blocked', 'not started', 'parked', 'done']);
    expect(TEMPLATE).toContain('const CARDS_SHOWN = 4;');
    expect(TEMPLATE).toContain("mk('details', 'cd-more'");
  });

  test('every column folds every board stage the generator emits, each exactly once', () => {
    const stages = [...TEMPLATE.matchAll(/stages: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]));
    expect(stages.sort()).toEqual(['active', 'blocked', 'done', 'parked', 'ready', 'review', 'todo', 'you']);
  });

  test('every list has a plain empty line, and an absent scope says "Scope not recorded"', () => {
    const lists = [...TEMPLATE.matchAll(/data-draw="(links|moves|blockers|streams|scope|config|decisions)"/g)].map((m) => m[1]);
    expect(lists.sort()).toEqual(['blockers', 'config', 'decisions', 'links', 'moves', 'scope', 'streams']);
    for (const name of lists) expect(TEMPLATE).toMatch(new RegExp(`data-empty="${name}" hidden>[^<]+<`));
    expect(TEMPLATE).toContain('data-empty="scope" hidden>Scope not recorded.<');
    expect(TEMPLATE).toContain("'Nothing here.'");
  });

  test('has no second staleness constant: the threshold comes from the summary row', () => {
    expect(TEMPLATE).toContain('stale_after_hours');
    expect(TEMPLATE).not.toMatch(/STALE_AFTER|\b(?:2|3|4|6|12|24)\s*\*\s*3600/);
  });
});

// WCAG 2 contrast of the palette the page falls back to, light and dark: every text colour on every
// surface it is drawn on clears 4.5:1. The page's own tokens, when present, are the host's to keep.
describe('status dashboard template — text contrast of the fallback palette', () => {
  const style = TEMPLATE.match(/<style>([\s\S]*?)<\/style>/)![1];
  const palette = (block: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const m of block.matchAll(/--cd-([\w-]+):\s*(?:var\(--[\w-]+,\s*)?(#[0-9a-fA-F]{6}|rgba\([^)]*\))/g)) out[m[1]] = m[2];
    return out;
  };
  const light = palette(style.match(/\.cd \{([\s\S]*?)\}/)![1]);
  const dark = palette(style.match(/:root\[data-theme="dark"\] \.cd \{([\s\S]*?)\}/)![1]);
  const rgb = (c: string, under?: number[]): number[] => {
    if (c.startsWith('#')) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    const [r, g, b, a] = c.match(/[\d.]+/g)!.map(Number);
    return [r, g, b].map((v, k) => v * a + (under ?? [0, 0, 0])[k] * (1 - a));
  };
  const lum = (c: number[]): number => {
    const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: number[], b: number[]): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const PAIRS: Array<[string, string[]]> = [
    ['fg', ['panel', 'card', 'bg', 'move-bg', 'done-bg']],
    ['muted', ['panel', 'card', 'bg', 'move-bg', 'done-bg']],
    ['ok', ['panel', 'card', 'bg', 'done-bg']],
    ['warn', ['panel', 'card', 'bg']],
    ['bad', ['panel', 'card', 'bg']],
    ['info', ['panel', 'card', 'bg']],
    ['move-fg', ['move-bg']],
    ['bg', ['fg']],
  ];

  for (const [name, p] of [['light', light], ['dark', dark]] as const) {
    test(`${name}: every text colour on every surface clears 4.5:1`, () => {
      const panel = rgb(p.panel);
      for (const [text, surfaces] of PAIRS) {
        for (const s of surfaces) {
          const value = ratio(rgb(p[text], panel), rgb(p[s], panel));
          expect(`${text} on ${s}: ${value >= 4.5}`).toBe(`${text} on ${s}: true`);
        }
      }
    });
  }
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

  test('the fixture rows carry every optional field the page reads (scope reason)', () => {
    expect(fieldsOf('scope').has('reason')).toBe(true);
  });

  test('every data-source + data-field pair in the HTML names an emitted column', () => {
    const pairs = [...TEMPLATE.matchAll(/<[^>]*\bdata-source="([^"]+)"[^>]*\bdata-field="([^"]+)"/g)];
    expect(pairs.length).toBeGreaterThan(4);
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

  // A helper declared before the first drawing (card, ...) is outside every `dash.draw(` chunk, so the
  // per-drawing check above never sees it, and the union check below passes a field any dataset emits.
  // Each helper that reads row fields is therefore pinned to the one dataset whose rows it receives.
  const HELPER_DATASETS: Record<string, StatusDatasetId> = { card: 'board', streamNames: 'streams' };
  const helpers = [...script.matchAll(/\n {2}function (\w+)\(/g)].map((m) => {
    const start = m.index! + 1;
    const rest = script.slice(start + 1);
    const end = rest.search(/\n {2}(?:function |const |let |dash\.|\/\/)/);
    return { name: m[1], body: end < 0 ? rest : rest.slice(0, end) };
  });

  test('every helper that reads row fields is pinned to its dataset, and reads only that dataset\'s fields', () => {
    let reads = 0;
    for (const { name, body } of helpers) {
      const fields = [...body.matchAll(/\br\.([a-z_]+)\b/g)].map((m) => m[1]);
      if (fields.length === 0) continue;
      expect(`${name}:${name in HELPER_DATASETS}`).toBe(`${name}:true`);
      const known = fieldsOf(HELPER_DATASETS[name]);
      for (const f of fields) {
        reads++;
        expect(`${name}.${f}:${known.has(f)}`).toBe(`${name}.${f}:true`);
      }
    }
    expect(reads).toBeGreaterThanOrEqual(5);
    for (const name of Object.keys(HELPER_DATASETS)) expect(helpers.some((h) => h.name === name)).toBe(true);
  });

  test('a stream filter a refresh made stale is cleared before the filter, board and streams draw', () => {
    const m = TEMPLATE.match(/\/\* bh-filter:start \*\/([\s\S]*?)\/\* bh-filter:end \*\//);
    expect(m).not.toBeNull();
    const bhFilter = new Function(`${m![1]}; return bhFilter;`)() as (current: string, names: string[]) => string;
    expect(bhFilter('Payments', ['Payments', 'Search'])).toBe('Payments');
    expect(bhFilter('Payments', ['Search'])).toBe('');
    expect(bhFilter('Payments', [])).toBe('');
    expect(bhFilter('', ['Search'])).toBe('');
    for (const name of ['filter', 'board', 'streams']) {
      const chunk = script.slice(script.indexOf(`dash.draw('${name}', (`)).split(/\n {2}dash\.draw\('/)[0];
      expect(`${name}:${/^dash\.draw\('\w+', \(\w+\) => \{\s*syncFilter\(\);/.test(chunk)}`).toBe(`${name}:true`);
    }
  });

  test('the staleness block reads only overview columns', () => {
    const block = TEMPLATE.match(/\/\* bh-stale:start \*\/([\s\S]*?)\/\* bh-stale:end \*\//)![1];
    const fields = [...block.matchAll(/overview(?: &&|\)?)?\.([a-z_]+)/g)].map((m) => m[1]);
    expect(fields.length).toBeGreaterThan(2);
    for (const f of fields) expect(fieldsOf('overview').has(f)).toBe(true);
  });

  test('every row field the script reads, in a drawing or a helper, is a field some dataset emits', () => {
    const all = new Set(STATUS_DATASET_IDS.flatMap((id) => [...fieldsOf(id)]));
    const reads = [...script.matchAll(/\b(?:r|o|x\.r)\.([a-z_]+)\b/g)].map((m) => m[1]);
    expect(reads.length).toBeGreaterThan(25);
    for (const f of reads) expect(`${f}:${all.has(f)}`).toBe(`${f}:true`);
  });

  test('the overview fields the page reads by name are the stage counts the generator writes', () => {
    const segs = [...TEMPLATE.matchAll(/\{ field: '([a-z_]+)', label:/g)].map((m) => m[1]);
    expect(segs).toEqual(['done', 'in_review', 'blocked', 'parked', 'not_started']);
    for (const f of [...segs, 'on_you']) expect(fieldsOf('overview').has(f)).toBe(true);
  });
});
