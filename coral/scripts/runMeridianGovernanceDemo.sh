#!/usr/bin/env bash
set -euo pipefail

CORAL_API_URL="${CORAL_API_URL:-http://localhost:5555}"
CORAL_AUTH_KEY="${CORAL_AUTH_KEY:-}"
RELIC_API_BASE_URL="${RELIC_API_BASE_URL:-https://relic-brown.vercel.app}"
RELIC_WORKSPACE_URL="${RELIC_WORKSPACE_URL:-https://relic-brown.vercel.app/review/meridian-billing}"
RELIC_REVIEW_REQUEST="${RELIC_REVIEW_REQUEST:-Review Meridian Grid’s proposed 7% regulatory surcharge for commercial customers above 10,000 kWh. Check for billing and ledger regression risk.}"

if [ -z "$CORAL_AUTH_KEY" ]; then
  echo "CORAL_AUTH_KEY is required to create a local Coral session."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node is required to create the Coral session request."
  exit 1
fi

echo "Creating Relic Meridian Grid Coral governance session..."
echo "Coral Console: $CORAL_API_URL/ui/console"

node "$(dirname "$0")/runMeridianGovernanceDemo.mjs" \
  "$CORAL_API_URL" \
  "$CORAL_AUTH_KEY" \
  "$RELIC_API_BASE_URL" \
  "$RELIC_WORKSPACE_URL" \
  "$RELIC_REVIEW_REQUEST"
