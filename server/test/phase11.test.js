import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import {
  ACCOUNTABILITY_SCHEMA_VERSION,
  buildPredictionAccountability,
  normalizePredictionAccountability,
  reopenPredictionAccountability,
  safeLedgerEntry,
  scorePredictionAgainstOutcome,
  summarizeAccountabilityLedger,
} from "../accountability.js";
import { createPhase11Router } from "../phase11Routes.js";
import { validate } from "../validation.js";

function prediction(overrides = {}) {
  const value = {
    id: "pred-1",
    lat: 11.36,
    lng: 77.8,
    successProbability: 80,
    depthBandFt: [200, 300],
    expectedYieldLpm: [30, 50],
    predictionSource: "ml",
    modelVersion: "run-v2@eval-v2",
    deploymentId: "deployment-v2",
    featureVersion: "dataset-v2:features-1.0.0",
    featureSnapshotRef: "fsnap:test",
    predictionTimestamp: "2026-09-13T10:00:00.000Z",
    createdAt: "2026-09-13T10:00:00.000Z",
    actual: null,
    correct: null,
    ...overrides,
  };
  if (!value.accountability) value.accountability = buildPredictionAccountability(value);
  return value;
}

function outcome(overrides = {}) {
  return {
    id: "well-1",
    lat: 11.36,
    lng: 77.8,
    success: true,
    depthFt: 410,
    waterStrikeFt: 240,
    yieldLpm: 45,
    drilledAt: "2026-09-14T00:00:00.000Z",
    verifiedAt: "2026-09-15T01:00:00.000Z",
    verificationStatus: "VERIFIED",
    verified: true,
    district: "Erode",
    taluk: "Bhavani",
    placeName: "Test village",
    ...overrides,
  };
}

function scoredPrediction(pred = prediction(), actual = outcome()) {
  return { ...pred, ...scorePredictionAgainstOutcome(pred, actual, { now: "2026-09-15T01:00:00.000Z", matchDistanceKm: 0.2 }) };
}

test("prediction accountability snapshots every Phase 11 roadmap prediction field", () => {
  const item = prediction();
  const state = item.accountability;
  assert.equal(state.schemaVersion, ACCOUNTABILITY_SCHEMA_VERSION);
  assert.equal(state.predictionId, "pred-1");
  assert.equal(state.predictionDate, "2026-09-13T10:00:00.000Z");
  assert.equal(state.modelVersion, "run-v2@eval-v2");
  assert.equal(state.deploymentId, "deployment-v2");
  assert.equal(state.predicted.successProbabilityPct, 80);
  assert.deepEqual(state.predicted.depthFt, { min: 200, max: 300, estimate: 250 });
  assert.deepEqual(state.predicted.yieldLpm, { min: 30, max: 50, estimate: 40 });
  assert.equal(state.actual, null);
  assert.equal(state.status, "PENDING_OUTCOME");
});

test("verified outcome scoring calculates correctness, Brier, depth and yield error", () => {
  const pred = prediction();
  const patch = scorePredictionAgainstOutcome(pred, outcome(), { now: "2026-09-15T01:00:00.000Z", matchDistanceKm: 0.2 });
  assert.equal(patch.correct, true);
  assert.equal(patch.accountability.status, "SCORED_VERIFIED");
  assert.equal(patch.accountability.actual.verificationStatus, "VERIFIED");
  assert.equal(patch.accountability.actual.outcomeDate, "2026-09-15T01:00:00.000Z");
  assert.equal(patch.accountability.actual.regionKey, "Erode / Bhavani");
  assert.equal(patch.accountability.metrics.brier, 0.04);
  assert.equal(patch.accountability.metrics.depthErrorFt, 10);
  assert.equal(patch.accountability.metrics.depthAbsoluteErrorFt, 10);
  assert.equal(patch.accountability.metrics.yieldErrorLpm, -5);
  assert.equal(patch.accountability.metrics.yieldAbsoluteErrorLpm, 5);
});

test("dry holes are scored for success/calibration and excluded from water-strike depth error", () => {
  const pred = prediction({ successProbability: 20, depthBandFt: [300, 500], expectedYieldLpm: [0, 20] });
  pred.accountability = buildPredictionAccountability(pred);
  const patch = scorePredictionAgainstOutcome(pred, outcome({ success: false, waterStrikeFt: 0, yieldLpm: 0 }));
  assert.equal(patch.correct, true);
  assert.equal(patch.accountability.metrics.brier, 0.04);
  assert.equal(patch.accountability.metrics.depthErrorFt, null);
  assert.equal(patch.accountability.metrics.depthAbsoluteErrorFt, null);
  assert.equal(patch.accountability.metrics.yieldErrorLpm, 10);
});

test("ledger calculates calibration/errors and keeps ML versions separate from fallback", () => {
  const mlOne = scoredPrediction(prediction({ id: "ml-1", successProbability: 80 }), outcome({ id: "w-1", success: true, waterStrikeFt: 240, yieldLpm: 45 }));
  const mlTwoBase = prediction({ id: "ml-2", successProbability: 70, modelVersion: "run-v3@eval-v3", deploymentId: "deployment-v3" });
  const mlTwo = scoredPrediction(mlTwoBase, outcome({ id: "w-2", success: false, waterStrikeFt: 0, yieldLpm: 0, district: "Salem", taluk: "Mettur" }));
  const fallbackBase = prediction({
    id: "fallback-1",
    successProbability: 60,
    predictionSource: "heuristic_fallback",
    modelVersion: null,
    deploymentId: null,
    featureVersion: null,
  });
  fallbackBase.accountability = buildPredictionAccountability(fallbackBase);
  const fallback = scoredPrediction(fallbackBase, outcome({ id: "w-3", success: true }));

  const report = summarizeAccountabilityLedger([mlOne, mlTwo, fallback]);
  assert.equal(report.totalPredictions, 3);
  assert.equal(report.scored, 3);
  assert.equal(report.correct, 2);
  assert.equal(report.accuracyPct, 66.7);
  assert.equal(report.brier, 0.23);
  assert.ok(report.expectedCalibrationError >= 0);
  assert.equal(report.depth.count, 2);
  assert.equal(report.yield.count, 3);
  assert.deepEqual(report.byModelVersion.map((item) => item.key).sort(), ["heuristic_fallback", "run-v2@eval-v2", "run-v3@eval-v3"]);
  assert.deepEqual(report.bySource.map((item) => item.key).sort(), ["heuristic_fallback", "ml"]);
  assert.ok(report.byRegion.some((item) => item.key === "Erode / Bhavani"));
  assert.ok(report.byRegion.some((item) => item.key === "Salem / Mettur"));
});

test("legacy Phase 8/9 actual outcome is normalized into full Phase 11 metrics without migration", () => {
  const legacy = prediction({
    id: "legacy",
    accountability: undefined,
    actual: {
      success: true,
      depthFt: 420,
      waterStrikeFt: 260,
      yieldLpm: 35,
      borewellId: "legacy-well",
      verified: true,
      closedAt: "2026-09-15T02:00:00.000Z",
    },
    correct: true,
  });
  delete legacy.accountability;
  const normalized = normalizePredictionAccountability(legacy);
  assert.equal(normalized.status, "SCORED_VERIFIED");
  assert.equal(normalized.metrics.depthErrorFt, -10);
  assert.equal(normalized.metrics.yieldErrorLpm, 5);
  assert.match(normalized.actual.regionKey, /^grid:/);
});

test("reopening removes the current outcome from metrics while retaining last-scored provenance", () => {
  const scored = scoredPrediction();
  const reopened = { ...scored, ...reopenPredictionAccountability(scored, { now: "2026-09-16T00:00:00Z", reason: "Verification review reopened" }) };
  assert.equal(reopened.actual, null);
  assert.equal(reopened.correct, null);
  assert.equal(reopened.accountability.status, "PENDING_REVERIFY");
  assert.equal(reopened.accountability.metrics, null);
  assert.equal(reopened.accountability.lastScoredOutcome.borewellId, "well-1");
  const report = summarizeAccountabilityLedger([reopened]);
  assert.equal(report.scored, 0);
  assert.equal(report.pending, 1);
});

function memoryDb() {
  let predictions = [];
  const audits = [];
  return {
    api: {
      getBorewells: async () => [],
      getPredictions: async () => structuredClone(predictions),
      addPrediction: async (record) => { predictions.push(structuredClone(record)); return structuredClone(record); },
      updatePrediction: async (id, patch) => {
        const index = predictions.findIndex((item) => item.id === id);
        predictions[index] = { ...predictions[index], ...structuredClone(patch) };
        return structuredClone(predictions[index]);
      },
      addIngestionAudit: async (event) => { audits.push(structuredClone(event)); return event; },
      getIngestionAuditByScope: async (scopeType, scopeId) => audits.filter((event) => event.scopeType === scopeType && event.scopeId === scopeId),
    },
    state: () => ({ predictions, audits }),
  };
}

function auth(req, _res, next) {
  req.operator = { id: "admin-1", name: "Ledger Admin", role: "admin" };
  next();
}

function predictor() {
  return Promise.resolve({
    successProbability: 72,
    depthBandFt: [220, 320],
    expectedYieldLpm: [35, 55],
    confidence: "High",
    rockType: "Fractured granite",
    basis: "test",
    isMock: false,
    predictionSource: "ml",
    modelAvailable: true,
    modelVersion: "run-v10@eval-v10",
    deploymentId: "prod-v10",
    featureVersion: "dataset-v10:features-1.0.0",
    predictionContractVersion: "1.0.0",
    featureSnapshotRef: "fsnap:test-v10",
    featureSnapshot: { ref: "fsnap:test-v10" },
    predictionTimestamp: "2026-09-15T00:00:00.000Z",
    coverageWarning: null,
    uncertainty: {},
    featureCoverage: { coveragePct: 100 },
    explanations: [],
    factors: [],
    confidenceReason: {},
  });
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("Phase 11 predict route snapshots only persisted predictions and writes issuance audit", async () => {
  const store = memoryDb();
  const app = express();
  app.use(express.json());
  app.use(createPhase11Router({ db: store.api, requireAuth: auth, requireAdmin: auth, validate, predictor }));

  await withServer(app, async (base) => {
    let response = await fetch(`${base}/api/predict`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: 11.36, lng: 77.8, save: false }),
    });
    let body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.predictionId, null);
    assert.equal(store.state().predictions.length, 0);
    assert.equal(store.state().audits.length, 0);

    response = await fetch(`${base}/api/predict`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: 11.36, lng: 77.8, save: true }),
    });
    body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(body.predictionId);
    assert.equal(body.accountabilityStatus, "PENDING_OUTCOME");
    const saved = store.state().predictions[0];
    assert.equal(saved.accountability.modelVersion, "run-v10@eval-v10");
    assert.equal(saved.accountability.deploymentId, "prod-v10");
    assert.equal(store.state().audits[0].action, "prediction_issued");
    assert.equal(store.state().audits[0].scopeType, "prediction_accountability");
  });
});

test("ledger API remains backward compatible while exposing model, region and error metrics", async () => {
  const store = memoryDb();
  const scored = scoredPrediction(prediction({ id: "route-pred" }), outcome());
  await store.api.addPrediction(scored);
  const app = express();
  app.use(express.json());
  app.use(createPhase11Router({ db: store.api, requireAuth: auth, requireAdmin: auth, validate, predictor }));

  await withServer(app, async (base) => {
    let response = await fetch(`${base}/api/ledger`);
    let body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.totalPredictions, 1);
    assert.equal(body.scored, 1);
    assert.equal(body.correct, 1);
    assert.equal(body.accuracyPct, 100);
    assert.equal(body.depth.maeFt, 10);
    assert.equal(body.yield.maeLpm, 5);
    assert.equal(body.byModelVersion[0].key, "run-v2@eval-v2");
    assert.equal(body.byRegion[0].key, "Erode / Bhavani");
    assert.equal(body.recent[0].verificationStatus, "VERIFIED");

    response = await fetch(`${base}/api/ledger/entries?modelVersion=run-v2%40eval-v2&status=SCORED_VERIFIED`);
    body = await response.json();
    assert.equal(body.total, 1);
    assert.equal(body.items[0].predictionId, "route-pred");
    assert.equal(body.items[0].location.lat, 11.36);

    response = await fetch(`${base}/api/ledger/models`);
    body = await response.json();
    assert.equal(body.items[0].key, "run-v2@eval-v2");

    response = await fetch(`${base}/api/ledger/regions`);
    body = await response.json();
    assert.equal(body.items[0].key, "Erode / Bhavani");
  });
});

test("public ledger entry does not expose operator/reviewer identity or evidence", () => {
  const scored = scoredPrediction();
  scored.operatorId = "secret-operator";
  scored.evidence = [{ id: "private-photo" }];
  const entry = safeLedgerEntry(scored);
  assert.equal("operatorId" in entry, false);
  assert.equal("evidence" in entry, false);
  assert.equal(entry.location.lat, 11.36);
});
