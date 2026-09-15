# Phase 7 — Replace the Mock Prediction Engine

## Roadmap goal

**Connect the real model without breaking the frontend.**

The planned runtime flow is now enforced as:

```text
farmer selects location
    ↓
Node API validates request
    ↓
trusted nearby borewell evidence is selected
    ↓
Python feature service extracts versioned inputs
    ↓
Python ML service predicts
    ↓
Phase 7 prediction contract is validated
    ↓
Node stores prediction + provenance
    ↓
existing frontend displays the result
```

Phase 6 built the service and Node integration. Phase 7 closes the remaining production-activation gaps required by the original roadmap and audit: immutable feature-snapshot references, an explicit versioned prediction boundary contract, malformed-response rejection, and a checksummed real-artifact activation preflight.

## Existing frontend contract preserved

The existing farmer fields remain available:

- `successProbability`
- `depthBandFt`
- `expectedYieldLpm`
- `confidence`
- `rockType`
- `basis`
- `factors`
- `confidenceReason`
- nearby verified well summary

The real-model path additively carries the planned fields:

- `modelVersion`
- `predictionTimestamp`
- `featureVersion`
- `confidence`
- `uncertainty`
- `explanations`
- `coverageWarning`

Phase 7 also persists:

- `predictionContractVersion`
- `featureSnapshotRef`
- `featureSnapshot`

These additions do not remove legacy frontend fields.

## Versioned prediction contract

The Python and Node boundaries both enforce prediction contract version `1.0.0`.

A response can be treated as `predictionSource=ml` only when it contains valid:

- success probability in `[0, 100]`
- ordered non-negative depth interval
- ordered non-negative yield interval
- `Low`, `Medium`, or `High` confidence
- non-empty model version
- non-empty feature version
- prediction timestamp
- uncertainty object
- explanations array
- feature coverage in `[0, 100]`
- coverage-warning field, including explicit `null`
- immutable feature-snapshot reference
- `predictionSource=ml`
- `isMock=false`

If Python itself produces an invalid contract, `/ml/predict` fails rather than returning malformed ML.

If the Node client receives a malformed ML response, `server/predictionContract.js` rejects it with `ML_CONTRACT_INVALID`; normal Phase 6 failure policy then returns the explicitly labelled heuristic fallback.

A malformed response therefore cannot be persisted as real ML.

## Feature snapshot reference

The audit required prediction records to retain a feature-snapshot reference rather than only a model version.

Phase 7 defines a deterministic snapshot from:

```text
datasetVersion
featureVersion
featureManifestSha256
predictionAsOf
```

The canonical JSON representation is SHA-256 hashed and exposed as:

```text
featureSnapshotRef = fsnap:<sha256>
```

The referenced source manifest is already checksum-locked by Phase 6. Dynamic source selection is deterministic for `predictionAsOf`, so this reference identifies the serving-time source snapshot needed to reproduce feature extraction from the immutable source set.

Example:

```json
{
  "featureSnapshotRef": "fsnap:...",
  "featureSnapshot": {
    "ref": "fsnap:...",
    "datasetVersion": "geo-v1",
    "featureVersion": "geo-v1:features-1.0.0",
    "featureManifestSha256": "...",
    "predictionAsOf": "2026-09-15T00:00:00Z"
  }
}
```

The snapshot's feature version and timestamp must match the top-level prediction metadata.

## Real-artifact activation preflight

Phase 7 adds:

```text
ml/activate.py
```

It is deliberately a **preflight/report tool**, not an automated deployment command.

With the reviewed real artifacts configured:

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

1. checksum-validates the Phase 4/5/source artifact chain through `ServingBundle`;
2. requires the explicit serving approval flag;
3. executes one real-model smoke prediction at the supplied location;
4. attaches the Phase 7 snapshot metadata;
5. validates the complete prediction contract;
6. verifies prediction model/feature versions match the loaded bundle;
7. writes a checksummed activation report.

Output:

```text
activations/<candidate>/
├── phase7-activation-report.json
└── phase7-activation-report.sha256
```

Generated activation reports are gitignored because they refer to deployment-specific artifacts.

## Activation report semantics

A successful preflight report says:

```text
status = ready_for_human_activation_review
productionActivated = false
```

That distinction is intentional. The tool proves that the configured real bundle can serve the Phase 7 contract; it does **not** route farmer traffic, edit infrastructure, replace a production model, or bypass review.

The report records:

- activation ID
- model version
- feature version
- prediction contract version
- feature snapshot reference
- Phase 4 run ID/checksum
- Phase 5 evaluation ID/checksum
- training dataset metadata
- live feature-manifest checksum
- selected model identities/checksums
- smoke prediction probability/ranges/confidence/coverage
- explicit human-review gate

## Failure policy

Phase 7 retains the Phase 6 reliability policy.

Real ML can be rejected because of:

- model service unavailable/not-ready
- timeouts/network failures
- retryable service failures
- open circuit breaker
- insufficient live feature coverage
- checksum/version mismatch
- malformed prediction contract

When fallback is enabled by the existing Node path, the result remains unmistakably marked:

```text
predictionSource = heuristic_fallback
isMock = true
modelAvailable = false
modelVersion = null
featureSnapshotRef = null
```

No fallback output carries calibrated ML uncertainty or a fake model version.

## Storage/accountability

The existing Node `/api/predict` persistence uses object spread over the mapped prediction response. Therefore real predictions now store the Phase 7 provenance metadata together with the existing prediction fields:

- model version
- feature version
- prediction timestamp
- prediction contract version
- feature snapshot reference/object
- uncertainty
- explanations
- coverage/warnings

The existing prediction-vs-actual accountability ledger remains unchanged and can continue closing saved predictions when verified outcomes arrive.

## CI verification

`.github/workflows/phase7-real-prediction.yml` verifies:

### Python

- accumulated Phase 4–7 tests
- deterministic feature snapshot IDs
- snapshot timestamp/version behavior
- `/ml/predict` complete Phase 7 contract
- tampered snapshot rejection
- checksummed activation report
- activation report does not self-activate production

### Node

- Phase 6 timeout/retry/circuit behavior
- existing ML response mapping
- Phase 7 contract validation
- impossible range rejection
- missing snapshot rejection
- malformed ML → explicit fallback
- syntax checks across the prediction path

### Frontend

The existing Vite farmer frontend must still build successfully against the additive contract.

## Production boundary

Phase 7 software can be completed and reviewed without pretending the repository contains a production model.

A **real BoreSakshi v1 activation report cannot honestly be generated until the reviewed real Phase 3 feature/source assets and corresponding real Phase 4/5 generated model/evaluation artifacts are available in the deployment environment.**

CI synthetic artifacts prove the software contract only. They are not production groundwater-performance evidence.

Phase 7 therefore completes the real prediction-engine implementation and activation gate, while actual farmer traffic remains dependent on the reviewed real artifact chain and human approval.
