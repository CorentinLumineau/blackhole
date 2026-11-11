import * as path from 'path';
import * as fs from 'fs';
import { readJsonFile } from './lib/fs.ts';

const root = path.resolve(import.meta.dirname, '..');

export type ProjectIdentity = {
  name: string;
  version: string;
  description: string;
  homepage: string;
  repository: string;
  keywordsBase: string[];
};

/** GitHub repo URL shared by homepage/repository — not sourced from package.json (absent there today). */
const REPO_URL = 'https://github.com/CorentinLumineau/blackhole';
const KEYWORDS_BASE = ['native', 'workflows', 'skills'];

type Manifest = { name?: string; version?: string; description?: string };

const FALLBACK: Required<Manifest> = {
  name: 'blackhole',
  version: '0.0.0',
  description: 'Agent-agnostic backlog campaign orchestrator to empty the forge backlog.',
};

/**
 * An installed plugin ships `.claude-plugin/plugin.json` but no `package.json` (the build copies
 * only agents/hooks/rules/scripts/skills/templates), so the source-repo `package.json` is
 * preferred and the shipped manifest is the fallback; built-in defaults keep the read total.
 */
const readManifest = (rootDir: string): Manifest => {
  for (const rel of ['package.json', path.join('.claude-plugin', 'plugin.json')]) {
    const file = path.join(rootDir, rel);
    if (fs.existsSync(file)) return readJsonFile(file, file) as Manifest;
  }
  return {};
};

export const readProjectIdentity = (rootDir: string = root): ProjectIdentity => {
  const pkg = { ...FALLBACK, ...readManifest(rootDir) };
  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    homepage: REPO_URL,
    repository: REPO_URL,
    keywordsBase: KEYWORDS_BASE,
  };
};

export const projectIdentity = readProjectIdentity();
