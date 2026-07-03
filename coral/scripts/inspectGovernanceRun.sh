#!/usr/bin/env bash
set -euo pipefail

CORAL_API_URL="${CORAL_API_URL:-http://localhost:5555}"
CORAL_AUTH_KEY="${CORAL_AUTH_KEY:-}"
NAMESPACE="${CORAL_NAMESPACE:-relic-meridian-governance}"
SESSION_ID="${1:-}"

if [ -z "$SESSION_ID" ]; then
  echo "Usage: CORAL_AUTH_KEY=... $0 <session-id>"
  exit 1
fi

if [ -z "$CORAL_AUTH_KEY" ]; then
  echo "CORAL_AUTH_KEY is required to inspect a local Coral session."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for Coral Server inspection."
  exit 1
fi

echo "Inspecting Coral session $SESSION_ID in namespace $NAMESPACE"
curl --fail --silent --show-error \
  --header "Authorization: Bearer $CORAL_AUTH_KEY" \
  "$CORAL_API_URL/api/v1/local/session/$NAMESPACE/$SESSION_ID/extended"
echo
