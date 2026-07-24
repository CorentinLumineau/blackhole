import * as path from 'path';
import * as fs from 'fs';

// ADR-007 T5/R2' — schema.check.ts: fixture JSON shape validators (split from the former
// catch-all check file, issue #322).

const root = path.resolve(import.meta.dirname, '..', '..');

export type CheckResult = { id: string; ok: boolean; detail?: string };

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

// Per-fixture-type shape validators (V-SCHEMA-01), extracted for direct unit coverage (#279 —
// checkFixtures previously had ~74 lines of inline per-fixture branching with zero tests). Each
// takes the already-JSON.parsed fixture body plus its label (used verbatim in error messages, so
// output text is unchanged from the pre-extraction inline version) and returns the shape errors
// found — [] when valid. Pure, no I/O: checkFixtures alone owns read()/JSON.parse()/try-catch and
// just wires these into its errors array (behavior-preserving extraction, no message changed).
export const validateRefreshedAtFixture = (label: string, data: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  if (!data.refreshed_at) errors.push(`${label}: missing refreshed_at`);
  return errors;
};

export const validateGeminiPluginFixture = (label: string, data: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  for (const key of ['$schema', 'name', 'version', 'description']) {
    if (!data[key]) errors.push(`${label}: missing ${key}`);
  }
  return errors;
};

export const validateCodexPluginFixture = (label: string, data: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  for (const key of ['name', 'interface', 'skills']) {
    if (!data[key]) errors.push(`${label}: missing ${key}`);
  }
  const iface = data.interface as Record<string, unknown> | undefined;
  if (iface && !iface.displayName) {
    errors.push(`${label}: interface missing displayName`);
  }
  return errors;
};

export const validateCodexMarketplaceFixture = (label: string, data: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  const plugins = data.plugins as Array<Record<string, unknown>> | undefined;
  const source = plugins?.[0]?.source as Record<string, unknown> | undefined;
  if (!source?.source) {
    errors.push(`${label}: plugins[0].source.source missing`);
  }
  if (source?.source !== 'git') {
    errors.push(`${label}: plugins[0].source.source must be git`);
  }
  return errors;
};

export const validateQueueIssuesShape = (queue: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  if (!queue.issues || typeof queue.issues !== 'object') {
    errors.push('queue.example.json: missing issues object');
    return errors;
  }
  for (const [, issue] of Object.entries(queue.issues as Record<string, unknown>) as [string, Record<string, unknown>][]) {
    if (typeof issue.review_iteration !== 'number') {
      errors.push('queue.example.json: issue missing review_iteration');
      break;
    }
  }
  return errors;
};

export const validateConfigFixtureShape = (config: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  for (const key of ['repo', 'target_branch', 'forge'] as const) {
    if (!config[key] || typeof config[key] !== 'string') {
      errors.push(`config.example.json: missing or invalid ${key}`);
    }
  }
  if (config.scope_milestone !== undefined && typeof config.scope_milestone !== 'string') {
    errors.push('config.example.json: scope_milestone must be a string');
  }
  if (config.scope_labels !== undefined) {
    if (!Array.isArray(config.scope_labels) || !config.scope_labels.every((l: unknown) => typeof l === 'string')) {
      errors.push('config.example.json: scope_labels must be a string array');
    }
  }
  return errors;
};

// V-SCHEMA-01: Fixture JSON validates
const checkFixtures = (): CheckResult => {
  const errors: string[] = [];

  for (const fixture of [
    'fixtures/queue.example.json',
    'fixtures/findings-ledger.example.json',
    'fixtures/gemini-plugin.example.json',
    'fixtures/codex-plugin.example.json',
    'fixtures/codex-marketplace.example.json',
  ]) {
    try {
      const data = JSON.parse(read(fixture));
      if (fixture.includes('queue') || fixture.includes('findings-ledger')) {
        errors.push(...validateRefreshedAtFixture(fixture, data));
      }
      if (fixture.includes('gemini-plugin')) {
        errors.push(...validateGeminiPluginFixture(fixture, data));
      }
      if (fixture.includes('codex-plugin')) {
        errors.push(...validateCodexPluginFixture(fixture, data));
      }
      if (fixture.includes('codex-marketplace')) {
        errors.push(...validateCodexMarketplaceFixture(fixture, data));
      }
    } catch (e) {
      errors.push(`${fixture}: invalid JSON`);
    }
  }

  const queue = JSON.parse(read('fixtures/queue.example.json'));
  errors.push(...validateQueueIssuesShape(queue));

  try {
    const config = JSON.parse(read('fixtures/config.example.json'));
    errors.push(...validateConfigFixtureShape(config));
  } catch {
    errors.push('fixtures/config.example.json: invalid JSON');
  }

  if (errors.length) return { id: 'V-SCHEMA-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-SCHEMA-01', ok: true };
};

// ADR-007 T5/R2': domain entrypoint — see agents.check.ts's runChecks doc comment for the shared
// contract (pure, no side effects, glob-discovered by scripts/verify.ts).
export const runChecks = (): CheckResult[] => [checkFixtures()];
