# Blackhole — Claude Code

## Run the campaign

```bash
/goal run blackhole until empty
```

## Install the plugin

```bash
/plugin marketplace add https://github.com/CorentinLumineau/blackhole
/plugin install blackhole@blackhole-marketplace
```

## Forge backends

Campaign forge integration supports **GitHub** (`gh`), **Gitea** (`tea`), and **GitLab** (`glab`).
Set `.blackhole/config.json` → `"forge"` to `github`, `gitea`, or `gitlab`, or omit it to
auto-detect from `git remote origin`. Run `bun run doctor` to verify CLI auth for the active
backend. See [ADR-027](documentation/decisions/ADR-027-forge-adapter-interface.md).

## References

- Agent roster and triggers: [AGENTS.md](AGENTS.md)
- Skill entry: [.claude/skills/blackhole/SKILL.md](.claude/skills/blackhole/SKILL.md)
