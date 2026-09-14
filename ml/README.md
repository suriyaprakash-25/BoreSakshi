# BoreSakshi ML — Training, Evaluation, Serving & Activation

This directory contains BoreSakshi's Python ML stack:

- Phase 4: train versioned candidate models.
- Phase 5: spatial scientific evaluation, calibration, uncertainty, confidence intervals and deterministic candidate selection.
- Phase 6: load the reviewed selected bundle, extract live geospatial features, and serve calibrated predictions through FastAPI.
- Phase 7: enforce the versioned real-prediction contract, attach immutable feature-snapshot references, and generate a checksummed activation preflight report.

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

Configure:

```bash
export BORESAKSHI_PHASE4_RUN_DIR=artifacts/phase4-real-v1
export BORESAKSHI_PHASE5_EVALUATION_DIR=evaluations/phase5-real-v1
export BORESAKSHI_FEATURE_MANIFEST=../data/geo/feature-manifest.json
export BORESAKSHI_PHASE6_APPROVED=YES
export BORESAKSHI_MIN_FEATURE_COVERAGE_PCT=60
export BORESAKSHI_WARN_FEATURE_COVERAGE_PCT=80

python -m uvicorn service:app --host 127.0.0.1 --port 8000
```

Without the approval flag or valid artifacts, the service starts in **not-ready** mode and `/ml/health` returns HTTP 503.

### Endpoints

- `GET /ml/health`
- `GET /ml/model-info`
- `POST /ml/predict`

The selected bundle verifies Phase 4/5 manifests and artifact checksums, selected model binaries, calibration/interval artifacts, the live source manifest and live source checksums before serving.

## Phase 7 — real prediction contract

`POST /ml/predict` now returns prediction contract version `1.0.0` and is validated before the service responds.

Required real-model metadata includes:

```json
{
  "successProbability": 72.4,
  "estimatedDepthFt": { "estimate": 250.0, "min": 210.0, "max": 290.0 },
  "estimatedYieldLpm": { "estimate": 52.0, "min": 39.0, "max": 65.0 },
  "confidence": "High",
  "modelVersion": "phase4-real-v1@phase5-real-v1",
  "featureVersion": "geo-v1:features-1.0.0",
  "predictionContractVersion": "1.0.0",
  "featureSnapshotRef": "fsnap:<sha256>",
  "featureSnapshot": {
    "ref": "fsnap:<sha256>",
    "datasetVersion": "geo-v1",
    "featureVersion": "geo-v1:features-1.0.0",
    "featureManifestSha256": "<sha256>",
    "predictionAsOf": "2026-09-15T00:00:00Z"
  },
  "explanations": [],
  "uncertainty": {},
  "featureCoverage": { "coveragePct": 92.3, "missingFeatures": [] },
  "coverageWarning": null,
  "predictionTimestamp": "2026-09-15T00:00:00Z",
  "predictionSource": "ml",
  "isMock": false
}
```

The feature snapshot reference is deterministic from the immutable source-manifest checksum, dataset/feature versions and prediction timestamp. Dynamic source selection can therefore be reproduced against the same checksummed manifest.

## Phase 7 activation preflight

After the real Phase 3/4/5 deployment artifacts have been reviewed, run:

```bash
python activate.py \
  --lat 11.36 \
  --lng 77.80 \
  --nearby-json ../data/activation-nearby-wells.json \
  --activation-id boresakshi-v1-candidate \
  --out activations/boresakshi-v1-candidate
```

The preflight:

1. loads the exact checksum-verified serving bundle;
2. requires `BORESAKSHI_PHASE6_APPROVED=YES`;
3. performs a real-model smoke prediction;
4. validates the Phase 7 prediction contract;
5. confirms the prediction model/feature versions match the loaded bundle;
6. writes:

```text
phase7-activation-report.json
phase7-activation-report.sha256
```

A successful report says:

```text
status = ready_for_human_activation_review
productionActivated = false
```

The CLI deliberately does **not** deploy or route farmer traffic. Generated activation reports live under `activations/` and are gitignored.

## Live feature extraction

`boresakshi_ml/live_features.py` checksum-verifies the Phase 3-style source manifest and extracts the 26-feature contract from:

- DEM-derived elevation/slope/aspect/curvature
- drainage/watershed/flow accumulation
- geology/lineaments/fracture proximity
- rainfall/anomaly
- NDVI/NDWI/LULC
- historical verified borewell evidence

Only `verified=true`, unflagged, dataset-eligible wells strictly before the prediction timestamp may contribute nearby-well features.

## Coverage, calibration and uncertainty

- below `BORESAKSHI_MIN_FEATURE_COVERAGE_PCT` → HTTP 422 `INSUFFICIENT_FEATURE_COVERAGE`
- between minimum and warning threshold → real ML with visible `coverageWarning`
- success probability → selected Phase 5 Platt calibrator
- water-strike/yield range → selected Phase 5 conformal interval radius
- confidence → calibrated class certainty + live feature coverage
- explanations → labelled single-feature-ablation sensitivities, not SHAP

## Node orchestration / fallback

Node owns timeout, retry, circuit breaker, persistence, ledger integration and the second Phase 7 contract check.

If the Python response is missing/invalid contract metadata or carries impossible numeric ranges, Node rejects it with `ML_CONTRACT_INVALID` and follows the explicit fallback policy.

Fallback remains clearly marked:

```text
predictionSource = heuristic_fallback
isMock = true
modelAvailable = false
modelVersion = null
featureSnapshotRef = null
```

BoreSakshi never silently presents the heuristic as trained ML.

## Tests

```bash
python -m pytest -q
```

Node:

```bash
cd ../server
npm run test:phase7
```

GitHub Actions workflows:

- `.github/workflows/phase4-ml.yml`
- `.github/workflows/phase5-evaluation.yml`
- `.github/workflows/phase6-service.yml`
- `.github/workflows/phase7-real-prediction.yml`

See `../docs/phase-7-real-prediction-engine.md` for the full Phase 7 contract and activation boundary.
