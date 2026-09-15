#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/compose.production.yml}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$ROOT/deploy/env/production.server.env}"
ML_ENV_FILE="${ML_ENV_FILE:-$ROOT/deploy/env/production.ml.env}"
RESTIC_ENV_FILE="${RESTIC_ENV_FILE:-$ROOT/deploy/env/restic.env}"
RIG_MEDIA_VOLUME="${RIG_MEDIA_VOLUME:-boresakshi_rig_media}"
BACKUP_VOLUME="${BACKUP_VOLUME:-boresakshi_backups}"
RESTIC_IMAGE="${RESTIC_IMAGE:-restic/restic:0.19.1}"

for command in docker; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 2; }
done
for file in "$COMPOSE_FILE" "$SERVER_ENV_FILE" "$ML_ENV_FILE" "$RESTIC_ENV_FILE"; do
  test -f "$file" || { echo "Required file not found: $file" >&2; exit 2; }
done

export SERVER_ENV_FILE ML_ENV_FILE RIG_MEDIA_VOLUME BACKUP_VOLUME
: "${RELEASE_VERSION:?RELEASE_VERSION must identify the deployed release}"
: "${MODEL_ARTIFACT_DIR:?MODEL_ARTIFACT_DIR must point to the mounted reviewed ML artifact tree}"

echo "[phase18] creating encrypted Mongo backup inside the durable backup volume"
docker compose -f "$COMPOSE_FILE" run --rm --no-deps api npm run backup:create

echo "[phase18] verifying newest encrypted Mongo backup before off-site transfer"
docker compose -f "$COMPOSE_FILE" run --rm --no-deps api sh -ec '
  latest="$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -print | sort | tail -1)"
  test -n "$latest"
  npm run backup:verify -- "$latest"
'

restic() {
  docker run --rm \
    --env-file "$RESTIC_ENV_FILE" \
    -v "$RIG_MEDIA_VOLUME:/data/rig-media:ro" \
    -v "$BACKUP_VOLUME:/data/backups:ro" \
    "$RESTIC_IMAGE" "$@"
}

if ! restic snapshots --latest 1 >/dev/null 2>&1; then
  echo "Off-site restic repository is unavailable or not initialized. Initialize it explicitly before enabling OFFSITE_BACKUP_CONFIGURED=YES." >&2
  exit 3
fi

echo "[phase18] sending encrypted DB backups and private rig evidence to off-site repository"
restic backup /data/backups /data/rig-media --tag boresakshi --tag "$RELEASE_VERSION"
restic forget --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --keep-yearly 3 --prune
restic check --read-data-subset=5%

echo "[phase18] off-site backup completed and repository check passed"
