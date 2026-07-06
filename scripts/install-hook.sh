#!/usr/bin/env bash
# Install git pre-commit hook to run build and stage compiled outputs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.git/hooks/pre-commit"

cat > "$HOOK" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  echo "pre-commit: bun not found; skipping blackhole build"
  exit 0
fi

bun run build
bun run build --gemini
git add -A agents/ rules/ skills/ references/ .cursor/ .claude/ .claude-plugin/ SKILL.md marketplace.json .agents/rules/ .agents/agents/ .agents/skills/blackhole/ .gemini-plugin/ 2>/dev/null || true
EOF

chmod +x "$HOOK"
echo "Installed pre-commit hook at $HOOK"
