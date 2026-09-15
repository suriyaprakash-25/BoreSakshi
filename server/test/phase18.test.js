import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { checkDeploymentStorage, validateProductionDeploymentEnv } from "../productionConfig.js";
import { migration } from "../migrations/phase18-production-v1.js";

function validEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    DEPLOYMENT_ENV: "production",
    RELEASE_VERSION: "2026.09.15-abc123",
    MONGODB_URI: "mongodb+srv://cluster.example.invalid/BoreSakshi",
    MONGODB_DB: "BoreSakshi",
    FRONTEND_URL: "https://boresakshi.example.org",
    TRUST_PROXY: "1",
    JWT_SECRET: "j".repeat(48),
    RIG_EVIDENCE_SECRET: "e".repeat(48),
    MONITORING_TOKEN: "m".repeat(32),
    BACKUP_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
    REQUIRE_ML_READY: "YES",
    LOG_FORMAT: "json",
    RIG_MEDIA_DIR: "/var/lib/boresakshi/rig-media",
    BACKUP_DIR: "/var/lib/boresakshi/backups",
    RIG_MEDIA_DURABLE: "YES",
    OFFSITE_BACKUP_CONFIGURED: "YES",
    GRACEFUL_SHUTDOWN_MS: "15000",
    ...overrides,
  };
}

test("production deployment configuration rejects unsafe/local or incomplete production settings", () => {
  const result = validateProductionDeploymentEnv(validEnv({
    MONGODB_URI: "mongodb://127.0.0.1:27017/",
    REQUIRE_ML_READY: "NO",
    LOG_FORMAT: "text",
    RIG_MEDIA_DURABLE: "NO",
    OFFSITE_BACKUP_CONFIGURED: "NO",
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.includes("localhost/127.0.0.1")));
  assert.ok(result.errors.some((item) => item.includes("REQUIRE_ML_READY=YES")));
  assert.ok(result.errors.some((item) => item.includes("LOG_FORMAT=json")));
  assert.ok(result.errors.some((item) => item.includes("RIG_MEDIA_DURABLE=YES")));
  assert.ok(result.errors.some((item) => item.includes("OFFSITE_BACKUP_CONFIGURED=YES")));
});

test("production deployment configuration accepts a complete hardened deployment contract", () => {
  const result = validateProductionDeploymentEnv(validEnv());
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.releaseVersion, "2026.09.15-abc123");
  assert.equal(result.deploymentEnv, "production");
  assert.equal(result.shutdownMs, 15000);
});

test("deployment storage probe verifies rig-media and backup paths are writable", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "boresakshi-phase18-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const results = await checkDeploymentStorage({
    RIG_MEDIA_DIR: path.join(root, "rig-media"),
    BACKUP_DIR: path.join(root, "backups"),
  });
  assert.deepEqual(results.map((item) => item.label).sort(), ["backup", "rig_media"]);
  assert.ok(results.every((item) => item.writable === true));
});

test("Phase 18 migration creates and reverses only its named production indexes", async () => {
  const created = [];
  const dropped = [];
  const database = {
    collection(name) {
      return {
        async createIndex(keys, options) { created.push({ name, keys, options }); },
        async dropIndex(indexName) { dropped.push({ name, indexName }); },
      };
    },
  };
  await migration.up(database);
  assert.equal(created.length, 4);
  assert.deepEqual(created.map((item) => item.options.name), [
    "phase18_trusted_outcomes",
    "phase18_accountability_status",
    "phase18_operator_security",
    "phase18_audit_action",
  ]);
  await migration.down(database);
  assert.deepEqual(dropped.map((item) => item.indexName), created.map((item) => item.options.name));
});
