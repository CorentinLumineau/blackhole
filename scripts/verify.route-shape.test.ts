import { describe, expect, test } from 'bun:test';
import {
  findRouteShapeDrift,
  parseOmitsAllowlist,
  parseRequireFieldKeys,
  parseRouteTypeKeys,
  runChecks,
} from './checks/route-shape.check.ts';
import { read } from './checks/check-utils.ts';

// Fixture-backed drift cases, inline rather than under a `scripts/fixtures/route-shape/`
// directory: the repo's fixture convention lives at the repo-root `fixtures/` path, and
// `config-registration.check.ts`'s own test likewise inlines its snippet strings rather than
// reaching for a fixtures directory.

const ROUTER_SNIPPET = `
export function validateRoute(route: unknown, path: string): string[] {
  const errors: string[] = [];
  requireField(errors, route, 'needs_split', isBoolean, 'boolean');
  requireField(errors, route, 'task_type', isString, 'string');
  requireField(errors, route, 'body_hash', isString, 'string');
  for (const field of ['split', 'design', 'security'] as const) {
    requireField(errors, route.confidence, field, isConfidenceScore, 'number (0-100)');
  }
  return errors;
}

export function validateRouter(data: unknown): string[] {
  const errors: string[] = [];
  requireField(errors, data, 'status', isString, 'string');
  return errors;
}
`;

const TYPES_SNIPPET_FULL_MATCH = `
export type Route = {
  needs_split?: boolean;
  task_type?: 'feature' | 'bugfix' | 'refactor' | 'docs';
  body_hash?: string;
  confidence?: { split?: number; design?: number; security?: number };
};
`;

// Drift direction A: a router-required field (`task_type`) missing from `Route`, no `omits:`.
const TYPES_SNIPPET_MISSING_ROUTER_FIELD = `
export type Route = {
  needs_split?: boolean;
  body_hash?: string;
  confidence?: { split?: number; design?: number; security?: number };
};
`;

// Drift direction B: a `Route` field (`stray_field`) the router side never requires.
const TYPES_SNIPPET_EXTRA_TYPE_FIELD = `
export type Route = {
  needs_split?: boolean;
  task_type?: 'feature' | 'bugfix' | 'refactor' | 'docs';
  body_hash?: string;
  stray_field?: boolean;
  confidence?: { split?: number; design?: number; security?: number };
};
`;

const TYPES_SNIPPET_WITH_OMITS = `
// Mirrors the route object SSOT.
// omits: task_type — not read by campaign-status.ts's current consumers (V-SHAPE-01 declared narrowing).
export type Route = {
  needs_split?: boolean;
  body_hash?: string;
  confidence?: { split?: number; design?: number; security?: number };
};
`;

describe('parseRequireFieldKeys', () => {
  test('extracts route-level requireField keys and expands the confidence loop', () => {
    const keys = parseRequireFieldKeys(ROUTER_SNIPPET);
    expect(keys.has('needs_split')).toBe(true);
    expect(keys.has('task_type')).toBe(true);
    expect(keys.has('body_hash')).toBe(true);
    expect(keys.has('confidence.split')).toBe(true);
    expect(keys.has('confidence.design')).toBe(true);
    expect(keys.has('confidence.security')).toBe(true);
  });

  test('does not leak validateRouter-only fields (status) into the route key set', () => {
    const keys = parseRequireFieldKeys(ROUTER_SNIPPET);
    expect(keys.has('status')).toBe(false);
  });
});

describe('parseRouteTypeKeys', () => {
  test('extracts top-level fields and expands the nested confidence object', () => {
    const keys = parseRouteTypeKeys(TYPES_SNIPPET_FULL_MATCH);
    expect(keys.has('needs_split')).toBe(true);
    expect(keys.has('task_type')).toBe(true);
    expect(keys.has('body_hash')).toBe(true);
    expect(keys.has('confidence.split')).toBe(true);
    expect(keys.has('confidence.design')).toBe(true);
    expect(keys.has('confidence.security')).toBe(true);
    expect(keys.has('confidence')).toBe(false);
  });
});

describe('parseOmitsAllowlist', () => {
  test('returns an empty set when no omits comment is present', () => {
    expect(parseOmitsAllowlist(TYPES_SNIPPET_FULL_MATCH)).toEqual(new Set());
  });

  test('parses a declared omits line into a key set', () => {
    const omits = parseOmitsAllowlist(TYPES_SNIPPET_WITH_OMITS);
    expect(omits.has('task_type')).toBe(true);
    expect(omits.size).toBe(1);
  });
});

describe('findRouteShapeDrift (V-SHAPE-01)', () => {
  test('reports no drift when both sides match exactly', () => {
    const routerKeys = parseRequireFieldKeys(ROUTER_SNIPPET);
    const typeKeys = parseRouteTypeKeys(TYPES_SNIPPET_FULL_MATCH);
    expect(findRouteShapeDrift(routerKeys, typeKeys, new Set())).toEqual([]);
  });

  test('drift direction A: router-required field missing from Route with no omits entry', () => {
    const routerKeys = parseRequireFieldKeys(ROUTER_SNIPPET);
    const typeKeys = parseRouteTypeKeys(TYPES_SNIPPET_MISSING_ROUTER_FIELD);
    expect(findRouteShapeDrift(routerKeys, typeKeys, new Set())).toContain('task_type');
  });

  test('drift direction B: Route field the router side never requires', () => {
    const routerKeys = parseRequireFieldKeys(ROUTER_SNIPPET);
    const typeKeys = parseRouteTypeKeys(TYPES_SNIPPET_EXTRA_TYPE_FIELD);
    expect(findRouteShapeDrift(routerKeys, typeKeys, new Set())).toContain('stray_field');
  });

  test('a declared omits entry suppresses direction-A drift for that key', () => {
    const routerKeys = parseRequireFieldKeys(ROUTER_SNIPPET);
    const typeKeys = parseRouteTypeKeys(TYPES_SNIPPET_WITH_OMITS);
    const omits = parseOmitsAllowlist(TYPES_SNIPPET_WITH_OMITS);
    expect(findRouteShapeDrift(routerKeys, typeKeys, omits)).toEqual([]);
  });
});

describe('runChecks live tree', () => {
  test('V-SHAPE-01 passes against the live router.ts / types.ts pair', () => {
    const results = runChecks();
    const row = results.find((r) => r.id === 'V-SHAPE-01');
    expect(row?.ok).toBe(true);
  });

  test('live router.ts parses to a non-empty required-key set', () => {
    const keys = parseRequireFieldKeys(read('scripts/lib/worker-json/validators/router.ts'));
    expect(keys.size).toBeGreaterThan(10);
  });

  test('live types.ts declares an omits allowlist covering every undeclared router-only key', () => {
    const routerKeys = parseRequireFieldKeys(read('scripts/lib/worker-json/validators/router.ts'));
    const typesSrc = read('scripts/lib/campaign-status/types.ts');
    const typeKeys = parseRouteTypeKeys(typesSrc);
    const omits = parseOmitsAllowlist(typesSrc);
    expect(findRouteShapeDrift(routerKeys, typeKeys, omits)).toEqual([]);
  });
});
