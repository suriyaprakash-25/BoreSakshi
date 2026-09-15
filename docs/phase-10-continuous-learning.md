# BoreSakshi Phase 10 — Continuous Learning / Adaptive Retraining

## Goal

Phase 10 implements the approved adaptive-retraining loop without turning BoreSakshi into an unsafe auto-training system.

The lifecycle is:

```text
Prediction issued
   ↓
Actual borewell drilled
   ↓
Outcome submitted
   ↓
Phase 9 verification
   ↓
Verified dataset updated
   ↓
Training dataset version frozen
   ↓
Candidate models trained
   ↓
Spatial scientific evaluation
   ↓
Compared with current production model
   ↓
Human approval
   ↓
Staged deployment
   ↓
Explicit activation
   ↓
Monitoring
   ↓
Human rollback if required
```

This is **continuous learning / adaptive retraining**, not reinforcement learning.

## Core safety rule

Phase 10 never performs:

```text
new upload → overwrite production model
```

A verified outcome may only affect a future candidate dataset. It does not directly change the production model.

## Verified-data-only gate

The incoming feature dataset must explicitly declare:

- `phase2EligibilityRequired=true`
- `phase9VerifiedLifecycleRequired=true`
- `targetOutcomeExcludedFromFeatures=true`
- a non-empty `datasetVersion`
- a non-empty `datasetHash`
- at least one training row

This means `SUBMITTED`, `UNDER_REVIEW`, `REJECTED`, flagged, or otherwise dataset-ineligible operator records cannot enter Phase 10 through the approved Phase 3 dataset builder.

## Training dataset version

Each Phase 10 run writes a checksummed immutable `training-dataset-version.json` containing:

- continuous-learning schema version
- run ID
- dataset version
- dataset hash
- dataset-file SHA-256
- feature-manifest path and SHA-256
- row count
- leakage-policy snapshot
- explicit Phase 9 trust requirement
- frozen status

The large dataset itself can remain outside Git/object storage; the run records the exact path and checksum used by training.

## Candidate training

Phase 10 reuses the existing Phase 4 candidate-training implementation instead of introducing a second modelling stack.

Candidate training therefore preserves:

- the exact 26-feature contract
- no raw lat/lng model inputs
- existing preprocessing
- success classification candidates
- depth regression candidates
- yield regression candidates
- checksummed model artifacts
- deterministic seeds/configuration

## Scientific evaluation

Every candidate is evaluated through the existing Phase 5 spatial scientific evaluation implementation.

The candidate must have no blocked tasks before production comparison occurs.

This preserves:

- spatial grouped validation
- success calibration
- Brier/ROC-AUC/F1/etc.
- regression MAE/RMSE/R²
- conformal intervals
- spatial-block bootstrap confidence intervals
- Phase 5 selected-candidate artifacts

Phase 10 does not invent or publish accuracy claims outside those measured evaluation artifacts.

## Production comparison

The candidate is compared against the exact current production Phase 4/5 chain.

Default safety guards are configurable and include:

### Success

- Brier score may not regress by more than 0.02 absolute
- ROC-AUC may not regress by more than 0.02 absolute
- expected calibration error may not regress by more than 0.03 absolute

### Depth and yield

- MAE may not increase by more than 5%
- RMSE may not increase by more than 5%

### Dataset freshness

The candidate must also use:

- a dataset hash different from production training; and
- a row count greater than the production-training row count.

If any default guard fails, the candidate becomes `HOLD_FOR_HUMAN_REVIEW` rather than being silently discarded or deployed.

These thresholds are operational promotion guardrails. They are configurable and are **not universal scientific laws**.

## Human approval

A candidate never becomes deployment-eligible just because automated checks pass.

`continuous.py approve` writes a separate immutable checksummed approval artifact containing:

- reviewer identity
- approval timestamp
- written reason
- candidate-manifest checksum
- model version
- whether automated comparison guards passed
- whether an explicit comparison HOLD override was used

A HOLD cannot be approved unless `--override-comparison-hold` is explicitly supplied with a meaningful review reason.

## Staged deployment

`continuous.py stage-deployment` creates a checksummed `deployment-staged.json` only for a valid human-approved candidate.

The descriptor contains:

- deployment ID
- exact Phase 4 run directory
- exact Phase 5 evaluation directory
- exact feature manifest + SHA-256
- model version
- approval artifact + SHA-256
- candidate artifact + SHA-256
- rollback target
- monitoring requirement
- `productionActivated=false`

Staging does not switch traffic.

## Explicit activation

`continuous.py activate` requires:

```text
--confirm DEPLOY
```

plus a named actor and meaningful activation reason.

Activation atomically writes a checksummed current deployment pointer. If a previous deployment exists, the pointer stores the complete previous deployment and a history copy is written before replacement.

No deployment is activated during training, evaluation or approval.

## Runtime integration

The ML service supports:

```text
BORESAKSHI_DEPLOYMENT_MANIFEST=/path/to/deployments/current.json
```

When configured, the service loads the reviewed Phase 10 deployment pointer and resolves its exact Phase 4/5/feature-manifest paths.

The original global kill switch still applies:

```text
BORESAKSHI_PHASE6_APPROVED=YES
```

A Phase 10 pointer cannot bypass that kill switch.

The service verifies:

- deployment-pointer checksum
- deployment schema version
- `status=ACTIVE`
- `productionActivated=true`
- `deploymentApproved=true`
- feature-manifest checksum
- pointer model version matches the actually loaded Phase 4/5 bundle

Health/model-info responses expose the active deployment ID when deployment-pointer mode is used.

## Monitoring

`continuous.py monitor` accepts model-performance metrics, normally exported by the Phase 11 accountability ledger.

It can return:

- `MONITORING_INSUFFICIENT_DATA`
- `HEALTHY`
- `ROLLBACK_REVIEW_RECOMMENDED`

Monitoring never performs an automatic rollback.

Default example operational guardrails include:

- minimum scored outcomes before interpreting performance
- Brier upper bound
- depth MAE upper bound
- yield MAE upper bound

These can be configured per deployment/review policy.

## Rollback

`continuous.py rollback` requires:

```text
--confirm ROLLBACK
```

plus an actor and reason.

It restores the previous reviewed deployment recorded in the active pointer and writes rollback provenance into the restored pointer.

No database schema rollback is required because model deployment is resolved independently through the deployment pointer.

## CLI

```bash
cd ml

python continuous.py stage \
  --dataset /data/features-v2.json \
  --feature-manifest /data/feature-manifest-v2.json \
  --production-phase4-run /models/phase4-prod \
  --production-phase5-evaluation /models/phase5-prod \
  --run-id cl-2026-09-verified-v2

python continuous.py approve \
  --candidate continuous-runs/cl-2026-09-verified-v2/promotion-candidate.json \
  --reviewer "Scientific Review Board" \
  --reason "Spatial evaluation and production comparison reviewed and accepted."

python continuous.py stage-deployment \
  --candidate continuous-runs/cl-2026-09-verified-v2/promotion-candidate.json \
  --approval continuous-runs/cl-2026-09-verified-v2/approval.json \
  --deployment-id prod-2026-09-v2 \
  --current deployments/current.json

python continuous.py activate \
  --deployment continuous-runs/cl-2026-09-verified-v2/deployment-staged.json \
  --current deployments/current.json \
  --actor "release-manager" \
  --reason "Reviewed candidate approved for controlled serving." \
  --confirm DEPLOY
```

Rollback:

```bash
python continuous.py rollback \
  --current deployments/current.json \
  --actor "release-manager" \
  --reason "Observed performance exceeded reviewed post-deployment guardrails." \
  --confirm ROLLBACK
```

## Artifact chain

```text
Phase 9 VERIFIED outcomes
        ↓
Phase 3 feature dataset
        ↓
training-dataset-version.json + checksum
        ↓
Phase 4 candidate artifacts
        ↓
Phase 5 evaluation artifacts
        ↓
promotion-candidate.json + checksum
        ↓
approval.json + checksum
        ↓
deployment-staged.json + checksum
        ↓ explicit DEPLOY
current.json + checksum
```

## Phase boundary

Phase 10 software provides adaptive retraining, production comparison, approval, staged activation, monitoring recommendation and rollback mechanics.

It does **not** claim that a real retrained production model exists unless BoreSakshi has:

1. a new real Phase 9-verified dataset;
2. a new generated feature artifact;
3. completed candidate training;
4. completed spatial scientific evaluation;
5. reviewed production comparison;
6. an explicit human approval artifact;
7. an explicitly activated deployment pointer.

Synthetic CI artifacts validate the software contract only.

## Phase 11 handoff

Phase 11 must provide model-version-scoped post-deployment evidence:

- prediction correctness
- calibration/Brier measurements
- depth error
- yield error
- regional performance
- model-version performance

Those metrics become an input to Phase 10 monitoring; they must never trigger automatic model promotion or rollback by themselves.
