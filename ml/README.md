# BoreSakshi ML — Phase 4 Training + Phase 5 Scientific Evaluation

This directory contains the offline Python ML pipeline. Phase 4 trains versioned candidate models from the Phase 3 feature artifact. Phase 5 evaluates those candidates with spatial holdouts, calibration, uncertainty, confidence intervals, coverage analysis and deterministic selection. Live serving remains a later phase.

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

XGBoost and LightGBM are optional candidate dependencies. If they are not installed, the Phase 4 run manifest records them as unavailable rather than silently replacing them.

## Setup

Core training/evaluation/tests:

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

## Phase 4 — train candidates

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

Phase 4 output:

```text
artifacts/<run-id>/
  run-manifest.json
  run-manifest.sha256
  success/*.joblib
  depth/*.joblib
  yield/*.joblib
```

The run manifest records the exact Phase 3 dataset, feature schema, training rows/spatial blocks, algorithm/hyperparameters, environment versions and artifact checksums. Phase 4 deliberately publishes no held-out performance metrics and selects no winner.

## Phase 5 — scientifically evaluate candidates

```bash
python evaluate.py \
  --dataset ../server/feature-artifacts/features-v1.json \
  --phase4-run artifacts/phase4-real-v1 \
  --out evaluations \
  --evaluation-id phase5-real-v1
```

Defaults:

```text
--folds=5
--inner-folds=3
--interval-coverage=0.90
--min-rows=30
--min-spatial-blocks=5
--calibration-bins=10
--bootstrap-iterations=500
--confidence-level=0.95
--seed=42
```

Phase 5 uses spatial/grouped out-of-fold validation. The all-data Phase 4 artifact is loaded only to recover the exact pipeline definition and is cloned/retrained inside each fold.

Measured outputs include:

- success: Accuracy, Precision, Recall, F1, ROC-AUC, Brier score
- calibration: ECE/reliability bins and calibrated probabilities
- classification uncertainty: entropy and confidence/coverage curves
- depth/yield: MAE, RMSE, R²
- depth/yield uncertainty: spatially evaluated conformal prediction intervals
- 95% spatial-block bootstrap confidence intervals for model metrics
- geographic bounds, spatial-block counts and per-feature missingness
- per-spatial-block performance
- deterministic selected candidate per task

Phase 5 output:

```text
evaluations/<evaluation-id>/
  evaluation-manifest.json
  evaluation-manifest.sha256
  evaluation-report.md
  selected/success/platt-calibrator.joblib
  selected/depth/interval.json
  selected/yield/interval.json
```

Selection is still review-gated: `servingApproved=false` and `promotionStatus=scientifically_selected_pending_review`.

## Tests

```bash
python -m pytest -q
```

The suite verifies Phase 4 training contracts plus Phase 5 checksum enforcement, spatial holdouts, requested metrics, calibration, conformal ranges, bootstrap confidence intervals, coverage analysis, candidate selection and insufficient-spatial-coverage blocking.

GitHub Actions runs:

- `.github/workflows/phase4-ml.yml`
- `.github/workflows/phase5-evaluation.yml`

Full implementation details and the completed review gate are documented in `../docs/phase-5-scientific-evaluation.md` and `../docs/phase-5-completion-report.md`.

## Phase boundary

Phase 5 selects the best candidate per target using measured spatial held-out evidence, but it does **not** authorize serving. Phase 6 must load the selected Phase 4 base model plus Phase 5 calibration/interval artifacts into the Python ML service and integrate Node → Python inference only after review approval.
