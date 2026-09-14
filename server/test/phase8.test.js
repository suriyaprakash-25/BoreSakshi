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

test("Phase 8 borewell schema requires GPS, geology and internally consistent outcome data", () => {
  assert.equal(borewellSchema.safeParse(validPayload()).success, true);

  const noGps = validPayload();
  delete noGps.gpsAccuracyM;
  assert.equal(borewellSchema.safeParse(noGps).success, false);

  const noLayers = validPayload();
  noLayers.geologicalLayers = [];
  assert.equal(borewellSchema.safeParse(noLayers).success, false);

  const impossibleStrike = validPayload();
  impossibleStrike.waterStrikeFt = 500;
  assert.equal(borewellSchema.safeParse(impossibleStrike).success, false);

  const overlap = validPayload();
  overlap.geologicalLayers[1].fromFt = 100;
  assert.equal(borewellSchema.safeParse(overlap).success, false);

  const dry = validPayload();
  dry.success = false;
  dry.waterStrikeFt = 0;
  dry.yieldLpm = 0;
  assert.equal(borewellSchema.safeParse(dry).success, true);
});

test("operator identity is server-derived and new submissions are not trusted outcomes", () => {
  const body = validPayload();
  const record = buildOperatorBorewellRecord({
    id: "well-phase8",
    body,
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
      buffer: bytes,
      mediaType: "image/jpeg",
      originalName: "site.jpg",
      operatorId: "op-1",
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
  const db = { getBorewells: async () => records };
  const app = express();
  app.use(express.json());
  app.use(createPhase8Router({
    db,
    requireAuth: (_req, _res, next) => next(),
    requireAdmin: (_req, _res, next) => next(),
    validate,
    borewellSchema,
    adminLogPatchSchema,
    distanceKm: () => 0,
    NEAR_KM: 5,
  }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/borewells`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.map((item) => item.id), ["trusted"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("ledger closes only after verification and reopens when trust is removed", async () => {
  let record = {
    id: "well-1", lat: 11, lng: 77, success: true, depthFt: 300, waterStrikeFt: 220, yieldLpm: 40,
    drilledAt: "2026-09-14T00:00:00.000Z",
    rigSubmissionSchemaVersion: "8.0.0",
    provenance: { sourceType: "operator" },
    verified: false, flagged: false, ledgerScoredAt: null,
    datasetEligibility: { eligible: false, status: "awaiting_operator_submission_verification" },
  };
  let prediction = {
    id: "pred-1", lat: 11, lng: 77, successProbability: 70, actual: null, correct: null,
    createdAt: "2026-09-13T12:00:00.000Z",
  };
  const db = {
    getAllBorewells: async () => [record],
    updateBorewell: async (_id, patch) => { record = { ...record, ...patch }; return record; },
    getPredictions: async () => [prediction],
    updatePrediction: async (_id, patch) => { prediction = { ...prediction, ...patch }; return prediction; },
  };
  const auth = (req, _res, next) => { req.operator = { id: "admin", name: "Admin", role: "admin" }; next(); };
  const app = express();
  app.use(express.json());
  app.use(createPhase8Router({
    db,
    requireAuth: auth,
    requireAdmin: (_req, _res, next) => next(),
    validate,
    borewellSchema,
    adminLogPatchSchema,
    distanceKm: () => 0,
    NEAR_KM: 5,
  }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(`${base}/api/admin/logs/well-1`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verified: true }),
    });
    assert.equal(response.status, 200);
    assert.equal(record.verified, true);
    assert.equal(record.datasetEligibility.eligible, true);
    assert.equal(prediction.actual.borewellId, "well-1");
    assert.equal(prediction.correct, true);
    assert.ok(record.ledgerScoredAt);

    response = await fetch(`${base}/api/admin/logs/well-1`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verified: false }),
    });
    assert.equal(response.status, 200);
    assert.equal(record.verified, false);
    assert.equal(record.datasetEligibility.eligible, false);
    assert.equal(prediction.actual, null);
    assert.equal(prediction.correct, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a prediction created after the drilling outcome is never scored", async () => {
  let record = {
    id: "well-late", lat: 11, lng: 77, success: false, depthFt: 450, waterStrikeFt: 0, yieldLpm: 0,
    drilledAt: "2026-09-14T00:00:00.000Z",
    rigSubmissionSchemaVersion: "8.0.0",
    provenance: { sourceType: "operator" },
    verified: false, flagged: false, ledgerScoredAt: null,
    datasetEligibility: { eligible: false, status: "awaiting_operator_submission_verification" },
  };
  let prediction = {
    id: "pred-late", lat: 11, lng: 77, successProbability: 20, actual: null, correct: null,
    createdAt: "2026-09-14T10:00:00.000Z",
  };
  const db = {
    getAllBorewells: async () => [record],
    updateBorewell: async (_id, patch) => { record = { ...record, ...patch }; return record; },
    getPredictions: async () => [prediction],
    updatePrediction: async (_id, patch) => { prediction = { ...prediction, ...patch }; return prediction; },
  };
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
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/logs/well-late`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verified: true }),
    });
    assert.equal(response.status, 200);
    assert.equal(prediction.actual, null);
    assert.equal(record.ledgerScoredPredictions, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("offline Phase 3 targets and nearby evidence reject unverified or flagged operator submissions", () => {
  const base = {
    id: "operator-well",
    lat: 11,
    lng: 77,
    drilledAt: "2026-09-14T00:00:00Z",
    success: true,
    depthFt: 300,
    waterStrikeFt: 220,
    yieldLpm: 40,
    rigSubmissionSchemaVersion: "8.0.0",
    provenance: { sourceType: "operator" },
    datasetEligibility: { eligible: false },
    verified: false,
    flagged: false,
  };
  assert.equal(validateTrainingTarget(base).valid, false);
  assert.equal(isTrustedBorewellEvidence(base), false);

  const verified = { ...base, verified: true, datasetEligibility: { eligible: true } };
  assert.equal(validateTrainingTarget(verified).valid, true);
  assert.equal(isTrustedBorewellEvidence(verified), true);

  const flagged = { ...verified, flagged: true };
  assert.equal(validateTrainingTarget(flagged).valid, false);
  assert.equal(isTrustedBorewellEvidence(flagged), false);
});

test("pending/flagged submissions cannot change groundwater or trust outcome metrics", () => {
  const logs = [
    {
      id: "trusted", verified: true, flagged: false, datasetEligibility: { eligible: true },
      success: false, depthFt: 400, strata: "hard crystalline rock", createdAt: new Date().toISOString(),
    },
    {
      id: "pending", verified: false, flagged: false, datasetEligibility: { eligible: false },
      success: true, depthFt: 10, waterStrikeFt: 5, yieldLpm: 99999, strata: "weathered rock", createdAt: new Date().toISOString(),
    },
    {
      id: "flagged", verified: true, flagged: true, datasetEligibility: { eligible: false },
      success: true, depthFt: 20, waterStrikeFt: 10, yieldLpm: 99999, strata: "weathered rock", createdAt: new Date().toISOString(),
    },
  ];
  assert.deepEqual(trustedOutcomeLogs(logs).map((item) => item.id), ["trusted"]);
  assert.equal(successRate(logs), 0);
  assert.equal(averageDepth(logs), 400);
  const baseline = trustScore([logs[0]], { verified: false });
  assert.deepEqual(trustScore(logs, { verified: false }), baseline);
});
