#!/usr/bin/env bash
set -euo pipefail

CORAL_SERVER_DIR="${CORAL_SERVER_DIR:-/tmp/relic-coral-server}"
CORAL_AUTH_KEY="${CORAL_AUTH_KEY:-}"
CORAL_BIND_PORT="${CORAL_BIND_PORT:-5555}"

if [ ! -d "$CORAL_SERVER_DIR/.git" ]; then
  echo "Coral Server checkout not found at $CORAL_SERVER_DIR"
  echo "Clone it outside this repository:"
  echo "  git clone https://github.com/Coral-Protocol/coral-server $CORAL_SERVER_DIR"
  exit 1
fi

if [ ! -x "$CORAL_SERVER_DIR/gradlew" ]; then
  echo "Coral Server Gradle wrapper is missing or not executable at $CORAL_SERVER_DIR/gradlew"
  exit 1
fi

if [ -z "$CORAL_AUTH_KEY" ]; then
  echo "CORAL_AUTH_KEY is required for local development auth."
  echo "Example:"
  echo "  CORAL_AUTH_KEY=dev-local-only $0"
  exit 1
fi

echo "Starting Coral Server from $CORAL_SERVER_DIR"
echo "Coral Console: http://localhost:$CORAL_BIND_PORT/ui/console"
echo "Server is bound to local development defaults; do not expose this auth key publicly."

cd "$CORAL_SERVER_DIR"
exec ./gradlew run --args="--auth.keys=$CORAL_AUTH_KEY --network.bind-port=$CORAL_BIND_PORT"
