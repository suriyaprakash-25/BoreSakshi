# Phase 2 — Real Borewell Data Collection Pipeline

## Goal

Build a centralized, reviewable real-world dataset without allowing raw or unverified imports to influence BoreSakshi predictions. Phase 2 implements the pipeline:

**Raw Data → Upload / Import → Schema Validation → Coordinate Validation → Data Cleaning → Duplicate Detection → Quality Scoring → Human Verification → Approved Dataset**

The existing farmer, operator, prediction, ledger, and admin flows are preserved. Imported rows are isolated in staging until an administrator explicitly approves them and publishes the batch.

## Supported input families

The canonical borewell CSV supports historical records, operator-derived exports, government/public groundwater data, and groundwater observations. Optional contextual columns allow feature-enriched records to carry rainfall, geology, soil, DEM/elevation, slope, land-use/land-cover, groundwater level, and common satellite-derived indices (`ndvi`, `ndwi`, lineament density, drainage density).

Large source datasets such as satellite rasters, rainfall grids, geology/soil layers, DEMs, and LULC files should not be copied into MongoDB. Register their object-storage metadata through the dataset asset registry (`dataset_assets`). This preserves provenance and checksums while leaving large binaries in S3/GCS/Azure/local/other storage for the later ML feature pipeline.

## Canonical borewell CSV contract

Required logical fields (aliases are accepted):

| Canonical field | Example aliases | Rule |
|---|---|---|
| `lat` | `latitude`, `gps_lat` | Decimal degrees, -90..90 |
| `lng` | `longitude`, `lon`, `long`, `gps_lng` | Decimal degrees, -180..180 |
| `success` | `outcome`, `water_found`, `result` | yes/no, true/false, success/fail, wet/dry |

Recommended fields:

| Field | Notes |
|---|---|
| `depth_ft` / `depth_m` | Canonicalized to feet |
| `water_strike_ft` / `water_strike_m` | Canonicalized to feet |
| `yield_lpm` / `yield_lps` | Canonicalized to litres/minute |
| `drilled_date` | ISO dates and deterministic `DD/MM/YYYY` supported |
| `source_record_id` | Strongest duplicate key within a named source |
| `place_name`, `district`, `state` | Administrative/geographic context |
| `strata` / `rock_type` | Drilling strata |
| `evidence_url` | HTTP(S) evidence/document link |

Optional contextual feature columns: `rainfall_mm`, `geology`, `soil_type`, `elevation_m`, `slope_deg`, `lulc`, `groundwater_level_m`, `ndvi`, `ndwi`, `lineament_density`, `drainage_density`.

Unknown CSV columns are ignored and are **not persisted**, which prevents accidental ingestion of unrelated PII. Accepted source cells are retained on the staged record as row-level evidence.

## Validation and cleaning

The pure pipeline lives in `server/ingestion.js`. It performs:

- RFC-style quoted CSV handling including commas, escaped quotes and CRLF.
- Header aliasing into one canonical schema (`schemaVersion = 1.0.0`).
- Required-field checks.
- Decimal coordinate validation and safe lat/lng swap only when numeric ranges clearly imply inversion.
- Numeric range validation.
- Metric-to-canonical unit conversion (`m → ft`, `L/s → L/min`).
- Date normalization.
- Text trimming/collapsing and field length limits.
- Evidence URL protocol validation.
- Consistency warnings such as water strike deeper than total depth or dry outcome with positive yield.

## Duplicate detection

Two layers are used:

1. **Strong source identity:** `sourceType + sourceName + sourceRecordId` → SHA-256 fingerprint.
2. **Fallback spatial signature:** normalized coordinate bucket + drilled date + success + rounded depth.

During server ingestion the fingerprint is checked against:

- records earlier in the same batch,
- active staged records from other batches,
- canonical `borewells` records,
- a final duplicate re-check immediately before publishing.

MongoDB also maintains `2dsphere` indexes on canonical/staged GeoJSON locations and the legacy migration backfills `location` so same-date nearby duplicate checks can operate against existing records.

## Data quality score

A row receives a score from 0–100:

- valid coordinates: 25
- explicit success outcome: 20
- total depth: 10
- yield or water strike: 10
- drill date: 10
- source record ID: 10
- evidence URL or source reference: 5
- place/district/state: 5
- strata: 5

`QUALITY_THRESHOLD = 70`.

A row is dataset-eligible only when:

- schema/coordinate validation passes,
- no duplicate is detected,
- quality score is at least 70,
- and an admin has explicitly approved it.

Invalid, duplicate, or low-quality rows are blocked and never auto-published.

## Human verification and workflow states

Staged row states:

- `pending_review`
- `approved`
- `rejected`
- `blocked_invalid`
- `blocked_duplicate`
- `blocked_quality`

Batch states include `processing`, `awaiting_review`, `needs_attention`, `ready_to_publish`, `review_complete`, `published`, and `failed`.

Publishing is idempotent and requires all reviewable rows to have a human decision. Only `approved + datasetEligible=true` records are copied into the canonical `borewells` collection. Publishing re-runs duplicate detection at the final boundary to prevent a race between review and publish.

## Provenance and auditability

Every staged/published imported record carries:

- stable application ID,
- schema version,
- source type/name/reference/license/dataset name,
- source record ID,
- evidence URL,
- raw artifact SHA-256,
- importer identity + timestamp,
- quality score,
- review decision + reviewer + timestamp,
- batch ID and duplicate fingerprint.

`ingestion_audit` is append-only by API design: `db.js` exposes insert/read methods but no update/delete method. Batch creation, staging, approval/rejection, duplicate-at-publish blocks, publication, dataset asset registration and asset review are audit events.

## Raw artifact / object-storage metadata

For each CSV upload BoreSakshi records:

- logical object key (`ingestion/<batch-id>/source.csv`),
- media type,
- byte size,
- SHA-256 checksum,
- storage status.

The application currently stores **metadata only** for the original CSV rather than duplicating the whole file into MongoDB. Accepted row fields are retained in staging for review. If production policy requires immutable raw-file retention, the logical object key/checksum is ready to connect to the chosen object store without changing the ingestion contract.

For large contextual inputs use the dataset asset registry. Metadata requires dataset kind, source, storage provider, object key, media type, byte size and SHA-256. Asset kinds are: `borewell_records`, `satellite_features`, `rainfall`, `geology`, `soil`, `dem`, `land_use_land_cover`, `groundwater_level`. Assets require an admin verify/reject decision.

## Admin API

All endpoints require `requireAuth` + `requireAdmin`.

### CSV pipeline

- `POST /api/admin/ingestion/csv` — `Content-Type: text/csv`; source metadata in query params.
- `GET /api/admin/ingestion/batches`
- `GET /api/admin/ingestion/batches/:id`
- `GET /api/admin/ingestion/batches/:id/records`
- `GET /api/admin/ingestion/batches/:id/quality-report`
- `GET /api/admin/ingestion/batches/:id/audit`
- `PATCH /api/admin/ingestion/records/:id` — `{ "decision": "approve|reject", "reviewNote": "..." }`
- `POST /api/admin/ingestion/batches/:id/publish`

### External dataset asset registry

- `POST /api/admin/ingestion/assets`
- `GET /api/admin/ingestion/assets`
- `PATCH /api/admin/ingestion/assets/:id` — approve/reject metadata registration
- `GET /api/admin/ingestion/assets/:id/audit`

## Offline validation / cleaning script

Run before upload when preparing a dataset:

```bash
cd server
npm run dataset:validate -- ../data/borewells.csv \
  --source-type=government \
  --source-name="TN Groundwater" \
  --source-reference="2026 export" \
  --clean-out=../data/borewells.cleaned.json \
  --report-out=../data/borewells.quality.json
```

This performs pure local parsing, normalization, validation, in-file duplicate detection and quality reporting. It never writes to MongoDB. Server ingestion remains authoritative for duplicates against live/staged records and human verification.

## Legacy migration, rollback and reconciliation

`server/migrations/phase2-v1.js` is **dry-run by default**. It reports total records, versioned records, GeoJSON coverage, eligibility coverage, invalid coordinates, and how many documents would change.

```bash
npm run migrate:phase2
```

Applying or rolling back requires the explicit review gate:

```bash
PHASE2_MIGRATION_APPROVED=YES npm run migrate:phase2:apply
PHASE2_MIGRATION_APPROVED=YES npm run migrate:phase2:rollback
```

Before each migrated document is changed, the script saves the managed fields into `migration_backups`. Rollback restores fields that existed and unsets fields that were introduced, rather than blindly deleting metadata.

Legacy records are marked `datasetEligibility.status = legacy_preserved` so migration does **not** silently alter existing prediction behavior.

## Privacy policy for Phase 2

- Do not include farmer phone numbers, personal IDs, payment data, or unrelated PII in CSVs.
- Unknown columns are discarded rather than stored.
- Use coarse place names/district/state only when needed for groundwater analysis.
- Evidence URLs should point to approved records/documents and must not embed secrets.
- Source/license metadata must establish lawful reuse rights before publishing.
- Admin identity is recorded for accountability.
- No imported row affects public predictions until human verification and publish.
- Production raw-file retention, encryption, lifecycle, and access policy must be approved before enabling immutable object storage.

## Review gate before production data moves

Phase 2 code is implemented, but production activation is intentionally gated. Approval must cover all of the following:

- [ ] migration dry-run reviewed
- [ ] rollback path reviewed
- [ ] reconciliation counts accepted
- [ ] privacy/data-minimization policy accepted
- [ ] source licensing/provenance policy accepted
- [ ] Phase 2 unit tests pass
- [ ] write-gated HTTP contract test passes against a disposable test DB
- [ ] a representative CSV quality report is reviewed
- [ ] admin review workflow is exercised
- [ ] object-storage/evidence retention decision is recorded

Only after this checklist is approved should `PHASE2_MIGRATION_APPROVED=YES` be set or real production CSV batches be published.
