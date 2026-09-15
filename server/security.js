import crypto from "crypto";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getAllowedOrigins(env = process.env) {
  const configured = [env.FRONTEND_URL, ...splitCsv(env.ALLOWED_ORIGINS)].filter(Boolean);
  const defaults = env.NODE_ENV === "production" ? [] : ["http://localhost:5173"];
  return [...new Set([...configured, ...defaults])];
}

export function validateSecurityConfiguration(env = process.env) {
  const errors = [];
  const warnings = [];
  const production = env.NODE_ENV === "production";
  const jwt = String(env.JWT_SECRET || "");
  const evidence = String(env.RIG_EVIDENCE_SECRET || "");
  const monitoring = String(env.MONITORING_TOKEN || "");
  const origins = getAllowedOrigins(env);

  if (!jwt) errors.push("JWT_SECRET is required");
  if (jwt && jwt.length < 32) errors.push("JWT_SECRET must be at least 32 characters");
  if (production && !evidence) errors.push("RIG_EVIDENCE_SECRET is required in production");
  if (evidence && evidence.length < 32) errors.push("RIG_EVIDENCE_SECRET must be at least 32 characters");
  if (production && evidence && jwt && evidence === jwt) errors.push("RIG_EVIDENCE_SECRET must be distinct from JWT_SECRET in production");
  if (production && !monitoring) errors.push("MONITORING_TOKEN is required in production");
  if (monitoring && monitoring.length < 24) errors.push("MONITORING_TOKEN must be at least 24 characters");
  if (production && origins.length === 0) errors.push("FRONTEND_URL or ALLOWED_ORIGINS must configure at least one production origin");
  if (production && !env.TRUST_PROXY) errors.push("TRUST_PROXY must be configured in production so secure cookies/rate limits use the real client/protocol");

  for (const origin of origins) {
    let parsed;
    try { parsed = new URL(origin); } catch {
      errors.push(`Invalid allowed origin: ${origin}`);
      continue;
    }
    if (!/^https?:$/.test(parsed.protocol)) errors.push(`Allowed origin must use http/https: ${origin}`);
    if (production && parsed.protocol !== "https:" && !(env.ALLOW_INSECURE_LOCAL_ORIGIN === "YES" && LOCAL_HTTP.test(origin))) {
      errors.push(`Production origins must use HTTPS: ${origin}`);
    }
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) errors.push(`Allowed origin must not include a path/query/fragment: ${origin}`);
  }

  if (!env.BACKUP_ENCRYPTION_KEY_BASE64) {
    warnings.push("BACKUP_ENCRYPTION_KEY_BASE64 is not configured; production backup jobs must provide a 32-byte base64 key");
  } else {
    try {
      const decoded = Buffer.from(env.BACKUP_ENCRYPTION_KEY_BASE64, "base64");
      if (decoded.length !== 32) errors.push("BACKUP_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes");
    } catch {
      errors.push("BACKUP_ENCRYPTION_KEY_BASE64 is invalid base64");
    }
  }

  return { ok: errors.length === 0, errors, warnings, origins };
}

export function assertSecurityConfiguration(env = process.env) {
  const result = validateSecurityConfiguration(env);
  if (!result.ok) {
    const error = new Error(`Security configuration invalid: ${result.errors.join("; ")}`);
    error.code = "SECURITY_CONFIG_INVALID";
    error.details = result;
    throw error;
  }
  return result;
}

export function createCorsOptions(env = process.env) {
  const allowed = new Set(getAllowedOrigins(env));
  return {
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-File-Name", "X-Evidence-Token", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "RateLimit", "RateLimit-Policy"],
    maxAge: 600,
    origin(origin, callback) {
      // Non-browser clients do not send Origin. CSRF write protection below
      // separately controls whether origin-less unsafe requests are allowed.
      if (!origin || allowed.has(origin)) return callback(null, true);
      const error = new Error("Origin is not allowed by BoreSakshi CORS policy");
      error.code = "CORS_ORIGIN_DENIED";
      callback(error);
    },
  };
}

export function requestId(req, res, next) {
  const incoming = String(req.headers["x-request-id"] || "");
  const safe = /^[A-Za-z0-9._:-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.id = safe;
  res.setHeader("X-Request-Id", safe);
  next();
}

export function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (req.path?.startsWith("/api/auth") || req.path?.startsWith("/api/admin")) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
  }
  next();
}

export function enforceProductionHttps(req, res, next) {
  if (process.env.NODE_ENV !== "production") return next();
  const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (req.secure || forwarded === "https") return next();
  return res.status(400).json({ error: "HTTPS is required", requestId: req.id || null });
}

export function createCsrfOriginGuard(env = process.env) {
  const allowed = new Set(getAllowedOrigins(env));
  const production = env.NODE_ENV === "production";
  const allowOriginless = env.ALLOW_ORIGINLESS_WRITE === "YES";
  return function csrfOriginGuard(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    // Machine clients can use Authorization instead of ambient cookie auth.
    if (String(req.headers.authorization || "").startsWith("Bearer ")) return next();

    const origin = String(req.headers.origin || "").trim();
    if (origin && allowed.has(origin)) return next();

    // Referer is a secondary same-origin signal for older/same-origin browsers.
    const referer = String(req.headers.referer || "").trim();
    if (!origin && referer) {
      try {
        const refererOrigin = new URL(referer).origin;
        if (allowed.has(refererOrigin)) return next();
      } catch { /* reject below */ }
    }

    if (!production && !origin && !referer) return next();
    if (allowOriginless && !origin && !referer) return next();
    return res.status(403).json({
      error: "Cross-site write blocked by origin policy",
      code: "CSRF_ORIGIN_REJECTED",
      requestId: req.id || null,
    });
  };
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function requireMonitoringToken(req, res, next) {
  const configured = String(process.env.MONITORING_TOKEN || "");
  if (!configured) {
    if (process.env.NODE_ENV !== "production") return next();
    return res.status(503).json({ error: "Monitoring access is not configured" });
  }
  const auth = String(req.headers.authorization || "");
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!constantTimeEqual(configured, supplied)) return res.status(401).json({ error: "Monitoring token required" });
  next();
}

export function publicBorewellProjection(record) {
  return {
    id: record.id,
    schemaVersion: record.schemaVersion || record.rigSubmissionSchemaVersion || null,
    lat: record.lat,
    lng: record.lng,
    location: record.location || (Number.isFinite(record.lng) && Number.isFinite(record.lat)
      ? { type: "Point", coordinates: [record.lng, record.lat] }
      : null),
    placeName: record.placeName || "",
    drilledAt: record.drilledAt || null,
    drilledDate: record.drilledDate || record.drillingDate || null,
    depthFt: record.depthFt ?? null,
    waterStrikeFt: record.waterStrikeFt ?? null,
    yieldLpm: record.yieldLpm ?? null,
    success: record.success === true,
    strata: record.strata || "",
    geologicalLayers: Array.isArray(record.geologicalLayers)
      ? record.geologicalLayers.map(({ fromFt, toFt, material }) => ({ fromFt, toFt, material }))
      : [],
    verificationStatus: record.verificationStatus || (record.verified ? "VERIFIED" : null),
    verified: record.verified === true,
    datasetEligibility: record.datasetEligibility ? { eligible: record.datasetEligibility.eligible === true, status: record.datasetEligibility.status || null } : null,
    provenance: record.provenance ? {
      sourceType: record.provenance.sourceType || null,
      sourceName: record.provenance.sourceName || null,
      datasetName: record.provenance.datasetName || null,
      license: record.provenance.license || null,
    } : null,
    createdAt: record.createdAt || null,
  };
}
