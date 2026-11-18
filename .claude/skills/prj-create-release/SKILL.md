---
name: prj-create-release
description: >-
  Cut a new backlog-campaign GitHub release. Use when asked to create a release,
  cut vX.Y.Z, publish release notes, or tag a version.
disable-model-invocation: true
---

# Create Release

Maintainer workflow for publishing a **product-focused** GitHub release.
Every tag `vX.Y.Z` must have a matching notes file before the tag is pushed.

Automated every-20-merged-PR cadence (when the owner has set `RELEASE_CADENCE_ENABLED=true`)
is documented in [documentation/runbooks/release-cadence.md](../../../documentation/runbooks/release-cadence.md).
This skill remains the off-cadence / hotfix path. Cadence reuses `bun run release` validate/tag/push
and never publishes a GitHub Release itself. Agents must not set repo variables or secrets.

## Prerequisites

- `gh auth status` succeeds
- On `main`, `bun run build` passes
- Working tree clean before `tag` / `push`

## Contract

| Artifact | Path |
|----------|------|
| Release notes | `.github/releases/vX.Y.Z.md` |
| Git tag | `vX.Y.Z` (must match notes filename) |
| Package version | `package.json` `version` without `v` prefix |

CI reads `.github/releases/${TAG}.md` when the file exists; otherwise falls back to git-cliff.

## Workflow

1. **Decide version** — ask the user if semver bump is unclear
2. **Prepare scaffold**
   ```bash
   bun run release prepare vX.Y.Z
   ```
   `prepare` bumps `package.json` and then runs `bun run build` internally, regenerating
   the 7 version-carrying manifests (`.claude-plugin/plugin.json`,
   `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, `.gemini-plugin/plugin.json`,
   `plugins/blackhole/plugin.json`, `plugins/blackhole-agent-plugins/plugin.json`,
   `plugins/blackhole-claude/.claude-plugin/plugin.json`) — no separate manual build step is needed.
3. **Edit notes** — `.github/releases/vX.Y.Z.md`
   - Use [TEMPLATE.md](../../../.github/releases/TEMPLATE.md) and the prior release as reference
   - **v0.1.0** (first release only): full product overview — goal, flow, agents, install
   - **v0.2.0+** (minor/patch): **diff-focused** — only `### ✨ What's new in vX.Y.Z` with categorized changes since the previous tag; link to v0.1.0 + README for full overview
   - Never mention external projects
   - Patch releases may omit a notes file and rely on git-cliff (optional)
4. **Validate**
   ```bash
   bun run release validate vX.Y.Z
   ```
5. **Commit**
   ```bash
   git add .github/releases/vX.Y.Z.md package.json \
     .claude-plugin/plugin.json .claude-plugin/marketplace.json \
     .codex-plugin/plugin.json .gemini-plugin/plugin.json \
     plugins/blackhole/plugin.json plugins/blackhole-agent-plugins/plugin.json \
     plugins/blackhole-claude/.claude-plugin/plugin.json
   git commit -m "docs: add vX.Y.Z release notes"
   git push origin main
   ```
6. **Tag and push** (triggers CI)
   ```bash
   bun run release tag vX.Y.Z
   bun run release push vX.Y.Z
   ```
7. **Verify**
   ```bash
   gh release view vX.Y.Z
   ```
8. **Close milestone** (when `vX.Y.Z` was the active roadmap milestone)
   - Confirm zero open issues on that milestone: `gh issue list --milestone "vX.Y.Z" --state open`
   - Close via GitHub UI or API — **only after** step 7 succeeds
   - See `.github/rules/release-milestone-governance.mdc` for project policy

## Retagging an existing release

Only when the user explicitly requests it:

```bash
git tag -d vX.Y.Z
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin :refs/tags/vX.Y.Z
git push origin vX.Y.Z
```

## References

- [Release checklist](references/checklist.md)
- [Release workflow](../../../.github/workflows/release.yml)
- [README install section](../../../README.md#-installation-paths)

## Never

- Overwrite a `.github/releases/vX.Y.Z.md` release with git-cliff content
- Mention bootstrap from other repositories in release notes
- Tag without a matching notes file for major/minor releases
