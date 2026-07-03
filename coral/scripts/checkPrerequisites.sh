#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CORAL_DIR="$ROOT_DIR/coral"
CORAL_SERVER_DIR="${CORAL_SERVER_DIR:-/tmp/relic-coral-server}"

echo "Relic CoralOS prerequisite check"
echo "Current directory: $(pwd)"
echo "Repository: $ROOT_DIR"
echo "Coral Server checkout: $CORAL_SERVER_DIR"
echo

check_command() {
  local label="$1"
  local command_name="$2"
  if command -v "$command_name" >/dev/null 2>&1; then
    echo "PASS: $label: $("$command_name" --version 2>&1 | head -n 1)"
  else
    echo "MISSING: $label ($command_name)"
  fi
}

check_command "Java" java
check_command "Git" git
check_command "Python" python3
check_command "Node" node

if [ -d "$CORAL_SERVER_DIR/.git" ]; then
  echo "PASS: Coral Server checkout exists"
  if [ -x "$CORAL_SERVER_DIR/gradlew" ]; then
    echo "PASS: Coral Server Gradle wrapper is executable"
  elif [ -f "$CORAL_SERVER_DIR/gradlew" ]; then
    echo "WARN: Coral Server Gradle wrapper exists but is not executable"
  else
    echo "MISSING: Coral Server Gradle wrapper"
  fi
else
  echo "MISSING: Coral Server checkout"
  echo "Clone outside this repo when ready:"
  echo "  git clone https://github.com/Coral-Protocol/coral-server $CORAL_SERVER_DIR"
fi

if command -v npx >/dev/null 2>&1; then
  echo "PASS: npx available for @coral-protocol/coralizer"
else
  echo "MISSING: npx"
fi

if [ -f "$CORAL_DIR/agents/review-governor/coral-agent.toml" ] &&
   [ -f "$CORAL_DIR/agents/verification-bridge/coral-agent.toml" ] &&
   [ -f "$CORAL_DIR/agents/release-policy-guard/coral-agent.toml" ]; then
  echo "PASS: Relic Coral agent manifests present"
else
  echo "MISSING: one or more Relic Coral agent manifests"
fi

echo
echo "No software was installed. No Coral session was started."
