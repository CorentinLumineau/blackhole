---
type: plan
summary: "Refuse carry targets that resolve through a symlink outside the carry allowlist (issue #1662)"
status: current
review_trigger: "on file change"
created: 2026-11-26
last_updated: 2026-11-26
---

# Plan - carry target symlink hardening

Re-check the carry allowlist and protected prefixes on the symlink-resolved real path of each manifest `target_path`, so `documentation` or `<package>/documentation` symlinked to `.github`, `hooks`, `.git` or `package.json` cannot be written through. Non-symlink paths are unchanged. See the working plan `.blackhole/plans/issue-1662.md`.
