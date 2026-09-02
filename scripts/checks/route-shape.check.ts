import { read, type CheckResult } from './check-utils.ts';

// route-shape.check.ts: keeps the `route` object's field set consistent between its
// enforced-truth declaration site (router.ts's `requireField` calls) and a deliberately
// narrower consumer type (`campaign-status/types.ts`'s `Route`).
//
// V-SHAPE-01: a `route`/`route.confidence` leaf key required by `validateRoute` (router.ts)
// but absent from `Route` (types.ts), with no matching `// omits:` allowlist entry on that
// type's header comment, is undeclared drift. So is a `Route` leaf key absent from router.ts's
// required set — `types.ts` is meant to be a subset of the validator's truth, never a
// superset.

const ROUTER_VALIDATOR_PATH = 'scripts/lib/worker-json/validators/router.ts';
const ROUTE_TYPES_PATH = 'scripts/lib/campaign-status/types.ts';

/**
 * Extracts every `route`/`route.confidence` leaf key that `validateRoute` requires — the
 * top-level `requireField(errors, route, '<field>', ...)` calls, plus the `confidence.<field>`
 * keys named in the `for (const field of [...])` loop that drives the nested
 * `requireField(errors, route.confidence, field, ...)` call. Scoped to the `validateRoute`
 * function body only (stops at the next `export function`) so `validateRouter`'s own top-level
 * fields (`status`, `trigger`, ...) never leak into the `route` shape comparison.
 */
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

/**
 * Extracts every leaf key declared on the `Route` type — top-level fields as-is, and the
 * nested `confidence` object's own fields expanded to `confidence.<field>` (never a bare
 * `confidence` entry, matching the router side's leaf-only comparison — see module header).
 */
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

/**
 * Parses the `Route` type's declared `// omits: a, b, c — <reason>` allowlist line (if any)
 * from its header comment into the set of router-required keys the type deliberately does not
 * mirror.
 */
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

/**
 * Undeclared drift between the two sides: a router-required key missing from `typeKeys` and
 * not covered by `omits`, or a `typeKeys` entry the router side never requires at all (the
 * type is a narrower subset by convention — a stray extra key is always a bug, never
 * declarable via `omits`).
 */
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

export const runChecks = (): CheckResult[] => [checkRouteShape()];
