import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  findUnregisteredConfigKeys,
  flattenConfigKeys,
  parseConfigTemplateKeys,
  runChecks,
} from './checks/config-registration.check.ts';
import { read } from './checks/check-utils.ts';

const TEMPLATE_SNIPPET = `
| Field | Required | Description |
|-------|----------|-------------|
| repo | yes | owner/name |
| docs_governance.enabled | no | kill switch |
`;

describe('parseConfigTemplateKeys', () => {
  test('extracts dot-path keys from the field table', () => {
    const keys = parseConfigTemplateKeys(TEMPLATE_SNIPPET);
    expect(keys.has('repo')).toBe(true);
    expect(keys.has('docs_governance.enabled')).toBe(true);
  });

  test('registers a parent row\'s named sub-keys via a (sub-keys: ...) marker', () => {
    const snippet = `
| Field | Required | Description |
|-------|----------|-------------|
| router_confidence_thresholds | no | Per-flag thresholds (sub-keys: split, design) |
`;
    const keys = parseConfigTemplateKeys(snippet);
    expect(keys.has('router_confidence_thresholds')).toBe(true);
    expect(keys.has('router_confidence_thresholds.split')).toBe(true);
    expect(keys.has('router_confidence_thresholds.design')).toBe(true);
  });
});

describe('flattenConfigKeys', () => {
  test('flattens nested objects with dot notation', () => {
    const flat = flattenConfigKeys({ repo: 'o/r', docs_governance: { enabled: true } });
    expect(flat).toContain('repo');
    expect(flat).toContain('docs_governance.enabled');
  });
});

describe('findUnregisteredConfigKeys (V-CONFIG-02)', () => {
  test('flags keys absent from the template', () => {
    const templateKeys = parseConfigTemplateKeys(TEMPLATE_SNIPPET);
    const configKeys = flattenConfigKeys({ repo: 'o/r', stray_campaign_key: true });
    expect(findUnregisteredConfigKeys(configKeys, templateKeys)).toEqual(['stray_campaign_key']);
  });

  test('passes when every config key is registered', () => {
    const templateKeys = parseConfigTemplateKeys(TEMPLATE_SNIPPET);
    const configKeys = flattenConfigKeys({ repo: 'o/r' });
    expect(findUnregisteredConfigKeys(configKeys, templateKeys)).toEqual([]);
  });

  test('a sub-key not named in the parent row marker still fails', () => {
    const snippet = `
| Field | Required | Description |
|-------|----------|-------------|
| router_confidence_thresholds | no | Per-flag thresholds (sub-keys: split, design) |
`;
    const templateKeys = parseConfigTemplateKeys(snippet);
    const configKeys = flattenConfigKeys({
      router_confidence_thresholds: { split: 70, undocumented_leaf: 1 },
    });
    expect(findUnregisteredConfigKeys(configKeys, templateKeys)).toEqual([
      'router_confidence_thresholds.undocumented_leaf',
    ]);
  });
});

describe('fixture: unregistered key fails check', () => {
  const fixtureDir = path.join(import.meta.dirname, '..', 'fixtures', 'config-registration');
  const fixtureTemplate = path.join(fixtureDir, 'config-template-snippet.md');
  const fixtureConfig = path.join(fixtureDir, 'unregistered-config.json');

  test('fixture config contains a key not in the template snippet', () => {
    const templateKeys = parseConfigTemplateKeys(fs.readFileSync(fixtureTemplate, 'utf-8'));
    const configKeys = flattenConfigKeys(
      JSON.parse(fs.readFileSync(fixtureConfig, 'utf-8')) as Record<string, unknown>,
    );
    expect(findUnregisteredConfigKeys(configKeys, templateKeys)).toContain('campaign_only_key');
  });
});

describe('runChecks live tree', () => {
  test('passes when config.json is absent or fully registered', () => {
    const results = runChecks();
    const row = results.find((r) => r.id === 'V-CONFIG-02');
    expect(row?.ok).toBe(true);
  });

  test('live config-template.md parses to a non-empty key set', () => {
    const keys = parseConfigTemplateKeys(read('src/references/config-template.md'));
    expect(keys.size).toBeGreaterThan(10);
  });

  test('live template registers every documented router_confidence_thresholds sub-key', () => {
    const templateKeys = parseConfigTemplateKeys(read('src/references/config-template.md'));
    const configKeys = flattenConfigKeys({
      router_confidence_thresholds: {
        split: 70,
        design: 70,
        plan_mode: 70,
        security: 70,
        docs: 70,
        brainstorm: 70,
        analysis: 70,
        ui: 70,
      },
    });
    expect(findUnregisteredConfigKeys(configKeys, templateKeys)).toEqual([]);
  });
});
