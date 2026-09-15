# Phase 8 — Production Rig-Operator Data Collection

## Objective

Phase 8 turns BoreSakshi's existing authenticated `/log` screen into the production data-capture contract for completed drilling jobs without allowing newly submitted field data to become trusted groundwater evidence automatically.

The governing flow is:

```text
authenticated rig operator
  → capture actual drill-point GPS + accuracy
  → enter drilling date/outcome/depth/strike/yield
  → enter ordered geological layers
  → upload photo evidence (+ optional video)
  → server validates and binds authenticated provenance
  → record stored as SUBMITTED / unverified / dataset-ineligible
  → admin can inspect evidence and use the existing Verify action
  → only then can the outcome become trusted/public/ledger/ML evidence
```

Phase 9 owns the richer verification state machine and production trust score. Phase 16 owns offline-first synchronization. Phase 18 owns deployment-grade durable media infrastructure.

## Field contract

An operator submission requires:

- authenticated operator identity — taken from the server session, never trusted from client JSON
- latitude / longitude from device geolocation
- GPS accuracy in metres
- GPS capture timestamp
- actual drilling date
- total drilled depth
- success/failure outcome
- water-strike depth when successful
- measured yield (LPM) when successful
- dry-hole strike/yield fixed at zero
- one or more ordered geological layers
- at least one photo evidence item
- optional videos
- optional place/village label
- UI language

Each geological layer records:

```json
{
  "fromFt": 0,
  "toFt": 120,
  "material": "weathered rock",
  "notes": "optional observation"
}
```

Validation rejects layers that overlap, have inverted ranges, or extend below total drilled depth.

## Record provenance

Phase 8 operator records use `rigSubmissionSchemaVersion = "8.0.0"` and include:

```text
operatorId
operatorName
operatorVerifiedAtSubmission
submittedAt
gps.accuracyM
gps.capturedAt
gps.source = device_geolocation
provenance.sourceType = operator
provenance.identitySource = authenticated_session
provenance.evidenceSha256[]
```

The operator identity is derived from the authenticated HTTP-only session. A client cannot submit another operator ID/name through the drilling payload.

## Initial trust state

Every newly submitted Phase 8 operator outcome starts as:

```text
verificationStatus = SUBMITTED
verified = false
datasetEligibility.eligible = false
datasetEligibility.status = awaiting_operator_submission_verification
ledgerScoredAt = null
```

This is the central Phase 8 safety boundary.

A raw operator submission does **not** immediately become:

- public borewell evidence
- live nearby-well ML evidence
- a training target
- nearby evidence in an offline training feature row
- a groundwater success/depth/geology metric
- a scored actual outcome in the public prediction ledger

## Evidence upload and storage

### Endpoints

```text
GET    /api/operator/evidence/config
POST   /api/operator/evidence
DELETE /api/operator/evidence/:id
GET    /api/borewells/:borewellId/evidence/:evidenceId
```

Evidence upload requires authentication.

Supported types:

- JPEG
- PNG
- WebP
- MP4
- WebM

Limits:

- photos: 10 MB each, maximum 8 per submission
- videos: 50 MB each, maximum 2 per submission
- at least one photo is mandatory

### Integrity and ownership

Each uploaded object receives:

- random evidence ID
- SHA-256 content checksum
- byte size
- MIME type
- original filename (sanitized)
- authenticated operator ID
- creation time
- private storage key

Before a borewell record is accepted, every upload token is revalidated for:

- HMAC integrity
- 24-hour expiry
- matching authenticated operator
- uniqueness
- file existence
- byte-size match
- SHA-256 content match

Tokens cannot be reused after evidence is bound to a borewell because the object is moved from `unbound/` into the submitted borewell's storage directory.

### Storage configuration

Development/default storage uses a private filesystem path:

```text
RIG_MEDIA_DIR=./rig-media
```

`server/rig-media/` is gitignored.

This is an application storage interface, not a claim that ephemeral local disks are appropriate for production. Phase 18 deployment must mount durable private storage (or replace the storage adapter with managed object storage) and configure backup/retention.

Unsubmitted evidence can be cleaned with:

```bash
npm run rig:evidence:cleanup
```

Default unbound retention is 24 hours via `RIG_EVIDENCE_UNBOUND_MAX_AGE_HOURS`.

## Operator UI

The existing `/log` screen is evolved rather than replaced.

It now provides:

- signed-in operator identity
- automatic high-accuracy GPS capture
- visible GPS accuracy
- read-only captured coordinates
- drilling-date picker
- Water found / Dry hole outcome
- total depth
- water-strike depth and yield for successful wells
- editable geological layer list
- quick rock/strata chips
- evidence photo/video upload
- upload/remove state
- retained Tamil/English voice dictation where supported
- pending-verification confirmation after submission

The confirmation explicitly states that a submission will not affect ML/training data or the public ledger until verification.

## Existing assignment workflow

The previous assignment workflow remains intact.

If the authenticated operator has a pending assigned site within 2 km of the actual captured drill location, the assignment is marked `logged` and retains the submitted borewell ID.

The assignment location is useful context, but Phase 8 still captures the device's actual drill-point coordinates before submission.

## Transitional verification gate

Phase 8 deliberately retains the existing admin `Verify` / `Unverify` interaction instead of implementing Phase 9 early.

For operator-origin records:

```text
SUBMITTED + Verify
  → VERIFIED
  → verified=true
  → datasetEligibility.eligible=true
  → status=verified_operator_outcome
```

Unverify returns an operator record to the pending/untrusted state.

Flagging an operator record makes it dataset-ineligible.

Critically, the Phase 8 transition logic is scoped only to operator-origin records. Phase 2 government/imported records retain their existing review and dataset-eligibility semantics.

Phase 9 will replace this transitional toggle with a formal lifecycle such as:

```text
SUBMITTED → UNDER_REVIEW → VERIFIED / REJECTED
```

and a proper operator/data trust model.

## Public data trust boundary

`GET /api/borewells` now exposes only records satisfying:

```text
verified === true
flagged !== true
datasetEligibility.eligible !== false
```

Pending operator submissions remain visible to:

- the submitting operator through `/api/borewells/mine`
- administrators through `/api/admin/logs`

but not to the public borewell dataset.

## Live prediction trust boundary

The existing Phase 6/7 prediction path already applies the same trusted-record predicate before sending nearby evidence to Python.

Phase 8 therefore prevents a new submission from manipulating a live farmer prediction before verification.

## Offline/training trust boundary

`server/featurePipeline.js` now explicitly recognizes operator-origin records.

An operator record can become a Phase 3/4 training target or historical nearby feature only when it is:

- verified
- unflagged
- dataset eligible

The generated feature-dataset leakage policy records:

```text
phase8VerifiedOperatorOutcomesRequired = true
```

This prevents unverified field submissions from leaking into later offline retraining even if a future pipeline reads directly from the canonical borewell collection.

## Metrics trust boundary

The web metric helpers now distinguish operational activity from groundwater evidence.

May include pending submissions:

- total submissions
- submissions this week
- submission volume per month

Verified/trusted records only:

- success / water-strike rate
- average depth
- strata/geology distribution
- legacy contribution/trust indicator

Phase 9 owns the replacement production trust score.

## Prediction-accountability ledger

Submission alone does not close predictions.

After a record becomes trusted, Phase 8 can close an open nearby prediction only when:

1. the outcome is verified/unflagged/eligible;
2. the outcome is within the configured nearby radius;
3. the prediction has not already been closed; and
4. the prediction's `createdAt` is not later than the recorded drilling outcome timestamp.

This temporal condition prevents a historical drill from being used to "score" a prediction that did not exist until after the drilling had already happened.

If a previously trusted operator outcome is later unverified or otherwise loses trust, predictions closed by that borewell are reopened.

Phase 11 will expand this foundation into the full accountability-ledger product.

## Evidence review

The operator who owns a log and administrators can retrieve its evidence through the authenticated evidence endpoint. The admin log card exposes evidence links alongside:

- GPS accuracy
- drilling date
- depth / strike / yield
- geological layer intervals
- pending/verified status
- flags

Evidence is not exposed by the public borewell endpoint.

## API compatibility

The Phase 8 router is mounted before the old borewell/admin handlers. This means Phase 8 is authoritative for matching routes while the prior implementation remains readable in the branch for review/rollback comparison.

Existing Phase 7 prediction APIs and farmer response fields are unchanged.

## Tests

Run:

```bash
cd server
npm run test:phase8
npm run test:phase7
```

Phase 8 tests cover:

- GPS/geology/outcome validation
- authenticated identity provenance
- initial untrusted state
- evidence ownership, checksum verification and token consumption
- public trusted-only filtering
- verify-before-ledger scoring
- unverify/reopen behavior
- temporal ledger scoring
- offline training/evidence trust gates
- verified-only groundwater/trust metrics
- preservation of Phase 2 imported-data verification semantics

The dedicated workflow also production-builds the full farmer/operator/admin React application.

## Security and deployment boundary

Phase 8 adds the application-level data/evidence controls needed for the roadmap, but it does not replace Phase 15 or Phase 18.

Current CI's `npm ci` audit output reports dependency vulnerabilities in both server and web dependency trees. These are explicitly carried as a Phase 15 production-security blocker and must be triaged/remediated before BoreSakshi v1 production launch.

Likewise, durable media storage, backups, deployment secrets, retention, monitoring, container/runtime configuration and disaster recovery remain Phase 18 responsibilities.

## Phase boundary

Phase 8 is complete when:

- the structured authenticated collection workflow exists;
- submissions are evidence-backed;
- new records start untrusted;
- untrusted records cannot influence prediction/training/public metrics/ledger;
- an admin can inspect evidence and use the transitional review gate;
- tests and frontend production build pass.

Phase 9 begins from these `SUBMITTED` records and implements the complete verification/data-trust system.
