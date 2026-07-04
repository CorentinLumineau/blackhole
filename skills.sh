#!/usr/bin/env bash

# skills.sh - Helper script to install, uninstall, and check status of backlog-campaign skill.
# Compatible with Cursor, Antigravity, Claude Code, Windsurf, Roo Code, and Copilot.

set -euo pipefail

# Helper to print usage
usage() {
  echo "Usage: $0 [install|uninstall|status] [target-project-path] [options]"
  echo ""
  echo "Commands:"
  echo "  install      Install the skill into the target project"
  echo "  uninstall    Remove the skill from the target project"
  echo "  status       Check if the skill is installed in the target project"
  echo ""
  echo "Options:"
  echo "  -s, --symlink    Use symlinks instead of copying files (developer mode)"
  echo "  -a, --agent      Explicitly specify agent target (cursor, antigravity, claude, windsurf, roo, copilot)"
  echo ""
  exit 1
}

# Parse arguments
COMMAND=""
TARGET_PROJECT=""
MODE="copy"
AGENT_LIMIT=""

while [[ $# -gt 0 ]]; do
  case $1 in
    install|uninstall|status)
      COMMAND="$1"
      shift
      ;;
    -s|--symlink)
      MODE="symlink"
      shift
      ;;
    -a|--agent)
      if [[ $# -lt 2 ]]; then
        echo "Error: --agent requires a value"
        usage
      fi
      AGENT_LIMIT="$2"
      shift 2
      ;;
    *)
      if [ -z "$TARGET_PROJECT" ]; then
        TARGET_PROJECT="$1"
        shift
      else
        echo "Error: Unknown argument $1"
        usage
      fi
      ;;
  esac
done

if [ -z "$COMMAND" ]; then
  echo "Error: Command is required"
  usage
fi

if [ -z "$TARGET_PROJECT" ]; then
  TARGET_PROJECT="."
fi

# Convert to absolute path
TARGET_PROJECT="$(cd "$TARGET_PROJECT" && pwd)"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Verify source directory contains SKILL.md
if [ ! -f "$SOURCE_DIR/SKILL.md" ]; then
  echo "Error: Source directory $SOURCE_DIR does not contain SKILL.md"
  exit 1
fi

echo "==============================================="
echo "Backlog Campaign Tool - Agent Skill Installer"
echo "Command:        $COMMAND"
echo "Source:         $SOURCE_DIR"
echo "Target Project: $TARGET_PROJECT"
echo "Mode:           $MODE"
echo "==============================================="

# Define block markers for rules concatenation
START_MARKER="<!-- BEGIN:backlog-campaign-rules -->"
END_MARKER="<!-- END:backlog-campaign-rules -->"

# Helper to concatenate rules from rules/ directory
get_combined_rules() {
  local agent_dir="$1"
  echo "$START_MARKER"
  echo "# Backlog Campaign System Rules"
  echo ""
  for f in "$SOURCE_DIR/rules/"*.md; do
    echo "## File: $(basename "$f")"
    echo ""
    # Read file and replace agent dir
    cat "$f" | perl -pe "s/\\{\\{AGENT_DIR\\}\\}/$agent_dir/g"
    echo ""
  done
  echo "$END_MARKER"
}

# Helper to inject rules into a single rules file
inject_rules_file() {
  local file_path="$1"
  local agent_dir="$2"
  
  echo "Updating rules in $file_path..."
  
  # Create file if it doesn't exist
  if [ ! -f "$file_path" ]; then
    touch "$file_path"
  fi
  
  # Generate rules block
  local tmp_rules
  tmp_rules="$(mktemp)"
  get_combined_rules "$agent_dir" > "$tmp_rules"
  
  # Check if block already exists
  if grep -qF "$START_MARKER" "$file_path"; then
    # Replace existing block
    local tmp_out
    tmp_out="$(mktemp)"
    perl -e '
      my ($start, $end, $rules_file, $file) = @ARGV;
      open(my $rf, "<", $rules_file) or die $!;
      my $rules = do { local $/; <$rf> };
      close($rf);
      
      open(my $in, "<", $file) or die $!;
      my $content = do { local $/; <$in> };
      close($in);
      
      $content =~ s/\Q$start\E.*?\Q$end\E/$rules/s;
      print $content;
    ' "$START_MARKER" "$END_MARKER" "$tmp_rules" "$file_path" > "$tmp_out"
    mv "$tmp_out" "$file_path"
  else
    # Append block
    cat "$tmp_rules" >> "$file_path"
  fi
  rm "$tmp_rules"
}

# Helper to remove rules from a single rules file
remove_rules_file() {
  local file_path="$1"
  if [ -f "$file_path" ]; then
    if grep -qF "$START_MARKER" "$file_path"; then
      echo "Removing rules from $file_path..."
      local tmp_out
      tmp_out="$(mktemp)"
      perl -e '
        my ($start, $end, $file) = @ARGV;
        open(my $in, "<", $file) or die $!;
        my $content = do { local $/; <$in> };
        close($in);
        
        $content =~ s/\Q$start\E.*?\Q$end\E\n?//s;
        print $content;
      ' "$START_MARKER" "$END_MARKER" "$file_path" > "$tmp_out"
      mv "$tmp_out" "$file_path"
      # If file is now empty or only whitespace, remove it
      if [ ! -s "$file_path" ] || ! grep -q '[^[:space:]]' "$file_path"; then
        rm "$file_path"
        echo "Removed empty rules file $file_path"
      fi
    fi
  fi
}

# Helper to copy/link directory and replace placeholders
copy_or_link_dir() {
  local src="$1"
  local dest="$2"
  local agent_dir="$3"
  
  if [ -e "$dest" ]; then
    rm -rf "$dest"
  fi
  
  mkdir -p "$(dirname "$dest")"
  
  if [ "$MODE" = "symlink" ]; then
    ln -s "$src" "$dest"
    echo "Created symlink: $dest -> $src"
  else
    cp -R "$src" "$dest"
    echo "Copied directory: $dest"
    # Resolve {{AGENT_DIR}} placeholder in copied files recursively
    find "$dest" -type f -exec perl -pi -e "s/\\{\\{AGENT_DIR\\}\\}/$agent_dir/g" {} +
  fi
}

# Helper to copy/link single rule files as .mdc for Cursor
copy_or_link_rule_mdc() {
  local src="$1"
  local dest="$2"
  local agent_dir="$3"
  
  if [ -e "$dest" ]; then
    rm -f "$dest"
  fi
  
  mkdir -p "$(dirname "$dest")"
  
  if [ "$MODE" = "symlink" ]; then
    ln -s "$src" "$dest"
    echo "Created symlink: $dest -> $src"
  else
    cp "$src" "$dest"
    perl -pi -e "s/\\{\\{AGENT_DIR\\}\\}/$agent_dir/g" "$dest"
    echo "Copied file: $dest"
  fi
}

# Setup config.json in target project
setup_config() {
  local target_config="$TARGET_PROJECT/.backlog-campaign/config.json"
  if [ ! -f "$target_config" ]; then
    mkdir -p "$(dirname "$target_config")"
    cp "$SOURCE_DIR/config.json" "$target_config"
    echo "Created default campaign configuration at: $target_config"
  fi
}

# Clean config.json (only on uninstall if empty)
clean_config() {
  local target_state_dir="$TARGET_PROJECT/.backlog-campaign"
  if [ -d "$target_state_dir" ]; then
    # We do NOT delete state files (findings-ledger, queue) to prevent accidental data loss.
    # We warn the user about it.
    echo "Notice: Runtime campaign state in $target_state_dir has been preserved to avoid data loss."
  fi
}

# Install handler
do_install() {
  # 1. Setup campaign runtime configuration
  setup_config
  
  # 2. Check and install for Cursor
  if [ -z "$AGENT_LIMIT" ] || [ "$AGENT_LIMIT" = "cursor" ]; then
    if [ -d "$TARGET_PROJECT/.cursor" ] || [ "$AGENT_LIMIT" = "cursor" ]; then
      echo ">>> Configuring Cursor..."
      # Install Skill folder
      copy_or_link_dir "$SOURCE_DIR" "$TARGET_PROJECT/.cursor/skills/backlog-campaign" ".cursor"
      
      # Install Agents folder
      copy_or_link_dir "$SOURCE_DIR/agents" "$TARGET_PROJECT/.cursor/agents" ".cursor"
      
      # Install Rules as .mdc files
      mkdir -p "$TARGET_PROJECT/.cursor/rules"
      for f in "$SOURCE_DIR/rules/"*.md; do
        local filename
        filename="$(basename "$f" .md).mdc"
        copy_or_link_rule_mdc "$f" "$TARGET_PROJECT/.cursor/rules/$filename" ".cursor"
      done
    fi
  fi
  
  # 3. Check and install for Antigravity (Gemini)
  if [ -z "$AGENT_LIMIT" ] || [ "$AGENT_LIMIT" = "antigravity" ]; then
    if [ -d "$TARGET_PROJECT/.agents" ] || [ "$AGENT_LIMIT" = "antigravity" ]; then
      echo ">>> Configuring Antigravity..."
      # Install Skill folder
      copy_or_link_dir "$SOURCE_DIR" "$TARGET_PROJECT/.agents/skills/backlog-campaign" ".agents"
      
      # Inject Rules to AGENTS.md
      inject_rules_file "$TARGET_PROJECT/.agents/AGENTS.md" ".agents"
    fi
  fi
  
  # 4. Check and install for Claude Code
  if [ -z "$AGENT_LIMIT" ] || [ "$AGENT_LIMIT" = "claude" ]; then
    if [ -f "$TARGET_PROJECT/.clauderules" ] || [ -d "$TARGET_PROJECT/.claude" ] || [ "$AGENT_LIMIT" = "claude" ]; then
      echo ">>> Configuring Claude Code..."
      # Inject rules to .clauderules
      inject_rules_file "$TARGET_PROJECT/.clauderules" ".claude"
    fi
  fi
  
  # 5. Check and install for Windsurf
  if [ -z "$AGENT_LIMIT" ] || [ "$AGENT_LIMIT" = "windsurf" ]; then
    if [ -f "$TARGET_PROJECT/.windsurfrules" ] || [ "$AGENT_LIMIT" = "windsurf" ]; then
      echo ">>> Configuring Windsurf..."
      inject_rules_file "$TARGET_PROJECT/.windsurfrules" ".windsurf"
    fi
  fi
  
  # 6. Check and install for Roo Code / Cline
  if [ -z "$AGENT_LIMIT" ] || [ "$AGENT_LIMIT" = "roo" ]; then
    if [ -f "$TARGET_PROJECT/.clinerules" ] || [ "$AGENT_LIMIT" = "roo" ]; then
      echo ">>> Configuring Roo Code / Cline..."
      inject_rules_file "$TARGET_PROJECT/.clinerules" ".cline"
    fi
  fi
  
  # 7. Check and install for Copilot
  if [ -z "$AGENT_LIMIT" ] || [ "$AGENT_LIMIT" = "copilot" ]; then
    if [ -d "$TARGET_PROJECT/.github" ] || [ "$AGENT_LIMIT" = "copilot" ]; then
      echo ">>> Configuring GitHub Copilot..."
      inject_rules_file "$TARGET_PROJECT/.github/copilot-instructions.md" ".github"
    fi
  fi
  
  echo "Installation completed successfully."
}

# Uninstall handler
do_uninstall() {
  # 1. Clean campaign config warnings
  clean_config
  
  # 2. Uninstall Cursor
  if [ -z "$AGENT_LIMIT" ] || [ "$AGENT_LIMIT" = "cursor" ]; then
    if [ -d "$TARGET_PROJECT/.cursor/skills/backlog-campaign" ]; then
      echo ">>> Removing Cursor skill and agents..."
      rm -rf "$TARGET_PROJECT/.cursor/skills/backlog-campaign"
      # Only remove the agents folder if it matches our coordinator/orchestrator
      rm -f "$TARGET_PROJECT/.cursor/agents/backlog-coordinator.md"
      rm -f "$TARGET_PROJECT/.cursor/agents/backlog-orchestrator.md"
      # If agents directory is empty, remove it
      if [ -d "$TARGET_PROJECT/.cursor/agents" ] && [ -z "$(ls -A "$TARGET_PROJECT/.cursor/agents")" ]; then
        rmdir "$TARGET_PROJECT/.cursor/agents"
      fi
      
      # Remove rules
      for f in "$SOURCE_DIR/rules/"*.md; do
        local filename
        filename="$(basename "$f" .md).mdc"
        rm -f "$TARGET_PROJECT/.cursor/rules/$filename"
      done
      # If rules directory is empty, remove it
      if [ -d "$TARGET_PROJECT/.cursor/rules" ] && [ -z "$(ls -A "$TARGET_PROJECT/.cursor/rules")" ]; then
        rmdir "$TARGET_PROJECT/.cursor/rules"
      fi
    fi
  fi
  
  # 3. Uninstall Antigravity
  if [ -z "$AGENT_LIMIT" ] || [ "$AGENT_LIMIT" = "antigravity" ]; then
    if [ -d "$TARGET_PROJECT/.agents/skills/backlog-campaign" ]; then
      echo ">>> Removing Antigravity skill..."
      rm -rf "$TARGET_PROJECT/.agents/skills/backlog-campaign"
      remove_rules_file "$TARGET_PROJECT/.agents/AGENTS.md"
    fi
  fi
  
  # 4. Uninstall Claude Code
  if [ -z "$AGENT_LIMIT" ] || [ "$AGENT_LIMIT" = "claude" ]; then
    remove_rules_file "$TARGET_PROJECT/.clauderules"
  fi
  
  # 5. Uninstall Windsurf
  if [ -z "$AGENT_LIMIT" ] || [ "$AGENT_LIMIT" = "windsurf" ]; then
    remove_rules_file "$TARGET_PROJECT/.windsurfrules"
  fi
  
  # 6. Uninstall Roo Code / Cline
  if [ -z "$AGENT_LIMIT" ] || [ "$AGENT_LIMIT" = "roo" ]; then
    remove_rules_file "$TARGET_PROJECT/.clinerules"
  fi
  
  # 7. Uninstall Copilot
  if [ -z "$AGENT_LIMIT" ] || [ "$AGENT_LIMIT" = "copilot" ]; then
    remove_rules_file "$TARGET_PROJECT/.github/copilot-instructions.md"
  fi
  
  echo "Uninstallation completed successfully."
}

# Status handler
do_status() {
  echo "Checking status in $TARGET_PROJECT..."
  local installed_count=0
  
  if [ -d "$TARGET_PROJECT/.backlog-campaign" ]; then
    echo "  [FOUND] Runtime state directory: .backlog-campaign/"
  else
    echo "  [MISSING] Runtime state directory: .backlog-campaign/"
  fi
  
  # Check Cursor
  if [ -d "$TARGET_PROJECT/.cursor/skills/backlog-campaign" ]; then
    echo "  [INSTALLED] Cursor skill integration"
    installed_count=$((installed_count + 1))
  fi
  
  # Check Antigravity
  if [ -d "$TARGET_PROJECT/.agents/skills/backlog-campaign" ]; then
    echo "  [INSTALLED] Antigravity skill integration"
    installed_count=$((installed_count + 1))
  fi
  
  # Check Claude
  if [ -f "$TARGET_PROJECT/.clauderules" ] && grep -qF "$START_MARKER" "$TARGET_PROJECT/.clauderules"; then
    echo "  [INSTALLED] Claude Code rules integration"
    installed_count=$((installed_count + 1))
  fi
  
  # Check Windsurf
  if [ -f "$TARGET_PROJECT/.windsurfrules" ] && grep -qF "$START_MARKER" "$TARGET_PROJECT/.windsurfrules"; then
    echo "  [INSTALLED] Windsurf rules integration"
    installed_count=$((installed_count + 1))
  fi
  
  # Check Roo
  if [ -f "$TARGET_PROJECT/.clinerules" ] && grep -qF "$START_MARKER" "$TARGET_PROJECT/.clinerules"; then
    echo "  [INSTALLED] Roo Code / Cline rules integration"
    installed_count=$((installed_count + 1))
  fi
  
  # Check Copilot
  if [ -f "$TARGET_PROJECT/.github/copilot-instructions.md" ] && grep -qF "$START_MARKER" "$TARGET_PROJECT/.github/copilot-instructions.md"; then
    echo "  [INSTALLED] GitHub Copilot rules integration"
    installed_count=$((installed_count + 1))
  fi
  
  if [ $installed_count -eq 0 ]; then
    echo "Status: NOT INSTALLED in this project."
  else
    echo "Status: INSTALLED ($installed_count agent integrations active)."
  fi
}

# Run command
case "$COMMAND" in
  install)
    do_install
    ;;
  uninstall)
    do_uninstall
    ;;
  status)
    do_status
    ;;
esac
