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
  needsJourneysIndexRepair,
  repairAgentsSymlink,
  repairJourneysIndexRow,
  resolveProjectName,
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

describe('companion-file-sync journeys index repair (issue #728)', () => {
  const journeysRelPath = path.join('documentation', 'reference', 'journeys.md');
  const indexRelPath = path.join('documentation', 'INDEX.md');
  const indexHeader = '| path | summary | type | status | review_trigger |\n|------|---------|------|--------|----------------|\n';

  const writeJourneysDoc = (repo: string): void => {
    fs.mkdirSync(path.join(repo, 'documentation', 'reference'), { recursive: true });
    fs.writeFileSync(path.join(repo, journeysRelPath), '---\ntype: reference\nstatus: template\n---\n\n# User Journeys\n', 'utf-8');
  };

  const writeIndex = (repo: string, extraRows = ''): void => {
    fs.mkdirSync(path.join(repo, 'documentation'), { recursive: true });
    fs.writeFileSync(path.join(repo, indexRelPath), `${indexHeader}${extraRows}`, 'utf-8');
  };

  test('creates the reference/journeys.md row when journeys.md and INDEX.md both exist and the row is absent', () => {
    const repo = makeFixtureRepo();
    try {
      writeJourneysDoc(repo);
      writeIndex(repo);
      expect(needsJourneysIndexRepair(repo)).toBe(true);
      const repair = repairJourneysIndexRow(repo);
      expect(repair).toEqual({
        vcode: 'V-ADA-09',
        file: indexRelPath,
        action: 'appended reference/journeys.md row to documentation/INDEX.md',
      });
      const content = fs.readFileSync(path.join(repo, indexRelPath), 'utf-8');
      expect(content).toContain('reference/journeys.md');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('a second call is idempotent — no duplicate row, returns null', () => {
    const repo = makeFixtureRepo();
    try {
      writeJourneysDoc(repo);
      writeIndex(repo);
      const first = repairJourneysIndexRow(repo);
      expect(first).not.toBeNull();
      expect(needsJourneysIndexRepair(repo)).toBe(false);
      const second = repairJourneysIndexRow(repo);
      expect(second).toBeNull();
      const content = fs.readFileSync(path.join(repo, indexRelPath), 'utf-8');
      const occurrences = content.split('reference/journeys.md').length - 1;
      expect(occurrences).toBe(1);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('no-op when documentation/reference/journeys.md is absent', () => {
    const repo = makeFixtureRepo();
    try {
      writeIndex(repo);
      expect(needsJourneysIndexRepair(repo)).toBe(false);
      expect(repairJourneysIndexRow(repo)).toBeNull();
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('no-op when documentation/INDEX.md is absent', () => {
    const repo = makeFixtureRepo();
    try {
      writeJourneysDoc(repo);
      expect(needsJourneysIndexRepair(repo)).toBe(false);
      expect(repairJourneysIndexRow(repo)).toBeNull();
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('runCompanionFileSync self-heals an existing journeys.md unconditionally, without a diff-path predicate', () => {
    const repo = makeFixtureRepo();
    try {
      writeJourneysDoc(repo);
      writeIndex(repo);
      const { repairs } = runCompanionFileSync(repo, ['documentation/foo.md']);
      expect(repairs.some((r) => r.vcode === 'V-ADA-09')).toBe(true);
      const content = fs.readFileSync(path.join(repo, indexRelPath), 'utf-8');
      expect(content).toContain('reference/journeys.md');
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
