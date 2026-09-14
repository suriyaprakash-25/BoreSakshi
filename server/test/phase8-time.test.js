import test from "node:test";
import assert from "node:assert/strict";

import { borewellSchema } from "../validation.js";

function payload() {
  return {
    lat: 11.36,
    lng: 77.8,
    gpsAccuracyM: 8,
    gpsCapturedAt: new Date().toISOString(),
    drillingDate: new Date().toISOString().slice(0, 10),
    placeName: "Test",
    depthFt: 300,
    strata: "fractured granite",
    geologicalLayers: [{ fromFt: 0, toFt: 300, material: "fractured granite", notes: "" }],
    waterStrikeFt: 200,
    yieldLpm: 40,
    success: true,
    evidenceTokens: ["x".repeat(40)],
    language: "en",
  };
}

test("Phase 8 rejects future drilling dates", () => {
  const value = payload();
  value.drillingDate = "2999-01-01";
  const result = borewellSchema.safeParse(value);
  assert.equal(result.success, false);
  assert.match(result.error.issues.map((issue) => issue.message).join(" "), /future/);
});

test("Phase 8 rejects future GPS capture timestamps", () => {
  const value = payload();
  value.gpsCapturedAt = "2999-01-01T00:00:00.000Z";
  const result = borewellSchema.safeParse(value);
  assert.equal(result.success, false);
  assert.match(result.error.issues.map((issue) => issue.message).join(" "), /GPS capture timestamp/);
});

test("Phase 8 rejects impossible calendar dates", () => {
  const value = payload();
  value.drillingDate = "2026-02-31";
  const result = borewellSchema.safeParse(value);
  assert.equal(result.success, false);
  assert.match(result.error.issues.map((issue) => issue.message).join(" "), /valid calendar date/);
});
