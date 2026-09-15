# BoreSakshi — Backend (MongoDB)

API for the borewell logging tool, farmer prediction screen, public accountability ledger, the review-gated Phase 2 real-data ingestion pipeline, and the Phase 3 geospatial feature-engineering pipeline. Node + Express + **MongoDB**.

- Connection: `mongodb://localhost:27017/`
- Database: `BoreSakshi`
- Core collections: `borewells`, `predictions`, `operators`, `assignments`
- Phase 2 collections: `ingestion_batches`, `staged_borewells`, `ingestion_audit`, `dataset_assets`
- Phase 3 output: versioned offline ML-ready feature artifacts under `feature-artifacts/` (gitignored)
- Phase 4 training: Python package under `../ml/` consumes Phase 3 artifacts and produces checksummed candidate model artifacts

## Run it

1. Make sure **MongoDB is running** locally (MongoDB Compass connected to `mongodb://localhost:27017/` is enough — collections are created automatically).

```bash
cd server
npm install
cp .env.example .env   # then edit .env — set JWT_SECRET
node seed.js            # OPTIONAL demo data
npm start               # http://localhost:4000
```

All secrets live in `server/.env` (gitignored). In production (`NODE_ENV=production`) a real `JWT_SECRET` is required.

## Tests

```bash
npm test
npm run test:phase2
npm run test:phase3
```

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
| GET | `/api/health` | Service + Mongo liveness |
| POST | `/api/predict` | Farmer pin → success %, depth, yield, confidence |
| POST | `/api/borewells` | Authenticated operator logs a completed job |
| GET | `/api/borewells` | Public map dataset |
| GET | `/api/ledger` | Public prediction-vs-actual accuracy record |
| GET | `/api/admin/operators` | Admin operator oversight |
| GET | `/api/admin/logs` | Admin log oversight |

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
# rollback uses the per-record backup collection:
PHASE2_MIGRATION_APPROVED=YES npm run migrate:phase2:rollback
```

## Phase 3 geospatial feature engineering

Phase 3 converts approved borewell records plus real raster/vector layers into a versioned ML-ready dataset. It intentionally runs offline so source licensing, checksums, temporal cutoffs and coverage can be reviewed before model training.

Supported standardized inputs:

- ESRI ASCII Grid rasters (`dem`, flow accumulation, rainfall, NDVI/NDWI, categorical rasters)
- GeoJSON vectors (drainage, watershed, geology, lineaments, LULC polygons)

The build enforces source SHA-256, license/reference metadata, target-outcome separation, strictly historical nearby-well features, dynamic-layer observation cutoffs, missing-feature coverage reporting and deterministic spatial block IDs.

```bash
npm run features:build -- \
  --manifest=../docs/your-feature-manifest.json \
  --targets=../data/approved-borewells.json \
  --out=feature-artifacts/features-v1.json
```

The Phase 4 depth target is `waterStrikeFt`, so Phase 3 feature rows now carry it under `labels` separately from total `depthFt`. It is never added to the `features` object.

Start from `../docs/phase-3-feature-manifest.example.json`. Generated artifacts and raw geospatial data are gitignored by default.

See `../docs/phase-3-geospatial-feature-engineering.md` for the feature contract and leakage controls.

## Phase 4 real-model training

Phase 4 lives under `../ml/`. It trains separate candidate models for success probability, water-strike depth and yield. Candidate artifacts remain offline and unevaluated until Phase 5.

```bash
cd ../ml
python -m venv .venv
# activate environment
python -m pip install -r requirements-candidates.txt
python train.py \
  --dataset ../server/feature-artifacts/features-v1.json \
  --out artifacts \
  --run-id phase4-real-v1
```

See `../docs/phase-4-real-ml-model.md` and `../ml/README.md` for the full training/artifact contract.

## Notes

- **Only `db.js` talks to MongoDB.** `index.js` awaits its methods; `predict.js`, `ingestion.js`, `geospatial.js` and `featurePipeline.js` keep core logic deterministic/testable.
- **The live API still uses the deterministic mock.** Phase 4 trains candidate artifacts but does not bypass Phase 5 evaluation or Phase 6 service integration.
- Imported Phase 2 rows cannot influence predictions until an admin approves them and publishes the batch.
- Phase 3 reports data coverage/provenance; Phase 4 registers candidate models; Phase 5 owns measured performance/calibration/uncertainty.
- Env overrides: `MONGODB_URI`, `MONGODB_DB`, `PORT`, `INGESTION_MAX_BYTES`.
