#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENTS_DIR="$ROOT_DIR/coral/agents"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to run the official Coralizer workflow."
  exit 1
fi

for agent in review-governor verification-bridge release-policy-guard; do
  echo "Linking Coral agent: $agent"
  (cd "$AGENTS_DIR/$agent" && npx @coral-protocol/coralizer@latest link .)
done

echo "All Relic Coral agents were submitted to Coralizer link."
