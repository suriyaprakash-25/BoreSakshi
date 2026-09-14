import test from "node:test";
import assert from "node:assert/strict";
import { assertMlPredictionContract, PredictionContractError } from "../predictionContract.js";
import { predictBorewell } from "../predict.js";

function validMlPrediction() {
  const timestamp = "2026-09-15T00:00:00Z";
  const featureVersion = "geo-v1:features-1.0.0";
  const ref = "fsnap:" + "a".repeat(64);
  return {
    successProbability: 72.5,
    estimatedDepthFt: { estimate: 250, min: 210, max: 290 },
    estimatedYieldLpm: { estimate: 51, min: 38, max: 64 },
    confidence: "High",
    modelVersion: "phase4-real-v1@phase5-real-v1",
    featureVersion,
    predictionTimestamp: timestamp,
    predictionContractVersion: "1.0.0",
    featureSnapshotRef: ref,
    featureSnapshot: {
      ref,
      datasetVersion: "geo-v1",
      featureVersion,
      featureManifestSha256: "b".repeat(64),
      predictionAsOf: timestamp,
    },
    explanations: [],
    uncertainty: { success: { normalizedEntropy: 0.6 } },
    featureCoverage: { coveragePct: 91.3, missingFeatures: [] },
    coverageWarning: null,
    predictionSource: "ml",
    isMock: false,
  };
}

test("Phase 7 accepts a complete real-model contract", () => {
  const payload = validMlPrediction();
  assert.equal(assertMlPredictionContract(payload), payload);
});

test("Phase 7 rejects missing immutable feature snapshot metadata", () => {
  const payload = validMlPrediction();
  delete payload.featureSnapshotRef;
  assert.throws(() => assertMlPredictionContract(payload), PredictionContractError);
});

test("Phase 7 rejects impossible depth/yield ranges", () => {
  const payload = validMlPrediction();
  payload.estimatedDepthFt = { estimate: 250, min: 300, max: 200 };
  assert.throws(() => assertMlPredictionContract(payload), /0 <= min <= estimate <= max/);
});

test("malformed ML service response becomes explicit heuristic fallback", async () => {
  const malformed = validMlPrediction();
  malformed.featureSnapshot.featureManifestSha256 = "not-a-checksum";
  const result = await predictBorewell({
    lat: 11,
    lng: 77,
    nearbyLogs: [],
    client: { predict: async () => malformed },
  });
  assert.equal(result.predictionSource, "heuristic_fallback");
  assert.equal(result.isMock, true);
  assert.equal(result.modelVersion, null);
  assert.match(result.fallbackReason, /ML_CONTRACT_INVALID/);
});
