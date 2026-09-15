#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-${DEPLOY_BASE_URL:-}}"
: "${BASE_URL:?Pass the public HTTPS base URL or set DEPLOY_BASE_URL}"
BASE_URL="${BASE_URL%/}"
ATTEMPTS="${SMOKE_ATTEMPTS:-30}"
SLEEP_SECONDS="${SMOKE_SLEEP_SECONDS:-2}"

request() {
  local path="$1"
  curl --fail --silent --show-error \
    --connect-timeout 5 --max-time 15 \
    -H 'Accept: application/json' \
    "$BASE_URL$path"
}

wait_for() {
  local path="$1"
  local name="$2"
  for attempt in $(seq 1 "$ATTEMPTS"); do
    if body="$(request "$path" 2>/dev/null)"; then
      echo "[phase18] smoke PASS: $name ($path)"
      printf '%s\n' "$body" | head -c 500
      printf '\n'
      return 0
    fi
    echo "[phase18] waiting for $name ($attempt/$ATTEMPTS)" >&2
    sleep "$SLEEP_SECONDS"
  done
  echo "[phase18] smoke FAIL: $name ($path)" >&2
  return 1
}

wait_for "/healthz" "web liveness"
wait_for "/api/health/live" "API liveness"
wait_for "/api/health/ready" "API readiness including required ML"
wait_for "/api/ledger" "public accountability ledger"
wait_for "/api/borewells" "privacy-filtered verified borewell feed"

echo "[phase18] all release smoke tests passed for $BASE_URL"
