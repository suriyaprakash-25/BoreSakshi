# BoreSakshi Phase 11 — Prediction Accountability Ledger

## Goal

Phase 11 makes BoreSakshi predictions auditable after real drilling outcomes become available.

The ledger connects:

```text
Issued prediction
      ↓
Persisted prediction snapshot
      ↓
Real borewell drilled
      ↓
Outcome submitted
      ↓
Phase 9 verification
      ↓
Verified outcome matched to eligible prior prediction
      ↓
Prediction scored
      ↓
Calibration / depth / yield / regional / model-version metrics
```

Only currently trusted verified outcomes count in current performance metrics.

## Ledger record contract

Every persisted Phase 11 prediction stores an `accountability` object with:

- accountability schema version;
- prediction ID;
- prediction date;
- model version;
- model identity;
- deployment ID when Phase 10 deployment-pointer serving is active;
- prediction source (`ml` or `heuristic_fallback`);
- feature version;
- feature snapshot reference;
- issued success probability;
- issued success call;
- issued predicted water-strike range + midpoint;
- issued predicted yield range + midpoint;
- current outcome state;
- current verification state;
- scoring metrics;
- score/reopen timestamps.

`save=false` preview predictions are not persisted and therefore are not represented as ledger records.

## Model identity

Real ML predictions are grouped by their exact `modelVersion`.

Heuristic fallback predictions use the explicit identity:

```text
heuristic_fallback
```

They are never blended into a trained model's performance.

## Outcome matching

The existing accountability radius remains 5 km.

A verified borewell can score a prediction only when the prediction existed before the drilling outcome:

```text
prediction.createdAt <= borewell.drilledAt
```

This prevents BoreSakshi from scoring a prediction made after the answer was already known.

The outcome must also pass the complete Phase 9 trusted predicate before it can remain in current ledger metrics.

## Scored outcome fields

A scored prediction records:

- borewell/outcome ID;
- actual success/failure;
- drilled total depth;
- verified water-strike depth;
- measured yield;
- drilling date;
- outcome/verification date;
- verification status;
- match distance;
- regional grouping;
- scoring timestamp.

## Prediction correctness

The classification rule remains transparent:

```text
successProbability >= 50% → water likely
successProbability <  50% → dry likely
```

`successCorrect` is true when that issued call matches the currently verified outcome.

The threshold is recorded in ledger methodology so it cannot silently change in reporting.

## Calibration and Brier score

For each verified score:

```text
Brier = (issued_probability - actual_binary_outcome)^2
```

The overall/model/region/source Brier score is the mean of those contributions.

Calibration is reported using ten probability bins. Each non-empty bin records:

- probability range;
- number of verified scores;
- mean issued probability;
- observed success rate;
- absolute calibration gap.

Expected Calibration Error (ECE) is the sample-weighted average bin gap.

These are observational post-deployment metrics. They do not replace Phase 5 spatial scientific validation.

## Water-strike depth error

The existing prediction contract exposes a water-strike interval rather than one public point prediction. Phase 11 defines the accountability estimate as the interval midpoint:

```text
predictedStrikeFt = (issued_min + issued_max) / 2
```

For verified successful wells:

```text
depthErrorFt         = predictedStrikeFt - actualWaterStrikeFt
depthAbsoluteErrorFt = abs(depthErrorFt)
```

Dry holes are excluded from water-strike depth MAE/RMSE because no verified strike depth exists.

Reported aggregate metrics:

- count;
- MAE;
- RMSE;
- signed bias.

## Yield error

Yield uses the issued interval midpoint:

```text
predictedYieldLpm = (issued_min + issued_max) / 2
```

Then:

```text
yieldErrorLpm         = predictedYieldLpm - actualYieldLpm
yieldAbsoluteErrorLpm = abs(yieldErrorLpm)
```

Aggregate metrics:

- count;
- MAE;
- RMSE;
- signed bias.

A verified dry hole with measured yield 0 remains a valid yield observation.

## Regional performance

Phase 11 groups scored outcomes by the best available non-sensitive geographic label:

1. district + taluk;
2. district;
3. village/place name;
4. otherwise a coarse 0.1-degree grid key.

The public projection rounds coordinates to three decimal places and does not expose operator/reviewer identity or evidence objects.

Regional groups report the same accuracy/calibration/depth/yield summary where samples exist.

Small groups should be interpreted cautiously; Phase 11 reports observations and does not claim statistical significance from tiny samples.

## Model-version performance

Each exact trained `modelVersion` receives its own group containing:

- number of persisted predictions;
- verified scores;
- correctness/accuracy;
- Brier;
- calibration ECE/bins;
- water-strike error metrics;
- yield error metrics.

`heuristic_fallback` is a separate group and source.

This lets Phase 10 monitoring evaluate a deployed candidate without contaminating its evidence with fallback behavior or another model version.

## Current trust vs historical audit

If a borewell's verification is reopened, rejected or otherwise loses trusted status:

- prediction `actual`/`correct` are cleared from current scoring;
- accountability state becomes `PENDING_REVERIFY`;
- the last scored outcome/metrics remain in the prediction's accountability provenance;
- current aggregate metrics no longer count the outcome;
- an append-only accountability event records the reopening.

If it is later verified again, a fresh score can be recorded.

## Append-only accountability audit

Phase 11 reuses the existing audit collection under:

```text
scopeType = prediction_accountability
scopeId   = predictionId
```

Events include:

- `prediction_issued`
- `verified_outcome_scored`
- `outcome_reopened`

The prediction-issued event records model/deployment/feature identity and the issued probability/depth/yield snapshot.

Scoring/reopen events record the outcome relationship and metric/reason details.

Admin audit access is available through:

```text
GET /api/admin/ledger/entries/:id/audit
```

There is no Phase 11 route for deleting/re-writing accountability events.

## Backward compatibility

Existing Phase 8/9 prediction documents are not destructively migrated.

If an older prediction has a stored `actual` outcome but no Phase 11 scored accountability object, the ledger deterministically normalizes it at read time from:

- original probability;
- original depth/yield intervals;
- stored actual success;
- stored water-strike depth;
- stored yield;
- existing verified/closed fields.

This makes the new metrics available while keeping historical documents intact.

Newly persisted predictions receive the Phase 11 snapshot immediately.

## API

### Issue prediction

```text
POST /api/predict
```

The existing response remains additive and now includes:

- `predictionId` when persisted;
- `accountabilityStatus` when persisted.

### Public summary

```text
GET /api/ledger
```

Preserves the earlier fields:

- `totalPredictions`
- `scored`
- `correct`
- `accuracyPct`
- `recent`

and adds:

- `pending`
- Brier
- calibration ECE/bins
- depth error summary
- yield error summary
- model-version groups
- region groups
- source groups
- methodology

### Public filtered entries

```text
GET /api/ledger/entries
```

Optional filters:

- `modelVersion`
- `source`
- `status`
- `region`
- `page`
- `limit`

### Model/source view

```text
GET /api/ledger/models
```

### Regional view

```text
GET /api/ledger/regions
```

### Admin audit

```text
GET /api/admin/ledger/entries/:id/audit
```

## Public UI

The existing public `/ledger` page now displays:

- overall classification accuracy;
- persisted/scored/pending counts;
- Brier score;
- calibration ECE;
- water-strike MAE;
- yield MAE;
- model-version performance;
- regional performance;
- recent prediction vs verified-outcome details;
- depth/yield error values.

The copy now correctly says **persisted predictions**, not every transient preview request.

## Phase 10 monitoring handoff

Phase 10 monitoring can consume Phase 11 model-version metrics, for example:

```json
{
  "scored": 42,
  "brier": 0.19,
  "depthMaeFt": 61.2,
  "yieldMaeLpm": 18.5
}
```

Phase 10 may return `ROLLBACK_REVIEW_RECOMMENDED`, but the ledger never automatically:

- retrains a model;
- approves a candidate;
- changes production traffic;
- performs rollback.

Those remain explicit human-reviewed Phase 10 actions.

## Scientific honesty boundary

Phase 11 is observational post-deployment accountability.

It must not be confused with Phase 5's controlled spatial cross-validation results. Live ledger metrics can be affected by where/when users drill, sample size, outcome verification lag and deployment coverage.

Therefore BoreSakshi should report ledger sample counts alongside performance and avoid claiming a live metric is a general population estimate without appropriate statistical analysis.
