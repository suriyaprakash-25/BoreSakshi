// middleware.js — cross-cutting API middleware: async error capture, rate
// limiting (express-rate-limit v8, in-memory, no external service), a JSON 404,
// and a central error handler that always returns clean JSON (never hangs).
import rateLimit from "express-rate-limit";

// wrap async handlers so a rejected promise reaches the error handler instead of
// hanging the request (Express 4 doesn't catch async throws on its own).
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const msg = (m) => ({ error: m });

// IP-based throttle for all auth traffic (signup + signin).
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: msg("Too many attempts from this device. Please wait a few minutes and try again."),
});

// Per-phone brute-force guard: lock a number out after 5 FAILED sign-ins in the
// window. Successful sign-ins don't count (skipSuccessfulRequests), so a normal
// user is never affected. Keyed by phone digits, so it's independent of IP.
const digits = (p) => String(p || "").replace(/[^\d]/g, "");
export const signinBruteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min lockout window
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => digits(req.body?.phone) || "unknown",
  validate: { keyGeneratorIpFallback: false }, // intentional: we key by phone, not IP
  standardHeaders: true,
  legacyHeaders: false,
  message: msg("Too many failed sign-in attempts for this number. Please wait ~10 minutes and try again."),
});

// Public predictions may create accountability records, so rate limit them
// independently from authentication traffic. Use a shared store (Redis) before
// horizontal production scaling; this in-memory limiter is per process.
export const predictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: msg("Too many prediction requests from this device. Please wait a few minutes and try again."),
});

// unknown route → clean JSON 404
export function notFound(_req, res) {
  res.status(404).json({ error: "Not found" });
}

// central error handler (must keep 4 args). Turns any thrown error — bad JSON,
// oversized body, DB failure — into a clean JSON response and logs it server-side.
export function errorHandler(err, _req, res, _next) {
  if (res.headersSent) return; // response already streaming; let Express close it

  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "Malformed JSON in request body" });
  }

  console.error("[BoreSakshi] Unhandled API error:", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
}
