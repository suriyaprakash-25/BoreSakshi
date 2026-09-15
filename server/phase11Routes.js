import express from "express";
import { nanoid } from "nanoid";

import { predictSchema } from "./validation.js";
import { predictBorewell, distanceKm, NEAR_KM } from "./predict.js";
import { isTrustedOutcome } from "./rigData.js";
import { createPhase15Router } from "./phase15Routes.js";
import {
  ACCOUNTABILITY_SCHEMA_VERSION,
  buildPredictionAccountability,
  safeLedgerEntry,
  summarizeAccountabilityLedger,
} from "./accountability.js";

function auditEvent({ prediction, action, actor = null, details = {}, now = new Date().toISOString() }) {
  return {
    id: nanoid(14),
    batchId: null,
    recordId: null,
    scopeType: "prediction_accountability",
    scopeId: prediction.id,
    action,
    actor: actor ? { id: actor.id, name: actor.name, role: actor.role || null } : { id: "system", name: "BoreSakshi", role: "system" },
    details,
    createdAt: now,
  };
}

function queryValue(value) {
  return value == null ? "" : String(value).trim();
}

function matchesFilters(prediction, filters) {
  const entry = safeLedgerEntry(prediction);
  if (filters.modelVersion && entry.modelIdentity !== filters.modelVersion && entry.modelVersion !== filters.modelVersion) return false;
  if (filters.source && entry.predictionSource !== filters.source) return false;
  if (filters.status && entry.status !== filters.status) return false;
  if (filters.region && entry.location.region !== filters.region) return false;
  return true;
}

export function createPhase11Router({
  db,
  requireAuth,
  requireAdmin,
  validate,
  predictor = predictBorewell,
}) {
  const router = express.Router();

  // Phase 15 is additive and intentionally mounted ahead of the Phase 11 routes.
  // Its global middleware continues with next(), while privacy/security endpoints
  // can intercept the small set of routes they explicitly strengthen.
  router.use(createPhase15Router({ db, requireAuth, requireAdmin, validate }));

  // Authoritative prediction route for Phase 11. It preserves the existing public
  // response while snapshotting every persisted prediction into the accountability
  // contract. Preview/save=false predictions are intentionally not ledger records.
  router.post("/api/predict", validate(predictSchema), async (req, res, next) => {
    try {
      const { lat, lng, save: shouldSave = true } = req.body;
      const nearbyLogs = (await db.getBorewells())
        .filter(isTrustedOutcome)
        .map((borewell) => ({ ...borewell, distanceKm: distanceKm({ lat, lng }, borewell) }))
        .filter((borewell) => borewell.distanceKm <= NEAR_KM)
        .sort((a, b) => a.distanceKm - b.distanceKm);

      const prediction = await predictor({ lat, lng, nearbyLogs });
      let saved = null;
      if (shouldSave) {
        const createdAt = new Date().toISOString();
        const record = {
          id: nanoid(10),
          lat,
          lng,
          ...prediction,
          actual: null,
          correct: null,
          createdAt,
        };
        record.accountability = buildPredictionAccountability(record);
        saved = await db.addPrediction(record);
        if (typeof db.addIngestionAudit === "function") {
          await db.addIngestionAudit(auditEvent({
            prediction: record,
            action: "prediction_issued",
            details: {
              schemaVersion: ACCOUNTABILITY_SCHEMA_VERSION,
              predictionSource: record.predictionSource,
              modelVersion: record.modelVersion || null,
              modelIdentity: record.accountability.modelIdentity,
              deploymentId: record.deploymentId || null,
              featureVersion: record.featureVersion || null,
              featureSnapshotRef: record.featureSnapshotRef || null,
              successProbabilityPct: record.successProbability,
              predictedDepthFt: record.accountability.predicted.depthFt,
              predictedYieldLpm: record.accountability.predicted.yieldLpm,
            },
            now: createdAt,
          }));
        }
      }

      res.json({
        ...prediction,
        predictionId: saved?.id ?? null,
        accountabilityStatus: saved?.accountability?.status ?? null,
        nearbyVerifiedLogs: nearbyLogs.length,
        nearby: nearbyLogs.slice(0, 20).map((borewell) => ({
          id: borewell.id,
          distanceKm: Math.round(borewell.distanceKm * 100) / 100,
          depthFt: borewell.depthFt ?? null,
          success: borewell.success,
          strata: borewell.strata || "",
          placeName: borewell.placeName || "",
          createdAt: borewell.createdAt,
        })),
      });
    } catch (error) { next(error); }
  });

  router.get("/api/ledger", async (_req, res, next) => {
    try {
      const predictions = await db.getPredictions();
      const summary = summarizeAccountabilityLedger(predictions);
      const recent = [...predictions]
        .filter((prediction) => safeLedgerEntry(prediction).status === "SCORED_VERIFIED")
        .sort((a, b) => Date.parse(b.accountability?.scoredAt || b.actual?.closedAt || b.createdAt || 0) - Date.parse(a.accountability?.scoredAt || a.actual?.closedAt || a.createdAt || 0))
        .slice(0, 20)
        .map((prediction) => safeLedgerEntry(prediction));

      res.json({
        schemaVersion: ACCOUNTABILITY_SCHEMA_VERSION,
        generatedAt: summary.generatedAt,
        totalPredictions: summary.totalPredictions,
        scored: summary.scored,
        correct: summary.correct,
        accuracyPct: summary.accuracyPct,
        pending: summary.pending,
        brier: summary.brier,
        expectedCalibrationError: summary.expectedCalibrationError,
        calibrationBins: summary.calibrationBins,
        depth: summary.depth,
        yield: summary.yield,
        byModelVersion: summary.byModelVersion,
        byRegion: summary.byRegion,
        bySource: summary.bySource,
        methodology: summary.methodology,
        recent,
      });
    } catch (error) { next(error); }
  });

  router.get("/api/ledger/entries", async (req, res, next) => {
    try {
      const filters = {
        modelVersion: queryValue(req.query.modelVersion),
        source: queryValue(req.query.source),
        status: queryValue(req.query.status),
        region: queryValue(req.query.region),
      };
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
      const predictions = (await db.getPredictions())
        .filter((prediction) => matchesFilters(prediction, filters))
        .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
      const start = (page - 1) * limit;
      res.json({
        schemaVersion: ACCOUNTABILITY_SCHEMA_VERSION,
        page,
        limit,
        total: predictions.length,
        items: predictions.slice(start, start + limit).map(safeLedgerEntry),
      });
    } catch (error) { next(error); }
  });

  router.get("/api/ledger/models", async (_req, res, next) => {
    try {
      const summary = summarizeAccountabilityLedger(await db.getPredictions());
      res.json({ schemaVersion: ACCOUNTABILITY_SCHEMA_VERSION, items: summary.byModelVersion, bySource: summary.bySource });
    } catch (error) { next(error); }
  });

  router.get("/api/ledger/regions", async (_req, res, next) => {
    try {
      const summary = summarizeAccountabilityLedger(await db.getPredictions());
      res.json({ schemaVersion: ACCOUNTABILITY_SCHEMA_VERSION, items: summary.byRegion });
    } catch (error) { next(error); }
  });

  router.get("/api/admin/ledger/entries/:id/audit", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const prediction = (await db.getPredictions()).find((item) => item.id === req.params.id);
      if (!prediction) return res.status(404).json({ error: "Prediction not found" });
      const events = typeof db.getIngestionAuditByScope === "function"
        ? await db.getIngestionAuditByScope("prediction_accountability", prediction.id, { limit: req.query.limit || 500 })
        : [];
      res.json({ prediction: safeLedgerEntry(prediction), audit: events });
    } catch (error) { next(error); }
  });

  return router;
}

export { auditEvent as buildAccountabilityAuditEvent };
