# BoreSakshi Phase 9 — Verification & Data Trust

## Objective

Phase 9 turns Phase 8 rig-operator submissions into a formal human-reviewed trust pipeline. A field submission is not authoritative merely because it was authenticated, complete, or technically valid. It becomes trusted groundwater evidence only after the explicit Phase 9 review lifecycle reaches `VERIFIED`.

The production trust path is:

```text
Phase 8 authenticated rig submission
        ↓
SUBMITTED / untrusted
        ↓
Phase 9 deterministic review analysis
        ↓
admin starts review
        ↓
UNDER_REVIEW / untrusted
        ↓
manual evidence + data review
        ↓
     ┌───────────┴───────────┐
     ↓                       ↓
 VERIFIED                 REJECTED
 trusted                   untrusted
     ↓                       ↓
public/live ML/          operator can
training/ledger          request re-review
```

Phase 9 is deliberately human-reviewed. Its deterministic risk rules and operator-trust score assist reviewers; they do not auto-verify groundwater outcomes.

## Verification schema

Phase 9 uses:

```text
verificationSchemaVersion = 9.0.0
trustModelVersion          = 9.0.0
```

The authoritative operator-record states are:

- `SUBMITTED`
- `UNDER_REVIEW`
- `VERIFIED`
- `REJECTED`

## Transition rules

| Current | Allowed next state | Trigger |
|---|---|---|
| SUBMITTED | UNDER_REVIEW | Admin starts review |
| UNDER_REVIEW | VERIFIED | Admin verifies after review |
| UNDER_REVIEW | REJECTED | Admin rejects with reason |
| VERIFIED | UNDER_REVIEW | Admin reopens with reason / manual flag |
| REJECTED | UNDER_REVIEW | Admin reopens with reason |
| REJECTED | SUBMITTED | Operator requests re-review |

Direct `SUBMITTED → VERIFIED` is not allowed.

The `/start` endpoint is valid only from `SUBMITTED`. Decided records must use the dedicated reopen endpoint, which requires a reason. This prevents bypassing the review-reopen audit requirement.

## Trusted-outcome predicate

For an operator-origin drilling record to become trusted, every condition must be true:

```text
verificationStatus === VERIFIED
verified === true
flagged !== true
datasetEligibility.eligible !== false
```

Imported/government Phase 2 records keep their existing reviewed-data semantics. The Phase 9 lifecycle requirement applies specifically to operator-origin records.

## What untrusted records cannot influence

`SUBMITTED`, `UNDER_REVIEW`, `REJECTED`, or manually flagged operator records are excluded from:

- the public borewell dataset;
- nearby verified evidence used in live predictions;
- Phase 3/4 offline ML training targets;
- historical nearby-borewell features in offline feature datasets;
- verified groundwater-success/depth/geology metrics;
- prediction-accountability ledger scoring.

The feature-dataset metadata now records:

```text
phase9VerifiedLifecycleRequired = true
```

This makes the review boundary explicit in offline ML provenance.

## Deterministic suspicious-data analysis

`server/verification.js` runs versioned, explainable review checks. These are review signals, not learned anomaly probabilities.

### Severity weights

| Severity | Risk points |
|---|---:|
| info | 0 |
| low | 5 |
| medium | 12 |
| high | 25 |
| critical | 40 |

The total risk score is capped to 0–100.

Risk levels:

```text
0            clear
1–14         low
15–34        medium
35–59        high
60–100       critical
```

High or critical signals require a documented risk override before the record can be verified.

### Location/GPS checks

Signals include:

- missing GPS accuracy;
- GPS accuracy worse than 25 m;
- GPS accuracy worse than 50 m;
- GPS accuracy worse than 100 m;
- invalid/missing GPS capture timestamp;
- GPS capture timestamp later than submission time.

### Temporal checks

Signals include:

- invalid drilling date;
- outcome submitted more than 90 days after drilling;
- outcome submitted more than one year after drilling.

Delayed submission is not automatically rejected; it raises review attention.

### Evidence checks

Signals include:

- required photo evidence missing;
- evidence object without a valid SHA-256 checksum.

Phase 8 already enforces photo upload and checksum verification for new submissions. Phase 9 independently checks the stored review record so legacy/migrated operator data cannot silently bypass review expectations.

### Geology checks

Signals include:

- missing structured geological layers;
- invalid layer intervals;
- overlapping layers;
- layer intervals covering less than 85% of total depth;
- severe coverage gaps below 60%.

### Outcome checks

Signals include:

- successful record with invalid/missing water-strike depth;
- successful record with no positive measured yield;
- unusually high yield above 500 LPM;
- extreme yield above 2,000 LPM;
- dry-hole record with non-zero water strike/yield;
- extremely large drilled depth above 2,500 ft.

These thresholds are operational review flags, not claims that values outside them are geologically impossible.

### Duplicate/behavior checks

Signals include:

- duplicate ingestion fingerprint;
- another non-rejected record within 100 m on the same drilling date;
- unusually large same-date submission burst by one operator.

The duplicate checks identify records requiring human review rather than deleting or rejecting data automatically.

## Reviewer override rules

A reviewer may still verify a record with high/critical deterministic signals when field evidence justifies the decision.

That action requires:

```text
overrideRisk = true
overrideReason = non-trivial documented explanation
```

If the operator trust score is below the verification gate, verification additionally requires:

```text
overrideTrustGate = true
overrideReason = documented explanation
```

Overrides are stored on the record and in the append-only review audit.

A manual flag always blocks verification until cleared.

## Operator trust model

Phase 9 replaces the previous client-side activity indicator with a server-computed operational trust profile.

The model is versioned and deterministic. It is not a groundwater prediction model and it is not presented as a scientifically validated probability of honesty.

### Inputs

Trust uses only operator-origin records and combines:

1. reviewed-outcome reliability;
2. evidence completeness/quality;
3. anomaly/risk quality of reviewed records;
4. amount of reviewed evidence available;
5. manual-flag penalty.

### Smoothed reliability

To avoid labeling a new operator 0% or 100% after one decision, reliability uses smoothing:

```text
reliabilityPct = (verifiedCount + 2) / (reviewedCount + 4) × 100
```

### Evidence quality

Reviewed records receive evidence-quality credit for:

- photo evidence;
- checksum integrity;
- good GPS accuracy;
- structured geology;
- internally complete outcome data.

### Anomaly quality

```text
anomalyQualityPct = 100 - averageReviewedRiskScore
```

clamped to 0–100.

### Combined score

Before confidence shrinkage:

```text
raw =
  0.60 × reliabilityPct
+ 0.25 × evidenceQualityPct
+ 0.15 × anomalyQualityPct
```

Review-history confidence grows to 100% at ten reviewed records:

```text
confidence = min(reviewedCount / 10, 1)
```

The score shrinks toward a neutral 50 while evidence is sparse:

```text
score =
  50 × (1 - confidence)
+ raw × confidence
- flagPenalty
```

then clamps to 0–100.

### Trust tiers

Operators with fewer than three reviewed records are always shown as `NEW`, regardless of score.

After that:

| Score | Tier |
|---:|---|
| 85–100 | HIGH_TRUST |
| 70–84 | TRUSTED |
| 50–69 | BUILDING |
| 0–49 | WATCH |

Trust below 40 requires an explicit reviewer trust-gate override before verification.

## Human review API

### Admin

```text
GET  /api/admin/review/stats
GET  /api/admin/review/queue
GET  /api/admin/review/queue?status=SUBMITTED|UNDER_REVIEW|VERIFIED|REJECTED
GET  /api/admin/review/logs/:id
GET  /api/admin/review/logs/:id/audit
POST /api/admin/review/logs/:id/start
POST /api/admin/review/logs/:id/decision
POST /api/admin/review/logs/:id/reopen
GET  /api/admin/operators/:id/trust
```

### Operator

```text
GET  /api/operator/trust
GET  /api/borewells/:id/verification
POST /api/borewells/:id/request-review
```

Operators can request re-review only for their own rejected submissions. Re-review moves a rejected record back to `SUBMITTED`; it does not restore trust.

## Append-only verification audit

Phase 9 reuses the existing audit collection rather than adding a parallel source of truth.

Verification events use:

```text
scopeType = rig_verification
scopeId   = borewell record ID
```

Events include:

- `verification_review_started`
- `verification_approved`
- `verification_rejected`
- `verification_review_reopened`
- `operator_review_requested`
- `verification_flagged_for_review`
- `verification_flag_cleared`

Audit details can include:

- previous/next state;
- reviewer/operator identity;
- review/rejection/reopen reason;
- deterministic signal codes;
- risk score/level;
- trust score before and after decision;
- override flags and override reason;
- ledger predictions scored/reopened.

There is no Phase 9 endpoint for editing/deleting historical review events.

## Manual flags

A manual admin flag on an operator record immediately removes trust:

```text
verified = false
verificationStatus = UNDER_REVIEW
dataset eligible = false
```

Any ledger predictions previously closed by the record are reopened.

The flag transition is appended to the verification audit. Clearing the flag is also audited but does not automatically re-verify the record; an admin must issue a fresh Phase 9 decision.

## Prediction accountability interaction

A newly verified record can close an open nearby prediction only when:

1. the record is trusted under the full Phase 9 predicate;
2. the prediction is within the configured matching radius;
3. the prediction is still open; and
4. the prediction existed before the drilling outcome.

The time rule remains:

```text
prediction.createdAt <= borewell.drilledAt
```

Reopening, rejecting, or flagging a previously trusted record reopens ledger predictions linked to that borewell.

Phase 11 will expand this into the full accountability-ledger product.

## Admin UI

The new `/admin/review` screen provides:

- lifecycle counts;
- suspicious/high-risk visibility;
- lifecycle filtering;
- risk-prioritized queue;
- drilling data and GPS accuracy;
- geological layers;
- authenticated evidence links;
- deterministic signal list;
- operator trust score/tier/explanation;
- start review;
- verify/promote;
- reject with reason;
- documented risk/trust overrides;
- reopen with reason;
- flag/clear flag.

Existing operator-origin log cards route admins into this review workflow instead of exposing the old one-click Verify action.

## Operator UI

The operator dashboard now shows the server-computed Phase 9 trust profile instead of the old client-side contribution score.

Submission history displays lifecycle state:

- Submitted
- Under review
- Verified
- Rejected

Rejected records expose a re-review request action with a required explanation.

## Phase 2 compatibility

Phase 9 does not reinterpret government/imported Phase 2 records as rig submissions.

The old admin verified toggle remains available only for non-operator records so previously implemented Phase 2 review/eligibility semantics are preserved.

## Tests

Dedicated Phase 9 tests cover:

- suspicious-data detection;
- duplicate/GPS/extreme-yield signals;
- trust smoothing and reviewed-outcome response;
- allowed lifecycle transitions;
- mandatory start-review state;
- verification promotion and ledger scoring;
- high-risk override requirement;
- rejection and operator re-review request;
- lifecycle-required public/offline ML trust predicates;
- direct legacy Verify bypass prevention;
- dedicated reopen-reason gate;
- manual flag trust removal, ledger reopening and append-only audit.

The Phase 9 CI also reruns Phase 8 and Phase 7 Node regressions and builds the full React application.

## Scientific honesty boundary

The Phase 9 operator-trust score is an operational review/reliability score. It has not been scientifically calibrated as a probability that an operator or record is truthful.

Similarly, the deterministic anomaly score is a prioritization tool, not a learned fraud detector and not a groundwater-model confidence metric.

Phase 5 groundwater model metrics remain the scientific validation source for ML performance.

## Phase 10 boundary

Phase 10 — Continuous Learning may consume only Phase 9-trusted outcomes. It must preserve the review provenance and must not automatically promote a retrained groundwater model merely because new verified data exists.

Any model retraining/promotion remains human-reviewed and scientifically evaluated.

## Production boundaries carried forward

Phase 9 does not replace:

- Phase 15 production security/reliability work, including dependency vulnerability remediation;
- Phase 17 full-system testing;
- Phase 18 durable evidence storage, deployment, backup, monitoring and disaster recovery.
