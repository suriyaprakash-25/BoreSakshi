# BoreSakshi Phase 11 Completion Report

**Phase:** 11 — Prediction Accountability Ledger  
**Implementation branch:** `phase-11-accountability-ledger`  
**Base branch:** `phase-10-continuous-learning`  
**Pull request:** #11  
**Status:** Software implementation complete and CI-verified. Live performance metrics are observational and become meaningful only as persisted predictions later receive Phase 9-verified real outcomes.

## Completion decision

**Persisted-prediction snapshot gate: PASS.**  
**Model/deployment provenance gate: PASS.**  
**Verified-outcome scoring gate: PASS.**  
**Pre-drilling temporal accountability gate: PASS.**  
**Success correctness gate: PASS.**  
**Brier/calibration gate: PASS.**  
**Water-strike error gate: PASS.**  
**Yield error gate: PASS.**  
**Regional-performance gate: PASS.**  
**Model-version-performance gate: PASS.**  
**Heuristic-fallback isolation gate: PASS.**  
**Outcome-reopen/removal gate: PASS.**  
**Append-only accountability-audit gate: PASS.**  
**Backward-compatibility gate: PASS.**  
**Public-ledger privacy gate: PASS.**  
**Phase 9 regression gate: PASS.**  
**Phase 7 prediction regression gate: PASS.**  
**Web production-build gate: PASS.**

## Prediction accountability snapshot

Every persisted prediction now receives a Phase 11 accountability object containing:

- prediction ID;
- prediction date;
- exact model version;
- deployment ID when Phase 10 deployment-pointer serving is active;
- prediction source;
- feature version;
- immutable feature-snapshot reference;
- issued success probability;
- issued ≥50% success call;
- issued water-strike interval + midpoint;
- issued yield interval + midpoint;
- current outcome state;
- current verification state;
- scoring/reopen timestamps and metrics.

Preview requests using `save=false` are intentionally not counted as persisted accountability records.

## Model identity

A trained ML result is grouped by its exact `modelVersion`.

Heuristic outage/coverage fallback is grouped separately as:

```text
heuristic_fallback
```

Fallback outcomes therefore cannot inflate or reduce the measured performance of a trained model version.

## Verified outcome scoring

When an eligible nearby Phase 9 outcome reaches the trusted VERIFIED state, BoreSakshi scores every open matched prediction that existed before drilling.

The temporal rule remains:

```text
prediction.createdAt <= borewell.drilledAt
```

The scored record stores:

- actual success/failure;
- total drilled depth;
- actual water-strike depth;
- measured yield;
- drilling/outcome dates;
- verification status;
- match distance;
- region key;
- scoring timestamp.

## Classification correctness

Success classification remains transparent:

```text
successProbability >= 50% → predicted success
successProbability <  50% → predicted dry
```

`successCorrect` records whether that issued call matches the verified outcome.

The threshold is also exposed in ledger methodology so reporting cannot silently change its definition.

## Brier score and calibration

For every verified score:

```text
Brier contribution = (issued probability - actual binary outcome)^2
```

Phase 11 aggregates the mean Brier score overall and by model/region/source.

Calibration is calculated in ten probability bins. Non-empty bins expose:

- probability range;
- sample count;
- mean issued probability;
- observed success rate;
- calibration gap.

Expected Calibration Error is the sample-weighted average calibration gap.

## Water-strike error

Because the public model contract returns a depth interval, the ledger uses its issued midpoint as the accountability point estimate:

```text
predictedStrikeFt = (issuedMin + issuedMax) / 2
```

For verified successful wells:

```text
depthErrorFt         = predictedStrikeFt - actualWaterStrikeFt
depthAbsoluteErrorFt = abs(depthErrorFt)
```

Dry holes are excluded from water-strike MAE/RMSE because no real water-strike depth exists.

The ledger reports count, MAE, RMSE and signed bias.

## Yield error

Yield uses the same issued-interval midpoint convention:

```text
predictedYieldLpm = (issuedMin + issuedMax) / 2
```

Then:

```text
yieldErrorLpm         = predictedYieldLpm - actualYieldLpm
yieldAbsoluteErrorLpm = abs(yieldErrorLpm)
```

Verified dry holes with measured yield `0` remain valid yield observations.

The ledger reports count, MAE, RMSE and signed bias.

## Regional performance

Phase 11 groups verified outcomes by the best available non-sensitive geographic label:

1. district + taluk;
2. district;
3. village/place;
4. otherwise coarse 0.1-degree grid.

Each region receives the same correctness/calibration/depth/yield summary where data exists.

The public entry projection rounds coordinates to three decimals and does not expose operator identity, reviewer identity or private evidence.

## Model-version/source performance

The ledger publishes separate grouped performance for:

- each exact ML `modelVersion`;
- `heuristic_fallback`;
- prediction source (`ml` vs fallback).

Each group reports sample count, accuracy, Brier/ECE and available regression errors.

This is the post-deployment evidence Phase 10 monitoring can use to assess one active model version without mixing in other versions or fallback behavior.

## Outcome trust reopening

If a scored borewell is reopened, rejected or manually flagged so it no longer satisfies the Phase 9 trusted predicate:

```text
actual = null
correct = null
accountability.status = PENDING_REVERIFY
```

The previous scored outcome and metrics remain in `lastScoredOutcome` / `lastScoredMetrics` for provenance, while current aggregate performance excludes them.

If the outcome later becomes VERIFIED again, it may receive a fresh score.

## Append-only accountability audit

Phase 11 reuses the existing audit collection with:

```text
scopeType = prediction_accountability
scopeId   = predictionId
```

Current events include:

- `prediction_issued`
- `verified_outcome_scored`
- `outcome_reopened`

The issuance event records the exact model/deployment/feature identity and issued success/depth/yield values. Scoring and reopening events preserve the verified outcome relationship, metric snapshot and reason.

Admin audit access is available through:

```text
GET /api/admin/ledger/entries/:id/audit
```

There is no Phase 11 endpoint for deleting or rewriting accountability events.

## Backward compatibility

Existing Phase 8/9 prediction documents are not destructively migrated.

When an older record contains a stored verified `actual` outcome but no Phase 11 scored object, the ledger deterministically normalizes the record on read from its original issued probability/depth/yield and stored outcome.

This enables the stronger metrics without requiring an unsafe historical rewrite.

The original public `/api/ledger` fields remain available:

- `totalPredictions`
- `scored`
- `correct`
- `accuracyPct`
- `recent`

Phase 11 only extends the response.

## API delivered

```text
POST /api/predict
GET  /api/ledger
GET  /api/ledger/entries
GET  /api/ledger/models
GET  /api/ledger/regions
GET  /api/admin/ledger/entries/:id/audit
```

Persisted `/api/predict` responses add:

- `predictionId`
- `accountabilityStatus`

while retaining the existing prediction contract.

## Public ledger UI

The public `/ledger` screen now displays:

- overall classification accuracy;
- persisted/scored/pending counts;
- Brier score;
- calibration ECE;
- water-strike MAE;
- yield MAE;
- model-version performance;
- regional performance;
- richer recent prediction-vs-outcome rows;
- depth/yield absolute errors.

The UI explicitly describes the metrics and correctly refers to persisted predictions rather than transient previews.

## Phase 10 monitoring integration

A Phase 11 model group can provide Phase 10 monitoring inputs such as:

```json
{
  "scored": 42,
  "brier": 0.19,
  "depthMaeFt": 61.2,
  "yieldMaeLpm": 18.5
}
```

Phase 10 can return `ROLLBACK_REVIEW_RECOMMENDED`, but neither Phase 10 nor Phase 11 performs automatic model replacement/rollback from these metrics.

Human review and explicit `DEPLOY` / `ROLLBACK` confirmation remain mandatory.

## Tests and CI

The final runtime/test implementation head verified before this report was:

```text
7a44f93940c9d65f3dfffe2eefa7b0b24ae251e6
```

All workflows associated with that exact head passed:

- **Phase 11 Accountability Ledger — success**
- **Phase 10 Continuous Learning — success**
- **Phase 9 Verification and Data Trust — success**
- **Phase 8 Rig Operator Data — success**
- **Phase 7 Real Prediction Engine — success**
- **Phase 6 ML Service — success**

The Phase 11 workflow itself passed:

- dedicated Phase 11 accountability tests;
- Phase 9 verification regressions;
- Phase 7 prediction regressions;
- production web build.

Dedicated Phase 11 suite:

```text
9 passed
0 failed
0 skipped
```

The dedicated suite covers:

1. persisted roadmap-field snapshots;
2. success/Brier/depth/yield scoring;
3. dry-hole depth exclusion and yield inclusion;
4. calibration/errors/model-version/fallback separation;
5. legacy Phase 8/9 read normalization;
6. outcome reopening/removal from current metrics;
7. prediction issuance persistence/audit;
8. backward-compatible ledger APIs/grouped metrics;
9. public projection privacy.

## CI findings caught during implementation

The first Phase 11 CI run exposed a numerical edge case: JavaScript `Number(null)` is `0`, so the initial numeric helper could mistakenly treat a missing regression error as a real zero. The helper now explicitly excludes `null`, `undefined` and empty strings before numeric conversion. That prevents dry-hole water-strike records from being incorrectly included in depth-error counts.

The expanded accountability audit also caused older Phase 9 tests to see one additional event during verify/reopen actions. The tests were updated to verify the deliberate separation between:

- `rig_verification` lifecycle audit; and
- `prediction_accountability` scoring/reopen audit.

Both scopes now pass together.

## Security/deployment findings carried forward

Current Node dependency installation continues to report:

```text
server: 4 vulnerabilities (3 moderate, 1 high)
```

Existing web dependency audit findings remain Phase 15 production-security work. Phase 11 does not apply unreviewed breaking dependency upgrades.

Phase 17 still owns full-system testing and Phase 18 owns durable production deployment, backup, monitoring and disaster recovery.

## Scientific honesty boundary

Phase 11 live metrics are **observational post-deployment evidence**, not a replacement for Phase 5 spatial scientific validation.

Live samples can be biased by where users request predictions, where borewells are actually drilled, outcome-verification delay, model coverage and small regional sample sizes.

Therefore BoreSakshi should report sample counts with ledger performance and should not claim that a small live ledger metric is a population-wide accuracy estimate without appropriate statistical analysis.

No real production accuracy/calibration/depth/yield numbers are claimed by completing this software phase alone.

## Final Phase 11 status

**Phase 11 software implementation: COMPLETE.**  
**Prediction-accountability gate: PASS.**  
**Phase 10 monitoring handoff: COMPLETE.**  
**PR merge: intentionally not performed — review gate remains open.**
