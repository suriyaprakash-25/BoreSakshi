# Phase 5 — ML Evaluation & Scientific Validation

## Goal

Scientifically evaluate the real model candidates created in Phase 4 **without spatial leakage**, quantify calibration and uncertainty, analyze geographic/data coverage, and select one candidate per task using measured held-out performance.

Phase 5 does not serve predictions. The selected candidates remain review-gated (`servingApproved=false`) until Phase 6 builds the Python inference service and Node → Python integration.

## Inputs

Phase 5 requires both:

1. the exact versioned Phase 3 feature dataset used to train the Phase 4 run, and
2. the Phase 4 run directory containing `run-manifest.json`, `run-manifest.sha256`, and checksummed candidate `.joblib` artifacts.

The evaluator refuses to proceed if:

- the Phase 4 manifest checksum is invalid,
- a candidate artifact checksum is invalid,
- dataset version/hash differs from the Phase 4 training run,
- feature schema differs,
- required spatial blocks/labels are insufficient.

This makes every reported metric traceable to the exact source dataset and exact candidate definition.

## Why spatial validation instead of random splitting

Nearby groundwater records are spatially correlated. A random row split can put geographically adjacent wells in train and test sets and produce unrealistically optimistic results.

Phase 3 assigns every record a deterministic `spatialBlockId`. Phase 5 uses those groups for validation:

- success classification: `StratifiedGroupKFold`
- depth/yield regression: `GroupKFold`

No spatial block appears simultaneously in the training and outer test portion of a fold.

The already-fitted Phase 4 all-data artifact is **never directly scored as validation evidence**. It is loaded only to recover the exact serialized preprocessing/model configuration, cloned, and retrained within each evaluation fold.

## Nested calibration and uncertainty

Calibration/uncertainty must not learn from the outer held-out spatial blocks.

For every outer fold, Phase 5 performs an inner grouped out-of-fold procedure using only the outer training blocks.

### Success probability calibration

1. Generate inner spatial OOF probabilities from the outer-training data.
2. Fit a Platt calibrator on the logits of those inner OOF probabilities.
3. Train the base candidate on all outer-training blocks.
4. Predict the untouched outer test blocks.
5. Apply the calibrator to the outer-test probabilities.

If an inner fold cannot support calibration, that outer fold is transparently marked as a calibration fallback rather than fabricating a calibrated value.

### Depth/yield uncertainty

1. Generate inner spatial OOF regression predictions from outer-training blocks.
2. Compute absolute residuals only on those inner OOF predictions.
3. Calculate a finite-sample conformal residual radius for the configured coverage (default 90%).
4. Train the base candidate on all outer-training blocks.
5. Apply `prediction ± radius` to the untouched outer-test predictions, with a physical lower bound of zero.

This creates real evaluated ranges for water-strike depth and yield instead of arbitrary ± percentages.

## Classification metrics

For success probability, Phase 5 reports measured spatial OOF:

- Accuracy
- Precision
- Recall
- F1
- ROC-AUC
- Brier score

Metrics are reported for raw and calibrated probabilities. Candidate selection uses calibrated probabilities.

## Probability calibration

Phase 5 reports:

- Brier score
- Expected Calibration Error (ECE)
- reliability/calibration bins containing predicted probability and observed success rate
- Brier change after calibration
- number of folds that required calibration fallback

The final selected success candidate also receives a `platt-calibrator.joblib` artifact fitted from the candidate's complete spatial OOF probabilities. Phase 6 can pair this calibrator with the selected Phase 4 full-data base model after review.

## Classification uncertainty and selective coverage

For calibrated success probabilities Phase 5 records:

- mean normalized binary entropy
- median normalized entropy
- mean maximum class probability
- coverage and accuracy at minimum confidence thresholds of 0.55, 0.65, 0.75, and 0.85

This lets the product later communicate when the system has high confidence versus when it should be cautious or abstain.

## Regression metrics

For water-strike depth and yield Phase 5 reports measured spatial OOF:

- MAE
- RMSE
- R²
- negative prediction percentage (physical sanity signal)

The depth target remains `waterStrikeFt`, not total drilling depth.

## Prediction interval evaluation

Depth and yield candidates also report:

- target interval coverage (default 90%)
- evaluated row count
- empirical spatial-holdout coverage
- mean interval width
- median interval width

For the selected candidate, Phase 5 writes an `interval.json` artifact containing the final spatial-OOF conformal radius for Phase 6 serving.

## Metric confidence intervals

Point metrics alone can be unstable when the dataset is small or geographically clustered.

Phase 5 therefore computes confidence intervals by **bootstrapping entire spatial blocks**, not individual rows. The default is:

- 500 spatial-block bootstrap iterations
- 95% confidence level

Classification CIs cover Accuracy, Precision, Recall, F1, ROC-AUC and Brier. Regression CIs cover MAE, RMSE and R².

Rows from one sampled spatial block always move together during a bootstrap replicate, preserving within-location dependence better than row-wise bootstrap sampling.

## Geographic and data coverage analysis

Every task report includes:

- eligible labelled row count
- number of spatial blocks
- rows per spatial block
- latitude/longitude bounding box from the Phase 3 artifact (coverage reporting only; coordinates remain excluded from model inputs)
- earliest/latest target timestamp
- average Phase 3 feature coverage
- missing percentage for each of the 26 features
- per-spatial-block held-out metrics for every candidate

This prevents one aggregate score from hiding weak coverage in particular geographic blocks.

## Minimum scientific gates

By default Phase 5 requires:

- at least 30 labelled rows per task
- at least 5 spatial blocks
- both success/failure classes
- each success class represented in at least two spatial blocks
- at least two distinct regression target values
- at least one verified Phase 4 candidate artifact

These are operational safety floors, not claims that the minimum data is sufficient for production. The completion report and generated coverage report must still be reviewed before promotion.

## Candidate selection

Phase 5 performs deterministic selection from measured spatial OOF results.

### Success

Primary: lowest **calibrated Brier score**  
Tie-break 1: highest ROC-AUC  
Tie-break 2: highest F1

This favors probability quality/calibration rather than optimizing only classification accuracy.

### Depth and yield

Primary: lowest MAE  
Tie-break 1: lowest RMSE  
Tie-break 2: highest R²

Selection output is marked:

```json
{
  "promotionStatus": "scientifically_selected_pending_review",
  "servingApproved": false
}
```

Phase 5 does not mutate the Phase 4 artifact into a live production model and does not bypass human review.

## Generated artifacts

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

The evaluation manifest contains candidate-level fold metrics, calibration, confidence intervals, uncertainty, coverage, spatial-block metrics, OOF predictions, selected candidate, and source Phase 4 artifact references.

Generated evaluation artifacts are gitignored by default.

## Run Phase 5

First create a reviewed Phase 4 production candidate run from the real Phase 3 feature artifact. Then:

```bash
cd ml
python evaluate.py \
  --dataset ../server/feature-artifacts/features-v1.json \
  --phase4-run artifacts/phase4-real-v1 \
  --out evaluations \
  --evaluation-id phase5-real-v1
```

Important options:

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

The command exits non-zero if one or more tasks fail the scientific readiness gate.

## Tests

```bash
cd ml
python -m pytest -q
```

Phase 5 tests exercise:

- requested classification/regression metrics
- calibration/ECE
- conformal prediction intervals
- Phase 4 manifest checksum enforcement
- spatial OOF candidate evaluation
- deterministic model selection
- serving/promotion gate
- spatial-block bootstrap metric confidence intervals
- generated calibrator and interval artifacts
- geographic/feature coverage reporting
- blocking when spatial coverage is insufficient

GitHub Actions runs `.github/workflows/phase5-evaluation.yml` on relevant changes.

## No fabricated production metrics

The repository does not contain the approved real Phase 3 feature artifact or real Phase 4 production candidate binaries. Therefore this implementation **does not publish synthetic test metrics as BoreSakshi performance**.

Tests use synthetic contract data solely to verify that the scientific evaluation machinery works. Real Accuracy/F1/ROC-AUC/Brier/MAE/RMSE/R²/calibration/interval coverage must come from the reviewed real-data evaluation run generated by this pipeline.

## Phase 6 review gate

Before the selected models may be served:

- [ ] Phase 5 real-data evaluation completed with no blocked tasks
- [ ] spatial coverage/geographic bounds reviewed
- [ ] feature missingness reviewed
- [ ] per-block performance reviewed for obvious weak regions
- [ ] classification calibration/ECE reviewed
- [ ] metric confidence intervals reviewed
- [ ] depth/yield conformal coverage and widths reviewed
- [ ] selected candidates and tie-break rationale reviewed
- [ ] evaluation manifest/checksum archived
- [ ] selected calibrator/interval artifacts archived
- [ ] explicit approval recorded for Phase 6 integration

Only after this gate should Phase 6 expose the selected model bundle through the Python ML service and connect live `/api/predict` to it.
