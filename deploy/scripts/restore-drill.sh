#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESTIC_ENV_FILE="${RESTIC_ENV_FILE:-$ROOT/deploy/env/restic.env}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$ROOT/deploy/env/production.server.env}"
RESTIC_IMAGE="${RESTIC_IMAGE:-restic/restic:0.19.1}"
IMAGE_PREFIX="${IMAGE_PREFIX:-ghcr.io/suriyaprakash-25/boresakshi}"
: "${RELEASE_VERSION:?RELEASE_VERSION must identify the API image used for the restore drill}"

test -f "$RESTIC_ENV_FILE" || { echo "Missing RESTIC_ENV_FILE: $RESTIC_ENV_FILE" >&2; exit 2; }
test -f "$SERVER_ENV_FILE" || { echo "Missing SERVER_ENV_FILE: $SERVER_ENV_FILE" >&2; exit 2; }
command -v docker >/dev/null || { echo "docker is required" >&2; exit 2; }

restore_root="$(mktemp -d -t boresakshi-restore-drill-XXXXXX)"
trap 'rm -rf "$restore_root"' EXIT
chmod 700 "$restore_root"

echo "[phase18] restoring latest off-site snapshot into an isolated temporary directory"
docker run --rm \
  --env-file "$RESTIC_ENV_FILE" \
  -v "$restore_root:/restore" \
  "$RESTIC_IMAGE" restore latest --target /restore

latest_backup="$(find "$restore_root/data/backups" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | sort | tail -1)"
test -n "$latest_backup" || { echo "No encrypted Mongo backup found in restored snapshot" >&2; exit 3; }
test -d "$restore_root/data/rig-media" || { echo "Private rig-media tree missing from restored snapshot" >&2; exit 3; }

relative_backup="${latest_backup#$restore_root}"
echo "[phase18] decrypting and parsing restored Mongo backup in dry-run mode"
docker run --rm \
  --env-file "$SERVER_ENV_FILE" \
  -v "$restore_root:/restore:ro" \
  "${IMAGE_PREFIX}-api:${RELEASE_VERSION}" \
  node scripts/restore-backup.js "/restore${relative_backup}"

echo "[phase18] restore drill PASS: latest off-site snapshot is retrievable, rig evidence is present, and the DB backup decrypts/parses without touching a database"
