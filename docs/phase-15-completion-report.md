# BoreSakshi Phase 15 Completion Report

**Phase:** 15 — Production Security & Reliability  
**Implementation branch:** `phase-15-production-security-reliability`  
**Base branch:** `phase-11-accountability-ledger`  
**Pull request:** #12  
**Status:** Application-level Phase 15 software implementation complete and CI-verified. Phase 18 still owns production infrastructure, secret-management, durable storage, deployment and disaster-recovery operations.

## Completion decision

**Privacy boundary: PASS.**  
**Verified admin authorization: PASS.**  
**Revocable session management: PASS.**  
**Password recovery/reset: PASS.**  
**Field-operator account-verification gate: PASS.**  
**Security audit logging: PASS.**  
**Rate limiting: PASS.**  
**Strict security validation: PASS.**  
**CORS/CSRF origin protection: PASS.**  
**Secure-cookie policy: PASS.**  
**Production secret/config validation: PASS.**  
**HTTPS/security-header enforcement: PASS.**  
**Encrypted backup and verification: PASS.**  
**Guarded restore: PASS.**  
**Liveness/readiness: PASS.**  
**Protected monitoring metrics: PASS.**  
**Server high-severity production dependency audit: PASS.**  
**Web high-severity production dependency audit: PASS.**  
**Inherited Phase 7–11 Node regressions: PASS.**  
**Phase 6/7/10 ML serving/retraining regressions: PASS.**  
**Production web build: PASS.**

## Security architecture delivered

Phase 15 wraps the existing Phase 2–11 application rather than replacing it:

```text
Browser / trusted machine client
        ↓
HTTPS + allowed origin + request ID
        ↓
rate limits + unsafe-write origin guard
        ↓
HttpOnly revocable session
        ↓
role + verified-account authorization
        ↓
strict request validation
        ↓
existing BoreSakshi application flows
        ↓
append-only security/accountability audit
```

This preserves the working prediction, verification, continuous-learning and accountability behavior while adding explicit production controls around it.

## Revocable sessions

Phase 15 adds an `auth_sessions` store instead of relying on a JWT cookie alone.

Each new session has:

- random UUID session ID;
- operator ID;
- account session-security version;
- created/last-seen/expiry timestamps;
- revocation timestamp/reason;
- HMAC fingerprints of IP and user agent.

Authentication now verifies both the signed JWT and the corresponding server-side active session. A revoked, expired or security-version-mismatched session is rejected.

Password change/reset and security-sensitive account changes invalidate active sessions.

## Cookie security

Production uses:

```text
__Host-boresakshi_session
```

with:

- `HttpOnly`;
- `Secure` in production;
- `SameSite=Strict`;
- root path;
- bounded session lifetime.

The browser no longer persists authentication credentials or recovery codes in local storage. It stores only the safe operator profile needed for UI state.

## Password recovery

Self-service password recovery is now available without storing reset tokens in plaintext.

Signup creates a high-entropy recovery code in the form:

```text
BSK-XXXXX-XXXXX-XXXXX-XXXXX
```

Only its bcrypt hash is stored. The clear value is shown once to the user.

A successful password reset:

1. verifies phone + current recovery code;
2. writes the new password hash;
3. increments the account session-security version;
4. revokes active sessions;
5. invalidates the old recovery code;
6. generates a replacement recovery code shown once;
7. appends a security audit event.

Authenticated password change, recovery-code rotation, active-session listing and revoke-other-sessions flows are also implemented.

## Password policy

New/change/reset passwords require:

- 10–128 characters;
- uppercase;
- lowercase;
- number;
- special character.

Default bcrypt work factor is 12 and remains configurable within a bounded server range.

## Admin hardening

Admin authorization now requires all of:

```text
role = admin
verified = true
status = active
```

`makeAdmin.js` promotes and verifies the selected account and revokes earlier sessions so the role change does not silently elevate an already-open browser session.

Admin account status/verification changes require a documented reason and append a `security_event` audit with actor, before/after state, request ID and session-revocation result.

Account deactivation or removal of admin verification revokes affected active sessions.

## Verified field-account gate

A newly created operator account remains unverified.

Before the account may upload field evidence or submit a drilling record, it must pass the account-verification gate. Read-only dashboard/history/trust access remains available so a user can see account state without acquiring field-write authority.

This account-level verification is separate from Phase 9 verification of each drilling outcome.

## CORS / CSRF / origin protection

Unsafe cookie-authenticated browser writes are now validated against configured BoreSakshi origins using `Origin` or `Referer`.

Cross-site unsafe browser writes are rejected. Explicit Bearer machine clients are exempt because they do not rely on ambient cookie authority.

The pre-existing top-level CORS configuration still restricts browser CORS to `FRONTEND_URL`; the Phase 15 origin guard provides the security decision for cookie-authenticated writes.

## HTTPS and response hardening

Phase 15 adds:

- production HTTPS enforcement using Express/proxy protocol state;
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- `Referrer-Policy: no-referrer`;
- restrictive `Permissions-Policy`;
- `Cross-Origin-Resource-Policy: same-site`;
- restrictive API CSP;
- HSTS in production;
- `Cache-Control: no-store` on auth/admin paths.

## Production configuration gate

Production configuration validation fails closed for weak/incomplete security configuration.

Required controls include:

- sufficiently long `JWT_SECRET`;
- distinct sufficiently long `RIG_EVIDENCE_SECRET`;
- monitoring token;
- HTTPS frontend/allowed origin;
- trusted-proxy configuration;
- valid backup encryption key when configured.

The security-status endpoint reports configuration presence/state without exposing secret values.

## Request IDs and safe errors

Phase 15 gives requests a safe caller-provided ID or generated UUID and returns it through `X-Request-Id`.

Unhandled errors return generic JSON plus request ID. Server logging records method/path/error metadata rather than request bodies, passwords, reset codes or evidence tokens.

## Rate limiting

Configurable limits cover:

- general API traffic;
- authentication traffic;
- failed sign-ins per phone;
- password recovery attempts;
- prediction traffic;
- admin traffic.

Production deployments must configure `TRUST_PROXY` correctly. Shared/distributed rate-limit storage remains Phase 18 infrastructure work if the API is horizontally scaled.

## Public-data privacy

The public borewell route now returns an explicit projection of trusted verified outcomes.

It omits:

- operator ID/name;
- reviewer/admin identity;
- evidence metadata/object keys;
- GPS device metadata;
- private provenance references/import actor metadata;
- internal trust/review details;
- private geological notes.

The verified scientific/drilling fields required for map/data use remain available.

## Security audit

Phase 15 reuses the existing append-only ingestion audit store with:

```text
scopeType = security_event
```

Events include account creation, sign-in success/failure, signout, password changes/resets, recovery-code rotation, session revocation and admin account-security changes.

No Phase 15 route permits rewriting/deleting historical security events.

## Liveness and readiness

### Liveness

```text
GET /api/health/live
```

reports Node process availability without depending on Mongo or ML.

### Readiness

```text
GET /api/health/ready
```

requires MongoDB. ML readiness is reported and can be made a mandatory readiness requirement through:

```text
REQUIRE_ML_READY=YES
```

This preserves the existing explicit heuristic-fallback architecture while letting deployments choose whether ML unavailability removes the API from ready traffic.

## Monitoring

Protected Prometheus-format monitoring is available at:

```text
GET /api/internal/metrics
```

with `MONITORING_TOKEN` authentication.

Metrics include uptime, in-flight requests, memory, request counts and request-duration summaries. Route labels are deliberately coarse (`/api/admin/*`, `/api/auth/*`, etc.), preventing record IDs, coordinates or phone numbers from becoming monitoring labels.

## Backup and restore

Phase 15 adds:

```bash
npm run backup:create
npm run backup:verify -- <backup-directory>
npm run backup:restore -- <backup-directory>
```

Application Mongo collections are exported as JSONL, compressed with gzip, encrypted using AES-256-GCM and checksummed.

The manifest carries collection counts, encrypted SHA-256, compressed-plaintext SHA-256 and encryption metadata, plus its own SHA-256 sidecar.

Restore is verification-only by default. Applying a restore requires:

```text
--apply
BORESAKSHI_RESTORE_APPROVED=YES
MONGODB_RESTORE_DB=<recovery database>
```

and requires empty target collections. In-place restore into the active database is rejected unless an explicit emergency override is supplied.

## Production dependency remediation

Phase 15 CI initially surfaced real high-severity production dependency findings and did not waive them.

The lockfiles were refreshed within the repository's declared semver ranges and the resulting production dependency trees were audited before being committed.

Notable remediated server resolutions include:

```text
express    4.22.3
qs         6.16.0
ip-address 10.7.0
```

The web production router dependency was also refreshed through the audited lockfile remediation.

After remediation, both final gates pass:

```text
npm audit --omit=dev --audit-level=high
```

for `server/` and `web/`.

The Vite development-tool dependency tree may still surface advisories in an unrestricted all-dependency audit; those tools are not shipped in the production dependency tree. Phase 17 records full testing/toolchain status separately rather than hiding it.

## Tests and CI

The final runtime/security implementation head verified before this report is:

```text
33f6d00674f1073ed1ed2d19b8ea54c6fbfe4690
```

Phase 15 workflow run:

```text
34926159652 — success
```

All Phase 15 jobs passed:

- server security tests + inherited Node regressions + production server audit;
- production web build + production web audit;
- ML serving/continuous-learning security regressions.

Dedicated Phase 15 suite:

```text
9 passed
0 failed
```

ML security regression subset:

```text
12 passed
0 failed
2 dependency deprecation warnings
```

The inherited Phase 7–11 Node regression commands also passed in the same workflow.

Dedicated Phase 15 tests cover:

1. fail-closed production configuration;
2. CSRF/origin enforcement;
3. security headers/no-store behavior;
4. public borewell privacy projection;
5. backup encryption/decryption and tamper rejection;
6. admin reason/strict password-reset validation;
7. recovery-code entropy/format;
8. low-cardinality Prometheus metrics;
9. public privacy integration through the Phase 15 router.

## Production infrastructure boundary

Phase 15 application security software being complete does **not** mean production infrastructure has been deployed.

Phase 18 must still provide and verify operational controls such as:

- TLS termination;
- real trusted-proxy settings;
- managed secret storage and secret rotation;
- network/firewall policy;
- private durable rig-evidence/object storage;
- scheduled off-host encrypted backups and retention;
- restore/disaster-recovery drills against deployment infrastructure;
- shared rate-limit storage if horizontally scaled;
- centralized logs, alerts and retention;
- deployment health routing and rollback automation/runbooks.

## Final Phase 15 status

**Phase 15 application-level software implementation: COMPLETE.**  
**High-severity production dependency audit gate: PASS.**  
**Security/reliability regression gate: PASS.**  
**Phase 18 infrastructure deployment still required before production launch.**  
**PR merge: intentionally not performed — review gate remains open.**
