import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { buildPredictionAccountability, safeLedgerEntry, summarizeAccountabilityLedger } from "../accountability.js";
import { scoreVerifiedOutcome } from "../ledgerMatching.js";
import { predictionDedupeKey } from "../phase11Routes.js";
import { insidePilotRegion, pilotRegion } from "../pilotRegion.js";
import { noEstimate, predictBorewell } from "../predict.js";
import { publicBorewellProjection } from "../security.js";
import { borewellFollowUpSchema, signupSchema, validate } from "../validation.js";
import { createPhase11Router } from "../phase11Routes.js";
import { buildOperatorBorewellRecord } from "../rigData.js";
import { borewellSchema } from "../validation.js";
import { withLedgerDb } from "./support.js";

const LAT = 11.36;
const LNG = 77.8;
const METRES_PER_DEGREE_LAT = 111_195;

function prediction(id, { metresNorth = 0, createdAt = "2026-09-01T00:00:00.000Z", ...overrides } = {}) {
  const value = {
    id,
    lat: LAT + metresNorth / METRES_PER_DEGREE_LAT,
    lng: LNG,
    successProbability: 70,
    predictionSource: "ml",
    modelVersion: "run-v1",
    actual: null,
    correct: null,
    createdAt,
    ...overrides,
  };
  value.accountability = buildPredictionAccountability(value);
  return value;
}

const well = (overrides = {}) => ({
  id: "well-1", lat: LAT, lng: LNG, success: true, depthFt: 300, waterStrikeFt: 200, yieldLpm: 40,
  drilledAt: "2026-09-14T00:00:00.000Z", verified: true, verificationStatus: "VERIFIED", ...overrides,
});

function ledgerStore(predictions) {
  const state = structuredClone(predictions);
  return {
    state,
    db: withLedgerDb({
      getPredictions: async () => structuredClone(state),
      updatePrediction: async (id, patch) => {
        Object.assign(state.find((item) => item.id === id), structuredClone(patch));
        return structuredClone(state.find((item) => item.id === id));
      },
    }),
  };
}

const score = (db, record = well()) => scoreVerifiedOutcome({ db, record, now: "2026-09-20T00:00:00.000Z", actor: null });

test("a verified well scores only its nearest prediction, never every pin around it", async () => {
  const { db, state } = ledgerStore([
    prediction("far", { metresNorth: 200 }),
    prediction("near", { metresNorth: 20 }),
    prediction("mid", { metresNorth: 100 }),
  ]);
  assert.equal(await score(db), 1);
  assert.deepEqual(state.filter((item) => item.actual).map((item) => item.id), ["near"]);
});

test("predictions outside 250 m are not scored by an unlinked well", async () => {
  const { db, state } = ledgerStore([prediction("outside", { metresNorth: 300 })]);
  assert.equal(await score(db), 0);
  assert.equal(state[0].actual, null);
});

test("a prediction linked by code is scored in preference to a closer one", async () => {
  const { db, state } = ledgerStore([prediction("closer", { metresNorth: 5 }), prediction("linked", { metresNorth: 900 })]);
  assert.equal(await score(db, well({ predictionId: "linked" })), 1);
  assert.deepEqual(state.filter((item) => item.actual).map((item) => item.id), ["linked"]);
});

test("a linked code beyond 1 km does not score and falls back to nearby matching", async () => {
  const { db, state } = ledgerStore([prediction("closer", { metresNorth: 5 }), prediction("linked", { metresNorth: 2000 })]);
  await score(db, well({ predictionId: "linked" }));
  assert.deepEqual(state.filter((item) => item.actual).map((item) => item.id), ["closer"]);
});

test("predictions issued after drilling or over a year before it are not scored", async () => {
  const { db } = ledgerStore([
    prediction("after", { createdAt: "2026-09-15T00:00:00.000Z" }),
    prediction("stale", { createdAt: "2025-08-01T00:00:00.000Z" }),
  ]);
  assert.equal(await score(db), 0);
});

test("legacy heuristic records never score", async () => {
  const { db } = ledgerStore([prediction("old", { predictionSource: "heuristic_fallback", modelVersion: null })]);
  assert.equal(await score(db), 0);
});

test("losing a concurrent claim moves on to the next candidate instead of overwriting", async () => {
  const { db, state } = ledgerStore([prediction("first", { metresNorth: 5 }), prediction("second", { metresNorth: 50 })]);
  const claim = db.claimPredictionOutcome;
  db.claimPredictionOutcome = async (id, patch) => id === "first" ? null : claim(id, patch);
  assert.equal(await score(db), 1);
  assert.deepEqual(state.filter((item) => item.actual).map((item) => item.id), ["second"]);
});

test("public accuracy describes the trained model only", () => {
  const scored = (id, source, successProbability) => {
    const value = prediction(id, { predictionSource: source, successProbability, modelVersion: source === "ml" ? "run-v1" : null });
    return {
      ...value,
      actual: { success: true, borewellId: "w", closedAt: "2026-09-20T00:00:00.000Z" },
      correct: successProbability >= 50,
    };
  };
  const ledger = summarizeAccountabilityLedger([scored("ml", "ml", 80), scored("old", "heuristic_fallback", 10)]);
  assert.equal(ledger.totalPredictions, 1);
  assert.equal(ledger.scored, 1);
  assert.equal(ledger.accuracyPct, 100);
  assert.deepEqual(ledger.bySource.map((item) => item.key).sort(), ["heuristic_fallback", "ml"]);
});

test("repeat taps in one cell and period share a dedupe key; other cells do not", () => {
  const base = { lat: 11.3601, lng: 77.8001, modelVersion: "run-v1", createdAt: "2026-09-01T00:00:00.000Z" };
  assert.equal(predictionDedupeKey(base), predictionDedupeKey({ ...base, lat: 11.36012, createdAt: "2026-09-01T09:00:00.000Z" }));
  assert.notEqual(predictionDedupeKey(base), predictionDedupeKey({ ...base, lat: 11.3621 }));
  assert.notEqual(predictionDedupeKey(base), predictionDedupeKey({ ...base, modelVersion: "run-v2" }));
  assert.notEqual(predictionDedupeKey(base), predictionDedupeKey({ ...base, createdAt: "2026-11-15T00:00:00.000Z" }));
});

test("pilot region accepts the belt, refuses elsewhere and rejects a malformed box", () => {
  assert.equal(insidePilotRegion(LAT, LNG), true);
  assert.equal(insidePilotRegion(28.61, 77.2), false);
  assert.equal(insidePilotRegion(0, 0), false);
  assert.equal(insidePilotRegion(28.61, 77.2, { PILOT_BBOX: "28,77,29,78" }), true);
  assert.throws(() => pilotRegion({ PILOT_BBOX: "11,78,10,77" }), /PILOT_BBOX/);
});

test("outside the pilot area the model is never called", async () => {
  const client = { predict: async () => { throw new Error("must not be called"); } };
  const result = await predictBorewell({ lat: 28.61, lng: 77.2, client });
  assert.equal(result.noEstimateReason, "OUTSIDE_PILOT_AREA");
});

test("a model refusal for low coverage is reported as low coverage, with no numbers", async () => {
  const client = { predict: async () => { throw Object.assign(new Error("low"), { code: "INSUFFICIENT_FEATURE_COVERAGE" }); } };
  const result = await predictBorewell({ lat: LAT, lng: LNG, client });
  assert.equal(result.estimateAvailable, false);
  assert.equal(result.noEstimateReason, "LOW_COVERAGE");
  for (const field of ["successProbability", "depthBandFt", "expectedYieldLpm", "confidence", "rockType"]) {
    assert.equal(result[field], null, field);
  }
});

test("no estimate still reports the verified wells nearby", () => {
  const logs = [{ lat: LAT, lng: LNG, success: true, distanceKm: 1 }, { lat: LAT, lng: LNG, success: false, distanceKm: 2 }];
  const result = noEstimate({ lat: LAT, lng: LNG, nearbyLogs: logs });
  assert.equal(result.confidenceReason.nearbyCount, 2);
  assert.equal(result.confidenceReason.successCount, 1);
});

test("public wells and ledger rows never expose a plot-level position", () => {
  const exact = { id: "w", lat: 11.36789, lng: 77.81234, placeName: "Raman's farm", success: true };
  const row = publicBorewellProjection({ ...exact, location: { type: "Point", coordinates: [77.81234, 11.36789] } });
  assert.deepEqual([row.lat, row.lng], [11.37, 77.81]);
  assert.deepEqual(row.location.coordinates, [77.81, 11.37]);
  assert.equal("placeName" in row, false);
  const entry = safeLedgerEntry(prediction("p", { lat: 11.36789, lng: 77.81234 }));
  assert.deepEqual([entry.location.lat, entry.location.lng], [11.37, 77.81]);
});

test("signup requires explicit consent", () => {
  const base = { name: "Rig", phone: "9000000002", password: "OperatorPass!2026", confirmPassword: "OperatorPass!2026" };
  assert.equal(signupSchema.safeParse(base).success, false);
  assert.equal(signupSchema.safeParse({ ...base, consentAccepted: false, consentVersion: "v1" }).success, false);
  assert.equal(signupSchema.safeParse({ ...base, consentAccepted: true, consentVersion: "v1" }).success, true);
});

test("TRUST_PROXY=2 resolves the real client behind the TLS proxy and web nginx", async () => {
  const app = express();
  app.set("trust proxy", 2);
  app.get("/ip", (req, res) => res.json({ ip: req.ip }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/ip`, {
      headers: { "X-Forwarded-For": "203.0.113.9, 172.18.0.1" },
    });
    assert.equal((await response.json()).ip, "203.0.113.9");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

const validLog = (overrides = {}) => ({
  lat: LAT, lng: LNG, gpsAccuracyM: 8, gpsCapturedAt: "2026-09-14T08:00:00.000Z", drillingDate: "2026-09-14",
  depthFt: 300, geologicalLayers: [{ fromFt: 0, toFt: 300, material: "gneiss" }], waterStrikeFt: 200, yieldLpm: 40,
  success: true, evidenceTokens: ["x".repeat(30)], ...overrides,
});

test("drill details are optional, validated and stored for training", () => {
  assert.equal(borewellSchema.safeParse(validLog()).success, true);
  const details = {
    waterStrikes: [{ depthFt: 120, flowLpm: 5 }, { depthFt: 200, flowLpm: null }],
    stopReason: "budget", yieldMethod: "timed_container", siteChosenBy: "diviner", depthToHardRockFt: 30,
  };
  const parsed = borewellSchema.safeParse(validLog(details));
  assert.equal(parsed.success, true);
  const record = buildOperatorBorewellRecord({
    id: "w", body: parsed.data, operator: { id: "o", name: "Op", verified: true }, evidence: [], submittedAt: "2026-09-15T00:00:00.000Z",
  });
  assert.deepEqual(record.drillDetails.waterStrikes, details.waterStrikes);
  assert.equal(record.drillDetails.siteChosenBy, "diviner");
  assert.equal(record.confidenceGrade, "G1");
  assert.deepEqual(record.followUps, []);
  assert.equal(borewellSchema.safeParse(validLog({ waterStrikes: [{ depthFt: 900 }] })).success, false);
  assert.equal(borewellSchema.safeParse(validLog({ depthToHardRockFt: 900 })).success, false);
  assert.equal(borewellSchema.safeParse(validLog({ stopReason: "bad luck" })).success, false);
});

test("a follow-up needs a date and a yes/no answer", () => {
  assert.equal(borewellFollowUpSchema.safeParse({ observedOn: "2027-05-01", stillYielding: false }).success, true);
  assert.equal(borewellFollowUpSchema.safeParse({ observedOn: "2027-05-01" }).success, false);
  assert.equal(borewellFollowUpSchema.safeParse({ observedOn: "May 2027", stillYielding: true }).success, false);
});

test("silent pilot stores the model estimate but shows the farmer no number", async (t) => {
  process.env.ML_SILENT_PILOT = "YES";
  t.after(() => { delete process.env.ML_SILENT_PILOT; });
  const saved = [];
  const db = {
    getBorewellsNear: async () => [],
    addPrediction: async (record) => { saved.push(record); return record; },
  };
  const predictor = async () => ({
    estimateAvailable: true, successProbability: 71, depthBandFt: [200, 300], expectedYieldLpm: [30, 50],
    predictionSource: "ml", modelVersion: "run-v1", confidenceReason: { nearbyCount: 0 },
  });
  const app = express();
  app.use(express.json());
  const pass = (_req, _res, next) => next();
  app.use(createPhase11Router({ db, requireAuth: pass, requireAdmin: pass, validate, predictor }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/predict`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: LAT, lng: LNG }),
  });
  const body = await response.json();
  assert.equal(body.estimateAvailable, false);
  assert.equal(body.noEstimateReason, "NOT_RELEASED");
  assert.equal(body.successProbability, null);
  assert.ok(body.predictionId, "the code still lets a rig operator link the outcome");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].successProbability, 71);
  assert.equal(saved[0].silentPilot, true);
});
