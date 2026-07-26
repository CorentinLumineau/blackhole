import * as fs from 'fs';
import * as path from 'path';
import { root, type CheckResult } from './check-utils.ts';
import {
  AGENTS_BUILD_AGENT_DIR,
  CLAUDE_DISTRIBUTION_AGENT_DIR,
} from '../lib/build/paths.ts';
import { AGENT_MD_FILES } from '../lib/build/facts.ts';

// V-AGENTDIR-01: compiled agent markdown must cite skills/blackhole/ paths that resolve under
// each platform target's agent-dir prefix. Codex YAML agents are out of scope — citations use a
// different syntax (codex-skills/blackhole/) and are validated by V-CODEX-* checks instead.

/** Per-target agent trees and the citation prefix each must use (derived from build.ts facts). */
export const AGENT_DIR_CITATION_TARGETS = [
  {
    label: 'skills (flat root)',
    agentsDir: 'agents',
    expectedPrefix: 'skills/blackhole/',
    forbiddenPrefixes: ['.cursor/skills/blackhole/'],
  },
  {
    label: 'cursor',
    agentsDir: '.cursor/agents',
    expectedPrefix: '.cursor/skills/blackhole/',
  },
  {
    label: 'claude',
    agentsDir: '.claude/agents',
    expectedPrefix: '.claude/skills/blackhole/',
  },
  {
    label: 'gemini workspace',
    agentsDir: `${AGENTS_BUILD_AGENT_DIR}/agents`,
    expectedPrefix: `${AGENTS_BUILD_AGENT_DIR}/skills/blackhole/`,
  },
  {
    label: 'claude distribution',
    agentsDir: `${CLAUDE_DISTRIBUTION_AGENT_DIR}/agents`,
    expectedPrefix: `${CLAUDE_DISTRIBUTION_AGENT_DIR}/skills/blackhole/`,
  },
] as const;

const CITATION_PATH_RE = /[\w./-]*skills\/blackhole\/[\w./-]+/g;

/** Extract repo-relative skills/blackhole/ citation paths from compiled agent markdown. */
export const extractAgentDirCitations = (content: string): string[] => {
  const found = new Set<string>();
  for (const match of content.matchAll(CITATION_PATH_RE)) {
    const cleaned = match[0].replace(/['"§,)]+$/g, '');
    if (cleaned.includes('skills/blackhole/')) found.add(cleaned);
  }
  return [...found];
};

export type CitationViolation = { file: string; citation: string; reason: string };

/** Validate citations in one agent file against a target's expected prefix and on-disk resolution. */
export const findCitationViolations = (
  content: string,
  relFile: string,
  expectedPrefix: string,
  forbiddenPrefixes: readonly string[] = []
): CitationViolation[] => {
  const violations: CitationViolation[] = [];
  for (const citation of extractAgentDirCitations(content)) {
    let rejected = false;
    for (const forbidden of forbiddenPrefixes) {
      if (citation.startsWith(forbidden) || citation.includes(forbidden)) {
        violations.push({
          file: relFile,
          citation,
          reason: `forbidden prefix ${forbidden}`,
        });
        rejected = true;
        break;
      }
    }
    if (rejected) continue;
    if (!citation.startsWith(expectedPrefix)) {
      violations.push({
        file: relFile,
        citation,
        reason: `expected prefix ${expectedPrefix}`,
      });
      continue;
    }
    if (!fs.existsSync(path.join(root, citation))) {
      violations.push({
        file: relFile,
        citation,
        reason: 'path does not resolve on disk',
      });
    }
  }
  return violations;
};

const checkAgentDirCitations = (): CheckResult => {
  const errors: string[] = [];

  for (const target of AGENT_DIR_CITATION_TARGETS) {
    const agentsPath = path.join(root, target.agentsDir);
    if (!fs.existsSync(agentsPath)) {
      errors.push(`${target.label}: missing ${target.agentsDir}/`);
      continue;
    }

    for (const file of fs.readdirSync(agentsPath)) {
      if (!AGENT_MD_FILES.has(file)) continue;
      const relFile = path.join(target.agentsDir, file).split(path.sep).join('/');
      const content = fs.readFileSync(path.join(agentsPath, file), 'utf-8');
      for (const v of findCitationViolations(
        content,
        relFile,
        target.expectedPrefix,
        target.forbiddenPrefixes ?? []
      )) {
        errors.push(`${target.label} ${v.file}: ${v.citation} — ${v.reason}`);
      }
    }
  }

  if (errors.length) return { id: 'V-AGENTDIR-01', ok: false, detail: errors.join('; ') };
  return { id: 'V-AGENTDIR-01', ok: true };
};

export const runChecks = (): CheckResult[] => [checkAgentDirCitations()];
