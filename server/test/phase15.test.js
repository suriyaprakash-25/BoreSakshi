import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import {
  createCsrfOriginGuard,
  publicBorewellProjection,
  securityHeaders,
  validateSecurityConfiguration,
} from "../security.js";
import {
  decodeJsonLines,
  decryptBackup,
  encodeJsonLines,
  encryptBackup,
  gzip,
  gunzip,
  sha256,
  validateBackupManifest,
  buildBackupManifest,
} from "../backupCore.js";
import { adminOperatorPatchSchema, passwordResetSchema } from "../validation.js";
import { prometheusMetrics, requestMetrics, resetMetricsForTests } from "../observability.js";
import { createPhase15Router } from "../phase15Routes.js";

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function trustedBorewell(overrides = {}) {
  return {
    id: "well-public",
    lat: 11.36,
    lng: 77.8,
    location: { type: "Point", coordinates: [77.8, 11.36] },
    placeName: "Test village",
    depthFt: 420,
    waterStrikeFt: 260,
    yieldLpm: 45,
    success: true,
    strata: "fractured granite",
    geologicalLayers: [{ fromFt: 0, toFt: 420, material: "granite", notes: "private note" }],
    drilledAt: "2026-09-14T00:00:00Z",
    drilledDate: "2026-09-14",
    verified: true,
    verificationStatus: "VERIFIED",
    flagged: false,
    datasetEligibility: { eligible: true, status: "verified_operator_outcome", privateReason: "internal" },
    operatorId: "op-private",
    operatorName: "Private Rig Operator",
    reviewedBy: "Private Admin",
    evidence: [{ id: "private-photo", objectKey: "private/file.jpg" }],
    gps: { accuracyM: 4.2, rawDevice: "private" },
    provenance: {
      sourceType: "operator",
      sourceName: "BoreSakshi authenticated operator submission",
      sourceReference: "private support link",
      importedBy: { id: "admin", name: "Admin" },
    },
    createdAt: "2026-09-15T00:00:00Z",
    ...overrides,
  };
}

test("production security configuration fails closed for weak or incomplete secrets", () => {
  const bad = validateSecurityConfiguration({
    NODE_ENV: "production",
    JWT_SECRET: "short",
    RIG_EVIDENCE_SECRET: "short",
    FRONTEND_URL: "http://example.com",
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((item) => item.includes("JWT_SECRET")));
  assert.ok(bad.errors.some((item) => item.includes("MONITORING_TOKEN")));
  assert.ok(bad.errors.some((item) => item.includes("HTTPS")));
  assert.ok(bad.errors.some((item) => item.includes("TRUST_PROXY")));

  const good = validateSecurityConfiguration({
    NODE_ENV: "production",
    JWT_SECRET: "j".repeat(48),
    RIG_EVIDENCE_SECRET: "e".repeat(48),
    MONITORING_TOKEN: "m".repeat(32),
    FRONTEND_URL: "https://boresakshi.example",
    TRUST_PROXY: "1",
    BACKUP_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString("base64"),
  });
  assert.equal(good.ok, true, good.errors.join("; "));
  assert.deepEqual(good.origins, ["https://boresakshi.example"]);
});

test("CSRF origin guard rejects cross-site browser writes but permits same-origin and bearer machine clients", async () => {
  const oldEnv = process.env.NODE_ENV;
  const oldFrontend = process.env.FRONTEND_URL;
  process.env.NODE_ENV = "production";
  process.env.FRONTEND_URL = "https://boresakshi.example";
  const app = express();
  app.use(express.json());
  app.use(createCsrfOriginGuard(process.env));
  app.post("/write", (_req, res) => res.json({ ok: true }));
  try {
    await withServer(app, async (base) => {
      let response = await fetch(`${base}/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: "{}",
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "CSRF_ORIGIN_REJECTED");

      response = await fetch(`${base}/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://boresakshi.example" },
        body: "{}",
      });
      assert.equal(response.status, 200);

      response = await fetch(`${base}/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer machine-token" },
        body: "{}",
      });
      assert.equal(response.status, 200);
    });
  } finally {
    if (oldEnv == null) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
    if (oldFrontend == null) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = oldFrontend;
  }
});

test("security headers deny framing, sniffing and caching of sensitive routes", async () => {
  const app = express();
  app.use(securityHeaders);
  app.get("/api/admin/test", (_req, res) => res.json({ ok: true }));
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/admin/test`);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  });
});

test("public borewell projection excludes operator, reviewer, evidence, GPS and private provenance", () => {
  const projected = publicBorewellProjection(trustedBorewell());
  assert.equal(projected.id, "well-public");
  assert.equal(projected.success, true);
  assert.equal(projected.provenance.sourceType, "operator");
  assert.equal("operatorId" in projected, false);
  assert.equal("operatorName" in projected, false);
  assert.equal("reviewedBy" in projected, false);
  assert.equal("evidence" in projected, false);
  assert.equal("gps" in projected, false);
  assert.equal("sourceReference" in projected.provenance, false);
  assert.equal("notes" in projected.geologicalLayers[0], false);
  assert.deepEqual(projected.datasetEligibility, { eligible: true, status: "verified_operator_outcome" });
});

test("encrypted backup primitives round-trip JSONL and reject tampering", () => {
  const docs = [{ id: "a", secret: "stored-hash" }, { id: "b", count: 2 }];
  const compressed = gzip(encodeJsonLines(docs));
  const key = Buffer.alloc(32, 9);
  const encrypted = encryptBackup(compressed, key);
  const manifest = buildBackupManifest({
    database: "BoreSakshi",
    createdAt: "2026-09-15T03:00:00Z",
    encrypted: true,
    collections: [{
      name: "operators",
      file: "operators.jsonl.gz.enc",
      count: 2,
      sha256: sha256(encrypted.bytes),
      plaintextSha256: sha256(compressed),
      algorithm: encrypted.algorithm,
      ivBase64: encrypted.ivBase64,
      authTagBase64: encrypted.authTagBase64,
    }],
  });
  assert.equal(validateBackupManifest(manifest), true);
  const restored = decodeJsonLines(gunzip(decryptBackup(encrypted.bytes, key, encrypted)));
  assert.deepEqual(restored, docs);

  const tampered = Buffer.from(encrypted.bytes);
  tampered[0] ^= 0xff;
  assert.throws(() => decryptBackup(tampered, key, encrypted));
});

test("admin operator security changes require a documented reason and password reset input is strict", () => {
  assert.equal(adminOperatorPatchSchema.safeParse({ status: "deactivated" }).success, false);
  assert.equal(adminOperatorPatchSchema.safeParse({ status: "deactivated", reason: "Repeated verified security incident." }).success, true);
  assert.equal(adminOperatorPatchSchema.safeParse({ verified: true, reason: "Evidence and identity were manually reviewed." }).success, true);

  const valid = passwordResetSchema.safeParse({
    phone: "9876543210",
    recoveryCode: "BSK-ABCDE-FGHJK-LMNPQ-RSTUV",
    newPassword: "SecurePass1!",
    confirmPassword: "SecurePass1!",
  });
  assert.equal(valid.success, true);
  assert.equal(passwordResetSchema.safeParse({ ...valid.data, unexpected: true }).success, false);
});

test("recovery codes are high-entropy formatted values", async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "phase15-unit-test-jwt-secret-with-at-least-32-characters";
  try {
    const auth = await import(`../auth.js?phase15=${Date.now()}`);
    const values = new Set(Array.from({ length: 20 }, () => auth.generateRecoveryCode()));
    assert.equal(values.size, 20);
    for (const value of values) assert.match(value, /^BSK-[A-Z2-9]{5}(?:-[A-Z2-9]{5}){3}$/);
  } finally {
    if (previous == null) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous;
  }
});

test("request metrics use coarse route buckets and expose Prometheus output", async () => {
  resetMetricsForTests();
  const app = express();
  app.use(requestMetrics);
  app.get("/api/admin/operators/secret-id", (_req, res) => res.json({ ok: true }));
  app.get("/api/predict", (_req, res) => res.json({ ok: true }));
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/admin/operators/secret-id`)).status, 200);
    assert.equal((await fetch(`${base}/api/predict`)).status, 200);
  });
  const metrics = prometheusMetrics();
  assert.match(metrics, /route="\/api\/admin\/\*"/);
  assert.match(metrics, /route="\/api\/predict"/);
  assert.equal(metrics.includes("secret-id"), false);
});

test("Phase 15 router projects public borewells without private field evidence", async () => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const db = {
    getBorewells: async () => [trustedBorewell(), trustedBorewell({ id: "untrusted", verified: false, verificationStatus: "SUBMITTED", datasetEligibility: { eligible: false } })],
    addIngestionAudit: async () => {},
  };
  const app = express();
  app.use(express.json());
  app.use(createPhase15Router({
    db,
    requireAuth: (_req, _res, next) => next(),
    requireAdmin: (_req, _res, next) => next(),
    validate: () => (_req, _res, next) => next(),
  }));
  try {
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/borewells`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.length, 1);
      assert.equal(body[0].id, "well-public");
      assert.equal("operatorId" in body[0], false);
      assert.equal("evidence" in body[0], false);
    });
  } finally {
    if (previousEnv == null) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
  }
});
