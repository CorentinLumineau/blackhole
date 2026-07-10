import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  validatePluginTreeShape,
  geminiWorkspaceTreeErrors,
  distributionTreeErrors,
  codexTreeErrors,
  INSTRUCTIONS_MARKER,
  hasInstructionsBlock,
} from './tree-shape.ts';
import { compileGeminiTree, writeGeminiManifest, buildGeminiPluginManifest, RULES_LIST } from './build.ts';

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'tree-shape-test-'));

const populateFixtureTree = (destRoot: string) => {
  compileGeminiTree(
    destRoot,
    'plugins/blackhole',
    'plugins/blackhole/rules/blackhole-vcodes.md',
    { includeAgents: false }
  );
  writeGeminiManifest(path.join(destRoot, 'plugin.json'), buildGeminiPluginManifest('1.0.0'));
};

describe('validatePluginTreeShape', () => {
  test('returns [] on a fully-populated fixture tree', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      const errors = validatePluginTreeShape(
        destRoot,
        path.join(destRoot, 'plugin.json'),
        { treePrefix: '', manifest: 'plugin.json' },
        RULES_LIST
      );
      expect(errors).toEqual([]);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('reports a missing rule file by name', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'rules', 'blackhole-state.md'));
      const errors = validatePluginTreeShape(
        destRoot,
        path.join(destRoot, 'plugin.json'),
        { treePrefix: '', manifest: 'plugin.json' },
        RULES_LIST
      );
      expect(errors.some((e) => e.includes('blackhole-state.md'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('reports a missing SKILL.md', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'skills', 'blackhole', 'SKILL.md'));
      const errors = validatePluginTreeShape(
        destRoot,
        path.join(destRoot, 'plugin.json'),
        { treePrefix: '', manifest: 'plugin.json' },
        RULES_LIST
      );
      expect(errors.some((e) => e.includes('SKILL.md'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('reports an empty references/ directory', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      const refsDir = path.join(destRoot, 'skills', 'blackhole', 'references');
      for (const f of fs.readdirSync(refsDir)) fs.rmSync(path.join(refsDir, f), { recursive: true, force: true });
      const errors = validatePluginTreeShape(
        destRoot,
        path.join(destRoot, 'plugin.json'),
        { treePrefix: '', manifest: 'plugin.json' },
        RULES_LIST
      );
      expect(errors.some((e) => e.includes('references/'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  // Regression #226: references/ may contain a subdirectory (e.g. src/references/hunt/ added
  // by #198), and the cleanup loop must not assume every entry is a plain file.
  test('cleanup handles a subdirectory under references/ without throwing (regression #226)', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      const refsDir = path.join(destRoot, 'skills', 'blackhole', 'references');
      const subDir = path.join(refsDir, 'hunt');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, 'nested.md'), '# nested\n', 'utf-8');
      expect(() => {
        for (const f of fs.readdirSync(refsDir)) fs.rmSync(path.join(refsDir, f), { recursive: true, force: true });
      }).not.toThrow();
      expect(fs.readdirSync(refsDir)).toEqual([]);
      const errors = validatePluginTreeShape(
        destRoot,
        path.join(destRoot, 'plugin.json'),
        { treePrefix: '', manifest: 'plugin.json' },
        RULES_LIST
      );
      expect(errors.some((e) => e.includes('references/'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('skips manifest checks entirely when manifestPath is null', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'plugin.json'));
      const errors = validatePluginTreeShape(
        destRoot,
        null,
        { treePrefix: '', manifest: 'plugin.json' },
        RULES_LIST
      );
      expect(errors.some((e) => e.includes('plugin.json'))).toBe(false);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('reports a missing manifest when manifestPath is provided', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'plugin.json'));
      const errors = validatePluginTreeShape(
        destRoot,
        path.join(destRoot, 'plugin.json'),
        { treePrefix: '', manifest: 'plugin.json' },
        RULES_LIST
      );
      expect(errors.some((e) => e.includes('plugin.json'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('reports an invalid manifest missing required fields', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.writeFileSync(path.join(destRoot, 'plugin.json'), JSON.stringify({ name: 'x' }), 'utf-8');
      const errors = validatePluginTreeShape(
        destRoot,
        path.join(destRoot, 'plugin.json'),
        { treePrefix: '', manifest: 'plugin.json' },
        RULES_LIST
      );
      expect(errors.some((e) => e.includes('missing'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});

describe('geminiWorkspaceTreeErrors', () => {
  const populateWorkspaceTree = (destRoot: string) => {
    compileGeminiTree(destRoot, '.agents/build', '.agents/build/rules/blackhole-vcodes.md');
  };

  test('returns [] on a fully-populated 7-agent workspace tree', () => {
    const destRoot = makeTempDir();
    try {
      populateWorkspaceTree(destRoot);
      const agentFiles = fs.readdirSync(path.join(destRoot, 'agents'));
      expect(geminiWorkspaceTreeErrors(destRoot, 'workspace', RULES_LIST, agentFiles)).toEqual([]);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('reports an agent-count error when fewer than 7 agents are present', () => {
    const destRoot = makeTempDir();
    try {
      populateWorkspaceTree(destRoot);
      const agentFiles = fs.readdirSync(path.join(destRoot, 'agents')).slice(0, 4);
      const errors = geminiWorkspaceTreeErrors(destRoot, 'workspace', RULES_LIST, agentFiles);
      expect(errors.some((e) => e.includes('7 agent'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('reports both an agent-count error and a missing-rule error together', () => {
    const destRoot = makeTempDir();
    try {
      populateWorkspaceTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'rules', 'blackhole-state.md'));
      const agentFiles = fs.readdirSync(path.join(destRoot, 'agents')).slice(0, 4);
      const errors = geminiWorkspaceTreeErrors(destRoot, 'workspace', RULES_LIST, agentFiles);
      expect(errors.some((e) => e.includes('7 agent'))).toBe(true);
      expect(errors.some((e) => e.includes('blackhole-state.md'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('does not require a manifest to exist (build-time call, manifest not yet written)', () => {
    const destRoot = makeTempDir();
    try {
      populateWorkspaceTree(destRoot);
      const agentFiles = fs.readdirSync(path.join(destRoot, 'agents'));
      // No plugin.json written anywhere under destRoot — must still pass.
      expect(geminiWorkspaceTreeErrors(destRoot, 'workspace', RULES_LIST, agentFiles)).toEqual([]);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});

describe('distributionTreeErrors', () => {
  test('returns [] on a correctly-built distribution tree', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      expect(distributionTreeErrors(destRoot, path.join(destRoot, 'plugin.json'), RULES_LIST)).toEqual([]);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('reports AC4 violation when agents/ is present in the distribution bundle', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.mkdirSync(path.join(destRoot, 'agents'));
      const errors = distributionTreeErrors(destRoot, path.join(destRoot, 'plugin.json'), RULES_LIST);
      expect(errors.some((e) => e.includes('AC4'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('reports a missing manifest', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'plugin.json'));
      const errors = distributionTreeErrors(destRoot, path.join(destRoot, 'plugin.json'), RULES_LIST);
      expect(errors.some((e) => e.includes('plugin.json'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('reports incomplete rules/', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'rules', 'blackhole-state.md'));
      const errors = distributionTreeErrors(destRoot, path.join(destRoot, 'plugin.json'), RULES_LIST);
      expect(errors.some((e) => e.includes('blackhole-state.md'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });

  test('reports a missing SKILL.md', () => {
    const destRoot = makeTempDir();
    try {
      populateFixtureTree(destRoot);
      fs.unlinkSync(path.join(destRoot, 'skills', 'blackhole', 'SKILL.md'));
      const errors = distributionTreeErrors(destRoot, path.join(destRoot, 'plugin.json'), RULES_LIST);
      expect(errors.some((e) => e.includes('SKILL.md'))).toBe(true);
    } finally {
      fs.rmSync(destRoot, { recursive: true, force: true });
    }
  });
});

describe('codexTreeErrors', () => {
  const populateCodexTree = (rootDir: string) => {
    fs.mkdirSync(path.join(rootDir, 'codex-agents'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'codex-skills', 'blackhole', 'references'), { recursive: true });
    for (const name of ['coordinator', 'orchestrator', 'planner', 'implementer', 'reviewer', 'router', 'investigator']) {
      fs.writeFileSync(
        path.join(rootDir, 'codex-agents', `${name}.yaml`),
        `name: ${name}\ninstructions: |\n  hello\n`,
        'utf-8'
      );
    }
    fs.writeFileSync(path.join(rootDir, 'codex-skills', 'blackhole', 'SKILL.md'), '# SKILL\n', 'utf-8');
    fs.writeFileSync(
      path.join(rootDir, 'codex-skills', 'blackhole', 'references', 'x.md'),
      '# ref\n',
      'utf-8'
    );
  };

  test('returns [] on a fully-populated 7-agent codex tree', () => {
    const rootDir = makeTempDir();
    try {
      populateCodexTree(rootDir);
      const agentFiles = fs.readdirSync(path.join(rootDir, 'codex-agents'));
      expect(codexTreeErrors(rootDir, agentFiles)).toEqual([]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('reports an agent-count error when fewer than 7 yaml files are present', () => {
    const rootDir = makeTempDir();
    try {
      populateCodexTree(rootDir);
      const agentFiles = fs.readdirSync(path.join(rootDir, 'codex-agents')).slice(0, 4);
      const errors = codexTreeErrors(rootDir, agentFiles);
      expect(errors.some((e) => e.includes('7 agent'))).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('reports a missing instructions block scalar', () => {
    const rootDir = makeTempDir();
    try {
      populateCodexTree(rootDir);
      fs.writeFileSync(path.join(rootDir, 'codex-agents', 'coordinator.yaml'), 'name: coordinator\n', 'utf-8');
      const agentFiles = fs.readdirSync(path.join(rootDir, 'codex-agents'));
      const errors = codexTreeErrors(rootDir, agentFiles);
      expect(errors.some((e) => e.includes('instructions'))).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('reports a missing SKILL.md', () => {
    const rootDir = makeTempDir();
    try {
      populateCodexTree(rootDir);
      fs.unlinkSync(path.join(rootDir, 'codex-skills', 'blackhole', 'SKILL.md'));
      const agentFiles = fs.readdirSync(path.join(rootDir, 'codex-agents'));
      const errors = codexTreeErrors(rootDir, agentFiles);
      expect(errors.some((e) => e.includes('SKILL.md'))).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('reports an empty references directory', () => {
    const rootDir = makeTempDir();
    try {
      populateCodexTree(rootDir);
      fs.unlinkSync(path.join(rootDir, 'codex-skills', 'blackhole', 'references', 'x.md'));
      const agentFiles = fs.readdirSync(path.join(rootDir, 'codex-agents'));
      const errors = codexTreeErrors(rootDir, agentFiles);
      expect(errors.some((e) => e.includes('references'))).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe('INSTRUCTIONS_MARKER / hasInstructionsBlock', () => {
  test('INSTRUCTIONS_MARKER is the Codex YAML instructions scalar marker', () => {
    expect(INSTRUCTIONS_MARKER).toBe('instructions: |');
  });

  test('hasInstructionsBlock detects presence and absence', () => {
    expect(hasInstructionsBlock('name: x\ninstructions: |\n  hi\n')).toBe(true);
    expect(hasInstructionsBlock('name: x\n')).toBe(false);
  });
});

// Coupling contract: scripts/verify.ts partitions codexTreeErrors' output by substring match
// ('SKILL.md', 'references', '7 agent') to route errors to the correct V-code. These tests
// pin the exact substrings that partition depends on — a wording change here that breaks one
// of them must fail a test, not silently empty verify.ts's filter.
describe('codexTreeErrors message contract (verify.ts substring partition)', () => {
  test('agent-count error contains "7 agent"', () => {
    const errors = codexTreeErrors(makeTempDir(), []);
    expect(errors.some((e) => e.includes('7 agent'))).toBe(true);
  });

  test('missing SKILL.md error contains "SKILL.md"', () => {
    const rootDir = makeTempDir();
    try {
      fs.mkdirSync(path.join(rootDir, 'codex-skills', 'blackhole', 'references'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'codex-skills', 'blackhole', 'references', 'x.md'), '# ref\n', 'utf-8');
      const errors = codexTreeErrors(rootDir, []);
      expect(errors.some((e) => e.includes('SKILL.md'))).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test('missing/empty references error contains "references"', () => {
    const rootDir = makeTempDir();
    try {
      fs.mkdirSync(path.join(rootDir, 'codex-skills', 'blackhole'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'codex-skills', 'blackhole', 'SKILL.md'), '# SKILL\n', 'utf-8');
      const errors = codexTreeErrors(rootDir, []);
      expect(errors.some((e) => e.includes('references'))).toBe(true);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
