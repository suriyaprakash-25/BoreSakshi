# BoreSakshi Phase 4 Completion Report

**Phase:** 4 — Real ML Model  
**Implementation branch:** `phase-4-real-ml-model`  
**Base branch:** `phase-3-geospatial-features`  
**Status:** Phase 4 software implementation complete; production candidate training remains gated on a reviewed real Phase 3 feature artifact.

## Roadmap boundary

Phase 4 implements the real model-training layer. It does **not** absorb later roadmap phases:

- **Phase 5** owns scientific evaluation: spatial validation, classification/regression metrics, calibration, uncertainty/ranges and candidate selection.
- **Phase 6** owns the Python ML service and Node → Python live inference integration.

Accordingly, this implementation trains/registers candidates but publishes no fake performance metrics, selects no winner and leaves the existing live `/api/predict` mock unchanged.

## Scope completed

| Planned Phase 4 capability | Result |
|---|---|
| Success classification model | Complete — independent binary classification task |
| Success probability output | Complete — candidate classifiers expose `predict_proba` |
| Water-strike depth regression | Complete — target is `waterStrikeFt`, not total drilled depth |
| Yield regression | Complete — target is `yieldLpm` |
| Logistic Regression candidate | Complete — success classification |
| Random Forest candidate | Complete — classification + depth/yield regression |
| XGBoost candidate | Complete — classification + depth/yield regression when dependency installed |
| LightGBM candidate | Complete — classification + depth/yield regression when dependency installed |
| Regression baseline | Complete — Ridge Regression for depth/yield |
| Strict Phase 3 feature schema | Complete — exactly 26 engineered features |
| Label leakage rejection | Complete — label-like keys forbidden inside features |
| Raw coordinates excluded from model inputs | Complete |
| Numeric preprocessing | Complete — median imputation + scaling |
| Categorical preprocessing | Complete — most-frequent imputation + one-hot/unknown handling |
| Class imbalance handling | Complete — balanced weighting on supported classifiers |
| Minimum data gates | Complete — row/class/distinct-target checks |
| Deterministic seeds | Complete |
| Candidate model serialization | Complete — joblib pipelines |
| Model artifact checksums | Complete — SHA-256 + byte size |
| Run manifest | Complete — source dataset/schema/runtime/hyperparameters/artifacts |
| Manifest checksum sidecar | Complete |
| Candidate status registry | Complete — trained/unavailable + `not_evaluated_phase5` |
| Offline artifact inference smoke helper | Complete |
| Generated model binaries excluded from Git | Complete |
| Python unit/smoke tests | Complete |
| Production metrics/winner selection | Correctly deferred to Phase 5 |
| Live API integration | Correctly deferred to Phase 6 |

## Important label-contract correction

Phase 4 requires **water-strike depth** as its depth-regression target. The Phase 3 feature artifact previously exposed total `depthFt` but not `waterStrikeFt`.

This branch therefore extends the Phase 3 labels additively:

```json
"labels": {
  "success": true,
  "depthFt": 320,
  "waterStrikeFt": 245,
  "yieldLpm": 55
}
```

`waterStrikeFt` remains outside the feature matrix and is consumed only as the Phase 4 depth target. Total `depthFt` remains available as a separate label/context value but is not substituted for water-strike depth.

## Model tasks and candidates

### Success

Target: `labels.success`

Candidates:

- Logistic Regression
- Random Forest Classifier
- XGBoost Classifier
- LightGBM Classifier

Output contract: probability in `[0, 1]` from `predict_proba`.

### Depth

Target: `labels.waterStrikeFt`

Candidates:

- Ridge Regression baseline
- Random Forest Regressor
- XGBoost Regressor
- LightGBM Regressor

### Yield

Target: `labels.yieldLpm`

Candidates:

- Ridge Regression baseline
- Random Forest Regressor
- XGBoost Regressor
- LightGBM Regressor

A central yield estimate is trained in Phase 4. A validated **yield range** must come from Phase 5 uncertainty/interval analysis rather than an arbitrary fixed band.

## Artifact and provenance contract

A model run records:

- Phase 3 dataset version
- Phase 3 dataset hash
- source-manifest hash
- feature schema version
- exact 26 feature names
- random seed
- training profile
- minimum-row rule
- requested candidates
- Python/NumPy/pandas/scikit-learn/joblib/XGBoost/LightGBM versions
- task-level eligible row counts and label summaries
- represented spatial block IDs
- estimator hyperparameters
- model artifact path, SHA-256 and byte size
- explicit Phase 5 evaluation status

The run manifest has its own `.sha256` sidecar.

## Verification performed

The Phase 4 Python suite was executed locally against the implemented code:

- **7 tests passed**
- **0 failed**

The tests cover:

1. exact 26-feature contract,
2. water-strike depth target selection,
3. label-leakage rejection,
4. roadmap candidate registry,
5. three-task artifact training without metrics/winner selection,
6. serialized-model offline inference,
7. insufficient-data blocking.

A separate all-candidate smoke training run was also executed with the test profile and synthetic contract data. In the available local environment it successfully trained:

- success: Logistic Regression, Random Forest, XGBoost, LightGBM
- depth: Ridge, Random Forest, XGBoost, LightGBM
- yield: Ridge, Random Forest, XGBoost, LightGBM

That smoke run verifies implementation compatibility only. It is **not** a real BoreSakshi performance result and its synthetic artifacts are not committed.

## Files added

- `ml/boresakshi_ml/__init__.py`
- `ml/boresakshi_ml/schema.py`
- `ml/boresakshi_ml/data.py`
- `ml/boresakshi_ml/models.py`
- `ml/boresakshi_ml/training.py`
- `ml/boresakshi_ml/inference.py`
- `ml/train.py`
- `ml/requirements.txt`
- `ml/requirements-candidates.txt`
- `ml/.gitignore`
- `ml/tests/test_phase4.py`
- `ml/README.md`
- `docs/phase-4-real-ml-model.md`
- `docs/phase-4-completion-report.md`

## Existing files extended

- `server/featurePipeline.js` — carries `waterStrikeFt` as a separate label
- `server/test/featurePipeline.test.js` — verifies water-strike label and leakage separation

## Why no production model binary is committed

A real Phase 4 model must be trained from the **reviewed real Phase 3 feature artifact**. The repository intentionally gitignores raw geospatial data and generated feature/model artifacts, and no approved real feature artifact is currently committed to this branch.

Creating a model from synthetic/demo data and calling it the BoreSakshi real model would violate the project rule against fake metrics/data claims. Therefore the software pipeline is complete, while the production candidate training run is correctly gated on the reviewed Phase 3 artifact.

## Phase 5 handoff

Phase 5 should take the registered candidate configurations/artifacts and perform spatially grouped scientific evaluation. It should publish actual measured:

- classification Accuracy, Precision, Recall, F1, ROC-AUC and Brier score,
- regression MAE, RMSE and R²,
- probability calibration,
- prediction/uncertainty intervals including the yield range,
- geographic and feature-coverage analysis.

Only Phase 5 should mark a candidate as selected. Only after that selection should Phase 6 expose the model through the Python ML service and integrate it into live BoreSakshi predictions.
