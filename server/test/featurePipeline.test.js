import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseAsciiGrid } from "../geospatial.js";
import { buildFeatureDataset, buildTrainingFeatureRow, deterministicDatasetDigest } from "../featurePipeline.js";

const gridText = `ncols 3\nnrows 3\nxllcorner 76.99\nyllcorner 10.99\ncellsize 0.01\nNODATA_value -9999\n100 110 120\n90 100 110\n80 90 100\n`;
const sha = createHash("sha256").update(gridText).digest("hex");
const manifest = {
  datasetVersion: "geo-2026-09-15.1",
  layers: [{ id: "dem", kind: "dem", format: "esri_ascii", path: "dem.asc", sourceName: "Survey", sourceReference: "DEM-v1", license: "CC-BY-4.0", sha256: sha, static: true }],
};
const loadedLayers = [{ ...manifest.layers[0], data: parseAsciiGrid(gridText) }];
const targets = [
  { id: "w1", lat: 11.005, lng: 77.005, success: true, depthFt: 300, yieldLpm: 50, drilledAt: "2026-01-10T00:00:00Z" },
  { id: "w2", lat: 11.006, lng: 77.006, success: false, depthFt: 350, yieldLpm: 0, drilledAt: "2026-02-10T00:00:00Z" },
];

test("training row keeps labels separate and excludes target outcome from nearby features", () => {
  const built = buildTrainingFeatureRow(targets[0], { layers: loadedLayers, borewells: targets, datasetVersion: manifest.datasetVersion, nearbyRadiusKm: 5, densityRadiusKm: 2, spatialBlockDeg: 0.1 });
  assert.equal(built.ok, true);
  assert.equal(built.row.labels.success, true);
  assert.equal(built.row.features.nearbyCount, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(built.row.features, "success"), false);
});

test("feature dataset applies strict temporal ordering between training targets", () => {
  const dataset = buildFeatureDataset({ manifest, loadedLayers, targets, borewells: targets, generatedAt: "2026-09-15T00:00:00Z" });
  assert.equal(dataset.rows.length, 2);
  const second = dataset.rows.find((row) => row.targetId === "w2");
  assert.equal(second.features.nearbyCount, 1);
  assert.equal(second.features.nearbySuccessRate, 1);
  assert.equal(dataset.report.rowsSkipped, 0);
  assert.equal(dataset.leakagePolicy.targetOutcomeExcludedFromFeatures, true);
});

test("invalid target dates are skipped rather than leaking future data", () => {
  const bad = [...targets, { id: "bad", lat: 11, lng: 77, success: true }];
  const dataset = buildFeatureDataset({ manifest, loadedLayers, targets: bad, borewells: bad, generatedAt: "2026-09-15T00:00:00Z" });
  assert.equal(dataset.report.rowsSkipped, 1);
  assert.ok(dataset.report.skipped[0].errors.some((e) => e.includes("temporal leakage")));
});

test("Phase 2 invalid or ineligible records are rejected as training targets", () => {
  const bad = { ...targets[0], id: "blocked", datasetEligibility: { eligible: false }, reviewStatus: "rejected" };
  const built = buildTrainingFeatureRow(bad, { layers: loadedLayers, borewells: targets, datasetVersion: manifest.datasetVersion, nearbyRadiusKm: 5, densityRadiusKm: 2, spatialBlockDeg: 0.1 });
  assert.equal(built.ok, false);
  assert.ok(built.errors.some((e) => e.includes("not dataset eligible")));
  assert.ok(built.errors.some((e) => e.includes("not approved")));
});

test("dataset digest is deterministic independent of generatedAt metadata", () => {
  const a = buildFeatureDataset({ manifest, loadedLayers, targets, borewells: targets, generatedAt: "2026-09-15T00:00:00Z" });
  const b = buildFeatureDataset({ manifest, loadedLayers, targets, borewells: targets, generatedAt: "2026-09-16T00:00:00Z" });
  assert.equal(deterministicDatasetDigest(a), deterministicDatasetDigest(b));
});
