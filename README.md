# Backlog Campaign — Agent-Agnostic Skill Package

An AI agent-agnostic skill package designed to orchestrate a "backlog campaign" until there are zero open issues and PRs in the repository. Compatible with **skills.sh** and a variety of AI coding agents (including Cursor, Antigravity/Gemini, Claude Code, Windsurf, Roo Code, and GitHub Copilot).

It automates the issue lifecycle using a strict 5-phase protocol (Handle → Plan → Implement → Review → Loop) and preserves finding ledgers and queues in a project-local, agent-agnostic state directory `.backlog-campaign/`.

## Installation

You can install this skill into any target repository using the standard `skills.sh` registry CLI:

```bash
npx skills add <owner/repo>
```

*(Where `<owner/repo>` is the name of your GitHub repository hosting this skill.)*

### Step 2: Configure Rules & Agents

Since different AI agents use different mechanisms for loading rules (e.g., `.cursorrules`, `.clauderules`, `.agents/AGENTS.md`), the package includes a helper script `skills.sh` that links the rules and custom agent definitions to your active agent(s):

```bash
# From the root of your target project:
sh skills/backlog-campaign/skills.sh install
```

To install using symbolic links (useful for development so updates to the skill are instantly reflected in the agent folders):
```bash
sh skills/backlog-campaign/skills.sh install --symlink
```

To target a specific agent explicitly:
```bash
sh skills/backlog-campaign/skills.sh install --agent cursor
```

## Usage

Once installed, your AI agent will automatically detect the skill instructions via `SKILL.md` or the injected rule blocks and follow the backlog campaign protocol:

1. **Bootstrap Phase 0**: The agent reads the campaign configuration at `.backlog-campaign/config.json` (created from a template on installation) and reconciles state files (`queue.json` and `findings-ledger.json`).
2. **Execution loop**: The agent handles, plans, splits, implements, and reviews issues until the backlog is empty.
3. **Continuous updates**: You can ask your agent for status, sync, or run commands at any time.

### CLI Status Check

You can inspect the installation status of the backlog campaign skill in your project at any time:

```bash
sh skills/backlog-campaign/skills.sh status
```

### Uninstallation

To cleanly remove all rule injections and agent links from your project:

```bash
sh skills/backlog-campaign/skills.sh uninstall
```

*(Note: The runtime campaign state folder `.backlog-campaign/` is preserved during uninstallation to prevent accidental data loss.)*

## Repository Structure

*   `SKILL.md`: Main skill entrypoint for the `skills.sh` registry.
*   `config.json`: Default campaign configuration template.
*   `skills.sh`: The helper script to link/copy the rules and agents.
*   `references/`: Detailed, stage-by-stage manuals for the five lifecycle phases.
*   `agents/`: Custom instructions for subagents (`backlog-coordinator` and `backlog-orchestrator`).
*   `rules/`: Core system rules (protocol, state mutations, and V-code enforcement).
