# Pilot go-live runbook

For whoever provisions the pilot. It covers what cannot be done from the repository: real accounts, a real server and real credentials. `deploy/README.md` holds the detail behind each step.

Work top to bottom. Each step has a check; don't move on until it passes.

## 1. Decide before you start

| Decision | Default | Where it's set |
|---|---|---|
| Pilot area | `10.95,77.45,11.70,78.55` (Namakkal / Tiruchengode) | `PILOT_BBOX` |
| Model or no model | No model until one is approved | See step 4 |
| Contact for privacy requests | None set | `VITE_CONTACT_EMAIL`, a build argument for the web image |
| Legal review of `/privacy` and `/terms` | Not done | Must finish before farmers use the service |
| Native-speaker review of Tamil text | Not done | `web/src/strings.js`, `web/src/screens/LegalScreen.jsx` |

## 2. Managed MongoDB

1. Create a MongoDB Atlas cluster in the Mumbai region (`ap-south-1`).
2. Create a database user for the API only, and allow only the server's IP address.
3. Turn on cloud backups.

**Check:** from the server, `mongosh "<uri>" --eval 'db.runCommand({ping:1})'` returns `ok: 1`.

## 3. Server and TLS

1. Create a Linux server with Docker and the Compose plugin.
2. Point your DNS name at it and open ports 80 and 443.
3. Install Caddy and copy `deploy/Caddyfile.example` to `/etc/caddy/Caddyfile`, with your host name.
4. Leave `TRUST_PROXY=2`. Change it only if you add or remove a proxy in front of the API.

**Check:** `https://<host>/healthz` returns `ok` once step 5 is done, with a valid certificate.

## 4. Secrets and environment

1. Copy the files in `deploy/env/*.example` to `/etc/boresakshi/` and fill them in. Generate each secret separately, for example with `openssl rand -base64 48`.
2. **If no model is approved yet:** in `production.server.env` set `PILOT_WITHOUT_MODEL=YES` and `REQUIRE_ML_READY=NO`, then export `PILOT_NO_MODEL=YES` in `deploy.env`.
3. **If a model is approved:** keep `REQUIRE_ML_READY=YES`, set `MODEL_ARTIFACT_DIR`, and follow the Phase 10 activation steps in `ml/README.md`.

Leave `RIG_MEDIA_DURABLE`, `OFFSITE_BACKUP_CONFIGURED`, `CENTRAL_LOGGING_CONFIGURED` and `ALERT_DELIVERY_CONFIGURED` as `NO` until the matching step below has passed. The API won't start in production while they are `NO`, so set each one straight after its check, then run the release.

## 5. Backups (off-site)

1. Create a storage bucket at a different provider from your server and fill in `restic.env`.
2. Install the systemd timers in `deploy/systemd/`.
3. Run one backup by hand: `systemctl start boresakshi-backup.service`.

**Check:** `restic snapshots` shows a snapshot. Then set `OFFSITE_BACKUP_CONFIGURED=YES`.

## 6. Alerts and logs

1. Copy `deploy/monitoring/alertmanager.yml.example` to `/etc/boresakshi/alertmanager.yml` and add a real receiver.
2. Start the release with observability on, then run `deploy/scripts/test-alert.sh`.

**Check:** a person confirms the alert arrived. Then set `ALERT_DELIVERY_CONFIGURED=YES`. Confirm logs appear in Grafana, then set `CENTRAL_LOGGING_CONFIGURED=YES`.

## 7. Restore drill

Do this before real data arrives, and monthly after that.

```bash
RELEASE_VERSION=<current> bash deploy/scripts/restore-drill.sh
```

That proves the off-site copy can be fetched and decrypted. Then prove a full restore into a throwaway database:

```bash
docker compose -f deploy/compose.production.yml run --rm --no-deps \
  -e BORESAKSHI_RESTORE_APPROVED=YES -e MONGODB_RESTORE_DB=BoreSakshiRestoreDrill \
  api node scripts/restore-backup.js /var/lib/boresakshi/backups/<backup-folder> --apply
```

**Check:** collection counts in `BoreSakshiRestoreDrill` match the backup manifest. Drop that database afterwards and record the date and result.

## 8. Release and first admin

```bash
RELEASE_VERSION=<sha> bash deploy/scripts/release.sh deploy
```

Then sign up the first account in the app and promote it with `node makeAdmin.js`.

**Check:** the smoke test passes. On your phone, try a location, log a drill and verify it as an admin.

## Stopping the pilot quickly

Take the public proxy down with `systemctl stop caddy`. Data stays intact. To undo a bad release, use `deploy/scripts/release.sh rollback`.
