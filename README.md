# Backlog Campaign — Multi-Platform Native Skill & Plugin

An AI agent-agnostic backlog orchestrator designed to empty the repository issue backlog. Natively integrates with:
1. **Claude Code (Anthropic)**: Installable as a native CLI plugin via a custom marketplace.
2. **Cursor**: Pre-configured native Rules (`.cursor/rules/*.mdc`) and Custom Agents (`.cursor/agents/*.md`).
3. **skills.sh (Generic)**: Installs directly via the `skills.sh` registry.

It automates the issue lifecycle using a strict 5-phase protocol (Handle → Plan → Implement → Review → Loop) and preserves findings ledgers and queues in a project-local state directory `.backlog-campaign/`.

---

## 1. Installation Pathways

### Pathway A: Claude Code Native (Anthropic)
Register this repository as a plugin marketplace and install the plugin natively:
```bash
# 1. Register the marketplace
/plugin marketplace add https://github.com/CorentinLumineau/backlog-campaign

# 2. Install the plugin
/plugin install backlog-campaign@backlog-campaign-marketplace
```
*For project-specific, non-shared setups, you can alternatively copy the pre-compiled `.claude/` directory into your project root.*

### Pathway B: Cursor Native
Copy or symlink the pre-compiled `.cursor/` directory to the root of your target project:
*   **Custom Agents**: The coordinator and orchestrator will be immediately available.
*   **Glob-Scoped Rules**: Cursor will automatically load the V-code quality gates checklist (`.cursor/rules/backlog-campaign-vcodes.mdc`) into the chat context whenever code files (TypeScript, Go, Python, etc.) are opened.

### Pathway C: Generic Agent / `skills.sh` Registry
Install directly using the standard `skills.sh` registry CLI:
```bash
npx skills add CorentinLumineau/backlog-campaign
```
The files are downloaded to `skills/backlog-campaign/`. Any compatible agent will automatically read `SKILL.md` and load the associated rules from the `references/` directory.

---

## 2. Usage & Workflow

Once loaded, your AI agent will automatically detect the skill instructions via `SKILL.md` or native rule files and follow the protocol:

1. **Bootstrap Phase 0**: The agent reads the campaign configuration at `.backlog-campaign/config.json` (created from a template) and reconciles state files (`queue.json` and `findings-ledger.json`).
2. **Execution Loop**: The agent handles, plans, splits, implements, and reviews issues until the backlog is empty.
3. **Continuous updates**: You can ask your agent for status, sync, or run commands at any time.

---

## 3. Development & DRY Compilation Pipeline

To respect DRY (Don't Repeat Yourself) and SOLID design principles, all code, agent prompts, and rules are maintained in a **Single Source of Truth** under the `src/` directory.

The project uses a Bun-based compiler to compile `src/` into the specific formats required by each platform:
```bash
# Run the compiler to build target folders (.cursor/, .claude/, and root files)
bun run build
```

### Source of Truth Layout
*   `src/SKILL.md`: The base skill entrypoint.
*   `src/agents/`: Coordinator and Orchestrator agent templates.
*   `src/references/`: Stage-by-stage manuals and rule specifications (protocol, state mutations, and V-codes).

### Build Pipeline Targets
*   `SKILL.md`, `agents/`, `references/` (root-level): Generated for **skills.sh** (resolves `{{AGENT_DIR}}` -> `skills/backlog-campaign`).
*   `.cursor/`: Generated for **Cursor** (resolves `{{AGENT_DIR}}` -> `.cursor` and converts rules to `.mdc` format with glob auto-triggers).
*   `.claude/`: Generated for **Claude Code project local** (resolves `{{AGENT_DIR}}` -> `.claude`).
*   `.claude-plugin/plugin.json`: Metadata manifest generated for **Claude Code plugin**.
*   `marketplace.json`: Catalog definition for the Claude Code marketplace.
