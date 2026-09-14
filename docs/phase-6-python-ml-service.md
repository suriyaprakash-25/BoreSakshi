# Phase 6 — Python ML Service & Live Inference Integration

## Goal

Expose the reviewed Phase 5-selected BoreSakshi model bundle through a Python HTTP service and connect the existing Node `/api/predict` route to it **without breaking the farmer UI, accountability ledger, or review gates**.

The runtime architecture is:

```text
React farmer UI
    ↓
Node POST /api/predict
    ↓
verified / unflagged / dataset-eligible nearby wells
    ↓
Python POST /ml/predict
    ↓
live checksum-verified geospatial feature extraction
    ↓
selected Phase 4 success/depth/yield models
    ↓
Phase 5 calibration + conformal uncertainty
    ↓
versioned prediction + explanations + coverage metadata
    ↓
Node compatibility mapping + prediction persistence
    ↓
public accountability ledger
```

Phase 6 does not implement automatic retraining or automatic model replacement. Any future continuous-learning flow remains human-reviewed, staged and rollbackable.

## Service endpoints

The Python FastAPI service exposes exactly:

- `POST /ml/predict`
- `GET /ml/model-info`
- `GET /ml/health`

Run locally:

```bash
cd ml
python -m pip install -r requirements-candidates.txt
python -m uvicorn service:app --host 127.0.0.1 --port 8000
```

## Serving approval gate

The service does not consider a selected Phase 5 candidate production-ready merely because it was selected scientifically.

All three artifact/source paths must be configured:

```text
BORESAKSHI_PHASE4_RUN_DIR
BORESAKSHI_PHASE5_EVALUATION_DIR
BORESAKSHI_FEATURE_MANIFEST
```

and an explicit operational approval must be present:

```text
BORESAKSHI_PHASE6_APPROVED=YES
```

Without that exact approval value, the service loads as **not ready** and `/ml/health` returns HTTP 503.

This preserves the Phase 5 `scientifically_selected_pending_review` gate instead of mutating a scientific report into deployment authorization.

## Artifact integrity checks

Before serving is marked ready, `ServingBundle` verifies:

1. Phase 4 `run-manifest.json` against `run-manifest.sha256`.
2. Phase 5 `evaluation-manifest.json` against `evaluation-manifest.sha256`.
3. Phase 5 references the configured Phase 4 run ID.
4. Phase 4/5 training dataset hashes match.
5. Phase 5 has no blocked tasks.
6. Phase 5 says scientific evaluation completed.
7. every selected Phase 4 model binary exists and matches its SHA-256.
8. the selected success Platt calibrator exists and matches its SHA-256.
9. the selected depth/yield interval metadata exists and matches its SHA-256.
10. every live geospatial source file exists and matches the checksum recorded in the feature manifest.
11. the live feature manifest's `datasetVersion` matches the model training dataset version.

Any mismatch keeps the ML service unavailable rather than serving an ambiguous model/source combination.

## Live feature extraction

Phase 6 adds `ml/boresakshi_ml/live_features.py`, a Python implementation of the Phase 3 feature contract for serving.

The same 26 model inputs are produced from:

### Terrain

- elevation
- slope
- aspect
- curvature

### Hydrology

- drainage distance
- drainage density
- watershed
- flow accumulation

### Geology / fracture structure

- formation
- lithology
- lineament density
- distance to lineament
- fracture proximity

### Climate

- annual rainfall
- seasonal rainfall
- recent rainfall
- rainfall anomaly

### Satellite / LULC

- NDVI
- NDWI
- land-use / land-cover class

### Verified borewell history

- nearest verified well distance
- nearby count
- success/failure rates
- average depth
- average yield

Dynamic rainfall/satellite/LULC layers are selected only when their observation date is not after the prediction timestamp.

## Trusted historical evidence only

The Node route now filters nearby drill records before prediction. A well may influence ML or heuristic fallback only when:

```text
verified === true
flagged !== true
datasetEligibility.eligible !== false
```

The Python feature extractor repeats these checks defensively and also requires the drill timestamp to be strictly before the prediction timestamp.

Unverified operator submissions therefore do not affect live predictions until approved/verified.

## Feature coverage policy

Two serving thresholds are configurable:

```text
BORESAKSHI_MIN_FEATURE_COVERAGE_PCT=60
BORESAKSHI_WARN_FEATURE_COVERAGE_PCT=80
```

### Below minimum

`POST /ml/predict` returns HTTP 422:

```json
{
  "detail": {
    "code": "INSUFFICIENT_FEATURE_COVERAGE",
    "message": "...",
    "coverage": {}
  }
}
```

Node then serves the explicitly labelled heuristic fallback.

### Between minimum and warning threshold

The real ML prediction is returned with `coverageWarning` populated. The farmer UI displays the warning.

### Above warning threshold

The ML prediction is returned without a coverage warning.

No missing geospatial value is silently invented by the feature extractor; model-pipeline imputation occurs only at the trained preprocessing layer.

## Prediction contract

The Python response includes the Phase 6 roadmap contract:

```json
{
  "successProbability": 72.4,
  "estimatedDepthFt": {
    "estimate": 250,
    "min": 210,
    "max": 290
  },
  "estimatedYieldLpm": {
    "estimate": 52,
    "min": 39,
    "max": 65
  },
  "confidence": "High",
  "modelVersion": "phase4-real-v1@phase5-real-v1",
  "featureVersion": "geo-v1:features-1.0.0",
  "explanations": [],
  "uncertainty": {},
  "featureCoverage": {},
  "coverageWarning": null,
  "predictionTimestamp": "2026-09-15T00:00:00Z",
  "predictionSource": "ml",
  "isMock": false
}
```

Node maps this additively into the existing frontend contract:

- `successProbability`
- `depthBandFt`
- `expectedYieldLpm`
- `confidence`
- `rockType`
- `basis`
- `factors`
- `confidenceReason`

while preserving the new provenance fields:

- `predictionSource`
- `modelVersion`
- `featureVersion`
- `predictionTimestamp`
- `uncertainty`
- `featureCoverage`
- `coverageWarning`

Existing prediction persistence and ledger scoring therefore continue to work.

## Calibration and uncertainty in serving

### Success

The selected full-data Phase 4 classifier generates the raw probability. Phase 6 applies the selected Phase 5 Platt calibrator to its logit.

Reported uncertainty includes:

- raw probability
- calibrated probability
- normalized binary entropy
- maximum class probability

### Water-strike depth

The selected depth model generates a central estimate. The Phase 5 selected conformal radius creates:

```text
max(0, prediction - radius) ... prediction + radius
```

### Yield

The selected yield model uses the same Phase 5 conformal range mechanism with a non-negative lower bound.

Confidence (`Low`, `Medium`, `High`) combines calibrated class certainty with live feature coverage. It is intentionally not presented as a groundwater guarantee.

## Explainability

Phase 6 produces local success-probability sensitivities by ablating one available feature at a time to the trained pipeline's imputation baseline and recomputing the calibrated probability.

Each explanation contains:

```json
{
  "feature": "geologyFormation",
  "label": "Geological formation",
  "impact": 8.3,
  "method": "single_feature_ablation_to_pipeline_imputation"
}
```

These values are explicitly labelled as local sensitivity. They are **not SHAP values**, and unlike the old heuristic factor decomposition they are not expected to sum to the final probability.

## Node → Python client

`server/mlClient.js` implements:

- configurable base URL
- request timeout
- retry of retryable 5xx/429/network failures
- no retry for domain 4xx such as insufficient feature coverage
- circuit breaker after configurable consecutive transport/service failures
- cooldown / half-open retry
- client status snapshot for observability

Environment variables:

```text
ML_SERVICE_URL=http://127.0.0.1:8000
ML_SERVICE_TIMEOUT_MS=2500
ML_SERVICE_RETRIES=1
ML_CIRCUIT_FAILURE_THRESHOLD=3
ML_CIRCUIT_COOLDOWN_MS=30000
```

A coverage 422 is a valid model-domain refusal and does not count toward opening the circuit breaker.

## Failure policy

Phase 6 preserves the demo/product's ability to answer during ML outages, but makes the distinction explicit.

The heuristic is used when:

- Python service is unavailable
- request times out
- ML service returns retryable failures after retries
- circuit breaker is open
- live feature coverage is below the model minimum
- service is not approved/ready

Fallback response metadata includes:

```json
{
  "predictionSource": "heuristic_fallback",
  "isMock": true,
  "modelAvailable": false,
  "modelVersion": null,
  "featureVersion": null,
  "coverageWarning": "ML prediction is unavailable...",
  "fallbackReason": "...",
  "uncertainty": {
    "available": false
  }
}
```

The UI displays a prominent fallback warning. The fallback is never silently shown as trained ML.

## Health and observability

### Python

`GET /ml/health` returns 200 only when the approved selected bundle and feature sources are fully loaded. Otherwise it returns 503 with a readiness error.

`GET /ml/model-info` exposes:

- model version
- feature version
- selected candidate identities/algorithms
- Phase 4 run ID
- Phase 5 evaluation ID
- dataset metadata
- Phase 4/5/feature manifest SHA-256 values
- coverage serving policy

Prediction logs record outcome, model version, confidence, feature coverage and duration without logging full feature payloads.

### Node

`GET /api/health` continues to use database health as the API availability status, but additionally reports ML service readiness and the Node client circuit state. An ML outage therefore does not incorrectly mark the complete Node API/database as down.

## Farmer UI changes

The existing result card remains structurally compatible while now showing:

- trained ML vs heuristic fallback source
- explicit fallback banner
- coverage warning
- model version
- feature version
- prediction timestamp
- depth/yield interval radius and target coverage
- live feature coverage
- calibrated probability uncertainty
- updated explanation semantics

The advisory remains clear that groundwater predictions are probabilities, not guarantees.

## Rollback

Phase 6 has two immediate rollback mechanisms without changing database schemas or deleting artifacts:

1. unset/change `BORESAKSHI_PHASE6_APPROVED` from `YES`, causing Python to report not-ready;
2. remove the Python service from routing / change `ML_SERVICE_URL` to an unavailable target.

In either case Node immediately moves to the visibly labelled deterministic fallback. No prediction is falsely labelled as ML.

For a model-version rollback, point the Phase 4/5 environment paths back to a previously reviewed checksummed bundle and restart the Python service.

## Tests

### Python

`ml/tests/test_phase6.py` verifies:

- source-file checksum validation
- verified-only historical borewell features
- explicit serving approval
- Phase 4/5 bundle loading
- calibrated probability and interval prediction contract
- model/feature version metadata
- FastAPI health/model-info/predict endpoints

### Node

`server/test/mlClient.test.js` and `server/test/predictPhase6.test.js` verify:

- timeout/retry/circuit behavior
- non-retryable coverage errors
- compatibility mapping to the existing farmer response
- explicit fallback metadata
- heuristic never masquerades as ML

### Frontend

CI runs the Vite production build after the prediction-panel changes.

## Phase 6 production checklist

Before setting `BORESAKSHI_PHASE6_APPROVED=YES` in production:

- [ ] real Phase 5 evaluation has no blocked tasks
- [ ] Phase 5 promotion checklist has been explicitly reviewed
- [ ] Phase 4 and Phase 5 checksums are archived
- [ ] selected model/calibrator/interval artifact checksums match
- [ ] live feature-manifest dataset version matches training
- [ ] every live geospatial source checksum matches
- [ ] feature coverage thresholds are approved for the supported service area
- [ ] `/ml/health` and `/ml/model-info` reviewed before traffic
- [ ] successful end-to-end `/api/predict` smoke test returns `predictionSource=ml`
- [ ] outage smoke test visibly returns `predictionSource=heuristic_fallback`
- [ ] model version / feature version / timestamps persist with predictions
- [ ] rollback environment paths and approval switch are documented

Continuous retraining, automatic model promotion, broader deployment/monitoring, GIS recharge recommendations and other later enhancements remain separate review-gated work; Phase 6 does not auto-replace a serving model.
