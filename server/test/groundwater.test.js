import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { groundwaterOutlook, isValidOutlook } from "../groundwater.js";
import { MlServiceError } from "../mlClient.js";
import { noEstimate } from "../predict.js";
import { createPhase11Router } from "../phase11Routes.js";
import { validate } from "../validation.js";

const GOOD = {
  available: true,
  modelVersion: "gw-abc123",
  preMonsoon: { depthM: 6.2, lowM: 4.1, highM: 9.0 },
  postMonsoon: { depthM: 3.1, lowM: 2.0, highM: 4.6 },
  seasonalRiseM: 3.1,
  chanceWithin10m: 0.78,
  intervalCoveragePct: 80,
  rockUnit: "Peninsular Gneiss",
  elevationM: 210,
  nearestStationKm: 4.2,
  validation: { stations: 19000, preMonsoonMaeM: 2.5 },
};

const clientReturning = (value) => ({ groundwater: async () => value });
const clientFailing = (code, status = 422) => ({
  groundwater: async () => { throw new MlServiceError("refused", { code, status }); },
});

test("a valid model outlook passes through with its numbers", async () => {
  const outlook = await groundwaterOutlook({ lat: 9.9, lng: 78.1, client: clientReturning(GOOD), env: {} });
  assert.equal(outlook.available, true);
  assert.equal(outlook.preMonsoon.depthM, 6.2);
  assert.equal(outlook.chanceWithin10m, 0.78);
});

test("malformed or impossible outlooks are dropped, never shown", () => {
  assert.equal(isValidOutlook(GOOD), true);
  assert.equal(isValidOutlook({ ...GOOD, preMonsoon: { depthM: 6, lowM: 8, highM: 9 } }), false, "low above the centre");
  assert.equal(isValidOutlook({ ...GOOD, chanceWithin10m: 1.4 }), false);
  assert.equal(isValidOutlook({ ...GOOD, postMonsoon: { depthM: Number.NaN, lowM: 1, highM: 2 } }), false);
  assert.equal(isValidOutlook({ ...GOOD, modelVersion: "" }), false);
});

test("refusals keep their reason; unknown failures become UNAVAILABLE", async () => {
  for (const code of ["OUTSIDE_COVERAGE", "LOW_COVERAGE", "FEATURE_SOURCE_UNAVAILABLE"]) {
    assert.deepEqual(await groundwaterOutlook({ lat: 0, lng: 0, client: clientFailing(code), env: {} }), { available: false, reason: code });
  }
  assert.deepEqual(await groundwaterOutlook({ lat: 0, lng: 0, client: clientFailing("ML_TIMEOUT", null), env: {} }),
    { available: false, reason: "UNAVAILABLE" });
  assert.deepEqual(await groundwaterOutlook({ lat: 0, lng: 0, client: clientReturning({ available: true }), env: {} }),
    { available: false, reason: "UNAVAILABLE" });
  assert.deepEqual(await groundwaterOutlook({ lat: 0, lng: 0, client: clientReturning(GOOD), env: { GROUNDWATER_OUTLOOK: "NO" } }),
    { available: false, reason: "DISABLED" });
});

test("outside the pilot area the farmer still gets the outlook, and it never enters the ledger", async (t) => {
  const saved = [];
  const db = {
    getBorewellsNear: async () => [],
    addPrediction: async (record) => { saved.push(record); return record; },
  };
  const predictor = async ({ lat, lng, nearbyLogs }) => noEstimate({ lat, lng, nearbyLogs, reason: "OUTSIDE_PILOT_AREA" });
  const groundwater = async () => ({ ...GOOD });
  const app = express();
  app.use(express.json());
  const pass = (_req, _res, next) => next();
  app.use(createPhase11Router({ db, requireAuth: pass, requireAdmin: pass, validate, predictor, groundwater }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/predict`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: 9.93, lng: 78.12 }), // Madurai
  });
  const body = await response.json();
  assert.equal(body.estimateAvailable, false);
  assert.equal(body.noEstimateReason, "OUTSIDE_PILOT_AREA");
  assert.equal(body.successProbability, null, "no borewell number outside the pilot");
  assert.equal(body.groundwater.available, true);
  assert.equal(body.groundwater.preMonsoon.depthM, 6.2);
  assert.equal(saved.length, 0, "a groundwater outlook is context, not a ledger prediction");
});
