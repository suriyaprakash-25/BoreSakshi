import path from "path";
import { access, mkdir, writeFile, unlink } from "fs/promises";
import { constants as fsConstants } from "fs";
import { validateSecurityConfiguration } from "./security.js";

const LOCAL_MONGO = /(^|\/\/)(localhost|127\.0\.0\.1)(:|\/|$)/i;
const RELEASE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PLACEHOLDER_RE = /(change[_ -]?me|replace[_ -]?with|example(?:\.org|\.com|\.invalid)?|your[-_ ]|todo|changethis)/i;

function positiveInt(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function rejectPlaceholder(errors, name, value) {
  if (value && PLACEHOLDER_RE.test(String(value))) errors.push(`${name} still contains a placeholder value`);
}

export function validateProductionDeploymentEnv(env = process.env) {
  const errors = [];
  const warnings = [];
  const security = validateSecurityConfiguration(env);
  errors.push(...security.errors);
  warnings.push(...security.warnings);

  const production = env.NODE_ENV === "production";
  if (!production) warnings.push("NODE_ENV is not production; deployment-only guarantees are not active");

  if (production) {
    if (!env.DEPLOYMENT_ENV || !["staging", "production"].includes(env.DEPLOYMENT_ENV)) {
      errors.push("DEPLOYMENT_ENV must be staging or production");
    }
    if (!env.RELEASE_VERSION || !RELEASE_RE.test(env.RELEASE_VERSION)) {
      errors.push("RELEASE_VERSION is required and must contain only safe release characters");
    }
    if (!env.MONGODB_URI) errors.push("MONGODB_URI is required in production");
    if (env.DEPLOYMENT_ENV === "production" && LOCAL_MONGO.test(String(env.MONGODB_URI || ""))) {
      errors.push("Production MONGODB_URI must not point at localhost/127.0.0.1");
    }
    if (!env.BACKUP_ENCRYPTION_KEY_BASE64) {
      errors.push("BACKUP_ENCRYPTION_KEY_BASE64 is required in production");
    }
    if (env.REQUIRE_ML_READY !== "YES") {
      errors.push("REQUIRE_ML_READY=YES is required for a production-ready BoreSakshi deployment");
    }

    const media = String(env.RIG_MEDIA_DIR || "");
    const backups = String(env.BACKUP_DIR || "");
    if (!path.isAbsolute(media)) errors.push("RIG_MEDIA_DIR must be an absolute durable-volume path in production");
    if (!path.isAbsolute(backups)) errors.push("BACKUP_DIR must be an absolute durable-volume path in production");
    if (env.RIG_MEDIA_DURABLE !== "YES") errors.push("RIG_MEDIA_DURABLE=YES is required after mounting durable private evidence storage");
    if (env.OFFSITE_BACKUP_CONFIGURED !== "YES") errors.push("OFFSITE_BACKUP_CONFIGURED=YES is required after configuring scheduled off-host backups");
    if (env.CENTRAL_LOGGING_CONFIGURED !== "YES") errors.push("CENTRAL_LOGGING_CONFIGURED=YES is required after centralized log shipping is active");
    if (env.ALERT_DELIVERY_CONFIGURED !== "YES") errors.push("ALERT_DELIVERY_CONFIGURED=YES is required after a real alert receiver has been tested");

    for (const [name, value] of Object.entries({
      MONGODB_URI: env.MONGODB_URI,
      FRONTEND_URL: env.FRONTEND_URL,
      JWT_SECRET: env.JWT_SECRET,
      RIG_EVIDENCE_SECRET: env.RIG_EVIDENCE_SECRET,
      MONITORING_TOKEN: env.MONITORING_TOKEN,
      BACKUP_ENCRYPTION_KEY_BASE64: env.BACKUP_ENCRYPTION_KEY_BASE64,
    })) rejectPlaceholder(errors, name, value);
  }

  const shutdownMs = positiveInt(env.GRACEFUL_SHUTDOWN_MS, 15000);
  if (!shutdownMs || shutdownMs < 5000 || shutdownMs > 120000) {
    errors.push("GRACEFUL_SHUTDOWN_MS must be an integer between 5000 and 120000");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    releaseVersion: env.RELEASE_VERSION || "development",
    deploymentEnv: env.DEPLOYMENT_ENV || "development",
    shutdownMs: shutdownMs || 15000,
  };
}

export function assertProductionDeploymentEnv(env = process.env) {
  const result = validateProductionDeploymentEnv(env);
  if (!result.ok) {
    const error = new Error(`Production deployment configuration invalid: ${result.errors.join("; ")}`);
    error.code = "PRODUCTION_DEPLOYMENT_CONFIG_INVALID";
    error.details = result;
    throw error;
  }
  return result;
}

export async function assertWritableDirectory(directory, label) {
  const resolved = path.resolve(directory);
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  await access(resolved, fsConstants.R_OK | fsConstants.W_OK);
  const probe = path.join(resolved, `.boresakshi-write-probe-${process.pid}-${Date.now()}`);
  await writeFile(probe, "ok\n", { flag: "wx", mode: 0o600 });
  await unlink(probe);
  return { label, path: resolved, writable: true };
}

export async function checkDeploymentStorage(env = process.env) {
  const results = [];
  if (env.RIG_MEDIA_DIR) results.push(await assertWritableDirectory(env.RIG_MEDIA_DIR, "rig_media"));
  if (env.BACKUP_DIR) results.push(await assertWritableDirectory(env.BACKUP_DIR, "backup"));
  return results;
}
