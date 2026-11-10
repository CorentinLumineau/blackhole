// `model:` in src/agents/*.md is a Claude Code slug (`opus[1m]`) that sets the plugin agent
// type's context window (scripts/checks/agents.check.ts AGENT_FRONTMATTER_POLICY). No other
// target's agent schema accepts that slug, so every non-Claude agent output drops it and inherits
// its own harness default model.
export const stripClaudeOnlyAgentFrontmatter = (content: string): string =>
  content.replace(/^---\r?\n[\s\S]*?\r?\n---/, (block) => block.replace(/^model:.*\r?\n/m, ''));
