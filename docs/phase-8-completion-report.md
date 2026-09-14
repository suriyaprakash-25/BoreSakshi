# BoreSakshi Phase 8 Completion Report

**Phase:** 8 — Production Rig-Operator Data Collection  
**Implementation branch:** `phase-8-rig-operator-data`  
**Base branch:** `phase-7-real-prediction-activation`  
**Pull request:** #8  
**Status:** Software implementation complete and CI-verified. Phase 9 remains responsible for the full verification/trust lifecycle; Phase 15 and Phase 18 retain production security and durable-deployment obligations.

## Goal completed

Phase 8 upgrades the existing authenticated rig-operator workflow into a structured, evidence-backed drilling-outcome collection system while enforcing the critical rule that a newly submitted field record is **not trusted automatically**.

The implemented flow is:

```text
authenticated rig operator
  → actual drill-point device GPS + accuracy
  → drilling date
  → success/failure + total depth + water strike + yield
  → ordered geological layers
  → required photo evidence (+ optional video)
  → strict server validation + authenticated provenance
  → SUBMITTED / unverified / dataset-ineligible
  → admin transitional review gate
  → verified + unflagged + eligible
  → trusted public / ML / training / ledger evidence
```

The existing operator, admin, farmer, Phase 7 prediction and accountability flows were evolved incrementally rather than rewritten.

## Scope completed

| Phase 8 capability | Result |
|---|---|
| Existing authenticated `/log` screen retained | Complete |
| Authenticated operator identity | Complete — server-derived |
| Actual device GPS capture | Complete |
| GPS accuracy | Complete |
| GPS capture timestamp | Complete |
| Actual drilling date | Complete |
| Success / failure | Complete |
| Total drilled depth | Complete |
| Water-strike depth | Complete |
| Measured yield | Complete |
| Ordered geological layers | Complete |
| Geological notes | Complete |
| Required photo evidence | Complete |
| Optional video evidence | Complete |
| Existing voice input retained | Complete |
| Assignment-to-log workflow preserved | Complete |
| Strict backend schema validation | Complete |
| Invalid calendar date rejection | Complete |
| Future drilling-date rejection | Complete |
| Future GPS timestamp rejection | Complete |
| Wet/dry outcome consistency checks | Complete |
| Geological overlap/depth checks | Complete |
| Evidence MIME allow-list | Complete |
| Evidence size limits | Complete |
| SHA-256 evidence integrity | Complete |
| Operator-bound upload tokens | Complete |
| Evidence token expiry | Complete |
| Token reuse prevention after binding | Complete |
| Authenticated owner/admin evidence viewing | Complete |
| Orphan upload cleanup command | Complete |
| New records start `SUBMITTED` | Complete |
| New records start `verified=false` | Complete |
| New records start dataset-ineligible | Complete |
| Pending records excluded from public borewell API | Complete |
| Pending records excluded from live prediction evidence | Complete |
| Pending records excluded from offline training targets | Complete |
| Pending records excluded from offline nearby-well features | Complete |
| Pending records excluded from groundwater outcome metrics | Complete |
| Pending records excluded from trust-related metrics | Complete |
| Submission does not score ledger | Complete |
| Ledger scoring only after trusted verification | Complete |
| Temporal prediction-vs-outcome check | Complete |
| Unverify/untrust reopens linked predictions | Complete |
| Phase 2 imported-data semantics preserved | Complete |
| Phase 7 prediction regressions preserved | Complete |
| Phase 8 CI | Passing |
| Production web build | Passing |

## Structured operator record

Phase 8 operator submissions are explicitly versioned with:

```text
rigSubmissionSchemaVersion = 8.0.0
```

The server stores:

- latitude / longitude
- GeoJSON point
- GPS accuracy
- GPS capture timestamp
- GPS source (`device_geolocation`)
- actual drilling date
- total depth
- structured geology/layers
- water-strike depth
- measured yield
- success/failure
- authenticated operator ID and name
- whether the operator account was verified at submission time
- evidence metadata/checksums
- submission timestamp
- provenance
- verification/trust state
- ledger-scoring state

The client does not supply authoritative operator identity. It comes from the authenticated HTTP-only session.

## Backend validation

The Phase 8 schema rejects invalid or internally inconsistent records, including:

- missing/invalid coordinates
- missing GPS accuracy or timestamp
- future GPS timestamps
- impossible/future drilling dates
- non-positive total depth
- missing geological layers
- layer end not deeper than layer start
- overlapping geological layers
- layers extending below total drilled depth
- successful well without a positive water strike
- water strike deeper than total depth
- successful well without positive yield
- dry hole with nonzero water strike/yield
- missing evidence upload references

The browser also guides these inputs, but the server remains authoritative for direct API clients.

## Evidence pipeline

### Supported formats

```text
image/jpeg
image/png
image/webp
video/mp4
video/webm
```

Limits:

- photos: 10 MB each
- videos: 50 MB each
- maximum 8 photos
- maximum 2 videos
- minimum 1 photo per drilling submission

### Upload integrity

`POST /api/operator/evidence` creates an unbound private evidence object with:

- random evidence ID
- type/kind
- sanitized original filename
- byte size
- SHA-256 checksum
- storage object key
- authenticated operator ID
- creation timestamp

The server returns a 24-hour HMAC-signed upload token.

Before a final drilling submission is accepted, each evidence token is rechecked for:

1. token signature,
2. expiry,
3. authenticated operator ownership,
4. duplicate use in the submission,
5. file existence,
6. byte-size integrity,
7. SHA-256 content integrity.

After acceptance, evidence is moved from `unbound/` into the submitted borewell's private storage namespace, so the old token cannot be reused to create another drilling record.

### Evidence access

Bound evidence is not part of the public borewell payload.

It is available only through authenticated evidence retrieval to:

- the operator who owns the log, or
- an administrator.

The admin/operator log cards expose the evidence alongside GPS, drilling date, layers, depth/strike/yield and verification status.

## Unbound evidence cleanup

Phase 8 adds:

```bash
cd server
npm run rig:evidence:cleanup
```

The default cleanup threshold is 24 hours and is configurable through:

```text
RIG_EVIDENCE_UNBOUND_MAX_AGE_HOURS
```

## Trust boundary

Every new Phase 8 operator submission starts as:

```text
verificationStatus = SUBMITTED
verified = false
datasetEligibility.eligible = false
datasetEligibility.status = awaiting_operator_submission_verification
ledgerScoredAt = null
```

A raw submission therefore cannot become authoritative groundwater evidence simply by being uploaded.

## Public borewell boundary

`GET /api/borewells` now exposes trusted records only:

```text
verified === true
flagged !== true
datasetEligibility.eligible !== false
```

Pending operator records remain visible in authenticated operator history and the admin console.

## Live prediction boundary

The existing Phase 6/7 prediction path already filters nearby borewell evidence using the same trusted predicate.

Because Phase 8 records are initially unverified/ineligible, they cannot affect a farmer prediction until they pass review.

## Offline ML/training boundary

Phase 8 also closes the offline leakage path.

`server/featurePipeline.js` now recognizes operator-origin records. Such records can become either a training target or nearby historical feature evidence only when they are:

```text
verified
unflagged
dataset eligible
```

The generated dataset metadata now records:

```text
phase8VerifiedOperatorOutcomesRequired = true
```

This ensures a future retraining run cannot accidentally ingest pending operator data even if it reads directly from the canonical borewell collection.

## Metrics boundary

Operational metrics may include submitted/pending work:

- total submissions
- submissions this week
- submissions by month

Groundwater/trust outcome metrics use trusted records only:

- water-strike/success rate
- average depth
- strata distribution
- the retained legacy contribution/trust indicator

The operator dashboard/history wording now distinguishes `submission` from `verified outcome`.

Phase 9 owns the production trust-score redesign.

## Transitional Phase 8 verification

The existing admin Verify/Unverify interaction is intentionally retained so Phase 8 does not implement Phase 9 prematurely.

For **operator-origin** records:

```text
SUBMITTED + Verify
  → verificationStatus=VERIFIED
  → verified=true
  → datasetEligibility.eligible=true
  → datasetEligibility.status=verified_operator_outcome
```

Unverify returns the operator record to an untrusted pending state.

Flagging an operator record makes it ineligible.

### Phase 2 compatibility

The Phase 8 eligibility transition is explicitly scoped to operator-origin records.

Government/imported Phase 2 records keep their established ingestion/review/dataset-eligibility semantics when the legacy admin verified flag is changed. Phase 8 therefore does not rewrite already-working imported-data governance.

## Accountability-ledger correction

Submission itself never closes predictions.

After an operator outcome becomes trusted, a nearby open prediction can be scored only when the prediction actually existed before the observed drilling outcome:

```text
prediction.createdAt <= borewell.drilledAt
```

If either timestamp cannot be verified, the prediction is not scored.

This prevents historical drilling outcomes from retroactively scoring predictions that were generated after the drilling already happened.

If a record that previously closed predictions later loses trust through unverify/flagging, predictions tied to that borewell are reopened.

Phase 11 will build the richer accountability-ledger product on this foundation.

## Operator UI completed

The existing `/log` screen now provides:

- authenticated operator identity
- automatic high-accuracy GPS capture
- visible GPS accuracy
- read-only captured lat/lng
- actual drilling date picker
- Water found / Dry hole toggle
- total drilled depth
- strike depth/yield when water is found
- dynamic geological-layer rows
- quick strata chips
- evidence photo/video upload
- upload/remove state
- existing Tamil/English speech input when supported
- `Submit for verification` action
- explicit pending-verification completion screen

The completion screen no longer claims the ledger was updated immediately. It states that the record affects public/ML/training/ledger evidence only after verification.

## Assignment compatibility

The previous assigned-site workflow is preserved.

A pending assignment within 2 km of the captured drill location can be marked logged with the new borewell ID. The assignment's coordinates do not replace actual device GPS capture.

## API additions

```text
GET    /api/operator/evidence/config
POST   /api/operator/evidence
DELETE /api/operator/evidence/:id
GET    /api/borewells/:borewellId/evidence/:evidenceId
```

`POST /api/borewells`, `GET /api/borewells` and `PATCH /api/admin/logs/:id` are intercepted by the incremental Phase 8 router before the older handlers. The legacy handlers remain in source for review/rollback comparison rather than being deleted in a rewrite.

## Verification performed

Runtime code was verified on commit:

```text
4663e947003cb23f581dcc6cee34073a51f05d92
```

### Phase 8 Rig Operator Data workflow

Result: **success**.

### Phase 8 trust-boundary suite

```text
13 passed
0 failed
0 skipped
```

The suite covers:

1. preservation of Phase 2 imported-data eligibility semantics,
2. operator-specific pending/trusted transitions,
3. future drilling-date rejection,
4. future GPS-time rejection,
5. invalid-calendar-date rejection,
6. GPS/geology/outcome schema consistency,
7. server-derived operator identity + untrusted initial state,
8. evidence token ownership/checksum/consumption,
9. public trusted-only borewell filtering,
10. verify-before-ledger + reopen-on-unverify,
11. prediction-after-outcome temporal rejection,
12. offline training/nearby-feature trust enforcement,
13. pending/flagged exclusion from groundwater/trust metrics.

### Phase 7 Node regression suite

```text
10 passed
0 failed
0 skipped
```

This verifies Phase 8 did not break the ML client, retry/circuit behavior, real-prediction compatibility mapping, Phase 7 prediction contract, or explicit heuristic fallback guarantees.

### Server syntax checks

Passing:

- `server/index.js`
- `server/phase8Routes.js`
- `server/rigData.js`
- `server/rigEvidence.js`
- `server/scripts/cleanup-rig-evidence.js`

### Web production build

The complete farmer/operator/admin Vite application built successfully:

```text
1872 modules transformed
production build success
```

### Preceding-phase compatibility

On the same Phase 8 runtime code head:

- Phase 4 ML workflow: **success**
- Phase 5 Scientific Evaluation workflow: **success**
- Phase 6 ML Service workflow: **success**
- Phase 7 Real Prediction Engine workflow: **success**

## CI findings corrected during implementation

### 1. Compatibility fixture exposed by Phase 2 protection

After Phase 8 was restricted correctly to operator-origin trust transitions, two ledger test fixtures did not identify themselves as operator records. CI failed because the new compatibility safeguard correctly treated them as legacy/imported records.

The fixtures were corrected by adding Phase 8 operator provenance. Runtime compatibility behavior was kept intact.

### 2. Temporal validation fixture exposed by UTC runner

After backend future-GPS validation was added, the static valid GPS timestamp in the test was a few hours ahead of the GitHub runner's UTC clock.

The fixture was corrected to a fixed past timestamp. The strict runtime future-time validation was retained.

Both corrections demonstrate that CI was used as an actual gate rather than bypassed.

## Dependency/security findings

Phase 8 CI's dependency installation reported current npm audit findings:

### Server dependency tree

```text
4 vulnerabilities
3 moderate
1 high
```

### Web dependency tree

```text
8 vulnerabilities
3 moderate
5 high
```

These findings do not make the Phase 8 feature implementation incomplete, but they **are a BoreSakshi v1 production blocker** that must be triaged/remediated in Phase 15 — Production Security & Reliability.

No claim is made here that `npm audit fix` can be applied blindly; Phase 15 should review the actual advisories, dependency paths, breaking-change risk and compensating controls.

GitHub Actions also emits the existing non-blocking warning that `actions/checkout@v4`, `actions/setup-node@v4` and related actions target deprecated Node 20 internally and are being forced onto Node 24 by the runner. This should be cleaned up as CI dependencies are modernized.

## Durable evidence-storage boundary

The Phase 8 evidence implementation defaults to a private local filesystem path so the application contract is complete and testable.

This is **not** a claim that ephemeral container storage is acceptable for BoreSakshi production.

Phase 18 must provide:

- durable/private media storage or a managed object-store adapter,
- backups,
- retention policy,
- deployment secrets,
- access controls at infrastructure level,
- monitoring,
- disaster recovery/restore testing.

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

The structured operator-data collection path is now ready for review and supplies the untrusted `SUBMITTED` records that Phase 9 needs.

BoreSakshi v1 is **not yet production-ready** because the agreed critical path still includes:

```text
Phase 9  — full verification & data trust
Phase 10 — continuous learning / reviewed model promotion
Phase 11 — strengthened accountability ledger
Phase 15 — production security & reliability
Phase 17 — full-system testing
Phase 18 — deployment / durable storage / DevOps
```

Additionally, actual real-model production activation remains dependent on the reviewed real Phase 3/4/5 artifact chain described in Phase 7.

## Phase 8 completion decision

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
