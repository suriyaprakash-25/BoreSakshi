# BoreSakshi Phase 3 Completion Report

**Phase:** 3 — Real Geospatial Feature Engineering  
**Implementation branch:** `phase-3-geospatial-features`  
**Base branch:** `phase-2-data-ingestion`  
**Status:** Implementation complete; Phase 4 model training/integration remains review-gated.

## Scope completed

| Planned Phase 3 capability | Result |
|---|---|
| Convert geographic data to ML-ready features | Complete — deterministic feature schema v1.0.0 |
| Terrain: elevation | Complete — DEM raster sampling |
| Terrain: slope | Complete — local DEM gradient |
| Terrain: aspect | Complete — gradient orientation |
| Terrain: curvature | Complete — local Laplacian |
| Hydrology: distance to drainage | Complete — real line geometry distance |
| Hydrology: drainage density | Complete — clipped line length / neighborhood area |
| Hydrology: watershed | Complete — point-in-polygon lookup |
| Hydrology: flow accumulation | Complete — raster sampling |
| Geology: formation | Complete — geology polygon property |
| Geology: lithology | Complete — geology polygon property |
| Geology: lineament density | Complete — neighborhood line density |
| Geology: fracture-related features | Complete — lineament distance + proximity score |
| Climate: annual rainfall | Complete — temporally eligible raster selection |
| Climate: seasonal rainfall | Complete — temporally eligible raster selection |
| Climate: recent rainfall | Complete — temporally eligible raster selection |
| Climate: rainfall anomaly | Complete — direct layer or annual-vs-normal derivation |
| Satellite: NDVI | Complete — temporally eligible raster selection |
| Satellite: NDWI | Complete — temporally eligible raster selection |
| Satellite: land-use / land-cover | Complete — raster category or GeoJSON polygon class |
| Existing wells: nearest distance | Complete |
| Existing wells: success/failure rates | Complete |
| Existing wells: average depth | Complete |
| Existing wells: average yield | Complete |
| Versioned raw source manifest | Complete — datasetVersion + per-layer SHA-256/provenance/license |
| Versioned processed dataset | Complete — featureSchemaVersion + datasetHash + row hashes |
| Raster extraction | Complete — ESRI ASCII Grid |
| Vector extraction | Complete — GeoJSON lines/polygons |
| Spatial leakage controls | Complete — deterministic spatial block IDs |
| Temporal leakage controls | Complete — strict pre-target borewell history + dynamic layer cutoff |
| Phase 2 eligibility gate | Complete — invalid/ineligible/duplicate/unapproved staged rows rejected |
| Target leakage prevention | Complete — labels stored separately; target excluded from neighbor features |
| Missing feature coverage | Complete — no silent imputation; per-row + per-feature coverage reports |
| Deterministic reproducibility | Complete — source checksums, feature hashes, row hashes, dataset digest |
| Build CLI | Complete — `npm run features:build` |
| Unit tests | Complete — geospatial + dataset pipeline coverage |
| Operational documentation | Complete — source manifest, feature contract and Phase 4 gate |

## Key implementation files

- `server/geospatial.js`
- `server/featurePipeline.js`
- `server/scripts/build-feature-dataset.js`
- `server/test/geospatial.test.js`
- `server/test/featurePipeline.test.js`
- `docs/phase-3-geospatial-feature-engineering.md`
- `docs/phase-3-feature-manifest.example.json`
- `docs/phase-3-completion-report.md`

## Feature schema

Phase 3 currently emits 26 required ML features grouped into terrain, hydrology, geology/fracture structure, climate, satellite/LULC and historical nearby-borewell evidence.

Categorical values such as geology formation, lithology, watershed and land-use are intentionally retained as traceable domain values. Encoding/scaling belongs to the Phase 4 model preprocessing pipeline rather than being hidden inside geospatial extraction.

## Leakage controls

Training rows are built at the historical time of each target borewell.

- The target well is removed from its own nearby evidence.
- Only wells drilled strictly before the target event time are eligible.
- Future or same-time wells are excluded.
- Rainfall/NDVI/NDWI/LULC snapshots must have `observedAt` and cannot be later than the target time.
- Missing/ambiguous target event dates cause the row to be skipped.
- Phase 2 records explicitly marked invalid, duplicate, ineligible, rejected, or otherwise unapproved are rejected as training targets.
- Each row receives a spatial block ID for grouped/spatial validation in Phase 4.

## Data lineage and reproducibility

Every source layer requires a dataset ID, source name/reference, license and SHA-256 checksum. The CLI verifies the actual file bytes before feature extraction.

The output records:

- raw source checksums and provenance,
- manifest hash,
- feature schema version,
- feature hash per target,
- complete row hash,
- dataset hash,
- deterministic cross-run digest,
- feature coverage and skipped-row reasons.

This prevents source substitution or silent feature drift from masquerading as the same dataset version.

## Verification performed

The Phase 3 pure test suite was executed locally after implementation:

- **14 tests passed**
- **0 failed**
- **0 skipped**

Coverage includes raster parsing/sampling, terrain derivatives, polygon lookup, line distance/density, temporal source selection, target/future-well exclusion, manifest provenance validation, spatial block stability, full cross-domain feature extraction, training-row label separation, causal ordering between targets, invalid-date rejection, Phase 2 eligibility enforcement and deterministic dataset digests.

All new Phase 3 JavaScript files were also syntax-checked with `node --check` during implementation.

## Deliberately not done in Phase 3

The live `/api/predict` response is **not** changed to pretend that these features are already a trained model. The existing deterministic mock remains in place until Phase 4 produces a measured, spatially validated model.

No accuracy, precision/recall, ROC-AUC, calibration, prediction interval or uncertainty metric is claimed here. Those measurements require a trained model and belong to Phase 4. Phase 3 provides spatial block IDs and coverage reporting specifically so Phase 4 can evaluate them correctly.

## Phase 4 review gate

Before model training proceeds, review:

1. representative source manifest and licensing,
2. SHA-256 verification for every layer,
3. target export provenance from the approved Phase 2 dataset,
4. per-feature coverage and missingness,
5. skipped target rows,
6. chosen spatial block size,
7. dynamic layer observation dates,
8. leakage-control tests,
9. one generated feature artifact and its hashes.

Only after that review should Phase 4 train candidate models and publish measured spatial-validation, calibration and uncertainty results.
