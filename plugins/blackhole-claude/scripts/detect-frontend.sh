#!/usr/bin/env bash
# detect-frontend.sh — Detect frontend/UI project at campaign invocation time.
#
# Contract:
#   - Fast: exits in < 500ms
#   - Read-only: no writes, no env mutations
#   - No network: no curl, wget, or remote calls
#   - Exits 0: always (failures print and exit 0)
#   - Self-contained: no user interaction, no stdin
#
# Output format: "frontend=yes" or "frontend=no" on stdout (single line).
# SSOT for keywords: this file's detection steps below — do not restate the
# keyword list elsewhere in this repo or in agent prompts.

set -u

emit_yes() { echo "frontend=yes"; exit 0; }
emit_no()  { echo "frontend=no"; exit 0; }

# 1. Framework deps in package.json (root + monorepo apps/packages/services)
for pkg in package.json apps/*/package.json packages/*/package.json services/*/package.json; do
    [[ -f "$pkg" ]] || continue
    if grep -qE '"(react|vue|svelte|@angular/core|next|nuxt|@sveltejs/kit|solid-js|qwik)"' "$pkg" 2>/dev/null; then
        emit_yes
    fi
done

# 2. UI file extensions — scan root + monorepo subdirs
for dir in . apps packages services; do
    [[ -d "$dir" ]] || continue
    if find "$dir" -maxdepth 4 -type f \( -name '*.tsx' -o -name '*.vue' -o -name '*.svelte' -o -name '*.jsx' \) 2>/dev/null | head -1 | grep -q .; then
        emit_yes
    fi
done

# 3. UI directory signals
for ui_dir in src/components app/components apps/web pages views public; do
    [[ -d "$ui_dir" ]] && emit_yes
done

# 4. index.html at root
[[ -f index.html ]] && emit_yes

# 5. Tailwind / PostCSS config
for cfg in tailwind.config.js tailwind.config.ts tailwind.config.mjs postcss.config.js postcss.config.mjs vite.config.js vite.config.ts vite.config.mjs next.config.js next.config.ts next.config.mjs nuxt.config.js nuxt.config.ts; do
    [[ -f "$cfg" ]] && emit_yes
done

emit_no
