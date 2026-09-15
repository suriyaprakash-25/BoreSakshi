import test from "node:test";
import assert from "node:assert/strict";
import { predictBorewell } from "../predict.js";

const nearby = [
  {
    id: "verified-1",
    lat: 11.001,
    lng: 77.001,
    success: true,
    depthFt: 220,
    yieldLpm: 45,
    drilledAt: "2025-01-01T00:00:00Z",
    createdAt: "2025-01-01T00:00:00Z",
    verified: true,
    flagged: false,
    datasetEligibility: { eligible: true },
    distanceKm: 0.15,
  },
];

const snapshot = {
  ref: "fsnap:" + "a".repeat(64),
  datasetVersion: "geo-v1",
  featureVersion: "geo-v1:features-1.0.0",
  featureManifestSha256: "b".repeat(64),
  predictionAsOf: "2026-09-15T00:00:00Z",
};

test("real ML response maps to the legacy frontend contract additively", async () => {
  const client = {
    predict: async () => ({
      successProbability: 73.4,
      estimatedDepthFt: { estimate: 250, min: 210, max: 290 },
      estimatedYieldLpm: { estimate: 52, min: 39, max: 65 },
      confidence: "High",
      modelVersion: "phase4-real-v1@phase5-real-v1",
      featureVersion: "geo-v1:features-1.0.0",
      predictionContractVersion: "1.0.0",
      featureSnapshotRef: snapshot.ref,
      featureSnapshot: snapshot,
      explanations: [
        { feature: "geologyFormation", label: "Geological formation", impact: 9.4, method: "single_feature_ablation_to_pipeline_imputation" },
        { feature: "nearbySuccessRate", label: "Nearby success rate", impact: 4.2, method: "single_feature_ablation_to_pipeline_imputation" },
      ],
      uncertainty: { success: { normalizedEntropy: 0.62 }, featureCoveragePct: 92 },
      featureCoverage: { coveragePct: 92, missingFeatures: [] },
      coverageWarning: null,
      geologySummary: "Fractured gneiss",
      nearbySummary: { nearbyCount: 1, successCount: 1, failCount: 0, latestNearbyLogAt: "2025-01-01T00:00:00Z" },
      predictionTimestamp: "2026-09-15T00:00:00Z",
      predictionSource: "ml",
      isMock: false,
    }),
  };
  const result = await predictBorewell({ lat: 11, lng: 77, nearbyLogs: nearby, client });
  assert.equal(result.predictionSource, "ml");
  assert.equal(result.isMock, false);
  assert.deepEqual(result.depthBandFt, [210, 290]);
  assert.deepEqual(result.expectedYieldLpm, [39, 65]);
  assert.equal(result.rockType, "Fractured gneiss");
  assert.equal(result.modelVersion, "phase4-real-v1@phase5-real-v1");
  assert.equal(result.featureSnapshotRef, snapshot.ref);
  assert.equal(result.predictionContractVersion, "1.0.0");
  assert.equal(result.factors.length, 2);
  assert.equal(result.confidenceReason.modelCoveragePct, 92);
});

test("ML failure never masquerades heuristic fallback as ML", async () => {
  const client = {
    predict: async () => {
      const error = new Error("service down");
      error.code = "ML_NETWORK_ERROR";
      throw error;
    },
  };
  const result = await predictBorewell({ lat: 11, lng: 77, nearbyLogs: nearby, client });
  assert.equal(result.predictionSource, "heuristic_fallback");
  assert.equal(result.isMock, true);
  assert.equal(result.modelAvailable, false);
  assert.equal(result.modelVersion, null);
  assert.equal(result.featureSnapshotRef, null);
  assert.match(result.coverageWarning, /heuristic fallback/i);
  assert.match(result.basis, /ML prediction is unavailable/i);
  assert.match(result.fallbackReason, /ML_NETWORK_ERROR/);
  assert.equal(result.uncertainty.available, false);
});
