import * as fs from 'fs';
import * as path from 'path';
import { INSTRUCTIONS_MARKER } from '../../tree-shape.ts';
import { walkFilesAbs } from '../fs.ts';
import { PLATFORM_TARGETS, type Target } from './facts.ts';
import { root, srcDir } from './paths.ts';

// Strip Cursor-only MDC frontmatter (--- globs: / alwaysApply: ---) for non-Cursor targets.
// The frontmatter block is kept as-is for Cursor; for Claude and skills.sh it is removed entirely
// since those platforms do not understand Cursor rule metadata.
const stripCursorFrontmatter = (content: string): string => {
  return content.replace(/^---\n(?:.*\n)*?---\n\n?/, '');
};

// Parse YAML frontmatter from markdown — body is everything after the first closing --- only.
export const parseMdFrontmatter = (content: string): { frontmatter: string; body: string } => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: '', body: content };
  return { frontmatter: match[1], body: match[2] };
};

export const parseFrontmatterFields = (fmContent: string): Record<string, string> => {
  const fm: Record<string, string> = {};
  for (const line of fmContent.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    const val = line.substring(colonIdx + 1).trim();
    if (key) fm[key] = val;
  }
  return fm;
};

export const parseDisallowedTools = (fm: Record<string, string>): string[] => {
  if (!fm.disallowedTools) return [];
  const m = fm.disallowedTools.match(/\[(.*)\]/);
  if (!m || !m[1].trim()) return [];
  return m[1].split(',').map((t) => t.trim()).filter(Boolean);
};

export const serializeCodexAgentYaml = (fm: Record<string, string>, bodyContent: string): string => {
  const tools = parseDisallowedTools(fm);
  let yaml = '';
  yaml += `name: ${fm.name || ''}\n`;
  yaml += `description: ${fm.description || ''}\n`;
  if (fm.model) yaml += `model: ${fm.model}\n`;
  yaml += `permissionMode: ${fm.permissionMode || ''}\n`;
  if (tools.length > 0) {
    yaml += `disallowedTools:\n`;
    for (const tool of tools) yaml += `  - ${tool}\n`;
  } else {
    yaml += `disallowedTools: []\n`;
  }
  const indentedBody = bodyContent
    .split('\n')
    .map((line) => (line ? `  ${line}` : ''))
    .join('\n');
  yaml += `${INSTRUCTIONS_MARKER}\n${indentedBody}\n`;
  return yaml;
};

export const buildCodexAgentYaml = (
  sourceContent: string,
  agentDir: string,
  rulesPath: string
): string => {
  const { frontmatter, body } = parseMdFrontmatter(sourceContent);
  const fm = parseFrontmatterFields(frontmatter);
  let bodyContent = applyPlatformConditionals(body, 'codex');
  bodyContent = compileContent(bodyContent, agentDir, rulesPath, 'codex');
  return serializeCodexAgentYaml(fm, bodyContent.trim());
};

// Enrich Cursor MDC frontmatter with glob patterns so the rule auto-applies on matching files.
const enrichVcodesMdcGlobs = (content: string): string => {
  return content.replace(
    'globs:\nalwaysApply: false',
    'globs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.go", "**/*.py", "**/*.rs", "**/*.java", "**/*.c", "**/*.cpp", "**/*.cs"]\nalwaysApply: false'
  );
};

// Strip platform-conditional blocks: {{#cursor}}...{{/cursor}} etc.
// Keeps only the block matching the current compile target.
export const applyPlatformConditionals = (content: string, target: Target): string => {
  const active = target === 'skills' ? 'skills' : target;
  let res = content;
  for (const platform of PLATFORM_TARGETS) {
    if (platform !== active) {
      res = res.replace(new RegExp(`\\{\\{#${platform}\\}\\}[\\s\\S]*?\\{\\{/${platform}\\}\\}\\n?`, 'g'), '');
    }
  }
  res = res.replace(new RegExp(`\\{\\{#${active}\\}\\}`, 'g'), '');
  res = res.replace(new RegExp(`\\{\\{/${active}\\}\\}\\n?`, 'g'), '');
  return res;
};

export const compileContent = (
  content: string,
  agentDir: string,
  rulesPath: string,
  target: Target,
  isAgent = false
): string => {
  let res = content;
  if (target === 'codex') {
    res = res.replaceAll('{{AGENT_DIR}}/skills/blackhole/', 'codex-skills/blackhole/');
  }
  if (agentDir === '') {
    if (target === 'skills' && isAgent) {
      // skills.sh root agents: cite the skills/blackhole/ tree (not flat references/)
      res = res.replaceAll('{{AGENT_DIR}}/skills/blackhole/', 'skills/blackhole/');
      res = res.replaceAll('{{AGENT_DIR}}', '');
    } else {
      // skills.sh root layout: flat references/ at repo root
      res = res.replaceAll('{{AGENT_DIR}}/skills/blackhole/', '');
      res = res.replaceAll('{{AGENT_DIR}}', '');
    }
  } else {
    res = res.replaceAll('{{AGENT_DIR}}', agentDir);
  }
  res = res.replaceAll('{{VCODES_PATH}}', rulesPath);
  if (target === 'skills' && agentDir !== '') {
    res = res.replaceAll('skills/blackhole/skills/blackhole/', 'skills/blackhole/');
  }
  return res;
};

// Footer-appended "generated, do not hand-edit" marker — never a header, since a header would
// break parseMdFrontmatter()'s requirement that frontmatter start at byte 0 of the file.
export const generatedMarkerLine = (relSrcPath: string, style: 'html' | 'yaml'): string => {
  const text = `GENERATED by scripts/build.ts from ${relSrcPath} — do not hand-edit`;
  return style === 'yaml' ? `# ${text}` : `<!-- ${text} -->`;
};

export const processFile = (
  srcPath: string,
  destPath: string,
  agentDir: string,
  rulesPath: string,
  target: Target,
  isVcodesMdc = false,
  isAgent = false,
  isSkill = false
) => {
  const originalContent = fs.readFileSync(srcPath, 'utf-8');
  const relSrcPath = path.relative(root, srcPath).split(path.sep).join('/');

  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Codex agents: parse frontmatter from original source; compile body only
  if (isAgent && target === 'codex') {
    const yaml = buildCodexAgentYaml(originalContent, agentDir, rulesPath);
    const markedYaml = `${yaml}\n${generatedMarkerLine(relSrcPath, 'yaml')}\n`;
    fs.writeFileSync(destPath, markedYaml, 'utf-8');
    return;
  }

  let content = originalContent;

  if (target === 'cursor') {
    // Cursor: enrich vcodes .mdc with glob patterns
    if (isVcodesMdc) {
      content = enrichVcodesMdcGlobs(content);
    }
  } else if (isAgent && (target === 'claude' || target === 'gemini' || target === 'codex')) {
    // Claude/Gemini/Codex agents: preserve frontmatter (name, description, disallowedTools; model omitted by design)
    // — do not strip; Codex serializes frontmatter into YAML separately
  } else if (target === 'codex' && isSkill) {
    // Codex skill: preserve skill frontmatter (disable-model-invocation, name, description)
  } else {
    // Claude rules / skills.sh / Gemini rules: strip Cursor-only MDC frontmatter entirely
    content = stripCursorFrontmatter(content);
  }

  content = applyPlatformConditionals(content, target);
  const compiled = compileContent(content, agentDir, rulesPath, target, isAgent);
  const separator = compiled.endsWith('\n') ? '' : '\n';
  const marked = `${compiled}${separator}${generatedMarkerLine(relSrcPath, 'html')}\n`;

  fs.writeFileSync(destPath, marked, 'utf-8');
};

// ADR-007 R6: recurses via the one shared tree-walker (scripts/lib/fs.ts) instead of a local
// readdirSync/stat recursion — after this migration, zero recursive directory walkers remain
// outside scripts/lib/fs.ts (V-INT-02).
export const compileFolder = (srcSub: string, destParent: string, agentDir: string, rulesPath: string, target: Target, isAgent = false) => {
  const fullSrc = path.join(srcDir, srcSub);
  if (!fs.existsSync(fullSrc)) return;

  for (const srcPath of walkFilesAbs(fullSrc)) {
    const relFile = path.relative(fullSrc, srcPath);
    // Codex agents are output as .yaml instead of .md
    const destFile = (isAgent && target === 'codex' && relFile.endsWith('.md'))
      ? relFile.replace(/\.md$/, '.yaml')
      : relFile;
    const destPath = path.join(destParent, destFile);
    processFile(srcPath, destPath, agentDir, rulesPath, target, false, isAgent);
  }
};
