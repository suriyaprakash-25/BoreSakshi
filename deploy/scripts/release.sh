#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/compose.production.yml}"
OBSERVABILITY_FILE="${OBSERVABILITY_FILE:-$ROOT/deploy/compose.observability.yml}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$ROOT/deploy/env/production.server.env}"
ML_ENV_FILE="${ML_ENV_FILE:-$ROOT/deploy/env/production.ml.env}"
STATE_DIR="${STATE_DIR:-$ROOT/deploy/.release-state}"
CURRENT_FILE="$STATE_DIR/current"
PREVIOUS_FILE="$STATE_DIR/previous"
DEPLOY_BASE_URL="${DEPLOY_BASE_URL:-}"
OBSERVABILITY_ENABLED="${OBSERVABILITY_ENABLED:-YES}"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

require_file() {
  test -f "$1" || { echo "Required deployment file missing: $1" >&2; exit 2; }
}

require_common() {
  command -v docker >/dev/null || { echo "docker is required" >&2; exit 2; }
  docker compose version >/dev/null
  require_file "$COMPOSE_FILE"
  require_file "$SERVER_ENV_FILE"
  require_file "$ML_ENV_FILE"
  : "${MODEL_ARTIFACT_DIR:?MODEL_ARTIFACT_DIR must point to the reviewed mounted Phase 10 artifact tree}"
  : "${DEPLOY_BASE_URL:?DEPLOY_BASE_URL must be the public deployment URL}"
  export SERVER_ENV_FILE ML_ENV_FILE MODEL_ARTIFACT_DIR DEPLOY_BASE_URL
  export RIG_MEDIA_VOLUME="${RIG_MEDIA_VOLUME:-boresakshi_rig_media}"
  export BACKUP_VOLUME="${BACKUP_VOLUME:-boresakshi_backups}"
  docker volume create "$RIG_MEDIA_VOLUME" >/dev/null
  docker volume create "$BACKUP_VOLUME" >/dev/null
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

compose_with_observability() {
  if [[ "$OBSERVABILITY_ENABLED" == "YES" ]]; then
    docker compose -f "$COMPOSE_FILE" -f "$OBSERVABILITY_FILE" --profile observability "$@"
  else
    compose "$@"
  fi
}

validate_release() {
  local release="$1"
  [[ "$release" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || {
    echo "Unsafe RELEASE_VERSION: $release" >&2
    exit 2
  }
}

deploy_version() {
  local release="$1"
  export RELEASE_VERSION="$release"
  validate_release "$release"
  echo "[phase18] validating compose topology for $release"
  compose_with_observability config --quiet
  echo "[phase18] pulling immutable release images for $release"
  compose_with_observability pull
  echo "[phase18] applying forward-only additive database migrations"
  compose run --rm --no-deps api npm run migrate:up
  echo "[phase18] starting release $release"
  compose_with_observability up -d --remove-orphans
  "$ROOT/deploy/scripts/smoke-test.sh" "$DEPLOY_BASE_URL"
}

case "${1:-status}" in
  deploy)
    require_common
    : "${RELEASE_VERSION:?RELEASE_VERSION is required for deploy}"
    new_release="$RELEASE_VERSION"
    current="$(cat "$CURRENT_FILE" 2>/dev/null || true)"
    deploy_version "$new_release" || {
      echo "[phase18] release $new_release failed smoke validation" >&2
      if [[ -n "$current" ]]; then
        echo "[phase18] restoring previously healthy app release $current" >&2
        deploy_version "$current" || true
      fi
      exit 4
    }
    if [[ -n "$current" && "$current" != "$new_release" ]]; then
      printf '%s\n' "$current" > "$PREVIOUS_FILE"
    fi
    printf '%s\n' "$new_release" > "$CURRENT_FILE"
    chmod 600 "$CURRENT_FILE" "$PREVIOUS_FILE" 2>/dev/null || true
    echo "[phase18] release $new_release is healthy and recorded as current"
    ;;

  rollback)
    require_common
    previous="$(cat "$PREVIOUS_FILE" 2>/dev/null || true)"
    current="$(cat "$CURRENT_FILE" 2>/dev/null || true)"
    : "${previous:?No previous healthy release is recorded}"
    echo "[phase18] rolling application containers back from ${current:-unknown} to $previous"
    echo "[phase18] database migration DOWN is intentionally NOT automatic; Phase 18 migrations are backward-compatible and rollback requires a separate explicit approval gate"
    deploy_version "$previous"
    if [[ -n "$current" ]]; then printf '%s\n' "$current" > "$PREVIOUS_FILE"; fi
    printf '%s\n' "$previous" > "$CURRENT_FILE"
    echo "[phase18] rollback to $previous passed smoke validation"
    ;;

  status)
    echo "current=$(cat "$CURRENT_FILE" 2>/dev/null || echo none)"
    echo "previous=$(cat "$PREVIOUS_FILE" 2>/dev/null || echo none)"
    ;;

  *)
    echo "Usage: $0 [deploy|rollback|status]" >&2
    exit 2
    ;;
esac
