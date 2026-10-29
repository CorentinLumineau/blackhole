import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { AGENT_NAMES } from './lib/build/facts.ts';
import { PRETOOLUSE_HOOKS_DIR } from './lib/test-fixtures.ts';

const { CAMPAIGN_AGENT_TYPES, isCampaignAgentType, isCampaignScoped } = require(
  path.join(PRETOOLUSE_HOOKS_DIR, 'utils', 'campaign-scope.js'),
);

describe('campaign-scope.js (ADR-047)', () => {
  test('knows exactly the campaign agents the build ships', () => {
    expect([...CAMPAIGN_AGENT_TYPES].sort()).toEqual([...AGENT_NAMES].sort());
  });

  test('accepts bare and plugin-prefixed agent types, nothing else', () => {
    expect(isCampaignAgentType('implementer')).toBe(true);
    expect(isCampaignAgentType('blackhole:reviewer')).toBe(true);
    expect(isCampaignAgentType('general-purpose')).toBe(false);
    expect(isCampaignAgentType('Explore')).toBe(false);
    expect(isCampaignAgentType(undefined)).toBe(false);
    expect(isCampaignAgentType(42)).toBe(false);
  });

  test('an assigned worktree or BLACKHOLE_HOOK_SCOPE=all scopes any caller', () => {
    expect(isCampaignScoped({}, null, {})).toBe(false);
    expect(isCampaignScoped({ agent_type: 'general-purpose' }, '/repo/wt-1', {})).toBe(true);
    expect(isCampaignScoped({}, null, { BLACKHOLE_HOOK_SCOPE: 'all' })).toBe(true);
    expect(isCampaignScoped({ agent_type: 'blackhole:implementer' }, null, {})).toBe(true);
  });
});
