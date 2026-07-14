import * as fs from 'fs';
import * as path from 'path';

// Single source of truth for "what does a valid compiled plugin tree look like" — consumed by
// both scripts/build.ts (build-time, throw-on-invalid) and scripts/verify.ts (post-hoc,
// collect-and-report). Zero imports from either file by design: RULES_LIST and agent file
// lists stay owned by build.ts (per the F1 precedent), passed in as parameters here instead.

/** General plugin-tree shape check: rules/, skills/blackhole/{SKILL.md,references/}, and
 * (when manifestPath is non-null) the manifest's required top-level fields. Pass `null` for
 * manifestPath when the manifest hasn't been written yet at call time (see build.ts's Gemini
 * workspace call, which asserts shape before writeGeminiManifest runs). */
export const validatePluginTreeShape = (
  treeRoot: string,
  manifestPath: string | null,
  labels: { treePrefix: string; manifest: string },
  rulesList: string[]
): string[] => {
  const errors: string[] = [];

  for (const rule of rulesList) {
    if (!fs.existsSync(path.join(treeRoot, 'rules', rule))) {
      errors.push(`missing ${labels.treePrefix}rules/${rule}`);
    }
  }

  const skillPath = path.join(treeRoot, 'skills', 'blackhole', 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    errors.push(`missing ${labels.treePrefix}skills/blackhole/SKILL.md`);
  }

  const refsDir = path.join(treeRoot, 'skills', 'blackhole', 'references');
  if (!fs.existsSync(refsDir) || fs.readdirSync(refsDir).length === 0) {
    errors.push(`missing or empty ${labels.treePrefix}skills/blackhole/references/`);
  }

  if (manifestPath !== null) {
    if (!fs.existsSync(manifestPath)) {
      errors.push(`missing ${labels.manifest}`);
    } else {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        for (const key of ['$schema', 'name', 'version', 'description']) {
          if (!manifest[key]) errors.push(`plugin.json missing ${key}`);
        }
      } catch {
        errors.push('plugin.json invalid JSON');
      }
    }
  }

  return errors;
};

/** Gemini/Antigravity workspace tree — requires exactly `expectedAgentCount` agents (opposite
 * invariant of distributionTreeErrors below). Called with manifestPath: null since build.ts's
 * call site runs before the detached .gemini-plugin/plugin.json is written.
 * `expectedAgentCount` is caller-supplied (never hardcoded here) so the next agent addition
 * doesn't re-trip this check — pass `AGENT_NAMES.length` (or an equivalent already-derived
 * constant) from the call site (issue #199). */
export const geminiWorkspaceTreeErrors = (
  destRoot: string,
  label: string,
  rulesList: string[],
  agentFiles: string[],
  expectedAgentCount: number
): string[] => {
  const errors: string[] = [];
  if (agentFiles.length !== expectedAgentCount) {
    errors.push(`Gemini ${label}: expected ${expectedAgentCount} agents, got ${agentFiles.length}`);
  }
  errors.push(
    ...validatePluginTreeShape(destRoot, null, { treePrefix: `${label}/`, manifest: '' }, rulesList)
  );
  return errors;
};

/** Distribution bundle — deliberately separate from geminiWorkspaceTreeErrors: this tree
 * requires zero agents (AC4), the opposite invariant of the full-roster workspace tree. Do not
 * generalize these two into one parameterized "expected agent count" function. */
export const distributionTreeErrors = (
  destRoot: string,
  manifestPath: string,
  rulesList: string[]
): string[] => {
  const errors = validatePluginTreeShape(
    destRoot,
    manifestPath,
    { treePrefix: '', manifest: 'plugin.json' },
    rulesList
  );
  if (fs.existsSync(path.join(destRoot, 'agents'))) {
    errors.push('distribution bundle must not contain agents/ (AC4)');
  }
  return errors;
};

/** Claude Code marketplace distribution bundle (ADR-009, issue #262) — deliberately separate
 * from distributionTreeErrors above: this tree REQUIRES `expectedAgentCount` agents/, the inverse
 * of AC4 (Claude marketplace plugins ship agents; the Gemini/Antigravity no-agents rule is
 * platform-schema-scoped only). The manifest also lives at a different path than the Gemini
 * bundle's flat `plugin.json` — `.claude-plugin/plugin.json` *inside* the bundle — and carries no
 * `$schema` field, so its field check runs standalone here rather than through
 * validatePluginTreeShape's manifest branch. Do not generalize this with distributionTreeErrors
 * or geminiWorkspaceTreeErrors — the invariants stay deliberately incompatible (see the
 * "do not generalize" note above). */
export const claudeDistributionTreeErrors = (
  destRoot: string,
  agentFiles: string[],
  expectedAgentCount: number,
  rulesList: string[]
): string[] => {
  const errors: string[] = [];
  if (agentFiles.length !== expectedAgentCount) {
    errors.push(`Claude bundle: expected ${expectedAgentCount} agents, got ${agentFiles.length}`);
  }
  errors.push(
    ...validatePluginTreeShape(destRoot, null, { treePrefix: '', manifest: '' }, rulesList)
  );

  const manifestPath = path.join(destRoot, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    errors.push('missing .claude-plugin/plugin.json');
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      for (const key of ['name', 'version', 'description']) {
        if (!manifest[key]) errors.push(`.claude-plugin/plugin.json missing ${key}`);
      }
    } catch {
      errors.push('.claude-plugin/plugin.json invalid JSON');
    }
  }

  return errors;
};

/** Codex YAML instructions-block scalar marker — the single source of truth consumed by
 * build.ts's serializer, this module's codexTreeErrors, and verify.ts's per-file check. */
export const INSTRUCTIONS_MARKER = 'instructions: |';

export const hasInstructionsBlock = (content: string): boolean => content.includes(INSTRUCTIONS_MARKER);

/** Codex CLI tree — exact `expectedAgentCount`-agent-yaml count, each with an instructions block
 * scalar, plus SKILL.md and a non-empty references/ dir. Message prefixes ("SKILL.md",
 * "references", "agent YAML files") are a deliberate, controlled contract with verify.ts's
 * V-code partitioning (Task 4) — pinned by this file's own message-contract tests; keep both
 * sides in sync. `expectedAgentCount` is caller-supplied (never hardcoded here), pass
 * `AGENT_NAMES.length` (or an equivalent already-derived constant) from the call site so the
 * next agent addition doesn't re-trip this check (issue #199). */
export const codexTreeErrors = (rootDir: string, agentFiles: string[], expectedAgentCount: number): string[] => {
  const errors: string[] = [];
  if (agentFiles.length !== expectedAgentCount) {
    errors.push(`Codex: expected ${expectedAgentCount} agent YAML files, got ${agentFiles.length}`);
  }
  for (const file of agentFiles) {
    const content = fs.readFileSync(path.join(rootDir, 'codex-agents', file), 'utf-8');
    if (!hasInstructionsBlock(content)) {
      errors.push(`Codex: ${file} missing instructions block scalar`);
    }
  }
  const skillPath = path.join(rootDir, 'codex-skills', 'blackhole', 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    errors.push('Codex: missing codex-skills/blackhole/SKILL.md');
  }
  const refsDir = path.join(rootDir, 'codex-skills', 'blackhole', 'references');
  if (!fs.existsSync(refsDir) || fs.readdirSync(refsDir).length === 0) {
    errors.push('Codex: missing or empty codex-skills/blackhole/references/');
  }
  return errors;
};
