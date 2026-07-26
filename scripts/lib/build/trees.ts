import * as fs from 'fs';
import * as path from 'path';
import { RULES_LIST } from './facts.ts';
import { root, srcDir, templatesDir } from './paths.ts';
import { compileFolder, processFile } from './content.ts';
import type { Target } from './facts.ts';

/** Copies templates/companion-files/ (repo root, not src/) into destRoot's own
 * templates/companion-files/ subtree. Isolated distribution bundles need their own copy since
 * they don't ship at the repo root: the Gemini/Antigravity bundle (plugins/blackhole/) and, since
 * ADR-009 (issue #262), the Claude Code marketplace bundle (plugins/blackhole-claude/) — both
 * call this via compileGeminiTree. Cursor and Codex still install via full-repo-source/committed
 * mechanisms and already have templates/ at its natural repo-relative path with zero
 * build-pipeline change. */
export const copyTemplatesDir = (destRoot: string) => {
  const src = path.join(templatesDir, 'companion-files');
  if (!fs.existsSync(src)) return;
  const dest = path.join(destRoot, 'templates', 'companion-files');
  fs.cpSync(src, dest, { recursive: true });
};

/**
 * Compiles a full plugin tree — agents? + rules + SKILL.md + references + templates — for a
 * given platform `target` (default 'gemini', preserving every existing call site's behavior
 * unchanged). Reused as-is for the Claude Code marketplace distribution bundle (ADR-009, issue
 * #262) via `target: 'claude'`, since `applyPlatformConditionals` resolves `{{#claude}}`/
 * `{{#gemini}}` blocks differently per target — passing the wrong `target` for a destination
 * would silently compile the wrong platform's conditional content into it. Parameterizing the
 * existing walker (rather than hand-rolling a second one) keeps V-INT-02: the recursion itself
 * still runs through `walkFilesAbs` (scripts/lib/fs.ts) via `compileFolder`.
 */
export const compileGeminiTree = (
  destRoot: string,
  agentDir: string,
  rulesPath: string,
  options: { includeAgents?: boolean; target?: Target } = {}
) => {
  const target = options.target ?? 'gemini';
  if (options.includeAgents !== false) {
    compileFolder('agents', path.join(destRoot, 'agents'), agentDir, rulesPath, target, true);
  }
  for (const rule of RULES_LIST) {
    processFile(
      path.join(srcDir, 'references', rule),
      path.join(destRoot, 'rules', rule),
      agentDir,
      rulesPath,
      target
    );
  }
  processFile(
    path.join(srcDir, 'SKILL.md'),
    path.join(destRoot, 'skills', 'blackhole', 'SKILL.md'),
    agentDir,
    rulesPath,
    target
  );
  compileFolder(
    'references',
    path.join(destRoot, 'skills', 'blackhole', 'references'),
    agentDir,
    rulesPath,
    target
  );
  copyTemplatesDir(destRoot);
};

export const writeGeminiManifest = (destPath: string, manifest: Record<string, unknown>) => {
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.writeFileSync(destPath, JSON.stringify(manifest, null, 2), 'utf-8');
};

export const compileCodexTree = (rootDir: string, agentDir: string, rulesPath: string) => {
  compileFolder('agents', path.join(rootDir, 'codex-agents'), agentDir, rulesPath, 'codex', true);
  processFile(
    path.join(srcDir, 'SKILL.md'),
    path.join(rootDir, 'codex-skills', 'blackhole', 'SKILL.md'),
    agentDir,
    rulesPath,
    'codex',
    false,
    false,
    true
  );
  compileFolder(
    'references',
    path.join(rootDir, 'codex-skills', 'blackhole', 'references'),
    agentDir,
    rulesPath,
    'codex'
  );
};
