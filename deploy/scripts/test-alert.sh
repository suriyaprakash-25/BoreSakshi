#!/usr/bin/env bash
# Fires a real test alert through Alertmanager. Set ALERT_DELIVERY_CONFIGURED=YES
# only after a person confirms it arrived on the on-call channel.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

docker compose \
  -f "$ROOT/deploy/compose.production.yml" \
  -f "$ROOT/deploy/compose.observability.yml" \
  --profile observability \
  exec -T alertmanager amtool alert add \
  alertname=BoreSakshiTestAlert severity=test \
  --annotation=summary="BoreSakshi test alert: please confirm receipt" \
  --alertmanager.url=http://127.0.0.1:9093

echo "[pilot] test alert sent. It should arrive within about a minute."
