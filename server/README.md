# BoreSakshi — Backend (MongoDB)

API for the borewell logging tool, farmer prediction screen, public accountability ledger, and the review-gated Phase 2 real-data ingestion pipeline. Node + Express + **MongoDB**.

- Connection: `mongodb://localhost:27017/`
- Database: `BoreSakshi`
- Core collections: `borewells`, `predictions`, `operators`, `assignments`
- Phase 2 collections: `ingestion_batches`, `staged_borewells`, `ingestion_audit`, `dataset_assets`

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

## Notes

- **Only `db.js` talks to MongoDB.** `index.js` awaits its methods; `predict.js` and `ingestion.js` keep logic testable.
- **The real AI plugs into `predict.js` only** — the current prediction remains deterministic/mock and Phase 2 does not rewrite it.
- Imported rows cannot influence predictions until an admin approves them and publishes the batch.
- Env overrides: `MONGODB_URI`, `MONGODB_DB`, `PORT`, `INGESTION_MAX_BYTES`.
