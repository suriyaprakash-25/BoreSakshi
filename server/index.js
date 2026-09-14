// index.js — BoreSakshi API
import "dotenv/config"; // load server/.env before anything reads process.env
import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { nanoid } from "nanoid";
import { db, connectDB, pingDB } from "./db.js";
import { predictBorewell, distanceKm, NEAR_KM } from "./predict.js";
import { signup, signin, signout, requireAuth, requireAdmin, requireCsrf } from "./auth.js";
import {
  validate, signupSchema, signinSchema, predictSchema, borewellSchema,
  adminOperatorPatchSchema, adminLogPatchSchema,
} from "./validation.js";
import {
  asyncHandler, authLimiter, signinBruteLimiter, predictLimiter, notFound, errorHandler,
} from "./middleware.js";

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
  allowedHeaders: ["Content-Type", "X-CSRF-Token"],
}));
app.use(cookieParser());
app.use(express.json({ limit: "10kb" })); // reject oversized payloads (→ 413)
app.use(morgan("dev")); // request logging

// Behind a reverse proxy (Render/Railway, AWS ALB) set TRUST_PROXY=1 so client IPs
// and therefore IP rate limiting — are read correctly. Otherwise, rate limiters
// will see the proxy IP and globally throttle all users. Left off locally.
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY));

const PORT = process.env.PORT || 4000;

// Public borewell discovery is intentionally approximate: the map still works
// while avoiding publication of a farmer's exact drilling location or operator identity.
const toPublicBorewell = ({ operatorId, operatorName, createdBy, verifiedBy, lat, lng, ...record }) => ({
  ...record,
  lat: Math.round(lat * 100) / 100,
  lng: Math.round(lng * 100) / 100,
});
// NEAR_KM ("nearby" radius for confidence, ledger matching + explainability)
// is defined once in predict.js and imported so both files can never drift.

// health check — reports DB liveness; never hangs (5s server-selection timeout)
app.get("/api/health", asyncHandler(async (_req, res) => {
  const dbUp = await pingDB();
  res.status(dbUp ? 200 : 503).json({ ok: dbUp, service: "boresakshi", db: dbUp ? "up" : "down" });
}));

// ----------------------------------------------------------------------------
// 0) OPERATOR AUTH (rig operators only — the farmer flow stays open/no-login)
// ----------------------------------------------------------------------------
app.post("/api/auth/signup", authLimiter, validate(signupSchema), asyncHandler(signup));
app.post(
  "/api/auth/signin",
  authLimiter,                 // IP throttle for all auth traffic
  validate(signinSchema),      // reject malformed bodies first
  signinBruteLimiter,          // then count failed attempts per phone number
  asyncHandler(signin)
);
app.post("/api/auth/signout", requireAuth, requireCsrf, asyncHandler(signout));
// The client restores its UI state from the HTTP-only cookie; it never needs to
// persist a token or profile in browser storage.
app.get("/api/auth/session", requireAuth, asyncHandler(async (req, res) => {
  res.json({ operator: req.operator, csrfToken: req.csrfToken });
}));

// ----------------------------------------------------------------------------
// 1) LOG A BOREWELL (rig operator submits a completed job for admin review)
// ----------------------------------------------------------------------------
app.post("/api/borewells", requireAuth, requireCsrf, validate(borewellSchema), asyncHandler(async (req, res) => {
  const {
    lat, lng, placeName, depthFt, strata, waterStrikeFt, yieldLpm, success, language,
    gpsAccuracyM, drillingDate, predictionId,
  } = req.body;

  // Validate a requested accountability link before storing the field record so
  // a bad link cannot leave a partially accepted borewell submission behind.
  let linkedPrediction = null;
  if (predictionId) {
    linkedPrediction = await db.getPredictionById(predictionId);
    if (!linkedPrediction) return res.status(404).json({ error: "Prediction not found" });
    if (linkedPrediction.actual != null) return res.status(409).json({ error: "Prediction already has an outcome" });
    if (distanceKm({ lat, lng }, { lat: linkedPrediction.lat, lng: linkedPrediction.lng }) > NEAR_KM) {
      return res.status(400).json({ error: `Outcome must be within ${NEAR_KM} km of the linked prediction` });
    }
  }

  const createdAt = new Date().toISOString();
  const observedAt = drillingDate || createdAt;
  const status = success ? "ACTIVE" : "DRY";
  const record = {
    id: nanoid(10),
    publicId: "BW-" + nanoid(10).toUpperCase(),
    lat, lng,
    gpsAccuracyM: gpsAccuracyM ?? null,
    placeName: placeName?.trim() || "",
    drillingDate: observedAt,
    depthFt: depthFt ?? null,
    strata: strata ?? "",
    geology: strata ?? "",
    waterStrikeFt: waterStrikeFt ?? null,
    yieldLpm: yieldLpm ?? null,
    success,
    status,
    // identity comes from the signed-in operator, not free-text client input
    operatorId: req.operator.id,
    operatorName: req.operator.name,
    createdBy: req.operator.id,
    language: language ?? "ta",
    // Moderation is separate from borewell status. The legacy verified field
    // remains for existing clients and old records during this migration.
    verificationStatus: "SUBMITTED",
    flagged: false,
    flagReason: "",
    verified: false,
    createdAt,
  };
  const drillingObservation = {
    id: nanoid(10),
    borewellId: record.id,
    type: "DRILLING",
    observedAt,
    depthFt: record.depthFt,
    waterStrikeFt: record.waterStrikeFt,
    yieldLpm: record.yieldLpm,
    status: record.status,
    geology: record.geology,
    createdBy: req.operator.id,
    createdAt,
  };
  await db.addBorewellWithObservation(record, drillingObservation);

  // WORK QUEUE: if this log lands near one of the operator's still-pending
  // assigned sites, close that assignment out.
  const pending = await db.getAssignmentsByOperator(req.operator.id, { status: "pending" });
  const near = pending.find((a) => distanceKm({ lat, lng }, { lat: a.lat, lng: a.lng }) <= 2);
  if (near) await db.updateAssignment(near.id, { status: "logged", loggedBorewellId: record.id, loggedAt: record.createdAt });

  // ACCOUNTABILITY LOOP: location proximity is not enough to link an outcome to
  // a request. Score at most the explicit prediction selected by the operator.
  let scoredPredictions = 0;
  if (linkedPrediction) {
    const predictedSuccess = linkedPrediction.successProbability >= 50;
    await db.updatePrediction(linkedPrediction.id, {
      actual: { success: record.success, depthFt: record.depthFt, borewellId: record.id, closedAt: record.createdAt },
      correct: predictedSuccess === record.success,
    });
    scoredPredictions = 1;
  }

  // An outcome with no explicit prediction remains valuable verified field data,
  // but cannot be used to claim prediction accuracy.
  res.status(201).json({ ...record, scoredPredictions });
}));

app.get("/api/borewells", asyncHandler(async (_req, res) => {
  const logs = await db.getPredictionEligibleBorewells();
  res.json(logs.map(toPublicBorewell));
}));

// this operator's own logs (newest first) — powers their dashboard + history
app.get("/api/borewells/mine", requireAuth, asyncHandler(async (req, res) =>
  res.json(await db.getBorewellsByOperator(req.operator.id))
));

// this operator's assigned sites still awaiting a log
app.get("/api/assignments", requireAuth, asyncHandler(async (req, res) =>
  res.json(await db.getAssignmentsByOperator(req.operator.id, { status: "pending" }))
));

// ----------------------------------------------------------------------------
// 2) PREDICT for a location (farmer drops a pin). Stored so we can score it later.
// ----------------------------------------------------------------------------
app.post("/api/predict", predictLimiter, validate(predictSchema), asyncHandler(async (req, res) => {
  const { lat, lng, save: shouldSave = true } = req.body;

  // Admin-verified, non-flagged drill logs within NEAR_KM — the same data that drives the
  // prediction, its `factors`, and its confidence. Annotated with distance and
  // sorted nearest-first so the frontend "nearby wells" explorer can show the
  // exact evidence behind the number.
  const nearbyLogs = (await db.getPredictionEligibleBorewells())
    .map((b) => ({ ...b, distanceKm: distanceKm({ lat, lng }, b) }))
    .filter((b) => b.distanceKm <= NEAR_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const prediction = predictBorewell({ lat, lng, nearbyLogs });

  let saved = null;
  if (shouldSave) {
    saved = await db.addPrediction({
      id: nanoid(10),
      lat, lng,
      ...prediction,
      actual: null,     // filled when a real borewell is later logged nearby
      correct: null,
      createdAt: new Date().toISOString(),
    });
  }
  res.json({
    ...prediction,
    predictionId: saved?.id ?? null,
    nearbyVerifiedLogs: nearbyLogs.length,
    // trimmed evidence list for the Nearby Borewell Explorer (proof for the user)
    nearby: nearbyLogs.slice(0, 20).map((b) => ({
      id: b.id,
      distanceKm: Math.round(b.distanceKm * 100) / 100,
      depthFt: b.depthFt ?? null,
      success: b.success,
      strata: b.strata || "",
      placeName: b.placeName || "",
      createdAt: b.createdAt,
    })),
  });
}));

// ----------------------------------------------------------------------------
// 3) ACCOUNTABILITY LEDGER — public accuracy record (your winning differentiator)
// ----------------------------------------------------------------------------
app.get("/api/ledger", asyncHandler(async (_req, res) => {
  const preds = await db.getPredictions();
  const closed = preds.filter((p) => p.actual != null);
  const correct = closed.filter((p) => p.correct).length;
  const accuracy = closed.length ? Math.round((correct / closed.length) * 100) : null;
  res.json({
    totalPredictions: preds.length,
    scored: closed.length,
    correct,
    accuracyPct: accuracy,
    recent: closed.slice(-10).reverse().map((p) => ({
      id: p.id, lat: Math.round(p.lat * 100) / 100, lng: Math.round(p.lng * 100) / 100,
      predictedSuccessPct: p.successProbability,
      actualSuccess: p.actual.success,
      correct: p.correct,
    })),
  });
}));

// ----------------------------------------------------------------------------
// 4) ADMIN — platform oversight. Every route requires an admin account.
// ----------------------------------------------------------------------------
const adminRead = [requireAuth, requireAdmin];
const adminWrite = [requireAuth, requireAdmin, requireCsrf];

// all operator accounts (no password hashes)
app.get("/api/admin/operators", ...adminRead, asyncHandler(async (_req, res) =>
  res.json(await db.getOperators())
));

// every log across all operators (includes flag/verify moderation fields)
app.get("/api/admin/logs", ...adminRead, asyncHandler(async (_req, res) =>
  res.json(await db.getAllBorewells())
));

// deactivate/reactivate or verify an operator (never role — no in-app role mgmt)
app.patch("/api/admin/operators/:id", ...adminWrite, validate(adminOperatorPatchSchema), asyncHandler(async (req, res) => {
  const updated = await db.updateOperator(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "Operator not found" });
  const { passwordHash, ...safe } = updated; // belt-and-braces
  res.json(safe);
}));

// flag/unflag or verify an individual log
app.patch("/api/admin/logs/:id", ...adminWrite, validate(adminLogPatchSchema), asyncHandler(async (req, res) => {
  const patch = { ...req.body };
  if (patch.flagged === true) {
    patch.flagReason = (req.body.flagReason || "").trim();
    patch.flaggedAt = new Date().toISOString();
    patch.flaggedBy = req.operator.name;
  } else if (patch.flagged === false) {
    patch.flagReason = "";
    patch.flaggedAt = null;
    patch.flaggedBy = null;
  }
  const updated = await db.updateBorewell(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: "Log not found" });
  res.json(updated);
}));

// unknown routes + central error handling (must be last)
app.use(notFound);
app.use(errorHandler);

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`BoreSakshi API running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Could not connect to MongoDB at", process.env.MONGODB_URI || "mongodb://localhost:27017/");
    console.error("Is MongoDB running? Start it (or open MongoDB Compass) and try again.");
    console.error(err.message);
    process.exit(1);
  });

// last-resort guards so an unexpected async error logs instead of killing the process silently
process.on("unhandledRejection", (reason) => console.error("[BoreSakshi] Unhandled promise rejection:", reason));
process.on("uncaughtException", (err) => console.error("[BoreSakshi] Uncaught exception:", err));
