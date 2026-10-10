import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { root } from './build/paths.ts';
import { detectRunContext, routeRunContext, type AgentTool, type Overrides } from './run-context.ts';

type Fixture = {
  description: string;
  env: Record<string, string>;
  probes: { ghAuthenticated: boolean };
  tools: AgentTool[];
  overrides?: Overrides;
  expected: ReturnType<typeof routeRunContext>;
};

const fixturesDir = path.join(root, 'fixtures', 'run-context');
const fixtures = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json')).sort();

describe('routeRunContext — one fixture per run type (ADR-046)', () => {
  test('covers every run type the routing table names', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(7);
  });

  for (const file of fixtures) {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf-8')) as Fixture;
    test(`${file}: ${fixture.description}`, () => {
      const context = detectRunContext(fixture.env, fixture.probes, fixture.tools, fixture.overrides);
      expect(routeRunContext(context)).toEqual(fixture.expected);
    });
  }
});

describe('detectRunContext', () => {
  test('records where each fact came from', () => {
    const ctx = detectRunContext({ CLAUDECODE: '1', CLAUDE_CODE_PROJECTS_SESSION: '1' }, { ghAuthenticated: true }, ['agent']);
    expect(ctx.host).toEqual({ value: 'claude', source: 'env' });
    expect(ctx.surface).toEqual({ value: 'project-thread', source: 'env' });
    expect(ctx.persistent_disk).toEqual({ value: false, source: 'derived' });
    expect(ctx.fan_out).toEqual({ value: 'agent', source: 'agent' });
  });

  test('agent overrides win over detection and are marked as agent-sourced', () => {
    const ctx = detectRunContext({ CLAUDECODE: '1' }, { ghAuthenticated: false }, [], {
      surface: 'cloud',
      persistentDisk: true,
    });
    expect(ctx.surface).toEqual({ value: 'cloud', source: 'agent' });
    expect(ctx.persistent_disk).toEqual({ value: true, source: 'agent' });
  });

  test('prefers gh, then a token, then MCP for the forge channel', () => {
    const all = detectRunContext({ CLAUDECODE: '1', GH_TOKEN: 't' }, { ghAuthenticated: true }, ['agent', 'github-mcp']);
    expect(all.forge_channels.value).toEqual(['gh', 'rest', 'mcp']);
    expect(routeRunContext(all).forge_channel).toBe('gh');
    const mcpOnly = detectRunContext({ CLAUDECODE: '1' }, { ghAuthenticated: false }, ['agent', 'github-mcp']);
    expect(routeRunContext(mcpOnly).forge_channel).toBe('mcp');
  });
});
