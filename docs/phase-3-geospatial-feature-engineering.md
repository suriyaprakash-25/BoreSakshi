# Phase 3 — Real Geospatial Feature Engineering

## Goal

Convert approved real-world geographic information into deterministic, versioned, ML-ready features for BoreSakshi. This phase replaces the idea of using latitude/longitude as a pseudo-random signal with a real feature pipeline. It deliberately does **not** train or deploy a model; model selection, spatial evaluation, calibration, uncertainty and live inference belong to the next phase.

Phase 3 consumes:

1. Approved/canonical borewell records from Phase 2.
2. Versioned raster/vector source layers with explicit provenance, license and SHA-256.
3. A manifest that records dataset version and feature-engineering parameters.

It produces a reviewable JSON feature dataset whose labels are separated from features and whose provenance can be traced back to individual source layers.

## Pipeline

**Approved borewells + geospatial source manifest → checksum verification → raster/vector parsing → temporal source selection → spatial extraction/derivation → causal nearby-well features → feature coverage report → spatial block assignment → versioned ML-ready artifact**

Core code:

- `server/geospatial.js` — pure raster/vector and borewell feature extraction.
- `server/featurePipeline.js` — versioned training-row/dataset construction.
- `server/scripts/build-feature-dataset.js` — offline checksum-verified CLI.
- `docs/phase-3-feature-manifest.example.json` — source manifest example.

## Supported source formats

The Phase 3 extractor accepts two dependency-free standardized interchange formats:

- **ESRI ASCII Grid (`esri_ascii`)** for raster data.
- **GeoJSON (`geojson`)** for vector lines/polygons.

GeoTIFF, shapefile, database-native rasters, WMS/WCS and remote-sensing products should be exported/normalized to these reviewable interchange formats before the build step. Their original source/version/license/checksum remains documented in the manifest. Keeping the feature builder format-small makes the pipeline deterministic and testable without hiding GIS transformations inside opaque dependencies.

## Required feature scope implemented

### Terrain

| Feature | Source/derivation |
|---|---|
| `terrainElevationM` | DEM raster sample |
| `terrainSlopeDeg` | 3×3 DEM neighborhood, Horn-style gradient |
| `terrainAspectDeg` | DEM gradient orientation |
| `terrainCurvature` | Local DEM Laplacian |

### Hydrology

| Feature | Source/derivation |
|---|---|
| `hydrologyDistanceToDrainageM` | Minimum point-to-drainage-line distance |
| `hydrologyDrainageDensityKmPerKm2` | Drainage-line length clipped to a configurable circular neighborhood / area |
| `hydrologyWatershedId` | Containing watershed polygon property |
| `hydrologyFlowAccumulation` | Flow-accumulation raster sample |

### Geology / fracture structure

| Feature | Source/derivation |
|---|---|
| `geologyFormation` | Containing geology polygon |
| `geologyLithology` | Containing geology polygon |
| `geologyLineamentDensityKmPerKm2` | Lineament length density in configurable neighborhood |
| `geologyDistanceToLineamentM` | Minimum distance to mapped lineament |
| `geologyFractureProximityScore` | `exp(-distance_to_lineament_m / 1000)` |

### Climate

| Feature | Source/derivation |
|---|---|
| `climateAnnualRainfallMm` | Latest annual rainfall layer not after target date |
| `climateSeasonalRainfallMm` | Latest seasonal rainfall layer not after target date |
| `climateRecentRainfallMm` | Latest recent-period rainfall layer not after target date |
| `climateRainfallAnomalyPct` | Direct anomaly layer, or `(annual-normal)/normal × 100` |

### Satellite / land cover

| Feature | Source/derivation |
|---|---|
| `satelliteNdvi` | Latest NDVI raster not after target date |
| `satelliteNdwi` | Latest NDWI raster not after target date |
| `satelliteLandUseClass` | Latest LULC raster category or GeoJSON polygon class not after target date |

### Existing borewell evidence

| Feature | Source/derivation |
|---|---|
| `nearbyNearestDistanceKm` | Nearest historical borewell within configured radius |
| `nearbyCount` | Historical wells within radius |
| `nearbySuccessRate` | Historical successes / labelled nearby wells |
| `nearbyFailureRate` | Historical failures / labelled nearby wells |
| `nearbyAverageDepthFt` | Mean historical nearby depth |
| `nearbyAverageYieldLpm` | Mean historical nearby yield |

Auxiliary counts and latest historical borewell timestamp are retained for auditing but are not part of the required feature vector.

## Raster extraction details

`parseAsciiGrid()` validates raster dimensions, lower-left reference, cell size, numeric values and NODATA. Numeric rasters use bilinear interpolation by default. Categorical rasters use nearest-cell sampling and may provide a `categoryMap` in the manifest/runtime layer definition.

Terrain derivatives require a complete 3×3 DEM neighborhood; if the target is at the raster boundary or intersects NODATA, derived slope/aspect/curvature are reported as missing rather than fabricated.

## Vector extraction details

GeoJSON support covers:

- `LineString` / `MultiLineString` for drainage and lineaments.
- `Polygon` / `MultiPolygon` for watershed, geology and land-use classes.

Distance and density calculations use a local meter approximation around each target. Density clips line segments to the configured circular neighborhood rather than simply counting features.

## Temporal leakage controls

Training rows use the target borewell’s `drilledAt` (or legacy `createdAt`) as `asOf`.

The pipeline enforces:

1. **Target outcome exclusion:** the target borewell is never included in its own nearby-well features.
2. **Strict causal history:** only borewells drilled **strictly before** the target `asOf` may contribute nearby success/failure/depth/yield evidence.
3. **Dynamic source cutoff:** rainfall, NDVI, NDWI and land-use layers must have `observedAt`; only the latest layer whose observation time is not after target `asOf` is eligible.
4. **Missing date = no training row:** a borewell without a usable event date is skipped instead of allowing temporal ambiguity.
5. **No silent imputation:** unavailable source coverage becomes `null` plus an explicit coverage report.

These controls prevent future wells, future rainfall/satellite snapshots and the target’s own outcome from leaking into model features.

## Spatial leakage controls

Every training row receives a deterministic `spatialBlockId` using a configurable latitude/longitude grid (default `0.1°`). This is **not** a random train/test split. It exists so Phase 4 can perform grouped/spatial holdout validation without nearby records from the same block leaking across evaluation folds.

The processed artifact reports the number of unique spatial blocks and persists the block size inside `leakagePolicy`.

## Source manifest and provenance

Every layer must provide:

- unique `id`
- supported `kind`
- `format`
- relative `path`
- `sourceName`
- `sourceReference`
- `license`
- exact 64-character SHA-256
- `observedAt` for dynamic layers

The build CLI recomputes the SHA-256 of every file and refuses to build when any checksum differs. This makes source replacement detectable and prevents two different raw datasets from silently sharing one dataset version.

`datasetVersion` must be bumped when source data or feature-engineering assumptions change. The output contains:

- `featureSchemaVersion`
- `manifestSha256`
- per-layer provenance/license/checksum
- per-row `sourceTrace`
- per-row `featureHash` / `rowHash`
- overall `datasetHash`
- deterministic digest for cross-run comparison

## Build command

1. Export the approved canonical Phase 2 borewells to JSON (array, or `{ "items": [...] }`).
2. Prepare raster/vector files outside Git under `server/geospatial-data/` or another controlled location.
3. Copy `docs/phase-3-feature-manifest.example.json` and replace placeholder source/license/checksum values.
4. Compute source SHA-256 values and put the exact digest in the manifest.
5. Run:

```bash
cd server
npm run features:build -- \
  --manifest=../docs/your-feature-manifest.json \
  --targets=../data/approved-borewells.json \
  --out=feature-artifacts/features-geo-2026-09-15.1.json
```

Optional overrides:

```text
--nearby-radius-km=5
--density-radius-km=2
--spatial-block-deg=0.1
```

The command prints a summary containing row counts, coverage by feature, spatial-block count, dataset hashes and artifact checksum. It exits non-zero if any target row is skipped so incomplete training data cannot look like a clean build.

## Output contract

Each training row contains:

```json
{
  "targetId": "...",
  "lat": 11.36,
  "lng": 77.80,
  "asOf": "2026-01-10T00:00:00.000Z",
  "spatialBlockId": "b0.1:...",
  "features": { "terrainElevationM": 231.5 },
  "labels": { "success": true, "depthFt": 300, "yieldLpm": 55 },
  "coverage": { "coveragePct": 88.46, "missingFeatures": [] },
  "sourceTrace": {},
  "featureHash": "...",
  "rowHash": "..."
}
```

Labels are kept in a separate object and are never passed back into feature engineering.

## Coverage checks

The dataset artifact publishes **data coverage**, not model performance. It records:

- per-row available/missing features
- per-feature coverage percentage
- average feature coverage
- skipped training targets and reasons
- spatial block count

No accuracy, AUC, calibration, confidence interval or uncertainty metric is claimed in Phase 3 because no trained model exists yet. Publishing invented model metrics would violate the roadmap’s measured-metrics-only rule.

## Review gate before Phase 4

Review all of the following before model training:

- [ ] Phase 2 approved/canonical borewell export used as targets
- [ ] source licenses/provenance reviewed
- [ ] every raw layer SHA-256 verified
- [ ] dynamic layers have valid observation dates
- [ ] feature coverage report reviewed by geography
- [ ] skipped targets investigated
- [ ] spatial block size accepted for validation design
- [ ] causal nearby-borewell rule accepted
- [ ] no target outcome appears inside feature fields
- [ ] Phase 3 tests pass
- [ ] one representative feature artifact is independently inspected

Phase 4 should consume this artifact and perform spatially grouped model evaluation, calibration, uncertainty estimation and coverage analysis before any live prediction integration.
