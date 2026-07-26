import { describe, expect, test } from 'bun:test';
import {
  validateRefreshedAtFixture,
  validateGeminiPluginFixture,
  validateCodexPluginFixture,
  validateCodexMarketplaceFixture,
  validateQueueIssuesShape,
  validateConfigFixtureShape,
} from './checks/schema.check.ts';

// V-SCHEMA-01 (#279): checkFixtures' per-fixture-type shape validators, extracted from the
// previously-untested inline branching so each rejects a deliberately malformed fixture and
// accepts a valid one — not mere existence checks.
describe('validateRefreshedAtFixture', () => {
  test('accepts a fixture with refreshed_at present', () => {
    expect(
      validateRefreshedAtFixture('fixtures/queue.example.json', { refreshed_at: '2026-01-01T00:00:00Z' }),
    ).toEqual([]);
  });

  test('rejects a fixture missing refreshed_at', () => {
    expect(validateRefreshedAtFixture('fixtures/queue.example.json', {})).toEqual([
      'fixtures/queue.example.json: missing refreshed_at',
    ]);
  });
});

describe('validateGeminiPluginFixture', () => {
  test('accepts a fixture with $schema/name/version/description all present', () => {
    const data = { $schema: 'https://example.com/schema.json', name: 'blackhole', version: '1.0.0', description: 'desc' };
    expect(validateGeminiPluginFixture('fixtures/gemini-plugin.example.json', data)).toEqual([]);
  });

  test('rejects a fixture missing required keys, naming each one', () => {
    const data = { name: 'blackhole' };
    expect(validateGeminiPluginFixture('fixtures/gemini-plugin.example.json', data)).toEqual([
      'fixtures/gemini-plugin.example.json: missing $schema',
      'fixtures/gemini-plugin.example.json: missing version',
      'fixtures/gemini-plugin.example.json: missing description',
    ]);
  });
});

describe('validateCodexPluginFixture', () => {
  test('accepts a fixture with name/interface/skills and interface.displayName present', () => {
    const data = { name: 'blackhole', interface: { displayName: 'Blackhole' }, skills: './codex-skills/' };
    expect(validateCodexPluginFixture('fixtures/codex-plugin.example.json', data)).toEqual([]);
  });

  test('rejects a fixture missing top-level keys and interface.displayName', () => {
    const data = { interface: {} };
    expect(validateCodexPluginFixture('fixtures/codex-plugin.example.json', data)).toEqual([
      'fixtures/codex-plugin.example.json: missing name',
      'fixtures/codex-plugin.example.json: missing skills',
      'fixtures/codex-plugin.example.json: interface missing displayName',
    ]);
  });
});

describe('validateCodexMarketplaceFixture', () => {
  test('accepts a fixture whose plugins[0].source.source is git', () => {
    const data = { plugins: [{ source: { source: 'git' } }] };
    expect(validateCodexMarketplaceFixture('fixtures/codex-marketplace.example.json', data)).toEqual([]);
  });

  test('rejects a fixture with a non-git source', () => {
    const data = { plugins: [{ source: { source: 'npm' } }] };
    expect(validateCodexMarketplaceFixture('fixtures/codex-marketplace.example.json', data)).toEqual([
      'fixtures/codex-marketplace.example.json: plugins[0].source.source must be git',
    ]);
  });

  test('rejects a fixture with no plugins[0].source.source at all (both checks fire — missing is also not "git")', () => {
    const data = { plugins: [{}] };
    expect(validateCodexMarketplaceFixture('fixtures/codex-marketplace.example.json', data)).toEqual([
      'fixtures/codex-marketplace.example.json: plugins[0].source.source missing',
      'fixtures/codex-marketplace.example.json: plugins[0].source.source must be git',
    ]);
  });
});

describe('validateQueueIssuesShape', () => {
  test('accepts a queue where every issue has a numeric review_iteration', () => {
    const queue = { issues: { '1': { review_iteration: 0 }, '2': { review_iteration: 2 } } };
    expect(validateQueueIssuesShape(queue)).toEqual([]);
  });

  test('rejects a queue with no issues object', () => {
    expect(validateQueueIssuesShape({})).toEqual(['queue.example.json: missing issues object']);
  });

  test('rejects a queue whose issue is missing review_iteration', () => {
    const queue = { issues: { '1': { phase: 'plan' } } };
    expect(validateQueueIssuesShape(queue)).toEqual(['queue.example.json: issue missing review_iteration']);
  });
});

describe('validateConfigFixtureShape', () => {
  test('accepts a config with required string keys and valid optional fields', () => {
    const config = {
      repo: 'CorentinLumineau/blackhole',
      target_branch: 'main',
      forge: 'github',
      scope_milestone: 'v0.4.0',
      scope_labels: ['blackhole/backlog'],
    };
    expect(validateConfigFixtureShape(config)).toEqual([]);
  });

  test('rejects a config missing required keys and with invalid optional field types', () => {
    const config = { repo: 'owner/repo-name', scope_milestone: 42, scope_labels: ['ok', 7] };
    expect(validateConfigFixtureShape(config)).toEqual([
      'config.example.json: missing or invalid target_branch',
      'config.example.json: missing or invalid forge',
      'config.example.json: scope_milestone must be a string',
      'config.example.json: scope_labels must be a string array',
    ]);
  });
});
