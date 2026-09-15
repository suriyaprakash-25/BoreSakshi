import express from "express";
import { nanoid } from "nanoid";
import { buildOperatorBorewellRecord, buildVerificationPatch, isOperatorSubmission, isTrustedOutcome } from "./rigData.js";
import {
  bindEvidenceToBorewell,
  deleteUnboundEvidence,
  evidenceConfig,
  readStoredEvidence,
  resolveEvidenceTokens,
  storeEvidenceUpload,
} from "./rigEvidence.js";
import { createPhase11Router } from "./phase11Routes.js";
import { createPhase9Router } from "./phase9Routes.js";
import {
  operatorReviewRequestSchema,
  reviewDecisionSchema,
  reviewReopenSchema,
  reviewStartSchema,
} from "./phase9Validation.js";
import { reopenPredictionAccountability, scorePredictionAgainstOutcome } from "./accountability.js";

const rawEvidence = express.raw({ type: () => true, limit: process.env.RIG_MEDIA_UPLOAD_LIMIT || "50mb" });

function decodeFilename(value) {
  try { return decodeURIComponent(String(value || "evidence")); } catch { return String(value || "evidence"); }
}

async function appendPredictionAudit(db, { prediction, action, actor, details = {}, now }) {
  if (typeof db.addIngestionAudit !== "function") return;
  await db.addIngestionAudit({
    id: nanoid(14),
    batchId: null,
    recordId: null,
    scopeType: "prediction_accountability",
    scopeId: prediction.id,
    action,
    actor: actor ? { id: actor.id, name: actor.name, role: actor.role || "admin" } : { id: "system", name: "BoreSakshi", role: "system" },
    details,
    createdAt: now,
  });
}

async function closeNearbyPredictions({ db, record, distanceKm, NEAR_KM, now, actor }) {
  const openPreds = (await db.getPredictions()).filter((p) => p.actual == null);
  const drilledAtMs = Date.parse(record.drilledAt || record.drilledDate || "");
  let scored = 0;
  for (const prediction of openPreds) {
    const predictionAtMs = Date.parse(prediction.createdAt || prediction.predictionTimestamp || "");
    if (!Number.isFinite(drilledAtMs) || !Number.isFinite(predictionAtMs) || predictionAtMs > drilledAtMs) continue;
    const matchDistanceKm = distanceKm({ lat: record.lat, lng: record.lng }, { lat: prediction.lat, lng: prediction.lng });
    if (matchDistanceKm > NEAR_KM) continue;
    const patch = scorePredictionAgainstOutcome(prediction, record, { now, matchDistanceKm });
    await db.updatePrediction(prediction.id, patch);
    await appendPredictionAudit(db, {
      prediction,
      action: "verified_outcome_scored",
      actor,
      now,
      details: {
        borewellId: record.id,
        verificationStatus: record.verificationStatus || (record.verified ? "VERIFIED" : "UNKNOWN"),
        matchDistanceKm,
        successCorrect: patch.correct,
        metrics: patch.accountability.metrics,
      },
    });
    scored += 1;
  }
  return scored;
}

async function reopenPredictionsForRecord(db, borewellId, { actor, reason, now }) {
  const predictions = await db.getPredictions();
  let reopened = 0;
  for (const prediction of predictions) {
    if (prediction.actual?.borewellId !== borewellId && prediction.accountability?.actual?.borewellId !== borewellId) continue;
    const patch = reopenPredictionAccountability(prediction, { now, reason });
    await db.updatePrediction(prediction.id, patch);
    await appendPredictionAudit(db, {
      prediction,
      action: "outcome_reopened",
      actor,
      now,
      details: { borewellId, reason },
    });
    reopened += 1;
  }
  return reopened;
}

async function appendRigVerificationAudit(db, { record, action, actor, details = {} }) {
  if (typeof db.addIngestionAudit !== "function") return null;
  const event = {
    id: nanoid(14),
    batchId: null,
    recordId: record.id,
    scopeType: "rig_verification",
    scopeId: record.id,
    action,
    actor: { id: actor.id, name: actor.name, role: actor.role || "admin" },
    details,
    createdAt: new Date().toISOString(),
  };
  await db.addIngestionAudit(event);
  return event;
}

async function findBorewell(db, id) {
  return (await db.getAllBorewells()).find((item) => item.id === id) || null;
}

export function createPhase8Router({
  db,
  requireAuth,
  requireAdmin,
  validate,
  borewellSchema,
  adminLogPatchSchema,
  distanceKm,
  NEAR_KM,
}) {
  const router = express.Router();

  // Phase 11 is mounted at the front of the stacked router so its additive
  // prediction snapshot + ledger routes supersede the earlier index.js MVP
  // handlers without rewriting the application entry point.
  router.use(createPhase11Router({ db, requireAuth, requireAdmin, validate }));

  // Phase 9 remains the authoritative operator verification lifecycle.
  router.use(createPhase9Router({
    db,
    requireAuth,
    requireAdmin,
    validate,
    reviewStartSchema,
    reviewDecisionSchema,
    reviewReopenSchema,
    operatorReviewRequestSchema,
    distanceKm,
    NEAR_KM,
  }));

  router.get("/api/operator/evidence/config", requireAuth, (_req, res) => {
    res.json({
      acceptedMediaTypes: evidenceConfig.acceptedMediaTypes,
      maxPhotoBytes: evidenceConfig.maxPhotoBytes,
      maxVideoBytes: evidenceConfig.maxVideoBytes,
      maxPhotosPerLog: 8,
      maxVideosPerLog: 2,
      tokenTtlHours: 24,
    });
  });

  router.post("/api/operator/evidence", requireAuth, rawEvidence, async (req, res, next) => {
    try {
      const mediaType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      const originalName = decodeFilename(req.headers["x-file-name"]);
      const { metadata, token } = await storeEvidenceUpload({
        buffer: req.body,
        mediaType,
        originalName,
        operatorId: req.operator.id,
      });
      res.status(201).json({
        id: metadata.id,
        kind: metadata.kind,
        mediaType: metadata.mediaType,
        originalName: metadata.originalName,
        byteSize: metadata.byteSize,
        sha256: metadata.sha256,
        createdAt: metadata.createdAt,
        token,
      });
    } catch (error) {
      if (/Unsupported evidence type/.test(error.message)) return res.status(415).json({ error: error.message });
      if (/too large|empty/.test(error.message)) return res.status(400).json({ error: error.message });
      next(error);
    }
  });

  router.delete("/api/operator/evidence/:id", requireAuth, async (req, res, next) => {
    try {
      const token = req.headers["x-evidence-token"];
      if (!token) return res.status(400).json({ error: "x-evidence-token header is required" });
      const deleted = await deleteUnboundEvidence(token, req.operator.id);
      if (deleted.id !== req.params.id) return res.status(400).json({ error: "Evidence token/id mismatch" });
      res.json({ deleted: true, id: deleted.id });
    } catch (error) {
      if (/Invalid evidence|expired|another operator|Bound evidence/.test(error.message)) return res.status(400).json({ error: error.message });
      next(error);
    }
  });

  router.post("/api/borewells", requireAuth, validate(borewellSchema), async (req, res, next) => {
    try {
      const evidence = await resolveEvidenceTokens(req.body.evidenceTokens, req.operator.id);
      const id = nanoid(10);
      const boundEvidence = await bindEvidenceToBorewell(evidence, id);
      const submittedAt = new Date().toISOString();
      const record = buildOperatorBorewellRecord({
        id,
        body: req.body,
        operator: req.operator,
        evidence: boundEvidence,
        submittedAt,
      });
      await db.addBorewell(record);

      const pending = await db.getAssignmentsByOperator(req.operator.id, { status: "pending" });
      const near = pending.find((assignment) => distanceKm(
        { lat: record.lat, lng: record.lng },
        { lat: assignment.lat, lng: assignment.lng },
      ) <= 2);
      if (near) {
        await db.updateAssignment(near.id, {
          status: "logged",
          loggedBorewellId: record.id,
          loggedAt: record.createdAt,
        });
      }

      res.status(201).json({
        ...record,
        scoredPredictions: 0,
        ledgerPendingVerification: true,
      });
    } catch (error) {
      if (/evidence|photo|video|another operator|expired|integrity|Duplicate/i.test(error.message)) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  router.get("/api/borewells", async (_req, res, next) => {
    try {
      const records = await db.getBorewells();
      res.json(records.filter(isTrustedOutcome));
    } catch (error) { next(error); }
  });

  router.get("/api/borewells/:borewellId/evidence/:evidenceId", requireAuth, async (req, res, next) => {
    try {
      const record = await findBorewell(db, req.params.borewellId);
      if (!record) return res.status(404).json({ error: "Borewell log not found" });
      if (req.operator.role !== "admin" && record.operatorId !== req.operator.id) {
        return res.status(403).json({ error: "You cannot access evidence for another operator's log" });
      }
      const evidence = (record.evidence || []).find((item) => item.id === req.params.evidenceId);
      if (!evidence) return res.status(404).json({ error: "Evidence not found" });
      const bytes = await readStoredEvidence(evidence);
      res.set("Content-Type", evidence.mediaType);
      res.set("Content-Length", String(bytes.length));
      res.set("Cache-Control", "private, max-age=300");
      res.set("Content-Disposition", `inline; filename="${String(evidence.originalName || evidence.id).replace(/[\r\n\"]/g, "_")}"`);
      res.send(bytes);
    } catch (error) { next(error); }
  });

  router.patch("/api/admin/logs/:id", requireAuth, requireAdmin, validate(adminLogPatchSchema), async (req, res, next) => {
    try {
      const existing = await findBorewell(db, req.params.id);
      if (!existing) return res.status(404).json({ error: "Log not found" });
      const now = new Date().toISOString();
      const patch = { ...req.body };
      const operatorSubmission = isOperatorSubmission(existing);

      if (operatorSubmission && typeof patch.verified === "boolean") {
        return res.status(409).json({ error: "Operator outcomes must be reviewed through the Phase 9 verification workflow" });
      }

      if (patch.flagged === true) {
        patch.flagReason = (req.body.flagReason || "").trim();
        patch.flaggedAt = now;
        patch.flaggedBy = req.operator.name;
        if (operatorSubmission) {
          patch.verified = false;
          patch.verifiedAt = null;
          patch.verifiedBy = null;
          patch.verificationStatus = "UNDER_REVIEW";
          patch.datasetEligibility = { eligible: false, status: "flagged_for_review" };
          patch.reviewReopenedAt = now;
          patch.reviewReopenedBy = { id: req.operator.id, name: req.operator.name };
          patch.reviewReopenReason = "Manual admin flag requires re-review";
        }
      } else if (patch.flagged === false) {
        patch.flagReason = "";
        patch.flaggedAt = null;
        patch.flaggedBy = null;
        if (operatorSubmission && existing.verificationStatus !== "VERIFIED") {
          patch.datasetEligibility = { eligible: false, status: "under_verification_review" };
        }
      }

      if (!operatorSubmission && typeof patch.verified === "boolean") {
        Object.assign(patch, buildVerificationPatch({
          record: existing,
          verified: patch.verified,
          adminName: req.operator.name,
          now,
        }));
      }

      let updated = await db.updateBorewell(existing.id, patch);
      const wasTrustedAndScored = Boolean(existing.ledgerScoredAt);
      const trustedNow = isTrustedOutcome(updated);
      let ledgerReopened = 0;

      if (trustedNow && !wasTrustedAndScored) {
        const scored = await closeNearbyPredictions({ db, record: updated, distanceKm, NEAR_KM, now, actor: req.operator });
        updated = await db.updateBorewell(updated.id, {
          ledgerScoredAt: now,
          ledgerScoredPredictions: scored,
        });
      } else if (!trustedNow && wasTrustedAndScored) {
        ledgerReopened = await reopenPredictionsForRecord(db, updated.id, {
          actor: req.operator,
          reason: patch.flagged ? "Borewell outcome was manually flagged and requires re-review" : "Borewell outcome trust was removed by admin moderation",
          now,
        });
        updated = await db.updateBorewell(updated.id, {
          ledgerScoredAt: null,
          ledgerScoredPredictions: 0,
          ledgerReopenedAt: now,
          ledgerReopenedPredictions: ledgerReopened,
        });
      }

      if (operatorSubmission && typeof patch.flagged === "boolean") {
        await appendRigVerificationAudit(db, {
          record: existing,
          action: patch.flagged ? "verification_flagged_for_review" : "verification_flag_cleared",
          actor: req.operator,
          details: {
            fromStatus: existing.verificationStatus || "SUBMITTED",
            toStatus: updated.verificationStatus || existing.verificationStatus || "SUBMITTED",
            reason: patch.flagged ? patch.flagReason : "",
            trustedBefore: isTrustedOutcome(existing),
            trustedAfter: isTrustedOutcome(updated),
            reopenedPredictions: ledgerReopened,
          },
        });
      }

      res.json(updated);
    } catch (error) { next(error); }
  });

  return router;
}
