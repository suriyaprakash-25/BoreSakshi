// index.js — BoreSakshi API
import "dotenv/config"; // load server/.env before anything reads process.env
import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { nanoid } from "nanoid";
import { db, connectDB, pingDB } from "./db.js";
import { distanceKm, NEAR_KM } from "./predict.js";
import { mlClient } from "./mlClient.js";
import { signup, signin, signout, requireAuth, requireAdmin } from "./auth.js";
import {
  validate, signupSchema, signinSchema, borewellSchema,
  adminLogPatchSchema,
  ingestionSourceSchema, ingestionReviewSchema,
  datasetAssetSchema, datasetAssetReviewSchema,
} from "./validation.js";
import {
  CsvImportError,
  DATASET_SCHEMA_VERSION,
  DATASET_KINDS,
  QUALITY_THRESHOLD,
  parseBorewellCsv,
  normalizeBorewellRow,
  buildDuplicateFingerprint,
  withEligibility,
  initialReviewStatus,
  rawArtifactMetadata,
  buildQualityReport,
  toPublishedBorewell,
} from "./ingestion.js";
import {
  asyncHandler, authLimiter, signinBruteLimiter, notFound, errorHandler,
} from "./middleware.js";
import { createPhase8Router } from "./phase8Routes.js";

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: "10kb" })); // reject oversized JSON payloads (→ 413)
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev")); // request logging

// Requests can arrive before Mongo is ready (always on a serverless cold start).
// Liveness stays outside this so a database outage is reported, not hidden.
app.use(async (req, res, next) => {
  if (req.path === "/api/health/live") return next();
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error("[BoreSakshi] MongoDB unavailable:", error.message);
    res.status(503).json({ error: "The service is temporarily unavailable. Please try again." });
  }
});

// Behind a reverse proxy (Render/Railway, AWS ALB) set TRUST_PROXY=1 so client IPs
// and therefore IP rate limiting — are read correctly. Otherwise, rate limiters
// will see the proxy IP and globally throttle all users. Left off locally.
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY));

const PORT = process.env.PORT || 4000;
// NEAR_KM ("nearby" radius for confidence, ledger matching + explainability)
// is defined once in predict.js and imported so both files can never drift.

// health check — the Node API remains available if ML is temporarily down; its
// ML readiness/circuit state is reported explicitly instead of hiding the outage.
app.get("/api/health", asyncHandler(async (_req, res) => {
  const dbUp = await pingDB();
  let ml;
  try {
    const health = await mlClient.health({ timeoutMs: 750 });
    ml = { ...health, client: mlClient.statusSnapshot() };
  } catch (error) {
    ml = {
      ok: false,
      ready: false,
      errorCode: error?.code || "ML_UNAVAILABLE",
      message: error?.message || "ML service unavailable",
      client: mlClient.statusSnapshot(),
    };
  }
  res.status(dbUp ? 200 : 503).json({
    ok: dbUp,
    service: "boresakshi",
    db: dbUp ? "up" : "down",
    ml,
  });
}));

// ----------------------------------------------------------------------------
// 0) OPERATOR AUTH (rig operators only — the farmer flow stays open/no-login)
// ----------------------------------------------------------------------------
app.post("/api/auth/signup", authLimiter, validate(signupSchema), asyncHandler(signup));
app.post(
  "/api/auth/signin",
  authLimiter,
  validate(signinSchema),
  signinBruteLimiter,
  asyncHandler(signin)
);
app.post("/api/auth/signout", asyncHandler(signout));

// ----------------------------------------------------------------------------
// PHASE 8 — production rig-operator data collection.
// Mounted before the older routes so the new authenticated submission/evidence
// and verification trust boundary is authoritative without deleting working code.
// ----------------------------------------------------------------------------
app.use(createPhase8Router({
  db,
  requireAuth,
  requireAdmin,
  validate,
  borewellSchema,
  adminLogPatchSchema,
  distanceKm,
  NEAR_KM,
}));

app.get("/api/borewells/mine", requireAuth, asyncHandler(async (req, res) =>
  res.json(await db.getBorewellsByOperator(req.operator.id))
));

app.get("/api/assignments", requireAuth, asyncHandler(async (req, res) =>
  res.json(await db.getAssignmentsByOperator(req.operator.id, { status: "pending" }))
));

// ----------------------------------------------------------------------------
// 4) ADMIN — platform oversight. Every route requires an admin account.
// ----------------------------------------------------------------------------
const admin = [requireAuth, requireAdmin];

app.get("/api/admin/operators", ...admin, asyncHandler(async (_req, res) =>
  res.json(await db.getOperators())
));

app.get("/api/admin/logs", ...admin, asyncHandler(async (_req, res) =>
  res.json(await db.getAllBorewells())
));

// ----------------------------------------------------------------------------
// 5) PHASE 2 — REAL BOREWELL DATA COLLECTION PIPELINE (admin only)
// Raw CSV -> schema/coordinate validation -> cleaning -> dedupe -> quality score
// -> human review -> approved canonical dataset. Nothing reaches borewells before
// explicit review + publish.
// ----------------------------------------------------------------------------
const csvUploadParser = express.text({
  type: ["text/csv", "application/csv"],
  limit: process.env.INGESTION_MAX_BYTES || "5mb",
});

const auditEvent = async ({ batchId = null, recordId = null, scopeType = "ingestion_batch", scopeId = batchId, action, operator, details = {} }) => {
  const event = {
    id: nanoid(14),
    batchId,
    recordId,
    scopeType,
    scopeId,
    action,
    actor: { id: operator.id, name: operator.name },
    details,
    createdAt: new Date().toISOString(),
  };
  await db.addIngestionAudit(event);
  return event;
};

const refreshBatchWorkflow = async (batchId) => {
  const summary = await db.summarizeStagedBatch(batchId);
  const pending = summary.byStatus.pending_review || 0;
  const approved = summary.byStatus.approved || 0;
  const status = pending > 0 ? "awaiting_review" : approved > 0 ? "ready_to_publish" : "review_complete";
  const batch = await db.updateIngestionBatch(batchId, { status, reviewSummary: summary, updatedAt: new Date().toISOString() });
  return { batch, summary };
};

// Register externally stored contextual datasets without copying large raster/files into Mongo.
// These assets cover the Phase 2 satellite/rainfall/geology/soil/DEM/LULC/groundwater inputs.
app.post("/api/admin/ingestion/assets", ...admin, validate(datasetAssetSchema), asyncHandler(async (req, res) => {
  const existing = await db.getDatasetAssetBySha256(req.body.sha256.toLowerCase());
  if (existing) return res.status(409).json({ error: "An asset with this SHA-256 is already registered", assetId: existing.id });
  const now = new Date().toISOString();
  const asset = {
    id: nanoid(14),
    schemaVersion: DATASET_SCHEMA_VERSION,
    ...req.body,
    sha256: req.body.sha256.toLowerCase(),
    status: "registered",
    verified: false,
    reviewNote: "",
    createdAt: now,
    updatedAt: now,
    createdBy: { id: req.operator.id, name: req.operator.name },
  };
  await db.addDatasetAsset(asset);
  await auditEvent({
    scopeType: "dataset_asset",
    scopeId: asset.id,
    action: "dataset_asset_registered",
    operator: req.operator,
    details: { datasetKind: asset.datasetKind, sha256: asset.sha256, objectKey: asset.objectKey },
  });
  res.status(201).json(asset);
}));

app.get("/api/admin/ingestion/assets", ...admin, asyncHandler(async (req, res) => {
  const datasetKind = req.query.datasetKind ? String(req.query.datasetKind) : undefined;
  if (datasetKind && !DATASET_KINDS.includes(datasetKind)) return res.status(400).json({ error: "Invalid datasetKind" });
  res.json(await db.listDatasetAssets({ page: req.query.page, limit: req.query.limit, datasetKind }));
}));

app.patch("/api/admin/ingestion/assets/:id", ...admin, validate(datasetAssetReviewSchema), asyncHandler(async (req, res) => {
  const asset = await db.getDatasetAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: "Dataset asset not found" });
  const now = new Date().toISOString();
  const approved = req.body.decision === "approve";
  const updated = await db.updateDatasetAsset(asset.id, {
    status: approved ? "verified" : "rejected",
    verified: approved,
    reviewedAt: now,
    reviewedBy: req.operator.name,
    reviewNote: req.body.reviewNote || "",
    updatedAt: now,
  });
  await auditEvent({
    scopeType: "dataset_asset",
    scopeId: asset.id,
    action: approved ? "dataset_asset_verified" : "dataset_asset_rejected",
    operator: req.operator,
    details: { reviewNote: req.body.reviewNote || "" },
  });
  res.json(updated);
}));

app.get("/api/admin/ingestion/assets/:id/audit", ...admin, asyncHandler(async (req, res) => {
  const asset = await db.getDatasetAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: "Dataset asset not found" });
  res.json(await db.getIngestionAuditByScope("dataset_asset", asset.id, { limit: req.query.limit }));
}));

app.post("/api/admin/ingestion/csv", ...admin, csvUploadParser, asyncHandler(async (req, res) => {
  if (typeof req.body !== "string") {
    return res.status(415).json({ error: "Send the upload as text/csv or application/csv" });
  }
  const sourceResult = ingestionSourceSchema.safeParse(req.query || {});
  if (!sourceResult.success) {
    return res.status(400).json({ error: sourceResult.error.issues[0]?.message || "Invalid source metadata" });
  }
  const source = sourceResult.data;

  let parsedRows;
  try {
    parsedRows = parseBorewellCsv(req.body);
  } catch (err) {
    if (err instanceof CsvImportError) return res.status(400).json({ error: err.message, code: err.code });
    throw err;
  }

  const batchId = nanoid(14);
  const now = new Date().toISOString();
  const artifact = rawArtifactMetadata(req.body, batchId);
  const batch = {
    id: batchId,
    schemaVersion: DATASET_SCHEMA_VERSION,
    status: "processing",
    source,
    artifact,
    rowCount: parsedRows.length,
    createdAt: now,
    updatedAt: now,
    createdBy: { id: req.operator.id, name: req.operator.name },
    productionEligible: false,
  };
  await db.addIngestionBatch(batch);
  await auditEvent({ batchId, action: "batch_created", operator: req.operator, details: { rowCount: parsedRows.length, source, artifact } });

  try {
    const staged = [];
    const seenInBatch = new Map();
    for (const parsedRow of parsedRows) {
      const id = nanoid(14);
      const normalized = normalizeBorewellRow(parsedRow, source);
      const fingerprint = buildDuplicateFingerprint(normalized, source);
      let duplicateOf = null;

      if (normalized.validation.valid) {
        duplicateOf = seenInBatch.get(fingerprint) || null;
        if (!duplicateOf) {
          const canonicalDuplicate = await db.findCanonicalDuplicate({
            fingerprint,
            location: normalized.location,
            drilledDate: normalized.drilledDate,
          });
          duplicateOf = canonicalDuplicate?.id || null;
        }
        if (!duplicateOf) {
          const stagedDuplicate = await db.findStagedDuplicate({ fingerprint, batchId });
          duplicateOf = stagedDuplicate?.id || null;
        }
      }

      const eligible = withEligibility(normalized, duplicateOf);
      const reviewStatus = initialReviewStatus(eligible);
      const provenance = {
        sourceType: source.sourceType,
        sourceName: source.sourceName,
        sourceReference: source.sourceReference || "",
        license: source.license || "",
        datasetName: source.datasetName || "",
        sourceRecordId: normalized.sourceRecordId || "",
        evidenceUrl: normalized.evidenceUrl || "",
        rawArtifactSha256: artifact.sha256,
        importedAt: now,
        importedBy: { id: req.operator.id, name: req.operator.name },
      };
      const record = {
        ...eligible,
        id,
        batchId,
        fingerprint,
        provenance,
        reviewStatus,
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: "",
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      staged.push(record);
      if (normalized.validation.valid && !seenInBatch.has(fingerprint)) seenInBatch.set(fingerprint, id);
    }

    await db.addStagedBorewells(staged);
    const qualityReport = buildQualityReport(staged);
    const status = qualityReport.counts.pendingReview > 0 ? "awaiting_review" : "needs_attention";
    const updatedBatch = await db.updateIngestionBatch(batchId, {
      status,
      qualityReport,
      productionEligible: false,
      updatedAt: new Date().toISOString(),
    });
    await auditEvent({
      batchId,
      action: "batch_staged",
      operator: req.operator,
      details: { qualityReport },
    });
    return res.status(201).json({ batch: updatedBatch, qualityReport });
  } catch (err) {
    await db.updateIngestionBatch(batchId, { status: "failed", failureReason: err.message, updatedAt: new Date().toISOString() });
    await auditEvent({ batchId, action: "batch_failed", operator: req.operator, details: { message: err.message } });
    throw err;
  }
}));

app.get("/api/admin/ingestion/batches", ...admin, asyncHandler(async (req, res) => {
  res.json(await db.listIngestionBatches({ page: req.query.page, limit: req.query.limit }));
}));

app.get("/api/admin/ingestion/batches/:id", ...admin, asyncHandler(async (req, res) => {
  const batch = await db.getIngestionBatch(req.params.id);
  if (!batch) return res.status(404).json({ error: "Ingestion batch not found" });
  const reviewSummary = await db.summarizeStagedBatch(batch.id);
  res.json({ ...batch, reviewSummary });
}));

app.get("/api/admin/ingestion/batches/:id/records", ...admin, asyncHandler(async (req, res) => {
  const batch = await db.getIngestionBatch(req.params.id);
  if (!batch) return res.status(404).json({ error: "Ingestion batch not found" });
  const allowed = new Set(["pending_review", "approved", "rejected", "blocked_invalid", "blocked_duplicate", "blocked_quality"]);
  const status = req.query.status ? String(req.query.status) : undefined;
  if (status && !allowed.has(status)) return res.status(400).json({ error: "Invalid review status filter" });
  res.json(await db.listStagedBorewells(batch.id, { page: req.query.page, limit: req.query.limit, status }));
}));

app.get("/api/admin/ingestion/batches/:id/quality-report", ...admin, asyncHandler(async (req, res) => {
  const batch = await db.getIngestionBatch(req.params.id);
  if (!batch) return res.status(404).json({ error: "Ingestion batch not found" });
  const records = await db.getStagedBorewellsForBatch(batch.id);
  res.json(buildQualityReport(records));
}));

app.get("/api/admin/ingestion/batches/:id/audit", ...admin, asyncHandler(async (req, res) => {
  const batch = await db.getIngestionBatch(req.params.id);
  if (!batch) return res.status(404).json({ error: "Ingestion batch not found" });
  res.json(await db.getIngestionAudit(batch.id, { limit: req.query.limit }));
}));

app.patch("/api/admin/ingestion/records/:id", ...admin, validate(ingestionReviewSchema), asyncHandler(async (req, res) => {
  const record = await db.getStagedBorewell(req.params.id);
  if (!record) return res.status(404).json({ error: "Staged record not found" });
  if (record.publishedAt) return res.status(409).json({ error: "Published records cannot be re-reviewed" });

  const now = new Date().toISOString();
  let patch;
  if (req.body.decision === "approve") {
    if (!record.validation?.valid) return res.status(409).json({ error: "Invalid records cannot be approved; correct and re-import the source row" });
    if (record.duplicateOf) return res.status(409).json({ error: "Duplicate records cannot be approved" });
    if ((record.quality?.score || 0) < QUALITY_THRESHOLD) {
      return res.status(409).json({ error: `Quality score must be at least ${QUALITY_THRESHOLD} before approval` });
    }
    patch = {
      reviewStatus: "approved",
      datasetEligible: true,
      eligibilityReasons: [],
      reviewedAt: now,
      reviewedBy: req.operator.name,
      reviewNote: req.body.reviewNote || "",
      updatedAt: now,
    };
  } else {
    patch = {
      reviewStatus: "rejected",
      datasetEligible: false,
      eligibilityReasons: [...new Set([...(record.eligibilityReasons || []), "human_rejected"])],
      reviewedAt: now,
      reviewedBy: req.operator.name,
      reviewNote: req.body.reviewNote || "",
      updatedAt: now,
    };
  }

  const updated = await db.updateStagedBorewell(record.id, patch);
  await auditEvent({
    batchId: record.batchId,
    recordId: record.id,
    action: req.body.decision === "approve" ? "record_approved" : "record_rejected",
    operator: req.operator,
    details: { reviewNote: req.body.reviewNote || "", qualityScore: record.quality?.score ?? null },
  });
  const workflow = await refreshBatchWorkflow(record.batchId);
  res.json({ record: updated, batch: workflow.batch, reviewSummary: workflow.summary });
}));

app.post("/api/admin/ingestion/batches/:id/publish", ...admin, asyncHandler(async (req, res) => {
  const batch = await db.getIngestionBatch(req.params.id);
  if (!batch) return res.status(404).json({ error: "Ingestion batch not found" });
  if (batch.status === "published") {
    return res.json({ batch, publishedCount: batch.publishedCount || 0, alreadyPublished: true });
  }

  const summary = await db.summarizeStagedBatch(batch.id);
  if ((summary.byStatus.pending_review || 0) > 0) {
    return res.status(409).json({ error: "Every reviewable row must be reviewed before publishing", reviewSummary: summary });
  }

  const publishable = await db.getPublishableStagedBorewells(batch.id);
  if (!publishable.length) return res.status(409).json({ error: "No approved, eligible records are ready to publish" });

  // Re-check duplicates at the final boundary in case live data changed during review.
  const safeToPublish = [];
  for (const record of publishable) {
    const duplicate = await db.findCanonicalDuplicate({
      fingerprint: record.fingerprint,
      location: record.location,
      drilledDate: record.drilledDate,
    });
    if (duplicate && duplicate.id !== record.id) {
      await db.updateStagedBorewell(record.id, {
        reviewStatus: "blocked_duplicate",
        duplicateOf: duplicate.id,
        datasetEligible: false,
        eligibilityReasons: [...new Set([...(record.eligibilityReasons || []), "duplicate_at_publish"])],
        updatedAt: new Date().toISOString(),
      });
      await auditEvent({
        batchId: batch.id,
        recordId: record.id,
        action: "publish_duplicate_blocked",
        operator: req.operator,
        details: { duplicateOf: duplicate.id },
      });
    } else {
      safeToPublish.push(record);
    }
  }

  if (!safeToPublish.length) {
    const workflow = await refreshBatchWorkflow(batch.id);
    return res.status(409).json({ error: "All approved rows became duplicates before publish", batch: workflow.batch });
  }

  const publishedAt = new Date().toISOString();
  const canonical = safeToPublish.map((record) => toPublishedBorewell(record, {
    verifiedBy: req.operator.name,
    publishedAt,
  }));
  const publishResult = await db.publishImportedBorewells(canonical);
  await db.markStagedPublished(safeToPublish.map((r) => r.id), publishedAt);

  const finalRecords = await db.getStagedBorewellsForBatch(batch.id);
  const qualityReport = buildQualityReport(finalRecords);
  const updatedBatch = await db.updateIngestionBatch(batch.id, {
    status: "published",
    productionEligible: true,
    publishedAt,
    publishedBy: { id: req.operator.id, name: req.operator.name },
    publishedCount: safeToPublish.length,
    qualityReport,
    updatedAt: publishedAt,
  });
  await auditEvent({
    batchId: batch.id,
    action: "batch_published",
    operator: req.operator,
    details: { publishedCount: safeToPublish.length, upsertedCount: publishResult.upsertedCount },
  });
  res.json({ batch: updatedBatch, publishedCount: safeToPublish.length, qualityReport });
}));

// unknown routes + central error handling (must be last)
app.use(notFound);
app.use(errorHandler);

const startServer = () => app.listen(PORT, () => console.log(`BoreSakshi API running on http://localhost:${PORT}`));

// Vercel calls the exported app; everywhere else this process owns the port.
if (!process.env.VERCEL) {
  connectDB().then(startServer).catch((err) => {
    console.error("Could not connect to MongoDB at", process.env.MONGODB_URI || "mongodb://localhost:27017/");
    console.error("Is MongoDB running? Start it (or open MongoDB Compass) and try again.");
    console.error(err.message);
    process.exit(1);
  });
}

process.on("unhandledRejection", (reason) => console.error("[BoreSakshi] Unhandled promise rejection:", reason));
process.on("uncaughtException", (err) => console.error("[BoreSakshi] Uncaught exception:", err));

export default app;