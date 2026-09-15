import express from "express";
import { nanoid } from "nanoid";
import { isOperatorSubmission, isTrustedOutcome } from "./rigData.js";
import {
  MIN_TRUST_SCORE_FOR_UNOVERRIDDEN_VERIFY,
  VERIFICATION_SCHEMA_VERSION,
  VERIFICATION_STATUSES,
  analyzeSubmission,
  canTransition,
  computeOperatorTrust,
  statusPatch,
} from "./verification.js";

function recordById(records, id) {
  return records.find((record) => record.id === id) || null;
}

async function audit(db, { record, action, actor, details = {} }) {
  const event = {
    id: nanoid(14),
    batchId: null,
    recordId: record.id,
    scopeType: "rig_verification",
    scopeId: record.id,
    action,
    actor: { id: actor.id, name: actor.name, role: actor.role || "operator" },
    details,
    createdAt: new Date().toISOString(),
  };
  await db.addIngestionAudit(event);
  return event;
}

async function closeNearbyPredictions({ db, record, distanceKm, NEAR_KM, now }) {
  const openPredictions = (await db.getPredictions()).filter((prediction) => prediction.actual == null);
  const drilledAtMs = Date.parse(record.drilledAt || record.drilledDate || "");
  let scored = 0;
  for (const prediction of openPredictions) {
    const predictionAtMs = Date.parse(prediction.createdAt || "");
    if (!Number.isFinite(drilledAtMs) || !Number.isFinite(predictionAtMs) || predictionAtMs > drilledAtMs) continue;
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

function analysisFor(record, allRecords) {
  return analyzeSubmission(record, {
    operatorRecords: allRecords.filter((item) => item.operatorId === record.operatorId && isOperatorSubmission(item)),
    allRecords,
  });
}

function trustFor(record, allRecords) {
  return computeOperatorTrust(allRecords, { operatorId: record.operatorId });
}

function safeStatus(value) {
  return Object.values(VERIFICATION_STATUSES).includes(value) ? value : null;
}

export function createPhase9Router({
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
}) {
  const router = express.Router();

  router.get("/api/admin/review/stats", requireAuth, requireAdmin, async (_req, res, next) => {
    try {
      const records = (await db.getAllBorewells()).filter(isOperatorSubmission);
      const counts = Object.fromEntries(Object.values(VERIFICATION_STATUSES).map((status) => [status, 0]));
      let suspicious = 0;
      let highRisk = 0;
      for (const record of records) {
        if (counts[record.verificationStatus] !== undefined) counts[record.verificationStatus] += 1;
        const analysis = analysisFor(record, records);
        if (analysis.suspicious) suspicious += 1;
        if (["high", "critical"].includes(analysis.riskLevel)) highRisk += 1;
      }
      res.json({
        verificationSchemaVersion: VERIFICATION_SCHEMA_VERSION,
        totalOperatorSubmissions: records.length,
        counts,
        suspicious,
        highRisk,
      });
    } catch (error) { next(error); }
  });

  router.get("/api/admin/review/queue", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const status = req.query.status ? safeStatus(String(req.query.status)) : null;
      if (req.query.status && !status) return res.status(400).json({ error: "Invalid verification status" });
      const allRecords = await db.getAllBorewells();
      let records = allRecords.filter(isOperatorSubmission);
      if (status) records = records.filter((record) => record.verificationStatus === status);
      else records = records.filter((record) => [VERIFICATION_STATUSES.SUBMITTED, VERIFICATION_STATUSES.UNDER_REVIEW].includes(record.verificationStatus));

      const enriched = records.map((record) => ({
        ...record,
        verificationPreview: analysisFor(record, allRecords),
        operatorTrust: trustFor(record, allRecords),
      })).sort((a, b) => {
        const risk = (b.verificationPreview?.riskScore || 0) - (a.verificationPreview?.riskScore || 0);
        if (risk) return risk;
        return Date.parse(a.submittedAt || a.createdAt || 0) - Date.parse(b.submittedAt || b.createdAt || 0);
      });
      res.json(enriched);
    } catch (error) { next(error); }
  });

  router.get("/api/admin/review/logs/:id", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const allRecords = await db.getAllBorewells();
      const record = recordById(allRecords, req.params.id);
      if (!record || !isOperatorSubmission(record)) return res.status(404).json({ error: "Operator submission not found" });
      const auditTrail = await db.getIngestionAuditByScope("rig_verification", record.id, { limit: 500 });
      res.json({
        record,
        analysis: analysisFor(record, allRecords),
        operatorTrust: trustFor(record, allRecords),
        audit: auditTrail,
      });
    } catch (error) { next(error); }
  });

  router.get("/api/admin/review/logs/:id/audit", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const record = recordById(await db.getAllBorewells(), req.params.id);
      if (!record || !isOperatorSubmission(record)) return res.status(404).json({ error: "Operator submission not found" });
      res.json(await db.getIngestionAuditByScope("rig_verification", record.id, { limit: req.query.limit || 500 }));
    } catch (error) { next(error); }
  });

  router.post("/api/admin/review/logs/:id/start", requireAuth, requireAdmin, validate(reviewStartSchema), async (req, res, next) => {
    try {
      const allRecords = await db.getAllBorewells();
      const existing = recordById(allRecords, req.params.id);
      if (!existing || !isOperatorSubmission(existing)) return res.status(404).json({ error: "Operator submission not found" });
      if (existing.verificationStatus !== VERIFICATION_STATUSES.SUBMITTED) {
        return res.status(409).json({ error: `Review start is only valid from SUBMITTED; use reopen for ${existing.verificationStatus || "unknown"}` });
      }
      const now = new Date().toISOString();
      const analysis = analysisFor(existing, allRecords);
      const trust = trustFor(existing, allRecords);
      const patch = {
        ...statusPatch(VERIFICATION_STATUSES.UNDER_REVIEW, { admin: req.operator, now, analysis, trust }),
        reviewNote: req.body.note || "",
      };
      const updated = await db.updateBorewell(existing.id, patch);
      await audit(db, {
        record: existing,
        action: "verification_review_started",
        actor: req.operator,
        details: {
          fromStatus: existing.verificationStatus,
          toStatus: VERIFICATION_STATUSES.UNDER_REVIEW,
          note: req.body.note || "",
          riskScore: analysis.riskScore,
          riskLevel: analysis.riskLevel,
          signalCodes: analysis.signals.map((signal) => signal.code),
          operatorTrustScore: trust.score,
        },
      });
      res.json({ ...updated, verificationPreview: analysis, operatorTrust: trust });
    } catch (error) { next(error); }
  });

  router.post("/api/admin/review/logs/:id/decision", requireAuth, requireAdmin, validate(reviewDecisionSchema), async (req, res, next) => {
    try {
      const allRecords = await db.getAllBorewells();
      const existing = recordById(allRecords, req.params.id);
      if (!existing || !isOperatorSubmission(existing)) return res.status(404).json({ error: "Operator submission not found" });
      if (existing.verificationStatus !== VERIFICATION_STATUSES.UNDER_REVIEW) {
        return res.status(409).json({ error: "A submission must be UNDER_REVIEW before a decision" });
      }

      const verify = req.body.decision === "verify";
      const nextStatus = verify ? VERIFICATION_STATUSES.VERIFIED : VERIFICATION_STATUSES.REJECTED;
      if (!canTransition(existing.verificationStatus, nextStatus)) {
        return res.status(409).json({ error: `Cannot transition ${existing.verificationStatus} to ${nextStatus}` });
      }

      const now = new Date().toISOString();
      const analysis = analysisFor(existing, allRecords);
      const trustBefore = trustFor(existing, allRecords);

      if (verify && existing.flagged) {
        return res.status(409).json({ error: "Clear the manual flag before verifying this submission" });
      }
      if (verify && analysis.requiresOverrideToVerify && !req.body.overrideRisk) {
        return res.status(409).json({
          error: "High/critical review signals require an explicit risk override",
          blockingSignalCodes: analysis.blockingSignalCodes,
        });
      }
      if (verify && trustBefore.score < MIN_TRUST_SCORE_FOR_UNOVERRIDDEN_VERIFY && !req.body.overrideTrustGate) {
        return res.status(409).json({
          error: `Operator trust score ${trustBefore.score} is below the ${MIN_TRUST_SCORE_FOR_UNOVERRIDDEN_VERIFY} verification gate; explicit trust override required`,
          operatorTrust: trustBefore,
        });
      }

      let updated = await db.updateBorewell(existing.id, {
        ...statusPatch(nextStatus, {
          admin: req.operator,
          now,
          decisionReason: req.body.decisionReason || "",
          analysis,
          trust: trustBefore,
        }),
        reviewOverride: verify && (req.body.overrideRisk || req.body.overrideTrustGate) ? {
          risk: Boolean(req.body.overrideRisk),
          trustGate: Boolean(req.body.overrideTrustGate),
          reason: req.body.overrideReason,
          by: { id: req.operator.id, name: req.operator.name },
          at: now,
        } : null,
      });

      let ledger = { scored: 0, reopened: 0 };
      if (verify && isTrustedOutcome(updated) && !existing.ledgerScoredAt) {
        ledger.scored = await closeNearbyPredictions({ db, record: updated, distanceKm, NEAR_KM, now });
        updated = await db.updateBorewell(updated.id, {
          ledgerScoredAt: now,
          ledgerScoredPredictions: ledger.scored,
        });
      } else if (!verify && existing.ledgerScoredAt) {
        ledger.reopened = await reopenPredictionsForRecord(db, existing.id);
        updated = await db.updateBorewell(updated.id, {
          ledgerScoredAt: null,
          ledgerScoredPredictions: 0,
          ledgerReopenedAt: now,
          ledgerReopenedPredictions: ledger.reopened,
        });
      }

      const recordsAfter = allRecords.map((record) => record.id === updated.id ? updated : record);
      const trustAfter = computeOperatorTrust(recordsAfter, { operatorId: existing.operatorId });
      await db.updateOperator(existing.operatorId, {
        trustProfile: trustAfter,
        trustUpdatedAt: now,
      });
      updated = await db.updateBorewell(updated.id, { operatorTrustAfterDecision: trustAfter });

      await audit(db, {
        record: existing,
        action: verify ? "verification_approved" : "verification_rejected",
        actor: req.operator,
        details: {
          fromStatus: existing.verificationStatus,
          toStatus: nextStatus,
          decisionReason: req.body.decisionReason || "",
          riskScore: analysis.riskScore,
          riskLevel: analysis.riskLevel,
          signalCodes: analysis.signals.map((signal) => signal.code),
          overrideRisk: Boolean(req.body.overrideRisk),
          overrideTrustGate: Boolean(req.body.overrideTrustGate),
          overrideReason: req.body.overrideReason || "",
          operatorTrustBefore: trustBefore,
          operatorTrustAfter: trustAfter,
          ledger,
        },
      });
      res.json({ record: updated, analysis, operatorTrust: trustAfter, ledger });
    } catch (error) { next(error); }
  });

  router.post("/api/admin/review/logs/:id/reopen", requireAuth, requireAdmin, validate(reviewReopenSchema), async (req, res, next) => {
    try {
      const allRecords = await db.getAllBorewells();
      const existing = recordById(allRecords, req.params.id);
      if (!existing || !isOperatorSubmission(existing)) return res.status(404).json({ error: "Operator submission not found" });
      if (![VERIFICATION_STATUSES.VERIFIED, VERIFICATION_STATUSES.REJECTED].includes(existing.verificationStatus)) {
        return res.status(409).json({ error: `Review reopen is only valid from VERIFIED or REJECTED, not ${existing.verificationStatus || "unknown"}` });
      }
      const now = new Date().toISOString();
      const analysis = analysisFor(existing, allRecords);
      const trust = trustFor(existing, allRecords);
      let updated = await db.updateBorewell(existing.id, {
        ...statusPatch(VERIFICATION_STATUSES.UNDER_REVIEW, { admin: req.operator, now, analysis, trust }),
        reviewReopenedAt: now,
        reviewReopenedBy: { id: req.operator.id, name: req.operator.name },
        reviewReopenReason: req.body.reason,
      });
      let reopened = 0;
      if (existing.ledgerScoredAt) {
        reopened = await reopenPredictionsForRecord(db, existing.id);
        updated = await db.updateBorewell(existing.id, {
          ledgerScoredAt: null,
          ledgerScoredPredictions: 0,
          ledgerReopenedAt: now,
          ledgerReopenedPredictions: reopened,
        });
      }
      await audit(db, {
        record: existing,
        action: "verification_review_reopened",
        actor: req.operator,
        details: {
          fromStatus: existing.verificationStatus,
          toStatus: VERIFICATION_STATUSES.UNDER_REVIEW,
          reason: req.body.reason,
          reopenedPredictions: reopened,
        },
      });
      res.json({ record: updated, analysis, operatorTrust: trust, reopenedPredictions: reopened });
    } catch (error) { next(error); }
  });

  router.post("/api/borewells/:id/request-review", requireAuth, validate(operatorReviewRequestSchema), async (req, res, next) => {
    try {
      const allRecords = await db.getAllBorewells();
      const existing = recordById(allRecords, req.params.id);
      if (!existing || !isOperatorSubmission(existing)) return res.status(404).json({ error: "Operator submission not found" });
      if (existing.operatorId !== req.operator.id) return res.status(403).json({ error: "You can only request review of your own submission" });
      if (existing.verificationStatus !== VERIFICATION_STATUSES.REJECTED) {
        return res.status(409).json({ error: "Only a rejected submission can be resubmitted for review" });
      }
      const now = new Date().toISOString();
      const updated = await db.updateBorewell(existing.id, {
        verificationSchemaVersion: VERIFICATION_SCHEMA_VERSION,
        verificationStatus: VERIFICATION_STATUSES.SUBMITTED,
        verified: false,
        verifiedAt: null,
        verifiedBy: null,
        datasetEligibility: { eligible: false, status: "awaiting_operator_submission_verification" },
        appeal: {
          note: req.body.note,
          submittedAt: now,
          submittedBy: { id: req.operator.id, name: req.operator.name },
        },
      });
      await audit(db, {
        record: existing,
        action: "operator_review_requested",
        actor: req.operator,
        details: {
          fromStatus: VERIFICATION_STATUSES.REJECTED,
          toStatus: VERIFICATION_STATUSES.SUBMITTED,
          note: req.body.note,
        },
      });
      res.json(updated);
    } catch (error) { next(error); }
  });

  router.get("/api/borewells/:id/verification", requireAuth, async (req, res, next) => {
    try {
      const allRecords = await db.getAllBorewells();
      const record = recordById(allRecords, req.params.id);
      if (!record || !isOperatorSubmission(record)) return res.status(404).json({ error: "Operator submission not found" });
      if (req.operator.role !== "admin" && record.operatorId !== req.operator.id) return res.status(403).json({ error: "Not allowed" });
      const history = await db.getIngestionAuditByScope("rig_verification", record.id, { limit: 100 });
      res.json({
        id: record.id,
        verificationStatus: record.verificationStatus,
        verified: record.verified,
        datasetEligibility: record.datasetEligibility,
        reviewDecision: record.reviewDecision || null,
        reviewDecisionReason: record.reviewDecisionReason || "",
        rejectionReason: record.rejectionReason || "",
        reviewStartedAt: record.reviewStartedAt || null,
        reviewedAt: record.reviewedAt || null,
        appeal: record.appeal || null,
        audit: history,
      });
    } catch (error) { next(error); }
  });

  router.get("/api/operator/trust", requireAuth, async (req, res, next) => {
    try {
      const records = await db.getAllBorewells();
      res.json(computeOperatorTrust(records, { operatorId: req.operator.id }));
    } catch (error) { next(error); }
  });

  router.get("/api/admin/operators/:id/trust", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const operator = await db.getOperatorById(req.params.id);
      if (!operator) return res.status(404).json({ error: "Operator not found" });
      const records = await db.getAllBorewells();
      res.json(computeOperatorTrust(records, { operatorId: operator.id }));
    } catch (error) { next(error); }
  });

  return router;
}
