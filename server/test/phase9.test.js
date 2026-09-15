import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { createPhase9Router } from "../phase9Routes.js";
import { createPhase8Router } from "../phase8Routes.js";
import {
  analyzeSubmission,
  canTransition,
  computeOperatorTrust,
  VERIFICATION_STATUSES,
} from "../verification.js";
import {
  operatorReviewRequestSchema,
  reviewDecisionSchema,
  reviewReopenSchema,
  reviewStartSchema,
} from "../phase9Validation.js";
import { adminLogPatchSchema, borewellSchema, validate } from "../validation.js";
import { isTrustedOutcome } from "../rigData.js";
import { isTrustedBorewellEvidence, validateTrainingTarget } from "../featurePipeline.js";

function operatorRecord(overrides = {}) {
  return {
    id: "well-1",
    rigSubmissionSchemaVersion: "8.0.0",
    verificationStatus: "SUBMITTED",
    lat: 11.36,
    lng: 77.8,
    gps: { accuracyM: 8, capturedAt: "2026-09-14T10:00:00.000Z", source: "device_geolocation" },
    drillingDate: "2026-09-14",
    drilledDate: "2026-09-14",
    drilledAt: "2026-09-14T00:00:00.000Z",
    submittedAt: "2026-09-15T00:00:00.000Z",
    createdAt: "2026-09-15T00:00:00.000Z",
    placeName: "Test village",
    depthFt: 400,
    waterStrikeFt: 250,
    yieldLpm: 40,
    success: true,
    strata: "weathered rock → fractured granite",
    geologicalLayers: [
      { fromFt: 0, toFt: 100, material: "weathered rock", notes: "" },
      { fromFt: 100, toFt: 400, material: "fractured granite", notes: "" },
    ],
    evidence: [{ id: "photo-1", kind: "photo", sha256: "a".repeat(64), byteSize: 100, mediaType: "image/jpeg" }],
    evidenceSummary: { photoCount: 1, videoCount: 0 },
    operatorId: "op-1",
    operatorName: "Operator One",
    verified: false,
    flagged: false,
    datasetEligibility: { eligible: false, status: "awaiting_operator_submission_verification" },
    provenance: { sourceType: "operator", identitySource: "authenticated_session" },
    ingestionFingerprint: "fingerprint-well-1",
    ledgerScoredAt: null,
    ledgerScoredPredictions: 0,
    ...overrides,
  };
}

function importedRecord(overrides = {}) {
  return {
    id: "imported-1",
    lat: 11.5,
    lng: 77.9,
    verified: false,
    flagged: false,
    datasetEligibility: { eligible: true, status: "published_import" },
    provenance: { sourceType: "government" },
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function memoryDb(recordsInput = [operatorRecord()]) {
  let records = structuredClone(recordsInput);
  let predictions = [{
    id: "pred-1",
    lat: 11.36,
    lng: 77.8,
    successProbability: 75,
    depthBandFt: [200, 300],
    expectedYieldLpm: [30, 50],
    predictionSource: "ml",
    modelVersion: "phase9-test-model",
    createdAt: "2026-09-13T12:00:00.000Z",
    actual: null,
    correct: null,
  }];
  const audits = [];
  const operators = [{ id: "op-1", name: "Operator One", phone: "1", role: "operator", status: "active", verified: true }];
  return {
    api: {
      getAllBorewells: async () => structuredClone(records),
      getBorewells: async () => structuredClone(records),
      updateBorewell: async (id, patch) => {
        const index = records.findIndex((item) => item.id === id);
        if (index < 0) return null;
        records[index] = { ...records[index], ...structuredClone(patch) };
        return structuredClone(records[index]);
      },
      getPredictions: async () => structuredClone(predictions),
      updatePrediction: async (id, patch) => {
        const index = predictions.findIndex((item) => item.id === id);
        if (index < 0) return null;
        predictions[index] = { ...predictions[index], ...structuredClone(patch) };
        return structuredClone(predictions[index]);
      },
      addIngestionAudit: async (event) => { audits.push(structuredClone(event)); return event; },
      getIngestionAuditByScope: async (scopeType, scopeId) => audits.filter((event) => event.scopeType === scopeType && event.scopeId === scopeId).reverse(),
      getOperatorById: async (id) => structuredClone(operators.find((operator) => operator.id === id) || null),
      updateOperator: async (id, patch) => {
        const index = operators.findIndex((operator) => operator.id === id);
        if (index < 0) return null;
        operators[index] = { ...operators[index], ...structuredClone(patch) };
        return structuredClone(operators[index]);
      },
      getAssignmentsByOperator: async () => [],
    },
    state() { return { records, predictions, audits, operators }; },
  };
}

function auth(req, _res, next) {
  if (req.headers["x-test-user"] === "operator") {
    req.operator = { id: "op-1", name: "Operator One", role: "operator" };
  } else {
    req.operator = { id: "admin-1", name: "Review Admin", role: "admin" };
  }
  next();
}

function admin(req, res, next) {
  if (req.operator?.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}

function buildPhase9App(db) {
  const app = express();
  app.use(express.json());
  app.use(createPhase9Router({
    db,
    requireAuth: auth,
    requireAdmin: admin,
    validate,
    reviewStartSchema,
    reviewDecisionSchema,
    reviewReopenSchema,
    operatorReviewRequestSchema,
    distanceKm: () => 0,
    NEAR_KM: 5,
  }));
  return app;
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

test("deterministic analysis catches duplicate, poor-GPS and extreme-yield signals", () => {
  const record = operatorRecord({ gps: { accuracyM: 140, capturedAt: "2026-09-14T10:00:00Z" }, yieldLpm: 2500 });
  const duplicate = operatorRecord({ id: "well-2", ingestionFingerprint: record.ingestionFingerprint, verificationStatus: "UNDER_REVIEW" });
  const analysis = analyzeSubmission(record, { operatorRecords: [record, duplicate], allRecords: [record, duplicate] });
  assert.equal(analysis.suspicious, true);
  assert.equal(analysis.requiresOverrideToVerify, true);
  assert.ok(analysis.riskScore >= 35);
  assert.ok(analysis.signals.some((signal) => signal.code === "GPS_ACCURACY_VERY_LOW"));
  assert.ok(analysis.signals.some((signal) => signal.code === "YIELD_EXTREME"));
  assert.ok(analysis.signals.some((signal) => signal.code === "DUPLICATE_FINGERPRINT"));
});

test("operator trust is provisional for new operators and responds to reviewed outcomes", () => {
  const empty = computeOperatorTrust([], { operatorId: "op-1" });
  assert.equal(empty.score, 50);
  assert.equal(empty.tier, "NEW");
  assert.equal(empty.reviewedCount, 0);

  const good = [0, 1, 2, 3].map((i) => operatorRecord({
    id: `good-${i}`,
    verificationStatus: "VERIFIED",
    verified: true,
    datasetEligibility: { eligible: true, status: "verified_operator_outcome" },
    verification: { riskScore: 0 },
  }));
  const poor = good.map((record, i) => i < 3 ? {
    ...record,
    verificationStatus: "REJECTED",
    verified: false,
    datasetEligibility: { eligible: false, status: "rejected_operator_outcome" },
    verification: { riskScore: 50 },
  } : record);
  assert.ok(computeOperatorTrust(good, { operatorId: "op-1" }).score > computeOperatorTrust(poor, { operatorId: "op-1" }).score);
});

test("verification state machine permits only explicit review transitions", () => {
  assert.equal(canTransition("SUBMITTED", "UNDER_REVIEW"), true);
  assert.equal(canTransition("SUBMITTED", "VERIFIED"), false);
  assert.equal(canTransition("UNDER_REVIEW", "VERIFIED"), true);
  assert.equal(canTransition("UNDER_REVIEW", "REJECTED"), true);
  assert.equal(canTransition("VERIFIED", "UNDER_REVIEW"), true);
  assert.equal(canTransition("REJECTED", "SUBMITTED"), true);
});

test("clean submission requires review start before verify and then promotes/scores ledger", async () => {
  const store = memoryDb();
  await withServer(buildPhase9App(store.api), async (base) => {
    let result = await jsonFetch(`${base}/api/admin/review/logs/well-1/decision`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "verify" }),
    });
    assert.equal(result.response.status, 409);

    result = await jsonFetch(`${base}/api/admin/review/logs/well-1/start`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "Checking evidence" }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.verificationStatus, "UNDER_REVIEW");

    result = await jsonFetch(`${base}/api/admin/review/logs/well-1/decision`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "verify", decisionReason: "Evidence and drilling record are consistent." }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.record.verificationStatus, "VERIFIED");
    assert.equal(result.body.record.datasetEligibility.eligible, true);
    assert.equal(store.state().predictions[0].actual.borewellId, "well-1");
    assert.equal(store.state().predictions[0].correct, true);
    assert.equal(store.state().predictions[0].accountability.status, "SCORED_VERIFIED");
    assert.equal(store.state().audits.length, 3);
    assert.ok(store.state().audits.some((event) => event.scopeType === "prediction_accountability" && event.action === "verified_outcome_scored"));
    assert.ok(store.state().operators[0].trustProfile);
  });
});

test("high-risk submission cannot verify without documented override", async () => {
  const store = memoryDb([operatorRecord({ gps: { accuracyM: 150, capturedAt: "2026-09-14T10:00:00Z" } })]);
  await withServer(buildPhase9App(store.api), async (base) => {
    await jsonFetch(`${base}/api/admin/review/logs/well-1/start`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    let result = await jsonFetch(`${base}/api/admin/review/logs/well-1/decision`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "verify" }),
    });
    assert.equal(result.response.status, 409);
    assert.ok(result.body.blockingSignalCodes.includes("GPS_ACCURACY_VERY_LOW"));

    result = await jsonFetch(`${base}/api/admin/review/logs/well-1/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "verify",
        decisionReason: "Photo and field notes independently confirm the drill location.",
        overrideRisk: true,
        overrideReason: "Manual evidence review confirms the location despite poor GPS accuracy.",
      }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.record.verificationStatus, "VERIFIED");
    assert.equal(result.body.record.reviewOverride.risk, true);
  });
});

test("rejected operator can request re-review but stays untrusted", async () => {
  const store = memoryDb();
  await withServer(buildPhase9App(store.api), async (base) => {
    await jsonFetch(`${base}/api/admin/review/logs/well-1/start`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    let result = await jsonFetch(`${base}/api/admin/review/logs/well-1/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "reject", decisionReason: "The photo evidence does not match the submitted drilling location." }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.record.verificationStatus, "REJECTED");
    assert.equal(result.body.record.datasetEligibility.eligible, false);

    result = await jsonFetch(`${base}/api/borewells/well-1/request-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": "operator" },
      body: JSON.stringify({ note: "I have checked the field record and request another review of the evidence." }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.verificationStatus, "SUBMITTED");
    assert.equal(result.body.verified, false);
    assert.equal(result.body.datasetEligibility.eligible, false);
    assert.ok(store.state().audits.some((event) => event.action === "operator_review_requested"));
  });
});

test("Phase 9 trusted and offline-ML predicates require lifecycle VERIFIED", () => {
  const legacyBooleanOnly = operatorRecord({
    verificationStatus: "SUBMITTED",
    verified: true,
    datasetEligibility: { eligible: true, status: "verified_operator_outcome" },
  });
  assert.equal(isTrustedOutcome(legacyBooleanOnly), false);
  assert.equal(isTrustedBorewellEvidence(legacyBooleanOnly), false);
  assert.equal(validateTrainingTarget(legacyBooleanOnly).valid, false);

  const verified = { ...legacyBooleanOnly, verificationStatus: "VERIFIED" };
  assert.equal(isTrustedOutcome(verified), true);
  assert.equal(isTrustedBorewellEvidence(verified), true);
  assert.equal(validateTrainingTarget(verified).valid, true);
});

test("legacy admin verified patch cannot bypass Phase 9 for operator records", async () => {
  const store = memoryDb([operatorRecord(), importedRecord()]);
  const app = express();
  app.use(express.json());
  app.use(createPhase8Router({
    db: store.api,
    requireAuth: auth,
    requireAdmin: admin,
    validate,
    borewellSchema,
    adminLogPatchSchema,
    distanceKm: () => 0,
    NEAR_KM: 5,
  }));
  await withServer(app, async (base) => {
    let result = await jsonFetch(`${base}/api/admin/logs/well-1`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verified: true }),
    });
    assert.equal(result.response.status, 409);
    assert.equal(store.state().records.find((item) => item.id === "well-1").verified, false);

    result = await jsonFetch(`${base}/api/admin/logs/imported-1`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verified: true }),
    });
    assert.equal(result.response.status, 200);
    assert.equal(store.state().records.find((item) => item.id === "imported-1").verified, true);
    assert.equal(store.state().records.find((item) => item.id === "imported-1").datasetEligibility.status, "published_import");
  });
});
