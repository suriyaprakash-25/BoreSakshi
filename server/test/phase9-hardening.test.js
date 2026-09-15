import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { createPhase8Router } from "../phase8Routes.js";
import { borewellSchema, adminLogPatchSchema, validate } from "../validation.js";

function verifiedRecord() {
  return {
    id: "well-verified",
    rigSubmissionSchemaVersion: "8.0.0",
    verificationStatus: "VERIFIED",
    lat: 11.36,
    lng: 77.8,
    drilledAt: "2026-09-14T00:00:00Z",
    success: true,
    depthFt: 400,
    waterStrikeFt: 250,
    yieldLpm: 40,
    operatorId: "op-1",
    operatorName: "Operator One",
    verified: true,
    flagged: false,
    datasetEligibility: { eligible: true, status: "verified_operator_outcome" },
    provenance: { sourceType: "operator" },
    ledgerScoredAt: "2026-09-15T01:00:00Z",
    ledgerScoredPredictions: 1,
  };
}

function makeDb() {
  let record = verifiedRecord();
  let prediction = {
    id: "pred-1", lat: 11.36, lng: 77.8, successProbability: 80,
    depthBandFt: [200, 300], expectedYieldLpm: [30, 50],
    predictionSource: "ml", modelVersion: "phase9-hardening-model",
    createdAt: "2026-09-13T00:00:00Z",
    actual: {
      borewellId: record.id,
      success: true,
      depthFt: record.depthFt,
      waterStrikeFt: record.waterStrikeFt,
      yieldLpm: record.yieldLpm,
      verified: true,
      closedAt: "2026-09-15T01:00:00Z",
    },
    correct: true,
  };
  const audits = [];
  return {
    api: {
      getAllBorewells: async () => [record],
      getBorewells: async () => [record],
      updateBorewell: async (_id, patch) => { record = { ...record, ...patch }; return record; },
      getPredictions: async () => [prediction],
      updatePrediction: async (_id, patch) => { prediction = { ...prediction, ...patch }; return prediction; },
      addIngestionAudit: async (event) => { audits.push(event); return event; },
      getIngestionAuditByScope: async () => audits,
      getOperatorById: async () => ({ id: "op-1", name: "Operator One" }),
      updateOperator: async (_id, patch) => ({ id: "op-1", ...patch }),
      getAssignmentsByOperator: async () => [],
    },
    state: () => ({ record, prediction, audits }),
  };
}

function appFor(db) {
  const app = express();
  app.use(express.json());
  app.use(createPhase8Router({
    db,
    requireAuth: (req, _res, next) => { req.operator = { id: "admin-1", name: "Admin", role: "admin" }; next(); },
    requireAdmin: (_req, _res, next) => next(),
    validate,
    borewellSchema,
    adminLogPatchSchema,
    distanceKm: () => 0,
    NEAR_KM: 5,
  }));
  return app;
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("decided records cannot bypass reopen-reason requirement through review start", async () => {
  const store = makeDb();
  await withServer(appFor(store.api), async (base) => {
    const response = await fetch(`${base}/api/admin/review/logs/well-verified/start`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(response.status, 409);
    assert.equal(store.state().record.verificationStatus, "VERIFIED");
    assert.equal(store.state().prediction.actual.borewellId, "well-verified");
  });
});

test("manual flag removes trust, reopens linked ledger predictions and writes both audits", async () => {
  const store = makeDb();
  await withServer(appFor(store.api), async (base) => {
    const response = await fetch(`${base}/api/admin/logs/well-verified`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flagged: true, flagReason: "Evidence requires another manual review" }),
    });
    assert.equal(response.status, 200);
    const { record, prediction, audits } = store.state();
    assert.equal(record.verificationStatus, "UNDER_REVIEW");
    assert.equal(record.verified, false);
    assert.equal(record.datasetEligibility.eligible, false);
    assert.equal(record.ledgerScoredAt, null);
    assert.equal(prediction.actual, null);
    assert.equal(prediction.correct, null);
    assert.equal(prediction.accountability.status, "PENDING_REVERIFY");
    assert.equal(audits.length, 2);
    const ledgerAudit = audits.find((event) => event.scopeType === "prediction_accountability");
    const verificationAudit = audits.find((event) => event.scopeType === "rig_verification");
    assert.equal(ledgerAudit.action, "outcome_reopened");
    assert.equal(verificationAudit.action, "verification_flagged_for_review");
    assert.equal(verificationAudit.details.reopenedPredictions, 1);
  });
});
