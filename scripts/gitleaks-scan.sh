#!/bin/sh
# Secret scan of a PR's own range with a pinned, checksum-verified gitleaks.
# Usage: gitleaks-scan.sh <base-sha> <head-sha>
# Exit: 0 clean, 1 finding or allowlist file in range, 2 no merge-base / bad usage, 3 checksum mismatch.
set -eu

VERSION=8.28.0
SHA256=a65b5253807a68ac0cafa4414031fd740aeb55f54fb7e55f386acb52e6a840eb
ARCHIVE="gitleaks_${VERSION}_linux_x64.tar.gz"
URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${ARCHIVE}"

[ $# -eq 2 ] || { echo "usage: $0 <base-sha> <head-sha>" >&2; exit 2; }
BASE=$(git merge-base "$1" "$2" 2>/dev/null || true)
[ -n "$BASE" ] || { echo "no merge-base for $1 and $2" >&2; exit 2; }

# Allowlist files the scanner would read from the PR tree. Any commit in the range touching one fails,
# so an add-then-remove across commits is caught too.
if git log --name-only --format= "$BASE..$2" | grep -qE '(^|/)\.gitleaks(ignore|\.toml)$'; then
  echo "refused: the range adds or modifies .gitleaksignore or .gitleaks.toml" >&2
  exit 1
fi

DIR=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/gitleaks.XXXXXX")
trap 'rm -rf "$DIR"' EXIT
curl -fsSL -o "$DIR/$ARCHIVE" "$URL"
echo "$SHA256  $DIR/$ARCHIVE" | sha256sum -c - >/dev/null 2>&1 || { echo "gitleaks checksum mismatch" >&2; exit 3; }
tar -xzf "$DIR/$ARCHIVE" -C "$DIR" gitleaks

# Ruleset, ignore file and inline allow comments never come from the PR tree.
printf '[extend]\nuseDefault = true\n' > "$DIR/config.toml"
mkdir "$DIR/noignore"
"$DIR/gitleaks" git --redact --no-banner --ignore-gitleaks-allow \
  --config "$DIR/config.toml" --gitleaks-ignore-path "$DIR/noignore" \
  --log-opts="$BASE..$2" .
