import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const pkgPath = path.join(root, 'package.json');

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

export const readProjectIdentity = (): ProjectIdentity => {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
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
