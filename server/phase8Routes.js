import express from "express";
import { nanoid } from "nanoid";
import { buildOperatorBorewellRecord, buildVerificationPatch, isTrustedOutcome } from "./rigData.js";
import {
  bindEvidenceToBorewell,
  deleteUnboundEvidence,
  evidenceConfig,
  readStoredEvidence,
  resolveEvidenceTokens,
  storeEvidenceUpload,
} from "./rigEvidence.js";

const rawEvidence = express.raw({ type: () => true, limit: process.env.RIG_MEDIA_UPLOAD_LIMIT || "50mb" });

function decodeFilename(value) {
  try { return decodeURIComponent(String(value || "evidence")); } catch { return String(value || "evidence"); }
}

async function closeNearbyPredictions({ db, record, distanceKm, NEAR_KM, now }) {
  const openPreds = (await db.getPredictions()).filter((p) => p.actual == null);
  let scored = 0;
  for (const prediction of openPreds) {
    if (distanceKm({ lat: record.lat, lng: record.lng }, { lat: prediction.lat, lng: prediction.lng }) > NEAR_KM) continue;
    const predictedSuccess = prediction.successProbability >= 50;
    await db.updatePrediction(prediction.id, {
      actual: {
        success: record.success,
        depthFt: record.depthFt,
        waterStrikeFt: record.waterStrikeFt,
        yieldLpm: record.yieldLpm,
        borewellId: record.id,
        verified: true,
        closedAt: now,
      },
      correct: predictedSuccess === record.success,
    });
    scored += 1;
  }
  return scored;
}

async function reopenPredictionsForRecord(db, borewellId) {
  const predictions = await db.getPredictions();
  let reopened = 0;
  for (const prediction of predictions) {
    if (prediction.actual?.borewellId !== borewellId) continue;
    await db.updatePrediction(prediction.id, { actual: null, correct: null });
    reopened += 1;
  }
  return reopened;
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

  // Phase 8 authoritative operator submission route. Because this router is mounted
  // before the legacy route, successful requests end here; the legacy handler stays
  // untouched as a compatibility reference while Phase 9 evolves verification.
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

      // Important trust boundary: submission does NOT close ledger predictions.
      // Existing admin verification is the temporary Phase 8 review action; Phase 9
      // replaces it with the full formal review lifecycle.
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

  // Public map/data exposes trusted outcomes only. Operators/admins still see their
  // pending submissions through /api/borewells/mine and /api/admin/logs.
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

  // Phase 8 keeps the current admin Verify button but makes the trust boundary real:
  // only a verified, unflagged, dataset-eligible log can close predictions/ledger.
  router.patch("/api/admin/logs/:id", requireAuth, requireAdmin, validate(adminLogPatchSchema), async (req, res, next) => {
    try {
      const existing = await findBorewell(db, req.params.id);
      if (!existing) return res.status(404).json({ error: "Log not found" });
      const now = new Date().toISOString();
      const patch = { ...req.body };

      if (patch.flagged === true) {
        patch.flagReason = (req.body.flagReason || "").trim();
        patch.flaggedAt = now;
        patch.flaggedBy = req.operator.name;
        patch.datasetEligibility = { eligible: false, status: "flagged_for_review" };
      } else if (patch.flagged === false) {
        patch.flagReason = "";
        patch.flaggedAt = null;
        patch.flaggedBy = null;
      }

      if (typeof patch.verified === "boolean") {
        Object.assign(patch, buildVerificationPatch({
          verified: patch.verified,
          adminName: req.operator.name,
          now,
        }));
      } else if (patch.flagged === false && existing.verified === true) {
        patch.datasetEligibility = { eligible: true, status: "verified_operator_outcome" };
      }

      let updated = await db.updateBorewell(existing.id, patch);
      const wasTrustedAndScored = Boolean(existing.ledgerScoredAt);
      const trustedNow = isTrustedOutcome(updated);

      if (trustedNow && !wasTrustedAndScored) {
        const scored = await closeNearbyPredictions({ db, record: updated, distanceKm, NEAR_KM, now });
        updated = await db.updateBorewell(updated.id, {
          ledgerScoredAt: now,
          ledgerScoredPredictions: scored,
        });
      } else if (!trustedNow && wasTrustedAndScored) {
        const reopened = await reopenPredictionsForRecord(db, updated.id);
        updated = await db.updateBorewell(updated.id, {
          ledgerScoredAt: null,
          ledgerScoredPredictions: 0,
          ledgerReopenedAt: now,
          ledgerReopenedPredictions: reopened,
        });
      }

      res.json(updated);
    } catch (error) { next(error); }
  });

  return router;
}
