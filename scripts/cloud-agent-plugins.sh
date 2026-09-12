#!/usr/bin/env bash
# Idempotent Cloud Agent plugin bootstrap: Mercure + Blackhole skills, agents,
# rules, and MCP manifests become visible to Cursor Cloud VMs.
#
# Why this exists: Cloud Agents only load (1) marketplace plugins synced into
# ~/.cursor/plugins/cache and (2) project .cursor/{skills,agents,rules}.
# Mercure's marketplace gitPath is `mercure-plugin/`, which is absent in the
# flattened cache — declared skills stay empty. Blackhole's own plugin tree is
# this checkout, but Cloud snapshots still need a real copy under
# ~/.cursor/plugins/local plus Mercure from GitHub.
#
# Source of truth is GitHub, not the version-keyed marketplace cache:
#   - Mercure: clone/update github.com/CorentinLumineau/mercure, then copy
#     mercure-plugin/cursor-dist to ~/.cursor/plugins/local/mercure
#   - Blackhole: this checkout's .cursor/{skills,agents,rules}, with a GitHub
#     clone fallback at ~/.cursor/src/blackhole
# The cache is a last-resort fallback when the private Mercure clone fails
# (missing Cursor GitHub App access / repositoryDependencies).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_PLUGINS="${HOME}/.cursor/plugins/local"
CACHE_ROOT="${HOME}/.cursor/plugins/cache"
MERCURE_SRC="${MERCURE_SRC:-${HOME}/.cursor/src/mercure}"
BLACKHOLE_SRC="${BLACKHOLE_SRC:-${HOME}/.cursor/src/blackhole}"
MERCURE_LOCAL="${LOCAL_PLUGINS}/mercure"
BLACKHOLE_LOCAL="${LOCAL_PLUGINS}/blackhole"
MERCURE_CLONE_URL="${MERCURE_CLONE_URL:-https://github.com/CorentinLumineau/mercure.git}"
BLACKHOLE_CLONE_URL="${BLACKHOLE_CLONE_URL:-https://github.com/CorentinLumineau/blackhole.git}"

mkdir -p "${LOCAL_PLUGINS}" "${ROOT}/.cursor/skills"

log() { printf 'cloud-agent-plugins: %s\n' "$*" >&2; }

is_mercure_tree() {
  local d="$1"
  [ -d "${d}/skills" ] && [ -f "${d}/skills/x-plan/SKILL.md" ]
}

is_blackhole_cursor_tree() {
  local d="$1"
  [ -f "${d}/skills/blackhole/SKILL.md" ]
}

github_app_unblocker() {
  log "WARNING: grant the Cursor GitHub App access to these repos, then re-run:"
  log "WARNING:   1. https://github.com/apps/cursor → Configure → CorentinLumineau"
  log "WARNING:   2. Repository access must include CorentinLumineau/mercure (private, required)"
  log "WARNING:   3. Repository access should include CorentinLumineau/blackhole"
  log "WARNING:   4. .cursor/environment.json repositoryDependencies must list both github.com/CorentinLumineau/mercure and github.com/CorentinLumineau/blackhole"
  log "WARNING:   5. Save the Cloud environment (or merge the repo-managed environment.json) so the generated token is scoped to those repos"
}

# Clone or fast-forward dest from url. A failed fetch of an existing clone
# still succeeds — a slightly stale GitHub tree beats the marketplace cache.
ensure_git_clone() {
  local dest="$1" url="$2" name="$3"
  mkdir -p "$(dirname "${dest}")"
  if [ -d "${dest}/.git" ]; then
    log "updating ${name} GitHub clone at ${dest}"
    GIT_TERMINAL_PROMPT=0 git -C "${dest}" remote set-url origin "${url}" 2>/dev/null || true
    if GIT_TERMINAL_PROMPT=0 git -C "${dest}" fetch --depth 1 --force origin >/dev/null 2>&1; then
      git -C "${dest}" reset --hard FETCH_HEAD >/dev/null 2>&1 || true
      log "${name} updated from GitHub"
      return 0
    fi
    log "WARNING: ${name} fetch failed; keeping existing clone"
    return 0
  fi
  rm -rf "${dest}"
  log "cloning ${url} into ${dest}"
  if GIT_TERMINAL_PROMPT=0 git clone --depth 1 "${url}" "${dest}" >/dev/null 2>&1; then
    log "${name} cloned from GitHub"
    return 0
  fi
  rm -rf "${dest}"
  return 1
}

# Prefer the generated Cursor distribution, then authoring tree.
resolve_cursor_plugin_root() {
  local d="$1"
  local cand
  for cand in \
    "${d}/mercure-plugin/cursor-dist" \
    "${d}/cursor-dist" \
    "${d}/mercure-plugin" \
    "${d}"
  do
    if is_mercure_tree "${cand}"; then
      printf '%s\n' "${cand}"
      return 0
    fi
  done
  return 1
}

find_cache_mercure_root() {
  local d best=""
  [ -d "${CACHE_ROOT}/mercure" ] || return 1
  while IFS= read -r d; do
    case "${d}" in
      */opencode-dist) continue ;;
    esac
    if [ -d "${d}/skills" ] && [ -d "${d}/agents" ]; then
      if [ -f "${d}/skills/x-plan/SKILL.md" ]; then
        printf '%s\n' "${d}"
        return 0
      fi
      [ -z "${best}" ] && best="${d}"
    fi
  done < <(find "${CACHE_ROOT}/mercure" -maxdepth 8 -type d -name skills 2>/dev/null | sed 's|/skills$||')
  if [ -n "${best}" ]; then
    printf '%s\n' "${best}"
    return 0
  fi
  return 1
}

# Marketplace cache is synced in parallel with `start`. Only wait when GitHub
# clone already failed and some other plugin cache is already present.
wait_for_cache_mercure() {
  if find_cache_mercure_root >/dev/null; then
    return 0
  fi
  if [ ! -d "${CACHE_ROOT}" ] || [ -z "$(ls -A "${CACHE_ROOT}" 2>/dev/null || true)" ]; then
    return 1
  fi
  local i
  for i in 1 2 3 4 5 6 7 8; do
    sleep 2
    if find_cache_mercure_root >/dev/null; then
      log "mercure cache appeared after $((i * 2))s"
      return 0
    fi
  done
  return 1
}

write_cursor_plugin_manifest() {
  local dest="$1" name="$2" description="$3"
  mkdir -p "${dest}/.cursor-plugin"
  cat > "${dest}/.cursor-plugin/plugin.json" <<EOF
{
  "name": "${name}",
  "description": "${description}",
  "version": "0.0.0-cloud"
}
EOF
}

# Copy a plugin surface into dest as a real tree (never cache/src symlinks).
materialize_local_copy() {
  local src="$1"
  local dest="$2"
  local name="$3"
  local description="$4"
  local staging
  staging="$(mktemp -d "${TMPDIR:-/tmp}/${name}-plugin.XXXXXX")"

  if [ -d "${src}/.cursor-plugin" ]; then
    cp -a "${src}/.cursor-plugin" "${staging}/.cursor-plugin"
  else
    write_cursor_plugin_manifest "${staging}" "${name}" "${description}"
  fi

  local dir
  for dir in skills agents rules hooks commands; do
    if [ -d "${src}/${dir}" ]; then
      cp -a "${src}/${dir}" "${staging}/${dir}"
    fi
  done

  if [ -f "${src}/mcp.json" ]; then
    cp -a "${src}/mcp.json" "${staging}/mcp.json"
  elif [ -f "${src}/.mcp.json" ]; then
    sed 's/\${CLAUDE_PLUGIN_ROOT}/\${PLUGIN_ROOT}/g' "${src}/.mcp.json" \
      > "${staging}/mcp.json"
  fi

  if [ "${name}" = "mercure" ] && [ ! -e "${staging}/mercure-plugin" ] && [ -d "${staging}/skills" ]; then
    ln -sfn . "${staging}/mercure-plugin"
  fi

  rm -rf "${dest}"
  mkdir -p "$(dirname "${dest}")"
  mv "${staging}" "${dest}"
}

overlay_skill_dirs() {
  local src_skills="$1"
  [ -d "${src_skills}" ] || return 0
  local skill
  for skill in "${src_skills}"/*/; do
    [ -f "${skill}SKILL.md" ] || continue
    local name
    name="$(basename "${skill}")"
    # Never shadow this repo's committed blackhole skill tree.
    if [ "${name}" = "blackhole" ]; then
      continue
    fi
    ln -sfn "${skill%/}" "${ROOT}/.cursor/skills/${name}"
  done
}

install_mercure_from() {
  local src="$1"
  local why="$2"
  local root
  if ! root="$(resolve_cursor_plugin_root "${src}")"; then
    if is_mercure_tree "${src}"; then
      root="${src}"
    else
      return 1
    fi
  fi
  log "mercure ${why}: ${root}"
  materialize_local_copy "${root}" "${MERCURE_LOCAL}" "mercure" \
    "Claude Code-native development plugin — workflow skills, git operations, agents, MCP."
  overlay_skill_dirs "${MERCURE_LOCAL}/skills"
  return 0
}

install_blackhole_from_cursor_tree() {
  local cursor_tree="$1"
  local hooks_tree="$2"
  local why="$3"
  if ! is_blackhole_cursor_tree "${cursor_tree}"; then
    return 1
  fi
  log "blackhole ${why}: ${cursor_tree}"
  materialize_local_copy "${cursor_tree}" "${BLACKHOLE_LOCAL}" "blackhole" \
    "Backlog campaign orchestrator — coordinator, orchestrator, hunt, V-code ledger."
  if [ -n "${hooks_tree}" ] && [ -d "${hooks_tree}" ]; then
    rm -rf "${BLACKHOLE_LOCAL}/hooks"
    cp -a "${hooks_tree}" "${BLACKHOLE_LOCAL}/hooks"
  fi
  return 0
}

# --- Mercure: GitHub first, marketplace cache last ---
MERCURE_OK=0
if ensure_git_clone "${MERCURE_SRC}" "${MERCURE_CLONE_URL}" "mercure"; then
  if install_mercure_from "${MERCURE_SRC}" "GitHub clone (cursor-dist preferred)"; then
    MERCURE_OK=1
  else
    log "WARNING: cloned ${MERCURE_CLONE_URL} but found no Cursor plugin tree (cursor-dist / mercure-plugin / skills/x-plan)"
  fi
fi

if [ "${MERCURE_OK}" -eq 0 ]; then
  cache_root=""
  if cache_root="$(find_cache_mercure_root)"; then
    :
  elif wait_for_cache_mercure; then
    cache_root="$(find_cache_mercure_root || true)"
  fi
  if [ -n "${cache_root}" ]; then
    log "WARNING: using marketplace cache fallback — GitHub clone of ${MERCURE_CLONE_URL} failed"
    github_app_unblocker
    if install_mercure_from "${cache_root}" "marketplace cache fallback"; then
      MERCURE_OK=1
    fi
  fi
fi

if [ "${MERCURE_OK}" -eq 0 ]; then
  log "WARNING: mercure not cloneable from ${MERCURE_CLONE_URL} and not in marketplace cache — skipping Mercure overlay"
  github_app_unblocker
fi

# --- Blackhole: this checkout first (it is the GitHub clone), then a src clone ---
BLACKHOLE_OK=0
BH_HOOKS=""
if [ -d "${ROOT}/plugins/blackhole/hooks" ]; then
  BH_HOOKS="${ROOT}/plugins/blackhole/hooks"
elif [ -d "${ROOT}/templates/hooks/pretooluse" ]; then
  BH_HOOKS="${ROOT}/templates/hooks/pretooluse"
fi

if install_blackhole_from_cursor_tree "${ROOT}/.cursor" "${BH_HOOKS}" "this checkout"; then
  BLACKHOLE_OK=1
fi

if [ "${BLACKHOLE_OK}" -eq 0 ]; then
  if ensure_git_clone "${BLACKHOLE_SRC}" "${BLACKHOLE_CLONE_URL}" "blackhole"; then
    clone_hooks=""
    if [ -d "${BLACKHOLE_SRC}/plugins/blackhole/hooks" ]; then
      clone_hooks="${BLACKHOLE_SRC}/plugins/blackhole/hooks"
    fi
    if install_blackhole_from_cursor_tree "${BLACKHOLE_SRC}/.cursor" "${clone_hooks}" "GitHub clone"; then
      BLACKHOLE_OK=1
    fi
  fi
fi

if [ "${BLACKHOLE_OK}" -eq 0 ]; then
  log "WARNING: blackhole plugin tree missing from this checkout and ${BLACKHOLE_CLONE_URL} is not cloneable"
  github_app_unblocker
fi

mercure_skills="$(find -L "${ROOT}/.cursor/skills" -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l | tr -d ' ')"
bh_ok=0
[ -f "${ROOT}/.cursor/skills/blackhole/SKILL.md" ] && bh_ok=1
[ -f "${BLACKHOLE_LOCAL}/skills/blackhole/SKILL.md" ] && bh_ok=1
x_auto_ok=0
[ -f "${ROOT}/.cursor/skills/x-auto/SKILL.md" ] && x_auto_ok=1
log "project skills with SKILL.md: ${mercure_skills} (blackhole present=${bh_ok} x-auto present=${x_auto_ok})"
log "local plugins: ${MERCURE_LOCAL} ${BLACKHOLE_LOCAL}"
if [ "${x_auto_ok}" -eq 0 ]; then
  log "WARNING: x-auto overlay missing — Mercure skills will not be visible to Cloud Agents"
  github_app_unblocker
fi
