# BoreSakshi Phase 6 Completion Report

**Phase:** 6 — Python ML Service & Live Inference Integration  
**Implementation branch:** `phase-6-python-ml-service`  
**Base branch:** `phase-5-scientific-evaluation`  
**Pull request:** #6  
**Status:** Software implementation complete and CI-verified. Production ML activation remains intentionally gated on the reviewed real Phase 3/4/5 artifacts plus explicit Phase 6 approval.

## Goal completed

Phase 6 implements the planned runtime path:

```text
Node API
  → Python ML API
  → live feature extraction
  → selected model bundle
  → calibrated / uncertainty-aware prediction
  → Node persistence + accountability ledger
```

It preserves the existing BoreSakshi farmer/API contract while replacing the prediction backend with a review-gated Python service when an approved model bundle is available.

## Scope completed

| Planned Phase 6 capability | Result |
|---|---|
| Python ML HTTP service | Complete — FastAPI |
| `POST /ml/predict` | Complete |
| `GET /ml/model-info` | Complete |
| `GET /ml/health` | Complete |
| Load Phase 5-selected models | Complete |
| Phase 4 manifest checksum verification | Complete |
| Phase 5 manifest checksum verification | Complete |
| Selected model artifact checksum verification | Complete |
| Success calibrator checksum verification | Complete |
| Depth/yield interval checksum verification | Complete |
| Live source-file checksum verification | Complete |
| Training/live dataset-version match | Complete |
| Explicit Phase 6 approval gate | Complete |
| Live 26-feature geospatial extraction | Complete |
| DEM terrain features | Complete |
| Hydrology features | Complete |
| Geology/lineament features | Complete |
| Rainfall/anomaly features | Complete |
| NDVI/NDWI/LULC features | Complete |
| Verified historical borewell features | Complete |
| Verified-only prediction evidence | Complete |
| Dynamic source timestamp cutoff | Complete |
| Calibrated success probability | Complete — Phase 5 Platt calibrator |
| Water-strike depth range | Complete — Phase 5 conformal interval |
| Yield range | Complete — Phase 5 conformal interval |
| Low / Medium / High confidence | Complete |
| Model version | Complete |
| Feature version | Complete |
| Prediction timestamp | Complete |
| Uncertainty metadata | Complete |
| Feature coverage report | Complete |
| Coverage warning | Complete |
| Minimum coverage refusal | Complete — HTTP 422 |
| Local explanations | Complete — labelled feature-ablation sensitivity |
| Node → Python client | Complete |
| Request timeout | Complete |
| Retry policy | Complete |
| Circuit breaker | Complete |
| Half-open recovery | Complete |
| ML readiness in Node health | Complete |
| Explicit heuristic fallback | Complete |
| Fallback never labelled as ML | Complete |
| Existing prediction persistence | Preserved |
| Existing public ledger | Preserved |
| Existing farmer response fields | Preserved additively |
| Farmer model/fallback provenance UI | Complete |
| Farmer uncertainty UI | Complete |
| Production Vite build | Passing |
| Phase 6 CI | Passing |

## Python ML service

### Endpoints

Phase 6 exposes:

```text
POST /ml/predict
GET  /ml/model-info
GET  /ml/health
```

The service starts in a safe **not-ready** state unless all required artifact/source paths are configured and:

```text
BORESAKSHI_PHASE6_APPROVED=YES
```

Without that explicit approval, `/ml/health` returns HTTP 503 and Node uses the visibly labelled heuristic fallback.

## Artifact integrity chain

Before becoming ready, the service verifies:

1. Phase 4 `run-manifest.json` against its SHA-256 sidecar.
2. Phase 5 `evaluation-manifest.json` against its SHA-256 sidecar.
3. Phase 5 evaluation references the configured Phase 4 run.
4. Phase 4/5 dataset hashes match.
5. Phase 5 has no blocked tasks.
6. Phase 5 scientific evaluation is marked complete.
7. selected success/depth/yield binaries match their SHA-256 values.
8. selected success calibration artifact matches its SHA-256.
9. selected depth/yield interval artifacts match their SHA-256 values.
10. live geospatial source files match the checksums in the feature manifest.
11. the live source `datasetVersion` matches the model-training dataset version.

A mismatch prevents ML readiness rather than serving an ambiguous model bundle.

## Live feature extraction

`ml/boresakshi_ml/live_features.py` implements the Phase 3 feature contract for inference time.

The runtime extractor produces the same 26 model fields from terrain, hydrology, geology, lineaments, rainfall, satellite/LULC and nearby verified borewells.

Dynamic layers are selected only when their `observedAt` timestamp is not later than the prediction timestamp.

No geospatial value is silently invented by this extraction layer. Missing values remain missing until they reach the preprocessing pipeline fitted during Phase 4.

## Trusted nearby evidence

Node now filters prediction evidence to:

```text
verified === true
flagged !== true
datasetEligibility.eligible !== false
```

The Python layer repeats those checks defensively and additionally requires the drilling timestamp to be strictly earlier than the prediction timestamp.

Unverified operator submissions therefore cannot change live predictions merely by being submitted.

## Prediction output

The Python service returns:

- calibrated success probability
- central water-strike depth estimate
- conformal water-strike min/max
- central yield estimate
- conformal yield min/max
- confidence label
- model version
- feature version
- prediction timestamp
- uncertainty metadata
- live feature coverage
- coverage warning
- local explanations

Node maps these values into the existing farmer response contract:

- `successProbability`
- `depthBandFt`
- `expectedYieldLpm`
- `confidence`
- `rockType`
- `basis`
- `factors`
- `confidenceReason`

and additively persists Phase 6 provenance fields.

## Calibration and uncertainty

### Success

The selected Phase 4 classifier produces a raw probability. The selected Phase 5 Platt calibrator then generates the probability exposed to the farmer.

Uncertainty metadata includes:

- raw probability
- calibrated probability
- normalized binary entropy
- maximum class probability

### Depth / yield

The selected Phase 5 conformal radii create non-negative uncertainty ranges around the selected Phase 4 regression models.

These are the scientifically generated Phase 5 range artifacts rather than arbitrary fixed ± percentages.

## Feature coverage policy

Default configuration:

```text
BORESAKSHI_MIN_FEATURE_COVERAGE_PCT=60
BORESAKSHI_WARN_FEATURE_COVERAGE_PCT=80
```

- below minimum → Python rejects inference with `INSUFFICIENT_FEATURE_COVERAGE` (422)
- between minimum and warning → ML prediction returned with visible warning
- above warning → normal ML result

A coverage 422 is treated as a valid model-domain refusal, not a service-health failure, and does not count toward the Node circuit breaker.

## Node service client

`server/mlClient.js` implements:

- configurable service URL
- request timeout
- retry for network / 5xx / 429 failures
- no retry for non-retryable model-domain 4xx responses
- consecutive-failure circuit breaker
- cooldown / half-open state
- health and model-info requests
- status snapshots for `/api/health`

Default values:

```text
ML_SERVICE_URL=http://127.0.0.1:8000
ML_SERVICE_TIMEOUT_MS=2500
ML_SERVICE_RETRIES=1
ML_CIRCUIT_FAILURE_THRESHOLD=3
ML_CIRCUIT_COOLDOWN_MS=30000
```

## Explicit failure / fallback policy

The previous deterministic predictor is retained only as a safety fallback.

It is used when the ML service is unavailable, not approved/ready, timed out, returns retryable errors after retries, has an open circuit, or rejects the location for insufficient feature coverage.

Fallback is always marked:

```json
{
  "predictionSource": "heuristic_fallback",
  "isMock": true,
  "modelAvailable": false,
  "modelVersion": null,
  "featureVersion": null
}
```

It also carries a visible warning and no calibrated uncertainty claim.

This satisfies the governing rule that BoreSakshi must never silently fall back to a heuristic while presenting the answer as ML.

## Explainability

Real ML responses include local success-probability sensitivity values generated by ablating one available feature to the trained pipeline's imputation baseline.

Each explanation is explicitly labelled:

```text
single_feature_ablation_to_pipeline_imputation
```

These are local sensitivity values, **not SHAP values**, and unlike the old deterministic heuristic decomposition they are not expected to sum to the final probability.

## Farmer UI

The existing prediction card now surfaces:

- trained ML vs heuristic fallback
- prominent fallback warning
- feature-coverage warning
- model version
- feature version
- prediction timestamp
- calibrated probability uncertainty
- depth/yield interval information
- live feature coverage
- corrected explanation semantics

The advisory remains clear that groundwater prediction is probabilistic and not a drilling guarantee.

## Health / observability

### Python

`/ml/health` reports ready only when the approved bundle and live feature sources are fully loaded.

`/ml/model-info` exposes:

- model / feature versions
- Phase 4 run ID
- Phase 5 evaluation ID
- selected candidate identities
- dataset metadata
- Phase 4/5/source-manifest checksums
- feature-coverage serving policy

Prediction logs capture duration, model version, confidence and coverage without logging the full feature vector.

### Node

`/api/health` continues to use database health for Node API availability, while additively reporting Python ML readiness and circuit state.

A Python outage therefore does not falsely mark Mongo/Node as unavailable.

## Rollback

Immediate rollback does not require a schema migration:

1. remove/change `BORESAKSHI_PHASE6_APPROVED=YES`, or
2. take the Python service out of routing/change `ML_SERVICE_URL`.

Node then visibly falls back.

A model-version rollback is performed by pointing Phase 4/5 environment paths to a previously reviewed checksummed bundle and restarting Python.

No automatic model promotion/replacement is introduced by Phase 6.

## Verification performed

### CI-caught defect and correction

The first Phase 6 Python CI run correctly detected an ESRI ASCII parser issue: Python eagerly evaluated a missing `xllcenter`/`yllcenter` fallback even when valid `xllcorner`/`yllcorner` headers were present.

The parser was corrected to select the present corner header explicitly. The complete CI matrix was then rerun on commit:

```text
f888d3bef29108a99e79c936c4136d3a8525c5fd
```

### Phase 6 ML Service workflow

Final result: **success**.

#### Python service tests

```text
16 passed
0 failed
2 dependency deprecation warnings
16.30s
```

The 16 tests cover the accumulated Phase 4/5 contracts plus Phase 6 source checksums, verified-only history, explicit serving approval, selected bundle loading, calibrated predictions/ranges, and FastAPI endpoints.

#### Node orchestration tests

```text
6 passed
0 failed
```

Coverage:

1. health probe does not retry,
2. retryable 5xx prediction retries and succeeds,
3. coverage 422 is surfaced without retry,
4. circuit breaker opens after consecutive transport failures,
5. real ML output maps additively into the legacy farmer contract,
6. heuristic fallback never masquerades as ML.

Node syntax checks also passed for:

- `server/mlClient.js`
- `server/predict.js`
- `server/index.js`

#### Farmer web build

Production Vite build: **success**.

### Preceding-phase compatibility

On the same corrected Phase 6 code commit:

- **Phase 4 ML workflow:** success
- **Phase 5 Scientific Evaluation workflow:** success

This verifies that the serving integration did not break the preceding feature/training/evaluation contracts.

## Files added

- `ml/boresakshi_ml/live_features.py`
- `ml/boresakshi_ml/serving.py`
- `ml/service.py`
- `ml/.env.example`
- `ml/tests/test_phase6.py`
- `server/mlClient.js`
- `server/test/mlClient.test.js`
- `server/test/predictPhase6.test.js`
- `.github/workflows/phase6-service.yml`
- `docs/phase-6-python-ml-service.md`
- `docs/phase-6-completion-report.md`

## Files extended

- `ml/requirements.txt`
- `ml/README.md`
- `server/predict.js`
- `server/index.js`
- `server/package.json`
- `server/.env.example`
- `server/README.md`
- `web/src/components/PredictionPanel.jsx`
- root `README.md`

## Production status

**Phase 6 software is complete. Production ML is not being claimed as enabled by this implementation alone.**

The repository intentionally does not contain the reviewed real-data Phase 3 feature artifact and corresponding production Phase 4/5 generated binaries/evaluation directory. Synthetic CI artifacts prove the runtime contracts only and are not BoreSakshi production evidence.

Production activation requires the real reviewed artifacts and:

```text
BORESAKSHI_PHASE6_APPROVED=YES
```

Until then, the Python service remains not-ready and the farmer API clearly identifies the deterministic fallback.

## Production enablement checklist

Before setting the approval flag:

- [ ] reviewed real Phase 5 run has no blocked tasks
- [ ] Phase 5 promotion checklist explicitly approved
- [ ] Phase 4/5 manifest checksums archived and verified
- [ ] selected success/depth/yield model checksums verified
- [ ] selected success calibrator checksum verified
- [ ] selected depth/yield interval checksums verified
- [ ] live feature-manifest dataset version matches model training version
- [ ] all live geospatial source checksums verified
- [ ] feature coverage thresholds approved for the supported service geography
- [ ] `/ml/health` reviewed as ready before traffic
- [ ] `/ml/model-info` model/feature/checksum metadata reviewed
- [ ] end-to-end `/api/predict` smoke test returns `predictionSource=ml`
- [ ] forced-outage smoke test returns visible `predictionSource=heuristic_fallback`
- [ ] prediction persistence includes modelVersion/featureVersion/timestamp
- [ ] rollback bundle/environment values documented

Only after that checklist should real farmer traffic be routed to the selected ML bundle.
