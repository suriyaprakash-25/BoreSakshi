# BoreSakshi Phase 4 — Real ML Model

This directory trains **candidate model artifacts** from the versioned Phase 3 feature dataset. It does not run the live prediction API; the Python ML service is a later phase.

## Targets

- `success` — binary classification → `successProbability`
- `depth` — regression on `waterStrikeFt` → `estimatedWaterStrikeFt`
- `yield` — regression on `yieldLpm` → `estimatedYieldLpm`

The depth model intentionally uses **water-strike depth**, not total drilled depth.

## Candidate algorithms

Success classification:

- Logistic Regression
- Random Forest
- XGBoost
- LightGBM

Depth and yield regression:

- Ridge Regression baseline
- Random Forest
- XGBoost
- LightGBM

XGBoost and LightGBM are optional candidate dependencies. If they are not installed, the run manifest records them as unavailable rather than silently replacing them.

## Setup

Core training/tests:

```bash
cd ml
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

All roadmap candidates:

```bash
pip install -r requirements-candidates.txt
```

## Train candidates

```bash
python train.py \
  --dataset ../server/feature-artifacts/features-v1.json \
  --out artifacts \
  --run-id phase4-real-v1
```

Useful options:

```text
--seed=42
--min-rows=30
--algorithms=logistic_regression,random_forest,xgboost,lightgbm
```

`--profile=test` reduces tree counts for unit/smoke tests and must not be treated as a production training run.

## Outputs

Each run contains:

```text
artifacts/<run-id>/
  run-manifest.json
  run-manifest.sha256
  success/*.joblib
  depth/*.joblib
  yield/*.joblib
```

The run manifest records:

- exact Phase 3 dataset version/hash
- feature schema version and names
- training row counts and spatial block IDs
- candidate algorithm/hyperparameters
- Python/ML library versions
- artifact SHA-256 + byte size
- explicit `not_evaluated_phase5` status

It deliberately contains **no accuracy/AUC/MAE/RMSE/calibration claims and selects no winner**. Formal candidate evaluation and selection belong to Phase 5.

## Tests

```bash
python -m pytest -q
```

The tests verify the strict feature contract, label leakage prevention, correct water-strike target, roadmap candidate registry, candidate serialization, offline probability/regression inference, and minimum-data blocking.

## Phase boundary

Phase 4 trains and registers real-model candidates. Phase 5 must spatially evaluate those candidates and publish measured metrics/calibration/uncertainty before one is selected. Phase 6 then exposes the selected models through the Python ML service and integrates Node → Python inference.
