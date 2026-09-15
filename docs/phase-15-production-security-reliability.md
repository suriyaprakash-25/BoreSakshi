# BoreSakshi Phase 15 — Production Security & Reliability

## Goal

Phase 15 hardens the existing BoreSakshi application for production without replacing its working Phase 2–11 data, ML, verification or accountability flows.

The security boundary is layered around the existing application:

```text
Browser / trusted machine client
        ↓
HTTPS + allowed origin + request ID
        ↓
rate limits + same-origin unsafe-write guard
        ↓
HttpOnly revocable session
        ↓
role + verified-account authorization
        ↓
strict request validation
        ↓
existing Phase 2–11 application logic
        ↓
append-only security/accountability audit
```

Reliability adds:

```text
liveness / readiness
       +
protected low-cardinality metrics
       +
encrypted checksummed backups
       +
dry-run-first guarded restore
```

## Production configuration gate

`server/security.js` validates deployment security configuration before the Phase 15 production router is usable.

Production requires:

- `JWT_SECRET` at least 32 characters;
- a distinct `RIG_EVIDENCE_SECRET` at least 32 characters;
- `MONITORING_TOKEN` at least 24 characters;
- at least one configured frontend/allowed origin;
- HTTPS origins;
- `TRUST_PROXY` configured behind the deployment proxy;
- a valid 32-byte base64 backup key when encrypted backup jobs are enabled.

The application does not print secret values in the security-status API.

## Browser/session model

Authentication continues to use a signed JWT as the identity assertion, but Phase 15 adds a server-side `auth_sessions` record keyed by a random UUID session ID.

Every new session records:

- session ID;
- operator ID;
- session security version;
- created/last-seen/expiry timestamps;
- revocation timestamp/reason;
- HMAC fingerprints of IP and user agent.

Raw IP addresses and raw user-agent strings are not stored in the session document.

### Cookie

Production cookie name:

```text
__Host-boresakshi_session
```

Properties:

- `HttpOnly`
- `Secure` in production
- `SameSite=Strict`
- `/` path
- configurable bounded session TTL

The frontend stores only the safe operator profile in local storage. JWT/session credentials and recovery codes are not persisted there.

### Revocation

`requireAuth` verifies:

1. signed JWT issuer/audience/expiry;
2. account still exists;
3. account is active;
4. server-side session exists;
5. session is not revoked/expired;
6. JWT/session security version equals the account security version.

Password change/reset and sensitive account state changes invalidate sessions.

## Password recovery

BoreSakshi now supports self-service recovery without storing reset credentials in plaintext.

Signup generates a high-entropy code:

```text
BSK-XXXXX-XXXXX-XXXXX-XXXXX
```

Only a bcrypt hash is stored. The clear code is shown once to the authenticated user.

Password reset requires:

- account phone number;
- current recovery code;
- a new policy-compliant password.

A successful reset:

- changes the password hash;
- increments the account session security version;
- revokes all active sessions;
- invalidates the old recovery code;
- generates a replacement recovery code shown once;
- appends a security audit event.

An authenticated user can also rotate the recovery code after entering the current password.

Admins may issue a new recovery code for an operator only through the verified admin path; the clear code is intended to be delivered through a separately verified support process and is never stored in plaintext.

## Password policy

New/change/reset passwords require:

- 10–128 characters;
- uppercase;
- lowercase;
- number;
- special character.

The server remains authoritative; client checks only improve UX.

Default bcrypt work factor is 12 and can be raised within a bounded range through environment configuration.

## Admin security

An admin session now requires:

```text
role = admin
verified = true
status = active
```

CLI promotion through `makeAdmin.js` marks the selected account as a verified admin and revokes existing sessions so the user must authenticate into the new role.

Admin operator status/verification changes require a written reason and append a `security_event` audit containing before/after state, actor and request ID.

Deactivation or removal of admin verification revokes affected sessions.

## Field-operator verification gate

A newly created operator account remains `verified=false`.

Before field evidence or a new drilling submission can be created, the account must be verified by the administration workflow. Read-only dashboard/history/trust access remains possible so the user can see account state without gaining write authority.

This account-verification gate is separate from Phase 9's verification of each submitted drilling outcome.

## CORS / CSRF / origin policy

Unsafe browser requests (`POST`, `PUT`, `PATCH`, `DELETE`) must come from a configured BoreSakshi origin through `Origin` or `Referer` validation.

Trusted machine clients using explicit `Authorization: Bearer ...` are exempt from ambient-cookie CSRF checks.

Origin-less unsafe browser writes are rejected in production unless a deployment explicitly enables the emergency compatibility flag.

The legacy top-level CORS middleware continues to constrain browser CORS to the configured frontend, while the Phase 15 same-origin guard adds the security decision for cookie-authenticated writes.

## HTTPS and security headers

Production requests through the Phase 15 stack require HTTPS according to Express/proxy protocol state.

Responses receive:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- restrictive `Permissions-Policy`
- `Cross-Origin-Resource-Policy: same-site`
- restrictive API CSP
- HSTS in production
- `Cache-Control: no-store` for auth/admin paths.

## Request IDs and error privacy

Each Phase 15 request receives a safe request ID, reusing a valid caller ID or generating a UUID. The ID is returned in `X-Request-Id` and included in safe JSON errors.

Unhandled errors are logged server-side with request ID/method/path/error code but not request bodies, passwords, evidence tokens or other secrets.

## Rate limiting

Configurable limits now cover:

- global API traffic;
- authentication traffic;
- failed sign-ins per phone;
- password recovery attempts;
- predictions;
- admin traffic.

The production deployment must configure `TRUST_PROXY` correctly so IP-based throttling receives the real client address.

Phase 18 may move rate-limit state to shared infrastructure when BoreSakshi runs more than one Node instance.

## Public data privacy

`GET /api/borewells` now returns an explicit public projection of trusted verified outcomes.

The public object intentionally omits:

- operator ID/name;
- reviewer/admin identity;
- evidence metadata/object keys;
- GPS-device metadata;
- internal flags/trust calculations;
- private source references/import actor metadata;
- geological private notes.

Public provenance is limited to safe source/license/dataset descriptors.

## Audit logs

Phase 15 reuses the append-only `ingestion_audit` storage rather than creating a disconnected audit system.

Security events use:

```text
scopeType = security_event
```

Examples include:

- account creation;
- sign-in success/failure;
- signout;
- password change/reset;
- recovery-code rotation;
- other-session revocation;
- admin security changes.

The normal database API exposes no update/delete method for audit events.

## Liveness and readiness

### Liveness

```text
GET /api/health/live
```

Answers whether the Node process is serving requests. It does not depend on Mongo or ML.

### Readiness

```text
GET /api/health/ready
```

MongoDB must be reachable. ML readiness is reported and can be made mandatory with:

```text
REQUIRE_ML_READY=YES
```

This preserves the Phase 6 explicit-fallback architecture while allowing deployments that require ML availability to fail readiness during an outage.

## Monitoring

```text
GET /api/internal/metrics
```

is protected by `MONITORING_TOKEN` and exports Prometheus text metrics for:

- process uptime;
- in-flight requests;
- process memory;
- request totals by method/coarse route/status class;
- average/max request duration by method/coarse route.

Routes are deliberately bucketed (`/api/admin/*`, `/api/auth/*`, etc.) so user IDs/coordinates/record identifiers never become metric labels.

## Backups

Phase 15 adds:

```bash
npm run backup:create
npm run backup:verify -- <backup-directory>
npm run backup:restore -- <backup-directory>
```

The backup covers application Mongo collections including `auth_sessions`.

Each collection is:

1. serialized as JSONL without Mongo `_id`;
2. gzip compressed;
3. encrypted with AES-256-GCM;
4. written with encrypted SHA-256 and compressed-plaintext SHA-256 provenance.

The manifest itself receives a SHA-256 sidecar.

### Restore safety

Restore defaults to a verification-only dry run.

Actual restore additionally requires:

```text
--apply
BORESAKSHI_RESTORE_APPROVED=YES
MONGODB_RESTORE_DB=<separate recovery database>
```

The target collections must be empty. Restoring over the active database is rejected unless an explicit emergency override is supplied.

This supports recovery rehearsal without silently destroying production data.

## Dependency security gate

Phase 15 CI runs production dependency audits at `high` severity for both server and web dependencies. Phase 15 is not considered complete while that gate reports a high/critical production vulnerability.

## Phase boundary

Phase 15 provides application-level security/reliability controls, but production readiness still depends on Phase 18 infrastructure choices such as:

- TLS termination and trusted proxy configuration;
- network policy/firewalls;
- secrets manager/rotation;
- durable private rig-media/object storage;
- scheduled off-host backups and retention;
- shared rate-limit storage for horizontal scaling;
- managed monitoring/alerts/log retention;
- deployment rollback/disaster-recovery runbooks.

Phase 17 must verify the full server/web/ML/cross-stack behavior before Phase 18 deployment.
