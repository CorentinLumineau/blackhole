import * as fs from 'fs';
import * as path from 'path';
import { readJsonFile } from './fs.ts';
import { parseFlags } from './argv-flags.ts';
import { parseFrontmatterFields, parseMdFrontmatter } from './build/content.ts';

export type CompanionRepair = {
  vcode: 'V-ADA-01' | 'V-ADA-05' | 'V-ADA-09';
  file: string;
  action: string;
};

// Issue #766: the root companion file set, named once so consumers (e.g. V-ADR-06 leg 2's
// undisclosed-reversal scan in adr-supersession.check.ts) have one place to look instead of
// re-deriving the set from this file's separate per-file literals below.
export const ROOT_COMPANION_MD_FILES = ['ARCHITECTURE.md', 'AGENTS.md', 'README.md'] as const;

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
  // A distinct regular file (or any other non-symlink entry, e.g. a directory) is not our
  // repair target — only an absent AGENTS.md or a symlink pointing away from CLAUDE.md is.
  if (!stat.isSymbolicLink()) return false;
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
  const claudePath = path.join(repoRoot, 'CLAUDE.md');
  const agentsPath = path.join(repoRoot, 'AGENTS.md');

  // A distinct regular file (or any other non-symlink entry) is not our repair target — bail
  // out before any write so a skipped repair is a true no-op, not a partial
  // CLAUDE.md-created-but-AGENTS.md-untouched state.
  if (fs.existsSync(agentsPath) && !fs.lstatSync(agentsPath).isSymbolicLink()) {
    return [];
  }

  const repairs: CompanionRepair[] = [];

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
    const target = fs.readlinkSync(agentsPath);
    const resolved = path.isAbsolute(target)
      ? target
      : path.resolve(path.dirname(agentsPath), target);
    if (path.normalize(resolved) === path.normalize(claudePath)) {
      return repairs;
    }
    fs.unlinkSync(agentsPath);
  }

  fs.symlinkSync('CLAUDE.md', agentsPath);
  repairs.push({
    vcode: 'V-ADA-05',
    file: 'AGENTS.md',
    action: 'replaced with symlink to CLAUDE.md',
  });
  return repairs;
};

// Issue #728 — `journeys.md.template` carries the `documentation/`-tree lifecycle frontmatter
// shape (see `templates/companion-files/journeys.md.template`), unlike any other root companion
// file, because it targets `documentation/reference/journeys.md`, not the repo root
// (`templates/companion-files/README.md`'s "Repo root" claim was the stale doc this issue
// corrects — see Decision Record 1). `doc-health.check.ts`'s V-DOCHEALTH-02 walks
// `documentation/` and requires a `documentation/INDEX.md` row for every doc it finds there —
// issue #832 (ADR-031 Phase 2) retired the hand-appended row in favor of automatic regeneration
// from the doc's own `summary` frontmatter, so this repair now backfills that field directly on
// `journeys.md` (the row itself is reproduced automatically at carry time) instead of appending
// a row fragment to `documentation/INDEX.md`.
export const JOURNEYS_DOC_REL_PATH = path.join('documentation', 'reference', 'journeys.md');

const JOURNEYS_SUMMARY = 'User-journey inventory the ux-coherence hunt kind audits core-job coverage against';

// Unconditional — unlike needsArchitectureRepair/needsAgentsSymlinkRepair, this repair carries
// no diff-path predicate. It only ever fires when `journeys.md` already exists on disk, so it
// is purely additive and self-limiting: there is no drive-by-creation risk to gate against
// (Codebase Conventions, Task Breakdown step 5).
export const needsJourneysSummaryRepair = (repoRoot: string): boolean => {
  const journeysPath = path.join(repoRoot, JOURNEYS_DOC_REL_PATH);
  if (!fs.existsSync(journeysPath)) return false;
  const fields = parseFrontmatterFields(parseMdFrontmatter(fs.readFileSync(journeysPath, 'utf-8')).frontmatter);
  return !fields.summary;
};

export const repairJourneysSummary = (repoRoot: string): CompanionRepair | null => {
  if (!needsJourneysSummaryRepair(repoRoot)) return null;
  const journeysPath = path.join(repoRoot, JOURNEYS_DOC_REL_PATH);
  const { frontmatter, body } = parseMdFrontmatter(fs.readFileSync(journeysPath, 'utf-8'));
  const lines = frontmatter.split('\n');
  const typeIdx = lines.findIndex((l) => l.startsWith('type:'));
  lines.splice(typeIdx === -1 ? 0 : typeIdx + 1, 0, `summary: ${JSON.stringify(JOURNEYS_SUMMARY)}`);
  fs.writeFileSync(journeysPath, `---\n${lines.join('\n')}\n---\n${body}`, 'utf-8');
  return {
    vcode: 'V-ADA-09',
    file: JOURNEYS_DOC_REL_PATH,
    action: 'backfilled summary frontmatter on documentation/reference/journeys.md',
  };
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

  const journeysRepair = repairJourneysSummary(repoRoot);
  if (journeysRepair) repairs.push(journeysRepair);

  return { repairs };
};

export const readDiffFile = (diffFilePath: string): string[] =>
  fs
    .readFileSync(diffFilePath, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

// Issue #878: --cwd-pinned per V-CWDPIN-01 (bun run scripts/<name>.ts resolves relative
// ./lib/... imports against the process cwd, not --repo-root — see cwd-pin-guard.check.ts's
// header comment for the full incident chain). Both `if (import.meta.main)` branches below
// previously kept their own copy of this message, which is exactly the class of drift this
// issue reports (one copy fixed, one left stale) — collapsed to a single definition so a future
// change to the invocation form only needs one edit.
const USAGE =
  'Usage: bun run --cwd <path> scripts/lib/companion-file-sync.ts --repo-root <path> --diff-file <paths.txt>\n' +
  '   or: bun run --cwd <path> scripts/lib/companion-file-sync.ts --repo-root <path> --backfill-journeys-summary';

function parseCliArgs(argv: string[]): { repoRoot: string | null; diffFile: string | null; backfillJourneysSummary: boolean } {
  const flags = parseFlags(argv);
  return {
    repoRoot: typeof flags['repo-root'] === 'string' ? flags['repo-root'] : null,
    diffFile: typeof flags['diff-file'] === 'string' ? flags['diff-file'] : null,
    backfillJourneysSummary: flags['backfill-journeys-summary'] === true,
  };
}

if (import.meta.main) {
  const { repoRoot, diffFile, backfillJourneysSummary } = parseCliArgs(process.argv.slice(2));
  if (!repoRoot) {
    console.error(USAGE);
    process.exit(2);
  }
  if (backfillJourneysSummary) {
    // Bootstrap-time path (src/SKILL.md Phase 0 step 2, issue #728): repo-root only, no
    // --diff-file — this repair is unconditional (see runCompanionFileSync), so it needs no
    // diff-path predicate to decide whether to fire.
    const repair = repairJourneysSummary(path.resolve(repoRoot));
    console.log(JSON.stringify({ repairs: repair ? [repair] : [] }, null, 2));
  } else if (diffFile) {
    const diffPaths = readDiffFile(diffFile);
    const result = runCompanionFileSync(path.resolve(repoRoot), diffPaths);
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(USAGE);
    process.exit(2);
  }
}
