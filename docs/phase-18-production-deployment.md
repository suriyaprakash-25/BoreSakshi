# Phase 18 — Production Deployment & DevOps

## Purpose

Phase 18 is the final BoreSakshi v1 roadmap phase. It converts the Phase 2–17 application into a deployable, observable and recoverable production package while preserving every scientific, verification, privacy and human-approval boundary already established.

It does not auto-activate an ML candidate, invent production infrastructure, or merge previous review-gated branches. Production remains fail-closed until external infrastructure and secrets are genuinely configured.

## Delivery architecture

```text
Git / Pull Request
  |
  +--> backend regression + Phase 18 production contract tests + npm audit
  +--> real MongoDB migration apply/idempotence/rollback test
  +--> frontend component tests + production build + npm audit
  +--> full ML regression + production preflight tests
  +--> production/staging Compose validation
  +--> API / ML / Web container builds
  |
  v
Phase 18 release gate
  |
  | main + DEPLOY_ENABLED=YES only
  v
SHA-tagged GHCR images + provenance/SBOM
  |
  v
GitHub staging environment
  |
  +--> deploy exact SHA
  +--> migrations up
  +--> API/ML startup preflights
  +--> public smoke tests
  |
  v
GitHub production environment approval
  |
  v
production exact-SHA deploy + smoke tests
```

## Production runtime topology

`deploy/compose.production.yml` provides three application containers:

- `web`: React/Vite build served by unprivileged Nginx on container port 8080. Host binding defaults to `127.0.0.1`, so a TLS reverse proxy/load balancer is expected in front of it.
- `api`: non-root Node 22 container. It is not host-published, is read-only except durable rig-media/backup volumes and `/tmp`, has capability dropping, no-new-privileges and resource/PID limits.
- `ml`: non-root Python 3.12 container on an internal-only network. Its reviewed artifact tree is mounted read-only and the service is not host-published.

MongoDB is intentionally not included in the production Compose topology. Production expects a managed/private MongoDB service with independent access controls, TLS and provider backups.

The staging override adds an isolated MongoDB 7 container so staging can validate migrations and application behavior without touching production data.

## Fail-closed production preflight

`server/productionConfig.js` and `server/scripts/production-preflight.js` add a stronger deployment boundary above Phase 15 security validation.

Production API startup is rejected when any of these conditions is true:

- invalid/missing `DEPLOYMENT_ENV` or release identifier;
- placeholder/example endpoint or secret values remain;
- production MongoDB points at localhost;
- backup encryption key is absent;
- `REQUIRE_ML_READY` is not `YES`;
- rig evidence or backup locations are not absolute durable paths;
- durable evidence storage has not been attested/tested;
- off-site backup has not been configured/tested;
- centralized log shipping has not been configured/tested;
- an alert receiver has not been configured/test-fired;
- MongoDB is unreachable;
- required ML health/readiness fails;
- durable storage cannot be written.

Operational attestation flags default to `NO` in production templates. Compose does not override them to `YES`.

## ML production preflight

`ml/production_preflight.py` runs before Uvicorn. Production/staging require:

- a valid deployment environment and release version;
- `BORESAKSHI_PHASE6_APPROVED=YES`;
- an absolute mounted `BORESAKSHI_DEPLOYMENT_MANIFEST`;
- `BundleManager.from_environment()` to resolve a ready checksum-valid approved bundle.

Therefore a missing or unreviewed Phase 3/4/5/10 artifact chain cannot silently become production ML simply because Phase 18 deployment code exists.

## Graceful process lifecycle

`server/production.js` wraps the existing Node application without rewriting the API. It tracks the HTTP server created by the existing application and, on SIGTERM/SIGINT, stops accepting new requests, closes idle connections, drains active HTTP work and exits before `GRACEFUL_SHUTDOWN_MS` (default 15 seconds). Unhandled production exceptions/rejections use the same controlled shutdown path with a failing exit code.

Docker allows a 30-second API stop grace period, leaving room for the application drain deadline.

## Versioned database migrations

Phase 18 adds a general `schema_migrations` ledger and runner:

- `node migrations/runner.js status`
- `node migrations/runner.js up`
- `node migrations/runner.js down`

The Phase 18 migration is additive and reversible and creates named operational indexes for trusted borewell outcomes, accountability status, operator security lookup and audit activity.

CI tests the migration against a real MongoDB 7 instance, applies it, verifies status, re-applies it to prove idempotence, explicitly rolls it back with `BORESAKSHI_MIGRATION_ROLLBACK_APPROVED=YES`, then verifies the final status.

Application rollback never performs an automatic DB `down`. That avoids coupling a code rollback to a potentially destructive database rollback. A database rollback is always a separate explicit operation.

## Immutable release and rollback

`deploy/scripts/release.sh` uses commit-SHA image tags. It:

1. validates deployment inputs/Compose;
2. pulls the exact images;
3. applies forward migrations;
4. starts the release;
5. runs public smoke tests;
6. records the current/previous healthy releases only after smoke success.

If a new release fails smoke validation, the script attempts to restore the previously recorded healthy application version. The explicit `rollback` action also restores that immutable version and must pass smoke validation.

## Smoke contract

`deploy/scripts/smoke-test.sh` checks the actual public deployment path:

- web liveness;
- API liveness;
- API readiness including required ML readiness;
- public accountability ledger;
- privacy-filtered verified borewell endpoint.

A release is not recorded healthy unless all checks pass.

## Persistent evidence storage

Phase 8 evidence continues to use the existing checksum-verified private filesystem adapter, but Phase 18 mounts it on an external durable Docker volume instead of container ephemeral storage. The application preflight verifies write access and requires explicit `RIG_MEDIA_DURABLE=YES` only after durable/encrypted host storage is installed.

The evidence service remains authenticated/private and preserves its existing HMAC ownership, byte-size and SHA-256 integrity checks.

## Backup and disaster recovery

The Phase 15 encrypted backup format remains authoritative. Phase 18 extends it to include `schema_migrations`.

`deploy/scripts/backup-offsite.sh`:

1. creates a fresh AES-256-GCM encrypted/checksummed Mongo backup in the durable backup volume;
2. verifies the newest backup before transfer;
3. uses restic 0.19.1 to encrypt and upload both DB backups and private rig evidence to an independent off-site repository;
4. applies a 7-daily / 5-weekly / 12-monthly / 3-yearly retention policy;
5. runs a repository data-subset integrity check.

Systemd templates schedule this daily.

`deploy/scripts/restore-drill.sh` restores the latest off-site snapshot into an isolated temporary location, confirms rig evidence exists and invokes the exact API image to decrypt/parse the DB backup in dry-run mode. It never writes to MongoDB. A monthly systemd timer is supplied for this recovery rehearsal.

Actual data recovery still uses the guarded Phase 15 restore process and defaults to a separate recovery database rather than in-place overwrite.

## Observability

`deploy/compose.observability.yml` provides:

- Prometheus scraping the protected Phase 15 metrics endpoint with a file-backed bearer token;
- Alertmanager for real operational alert delivery;
- Loki for centralized log retention;
- Fluent Bit shipping Docker log streams to Loki;
- Grafana with Prometheus/Loki datasources, bound to localhost by default.

Alert rules cover API scrape failure, sustained server-error ratio, API latency and high RSS memory.

The deployment package deliberately does not include blackbox-exporter because the latest stable image reviewed during Phase 18 had an unresolved security-rebuild concern. Public endpoint availability is instead verified by Docker health checks, API readiness and release/external smoke tests.

## CI/CD security boundary

`.github/workflows/phase18-production-deployment.yml` runs release validation on PRs and the Phase 18 branch. Publishing and deployment are more restrictive:

- packages are published only from `main` when repository variable `DEPLOY_ENABLED=YES`;
- images use immutable commit-SHA tags and request BuildKit provenance/SBOM metadata;
- staging deployment must succeed before production can begin;
- production uses the GitHub `production` environment, allowing required-reviewer approval outside the workflow;
- SSH uses administrator-provisioned known-host entries rather than `ssh-keyscan` trust-on-first-use;
- application/database/monitoring/restic secrets remain on the target host under `/etc/boresakshi` and are not copied in the deployment bundle.

## Production readiness meaning

After Phase 18, the **codebase and deployment package** can be production-ready when the release gate is green and the real operational inputs satisfy preflight. This is different from claiming a live production deployment has occurred.

Repository code cannot create the user's DNS zone, TLS certificate, managed Mongo account, production credentials, on-call target, encrypted server disk, off-site object-storage account or reviewed real model artifacts. Phase 18 therefore supplies explicit gates that prevent an operator from accidentally treating those missing external prerequisites as ready.

The detailed host procedure and sign-off checklist are in `deploy/README.md`.
