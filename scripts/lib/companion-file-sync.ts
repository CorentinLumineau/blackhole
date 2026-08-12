import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from './fs.ts';

export type CompanionRepair = {
  vcode: 'V-ADA-01' | 'V-ADA-05';
  file: string;
  action: string;
};

/** Code-surface prefixes — see `src/references/companion-file-sync.md` § Triggers. */
const CODE_SURFACE_PREFIXES = [
  'src/',
  'scripts/',
  'lib/',
  'apps/',
  'packages/',
  'services/',
  '.cursor/',
  '.claude/',
  'codex-skills/',
  'codex-agents/',
  'templates/hooks/',
  'plugins/',
] as const;

const CODE_SURFACE_ROOT_FILES = new Set([
  'package.json',
  'tsconfig.json',
  'bun.lock',
  'bun.lockb',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
]);

/** Agent-surface prefixes for root `V-ADA-05` repair — narrower than code-surface. */
const AGENT_SURFACE_PREFIXES = [
  'src/agents/',
  '.cursor/agents/',
  '.cursor/rules/',
  '.claude/agents/',
  'codex-agents/',
  'codex-skills/blackhole/agents/',
] as const;

const AGENT_SURFACE_ROOT_FILES = new Set(['AGENTS.md', 'CLAUDE.md']);

const normalizeDiffPath = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

export const isDocOnlyMarkdownDiff = (diffPaths: string[]): boolean => {
  if (diffPaths.length === 0) return true;
  return diffPaths.every((raw) => {
    const p = normalizeDiffPath(raw);
    return p.startsWith('documentation/') && p.endsWith('.md');
  });
};

export const hasCodeSurfaceTrigger = (diffPaths: string[]): boolean => {
  if (diffPaths.length === 0) return false;
  if (isDocOnlyMarkdownDiff(diffPaths)) return false;
  return diffPaths.some((raw) => {
    const p = normalizeDiffPath(raw);
    if (CODE_SURFACE_ROOT_FILES.has(p)) return true;
    return CODE_SURFACE_PREFIXES.some((prefix) => p === prefix.slice(0, -1) || p.startsWith(prefix));
  });
};

export const hasAgentSurfaceTrigger = (diffPaths: string[]): boolean => {
  if (diffPaths.length === 0) return false;
  return diffPaths.some((raw) => {
    const p = normalizeDiffPath(raw);
    if (AGENT_SURFACE_ROOT_FILES.has(p)) return true;
    return AGENT_SURFACE_PREFIXES.some((prefix) => p === prefix.slice(0, -1) || p.startsWith(prefix));
  });
};

export const resolveProjectName = (repoRoot: string): string => {
  const configPath = path.join(repoRoot, '.blackhole', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = readJsonFile(configPath, configPath) as { repo?: string };
      if (typeof config.repo === 'string' && config.repo.includes('/')) {
        const segment = config.repo.split('/').pop();
        if (segment) return segment;
      }
    } catch {
      // fall through to basename
    }
  }
  return path.basename(repoRoot);
};

const substituteProjectName = (content: string, projectName: string): string =>
  content.replaceAll('{project-name}', projectName);

const templatePath = (repoRoot: string, name: string): string =>
  path.join(repoRoot, 'templates', 'companion-files', `${name}.template`);

const readTemplate = (repoRoot: string, name: string): string => {
  const file = templatePath(repoRoot, name);
  return fs.readFileSync(file, 'utf-8');
};

export const needsArchitectureRepair = (repoRoot: string, diffPaths: string[]): boolean => {
  const archPath = path.join(repoRoot, 'ARCHITECTURE.md');
  if (fs.existsSync(archPath)) return false;
  return hasCodeSurfaceTrigger(diffPaths);
};

export const needsAgentsSymlinkRepair = (repoRoot: string): boolean => {
  const agentsPath = path.join(repoRoot, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) return true;
  const stat = fs.lstatSync(agentsPath);
  if (stat.isFile() && !stat.isSymbolicLink()) return true;
  if (!stat.isSymbolicLink()) return true;
  const target = fs.readlinkSync(agentsPath);
  const resolved = path.isAbsolute(target)
    ? target
    : path.resolve(path.dirname(agentsPath), target);
  const expected = path.join(repoRoot, 'CLAUDE.md');
  return path.normalize(resolved) !== path.normalize(expected);
};

export const createArchitectureFromTemplate = (
  repoRoot: string,
  projectName: string,
): CompanionRepair | null => {
  const target = path.join(repoRoot, 'ARCHITECTURE.md');
  if (fs.existsSync(target)) return null;
  const content = substituteProjectName(readTemplate(repoRoot, 'ARCHITECTURE.md'), projectName);
  fs.writeFileSync(target, content, 'utf-8');
  return {
    vcode: 'V-ADA-01',
    file: 'ARCHITECTURE.md',
    action: 'created from templates/companion-files/ARCHITECTURE.md.template',
  };
};

export const repairAgentsSymlink = (repoRoot: string, projectName: string): CompanionRepair[] => {
  const repairs: CompanionRepair[] = [];
  const claudePath = path.join(repoRoot, 'CLAUDE.md');
  const agentsPath = path.join(repoRoot, 'AGENTS.md');

  if (!fs.existsSync(claudePath)) {
    const content = substituteProjectName(readTemplate(repoRoot, 'AGENTS.md'), projectName);
    fs.writeFileSync(claudePath, content, 'utf-8');
    repairs.push({
      vcode: 'V-ADA-05',
      file: 'CLAUDE.md',
      action: 'created from templates/companion-files/AGENTS.md.template',
    });
  }

  if (fs.existsSync(agentsPath)) {
    const stat = fs.lstatSync(agentsPath);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(agentsPath);
      const resolved = path.isAbsolute(target)
        ? target
        : path.resolve(path.dirname(agentsPath), target);
      if (path.normalize(resolved) === path.normalize(claudePath)) {
        return repairs;
      }
      fs.unlinkSync(agentsPath);
    } else {
      fs.unlinkSync(agentsPath);
    }
  }

  fs.symlinkSync('CLAUDE.md', agentsPath);
  repairs.push({
    vcode: 'V-ADA-05',
    file: 'AGENTS.md',
    action: 'replaced with symlink to CLAUDE.md',
  });
  return repairs;
};

export const runCompanionFileSync = (
  repoRoot: string,
  diffPaths: string[],
  projectName = resolveProjectName(repoRoot),
): { repairs: CompanionRepair[] } => {
  const repairs: CompanionRepair[] = [];

  if (needsArchitectureRepair(repoRoot, diffPaths)) {
    const repair = createArchitectureFromTemplate(repoRoot, projectName);
    if (repair) repairs.push(repair);
  }

  if (hasAgentSurfaceTrigger(diffPaths) && needsAgentsSymlinkRepair(repoRoot)) {
    repairs.push(...repairAgentsSymlink(repoRoot, projectName));
  }

  return { repairs };
};

export const readDiffFile = (diffFilePath: string): string[] =>
  fs
    .readFileSync(diffFilePath, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

function parseCliArgs(argv: string[]): { repoRoot: string | null; diffFile: string | null } {
  let repoRoot: string | null = null;
  let diffFile: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo-root' && argv[i + 1]) {
      repoRoot = argv[++i];
    } else if (arg === '--diff-file' && argv[i + 1]) {
      diffFile = argv[++i];
    }
  }
  return { repoRoot, diffFile };
}

if (import.meta.main) {
  const { repoRoot, diffFile } = parseCliArgs(process.argv.slice(2));
  if (!repoRoot || !diffFile) {
    console.error(
      'Usage: bun run scripts/lib/companion-file-sync.ts --repo-root <path> --diff-file <paths.txt>',
    );
    process.exit(2);
  }
  const diffPaths = readDiffFile(diffFile);
  const result = runCompanionFileSync(path.resolve(repoRoot), diffPaths);
  console.log(JSON.stringify(result, null, 2));
}
