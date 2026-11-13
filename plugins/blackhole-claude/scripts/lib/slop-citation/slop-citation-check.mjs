// vendored from mercure@a2355894 mercure-plugin/scripts/slop-citation-check.mjs body-sha256=e30829b2920701765f521a738ac618fdfab4ec326ab4338a46c7e4152b1ff845; re-vendor, never hand-edit
// Re-checks a V-UX-09 / V-UX-10 citation so a slop finding can block (ADR-134). Read-only.
// Exit 0 only from the single VERIFIED path; every other outcome, including a crash, exits 1.
// `decide()` is pure over an `io` adapter so blackhole can vendor this file unchanged.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The blocking subset of the doctrine's copy table: filler in any context. "Something went
// wrong" is not here because it is only filler when the failed action is known (a judgment).
export const BLOCKING_PHRASES = ['successfully', 'please try again later', 'oops', 'whoops', 'uh oh'];
export const STATUS_EMOJI = ['✅', '❌', '⚠️', '⚠', '✔️', '✔', '✖️', '✖', '🚫', '❗', '⛔', '🔴', '🟢', '🟡', '🟠'];

const AXES = ['radius', 'color', 'font-size', 'shadow', 'spacing'];
const RENDERED_EXT = {
  'V-UX-09': ['.tsx', '.jsx', '.vue', '.svelte', '.html', '.astro', '.mdx', '.css', '.scss'],
  'V-UX-10': ['.tsx', '.jsx', '.vue', '.svelte', '.html', '.astro', '.mdx'],
};
const EXCLUDED_PATH =
  /(^|\/)(__tests__|__mocks__|__snapshots__|tests?|e2e|fixtures?|mocks?|stories|storybook|docs?)\/|\.(test|spec|stories|story)\.[^/]+$|\.log$/;
const NS_YAML = {
  radius: ['rounded', 'radius', 'borderradius', 'border-radius'],
  color: ['colors', 'color', 'palette'],
  'font-size': ['fontsize', 'font-size', 'text'],
  shadow: ['shadow', 'shadows', 'boxshadow', 'elevation'],
  spacing: ['spacing', 'space'],
};
const NS_CSS = { radius: ['radius'], color: ['color'], 'font-size': ['text', 'font-size'], shadow: ['shadow'], spacing: ['spacing'] };
const DEFAULT_KEYS = ['default', 'base', ''];
const COMPUTED = /\b(oklch|oklab|lab|lch|hsla?|rgba?|color-mix|calc|var|clamp|min|max)\(|\{[\w.-]+\}/i;
const PALETTE =
  /^(text|bg|border(?:-[trblxyse])?|ring|fill|stroke|from|to|via|outline|divide|placeholder|accent|caret|decoration|shadow)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|[1-9]00|950)$/;
const SPACING_PREFIX =
  /^-?(p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y|w|h|size|min-w|min-h|max-w|max-h|inset|inset-x|inset-y|top|left|right|bottom|start|end)$/;

const fail = (reason, detail = '') => ({ verdict: 'NOT_VERIFIED', reason, detail });
// Normalized repo-relative paths only: `./x` or `a//b` would miss the rename and donor maps.
const safePath = (p) =>
  typeof p === 'string' && p !== '' && !p.startsWith('-') && !path.isAbsolute(p) && path.posix.normalize(p) === p && !p.split('/').includes('..');
const collapse = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function normHex(h) {
  let x = h.toLowerCase();
  if (x.length === 3 || x.length === 4) x = [...x].map((c) => c + c).join('');
  return x.slice(0, 6);
}
const hexesIn = (text) => [...text.matchAll(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-z])/gi)].map((m) => normHex(m[1]));
const toPx = (n, unit) => (unit === 'rem' || unit === 'em' ? parseFloat(n) * 16 : parseFloat(n));

function arbitraryAxis(prefix) {
  if (/^rounded(-[a-z]+)?$/.test(prefix)) return 'radius';
  if (prefix === 'text') return 'font-size';
  if (SPACING_PREFIX.test(prefix)) return 'spacing';
  return null;
}

// Value shape, from the literal alone. Only shapes whose membership can be decided are blockable.
export function classify(raw) {
  const v = raw.replace(/^(?:[\w-]+:)+/, '').replace(/^!/, '');
  let m;
  if ((m = v.match(/^#([0-9a-f]+)$/i)) || (m = v.match(/^[a-z][a-z0-9-]*-\[#([0-9a-f]+)\]$/i))) {
    return [3, 4, 6, 8].includes(m[1].length) ? { shape: 'hex', axis: 'color', hex: normHex(m[1]) } : { shape: 'undecidable' };
  }
  if ((m = v.match(/^([a-z][a-z-]*?)-\[(.+)\]$/))) {
    const axis = arbitraryAxis(m[1]);
    const n = m[2].match(/^(-?\d*\.?\d+)(px|rem|em)?$/);
    if (!axis || !n) return { shape: 'undecidable' };
    const px = toPx(n[1], n[2]);
    if (px === 0 || (px === 1 && (n[2] ?? 'px') === 'px')) return { shape: 'exempt', axis };
    return { shape: 'arbitrary', axis, px };
  }
  if ((m = v.match(PALETTE))) return { shape: 'palette', axis: 'color', key: `${m[2]}-${m[3]}` };
  if ((m = v.match(/^rounded(?:-(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?(?:-(none|xs|sm|md|lg|xl|2xl|3xl|4xl|full))?$/))) {
    const key = m[1] ?? 'DEFAULT';
    return key === 'none' || key === 'full' ? { shape: 'exempt', axis: 'radius' } : { shape: 'scale', axis: 'radius', key };
  }
  if ((m = v.match(/^shadow(?:-(2xs|xs|sm|md|lg|xl|2xl|inner|none))?$/))) {
    const key = m[1] ?? 'DEFAULT';
    return key === 'none' ? { shape: 'exempt', axis: 'shadow' } : { shape: 'scale', axis: 'shadow', key };
  }
  if ((m = v.match(/^text-(xs|sm|base|lg|xl|[2-9]xl)$/))) return { shape: 'scale', axis: 'font-size', key: m[1] };
  if ((m = v.match(/^(-?[a-z]+(?:-[xy])?)-[\w./]+$/)) && SPACING_PREFIX.test(m[1])) return { shape: 'generative', axis: 'spacing' };
  return { shape: 'undecidable' };
}

function frontMatter(text) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  return end === -1 ? null : lines.slice(1, end).join('\n');
}

function parseYaml(text) {
  if (/:\s+[&*][\w-]/.test(text) || /^\t/m.test(text)) return { error: 'set-unresolvable' };
  const ns = new Map();
  let cur = null;
  let childIndent = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      const top = line.match(/^(['"]?)([\w-]+)\1\s*:\s*(.*)$/);
      cur = top && top[3].trim() === '' ? top[2].toLowerCase() : null;
      if (cur) ns.set(cur, { keys: new Map(), values: [], computed: false, unresolvable: false });
      childIndent = null;
      continue;
    }
    if (!cur) continue;
    const entry = ns.get(cur);
    childIndent ??= indent;
    if (indent > childIndent) {
      // A nested group hides members this flat reader cannot see, so the axis fails open.
      entry.unresolvable = true;
      continue;
    }
    if (indent < childIndent || line.trimStart().startsWith('- ')) {
      entry.unresolvable = true;
      continue;
    }
    const kv = line.trim().match(/^(['"]?)([^'":]+)\1\s*:\s*(.*)$/);
    if (!kv) {
      entry.unresolvable = true;
      continue;
    }
    let value = kv[3].trim();
    const quoted = value.match(/^(['"])(.*)\1\s*(#.*)?$/);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '');
    if (!quoted && /^[|>{[]/.test(value)) entry.unresolvable = true;
    if (value === '') {
      entry.keys.set(kv[2].trim().toLowerCase(), null);
      continue;
    }
    if (COMPUTED.test(value)) entry.computed = true;
    entry.keys.set(kv[2].trim().toLowerCase(), value);
    entry.values.push(value);
  }
  return { kind: 'yaml', authoritative: true, ns, text };
}

function parseCss(raw) {
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  if ((text.match(/\{/g) ?? []).length !== (text.match(/\}/g) ?? []).length) return { error: 'set-unresolvable' };
  if (/@import\s+(?!url\(\s*['"]?https?:)/i.test(text)) return { error: 'set-incomplete' };
  const ns = new Map();
  const closed = new Set();
  for (const m of text.matchAll(/--([\w*-]+)\s*:\s*([^;}]*)/g)) {
    const name = m[1].toLowerCase();
    const value = m[2].trim();
    for (const [axis, prefixes] of Object.entries(NS_CSS)) {
      const prefix = prefixes.find((p) => name === p || name.startsWith(`${p}-`));
      if (!prefix) continue;
      const key = name === prefix ? 'default' : name.slice(prefix.length + 1);
      if (key === '*') {
        if (value === 'initial') closed.add(axis);
        continue;
      }
      if (!ns.has(axis)) ns.set(axis, { keys: new Map(), values: [], computed: false, unresolvable: false });
      const entry = ns.get(axis);
      if (COMPUTED.test(value)) entry.computed = true;
      entry.keys.set(key, value);
      entry.values.push(value);
    }
  }
  return { kind: 'css', authoritative: false, closed, ns, text };
}

export function parseSet(file, text) {
  if (text == null) return { error: 'set-missing-at-base' };
  const lower = file.toLowerCase();
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return parseCss(text);
  if (lower.endsWith('.md')) {
    const fm = frontMatter(text);
    return fm == null ? { error: 'set-unresolvable' } : parseYaml(fm);
  }
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return parseYaml(text);
  return { error: 'set-unresolvable' };
}

const axisNs = (set, axis) =>
  set.kind === 'css' ? set.ns.get(axis) : NS_YAML[axis].map((k) => set.ns.get(k)).find(Boolean);

// null = the value is out of the declared set (verified); otherwise the NOT_VERIFIED reason.
export function setVerdict(cls, set) {
  if (set.error) return set.error;
  const ns = axisNs(set, cls.axis);
  if (!ns) return 'set-axis-missing';
  if (ns.unresolvable) return 'set-unresolvable';
  if (cls.shape === 'hex') {
    if (ns.computed || ns.values.some((v) => !/^#[0-9a-f]{3,8}$/i.test(v))) return 'set-computed';
    return hexesIn(set.text).includes(cls.hex) ? 'value-in-set' : null;
  }
  // A base unit (`--spacing: 0.25rem`) makes the whole numeric scale in-set.
  if (cls.axis === 'spacing' && ns.keys.has('default')) return 'axis-generative';
  if (cls.shape === 'arbitrary') {
    const px = ns.values.map((v) => v.match(/^(-?\d*\.?\d+)(px|rem|em)?$/));
    if (ns.computed || px.some((m) => !m)) return 'set-computed';
    return px.some((m) => toPx(m[1], m[2]) === cls.px) ? 'value-in-set' : null;
  }
  if (!(set.authoritative || set.closed?.has(cls.axis))) return 'set-open-world';
  const keys = ns.keys;
  const wanted = cls.key === 'DEFAULT' ? DEFAULT_KEYS : [cls.key.toLowerCase()];
  if (wanted.some((k) => keys.has(k))) return 'key-in-set';
  if (cls.shape === 'palette' && keys.has(cls.key.split('-')[0])) return 'key-in-set';
  return null;
}

const CLEAN_BEFORE = /[\s"'`:!(]/;
const CLEAN_AFTER = /[\s"'`;,)]/;
const isToken = (text, i, len) =>
  (i === 0 || CLEAN_BEFORE.test(text[i - 1])) && (i + len === text.length || CLEAN_AFTER.test(text[i + len]));

// Comment spans over the whole file. It errs towards "comment" (no string tracking), which only
// ever turns a would-be block into a suggestion.
function commentSpans(text) {
  const spans = [];
  for (let i = 0; i < text.length; ) {
    const close = (open, closer) => {
      const at = text.indexOf(closer, i + open.length);
      return at === -1 ? text.length : at + closer.length;
    };
    let end = -1;
    if (text.startsWith('/*', i)) end = close('/*', '*/');
    else if (text.startsWith('<!--', i)) end = close('<!--', '-->');
    else if (text.startsWith('//', i) && !/\b(?:https?|wss?|ftp|file):$/i.test(text.slice(Math.max(0, i - 8), i))) end = close('//', '\n');
    if (end === -1) {
      i++;
      continue;
    }
    spans.push([i, end]);
    i = end;
  }
  return spans;
}
const inSpans = (spans, at) => spans.some(([a, b]) => at >= a && at < b);

// First usable occurrence of the cited value on the cited line: 'ok', or why none is usable.
function locate(matches, spans, lineStart) {
  let inComment = false;
  for (const { at, clean } of matches) {
    if (!clean) continue;
    if (!inSpans(spans, lineStart + at)) return 'ok';
    inComment = true;
  }
  if (inComment) return 'comment';
  return matches.length ? 'dynamic' : 'line-mismatch';
}

function countIn(text, value, cls) {
  if (text == null) return 0;
  if (cls?.shape === 'hex') return hexesIn(text).filter((h) => h === cls.hex).length;
  if (!cls) {
    const needle = collapse(value);
    return needle ? collapse(text).split(needle).length - 1 : 0;
  }
  // Looser than isToken on purpose: any occurrence not glued to another class name counts, so a
  // base use like `rounded-sm${x}` is found. Over-counting the base can only fail open.
  return (text.match(new RegExp(`(?<![\\w-])${escapeRe(value)}(?![\\w-])`, 'gi')) ?? []).length;
}

/**
 * @param c   { code, file, line, value, axis?, setFile? }
 * @param io  { headText(p), baseText(ref, p), renameSource(p), changed(), mb, tips }
 */
export function decide(c, io) {
  if (!['V-UX-09', 'V-UX-10'].includes(c.code) || !safePath(c.file) || !Number.isInteger(c.line) || c.line < 1 || !c.value) {
    return fail('usage', 'code, file, line and value are required');
  }
  const is09 = c.code === 'V-UX-09';
  if (is09 && (!AXES.includes(c.axis) || !safePath(c.setFile))) return fail('usage', 'V-UX-09 needs --axis and --set-file');
  if (EXCLUDED_PATH.test(c.file)) return fail('path-excluded', c.file);
  if (!RENDERED_EXT[c.code].includes(path.extname(c.file).toLowerCase())) return fail('ext-unsupported', c.file);
  if (is09 && c.file === c.setFile) return fail('set-file-cited');

  const head = io.headText(c.file);
  if (head == null) return fail('file-missing', c.file);
  const text = head.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const line = lines[c.line - 1];
  if (line === undefined) return fail('line-mismatch');
  const lineStart = lines.slice(0, c.line - 1).reduce((n, l) => n + l.length + 1, 0);
  const spans = commentSpans(text);

  let cls = null;
  if (is09) {
    const matches = [];
    for (let i = line.indexOf(c.value); i !== -1; i = line.indexOf(c.value, i + 1)) {
      matches.push({ at: i, clean: isToken(line, i, c.value.length) });
    }
    const where = locate(matches, spans, lineStart);
    if (where !== 'ok') return fail(where);
    if (/^\s*--[\w-]+\s*:/.test(line)) return fail('declaration');
    cls = classify(c.value);
    if (cls.shape === 'exempt') return fail('exempt');
    if (cls.shape === 'generative') return fail('axis-generative');
    if (cls.shape === 'undecidable') return fail('shape-undecidable');
    if (cls.axis !== c.axis) return fail('axis-mismatch', `value is ${cls.axis}`);
  } else {
    const v = collapse(c.value);
    const words = new RegExp(v.split(' ').map(escapeRe).join('\\s+'), 'gi');
    const where = locate([...line.matchAll(words)].map((m) => ({ at: m.index, clean: true })), spans, lineStart);
    if (where !== 'ok') return fail(where);
    const listed = BLOCKING_PHRASES.some((p) => new RegExp(`(^|[^a-z])${escapeRe(p)}([^a-z]|$)`).test(v));
    const t = c.value.trim();
    const emoji = STATUS_EMOJI.find((e) => t.startsWith(e));
    const statusEmoji = Boolean(emoji) && t.slice(emoji.length).trim() !== '';
    if (!listed && !statusEmoji) return fail('phrase-not-listed');
  }

  const basePath = io.renameSource(c.file);
  if (basePath && countIn(io.baseText(io.mb, basePath), c.value, cls) > 0) return fail('not-net-new');
  const changed = io.changed();
  if (changed.length > 2000) return fail('diff-too-large');
  for (const f of changed) {
    if (f.path === c.file || !f.basePath) continue;
    if (countIn(io.baseText(io.mb, f.basePath), c.value, cls) > countIn(io.headText(f.path), c.value, cls)) {
      return fail('moved-from-donor', f.path);
    }
  }

  if (is09) {
    for (const ref of [io.mb, ...io.tips]) {
      const reason = setVerdict(cls, parseSet(c.setFile, io.baseText(ref, c.setFile)));
      if (reason) return fail(reason, ref === io.mb ? 'merge base' : 'base tip');
    }
  }
  return { verdict: 'VERIFIED', shape: cls?.shape ?? 'phrase', axis: cls?.axis ?? 'copy', key: cls?.key ?? cls?.hex ?? cls?.px ?? '' };
}

// ── git adapter ─────────────────────────────────────────────────────────────

export function gitIo({ base, head = 'WORKTREE', cwd = process.cwd() }) {
  const run = (args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  const show = (ref, p) => {
    try {
      const t = run(['show', `${ref}:${p}`]);
      return t.includes('\0') ? null : t;
    } catch {
      return null;
    }
  };
  const rev = (r) => run(['rev-parse', '--verify', '--quiet', `${r}^{commit}`]).trim();
  const top = run(['rev-parse', '--show-toplevel']).trim();
  // A bare branch name prefers its remote-tracking ref: a local `main` often lags the real tip.
  // A bare branch name is read at both its remote-tracking and its local tip: either may be the
  // newer one, and a token on either counts.
  const candidates = base.includes('/') ? [base] : [`refs/remotes/origin/${base}`, base];
  const tips = [...new Set(candidates.flatMap((r) => {
    try {
      return [rev(r)];
    } catch {
      return [];
    }
  }))];
  if (tips.length === 0) throw new Error(`base ${base} does not resolve`);
  const tip = tips[0];
  const headSha = rev(head === 'WORKTREE' ? 'HEAD' : head);
  const mb = run(['merge-base', tip, headSha]).trim();
  const diffArgs = ['diff', '-z', '--name-status', '-M40%', '-C', mb];
  if (head !== 'WORKTREE') diffArgs.push(headSha);
  const parts = run(diffArgs).split('\0').filter(Boolean);
  const entries = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    if (/^[RC]/.test(status)) entries.push({ status: status[0], src: parts[i++], path: parts[i++] });
    else entries.push({ status: status[0], src: null, path: parts[i++] });
  }
  if (head === 'WORKTREE') {
    for (const p of run(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)) {
      entries.push({ status: 'A', src: null, path: p });
    }
  }
  const headText = (p) => {
    if (head !== 'WORKTREE') return show(headSha, p);
    const abs = path.join(top, p);
    if (!existsSync(abs)) return null;
    const t = readFileSync(abs, 'utf8');
    return t.includes('\0') ? null : t;
  };
  return {
    mb,
    tips,
    headText,
    baseText: show,
    renameSource(p) {
      const e = entries.find((x) => x.path === p);
      if (!e) return p;
      if (e.status === 'A') return null;
      return e.src ?? p;
    },
    changed: () => entries.map((e) => ({ path: e.path, basePath: e.status === 'A' ? null : e.src ?? e.path })),
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  const keys = { '--code': 'code', '--base': 'base', '--head': 'head', '--file': 'file', '--line': 'line', '--value': 'value', '--axis': 'axis', '--set-file': 'setFile' };
  for (let i = 0; i < argv.length; i += 2) {
    const k = keys[argv[i]];
    if (!k || argv[i + 1] === undefined) return null;
    out[k] = argv[i + 1];
  }
  return out;
}

function main(argv) {
  const a = parseArgs(argv);
  if (!a || !a.base || a.base.startsWith('-') || (a.head && a.head.startsWith('-'))) return fail('usage', 'see ADR-134 for the flags');
  const c = { code: a.code, file: a.file, line: Number(a.line), value: a.value, axis: a.axis, setFile: a.setFile };
  if (!safePath(c.file)) return fail('usage', 'file must be repo-relative');
  let io;
  try {
    io = gitIo({ base: a.base, head: a.head ?? 'WORKTREE' });
  } catch {
    return fail('ref-unresolved', a.base);
  }
  try {
    return { ...decide(c, io), base: io.mb.slice(0, 7), setFile: c.setFile ?? '', code: c.code };
  } catch (e) {
    return fail('internal-error', String(e?.message ?? e).split('\n')[0]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.on('uncaughtException', (e) => {
    process.stderr.write(`NOT_VERIFIED reason=internal-error detail=${String(e?.message ?? e).split('\n')[0]}\n`);
    process.exit(1);
  });
  const r = main(process.argv.slice(2));
  if (r.verdict === 'VERIFIED') {
    process.stdout.write(`VERIFIED code=${r.code} shape=${r.shape} axis=${r.axis} key=${r.key} base_sha=${r.base} set=${r.setFile}\n`);
    process.exit(0);
  }
  process.stderr.write(`NOT_VERIFIED reason=${r.reason}${r.detail ? ` detail=${r.detail}` : ''}\n`);
  process.exit(1);
}
