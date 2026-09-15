# BoreSakshi Phase 7 Completion Report

**Phase:** 7 — Replace the Mock Prediction Engine  
**Implementation branch:** `phase-7-real-prediction-activation`  
**Base branch:** `phase-6-python-ml-service`  
**Pull request:** #7  
**Status:** Software implementation complete and CI-verified. Real BoreSakshi v1 model activation still requires the reviewed deployment artifact chain and human activation review.

## Original roadmap goal

> Connect the real model without breaking the frontend.

The required flow is implemented and preserved:

```text
farmer selects location
    ↓
Node API validates request
    ↓
trusted nearby evidence is selected
    ↓
Python feature service extracts inputs
    ↓
Python ML service predicts
    ↓
Phase 7 versioned contract validation
    ↓
Node validates + stores prediction
    ↓
existing frontend displays result
```

Phase 6 implemented most of the runtime service/orchestration. Phase 7 closes the remaining original roadmap/audit requirements for real-engine activation: feature-snapshot references, strict prediction data contracts, malformed-response protection, and a checksummed real-artifact activation preflight.

## Scope completed

| Phase 7 capability | Result |
|---|---|
| Real Python model connected behind existing Node API | Complete via Phase 6 + Phase 7 enforcement |
| Existing frontend prediction contract preserved | Complete |
| Farmer location → Node validation | Complete |
| Trusted verified nearby evidence only | Complete |
| Live feature extraction | Complete |
| Python selected-model prediction | Complete |
| Node prediction persistence | Preserved |
| Existing farmer UI result display | Preserved |
| `modelVersion` | Complete |
| `predictionTimestamp` | Complete |
| `featureVersion` | Complete |
| `confidence` | Complete |
| `uncertainty` | Complete |
| `explanations` | Complete |
| `coverageWarning` | Complete |
| Versioned prediction contract | Complete — `1.0.0` |
| Feature snapshot reference | Complete |
| Feature manifest checksum in snapshot | Complete |
| Python response-contract validation | Complete |
| Node response-contract validation | Complete |
| Impossible numeric range rejection | Complete |
| Missing/tampered snapshot rejection | Complete |
| Invalid ML response never persisted as ML | Complete |
| Explicit heuristic fallback retained | Complete |
| Fallback never masquerades as ML | Complete |
| Checksummed activation preflight | Complete |
| Activation report self-deployment | Intentionally prohibited |
| Phase 7 CI | Passing |
| Farmer production frontend build | Passing |

## Versioned real-prediction contract

Phase 7 introduces prediction contract version:

```text
1.0.0
```

A response may be accepted as real ML only when it contains valid:

- success probability between 0 and 100
- non-negative ordered water-strike depth interval
- non-negative ordered yield interval
- Low / Medium / High confidence
- model version
- feature version
- prediction timestamp
- uncertainty object
- explanations array
- live feature coverage between 0 and 100
- coverage-warning field
- prediction contract version
- immutable feature-snapshot reference/object
- `predictionSource=ml`
- `isMock=false`

The Python service validates this contract before returning the prediction.

Node validates the contract again before mapping the response into the existing farmer contract or saving it.

This creates a defensive service boundary: a malformed service response cannot accidentally become a stored, user-visible “real ML” prediction.

## Immutable feature snapshot reference

Each accepted ML prediction now includes:

```text
featureSnapshotRef = fsnap:<sha256>
```

The hash is derived deterministically from canonical metadata containing:

- training/live `datasetVersion`
- `featureVersion`
- checksum-locked feature manifest SHA-256
- prediction `asOf` timestamp

The prediction additionally stores:

```json
{
  "featureSnapshot": {
    "ref": "fsnap:<sha256>",
    "datasetVersion": "...",
    "featureVersion": "...",
    "featureManifestSha256": "...",
    "predictionAsOf": "..."
  }
}
```

Phase 6 already ensures the referenced source manifest and source files are checksum-locked. Dynamic source selection is deterministic for the prediction timestamp. The snapshot reference therefore closes the audit requirement to retain the versioned feature/source context associated with a prediction.

## Node compatibility mapping

The original farmer-facing fields remain unchanged:

- `successProbability`
- `depthBandFt`
- `expectedYieldLpm`
- `confidence`
- `rockType`
- `basis`
- `factors`
- `confidenceReason`
- nearby verified well summary

Phase 7 metadata is additive:

- `modelVersion`
- `featureVersion`
- `predictionTimestamp`
- `predictionContractVersion`
- `featureSnapshotRef`
- `featureSnapshot`
- `uncertainty`
- `explanations`
- `featureCoverage`
- `coverageWarning`

The existing `/api/predict` persistence uses the mapped prediction object, so the new provenance fields are stored alongside existing prediction records without changing the ledger's existing closure/scoring behavior.

## Invalid response / fallback policy

Phase 7 extends the Phase 6 failure policy to include prediction-contract failures.

For example, Node rejects:

- missing model/feature versions
- missing feature snapshot
- snapshot reference mismatch
- invalid manifest checksum metadata
- snapshot/prediction timestamp mismatch
- snapshot/feature-version mismatch
- negative or inverted depth/yield ranges
- success probability outside 0–100
- invalid coverage values
- incorrect `predictionSource` / `isMock` state

The rejection uses:

```text
ML_CONTRACT_INVALID
```

and the existing fallback path returns:

```text
predictionSource = heuristic_fallback
isMock = true
modelAvailable = false
modelVersion = null
featureSnapshotRef = null
```

The fallback continues to carry a visible warning and no claim of calibrated ML uncertainty.

## Real-artifact activation preflight

Phase 7 adds:

```text
ml/activate.py
```

It is the v1 candidate activation **preflight**, not a deployment tool.

Example with reviewed real artifacts:

```bash
cd ml

export BORESAKSHI_PHASE4_RUN_DIR=artifacts/phase4-real-v1
export BORESAKSHI_PHASE5_EVALUATION_DIR=evaluations/phase5-real-v1
export BORESAKSHI_FEATURE_MANIFEST=../data/geo/feature-manifest.json
export BORESAKSHI_PHASE6_APPROVED=YES

python activate.py \
  --lat 11.36 \
  --lng 77.80 \
  --nearby-json ../data/activation-nearby-wells.json \
  --activation-id boresakshi-v1-candidate \
  --out activations/boresakshi-v1-candidate
```

The command:

1. loads and checksum-validates the exact Phase 4/5 serving bundle;
2. verifies live feature-source compatibility through `ServingBundle`;
3. requires the explicit approval flag;
4. executes a real-model smoke prediction;
5. attaches the immutable Phase 7 snapshot reference;
6. validates the complete Phase 7 prediction contract;
7. checks the prediction model/feature versions against the loaded bundle;
8. writes a checksummed activation report.

Output:

```text
phase7-activation-report.json
phase7-activation-report.sha256
```

Generated reports are gitignored.

## Human activation boundary

A successful report explicitly contains:

```text
status = ready_for_human_activation_review
productionActivated = false
```

It records the Phase 4/5/source checksum chain, selected model identities, model and feature versions, snapshot reference, and smoke-prediction contract fields.

The command does **not**:

- deploy infrastructure
- modify routing
- automatically replace a production model
- bypass Phase 5 scientific review
- activate farmer traffic

That preserves the roadmap's human-reviewed model promotion principle.

## Verification

Phase 7 was verified on code/documentation head:

```text
b3aa362b39af27295a80a6c3ecc4a7ec11b63d5a
```

### Phase 7 Real Prediction Engine workflow

Result: **success**.

### Python Phase 4–7 suite

```text
20 passed
0 failed
2 dependency deprecation warnings
15.60s
```

The four Phase 7 Python additions verify:

1. feature-snapshot references are deterministic and timestamp-versioned;
2. `/ml/predict` returns the complete Phase 7 contract;
3. tampered snapshot metadata is rejected;
4. activation reports are checksummed and cannot self-declare production activation.

### Node Phase 6–7 integration suite

```text
10 passed
0 failed
0 skipped
```

It verifies:

- health probe retry policy
- retryable service failure behavior
- non-retryable coverage handling
- circuit breaker
- existing real-ML compatibility mapping
- explicit outage fallback
- valid Phase 7 contract acceptance
- missing snapshot rejection
- impossible range rejection
- malformed ML response → explicit heuristic fallback

Node syntax checks passed for:

- `server/predictionContract.js`
- `server/predict.js`
- `server/mlClient.js`
- `server/index.js`

### Existing farmer frontend

Production Vite build: **success**.

No frontend contract rewrite was required.

### Preceding-phase compatibility

On the same Phase 7 head:

- Phase 4 ML workflow: **success**
- Phase 5 Scientific Evaluation workflow: **success**
- Phase 6 ML Service workflow: **success**

The Phase 7 enforcement layer therefore did not break the existing feature/training/evaluation/service contracts.

## Files added

- `ml/boresakshi_ml/phase7.py`
- `ml/activate.py`
- `ml/tests/test_phase7.py`
- `server/predictionContract.js`
- `server/test/predictionContract.test.js`
- `.github/workflows/phase7-real-prediction.yml`
- `docs/phase-7-real-prediction-engine.md`
- `docs/phase-7-completion-report.md`

## Files extended

- `ml/service.py`
- `ml/.gitignore`
- `ml/README.md`
- `server/predict.js`
- `server/test/predictPhase6.test.js`
- `server/package.json`
- root `README.md`

## Production status

**Phase 7 implementation is complete. The code path that replaces the mock with reviewed real ML is activation-ready.**

However, the repository still intentionally does not contain the reviewed real Phase 3 source/feature data plus production-generated Phase 4/5 artifact directories. Therefore this PR does not fabricate a “real BoreSakshi v1 activation report” from synthetic test data.

For production activation, the deployment environment must supply the reviewed real artifact chain, run `ml/activate.py`, review the checksummed activation report, verify `/ml/health` and `/ml/model-info`, and then explicitly approve/rout farmer traffic.

Until that happens, the system remains able to return the visibly labelled deterministic fallback rather than lying about model availability.

## Phase 7 completion decision

**Software gate: PASS.**  
**CI gate: PASS.**  
**Frontend compatibility gate: PASS.**  
**Preceding-phase compatibility gate: PASS.**  
**Real production artifact activation: PENDING deployment-time real artifacts + human review.**

The next BoreSakshi v1 roadmap phase is **Phase 8 — production rig-operator data collection**.
