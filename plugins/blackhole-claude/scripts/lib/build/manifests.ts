import * as path from 'path';
import { projectIdentity } from '../../project-identity.ts';
import { CLAUDE_DISTRIBUTION_ROOT } from './paths.ts';

export const AGENT_PLUGINS_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';

export const buildAgentPluginsManifest = (pkgVersion: string) => ({
  $schema: AGENT_PLUGINS_SCHEMA,
  name: projectIdentity.name,
  description: projectIdentity.description,
  version: pkgVersion,
  author: { name: 'blackhole contributors' },
  license: 'Apache-2.0',
  keywords: [projectIdentity.name, 'agent-plugins', ...projectIdentity.keywordsBase],
});

export const buildGeminiPluginManifest = (pkgVersion: string) => ({
  $schema: 'https://antigravity.google/schemas/v1/plugin.json',
  name: projectIdentity.name,
  description: projectIdentity.description,
  version: pkgVersion,
  author: { name: 'blackhole contributors' },
  license: 'Apache-2.0',
  keywords: [projectIdentity.name, 'gemini', ...projectIdentity.keywordsBase],
});

export const buildCodexPluginManifest = (pkgVersion: string) => ({
  name: projectIdentity.name,
  version: pkgVersion,
  description: projectIdentity.description,
  author: {
    name: 'Corentin Lumineau',
    email: 'corentin@lumineau.dev',
    url: 'https://github.com/CorentinLumineau',
  },
  homepage: projectIdentity.homepage,
  repository: projectIdentity.repository,
  license: 'Apache-2.0',
  keywords: [projectIdentity.name, 'codex', ...projectIdentity.keywordsBase],
  skills: './codex-skills/',
  interface: {
    displayName: 'Blackhole',
    shortDescription: 'Auto-solve your entire GitHub backlog',
    longDescription: 'Five-phase lifecycle: Handle → Plan → Implement → Review → Loop.',
    developerName: 'Corentin Lumineau',
    category: 'Developer Tools',
    capabilities: ['Write', 'Interactive'],
    websiteURL: projectIdentity.repository,
    defaultPrompt: [
      'Run the backlog campaign until empty for this repo.',
      'Show backlog status: open issues, in-flight, and queue.',
      'Implement issue #N using the campaign pipeline.',
    ],
    brandColor: '#3B82F6',
  },
});

export const buildCodexMarketplace = () => ({
  name: `${projectIdentity.name}-codex`,
  interface: { displayName: 'Blackhole - Codex' },
  plugins: [
    {
      name: projectIdentity.name,
      source: {
        source: 'git',
        url: projectIdentity.repository,
      },
      policy: {
        installation: 'AVAILABLE',
        authentication: 'ON_INSTALL',
      },
      category: 'Developer Tools',
    },
  ],
});

export const buildClaudePluginManifest = (pkgVersion: string) => ({
  name: projectIdentity.name,
  description: projectIdentity.description,
  version: pkgVersion,
  author: { name: 'blackhole contributors' },
  license: 'Apache-2.0',
  keywords: [projectIdentity.name, 'claude-code', ...projectIdentity.keywordsBase],
});

/** `source` points at the isolated Claude marketplace bundle (ADR-009, issue #262) rather than
 * the repo root — Claude Code resolves a relative `"./..."` source against the marketplace root
 * (the dir containing `.claude-plugin/`), so this keeps maintainer-only repo-root `.claude/`
 * content out of every consumer's install surface. */
export const buildClaudeMarketplace = (pluginMeta: ReturnType<typeof buildClaudePluginManifest>) => ({
  name: `${projectIdentity.name}-marketplace`,
  description: 'Blackhole Marketplace',
  owner: { name: 'CorentinLumineau' },
  plugins: [{ ...pluginMeta, source: `./${CLAUDE_DISTRIBUTION_ROOT.split(path.sep).join('/')}` }],
});
