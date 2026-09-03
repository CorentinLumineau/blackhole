import * as fs from 'fs';
import * as path from 'path';
import { read, root, type CheckResult } from './check-utils.ts';
import { walkMdFilesAbs } from '../lib/check-common.ts';
import { findFencedJsonBlocks } from './inline-schema-drift.check.ts';

// route-shape.check.ts: keeps the `route` object's field set consistent between its
// enforced-truth declaration site (router.ts's `requireField` calls) and two consumers of that
// truth: a deliberately narrower type (`campaign-status/types.ts`'s `Route`, leg 1 below), and
// doc examples that declare themselves a full mirror of it (leg 2).
//
// Leg 1 (V-SHAPE-01): a `route`/`route.confidence` leaf key required by `validateRoute`
// (router.ts) but absent from `Route`, with no matching `// omits:` allowlist entry on `Route`'s
// header comment, is undeclared drift — so is a `Route` leaf key router.ts never requires.
//
// Leg 2 (V-SHAPE-01): every `<!-- shape: exhaustive -->`-marked fenced `route` JSON example under
// `src/references/*.md` must match router.ts's required keys exactly — no `omits:` allowlist
// applies here, since "exhaustive" means full parity, not a declared narrowing.

const ROUTER_VALIDATOR_PATH = 'scripts/lib/worker-json/validators/router.ts';
const ROUTE_TYPES_PATH = 'scripts/lib/campaign-status/types.ts';
const REFERENCES_DIR = path.join(root, 'src', 'references');
const EXHAUSTIVE_MARKER = '<!-- shape: exhaustive -->';

// Every `route`/`route.confidence` leaf key `validateRoute` requires: the top-level
// `requireField(errors, route, '<field>', ...)` calls, plus the `confidence.<field>` keys named
// in the `for (const field of [...])` loop. Scoped to the `validateRoute` function body only
// (stops at the next `export function`) so `validateRouter`'s own fields never leak in.
export const parseRequireFieldKeys = (routerSrc: string): Set<string> => {
  const keys = new Set<string>();
  const fnStart = routerSrc.indexOf('function validateRoute(');
  if (fnStart === -1) return keys;
  const nextFn = routerSrc.indexOf('export function', fnStart + 1);
  const body = nextFn === -1 ? routerSrc.slice(fnStart) : routerSrc.slice(fnStart, nextFn);

  for (const m of body.matchAll(/requireField\(errors,\s*route,\s*'([^']+)'/g)) {
    keys.add(m[1]);
  }

  const loopMatch = body.match(/for\s*\(const field of \[([^\]]+)\]\s*as const\)/);
  if (loopMatch) {
    for (const m of loopMatch[1].matchAll(/'([^']+)'/g)) {
      keys.add(`confidence.${m[1]}`);
    }
  }

  return keys;
};

// Every leaf key declared on the `Route` type — top-level fields as-is, `confidence`'s own
// fields expanded to `confidence.<field>` (never a bare `confidence` entry — leaf-only, matching
// the router side; see module header).
export const parseRouteTypeKeys = (typesSrc: string): Set<string> => {
  const keys = new Set<string>();
  const start = typesSrc.indexOf('export type Route = {');
  if (start === -1) return keys;
  const end = typesSrc.indexOf('\n};', start);
  const body = end === -1 ? typesSrc.slice(start) : typesSrc.slice(start, end);

  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(\w+)\??:\s*(.+);\s*$/);
    if (!m) continue;
    const [, field, value] = m;
    if (field === 'confidence' && value.trim().startsWith('{')) {
      for (const sub of value.matchAll(/(\w+)\?:/g)) {
        keys.add(`confidence.${sub[1]}`);
      }
    } else {
      keys.add(field);
    }
  }

  return keys;
};

// The `Route` type's declared `// omits: a, b, c — <reason>` allowlist (if any): router-required
// keys the type deliberately does not mirror.
export const parseOmitsAllowlist = (typesSrc: string): Set<string> => {
  const m = typesSrc.match(/\/\/\s*omits:\s*([^\n]+)/);
  if (!m) return new Set();
  const list = m[1].split('—')[0];
  return new Set(
    list
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  );
};

// Undeclared drift between the two sides: a router-required key missing from `typeKeys` and not
// covered by `omits`, or a `typeKeys` entry the router side never requires at all (the type is a
// narrower subset by convention — a stray extra key is always a bug, never declarable via
// `omits`).
export const findRouteShapeDrift = (
  routerKeys: Set<string>,
  typeKeys: Set<string>,
  omits: Set<string>,
): string[] => {
  const drift: string[] = [];
  for (const key of routerKeys) {
    if (!typeKeys.has(key) && !omits.has(key)) drift.push(key);
  }
  for (const key of typeKeys) {
    if (!routerKeys.has(key)) drift.push(key);
  }
  return drift;
};

// Locates every `<!-- shape: exhaustive -->` marker line and pairs it with the immediately
// following fenced ```json block's body (`findFencedJsonBlocks` reused, not reimplemented —
// V-INT-02). Marker line, fence-open line, first body line is that helper's own `startLine`
// convention, so a match requires `startLine === markerLine + 2`. An unmatched marker is
// dropped — nothing to compare, not itself a drift.
export const findExhaustiveMarkerBlocks = (
  content: string,
): { markerLine: number; body: string }[] => {
  const lines = content.split('\n');
  const markerLines: number[] = [];
  lines.forEach((line, idx) => {
    if (line.trim() === EXHAUSTIVE_MARKER) markerLines.push(idx + 1);
  });
  if (!markerLines.length) return [];

  const blocks = findFencedJsonBlocks(content);
  const paired: { markerLine: number; body: string }[] = [];
  for (const markerLine of markerLines) {
    const block = blocks.find((b) => b.startLine === markerLine + 2);
    if (block) paired.push({ markerLine, body: block.body });
  }
  return paired;
};

// Parses a marked block's body into the same leaf-key shape `parseRouteTypeKeys` builds (one
// key-shape convention across all three parsers here — V-INT-01). Handles the full-payload shape
// (`{ "status": ..., "route": { ... }, ... }`, worker-schemas.md) and the bare-fragment shape
// (`"route": { ... }`, queue-dag.md — not valid JSON alone, so a failed parse retries wrapped in
// `{}`). Returns `null` if both attempts fail or the resolved route value isn't an object.
export const parseExhaustiveRouteKeys = (jsonBody: string): Set<string> | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBody);
  } catch {
    try {
      parsed = JSON.parse(`{${jsonBody}}`);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const routeValue =
    'route' in (parsed as Record<string, unknown>)
      ? (parsed as Record<string, unknown>).route
      : parsed;
  if (typeof routeValue !== 'object' || routeValue === null) return null;

  const keys = new Set<string>();
  for (const [field, value] of Object.entries(routeValue as Record<string, unknown>)) {
    if (field === 'confidence' && typeof value === 'object' && value !== null) {
      for (const sub of Object.keys(value as Record<string, unknown>)) {
        keys.add(`confidence.${sub}`);
      }
    } else {
      keys.add(field);
    }
  }
  return keys;
};

const checkExhaustiveMarkerParity = (): CheckResult => {
  const routerKeys = parseRequireFieldKeys(read(ROUTER_VALIDATOR_PATH));
  const drift: string[] = [];

  for (const abs of walkMdFilesAbs(REFERENCES_DIR)) {
    const relPath = path.relative(root, abs).split(path.sep).join('/');
    const content = fs.readFileSync(abs, 'utf-8');
    for (const { markerLine, body } of findExhaustiveMarkerBlocks(content)) {
      const docKeys = parseExhaustiveRouteKeys(body);
      if (docKeys === null) {
        drift.push(`${relPath}:${markerLine} exhaustive marker's fenced JSON block failed to parse`);
        continue;
      }
      const blockDrift = findRouteShapeDrift(routerKeys, docKeys, new Set());
      if (blockDrift.length) drift.push(`${relPath}:${markerLine}: ${blockDrift.join(', ')}`);
    }
  }

  if (drift.length) return { id: 'V-SHAPE-01', ok: false, detail: drift.join('; ') };
  return { id: 'V-SHAPE-01', ok: true };
};

const checkRouteShape = (): CheckResult => {
  const routerSrc = read(ROUTER_VALIDATOR_PATH);
  const typesSrc = read(ROUTE_TYPES_PATH);

  const routerKeys = parseRequireFieldKeys(routerSrc);
  const typeKeys = parseRouteTypeKeys(typesSrc);
  const omits = parseOmitsAllowlist(typesSrc);

  const drift = findRouteShapeDrift(routerKeys, typeKeys, omits);
  if (drift.length) {
    return {
      id: 'V-SHAPE-01',
      ok: false,
      detail: `undeclared route field-set drift between ${ROUTER_VALIDATOR_PATH} and ${ROUTE_TYPES_PATH}: ${drift.join(', ')}`,
    };
  }
  return { id: 'V-SHAPE-01', ok: true };
};

export const runChecks = (): CheckResult[] => [checkRouteShape(), checkExhaustiveMarkerParity()];
