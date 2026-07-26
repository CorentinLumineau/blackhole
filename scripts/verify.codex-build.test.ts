import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AGENT_YAML_FILES } from './lib/build/facts.ts';
import {
  buildCodexMarketplace,
  buildCodexPluginManifest,
} from './lib/build/manifests.ts';
import { compileCodexTree } from './lib/build/trees.ts';
import {
  codexBuildResultsAfterExec,
  evaluateCodexAgentFiles,
  evaluateCodexBuildExec,
  evaluateCodexManifest,
  evaluateCodexSkillFile,
  isAgentCountError,
  runChecks,
} from './checks/codex-build.check.ts';
import { codexTreeErrors } from './tree-shape.ts';
import { makeTempDir as sharedMakeTempDir } from './lib/fs.ts';

const makeTempDir = (): string => sharedMakeTempDir('blackhole-verify-test');

const populateCodexFixtureTree = (destRoot: string) => {
  compileCodexTree(
    destRoot,
    'codex-skills',
    'codex-skills/blackhole/references/blackhole-vcodes.md',
  );
  const pluginDir = path.join(destRoot, '.codex-plugin');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify(buildCodexPluginManifest('1.0.0'), null, 2),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(destRoot, 'codex-marketplace.json'),
    JSON.stringify(buildCodexMarketplace(), null, 2),
    'utf-8',
  );
};

const codexAgentFiles = (destRoot: string): string[] => {
  const agentsDir = path.join(destRoot, 'codex-agents');
  return fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir).filter((f) => AGENT_YAML_FILES.has(f))
    : [];
};

describe('isAgentCountError (V-CODEX-04 filter — #234)', () => {
  test('matches the real agent-count mismatch message codexTreeErrors emits', () => {
    const bogusRoot = path.join(os.tmpdir(), 'blackhole-verify-vcodex04-nonexistent-root');
    const errors = codexTreeErrors(bogusRoot, [], AGENT_YAML_FILES.size);

    const countError = errors.find((e) => e.includes('agent YAML files'));
    expect(countError).toBeDefined();
    expect(countError).toBe(`Codex: expected ${AGENT_YAML_FILES.size} agent YAML files, got 0`);
    expect(isAgentCountError(countError!)).toBe(true);
  });

  test('does not match unrelated codexTreeErrors messages (SKILL.md / references / per-file)', () => {
    expect(isAgentCountError('Codex: missing codex-skills/blackhole/SKILL.md')).toBe(false);
    expect(isAgentCountError('Codex: missing or empty codex-skills/blackhole/references/')).toBe(false);
    expect(isAgentCountError('Codex: some-agent.yaml missing instructions block scalar')).toBe(false);
  });
});

describe('evaluateCodexBuildExec', () => {
  test('skip=true short-circuits to ok', () => {
    expect(
      evaluateCodexBuildExec({ skip: true, buildOk: false, buildOutput: 'boom' }),
    ).toEqual({ id: 'V-CODEX-01', ok: true });
  });

  test('build failure fails with output in detail', () => {
    const result = evaluateCodexBuildExec({
      skip: false,
      buildOk: false,
      buildOutput: 'compile error on coordinator.yaml',
    });
    expect(result).toEqual({
      id: 'V-CODEX-01',
      ok: false,
      detail: 'build failed: compile error on coordinator.yaml',
    });
  });

  test('successful build passes', () => {
    expect(
      evaluateCodexBuildExec({ skip: false, buildOk: true, buildOutput: '' }),
    ).toEqual({ id: 'V-CODEX-01', ok: true });
  });
});

describe('evaluateCodexManifest', () => {
  test('passes on a valid manifest and marketplace', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      expect(evaluateCodexManifest(destRoot)).toEqual([]);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails when plugin.json is missing', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, '.codex-plugin', 'plugin.json'));
      const errors = evaluateCodexManifest(destRoot);
      expect(errors.some((e) => e.includes('missing .codex-plugin/plugin.json'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails when plugin.json is invalid JSON', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      fs.writeFileSync(path.join(destRoot, '.codex-plugin', 'plugin.json'), '{not json', 'utf-8');
      const errors = evaluateCodexManifest(destRoot);
      expect(errors.some((e) => e.includes('plugin.json invalid JSON'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails when plugin.json is missing a required key', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      const manifestPath = path.join(destRoot, '.codex-plugin', 'plugin.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      delete manifest.version;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
      const errors = evaluateCodexManifest(destRoot);
      expect(errors.some((e) => e.includes('plugin.json missing version'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails when interface is missing displayName', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      const manifestPath = path.join(destRoot, '.codex-plugin', 'plugin.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      delete manifest.interface.displayName;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
      const errors = evaluateCodexManifest(destRoot);
      expect(errors.some((e) => e.includes('interface missing displayName'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails when marketplace uses Claude owner shape', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      const marketplacePath = path.join(destRoot, 'codex-marketplace.json');
      const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf-8'));
      marketplace.owner = { name: 'CorentinLumineau' };
      fs.writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2), 'utf-8');
      const errors = evaluateCodexManifest(destRoot);
      expect(errors.some((e) => e.includes('must not use Claude owner shape'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails when marketplace source is not git', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      const marketplacePath = path.join(destRoot, 'codex-marketplace.json');
      const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf-8'));
      marketplace.plugins[0].source = { source: 'npm', package: 'blackhole' };
      fs.writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2), 'utf-8');
      const errors = evaluateCodexManifest(destRoot);
      expect(errors.some((e) => e.includes('must use git source format'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});

describe('evaluateCodexSkillFile', () => {
  test('passes on a valid compiled codex tree', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      const agentFiles = codexAgentFiles(destRoot);
      expect(evaluateCodexSkillFile(destRoot, agentFiles, AGENT_YAML_FILES.size)).toEqual([]);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails when SKILL.md is missing disable-model-invocation: true', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      const skillPath = path.join(destRoot, 'codex-skills', 'blackhole', 'SKILL.md');
      const skill = fs.readFileSync(skillPath, 'utf-8').replace('disable-model-invocation: true', '');
      fs.writeFileSync(skillPath, skill, 'utf-8');
      const agentFiles = codexAgentFiles(destRoot);
      const errors = evaluateCodexSkillFile(destRoot, agentFiles, AGENT_YAML_FILES.size);
      expect(errors.some((e) => e.includes('disable-model-invocation: true'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('surfaces missing SKILL.md from codexTreeErrors filter', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'codex-skills', 'blackhole', 'SKILL.md'));
      const agentFiles = codexAgentFiles(destRoot);
      const errors = evaluateCodexSkillFile(destRoot, agentFiles, AGENT_YAML_FILES.size);
      expect(errors.some((e) => e.includes('missing codex-skills/blackhole/SKILL.md'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});

describe('evaluateCodexAgentFiles', () => {
  test('passes on valid compiled agents', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      const agentFiles = codexAgentFiles(destRoot);
      expect(
        evaluateCodexAgentFiles(destRoot, agentFiles, AGENT_YAML_FILES.size),
      ).toEqual([]);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails when an agent is missing an instructions block', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      const agentFiles = codexAgentFiles(destRoot);
      const target = agentFiles[0];
      const agentPath = path.join(destRoot, 'codex-agents', target);
      const content = fs.readFileSync(agentPath, 'utf-8').replace(/^instructions:\s*\|[\s\S]*/m, '');
      fs.writeFileSync(agentPath, content, 'utf-8');
      const errors = evaluateCodexAgentFiles(destRoot, agentFiles, AGENT_YAML_FILES.size);
      expect(errors.some((e) => e.includes(`${target}: missing instructions block`))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails when an agent has a forbidden model key', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      const agentFiles = codexAgentFiles(destRoot);
      const target = agentFiles[0];
      const agentPath = path.join(destRoot, 'codex-agents', target);
      const content = fs.readFileSync(agentPath, 'utf-8').replace(/^name:/m, 'model: gpt-4\nname:');
      fs.writeFileSync(agentPath, content, 'utf-8');
      const errors = evaluateCodexAgentFiles(destRoot, agentFiles, AGENT_YAML_FILES.size);
      expect(errors.some((e) => e.includes(`${target}: model must be absent`))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails when agent instructions are too short', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      const agentFiles = codexAgentFiles(destRoot);
      const target = agentFiles[0];
      const agentPath = path.join(destRoot, 'codex-agents', target);
      const content = fs.readFileSync(agentPath, 'utf-8').replace(
        /^instructions:\s*\|[\s\S]*/m,
        'instructions: |\n  Short instructions only.',
      );
      fs.writeFileSync(agentPath, content, 'utf-8');
      const errors = evaluateCodexAgentFiles(destRoot, agentFiles, AGENT_YAML_FILES.size);
      expect(errors.some((e) => e.includes(`${target}: instructions too short`))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('fails when codex-skills markdown contains a leaked {{#gemini}} marker', () => {
    const destRoot = makeTempDir();
    try {
      populateCodexFixtureTree(destRoot);
      const agentFiles = codexAgentFiles(destRoot);
      const leakPath = path.join(destRoot, 'codex-skills', 'blackhole', 'references', 'leak.md');
      fs.writeFileSync(leakPath, 'leaked {{#gemini}}marker{{/gemini}} here', 'utf-8');
      const errors = evaluateCodexAgentFiles(destRoot, agentFiles, AGENT_YAML_FILES.size);
      expect(errors.some((e) => e.includes('contains raw platform conditional (gemini)'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});

describe('codexBuildResultsAfterExec', () => {
  test('short-circuits downstream checks when build exec fails', () => {
    const execResult = {
      id: 'V-CODEX-01',
      ok: false,
      detail: 'build failed: boom',
    };
    const downstream = [
      { id: 'V-CODEX-02', ok: true },
      { id: 'V-CODEX-03', ok: true },
      { id: 'V-CODEX-04', ok: true },
    ];
    const results = codexBuildResultsAfterExec(execResult, downstream);
    expect(results.length).toBe(4);
    expect(results[0]).toEqual(execResult);
    expect(results.slice(1).every((r) => r.detail === 'skipped — build failed')).toBe(true);
  });

  test('returns exec plus downstream when build exec passes', () => {
    const execResult = { id: 'V-CODEX-01', ok: true };
    const downstream = [
      { id: 'V-CODEX-02', ok: true },
      { id: 'V-CODEX-03', ok: true },
      { id: 'V-CODEX-04', ok: true },
    ];
    expect(codexBuildResultsAfterExec(execResult, downstream)).toEqual([
      execResult,
      ...downstream,
    ]);
  });
});

describe('runChecks (real repo)', () => {
  test('returns four passing V-CODEX checks when VERIFY_SKIP_BUILD=1', () => {
    const previous = process.env.VERIFY_SKIP_BUILD;
    process.env.VERIFY_SKIP_BUILD = '1';
    try {
      const results = runChecks();
      expect(results.map((r) => r.id)).toEqual([
        'V-CODEX-01',
        'V-CODEX-02',
        'V-CODEX-03',
        'V-CODEX-04',
      ]);
      expect(results.every((r) => r.ok)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.VERIFY_SKIP_BUILD;
      else process.env.VERIFY_SKIP_BUILD = previous;
    }
  });
});
