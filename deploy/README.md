# BoreSakshi Production Deployment Runbook

This directory is the Phase 18 provider-neutral production package. It is designed for a Linux Docker host behind a TLS-terminating reverse proxy/load balancer. The application containers are not intended to expose MongoDB, the ML API, Prometheus, Loki or the Node API directly to the public internet.

## Architecture

```text
Internet
  |
HTTPS / TLS termination + DNS
  |
127.0.0.1:8080 web container (nginx-unprivileged)
  | /api/*
  v
Node API (private container network)
  |                    \
  |                     -> managed/private MongoDB
  v
Python ML service (private internal network)
  |
read-only mounted reviewed Phase 10 ACTIVE artifact tree

Durable private volumes:
  - rig evidence
  - encrypted Mongo backups

Operations:
  Prometheus -> protected API metrics -> Alertmanager
  Fluent Bit -> Loki -> Grafana
  systemd timer -> encrypted local DB backup -> restic off-site repository
  monthly systemd timer -> isolated restore/decrypt rehearsal
```

## Required infrastructure before production

1. A Linux host with a supported Docker Engine and Docker Compose plugin.
2. An HTTPS public hostname and TLS-terminating load balancer/reverse proxy that forwards to `127.0.0.1:8080` and preserves `X-Forwarded-Proto: https`.
3. A managed/private MongoDB deployment with network restrictions, authentication, transport encryption and provider backups enabled. Production preflight rejects localhost MongoDB.
4. A reviewed Phase 10 ACTIVE deployment artifact tree. The ML container refuses to start unless the absolute `BORESAKSHI_DEPLOYMENT_MANIFEST` resolves to an approved checksum-valid bundle and `BORESAKSHI_PHASE6_APPROVED=YES`.
5. Durable encrypted host/block storage for the Docker volumes `boresakshi_rig_media` and `boresakshi_backups`.
6. An off-site restic 0.19.1 repository backed by independent object storage/SFTP and separate credentials.
7. A real Alertmanager receiver (PagerDuty/Slack/email/webhook/etc.) that has been test-fired successfully.
8. GitHub `staging` and `production` environments. Configure required reviewers for `production` before enabling deployment.

Do not set `RIG_MEDIA_DURABLE=YES`, `OFFSITE_BACKUP_CONFIGURED=YES`, `CENTRAL_LOGGING_CONFIGURED=YES` or `ALERT_DELIVERY_CONFIGURED=YES` until the corresponding control is genuinely installed and tested. The production startup gate treats these as operator attestations.

## Host files

Install the repository deployment bundle under `/opt/boresakshi` and keep populated secrets/config outside Git:

```text
/etc/boresakshi/
  deploy.env
  production.server.env
  production.ml.env
  restic.env
  monitoring_token
  alertmanager.yml

/var/lib/boresakshi/
  model-artifacts/       # reviewed read-only Phase 10 artifact tree on container mount
```

Use the templates under `deploy/env/`. Replace every `CHANGE_ME` value; Phase 18 preflight rejects placeholders. Files under `/etc/boresakshi` should be root-owned and mode `0600` where they contain secrets.

The value in `/etc/boresakshi/monitoring_token` must exactly match `MONITORING_TOKEN` in `production.server.env` so Prometheus can scrape the protected metrics endpoint.

## First host preparation

```bash
sudo install -d -m 700 /etc/boresakshi /opt/boresakshi /var/lib/boresakshi/model-artifacts
sudo cp deploy/env/deploy.env.example /etc/boresakshi/deploy.env
sudo cp deploy/env/production.server.env.example /etc/boresakshi/production.server.env
sudo cp deploy/env/production.ml.env.example /etc/boresakshi/production.ml.env
sudo cp deploy/env/restic.env.example /etc/boresakshi/restic.env
sudo cp deploy/monitoring/alertmanager.yml.example /etc/boresakshi/alertmanager.yml
sudo chmod 600 /etc/boresakshi/*

docker volume create boresakshi_rig_media
docker volume create boresakshi_backups
```

Initialize the off-site restic repository explicitly after configuring `/etc/boresakshi/restic.env`:

```bash
docker run --rm --env-file /etc/boresakshi/restic.env restic/restic:0.19.1 init
```

Copy the reviewed model/artifact tree into the configured `MODEL_ARTIFACT_DIR`. The active deployment pointer is expected at the path configured by `BORESAKSHI_DEPLOYMENT_MANIFEST` inside the read-only mount.

## Deployment preflight

The API production container executes `server/scripts/production-preflight.js --startup` before opening its HTTP listener. It checks the production configuration, Mongo connectivity, required ML readiness and writable durable storage. The ML container independently checks its approved deployment pointer and checksum-valid serving bundle before starting Uvicorn.

The API fails closed if any required production control is missing.

## Release flow

Phase 18 CI implements:

```text
Git push / PR
  -> full Node regression + Phase 18 contracts + production dependency audit
  -> real Mongo migration apply/idempotence/rollback test
  -> frontend tests + same-origin production build + audit
  -> full ML regression + ML production preflight tests
  -> Compose contract validation
  -> API / ML / Web Docker builds
  -> Phase 18 release gate
  -> main + DEPLOY_ENABLED=YES: publish SHA-tagged GHCR images with SBOM/provenance
  -> staging environment deploy
  -> staging external smoke test
  -> production GitHub environment approval
  -> production deploy
  -> independent production smoke test
```

Image tags are commit SHAs. `release.sh` records the last two healthy application releases and uses those immutable tags for rollback.

## Manual release

On a configured host:

```bash
cd /opt/boresakshi
set -a
source /etc/boresakshi/deploy.env
set +a
export RELEASE_VERSION=<git-commit-sha>
export IMAGE_PREFIX=ghcr.io/suriyaprakash-25/boresakshi
bash deploy/scripts/release.sh deploy
```

The deploy sequence validates Compose, pulls images, runs forward-only Phase 18 migrations, starts containers, then runs public smoke checks. A smoke failure attempts to restore the previously recorded healthy application release.

## Database migrations

The Phase 18 migration ledger is `schema_migrations`. Commands inside an API image/container are:

```bash
node migrations/runner.js status
node migrations/runner.js up
BORESAKSHI_MIGRATION_ROLLBACK_APPROVED=YES node migrations/runner.js down
```

Application rollback does not automatically execute database `down`. Phase 18 schema changes are additive/backward-compatible indexes, so an older application release can be restored while the migration remains applied. Destructive migration rollback always requires a separate explicit approval.

## Application rollback

```bash
cd /opt/boresakshi
set -a
source /etc/boresakshi/deploy.env
set +a
bash deploy/scripts/release.sh rollback
```

Rollback restores the previous immutable API/ML/web release and must pass the same readiness/public smoke checks before it is recorded healthy.

## Health and smoke checks

Container health checks cover web, API liveness and ML readiness. `smoke-test.sh` additionally checks the public deployment path:

- `/healthz`
- `/api/health/live`
- `/api/health/ready` (includes the required ML readiness gate)
- `/api/ledger`
- `/api/borewells`

The last endpoint also exercises the privacy-filtered public verified-outcome path.

## Monitoring and centralized logs

Start the observability profile with the application using `release.sh` (`OBSERVABILITY_ENABLED=YES`). Prometheus scrapes only the token-protected low-cardinality `/api/internal/metrics` endpoint. Alert rules cover scrape loss, elevated 5xx ratio, sustained latency and API memory. Alertmanager must be configured with a real receiver outside Git before `ALERT_DELIVERY_CONFIGURED=YES` is set.

Fluent Bit ships Docker JSON log streams to Loki. Grafana is bound to localhost by default and provisions Prometheus and Loki datasources. Put Grafana behind authenticated private admin access/VPN or a protected reverse proxy if it must be reachable remotely.

## Backups

The existing application backup format is retained: Mongo collections are JSONL, compressed, AES-256-GCM encrypted and checksummed. Phase 18 also includes `schema_migrations` in that backup.

A daily systemd timer can run:

```bash
sudo cp deploy/systemd/boresakshi-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now boresakshi-backup.timer
```

`backup-offsite.sh` creates and verifies the encrypted Mongo backup first, then restic encrypts/uploads both the backup volume and private rig-evidence volume to an independent off-site repository. The default retention policy keeps 7 daily, 5 weekly, 12 monthly and 3 yearly snapshots, followed by a repository data-subset check.

Monitor the systemd unit. A configured timer is not sufficient evidence of backups: verify successful snapshots and alert on timer/service failures at the host monitoring layer.

## Disaster-recovery rehearsal

Install the monthly non-destructive restore drill:

```bash
sudo cp deploy/systemd/boresakshi-restore-drill.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now boresakshi-restore-drill.timer
```

The drill restores the latest off-site restic snapshot to a temporary isolated directory, verifies rig evidence exists and uses the current API image to decrypt/parse the latest Mongo backup in dry-run mode. It does not write to MongoDB.

For an actual database restore, use the existing guarded `server/scripts/restore-backup.js`; by default it refuses in-place restore into the active database. Restore into a separate recovery database first, validate, then perform a controlled cutover.

## GitHub deployment configuration

Before setting repository variable `DEPLOY_ENABLED=YES`, configure GitHub environments `staging` and `production` and their SSH/GHCR secrets used by `.github/workflows/phase18-production-deployment.yml`. Production should require human reviewers.

Required deployment secrets include the SSH host/user/private-key/known-hosts/deploy-path and public base URL for each environment, plus a least-privilege GHCR pull user/token. The remote host keeps application/database/monitoring/restic secrets in `/etc/boresakshi`; they are never copied through the workflow bundle.

## Production sign-off

A production cutover is approved only after:

1. the Phase 18 release gate is green on the exact release SHA;
2. real reviewed ML artifacts pass ML container preflight;
3. production API preflight passes against the real MongoDB and durable volumes;
4. staging deployment and external smoke tests pass;
5. an Alertmanager test reaches the on-call receiver;
6. a successful off-site backup exists and the restore drill passes;
7. DNS/TLS, database access restrictions, encrypted storage and host patching are verified;
8. the GitHub `production` environment approval is granted.

The repository provides these controls and fails closed when verifiable application prerequisites are absent. Cloud account provisioning, DNS/TLS certificates, managed Mongo credentials, production secrets, on-call destinations and the real approved ML artifacts are external operational inputs and are intentionally not committed to source control.
