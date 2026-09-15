import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAsciiGrid,
  sampleRaster,
  terrainDerivatives,
  containingFeature,
  distanceToLinesMeters,
  lineDensityKmPerKm2,
  deriveNearbyBorewellFeatures,
  validateLayerManifest,
  selectLayer,
  extractGeospatialFeatures,
  spatialBlockId,
} from "../geospatial.js";

const gridText = `ncols 3\nnrows 3\nxllcorner 76.99\nyllcorner 10.99\ncellsize 0.01\nNODATA_value -9999\n100 110 120\n90 100 110\n80 90 100\n`;
const grid = parseAsciiGrid(gridText);
const polygon = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { formation: "Granite", lithology: "Gneiss", watershedId: "W-1", class: "Cropland" }, geometry: { type: "Polygon", coordinates: [[[76.98,10.98],[77.04,10.98],[77.04,11.04],[76.98,11.04],[76.98,10.98]]] } }],
};
const line = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[76.99,11.005],[77.03,11.005]] } }],
};
const sha = "a".repeat(64);
const layer = (id, kind, format, data, extras = {}) => ({ id, kind, format, data, path: `${id}.dat`, sourceName: "Test Source", sourceReference: "unit-test", license: "test", sha256: sha, static: true, ...extras });

test("ESRI ASCII grid parses and samples center values", () => {
  assert.equal(grid.ncols, 3);
  assert.equal(sampleRaster(grid, 11.005, 77.005, { method: "nearest" }), 100);
});

test("terrain derivatives are finite on a complete 3x3 neighborhood", () => {
  const d = terrainDerivatives(grid, 11.005, 77.005);
  assert.ok(Number.isFinite(d.slopeDeg));
  assert.ok(Number.isFinite(d.aspectDeg));
  assert.ok(Number.isFinite(d.curvature));
});

test("GeoJSON polygon lookup returns containing feature", () => {
  assert.equal(containingFeature(11.0, 77.0, polygon)?.properties?.formation, "Granite");
  assert.equal(containingFeature(12, 78, polygon), null);
});

test("line distance and density use real geometry", () => {
  const distance = distanceToLinesMeters(11.0, 77.0, line);
  assert.ok(distance > 500 && distance < 600);
  const density = lineDensityKmPerKm2(11.0, 77.0, line, 2);
  assert.ok(density > 0);
});

test("nearby well features exclude target and future wells", () => {
  const wells = [
    { id: "target", lat: 11, lng: 77, success: true, depthFt: 300, yieldLpm: 40, drilledAt: "2026-01-10T00:00:00Z" },
    { id: "old-good", lat: 11.001, lng: 77.001, success: true, depthFt: 200, yieldLpm: 60, drilledAt: "2026-01-01T00:00:00Z" },
    { id: "old-dry", lat: 11.002, lng: 77.002, success: false, depthFt: 250, yieldLpm: 0, drilledAt: "2026-01-05T00:00:00Z" },
    { id: "future", lat: 11.001, lng: 77.001, success: true, depthFt: 100, yieldLpm: 100, drilledAt: "2026-02-01T00:00:00Z" },
  ];
  const f = deriveNearbyBorewellFeatures({ lat: 11, lng: 77, asOf: "2026-01-10T00:00:00Z", targetId: "target", borewells: wells, radiusKm: 5 });
  assert.equal(f.nearbyCount, 2);
  assert.equal(f.nearbySuccessRate, 0.5);
  assert.equal(f.nearbyAverageDepthFt, 225);
});

test("dynamic layer selection never uses observations after asOf", () => {
  const layers = [
    layer("old", "ndvi", "esri_ascii", grid, { static: false, observedAt: "2026-01-01T00:00:00Z" }),
    layer("future", "ndvi", "esri_ascii", grid, { static: false, observedAt: "2026-03-01T00:00:00Z" }),
  ];
  assert.equal(selectLayer(layers, "ndvi", "2026-02-01T00:00:00Z")?.id, "old");
});

test("manifest validation enforces provenance, license, checksum and dynamic dates", () => {
  const valid = validateLayerManifest({ datasetVersion: "v1", layers: [{ id: "ndvi", kind: "ndvi", format: "esri_ascii", path: "ndvi.asc", sourceName: "S", sourceReference: "R", license: "L", sha256: sha, observedAt: "2026-01-01" }] });
  assert.equal(valid.valid, true);
  const invalid = validateLayerManifest({ datasetVersion: "v1", layers: [{ id: "ndvi", kind: "ndvi", format: "esri_ascii", path: "ndvi.asc", sourceName: "", sourceReference: "", license: "", sha256: "x" }] });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.length >= 4);
});

test("spatial blocks are deterministic for later spatial validation", () => {
  assert.equal(spatialBlockId(11.36, 77.8, 0.1), spatialBlockId(11.361, 77.801, 0.1));
});

test("full feature extraction combines terrain, hydrology, geology, climate, satellite and wells", () => {
  const layers = [
    layer("dem", "dem", "esri_ascii", grid),
    layer("flow", "flowAccumulation", "esri_ascii", grid),
    layer("drain", "drainage", "geojson", line),
    layer("watershed", "watershed", "geojson", polygon, { property: "watershedId" }),
    layer("geology", "geology", "geojson", polygon),
    layer("lineaments", "lineaments", "geojson", line),
    layer("rain-a", "rainfallAnnual", "esri_ascii", grid, { static: false, observedAt: "2026-01-01T00:00:00Z" }),
    layer("rain-s", "rainfallSeasonal", "esri_ascii", grid, { static: false, observedAt: "2026-01-01T00:00:00Z" }),
    layer("rain-r", "rainfallRecent", "esri_ascii", grid, { static: false, observedAt: "2026-01-01T00:00:00Z" }),
    layer("rain-n", "rainfallNormal", "esri_ascii", grid, { static: false, observedAt: "2026-01-01T00:00:00Z" }),
    layer("ndvi", "ndvi", "esri_ascii", grid, { static: false, observedAt: "2026-01-01T00:00:00Z" }),
    layer("ndwi", "ndwi", "esri_ascii", grid, { static: false, observedAt: "2026-01-01T00:00:00Z" }),
    layer("lulc", "landUse", "geojson", polygon, { static: false, observedAt: "2026-01-01T00:00:00Z", property: "class" }),
  ];
  const result = extractGeospatialFeatures({
    lat: 11.005, lng: 77.005, asOf: "2026-02-01T00:00:00Z", layers,
    borewells: [{ id: "old", lat: 11.006, lng: 77.006, success: true, depthFt: 220, yieldLpm: 50, drilledAt: "2026-01-10T00:00:00Z" }],
    targetId: "target",
  });
  assert.equal(result.features.geologyFormation, "Granite");
  assert.equal(result.features.hydrologyWatershedId, "W-1");
  assert.equal(result.features.satelliteLandUseClass, "Cropland");
  assert.equal(result.features.nearbyCount, 1);
  assert.ok(result.coverage.coveragePct > 85);
  assert.ok(result.featureHash.length === 64);
});
