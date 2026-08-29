#!/usr/bin/env bash
# Consumer-repo wrapper for ADR-021 D3 review promotion (issue #687).
# Invoke from a consumer worktree; resolves the vendored blackhole plugin root.
set -euo pipefail

PLUGIN_ROOT="${BLACKHOLE_PLUGIN_ROOT:-}"
if [[ -z "${PLUGIN_ROOT}" ]]; then
  if [[ -d vendor/blackhole ]]; then
    PLUGIN_ROOT="$(cd vendor/blackhole && pwd)"
  elif [[ -d node_modules/blackhole ]]; then
    PLUGIN_ROOT="$(cd node_modules/blackhole && pwd)"
  else
    echo "blackhole-promote-review: set BLACKHOLE_PLUGIN_ROOT or vendor/blackhole" >&2
    exit 2
  fi
fi

exec bun run --cwd "${PLUGIN_ROOT}" scripts/promote-review-artifact.ts "$@"
