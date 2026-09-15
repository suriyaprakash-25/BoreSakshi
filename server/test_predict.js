import assert from "node:assert/strict";
import { distanceKm, NEAR_KM, predictBorewell } from "./predict.js";

const point = { lat: 11.38, lng: 77.89 };
const same = predictBorewell({ ...point, nearbyLogs: [] });
assert.equal(same.isMock, true);
assert.ok(same.successProbability >= 8 && same.successProbability <= 95);
assert.deepEqual(same.depthBandFt.length, 2);
assert.equal(same.factors.reduce((sum, factor) => sum + factor.impact, 0), same.successProbability);
assert.equal(distanceKm(point, point), 0);
assert.equal(NEAR_KM, 5);

const nearbySuccess = {
  lat: point.lat,
  lng: point.lng,
  success: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const withEvidence = predictBorewell({ ...point, nearbyLogs: [nearbySuccess] });
assert.ok(withEvidence.successProbability >= same.successProbability);
assert.equal(withEvidence.confidenceReason.nearbyCount, 1);
assert.equal(withEvidence.confidenceReason.successCount, 1);

console.log("predict.js contract tests passed");
