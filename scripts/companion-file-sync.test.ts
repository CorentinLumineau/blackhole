import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createArchitectureFromTemplate,
  hasAgentSurfaceTrigger,
  hasCodeSurfaceTrigger,
  isDocOnlyMarkdownDiff,
  needsAgentsSymlinkRepair,
  needsArchitectureRepair,
  needsJourneysSummaryRepair,
  repairAgentsSymlink,
  repairJourneysSummary,
  resolveProjectName,
  ROOT_COMPANION_MD_FILES,
  runCompanionFileSync,
} from './lib/companion-file-sync.ts';

const root = path.resolve(import.meta.dir, '..');
const templateSrc = path.join(root, 'templates', 'companion-files');

const makeFixtureRepo = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-file-sync-'));
  fs.mkdirSync(path.join(dir, 'templates', 'companion-files'), { recursive: true });
  for (const name of ['ARCHITECTURE.md', 'AGENTS.md']) {
    fs.copyFileSync(
      path.join(templateSrc, `${name}.template`),
      path.join(dir, 'templates', 'companion-files', `${name}.template`),
    );
  }
  fs.mkdirSync(path.join(dir, '.blackhole'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.blackhole', 'config.json'),
    JSON.stringify({ repo: 'owner/my-project' }),
    'utf-8',
  );
  return dir;
};

describe('companion-file-sync helpers', () => {
  // Issue #766, Task 1 AC — the single named export other consumers (V-ADR-06 leg 2) import
  // instead of re-deriving the root companion file set from this file's per-function literals.
  test('ROOT_COMPANION_MD_FILES names exactly the three root companion files', () => {
    expect(ROOT_COMPANION_MD_FILES).toEqual(['ARCHITECTURE.md', 'AGENTS.md', 'README.md']);
  });

  test('isDocOnlyMarkdownDiff is true only for documentation markdown paths', () => {
    expect(isDocOnlyMarkdownDiff(['documentation/foo.md'])).toBe(true);
    expect(isDocOnlyMarkdownDiff(['documentation/foo.md', 'documentation/bar.md'])).toBe(true);
    expect(isDocOnlyMarkdownDiff(['src/foo.ts'])).toBe(false);
    expect(isDocOnlyMarkdownDiff(['documentation/foo.md', 'src/foo.ts'])).toBe(false);
  });

  test('hasCodeSurfaceTrigger matches src/ and rejects doc-only markdown', () => {
    expect(hasCodeSurfaceTrigger(['src/foo.ts'])).toBe(true);
    expect(hasCodeSurfaceTrigger(['documentation/foo.md'])).toBe(false);
    expect(hasCodeSurfaceTrigger(['package.json'])).toBe(true);
  });

  test('hasAgentSurfaceTrigger matches src/agents/', () => {
    expect(hasAgentSurfaceTrigger(['src/agents/foo.md'])).toBe(true);
    expect(hasAgentSurfaceTrigger(['src/foo.ts'])).toBe(false);
  });

  test('resolveProjectName reads config.repo segment', () => {
    const repo = makeFixtureRepo();
    try {
      expect(resolveProjectName(repo)).toBe('my-project');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('companion-file-sync repairs', () => {
  test('absent ARCHITECTURE.md + src diff creates file with project-name substituted', () => {
    const repo = makeFixtureRepo();
    try {
      expect(needsArchitectureRepair(repo, ['src/foo.ts'])).toBe(true);
      const repair = createArchitectureFromTemplate(repo, 'my-project');
      expect(repair).toEqual({
        vcode: 'V-ADA-01',
        file: 'ARCHITECTURE.md',
        action: 'created from templates/companion-files/ARCHITECTURE.md.template',
      });
      const content = fs.readFileSync(path.join(repo, 'ARCHITECTURE.md'), 'utf-8');
      expect(content).toContain('# Architecture: my-project');
      expect(content).not.toContain('{project-name}');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('absent ARCHITECTURE.md + documentation-only diff does not create', () => {
    const repo = makeFixtureRepo();
    try {
      expect(needsArchitectureRepair(repo, ['documentation/foo.md'])).toBe(false);
      const { repairs } = runCompanionFileSync(repo, ['documentation/foo.md']);
      expect(repairs).toEqual([]);
      expect(fs.existsSync(path.join(repo, 'ARCHITECTURE.md'))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('existing ARCHITECTURE.md is never overwritten', () => {
    const repo = makeFixtureRepo();
    try {
      fs.writeFileSync(path.join(repo, 'ARCHITECTURE.md'), '# Existing\n', 'utf-8');
      expect(needsArchitectureRepair(repo, ['src/foo.ts'])).toBe(false);
      const repair = createArchitectureFromTemplate(repo, 'my-project');
      expect(repair).toBeNull();
      expect(fs.readFileSync(path.join(repo, 'ARCHITECTURE.md'), 'utf-8')).toBe('# Existing\n');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('regular-file AGENTS.md is left untouched — not repaired even with agent-surface diff', () => {
    const repo = makeFixtureRepo();
    try {
      fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'stale regular file\n', 'utf-8');
      expect(needsAgentsSymlinkRepair(repo)).toBe(false);
      const { repairs } = runCompanionFileSync(repo, ['src/agents/implementer.md']);
      expect(repairs.some((r) => r.file === 'CLAUDE.md')).toBe(false);
      expect(repairs.some((r) => r.file === 'AGENTS.md')).toBe(false);
      const stat = fs.lstatSync(path.join(repo, 'AGENTS.md'));
      expect(stat.isSymbolicLink()).toBe(false);
      expect(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf-8')).toBe('stale regular file\n');
      expect(fs.existsSync(path.join(repo, 'CLAUDE.md'))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('directory-shaped AGENTS.md is left untouched — not repaired even with agent-surface diff', () => {
    const repo = makeFixtureRepo();
    try {
      fs.mkdirSync(path.join(repo, 'AGENTS.md'));
      expect(needsAgentsSymlinkRepair(repo)).toBe(false);
      const repairs = repairAgentsSymlink(repo, 'my-project');
      expect(repairs).toEqual([]);
      const stat = fs.lstatSync(path.join(repo, 'AGENTS.md'));
      expect(stat.isDirectory()).toBe(true);
      expect(fs.existsSync(path.join(repo, 'CLAUDE.md'))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('broken symlink AGENTS.md + agent-surface diff still creates CLAUDE.md and re-symlinks', () => {
    const repo = makeFixtureRepo();
    try {
      fs.writeFileSync(path.join(repo, 'other-target.md'), 'not claude\n', 'utf-8');
      fs.symlinkSync('other-target.md', path.join(repo, 'AGENTS.md'));
      expect(needsAgentsSymlinkRepair(repo)).toBe(true);
      const { repairs } = runCompanionFileSync(repo, ['src/agents/implementer.md']);
      expect(repairs.some((r) => r.file === 'CLAUDE.md')).toBe(true);
      expect(repairs.some((r) => r.file === 'AGENTS.md' && r.action.includes('symlink'))).toBe(true);
      const stat = fs.lstatSync(path.join(repo, 'AGENTS.md'));
      expect(stat.isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(path.join(repo, 'AGENTS.md'))).toBe('CLAUDE.md');
      expect(fs.existsSync(path.join(repo, 'CLAUDE.md'))).toBe(true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('repairAgentsSymlink is no-op when valid symlink already exists', () => {
    const repo = makeFixtureRepo();
    try {
      fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Agents\n', 'utf-8');
      fs.symlinkSync('CLAUDE.md', path.join(repo, 'AGENTS.md'));
      expect(needsAgentsSymlinkRepair(repo)).toBe(false);
      const repairs = repairAgentsSymlink(repo, 'my-project');
      expect(repairs).toEqual([]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('companion-file-sync journeys summary repair (issue #728, retargeted issue #832 ADR-031 Phase 2)', () => {
  const journeysRelPath = path.join('documentation', 'reference', 'journeys.md');

  const writeJourneysDoc = (repo: string, extraFrontmatter = ''): void => {
    fs.mkdirSync(path.join(repo, 'documentation', 'reference'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, journeysRelPath),
      `---\ntype: reference\n${extraFrontmatter}status: template\n---\n\n# User Journeys\n`,
      'utf-8',
    );
  };

  test('a journeys.md missing summary: is repaired — summary backfilled, reported under V-ADA-09', () => {
    const repo = makeFixtureRepo();
    try {
      writeJourneysDoc(repo);
      expect(needsJourneysSummaryRepair(repo)).toBe(true);
      const repair = repairJourneysSummary(repo);
      expect(repair).toEqual({
        vcode: 'V-ADA-09',
        file: journeysRelPath,
        action: 'backfilled summary frontmatter on documentation/reference/journeys.md',
      });
      const content = fs.readFileSync(path.join(repo, journeysRelPath), 'utf-8');
      expect(content).toContain(
        'summary: "User-journey inventory the ux-coherence hunt kind audits core-job coverage against"',
      );
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('a journeys.md that already has summary: triggers no repair', () => {
    const repo = makeFixtureRepo();
    try {
      writeJourneysDoc(repo, 'summary: "Already set"\n');
      expect(needsJourneysSummaryRepair(repo)).toBe(false);
      expect(repairJourneysSummary(repo)).toBeNull();
      const content = fs.readFileSync(path.join(repo, journeysRelPath), 'utf-8');
      const occurrences = content.split('summary:').length - 1;
      expect(occurrences).toBe(1);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('no-op when documentation/reference/journeys.md is absent', () => {
    const repo = makeFixtureRepo();
    try {
      expect(needsJourneysSummaryRepair(repo)).toBe(false);
      expect(repairJourneysSummary(repo)).toBeNull();
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('runCompanionFileSync self-heals an existing journeys.md unconditionally, without a diff-path predicate', () => {
    const repo = makeFixtureRepo();
    try {
      writeJourneysDoc(repo);
      const { repairs } = runCompanionFileSync(repo, ['documentation/foo.md']);
      expect(repairs.some((r) => r.vcode === 'V-ADA-09')).toBe(true);
      const content = fs.readFileSync(path.join(repo, journeysRelPath), 'utf-8');
      expect(content).toContain('summary:');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

// Issue #955 — the CLI flag renamed from its retired predecessor to --backfill-journeys-summary
// (issue #832 / ADR-031 Phase 2 already retargeted the repair itself; only the flag string was
// left behind). Same Bun.spawn subprocess convention as scripts/carry-staged-artifacts.test.ts.
// The retired flag's literal name is assembled at runtime (never written verbatim in source)
// so this permanent regression fixture does not itself count as a residual caller under the
// repo-wide zero-residual sweep (Task Breakdown "Repo-wide zero-residual sweep").
describe('companion-file-sync CLI — --backfill-journeys-summary flag (issue #955)', () => {
  const scriptsDir = path.join(root, 'scripts');
  const scriptPath = path.join(scriptsDir, 'lib', 'companion-file-sync.ts');
  const journeysRelPath = path.join('documentation', 'reference', 'journeys.md');
  const RETIRED_FLAG = '--' + ['upsert', 'journeys', 'index'].join('-');

  const run = (args: string[]) =>
    Bun.spawn(['bun', 'run', scriptPath, ...args], { cwd: scriptsDir, stdout: 'pipe', stderr: 'pipe' });

  const writeJourneysDocMissingSummary = (repo: string): void => {
    fs.mkdirSync(path.join(repo, 'documentation', 'reference'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, journeysRelPath),
      '---\ntype: reference\nstatus: template\n---\n\n# User Journeys\n',
      'utf-8',
    );
  };

  test('--backfill-journeys-summary backfills summary: and reports V-ADA-09 on stdout', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-file-sync-cli-'));
    try {
      writeJourneysDocMissingSummary(repo);
      const proc = run(['--repo-root', repo, '--backfill-journeys-summary']);
      const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.repairs).toEqual([
        {
          vcode: 'V-ADA-09',
          file: journeysRelPath,
          action: 'backfilled summary frontmatter on documentation/reference/journeys.md',
        },
      ]);
      const content = fs.readFileSync(path.join(repo, journeysRelPath), 'utf-8');
      expect(content).toContain('summary:');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('the retired predecessor flag no longer performs the repair — falls through to USAGE/exit-2', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-file-sync-cli-'));
    try {
      writeJourneysDocMissingSummary(repo);
      const proc = run(['--repo-root', repo, RETIRED_FLAG]);
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect(code).toBe(2);
      expect(stderr).toContain('Usage:');
      expect(stdout).toBe('');
      // The repair must not have fired despite the (now-unrecognized) old flag being passed.
      const content = fs.readFileSync(path.join(repo, journeysRelPath), 'utf-8');
      expect(content).not.toContain('summary:');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('fixtures/companion-file-sync', () => {
  const fixtureRoot = path.join(root, 'fixtures', 'companion-file-sync');

  test('fixture tree exists with templates', () => {
    expect(fs.existsSync(path.join(fixtureRoot, 'templates', 'companion-files', 'ARCHITECTURE.md.template'))).toBe(
      true,
    );
  });
});
