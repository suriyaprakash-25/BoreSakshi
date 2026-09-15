import express from "express";
import { nanoid } from "nanoid";

import { authStore } from "./authStore.js";
import { pingDB } from "./db.js";
import { mlClient } from "./mlClient.js";
import {
  adminLimiter,
  apiLimiter,
  asyncHandler,
  passwordResetLimiter,
  predictLimiter,
} from "./middleware.js";
import { prometheusMetrics, requestMetrics } from "./observability.js";
import {
  assertSecurityConfiguration,
  createCsrfOriginGuard,
  enforceProductionHttps,
  getAllowedOrigins,
  publicBorewellProjection,
  requestId,
  requireMonitoringToken,
  securityHeaders,
} from "./security.js";
import {
  adminOperatorPatchSchema,
  passwordChangeSchema,
  passwordResetSchema,
  recoveryRotateSchema,
} from "./validation.js";
import { isTrustedOutcome } from "./rigData.js";

function verifiedFieldAccount(req, res, next) {
  if (req.operator?.role === "admin") return next();
  if (req.operator?.verified !== true) {
    return res.status(403).json({
      error: "A verified operator account is required before submitting drilling evidence",
      code: "OPERATOR_ACCOUNT_NOT_VERIFIED",
    });
  }
  next();
}

async function securityAudit(db, { action, actor, scopeId, details = {} }) {
  if (typeof db.addIngestionAudit !== "function") return;
  await db.addIngestionAudit({
    id: nanoid(14),
    batchId: null,
    recordId: null,
    scopeType: "security_event",
    scopeId: scopeId || actor?.id || "platform",
    action,
    actor: actor ? { id: actor.id, name: actor.name, role: actor.role || "operator" } : { id: "system", name: "BoreSakshi", role: "system" },
    details,
    createdAt: new Date().toISOString(),
  });
}

function dynamicAuthHandler(name) {
  return asyncHandler(async (req, res) => {
    const auth = await import("./auth.js");
    if (typeof auth[name] !== "function") throw new Error(`Unknown auth handler: ${name}`);
    return auth[name](req, res);
  });
}

export function createPhase15Router({ db, requireAuth, requireAdmin, validate }) {
  if (process.env.NODE_ENV === "production") assertSecurityConfiguration();

  const router = express.Router();
  router.use(requestId);
  router.use(securityHeaders);
  router.use(enforceProductionHttps);
  router.use(requestMetrics);
  router.use(createCsrfOriginGuard());
  router.use(apiLimiter);
  router.use("/api/admin", adminLimiter);
  router.use("/api/predict", predictLimiter);

  // --------------------------------------------------------------------------
  // Reliability / monitoring
  // --------------------------------------------------------------------------
  router.get("/api/health/live", (_req, res) => {
    res.json({ ok: true, service: "boresakshi", status: "live", uptimeSeconds: Math.floor(process.uptime()) });
  });

  router.get("/api/health/ready", asyncHandler(async (_req, res) => {
    const dbReady = await pingDB();
    let mlReady = false;
    let ml = null;
    try {
      ml = await mlClient.health({ timeoutMs: 1000 });
      mlReady = ml?.ok === true && ml?.ready !== false;
    } catch (error) {
      ml = { ok: false, ready: false, code: error?.code || "ML_UNAVAILABLE" };
    }
    const requireMl = process.env.REQUIRE_ML_READY === "YES";
    const ready = dbReady && (!requireMl || mlReady);
    res.status(ready ? 200 : 503).json({
      ok: ready,
      status: ready ? "ready" : "not_ready",
      db: dbReady ? "up" : "down",
      ml: { required: requireMl, ready: mlReady, detail: ml },
    });
  }));

  router.get("/api/internal/metrics", requireMonitoringToken, (_req, res) => {
    res.type("text/plain; version=0.0.4").send(prometheusMetrics());
  });

  // --------------------------------------------------------------------------
  // Password recovery + revocable session management
  // --------------------------------------------------------------------------
  router.post("/api/auth/password/reset", passwordResetLimiter, validate(passwordResetSchema), dynamicAuthHandler("resetPassword"));
  router.post("/api/auth/password/change", requireAuth, validate(passwordChangeSchema), dynamicAuthHandler("changePassword"));
  router.post("/api/auth/recovery/rotate", requireAuth, validate(recoveryRotateSchema), dynamicAuthHandler("rotateRecoveryCode"));
  router.get("/api/auth/sessions", requireAuth, dynamicAuthHandler("listSessions"));
  router.post("/api/auth/sessions/revoke-others", requireAuth, dynamicAuthHandler("revokeOtherSessions"));

  // Field evidence may only be created/submitted by a verified account. Read-only
  // account/trust/history routes remain available so an unverified user can see
  // their state and contact the administrator.
  router.use("/api/operator/evidence", requireAuth, verifiedFieldAccount);
  router.post("/api/borewells", requireAuth, verifiedFieldAccount, (_req, _res, next) => next());

  // --------------------------------------------------------------------------
  // Public privacy boundary — intercept before Phase 8's full internal record.
  // --------------------------------------------------------------------------
  router.get("/api/borewells", asyncHandler(async (_req, res) => {
    const records = await db.getBorewells();
    res.json(records.filter(isTrustedOutcome).map(publicBorewellProjection));
  }));

  // --------------------------------------------------------------------------
  // Admin hardening and audit
  // --------------------------------------------------------------------------
  router.patch(
    "/api/admin/operators/:id",
    requireAuth,
    requireAdmin,
    validate(adminOperatorPatchSchema),
    asyncHandler(async (req, res) => {
      const existing = await db.getOperatorById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Operator not found" });
      const { reason, ...patch } = req.body;
      const updated = await db.updateOperator(existing.id, patch);
      if (!updated) return res.status(404).json({ error: "Operator not found" });

      let revokedSessions = 0;
      if (patch.status === "deactivated" || (existing.role === "admin" && patch.verified === false)) {
        revokedSessions = await authStore.revokeAllForOperator(existing.id, patch.status === "deactivated" ? "account_deactivated" : "admin_verification_removed");
      }
      await securityAudit(db, {
        action: "admin_operator_security_update",
        actor: req.operator,
        scopeId: existing.id,
        details: {
          targetOperatorId: existing.id,
          before: { status: existing.status || "active", verified: !!existing.verified, role: existing.role || "operator" },
          after: { status: updated.status || "active", verified: !!updated.verified, role: updated.role || existing.role || "operator" },
          reason,
          revokedSessions,
          requestId: req.id,
        },
      });
      res.json(updated);
    })
  );

  router.post(
    "/api/admin/operators/:id/recovery/rotate",
    requireAuth,
    requireAdmin,
    dynamicAuthHandler("adminRotateRecoveryCode")
  );

  router.get("/api/admin/security/operators/:id/audit", requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const operator = await db.getOperatorById(req.params.id);
    if (!operator) return res.status(404).json({ error: "Operator not found" });
    const events = await db.getIngestionAuditByScope("security_event", operator.id, { limit: req.query.limit || 200 });
    res.json({ operator: { id: operator.id, name: operator.name, role: operator.role || "operator" }, events });
  }));

  router.get("/api/admin/security/status", requireAuth, requireAdmin, (_req, res) => {
    const origins = getAllowedOrigins();
    res.json({
      nodeEnv: process.env.NODE_ENV || "development",
      secureCookies: process.env.NODE_ENV === "production",
      allowedOrigins: origins,
      trustProxyConfigured: Boolean(process.env.TRUST_PROXY),
      monitoringTokenConfigured: Boolean(process.env.MONITORING_TOKEN),
      evidenceSecretConfigured: Boolean(process.env.RIG_EVIDENCE_SECRET),
      encryptedBackupKeyConfigured: Boolean(process.env.BACKUP_ENCRYPTION_KEY_BASE64),
      mlRequiredForReadiness: process.env.REQUIRE_ML_READY === "YES",
      csrfMode: "same-origin Origin/Referer validation for unsafe browser requests; Bearer machine clients exempt",
      sessionMode: "JWT identity + server-side revocable auth_sessions",
    });
  });

  return router;
}
