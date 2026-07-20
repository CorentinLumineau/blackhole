#!/usr/bin/env bash
# detect-doc-schema.sh — Detect which ADR-artifact schema a consumer repo already uses:
# mercure's or blackhole's own, at either of two artifact layers (ADR-012 E1).
#
# Contract:
#   - Fast: exits in < 500ms
#   - Read-only: no writes, no env mutations
#   - No network: no curl, wget, or remote calls
#   - Exits 0: always (failures print and exit 0)
#   - Self-contained: no user interaction, no stdin
#
# Usage:
#   detect-doc-schema.sh index <path-to-INDEX.md>
#   detect-doc-schema.sh frontmatter <path-to-ADR-file.md>
#
# Output format: "schema=mercure" | "schema=blackhole" | "schema=ambiguous" on stdout
# (single line). SSOT for the column lists and discriminator keys: this file's detection
# steps below — do not restate them elsewhere in this repo or in agent prompts.
#
# index mode: parses the first markdown table header row (a line matching
# ^\s*\|.*\|\s*$ immediately followed by a |---|...| separator line). Columns are
# split on '|', trimmed, and lowercased before comparison.
#   mercure   (4 cols): adr | title | status | date
#   blackhole (5 cols): path | summary | type | status | review_trigger
#   anything else (wrong count, renamed/reordered column, no header found) -> ambiguous
#
# frontmatter mode: parses the YAML block between the first pair of '---' lines,
# top-level keys only.
#   mercure-only discriminator keys:   number, title, source, scope, decision_signals,
#                                       tracking_initiative
#   blackhole-only discriminator keys: last_updated, review_trigger
#   both sets present, neither set present, or unparsable/missing block -> ambiguous

set -u

emit() { echo "schema=$1"; exit 0; }

mode="${1:-}"
target="${2:-}"

[[ -z "$mode" || -z "$target" || ! -f "$target" ]] && emit "ambiguous"

detect_index() {
    local header=""
    local prev=""
    local line
    while IFS= read -r line || [[ -n "$line" ]]; do
        if [[ "$line" =~ ^[[:space:]]*\|[[:space:]:|-]+\|[[:space:]]*$ ]] \
            && [[ "$prev" =~ ^[[:space:]]*\|.*\|[[:space:]]*$ ]]; then
            header="$prev"
            break
        fi
        prev="$line"
    done < "$target"

    [[ -z "$header" ]] && emit "ambiguous"

    local cells=()
    IFS='|' read -ra cells <<< "$header"
    local cols=()
    local cell trimmed
    for cell in "${cells[@]}"; do
        trimmed=$(echo "$cell" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')
        [[ -n "$trimmed" ]] && cols+=("$trimmed")
    done

    local mercure_cols=("adr" "title" "status" "date")
    local blackhole_cols=("path" "summary" "type" "status" "review_trigger")

    if [[ "${cols[*]}" == "${mercure_cols[*]}" ]]; then
        emit "mercure"
    elif [[ "${cols[*]}" == "${blackhole_cols[*]}" ]]; then
        emit "blackhole"
    else
        emit "ambiguous"
    fi
}

detect_frontmatter() {
    local delims
    delims=($(grep -n '^---[[:space:]]*$' "$target" | cut -d: -f1))

    [[ "${#delims[@]}" -lt 2 ]] && emit "ambiguous"

    local start="${delims[0]}"
    local end="${delims[1]}"
    local fm=""
    if (( end - start > 1 )); then
        fm=$(sed -n "$((start + 1)),$((end - 1))p" "$target")
    fi

    [[ -z "$fm" ]] && emit "ambiguous"

    has_key() { echo "$fm" | grep -qE "^${1}:"; }

    local mercure_keys=("number" "title" "source" "scope" "decision_signals" "tracking_initiative")
    local blackhole_keys=("last_updated" "review_trigger")

    local has_mercure="false"
    local has_blackhole="false"
    local k
    for k in "${mercure_keys[@]}"; do has_key "$k" && has_mercure="true"; done
    for k in "${blackhole_keys[@]}"; do has_key "$k" && has_blackhole="true"; done

    if [[ "$has_mercure" == "true" && "$has_blackhole" == "true" ]]; then
        emit "ambiguous"
    elif [[ "$has_mercure" == "true" ]]; then
        emit "mercure"
    elif [[ "$has_blackhole" == "true" ]]; then
        emit "blackhole"
    else
        emit "ambiguous"
    fi
}

case "$mode" in
    index) detect_index ;;
    frontmatter) detect_frontmatter ;;
    *) emit "ambiguous" ;;
esac
