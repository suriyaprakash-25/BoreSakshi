# Phase 4 — Real ML Model

## Goal

Replace the mock-prediction concept with a reproducible training pipeline for three **real model targets**, while preserving the roadmap gates that keep scientific evaluation and production serving separate.

Phase 4 trains and registers candidate artifacts for:

1. **Success classification** — probability that a borewell finds water.
2. **Water-strike depth regression** — estimated depth to the water strike in feet.
3. **Yield regression** — estimated yield in litres/minute.

Formal accuracy/calibration/uncertainty evaluation is **Phase 5**. The live Python inference service and Node → Python integration are **Phase 6**. Therefore Phase 4 creates candidate artifacts but does not declare a winner or replace the current `/api/predict` implementation.

## Input contract

Phase 4 consumes the JSON artifact produced by Phase 3. The ML loader requires:

- `featureSchemaVersion = 1.0.0`
- non-empty `datasetVersion`
- non-empty `datasetHash`
- at least one training row
- unique `targetId`
- `spatialBlockId` on every row for later Phase 5 validation
- all 26 Phase 3 feature keys on every row
- labels kept under a separate `labels` object
- boolean success label

Label-like keys (`success`, `depthFt`, `waterStrikeFt`, `yieldLpm`, `labels`) are explicitly rejected if they appear inside `features`.

### Phase 4 label correction

The roadmap defines the depth target as **water-strike depth**. Phase 3 originally carried total `depthFt` but not `waterStrikeFt`, so the stacked Phase 4 branch adds `waterStrikeFt` to the feature-artifact `labels` object. It remains outside the feature vector and is only consumed as the depth-regression target.

## Feature matrix

The model receives exactly the 26 Phase 3 engineered features. Raw latitude/longitude and labels are not direct model inputs.

Numeric features (22): terrain, hydrology, fracture/lineament, rainfall, NDVI/NDWI and nearby-well statistics.

Categorical features (4):

- watershed ID
- geological formation
- lithology
- land-use/land-cover class

This strict feature contract prevents silent schema drift between training and later serving.

## Preprocessing

Every serialized candidate is an end-to-end scikit-learn `Pipeline`, so preprocessing and the estimator are stored together.

### Numeric

- median imputation for missing values
- standard scaling

### Categorical

- most-frequent imputation
- one-hot encoding
- unknown categories ignored at inference time

Phase 3 still reports source missingness explicitly; Phase 4's imputation is model preprocessing rather than hidden geospatial fabrication.

## Model candidates

### Success classification

| Candidate | Implementation |
|---|---|
| Logistic Regression | `sklearn.linear_model.LogisticRegression` |
| Random Forest | `sklearn.ensemble.RandomForestClassifier` |
| XGBoost | `xgboost.XGBClassifier` |
| LightGBM | `lightgbm.LGBMClassifier` |

Logistic Regression and the sklearn Random Forest are always available with the core requirements. XGBoost and LightGBM are optional candidate dependencies; when unavailable, the run manifest records their status and reason instead of silently substituting another algorithm.

### Depth regression

Target: `labels.waterStrikeFt`.

Candidates:

- Ridge Regression baseline
- Random Forest Regressor
- XGBoost Regressor
- LightGBM Regressor

Ridge is included as a transparent linear baseline; the roadmap tree/boosting candidates are also supported.

### Yield regression

Target: `labels.yieldLpm`.

Candidates:

- Ridge Regression baseline
- Random Forest Regressor
- XGBoost Regressor
- LightGBM Regressor

The central Phase 4 yield model predicts a point estimate. A scientifically measured **yield range** must be added in Phase 5 through validated uncertainty/interval estimation rather than inventing an arbitrary range during training.

## Class imbalance and deterministic settings

Success Logistic Regression uses balanced class weights. The sklearn/LightGBM classifiers use balanced weighting. Tree/boosting candidates receive fixed random seeds.

The production profile uses larger tree ensembles; the `test` profile intentionally uses small ensembles for automated smoke tests and must not be considered a production training run.

## Minimum-data gates

The training command blocks a task when:

- labelled rows are below `--min-rows` (default 30),
- classification does not contain both success and failure labels,
- a regression target contains fewer than two distinct target values,
- no requested candidate can be trained.

The default minimum is an operational safety floor, **not a claim that 30 rows are scientifically sufficient**. Phase 5 must determine whether data volume/coverage supports credible evaluation.

## Candidate artifact registry

Generated artifacts are intentionally gitignored. A run has the structure:

```text
artifacts/<run-id>/
  run-manifest.json
  run-manifest.sha256
  success/
    logistic_regression.joblib
    random_forest.joblib
    xgboost.joblib
    lightgbm.joblib
  depth/
    ridge_regression.joblib
    random_forest.joblib
    xgboost.joblib
    lightgbm.joblib
  yield/
    ridge_regression.joblib
    random_forest.joblib
    xgboost.joblib
    lightgbm.joblib
```

Each candidate registry entry contains:

- task and algorithm
- hyperparameters
- training row count
- source feature dataset version/hash
- training spatial blocks
- library/runtime versions
- artifact relative path
- artifact SHA-256
- artifact byte size
- `evaluationStatus = not_evaluated_phase5`
- `selected = false`

The run manifest itself has a SHA-256 sidecar.

## Reproducibility

A model run records:

- Phase 3 `datasetVersion`, `datasetHash`, and source-manifest hash
- feature schema version and exact feature names
- seed
- minimum-row gate
- training profile
- requested candidate list
- Python, NumPy, pandas, scikit-learn, joblib, XGBoost and LightGBM versions
- task-level label/data summaries
- spatial block IDs represented in each task's training data

No candidate is allowed to erase its link back to the exact feature artifact it was trained from.

## Training commands

Core environment:

```bash
cd ml
python -m venv .venv
# activate the environment, then:
pip install -r requirements.txt
```

For all roadmap candidate algorithms:

```bash
pip install -r requirements-candidates.txt
```

Train:

```bash
python train.py \
  --dataset ../server/feature-artifacts/features-v1.json \
  --out artifacts \
  --run-id phase4-real-v1
```

A filtered candidate run is also possible:

```bash
python train.py \
  --dataset ../server/feature-artifacts/features-v1.json \
  --out artifacts \
  --run-id phase4-rf-only \
  --algorithms=random_forest
```

## Tests

```bash
cd ml
python -m pytest -q
```

The Phase 4 tests cover:

- exact 26-feature contract
- correct water-strike target
- label leakage rejection
- candidate registry coverage for Logistic Regression, Random Forest, XGBoost and LightGBM
- three-task candidate training
- no metric publication/winner selection in Phase 4
- checksummed run manifest creation
- serialized-candidate offline inference
- insufficient-data blocking

## Performance metrics are deliberately absent

Phase 4 must not publish model performance from training-set fit. The run manifest therefore contains no accuracy, precision, recall, F1, ROC-AUC, Brier, MAE, RMSE or R² fields and does not select a candidate.

Phase 5 must evaluate candidates using spatial/grouped validation and then publish actual measured metrics, calibration, uncertainty and geographic/data coverage before selection.

## Production training gate

The repository intentionally does not commit raw real geospatial datasets or generated model binaries. A production candidate run requires a reviewed, approved **real Phase 3 feature artifact**.

Before calling any artifact a real BoreSakshi candidate model:

- [ ] Phase 2 records used by the artifact are approved/eligible
- [ ] Phase 3 source provenance/licenses/checksums are approved
- [ ] Phase 3 feature coverage and skipped rows are reviewed
- [ ] the artifact includes `waterStrikeFt` labels where depth training is expected
- [ ] enough success/failure labels exist for classification
- [ ] enough water-strike/yield labels exist for regression
- [ ] the Phase 4 tests pass
- [ ] the production training profile (not `test`) is used
- [ ] generated candidate artifacts/checksums are archived in controlled model storage

After candidate training, proceed to Phase 5 scientific evaluation. Do **not** connect an unevaluated Phase 4 artifact to live `/api/predict`.
