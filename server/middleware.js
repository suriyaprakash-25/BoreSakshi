// middleware.js — cross-cutting API middleware: async error capture, rate
// limiting, clean JSON errors, and production-safe error handling.
import rateLimit from "express-rate-limit";

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const msg = (m, code = "RATE_LIMITED") => ({ error: m, code });

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT || 600),
  standardHeaders: true,
  legacyHeaders: false,
  message: msg("Too many requests. Please wait and try again."),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: msg("Too many authentication attempts from this device. Please wait and try again."),
});

const digits = (p) => String(p || "").replace(/[^\d]/g, "");
export const signinBruteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Number(process.env.SIGNIN_FAILURE_LIMIT || 5),
  skipSuccessfulRequests: true,
  keyGenerator: (req) => digits(req.body?.phone) || "unknown",
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: msg("Too many failed sign-in attempts for this number. Please wait before trying again.", "SIGNIN_LOCKED"),
});

export const passwordResetLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  limit: Number(process.env.PASSWORD_RESET_LIMIT || 5),
  keyGenerator: (req) => digits(req.body?.phone) || req.ip || "unknown",
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: msg("Too many password recovery attempts. Please wait before trying again.", "PASSWORD_RESET_LOCKED"),
});

export const predictLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: Number(process.env.PREDICT_RATE_LIMIT || 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: msg("Prediction request limit reached. Please wait a few minutes."),
});

export const adminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: Number(process.env.ADMIN_RATE_LIMIT || 180),
  standardHeaders: true,
  legacyHeaders: false,
  message: msg("Admin request limit reached. Please wait and retry."),
});

export function notFound(req, res) {
  res.status(404).json({ error: "Not found", requestId: req.id || null });
}

export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;

  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large", requestId: req.id || null });
  }
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "Malformed JSON in request body", requestId: req.id || null });
  }
  if (err?.code === "CORS_ORIGIN_DENIED") {
    return res.status(403).json({ error: "Origin is not allowed", code: err.code, requestId: req.id || null });
  }

  console.error("[BoreSakshi] Unhandled API error", {
    requestId: req.id || null,
    method: req.method,
    path: req.path,
    name: err?.name,
    code: err?.code,
    message: err?.message,
  });
  res.status(500).json({ error: "Something went wrong. Please try again.", requestId: req.id || null });
}
