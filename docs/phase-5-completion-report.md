# BoreSakshi Phase 5 Completion Report

**Phase:** 5 — ML Evaluation & Scientific Validation  
**Implementation branch:** `phase-5-scientific-evaluation`  
**Base branch:** `phase-4-real-ml-model`  
**Pull request:** #5  
**Status:** Software implementation complete; real-data evaluation/promotion remains gated on the reviewed Phase 3 feature artifact + Phase 4 production candidate run.

## Phase boundary

Phase 5 owns scientific evaluation and candidate selection. It does not serve the model.

- Phase 5: spatial validation, measured metrics, calibration, uncertainty/ranges, confidence intervals, coverage analysis, candidate selection.
- Phase 6: Python ML inference service, selected-bundle loading, Node → Python integration, live `/api/predict` replacement.

Every Phase 5 selection remains `servingApproved=false` and `promotionStatus=scientifically_selected_pending_review` until explicit review and Phase 6 implementation.

## Scope completed

| Planned Phase 5 capability | Result |
|---|---|
| Spatial validation | Complete — grouped by Phase 3 `spatialBlockId` |
| Classification spatial splitter | Complete — StratifiedGroupKFold |
| Regression spatial splitter | Complete — GroupKFold |
| Prevent scoring all-data fitted model | Complete — exact Phase 4 pipeline cloned/retrained inside folds |
| Phase 4 run checksum verification | Complete |
| Candidate artifact checksum verification | Complete |
| Dataset version/hash/schema matching | Complete |
| Accuracy | Complete |
| Precision | Complete |
| Recall | Complete |
| F1 | Complete |
| ROC-AUC | Complete |
| Brier score | Complete |
| MAE | Complete |
| RMSE | Complete |
| R² | Complete |
| Probability calibration | Complete — nested spatial OOF Platt scaling |
| Expected Calibration Error | Complete |
| Reliability/calibration bins | Complete |
| Classification uncertainty | Complete — entropy + confidence/coverage curves |
| Depth uncertainty/range | Complete — conformal interval |
| Yield uncertainty/range | Complete — conformal interval |
| Interval empirical coverage | Complete |
| Interval width analysis | Complete |
| Metric confidence intervals | Complete — spatial-block bootstrap |
| Geographic coverage | Complete — bounds + block counts |
| Temporal coverage | Complete |
| Feature missingness coverage | Complete — all 26 Phase 3 features |
| Per-spatial-block metrics | Complete |
| Minimum labelled-row gate | Complete |
| Minimum spatial-block gate | Complete |
| Classification class/block gate | Complete |
| Regression distinct-target gate | Complete |
| Deterministic success candidate selection | Complete |
| Deterministic depth candidate selection | Complete |
| Deterministic yield candidate selection | Complete |
| Selected success calibrator artifact | Complete — checksummed joblib |
| Selected depth interval artifact | Complete — JSON |
| Selected yield interval artifact | Complete — JSON |
| Human-readable evaluation report | Complete |
| Machine-readable evaluation manifest | Complete |
| Evaluation manifest SHA-256 | Complete |
| Promotion gate | Complete — serving remains disabled |
| Phase 5 CI | Complete and passing |

## Scientific validation design

### Outer spatial evaluation

Success candidates use stratified grouped spatial folds. Depth and yield candidates use grouped spatial folds. A spatial block is never present in both train and test inside one outer fold.

The Phase 4 fitted model artifact is not directly scored because it was trained on the complete dataset. Phase 5 loads it only to recover the exact serialized preprocessing/model configuration, then clones and refits it on each outer training split.

### Nested calibration

For success classification, Platt scaling is fitted from inner spatial out-of-fold predictions generated only from the outer-training blocks. The calibrator is then applied to untouched outer-test predictions.

Calibration fallback is explicitly recorded when an inner split cannot support calibration.

### Nested conformal uncertainty

For depth and yield, inner spatial out-of-fold residuals from the outer-training blocks determine the conformal radius. That radius is applied only to the untouched outer-test predictions.

Default target interval coverage is 90%, with non-negative lower bounds for physical outputs.

## Metrics implemented

### Success classification

Measured from spatial OOF predictions:

- Accuracy
- Precision
- Recall
- F1
- ROC-AUC
- Brier score

Raw and calibrated probability metrics are both retained.

### Calibration

- Expected Calibration Error (ECE)
- reliability bins
- Brier change after calibration
- calibration fallback fold count

### Classification uncertainty

- normalized binary entropy
- maximum class probability
- coverage and accuracy at confidence thresholds 0.55, 0.65, 0.75, 0.85

### Depth / yield regression

- MAE
- RMSE
- R²
- negative-prediction percentage

### Regression prediction intervals

- target coverage
- empirical held-out coverage
- evaluated rows
- mean interval width
- median interval width

## Confidence intervals

Phase 5 computes metric confidence intervals using spatial-block bootstrap resampling rather than row-wise bootstrap resampling.

Defaults:

- 500 bootstrap iterations
- 95% confidence level

Classification confidence intervals cover Accuracy, Precision, Recall, F1, ROC-AUC and Brier.

Regression confidence intervals cover MAE, RMSE and R².

## Coverage analysis

Each task report includes:

- eligible labelled rows
- number of spatial blocks
- rows per spatial block
- latitude/longitude coverage bounds from Phase 3 metadata
- earliest/latest `asOf`
- average Phase 3 feature coverage
- missing percentage for each of the 26 features
- per-block candidate performance

Coordinates are used for reporting geographic coverage only and remain excluded from the model feature matrix.

## Candidate selection policy

### Success

1. lowest calibrated Brier score
2. highest ROC-AUC
3. highest F1

### Depth / yield

1. lowest MAE
2. lowest RMSE
3. highest R²

The selected candidate is scientifically selected but not automatically production-approved.

## Generated Phase 5 artifacts

```text
evaluations/<evaluation-id>/
├── evaluation-manifest.json
├── evaluation-manifest.sha256
├── evaluation-report.md
└── selected/
    ├── success/
    │   └── platt-calibrator.joblib
    ├── depth/
    │   └── interval.json
    └── yield/
        └── interval.json
```

Generated evaluation files are gitignored.

## Verification performed

### Phase 5 Scientific Evaluation workflow

GitHub Actions run completed successfully.

- status: **success**
- Python tests: **12 passed**
- failures: **0**
- runtime reported by pytest: **18.59s**

Those 12 tests include the existing Phase 4 ML tests plus the new Phase 5 scientific-evaluation tests.

Phase 5 tests cover:

1. requested classification/regression metric primitives,
2. calibration/ECE,
3. conformal interval calculations,
4. Phase 4 run-manifest checksum enforcement,
5. spatial grouped OOF candidate evaluation,
6. deterministic candidate selection,
7. `servingApproved=false` promotion gating,
8. spatial-block bootstrap confidence intervals,
9. selected calibration/interval artifact creation,
10. geographic and feature-coverage reporting,
11. audit/report artifact output,
12. insufficient-spatial-coverage blocking.

### Phase 4 compatibility workflow

The inherited **Phase 4 ML** workflow also completed successfully on the Phase 5 PR head.

- Python ML test job: **success**
- Phase 3→4 feature-contract/syntax job: **success**

This confirms Phase 5 did not break the preceding feature/training contracts.

## Files added

- `ml/boresakshi_ml/metrics.py`
- `ml/boresakshi_ml/evaluation.py`
- `ml/boresakshi_ml/scientific.py`
- `ml/evaluate.py`
- `ml/tests/test_phase5.py`
- `.github/workflows/phase5-evaluation.yml`
- `docs/phase-5-scientific-evaluation.md`
- `docs/phase-5-completion-report.md`

## Files extended

- `ml/boresakshi_ml/__init__.py`
- `ml/.gitignore`
- `ml/README.md`
- `README.md`

## Why no BoreSakshi production metrics are printed here

The repository intentionally does not commit the reviewed real Phase 3 feature artifact or the generated Phase 4 production candidate binaries.

Therefore the automated tests use synthetic contract data to verify implementation behavior only. Their metric values are **not** BoreSakshi accuracy claims.

Real Accuracy, Precision, Recall, F1, ROC-AUC, Brier, MAE, RMSE, R², calibration, confidence intervals and interval coverage must be generated by running `ml/evaluate.py` against the reviewed real Phase 3/Phase 4 artifacts.

This avoids presenting demo/synthetic numbers as scientific evidence.

## Real-data Phase 5 command

```bash
cd ml
python evaluate.py \
  --dataset ../server/feature-artifacts/features-v1.json \
  --phase4-run artifacts/phase4-real-v1 \
  --out evaluations \
  --evaluation-id phase5-real-v1
```

The command returns non-zero if a task fails its scientific readiness gate.

## Phase 6 promotion gate

Before live serving starts, review and approve:

- [ ] real Phase 5 run has no blocked tasks
- [ ] source dataset/run checksums match
- [ ] row counts and spatial-block coverage are sufficient
- [ ] geographic bounds are appropriate for claimed service area
- [ ] feature missingness is acceptable
- [ ] per-block performance has no unacceptable weak regions
- [ ] success Accuracy/Precision/Recall/F1/ROC-AUC/Brier reviewed
- [ ] calibration/ECE and reliability bins reviewed
- [ ] metric confidence intervals reviewed
- [ ] depth MAE/RMSE/R² reviewed
- [ ] yield MAE/RMSE/R² reviewed
- [ ] depth/yield interval coverage and width reviewed
- [ ] selected candidate rationale reviewed
- [ ] calibrator/interval artifacts archived with checksums
- [ ] explicit approval recorded for Phase 6

Only after that review should Phase 6 load the selected model bundle and replace the live deterministic prediction path.
