import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";

import { borewellSchema, adminLogPatchSchema, validate } from "../validation.js";
import { buildOperatorBorewellRecord, isTrustedOutcome } from "../rigData.js";
import { isTrustedBorewellEvidence, validateTrainingTarget } from "../featurePipeline.js";
import {
  bindEvidenceToBorewell,
  readStoredEvidence,
  resolveEvidenceTokens,
  storeEvidenceUpload,
  verifyEvidenceToken,
} from "../rigEvidence.js";
import { createPhase8Router } from "../phase8Routes.js";
import { averageDepth, successRate, trustScore, trustedOutcomeLogs } from "../../web/src/metrics.js";

function validPayload() {
  return {
    lat: 11.36,
    lng: 77.8,
    gpsAccuracyM: 7.5,
    gpsCapturedAt: "2026-09-14T20:00:00.000Z",
    drillingDate: "2026-09-14",
    placeName: "Test village",
    depthFt: 420,
    strata: "weathered rock → fractured granite",
    geologicalLayers: [
      { fromFt: 0, toFt: 120, material: "weathered rock", notes: "" },
      { fromFt: 120, toFt: 420, material: "fractured granite", notes: "fracture at 280" },
    ],
    waterStrikeFt: 280,
    yieldLpm: 45,
    success: true,
    evidenceTokens: ["x".repeat(40)],
    language: "ta",
  };
}

function routeApp(db) {
  const app = express();
  app.use(express.json());
  app.use(createPhase8Router({
    db,
    requireAuth: (req, _res, next) => { req.operator = { id: "admin", name: "Admin", role: "admin" }; next(); },
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

test("Phase 8 borewell schema requires GPS, geology and internally consistent outcome data", () => {
  assert.equal(borewellSchema.safeParse(validPayload()).success, true);
  const noGps = validPayload(); delete noGps.gpsAccuracyM;
  assert.equal(borewellSchema.safeParse(noGps).success, false);
  const noLayers = validPayload(); noLayers.geologicalLayers = [];
  assert.equal(borewellSchema.safeParse(noLayers).success, false);
  const impossibleStrike = validPayload(); impossibleStrike.waterStrikeFt = 500;
  assert.equal(borewellSchema.safeParse(impossibleStrike).success, false);
  const overlap = validPayload(); overlap.geologicalLayers[1].fromFt = 100;
  assert.equal(borewellSchema.safeParse(overlap).success, false);
  const dry = validPayload(); dry.success = false; dry.waterStrikeFt = 0; dry.yieldLpm = 0;
  assert.equal(borewellSchema.safeParse(dry).success, true);
});

test("operator identity is server-derived and new submissions are not trusted outcomes", () => {
  const record = buildOperatorBorewellRecord({
    id: "well-phase8",
    body: validPayload(),
    operator: { id: "auth-op", name: "Authenticated Operator", verified: true },
    evidence: [{ id: "photo1", kind: "photo", sha256: "a".repeat(64) }],
    submittedAt: "2026-09-15T01:00:00.000Z",
  });
  assert.equal(record.operatorId, "auth-op");
  assert.equal(record.operatorName, "Authenticated Operator");
  assert.equal(record.verified, false);
  assert.equal(record.verificationStatus, "SUBMITTED");
  assert.equal(record.datasetEligibility.eligible, false);
  assert.equal(record.drilledDate, "2026-09-14");
  assert.equal(record.gps.accuracyM, 7.5);
  assert.equal(isTrustedOutcome(record), false);
});

test("evidence tokens are operator-bound, checksum verified and consumed when bound", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "boresakshi-phase8-"));
  const oldDir = process.env.RIG_MEDIA_DIR;
  const oldSecret = process.env.RIG_EVIDENCE_SECRET;
  process.env.RIG_MEDIA_DIR = dir;
  process.env.RIG_EVIDENCE_SECRET = "phase8-test-secret-with-sufficient-entropy";
  try {
    const bytes = Buffer.from("fake jpeg bytes for contract test");
    const upload = await storeEvidenceUpload({
      buffer: bytes, mediaType: "image/jpeg", originalName: "site.jpg", operatorId: "op-1",
      now: new Date("2026-09-15T00:00:00Z"),
    });
    assert.equal(verifyEvidenceToken(upload.token, { operatorId: "op-1", now: Date.parse("2026-09-15T01:00:00Z") }).kind, "photo");
    assert.throws(() => verifyEvidenceToken(upload.token, { operatorId: "op-2", now: Date.parse("2026-09-15T01:00:00Z") }), /another operator/);
    const resolved = await resolveEvidenceTokens([upload.token], "op-1");
    const bound = await bindEvidenceToBorewell(resolved, "well-1");
    assert.equal(bound[0].boundBorewellId, "well-1");
    assert.deepEqual(await readStoredEvidence(bound[0]), bytes);
    await assert.rejects(() => resolveEvidenceTokens([upload.token], "op-1"));
  } finally {
    if (oldDir == null) delete process.env.RIG_MEDIA_DIR; else process.env.RIG_MEDIA_DIR = oldDir;
    if (oldSecret == null) delete process.env.RIG_EVIDENCE_SECRET; else process.env.RIG_EVIDENCE_SECRET = oldSecret;
    await rm(dir, { recursive: true, force: true });
  }
});

test("public Phase 8 borewell endpoint exposes trusted outcomes only", async () => {
  const records = [
    { id: "pending", verified: false, flagged: false, datasetEligibility: { eligible: false } },
    { id: "flagged", verified: true, flagged: true, datasetEligibility: { eligible: false } },
    { id: "trusted", verified: true, flagged: false, datasetEligibility: { eligible: true } },
  ];
  const app = express();
  app.use(express.json());
  app.use(createPhase8Router({
    db: { getBorewells: async () => records },
    requireAuth: (_req, _res, next) => next(), requireAdmin: (_req, _res, next) => next(),
    validate, borewellSchema, adminLogPatchSchema, distanceKm: () => 0, NEAR_KM: 5,
  }));
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/borewells`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).map((item) => item.id), ["trusted"]);
  });
});

function directVerifyStore(id, predictionCreatedAt) {
  let record = {
    id, lat: 11, lng: 77, success: true, depthFt: 300, waterStrikeFt: 220, yieldLpm: 40,
    drilledAt: "2026-09-14T00:00:00.000Z", rigSubmissionSchemaVersion: "8.0.0",
    verificationStatus: "SUBMITTED", provenance: { sourceType: "operator" },
    verified: false, flagged: false, ledgerScoredAt: null, ledgerScoredPredictions: 0,
    datasetEligibility: { eligible: false, status: "awaiting_operator_submission_verification" },
  };
  let prediction = {
    id: `pred-${id}`, lat: 11, lng: 77, successProbability: 70,
    actual: null, correct: null, createdAt: predictionCreatedAt,
  };
  return {
    db: {
      getAllBorewells: async () => [record],
      updateBorewell: async (_id, patch) => { record = { ...record, ...patch }; return record; },
      getPredictions: async () => [prediction],
      updatePrediction: async (_id, patch) => { prediction = { ...prediction, ...patch }; return prediction; },
    },
    state: () => ({ record, prediction }),
  };
}

test("Phase 9 descendant blocks the former direct operator verification shortcut", async () => {
  const store = directVerifyStore("well-1", "2026-09-13T12:00:00.000Z");
  await withServer(routeApp(store.db), async (base) => {
    const response = await fetch(`${base}/api/admin/logs/well-1`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verified: true }),
    });
    assert.equal(response.status, 409);
    assert.equal(store.state().record.verified, false);
    assert.equal(store.state().record.datasetEligibility.eligible, false);
    assert.equal(store.state().prediction.actual, null);
  });
});

test("legacy direct verification cannot score any prediction", async () => {
  const store = directVerifyStore("well-late", "2026-09-13T10:00:00.000Z");
  await withServer(routeApp(store.db), async (base) => {
    const response = await fetch(`${base}/api/admin/logs/well-late`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verified: true }),
    });
    assert.equal(response.status, 409);
    assert.equal(store.state().prediction.actual, null);
    assert.equal(store.state().record.ledgerScoredPredictions, 0);
  });
});

test("offline Phase 3 targets and nearby evidence reject unverified or flagged operator submissions", () => {
  const base = {
    id: "operator-well", lat: 11, lng: 77, drilledAt: "2026-09-14T00:00:00Z",
    success: true, depthFt: 300, waterStrikeFt: 220, yieldLpm: 40,
    rigSubmissionSchemaVersion: "8.0.0", verificationStatus: "SUBMITTED",
    provenance: { sourceType: "operator" }, datasetEligibility: { eligible: false },
    verified: false, flagged: false,
  };
  assert.equal(validateTrainingTarget(base).valid, false);
  assert.equal(isTrustedBorewellEvidence(base), false);
  const verified = { ...base, verificationStatus: "VERIFIED", verified: true, datasetEligibility: { eligible: true } };
  assert.equal(validateTrainingTarget(verified).valid, true);
  assert.equal(isTrustedBorewellEvidence(verified), true);
  const flagged = { ...verified, flagged: true };
  assert.equal(validateTrainingTarget(flagged).valid, false);
  assert.equal(isTrustedBorewellEvidence(flagged), false);
});

test("pending/flagged submissions cannot change groundwater or trust outcome metrics", () => {
  const logs = [
    { id: "trusted", verified: true, flagged: false, datasetEligibility: { eligible: true }, success: false, depthFt: 400, strata: "hard crystalline rock", createdAt: new Date().toISOString() },
    { id: "pending", verified: false, flagged: false, datasetEligibility: { eligible: false }, success: true, depthFt: 10, waterStrikeFt: 5, yieldLpm: 99999, strata: "weathered rock", createdAt: new Date().toISOString() },
    { id: "flagged", verified: true, flagged: true, datasetEligibility: { eligible: false }, success: true, depthFt: 20, waterStrikeFt: 10, yieldLpm: 99999, strata: "weathered rock", createdAt: new Date().toISOString() },
  ];
  assert.deepEqual(trustedOutcomeLogs(logs).map((item) => item.id), ["trusted"]);
  assert.equal(successRate(logs), 0);
  assert.equal(averageDepth(logs), 400);
  const baseline = trustScore([logs[0]], { verified: false });
  assert.deepEqual(trustScore(logs, { verified: false }), baseline);
});
