# BoreSakshi — Backend (MongoDB + ML orchestration)

Node + Express + MongoDB API for borewell logging, farmer predictions, the public accountability ledger, trusted-data ingestion, and Phase 6 orchestration of the Python ML service.

- Connection: `mongodb://localhost:27017/`
- Database: `BoreSakshi`
- Core collections: `borewells`, `predictions`, `operators`, `assignments`
- Phase 2 collections: `ingestion_batches`, `staged_borewells`, `ingestion_audit`, `dataset_assets`
- Phase 3 output: versioned offline ML-ready feature artifacts under `feature-artifacts/` (gitignored)
- Phase 4/5/6 ML stack: `../ml/`

## Runtime prediction path

```text
POST /api/predict
  → load nearby borewells
  → keep verified + unflagged + dataset-eligible records only
  → call Python POST /ml/predict
  → map calibrated probability + depth/yield ranges into the existing farmer contract
  → persist prediction/model metadata
  → later close it against a verified drilling outcome in the accountability ledger
```

If Python is unavailable, times out, is not approved/ready, rejects low feature coverage, or the circuit breaker is open, the API returns the existing deterministic heuristic only as an explicitly labelled `heuristic_fallback`. It is never presented as ML.

## Run it

Start the reviewed/approved Python ML service first (see `../ml/README.md`), then:

```bash
cd server
npm install
cp .env.example .env
# edit .env — set JWT_SECRET and ML_SERVICE_URL
node seed.js            # OPTIONAL demo data
npm start               # http://localhost:4000
```

All secrets live in `server/.env` (gitignored). In production (`NODE_ENV=production`) a real `JWT_SECRET` is required.

## Tests

```bash
npm test
npm run test:phase2
npm run test:phase3
npm run test:phase6
```

The Phase 6 Node suite covers retry policy, non-retryable model-domain errors, the circuit breaker, ML compatibility mapping, and explicit fallback labeling.

The live Phase 2 HTTP contract test is intentionally write-gated and must target a disposable test database/server:

```bash
PHASE2_CONTRACT_BASE_URL=http://localhost:4000 \
PHASE2_CONTRACT_ADMIN_TOKEN=<admin-jwt> \
PHASE2_CONTRACT_ALLOW_WRITES=YES \
npm run test:phase2:contract
```

## Main API routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Mongo/API health plus Python ML readiness/circuit metadata |
| POST | `/api/predict` | Farmer pin → calibrated ML prediction, or explicitly labelled fallback |
| POST | `/api/borewells` | Authenticated operator logs a completed job |
| GET | `/api/borewells` | Public map dataset |
| GET | `/api/ledger` | Public prediction-vs-actual accuracy record |
| GET | `/api/admin/operators` | Admin operator oversight |
| GET | `/api/admin/logs` | Admin log oversight |

## Phase 6 Node → Python client

`mlClient.js` uses these environment variables:

```text
ML_SERVICE_URL=http://127.0.0.1:8000
ML_SERVICE_TIMEOUT_MS=2500
ML_SERVICE_RETRIES=1
ML_CIRCUIT_FAILURE_THRESHOLD=3
ML_CIRCUIT_COOLDOWN_MS=30000
```

Retryable transport/5xx/429 failures can trigger the circuit breaker. Model-domain 4xx responses such as `INSUFFICIENT_FEATURE_COVERAGE` are not retried and do not count as service-health failures.

`GET /api/health` keeps Node/Mongo availability separate from ML readiness: the API can remain healthy while reporting the Python service as unavailable and serving a visibly labelled fallback.

## Prediction provenance persisted

Real ML predictions additively retain:

- `predictionSource = "ml"`
- `modelVersion`
- `featureVersion`
- `predictionTimestamp`
- `uncertainty`
- `featureCoverage`
- `coverageWarning`
- model explanations

Fallback predictions retain:

- `predictionSource = "heuristic_fallback"`
- `isMock = true`
- `modelAvailable = false`
- `modelVersion = null`
- a visible fallback warning/reason
- no calibrated uncertainty claim

This metadata is saved with the prediction without changing the ledger's existing success-threshold scoring behavior.

## Phase 2 ingestion API (admin only)

CSV imports are **staged, never directly inserted into `borewells`**. The flow is: upload → validate/normalize → duplicate detection → quality score → human review → publish.

```bash
curl -X POST \
  "http://localhost:4000/api/admin/ingestion/csv?sourceType=government&sourceName=TN%20Groundwater&sourceReference=dataset-2026" \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: text/csv" \
  --data-binary @borewells.csv
```

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/admin/ingestion/csv` | Stage a CSV with provenance metadata |
| GET | `/api/admin/ingestion/batches` | Paginated batch list |
| GET | `/api/admin/ingestion/batches/:id` | Batch + review summary |
| GET | `/api/admin/ingestion/batches/:id/records` | Paginated staged rows; optional `status` filter |
| GET | `/api/admin/ingestion/batches/:id/quality-report` | Current data-quality report |
| GET | `/api/admin/ingestion/batches/:id/audit` | Append-only audit events |
| PATCH | `/api/admin/ingestion/records/:id` | Human `approve` / `reject` decision |
| POST | `/api/admin/ingestion/batches/:id/publish` | Idempotently publish reviewed eligible rows |
| POST | `/api/admin/ingestion/assets` | Register external satellite/rainfall/geology/soil/DEM/LULC/groundwater object metadata |
| GET | `/api/admin/ingestion/assets` | Paginated contextual dataset asset registry |
| PATCH | `/api/admin/ingestion/assets/:id` | Verify/reject an external dataset asset |

See `../docs/phase-2-data-ingestion.md` for the CSV contract, scoring model, privacy rules, migration/rollback process, and production review gate.

## Phase 2 legacy migration

Dry-run is the default and performs no writes:

```bash
npm run migrate:phase2
```

Only after the review gate is approved:

```bash
PHASE2_MIGRATION_APPROVED=YES npm run migrate:phase2:apply
PHASE2_MIGRATION_APPROVED=YES npm run migrate:phase2:rollback
```

## Phase 3 geospatial feature engineering

Phase 3 converts approved borewell records plus real raster/vector layers into a versioned ML-ready dataset. The same 26-feature contract is re-created at prediction time by the Python Phase 6 feature extractor.

```bash
npm run features:build -- \
  --manifest=../docs/your-feature-manifest.json \
  --targets=../data/approved-borewells.json \
  --out=feature-artifacts/features-v1.json
```

See `../docs/phase-3-geospatial-feature-engineering.md`.

## Phase 4/5/6 ML stack

- Phase 4 trains versioned success, water-strike-depth and yield candidates.
- Phase 5 evaluates them spatially, calibrates success probability, builds conformal ranges and selects candidates pending review.
- Phase 6 serves the selected checksummed bundle after explicit approval and connects it to this Node API.

See:

- `../docs/phase-4-real-ml-model.md`
- `../docs/phase-5-scientific-evaluation.md`
- `../docs/phase-6-python-ml-service.md`
- `../ml/README.md`

## Notes

- **Only `db.js` talks to MongoDB.** Prediction/model logic remains outside data-access code.
- Imported Phase 2 rows cannot influence predictions until they are approved/published; live Phase 6 nearby evidence is further restricted to verified, unflagged records.
- Phase 6 software can be deployed with production ML still disabled. Python stays not-ready until the reviewed artifacts and `BORESAKSHI_PHASE6_APPROVED=YES` gate are present.
- Env overrides include `MONGODB_URI`, `MONGODB_DB`, `PORT`, `INGESTION_MAX_BYTES`, and the `ML_*` variables above.
