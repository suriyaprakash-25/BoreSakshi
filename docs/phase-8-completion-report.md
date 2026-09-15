# BoreSakshi Phase 8 Completion Report

**Phase:** 8 — Production Rig-Operator Data Collection  
**Implementation branch:** `phase-8-rig-operator-data`  
**Base branch:** `phase-7-real-prediction-activation`  
**Pull request:** #8  
**Status:** Software implementation complete and CI-verified. Phase 9 owns the full verification/trust lifecycle; Phase 15 and Phase 18 retain security and durable-deployment obligations.

> Final CI note: the complete Phase 4–8 workflow stack passed on the report-restoration head `a0b0ead0c7fcd44c2661f7aa654d09ad8847e4d2`. This annotation is documentation-only; runtime code was last changed on `4663e947003cb23f581dcc6cee34073a51f05d92`.

## Goal completed

Phase 8 evolves the existing authenticated rig-operator workflow into a structured, evidence-backed drilling-outcome collection system without rewriting the working application.

The implemented flow is:

```text
authenticated rig operator
  → actual drill-point device GPS + accuracy
  → actual drilling date
  → success/failure + depth + water strike + yield
  → ordered geological layers
  → required photo evidence (+ optional video)
  → strict server validation + authenticated provenance
  → SUBMITTED / unverified / dataset-ineligible
  → transitional admin review gate
  → verified + unflagged + eligible
  → trusted public / ML / future-training / ledger evidence
```

The central Phase 8 rule is now enforced throughout BoreSakshi: **a newly submitted field record is not trusted automatically**.

## Scope completed

| Capability | Result |
|---|---|
| Existing `/log` operator workflow preserved | Complete |
| Authenticated operator identity | Complete — server-derived |
| Device GPS coordinates | Complete |
| GPS accuracy + capture timestamp | Complete |
| Actual drilling date | Complete |
| Success/failure outcome | Complete |
| Total drilled depth | Complete |
| Water-strike depth | Complete |
| Measured yield | Complete |
| Ordered geological layers | Complete |
| Geological notes | Complete |
| Required photo evidence | Complete |
| Optional video evidence | Complete |
| Existing Tamil/English voice input retained | Complete |
| Assigned-site flow preserved | Complete |
| Strict backend validation | Complete |
| Evidence SHA-256 integrity | Complete |
| Operator-bound evidence tokens | Complete |
| Evidence expiry and replay prevention | Complete |
| Authenticated owner/admin evidence review | Complete |
| Orphan upload cleanup | Complete |
| New records start `SUBMITTED` | Complete |
| New records start unverified | Complete |
| New records start dataset-ineligible | Complete |
| Pending records excluded from public data | Complete |
| Pending records excluded from live ML evidence | Complete |
| Pending records excluded from offline ML targets/features | Complete |
| Pending records excluded from groundwater/trust metrics | Complete |
| Submission does not score accountability ledger | Complete |
| Ledger scoring only after trusted verification | Complete |
| Temporal prediction-before-outcome rule | Complete |
| Unverify/untrust reopens linked predictions | Complete |
| Phase 2 imported-data semantics preserved | Complete |
| Phase 7 prediction contract preserved | Complete |
| Phase 8 CI | Passing |
| Production web build | Passing |

## Structured record contract

Operator records are explicitly identified by:

```text
rigSubmissionSchemaVersion = 8.0.0
provenance.sourceType = operator
provenance.identitySource = authenticated_session
```

The stored record includes:

- latitude / longitude and GeoJSON location;
- device GPS accuracy and capture timestamp;
- actual drilling date;
- total depth;
- structured geological layers;
- water-strike depth;
- measured yield;
- success/failure;
- authenticated operator ID/name;
- operator-account verification state at submission time;
- evidence metadata and SHA-256 checksums;
- submission timestamp;
- provenance;
- verification/trust state;
- ledger-scoring state.

The client cannot choose the authoritative operator ID/name. Identity is bound from the authenticated HTTP-only session.

## Backend validation

The Phase 8 request schema rejects malformed or inconsistent field records, including:

- invalid coordinates;
- missing GPS accuracy/timestamp;
- future GPS capture timestamps;
- invalid or future drilling dates;
- non-positive total depth;
- missing geological layers;
- layer end <= layer start;
- overlapping layers;
- layers deeper than total drilled depth;
- successful well without positive water-strike depth;
- water strike deeper than total depth;
- successful well without positive yield;
- dry hole with non-zero water strike/yield;
- missing evidence references.

The UI guides these constraints, but the server remains authoritative for direct API clients.

## Evidence pipeline

### Supported evidence

```text
image/jpeg
image/png
image/webp
video/mp4
video/webm
```

Limits:

- photos: 10 MB each;
- videos: 50 MB each;
- maximum 8 photos;
- maximum 2 videos;
- minimum 1 photo per drilling submission.

### Upload integrity and ownership

Authenticated uploads receive:

- random evidence ID;
- type/kind;
- sanitized original filename;
- byte size;
- SHA-256 checksum;
- private storage key;
- authenticated operator ID;
- creation timestamp.

The server returns a 24-hour HMAC-signed upload token. Before final submission, every token is revalidated for:

1. signature integrity;
2. expiry;
3. authenticated operator ownership;
4. duplicate/reuse within the submission;
5. file existence;
6. byte-size integrity;
7. SHA-256 content integrity.

After a drilling record is accepted, evidence is moved from the unbound upload namespace into that borewell's private namespace. The old token therefore cannot be reused to create another drilling record.

### Evidence access

Evidence is not included in the public borewell dataset. Bound evidence can be retrieved only by:

- the operator who owns the record; or
- an administrator.

The operator/admin record card now exposes evidence alongside GPS accuracy, drilling date, depth/strike/yield, geology layers and review state.

### Cleanup

Unsubmitted evidence cleanup is available through:

```bash
cd server
npm run rig:evidence:cleanup
```

Default unbound retention is 24 hours, configurable through `RIG_EVIDENCE_UNBOUND_MAX_AGE_HOURS`.

## Untrusted-by-default state

Every Phase 8 operator submission starts as:

```text
verificationStatus = SUBMITTED
verified = false
datasetEligibility.eligible = false
datasetEligibility.status = awaiting_operator_submission_verification
ledgerScoredAt = null
```

This prevents a raw field upload from immediately becoming authoritative groundwater evidence.

## Public/live/training trust boundaries

### Public borewell data

`GET /api/borewells` exposes only trusted outcomes:

```text
verified === true
flagged !== true
datasetEligibility.eligible !== false
```

Pending submissions remain visible to their operator and administrators, but not to the public borewell dataset.

### Live prediction evidence

The existing Phase 6/7 prediction path already applies the same trusted-record predicate. Because a Phase 8 submission begins unverified/ineligible, it cannot affect a farmer prediction before verification.

### Offline ML/training

`server/featurePipeline.js` now explicitly recognizes operator-origin records. They can become either:

- training targets; or
- historical nearby-well feature evidence

only when verified, unflagged and dataset eligible.

The generated dataset leakage policy records:

```text
phase8VerifiedOperatorOutcomesRequired = true
```

This closes the offline contamination path as well as the live API path.

## Metrics trust boundary

Operational activity can still include pending work:

- total submissions;
- submissions this week;
- submissions per month.

Groundwater/trust outcome metrics now use trusted records only:

- water-strike/success rate;
- average depth;
- geological/strata distribution;
- the retained legacy contribution/trust indicator.

The operator dashboard/history now distinguishes **submission** from **verified outcome**. Phase 9 owns the replacement production trust-score system.

## Transitional verification gate

Phase 8 intentionally retains the existing admin Verify/Unverify action rather than implementing Phase 9 prematurely.

For operator-origin records:

```text
SUBMITTED + Verify
  → verificationStatus=VERIFIED
  → verified=true
  → datasetEligibility.eligible=true
  → datasetEligibility.status=verified_operator_outcome
```

Unverify returns the record to an untrusted pending state. Flagging an operator record makes it ineligible.

### Phase 2 compatibility

This eligibility transition is scoped only to operator-origin records. Government/imported Phase 2 records retain their existing ingestion/review/dataset-eligibility semantics, so Phase 8 does not overwrite previously working imported-data governance.

## Accountability-ledger correction

Submission itself never closes a prediction.

After an operator outcome becomes trusted, a nearby open prediction can be scored only when the prediction genuinely existed before the recorded drilling outcome:

```text
prediction.createdAt <= borewell.drilledAt
```

If timestamps are unverifiable, the prediction is skipped rather than manufacturing accountability data.

If a previously trusted record later loses trust, predictions closed by that borewell are reopened. Phase 11 will build the richer accountability-ledger product on this foundation.

## Operator UI completed

The existing `/log` screen now provides:

- authenticated operator identity;
- automatic high-accuracy GPS capture;
- visible GPS accuracy;
- read-only captured coordinates;
- actual drilling date picker;
- Water found / Dry hole outcome;
- total depth;
- water-strike depth and yield when successful;
- dynamic geological-layer rows;
- quick strata chips;
- photo/video evidence upload and removal;
- retained Tamil/English voice dictation where supported;
- `Submit for verification` action;
- explicit pending-verification completion screen.

The completion screen correctly states that the submission will affect public/ML/training/ledger evidence only after verification.

## Assignment compatibility

The existing assigned-site workflow is preserved. A pending assignment within 2 km of the actual captured drill location can be marked logged with the submitted borewell ID. Assignment coordinates do not replace actual device GPS capture.

## API additions

```text
GET    /api/operator/evidence/config
POST   /api/operator/evidence
DELETE /api/operator/evidence/:id
GET    /api/borewells/:borewellId/evidence/:evidenceId
```

The incremental Phase 8 router intercepts `POST /api/borewells`, public `GET /api/borewells`, and the transitional admin-log update before the older handlers. Legacy code remains readable for review/rollback comparison rather than being deleted in a rewrite.

## Verification performed

Runtime code was last changed on:

```text
4663e947003cb23f581dcc6cee34073a51f05d92
```

The subsequent commits are documentation-only. The full workflow stack was rerun after the completion documentation was added and passed:

- **Phase 8 Rig Operator Data — success**
- **Phase 7 Real Prediction Engine — success**
- **Phase 6 ML Service — success**
- **Phase 5 Scientific Evaluation — success**
- **Phase 4 ML — success**

### Phase 8 tests

```text
13 passed
0 failed
0 skipped
```

Coverage includes:

1. Phase 2 imported-data compatibility;
2. operator-specific verification transitions;
3. future drilling-date rejection;
4. future GPS-time rejection;
5. impossible calendar-date rejection;
6. GPS/geology/outcome consistency;
7. server-derived operator identity and untrusted initial state;
8. evidence ownership/checksum/token-consumption behavior;
9. public trusted-only filtering;
10. verify-before-ledger and reopen-on-unverify;
11. prediction-after-outcome temporal rejection;
12. offline training/nearby-feature trust gates;
13. pending/flagged exclusion from groundwater/trust metrics.

### Phase 7 regression tests

```text
10 passed
0 failed
0 skipped
```

This verifies Phase 8 did not break the ML client, retries/circuit breaker, real-prediction mapping, Phase 7 prediction contract, or explicit heuristic fallback policy.

### Web production build

The full farmer/operator/admin Vite application builds successfully (`1872 modules transformed`).

## CI findings corrected during implementation

Two useful fixture issues were caught by CI and corrected without weakening runtime safeguards:

1. After the Phase 8 compatibility guard was scoped to operator-origin records, two ledger fixtures lacked operator provenance. The fixtures were corrected; the Phase 2 compatibility protection remained.
2. After future-GPS validation was added, a static test timestamp was ahead of the GitHub runner's UTC clock. The fixture was moved into the past; strict runtime time validation remained.

## Dependency/security findings

Phase 8 CI currently reports:

```text
server: 4 vulnerabilities (3 moderate, 1 high)
web:    8 vulnerabilities (3 moderate, 5 high)
```

These are not ignored. They are explicitly carried as a **Phase 15 production-security blocker**. Phase 15 must inspect the actual advisories/dependency paths and remediate them safely rather than blindly applying dependency upgrades.

GitHub Actions also emits the existing non-blocking warning that several official actions still target deprecated Node 20 internally and are being forced to Node 24 by the runner. CI action modernization belongs in the production hardening work.

## Durable evidence-storage boundary

Phase 8 defaults to private local filesystem storage so the application/evidence contract is implemented and testable. This is **not** a claim that ephemeral container disks are suitable for production.

Phase 18 must provide durable/private media storage or a managed object-store adapter plus backup, retention, deployment secrets, infrastructure access controls, monitoring and disaster-recovery/restore procedures.

## Files added

- `server/rigData.js`
- `server/rigEvidence.js`
- `server/phase8Routes.js`
- `server/scripts/cleanup-rig-evidence.js`
- `server/test/phase8.test.js`
- `server/test/phase8-compat.test.js`
- `server/test/phase8-time.test.js`
- `.github/workflows/phase8-rig-data.yml`
- `docs/phase-8-rig-operator-data.md`
- `docs/phase-8-completion-report.md`

## Files extended

- `server/index.js`
- `server/validation.js`
- `server/package.json`
- `server/.env.example`
- `server/.gitignore`
- `server/featurePipeline.js`
- `web/src/api.js`
- `web/src/screens/OperatorLog.jsx`
- `web/src/screens/Dashboard.jsx`
- `web/src/screens/History.jsx`
- `web/src/components/LogItem.jsx`
- `web/src/metrics.js`
- root `README.md`

## Production status

**Phase 8 software implementation is complete.**

The structured operator-data collection path now supplies the untrusted `SUBMITTED` records that Phase 9 needs.

BoreSakshi v1 is not yet production-ready because the agreed critical path still includes:

```text
Phase 9  — full verification & data trust
Phase 10 — continuous learning / reviewed model promotion
Phase 11 — strengthened accountability ledger
Phase 15 — production security & reliability
Phase 17 — full-system testing
Phase 18 — deployment / durable storage / DevOps
```

Actual real-model activation also still depends on the reviewed real Phase 3/4/5 artifact chain described in Phase 7.

## Completion decision

**Structured collection gate: PASS.**  
**Evidence integrity/ownership gate: PASS.**  
**Untrusted-by-default gate: PASS.**  
**Live prediction contamination gate: PASS.**  
**Offline training contamination gate: PASS.**  
**Groundwater/trust metrics contamination gate: PASS.**  
**Ledger verification/temporal gate: PASS.**  
**Phase 2 compatibility gate: PASS.**  
**Phase 7 regression gate: PASS.**  
**Web production-build gate: PASS.**  
**Inherited Phase 4–7 compatibility: PASS.**  
**Phase 15 dependency-security gate: PENDING.**  
**Phase 18 durable production storage/deployment: PENDING.**

The next BoreSakshi v1 phase is **Phase 9 — Verification & Data Trust**.
