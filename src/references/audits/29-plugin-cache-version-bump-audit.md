---
section: Plugin Cache Version-Bump Audit
vcodes: [V-PLUGIN-01]
---
### Plugin Cache Version-Bump Audit (`V-PLUGIN-01`, ADR-030)
*   **Context**: the installed Claude Code plugin cache
    (`~/.claude/plugins/cache/blackhole-marketplace/blackhole/<version>/...`) is version-keyed,
    not content-addressed — a merged fix to `templates/hooks/**` ships inert to every existing
    installation until someone bumps the version and reinstalls (issue #800; three merged
    security fixes, #761/#774/#777, went undetected this way). This audit is the CI-safe half of
    the fix: it reads only diff content, never installed/local plugin-cache state.
*   **Trigger**: the diff touches any path under `templates/hooks/**` — the whole hooks source
    subtree, not narrowed to a single subdirectory, so a future in-tree reorganization stays
    covered without a glob edit. No `templates/hooks/**` path in the diff — emit no § Plugin Cache Version-Bump Audit findings
    (vacuous gate, same discipline as the other conditionally-scoped audits).
*   **Pass condition**: `package.json`'s `version` field differs between the PR's base and head
    revisions — read the actual field via JSON parse on both revisions, never a text-pattern
    match on the diff (unspoofable by an unrelated version-like string appearing elsewhere in the
    diff).
*   **Finding on gap (`V-PLUGIN-01`, `BLOCK`)**: the trigger fires and the pass condition does
    not hold — severity `BLOCK`, cite `package.json` at `line: 1` (the `version` field), summary
    states which `templates/hooks/**` file(s) changed without a matching version bump. Fix: bump
    `package.json`'s `version` and rerun `bun run build` in the same diff (regenerates all
    version-carrying manifests, `.claude-plugin/plugin.json` included).
*   **Non-goal**: this audit does not verify that the manual republish/reinstall step actually
    happened afterward, nor that the installed cache now matches the repo build — that residual
    gap is covered by the independent, advisory `.blackhole/plugin-drift.json` signal
    (`blackhole-state.md` § Plugin-Drift Signal), not by this diff-content check.
