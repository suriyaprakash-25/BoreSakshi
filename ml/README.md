# BoreSakshi ML — Training, Evaluation & Serving

This directory contains BoreSakshi's Python ML stack:

- Phase 4: train versioned candidate models.
- Phase 5: spatial scientific evaluation, calibration, uncertainty, confidence intervals and deterministic candidate selection.
- Phase 6: load the reviewed selected bundle, extract live geospatial features, and serve calibrated predictions through FastAPI.

## Targets

- `success` — binary classification → calibrated `successProbability`
- `depth` — regression on `waterStrikeFt` → water-strike range
- `yield` — regression on `yieldLpm` → yield range

The depth model intentionally uses **water-strike depth**, not total drilled depth.

## Setup

```bash
cd ml
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt
```

For XGBoost + LightGBM Phase 4 candidates:

```bash
python -m pip install -r requirements-candidates.txt
```

## Phase 4 — train candidates

```bash
python train.py \
  --dataset ../server/feature-artifacts/features-v1.json \
  --out artifacts \
  --run-id phase4-real-v1
```

## Phase 5 — scientifically evaluate candidates

```bash
python evaluate.py \
  --dataset ../server/feature-artifacts/features-v1.json \
  --phase4-run artifacts/phase4-real-v1 \
  --out evaluations \
  --evaluation-id phase5-real-v1
```

Phase 5 output contains the selected candidate identities plus a calibrated-success artifact and conformal depth/yield interval artifacts. Selection alone does not authorize serving.

## Phase 6 — Python ML service

Copy the values from `.env.example` into your shell/environment. The service requires all of the following:

- exact reviewed Phase 4 run directory
- exact reviewed Phase 5 evaluation directory
- real live geospatial feature manifest
- matching dataset/version/checksum chain
- no blocked Phase 5 tasks
- explicit `BORESAKSHI_PHASE6_APPROVED=YES`

Example:

```bash
export BORESAKSHI_PHASE4_RUN_DIR=artifacts/phase4-real-v1
export BORESAKSHI_PHASE5_EVALUATION_DIR=evaluations/phase5-real-v1
export BORESAKSHI_FEATURE_MANIFEST=../docs/your-feature-manifest.json
export BORESAKSHI_PHASE6_APPROVED=YES
export BORESAKSHI_MIN_FEATURE_COVERAGE_PCT=60
export BORESAKSHI_WARN_FEATURE_COVERAGE_PCT=80

python -m uvicorn service:app --host 127.0.0.1 --port 8000
```

Without the approval flag or valid artifacts, the service starts in **not-ready** mode and `/ml/health` returns HTTP 503. This is deliberate.

### Endpoints

#### `GET /ml/health`

Ready example:

```json
{
  "ok": true,
  "service": "boresakshi-ml",
  "ready": true,
  "modelLoaded": true,
  "modelVersion": "phase4-real-v1@phase5-real-v1",
  "featureVersion": "geo-v1:features-1.0.0"
}
```

#### `GET /ml/model-info`

Returns the exact Phase 4/5/source-manifest checksums, selected model identities, dataset metadata, feature version and coverage policy.

#### `POST /ml/predict`

Request:

```json
{
  "lat": 11.36,
  "lng": 77.80,
  "predictionTimestamp": "2026-09-15T00:00:00Z",
  "nearbyBorewells": [
    {
      "id": "well-1",
      "lat": 11.361,
      "lng": 77.801,
      "success": true,
      "depthFt": 240,
      "yieldLpm": 50,
      "drilledAt": "2026-01-01T00:00:00Z",
      "verified": true,
      "flagged": false,
      "datasetEligibility": { "eligible": true }
    }
  ]
}
```

Response contract:

```json
{
  "successProbability": 72.4,
  "estimatedDepthFt": { "estimate": 250.0, "min": 210.0, "max": 290.0 },
  "estimatedYieldLpm": { "estimate": 52.0, "min": 39.0, "max": 65.0 },
  "confidence": "High",
  "modelVersion": "phase4-real-v1@phase5-real-v1",
  "featureVersion": "geo-v1:features-1.0.0",
  "explanations": [],
  "uncertainty": {},
  "featureCoverage": { "coveragePct": 92.3, "missingFeatures": [] },
  "coverageWarning": null,
  "predictionTimestamp": "2026-09-15T00:00:00Z",
  "predictionSource": "ml",
  "isMock": false
}
```

### Live feature extraction

`boresakshi_ml/live_features.py` independently loads and checksum-verifies the Phase 3-style source manifest and extracts the same 26-feature contract from:

- DEM-derived elevation/slope/aspect/curvature
- drainage/watershed/flow accumulation
- geology/lineaments/fracture proximity
- rainfall/anomaly
- NDVI/NDWI/LULC
- historical verified borewell evidence

Only `verified=true`, unflagged, dataset-eligible wells strictly before the prediction timestamp may contribute nearby-well features.

### Coverage policy

If feature coverage is below `BORESAKSHI_MIN_FEATURE_COVERAGE_PCT`, `/ml/predict` returns HTTP 422 with `INSUFFICIENT_FEATURE_COVERAGE`. Node then returns the explicitly labelled heuristic fallback.

If coverage is above the minimum but below `BORESAKSHI_WARN_FEATURE_COVERAGE_PCT`, the ML result is returned with a visible `coverageWarning`.

### Calibration, uncertainty and explanations

- success probability is passed through the selected Phase 5 Platt calibrator
- water-strike and yield ranges use the selected Phase 5 conformal radii
- confidence combines calibrated class certainty and feature coverage
- explanations use local single-feature ablation to the pipeline's learned imputation baseline; they are local sensitivity values, not SHAP and are labelled accordingly

## Node orchestration / fallback

The Node server owns service-client behavior:

- request timeout
- one configurable retry for retryable failures
- circuit breaker
- ML health metadata in `/api/health`
- persistence and accountability ledger
- explicit fallback policy

The fallback rule is strict: **BoreSakshi never silently presents the heuristic as ML.** Fallback responses use `predictionSource="heuristic_fallback"`, `isMock=true`, `modelAvailable=false`, `modelVersion=null`, and a visible warning.

## Tests

```bash
python -m pytest -q
```

Phase 6 tests verify live-feature checksum handling, verified-only historical evidence, serving approval, Phase 4/5 artifact loading, calibrated prediction contracts, uncertainty ranges, and all three FastAPI endpoints.

Node Phase 6 tests live under `server/test/` and cover retries, non-retryable coverage errors, circuit breaking, ML response mapping and explicit fallback labeling.

GitHub Actions workflows:

- `.github/workflows/phase4-ml.yml`
- `.github/workflows/phase5-evaluation.yml`
- `.github/workflows/phase6-service.yml`

See `../docs/phase-6-python-ml-service.md` and `../docs/phase-6-completion-report.md` for the Phase 6 architecture and review gate.
